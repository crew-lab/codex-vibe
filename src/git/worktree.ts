import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateDir } from '../security/paths.js';
import { redactSecrets } from '../security/redaction.js';

const MAX_GIT_OUTPUT = 100 * 1024 * 1024;
const MAX_GIT_RUNTIME_MS = 30_000;

export class GitOperationError extends Error {
  readonly code = 'VSUP_GIT_REQUIRED';
  constructor(operation: string, detail?: string) { super(detail ?? `Git operation failed: ${operation}`); this.name = 'GitOperationError'; }
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env, allowedCodes: readonly number[] = [0]): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const safeEnv: NodeJS.ProcessEnv = { PATH: env.PATH, HOME: env.HOME, LANG: env.LANG, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    if (env.GIT_INDEX_FILE) safeEnv.GIT_INDEX_FILE = env.GIT_INDEX_FILE;
    const fixed = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.attributesFile=/dev/null'];
    const child = spawn('git', [...fixed, '-C', cwd, ...args], { cwd, env: safeEnv, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = []; let size = 0; let overflow = false;
    let timedOut = false;
    const signalTree = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch { /* child already stopped */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signalTree('SIGTERM');
      setTimeout(() => signalTree('SIGKILL'), 1000).unref?.();
    }, MAX_GIT_RUNTIME_MS);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_GIT_OUTPUT) { overflow = true; signalTree('SIGTERM'); setTimeout(() => signalTree('SIGKILL'), 1000).unref?.(); return; }
      chunks.push(Buffer.from(chunk));
    });
    child.once('error', () => reject(new GitOperationError(args[0] ?? 'git')));
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new GitOperationError(args[0] ?? 'git', `Git operation timed out: ${args[0] ?? 'git'}`));
      else if (overflow || code === null || !allowedCodes.includes(code)) reject(new GitOperationError(args[0] ?? 'git'));
      else resolve(Buffer.concat(chunks, size));
    });
  });
}

function decodeTrimmed(buffer: Buffer): string { return buffer.toString('utf8').trim(); }

export async function resolveGitRoot(source: string): Promise<string> {
  const root = decodeTrimmed(await git(source, ['rev-parse', '--show-toplevel']));
  return path.resolve(root);
}

export async function resolveBaseCommit(source: string, baseRef = 'HEAD'): Promise<string> {
  const resolved = decodeTrimmed(await git(source, ['rev-parse', '--verify', `${baseRef}^{commit}`]));
  if (!/^[0-9a-f]{40,64}$/i.test(resolved)) throw new GitOperationError('resolve base commit');
  return resolved;
}

export interface DirtySnapshot {
  patch: Buffer;
  diffStat: string;
  changedFiles: string[];
  sha256: string;
  bytes: number;
}

async function assertNoExternalFilters(root: string): Promise<void> {
  const filters = await git(root, ['config', '--local', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], process.env, [0, 1]);
  if (filters.byteLength > 0) throw new GitOperationError('filter configuration', 'Repository defines external Git filters; refusing to read/export through them');
}

