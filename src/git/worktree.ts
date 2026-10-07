import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, open, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPrivateDir } from '../security/paths.js';
import { environmentSecrets, redactSecrets, redactedTail } from '../security/redaction.js';

const MAX_GIT_OUTPUT = 100 * 1024 * 1024;
const MAX_GIT_RUNTIME_MS = 30_000;
const MAX_GIT_STDERR_BYTES = 4096;

export class GitOperationError extends Error {
  readonly code = 'VSUP_GIT_REQUIRED';
  constructor(readonly operation: string, detail?: string, readonly missing = false, readonly stderrTail = '') { super(detail ?? `Git operation failed: ${operation}`); this.name = 'GitOperationError'; }
}

export class WorktreeCreateError extends Error {
  readonly code = 'VSUP_WORKTREE_CREATE_FAILED';
  constructor(message: string, readonly details: Record<string, unknown>) { super(message); this.name = 'WorktreeCreateError'; }
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env, allowedCodes: readonly number[] = [0]): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const safeEnv: NodeJS.ProcessEnv = { PATH: env.PATH, HOME: env.HOME, LANG: env.LANG, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
    if (env.GIT_INDEX_FILE) safeEnv.GIT_INDEX_FILE = env.GIT_INDEX_FILE;
    const fixed = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.attributesFile=/dev/null', '-c', 'core.splitIndex=false', '-c', 'core.untrackedCache=false', '-c', 'index.skipHash=false'];
    const child = spawn('git', [...fixed, '-C', cwd, ...args], { cwd, env: safeEnv, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let size = 0; let overflow = false;
    let stderr = Buffer.alloc(0);
    let stderrHeadDropped = false;
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
    child.stderr.on('data', (chunk: Buffer) => {
      const joined = Buffer.concat([stderr, chunk]);
      if (joined.length > MAX_GIT_STDERR_BYTES) stderrHeadDropped = true;
      stderr = joined.subarray(-MAX_GIT_STDERR_BYTES);
    });
    const stderrTail = (): string => redactedTail(stderr, 1024, environmentSecrets(), stderrHeadDropped ? 'head' : undefined);
    child.once('error', (error) => reject(new GitOperationError(args[0] ?? 'git', undefined, (error as NodeJS.ErrnoException).code === 'ENOENT')));
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new GitOperationError(args[0] ?? 'git', `Git operation timed out: ${args[0] ?? 'git'}`, false, stderrTail()));
      else if (overflow || code === null || !allowedCodes.includes(code)) reject(new GitOperationError(args[0] ?? 'git', undefined, false, stderrTail()));
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

async function withPrivateIndex<T>(root: string, work: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-index-'));
  try {
    const location = decodeTrimmed(await git(root, ['rev-parse', '--git-path', 'index']));
    const source = path.resolve(root, location);
    const copy = path.join(directory, 'index');
    try { await copyFile(source, copy); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return await work({ ...process.env, GIT_INDEX_FILE: copy });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Captures staged, unstaged and untracked (including binary) changes without touching the source index. */
export async function captureDirtySnapshot(source: string, baseRef = 'HEAD'): Promise<DirtySnapshot> {
  const root = await resolveGitRoot(source);
  const base = await resolveBaseCommit(root, baseRef);
  await assertNoExternalFilters(root);
  return await withPrivateIndex(root, async (env) => {
    await git(root, ['add', '-N', '--all', '--', '.'], env);
    const patch = await git(root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', base, '--'], env);
    const names = await git(root, ['diff', '--name-only', '-z', '--no-textconv', '--no-renames', base, '--'], env);
    const stat = await git(root, ['diff', '--stat', '--no-textconv', '--no-renames', base, '--'], env);
    return { patch, diffStat: stat.toString('utf8'), changedFiles: names.toString('utf8').split('\0').filter(Boolean), sha256: createHash('sha256').update(patch).digest('hex'), bytes: patch.byteLength };
  });
}

export async function listGitVisibleFiles(root: string): Promise<string[] | undefined> {
  try {
    const inside = decodeTrimmed(await git(root, ['rev-parse', '--is-inside-work-tree'], process.env, [0, 128]));
    if (inside !== 'true') return undefined;
  } catch (error) { if (error instanceof GitOperationError && error.missing) return undefined; throw error; }
  const listed = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return [...new Set(listed.toString('utf8').split('\0').filter(Boolean))];
}

export async function createDetachedWorktree(source: string, worktreePath: string, baseRef = 'HEAD'): Promise<{ path: string; baseRef: string; createdBySupervisor: true }> {
  try { return await addDetachedWorktree(source, worktreePath, baseRef); }
  catch (error) {
    if (error instanceof GitOperationError) {
      if (error.missing) throw error;
      throw new WorktreeCreateError(`Git could not create the isolated worktree (${error.operation}).`, { operation: error.operation, ...(error.stderrTail ? { stderr_tail: error.stderrTail } : {}) });
    }
    const code = (error as NodeJS.ErrnoException).code;
    throw new WorktreeCreateError('The isolated worktree could not be created.', { ...(typeof code === 'string' ? { error_code: code } : {}) });
  }
}

async function addDetachedWorktree(source: string, worktreePath: string, baseRef: string): Promise<{ path: string; baseRef: string; createdBySupervisor: true }> {
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

function patchSections(patch: Buffer): string[] {
  return patch.toString('latin1').split(/^(?=diff --git )/m).filter(Boolean).sort();
}

function samePatchContent(saved: Buffer, fresh: Buffer): boolean {
  const left = patchSections(saved); const right = patchSections(fresh);
  return left.length === right.length && left.every((section, index) => section === right[index]);
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
  if (fresh.sha256 !== verifiedExport.sha256 && !samePatchContent(patch, fresh.patch)) throw new Error('Worktree changed after export; refusing cleanup');
  const status = await git(record.path, ['status', '--porcelain=v1', '-z', '--ignored=matching', '--untracked-files=all', '--no-renames']);
  if (status.toString('utf8').split('\0').some((line) => line.startsWith('!!'))) throw new Error('Ignored files remain in worktree; refusing cleanup');
  await git(root, ['worktree', 'remove', '--force', '--', target]);
}