/** Captures staged, unstaged and untracked (including binary) changes without touching the source index. */
export async function captureDirtySnapshot(source: string, baseRef = 'HEAD'): Promise<DirtySnapshot> {
  const root = await resolveGitRoot(source);
  const base = await resolveBaseCommit(root, baseRef);
  await assertNoExternalFilters(root);
  const trackedPatch = await git(root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', base, '--']);
  const trackedNames = await git(root, ['diff', '--name-only', '-z', '--no-textconv', '--no-renames', base, '--']);
  const trackedStat = await git(root, ['diff', '--stat', '--no-textconv', '--no-renames', base, '--']);
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  const statusBytes = status.toString('utf8');
  const untracked: string[] = [];
  let cursor = 0;
  while (cursor < statusBytes.length) {
    const end = statusBytes.indexOf('\0', cursor);
    if (end < 0) break;
    const record = statusBytes.slice(cursor, end);
    cursor = end + 1;
    if (record.slice(0, 2) === '??') untracked.push(record.slice(3));
  }
  const extraPatches: Buffer[] = [];
  const extraStats: string[] = [];
  for (const name of untracked) {
    const relative = name.startsWith('-') ? `./${name}` : name;
    const patch = await git(root, ['diff', '--no-index', '--binary', '--no-ext-diff', '--no-textconv', '--', '/dev/null', relative], process.env, [0, 1]);
    extraPatches.push(patch);
    const stat = await git(root, ['diff', '--no-index', '--stat', '--no-textconv', '--', '/dev/null', relative], process.env, [0, 1]);
    extraStats.push(stat.toString('utf8'));
  }
  const patch = Buffer.concat([trackedPatch, ...extraPatches]);
  const changedFiles = [...trackedNames.toString('utf8').split('\0').filter(Boolean), ...untracked];
  const diffStat = [trackedStat.toString('utf8'), ...extraStats].filter(Boolean).join('');
  return { patch, diffStat, changedFiles, sha256: createHash('sha256').update(patch).digest('hex'), bytes: patch.byteLength };
}

export async function createDetachedWorktree(source: string, worktreePath: string, baseRef = 'HEAD'): Promise<{ path: string; baseRef: string; createdBySupervisor: true }> {
  const root = await resolveGitRoot(source);
  const base = await resolveBaseCommit(root, baseRef);
  const target = path.resolve(worktreePath);
  await createPrivateDir(path.dirname(target));
  try { await lstat(target); throw new GitOperationError('worktree path already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await assertNoExternalFilters(root);
  await git(root, ['worktree', 'add', '--detach', '--', target, base]);
  return { path: target, baseRef: base, createdBySupervisor: true };
}

async function writeArtifact(file: string, data: Buffer): Promise<void> {
  const absolute = path.resolve(file);
  try { const info = await lstat(absolute); if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe artifact target'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temp = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(data); await handle.sync(); await handle.close();
    await import('node:fs/promises').then(({ rename }) => rename(temp, absolute));
    const dir = await open(path.dirname(absolute), 'r'); try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) {
    await handle.close().catch(() => {});
    await import('node:fs/promises').then(({ unlink }) => unlink(temp).catch(() => {}));
    throw error;
  }
}

/** Write dirty source patch + metadata before any cleanup; verify bytes and digest after writing. */
export async function exportDirtySnapshot(source: string, artifactDir: string, baseRef = 'HEAD'): Promise<DirtySnapshot & { patchPath: string; statPath: string }> {
  const snapshot = await captureDirtySnapshot(source, baseRef);
  const patchText = snapshot.patch.toString('utf8');
  if (redactSecrets(patchText) !== patchText) {
    throw Object.assign(new Error('Patch appears to contain a recognized secret; export was refused and the worktree was retained.'), { code: 'VSUP_ARTIFACT_ERROR' });
  }
  const dir = path.resolve(artifactDir);
  await createPrivateDir(dir);
  const patchPath = path.join(dir, 'diff.patch');
  const statPath = path.join(dir, 'diff.stat');
  await writeArtifact(patchPath, snapshot.patch);
  await writeArtifact(statPath, Buffer.from(snapshot.diffStat, 'utf8'));
  const check = await import('node:fs/promises').then(({ readFile }) => readFile(patchPath));
  const digest = createHash('sha256').update(check).digest('hex');
  if (check.byteLength !== snapshot.bytes || digest !== snapshot.sha256) throw new Error('Patch artifact verification failed; preserve the worktree');
  return { ...snapshot, patchPath, statPath };
}

/** Remove only a registered supervisor-created worktree after patch export was verified. */
export async function removeVerifiedWorktree(source: string, record: { path: string; baseRef?: string; createdBySupervisor: boolean }, verifiedExport: { patchPath: string; sha256: string }): Promise<void> {
  if (!record.createdBySupervisor) throw new Error('Refusing to remove a worktree not created by the supervisor');
  const patch = await import('node:fs/promises').then(({ readFile }) => readFile(verifiedExport.patchPath));
  if (createHash('sha256').update(patch).digest('hex') !== verifiedExport.sha256) throw new Error('Patch export verification failed; worktree retained');
  const root = await resolveGitRoot(source);
  const target = await realpath(record.path);
  if (await resolveGitRoot(target) !== target) throw new Error('Worktree path does not resolve to its own repository root; refusing cleanup');
  const registered = (await git(root, ['worktree', 'list', '--porcelain', '-z'])).toString('utf8').split('\0');
  if (!registered.includes(`worktree ${target}`)) throw new Error('Worktree is not registered with the expected source repository; refusing cleanup');
  const fresh = await captureDirtySnapshot(record.path, record.baseRef ?? 'HEAD');
  if (fresh.sha256 !== verifiedExport.sha256) throw new Error('Worktree changed after export; refusing cleanup');
  const status = await git(record.path, ['status', '--porcelain=v1', '-z', '--ignored=matching', '--untracked-files=all', '--no-renames']);
  if (status.toString('utf8').split('\0').some((line) => line.startsWith('!!'))) throw new Error('Ignored files remain in worktree; refusing cleanup');
  await git(root, ['worktree', 'remove', '--force', '--', target]);
}
