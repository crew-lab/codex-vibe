import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { acceptanceContractSchema, canonical, contractDigest, digest, safeRelativePath } from '../acceptance/schema.js';
import { exclusionScopesForWorkspace } from '../core/exclusions.js';
import type { ExclusionScope, SupervisorConfig } from '../contracts.js';
import { resolveBaseCommit, resolveGitRoot } from '../git/worktree.js';
import { judgeWorkspacePath } from '../backends/app-server/approvals.js';
import { workspaceAnchors } from '../security/globs.js';
import { resolveAdmittedWorkspace, resolveCanonicalWorkspaceRoot } from '../security/paths.js';
import { assertOwnedDirectory, readOwnedFile } from '../reporting/private-files.js';
import { sanitizeForPersistence } from '../persistence/atomic.js';

export const MAX_TASK_INPUT_FILES = 12;
export const MAX_TASK_INPUT_BYTES = 128 * 1024;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z.object({ path: safeRelativePath, sha256: hashSchema, bytes: z.number().int().nonnegative().max(MAX_TASK_INPUT_BYTES), provenance: z.enum(['committed', 'dirty-tracked', 'untracked']) }).strict();
export const taskInputManifestSchema = z.object({
  schema_version: z.literal(1), owner: z.literal('vibe-supervisor-task-inputs'), source: z.string().min(1).max(4096), base_commit: z.string().regex(/^[a-f0-9]{40,64}$/),
  files: z.array(fileSchema).min(1).max(MAX_TASK_INPUT_FILES), dirty_overlay_sha256: hashSchema, allowed_output_paths: z.array(safeRelativePath).min(1).max(100),
  contract_sha256: hashSchema.nullable(), policy_sha256: hashSchema, total_files: z.number().int().min(1).max(MAX_TASK_INPUT_FILES), total_bytes: z.number().int().min(0).max(MAX_TASK_INPUT_BYTES), token_count: z.null(), manifest_sha256: hashSchema
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length) context.addIssue({ code: 'custom', message: 'Duplicate task input file' });
  if (new Set(manifest.allowed_output_paths).size !== manifest.allowed_output_paths.length) context.addIssue({ code: 'custom', message: 'Duplicate allowed output path' });
  if (manifest.total_files !== manifest.files.length || manifest.total_bytes !== manifest.files.reduce((total, file) => total + file.bytes, 0)) context.addIssue({ code: 'custom', message: 'Task input totals mismatch' });
});
export type TaskInputManifest = z.infer<typeof taskInputManifestSchema>;

function runGit(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', root, ...args], { cwd: root, env, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = []; let size = 0; let stopped = false;
    const timer = setTimeout(() => { stopped = true; child.kill('SIGKILL'); }, 10_000); timer.unref();
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1024 * 1024) { stopped = true; child.kill('SIGKILL'); } else chunks.push(Buffer.from(chunk)); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); if (stopped || code !== 0) reject(new Error('Bounded Git query failed')); else resolve(Buffer.concat(chunks).toString('utf8')); });
  });
}

async function currentStatus(root: string, relative: string): Promise<'committed' | 'dirty-tracked' | 'untracked'> {
  const status = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', relative]);
  const record = status.slice(0, 2);
  if (record.includes('U') || record === 'AA' || record === 'DD') throw new Error(`Conflicted source file refused: ${relative}`);
  if (!record) {
    const tracked = await runGit(root, ['ls-files', '-z', '--', relative]);
    if (!tracked) throw new Error(`Selected input is ignored or absent from Git discovery: ${relative}. Use a reviewed non-ignored evidence document; do not disable ignore rules or force-add private evidence.`);
    return 'committed';
  }
  if (record === '??') return 'untracked';
  return 'dirty-tracked';
}

async function readSourceFile(root: string, relative: string): Promise<Buffer> {
  const parsed = safeRelativePath.parse(relative);
  let current = root;
  for (const segment of parsed.split('/')) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Linked source path refused: ${relative}`);
  }
  const before = await lstat(current);
  if (!before.isFile() || before.nlink !== 1 || before.size > MAX_TASK_INPUT_BYTES || (typeof process.getuid === 'function' && before.uid !== process.getuid())) throw new Error(`Unsafe or oversized source file: ${relative}`);
  if (await realpath(current) !== current) throw new Error(`Noncanonical source path refused: ${relative}`);
  const handle = await open(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || !opened.isFile() || opened.nlink !== 1) throw new Error(`Source file changed: ${relative}`);
    const bytes = await handle.readFile(); const after = await handle.stat();
    if (bytes.length > MAX_TASK_INPUT_BYTES || after.ino !== opened.ino || after.dev !== opened.dev || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error(`Source file changed while reading: ${relative}`);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes) || JSON.stringify(sanitizeForPersistence(text)) !== JSON.stringify(text)) throw new Error(`Source file is not safe to persist: ${relative}`);
    return bytes;
  } finally { await handle.close(); }
}

function manifestHash(value: Omit<TaskInputManifest, 'manifest_sha256'>): string { return digest(canonical(value)); }

async function resolveSource(source: string): Promise<string> {
  const root = await resolveGitRoot(source);
  const canonicalRoot = await resolveCanonicalWorkspaceRoot(root);
  if (root !== canonicalRoot || path.resolve(source) !== root) throw new Error('Source must be the canonical Git repository root');
  return root;
}

function policyDigest(allowedRoots: readonly string[], scopes: readonly ExclusionScope[]): string { return digest(canonical({ allowed_roots: [...allowedRoots].sort(), exclusions: scopes.map((scope) => ({ root: scope.root, globs: [...scope.globs].sort() })).sort((a, b) => a.root.localeCompare(b.root)) })); }

async function assertInputPolicy(source: string, relative: string, anchors: ReturnType<typeof workspaceAnchors>): Promise<void> {
  const judged = await judgeWorkspacePath(source, relative, anchors);
  if (!judged.allowed) throw new Error(`Task input path refused (${judged.reason}): ${relative}`);
}

export async function prepareTaskInputs(options: { source: string; base: string; files: readonly string[]; outputPaths?: readonly string[]; output: string; contractFile?: string; allowedRoots: readonly string[]; exclusions?: readonly ExclusionScope[] }): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  const source = await resolveSource(options.source);
  const admitted = await resolveAdmittedWorkspace(source, options.allowedRoots);
  if (admitted.workspace !== source) throw new Error('Source is not beneath a selected allowed workspace root');
  if (options.files.length === 0 || options.files.length > MAX_TASK_INPUT_FILES || new Set(options.files).size !== options.files.length) throw new Error(`Select 1–${MAX_TASK_INPUT_FILES} unique files`);
  const base = await resolveBaseCommit(source, options.base);
  if (!/^[a-f0-9]{40,64}$/.test(options.base) || base !== options.base) throw new Error('An immutable full base commit is required');
  if (await resolveBaseCommit(source, 'HEAD') !== base) throw new Error('Selected base must equal the current source HEAD');
  const outputPaths = options.outputPaths ?? options.files;
  if (!outputPaths.length || new Set(outputPaths).size !== outputPaths.length) throw new Error('Output paths must be non-empty and unique');
  const scopes = options.exclusions ?? [];
  const anchors = workspaceAnchors(scopes, source);
  const output = path.resolve(options.output);
  const problems: string[] = [];
  if (output === source || output.startsWith(`${source}${path.sep}`) || source.startsWith(`${output}${path.sep}`)) problems.push('Prepared context must be outside source checkout; select a new directory under an owner-private parent');
  try { await assertOwnedDirectory(path.dirname(output)); }
  catch { problems.push('Output parent must exist, be canonical, owned by the current user and mode 0700'); }
  try { await lstat(output); problems.push('Prepared output already exists; select a new directory'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problems.push('Prepared output cannot be inspected'); }
  let contractSha256: string | null = null;
  if (options.contractFile) {
    try { contractSha256 = contractDigest(acceptanceContractSchema.parse(JSON.parse((await readOwnedFile(options.contractFile, 256 * 1024)).toString('utf8')))); }
    catch { problems.push('Acceptance contract is unsafe or invalid; require an owned canonical single-link file with mode 0600 and a valid acceptance-contract JSON schema'); }
  }
  for (const relative of options.files) {
    try { await assertInputPolicy(source, relative, anchors); safeRelativePath.parse(relative); await currentStatus(source, relative); }
    catch (error) { problems.push((error as Error).message); }
  }
  for (const relative of outputPaths) {
    try { await assertInputPolicy(source, relative, anchors); safeRelativePath.parse(relative); }
    catch (error) { problems.push((error as Error).message); }
  }
  if (problems.length) throw new Error(`Task preparation preflight failed:\n${problems.map(problem => `- ${problem}`).join('\n')}`);
  const files = [];
  let totalBytes = 0;
  for (const relative of options.files) {
    if (Date.now() > deadline) throw new Error('Task input preparation deadline exceeded');
    await assertInputPolicy(source, relative, anchors);
    safeRelativePath.parse(relative);
    const bytes = await readSourceFile(source, relative);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TASK_INPUT_BYTES) throw new Error(`Selected files exceed ${MAX_TASK_INPUT_BYTES} bytes`);
    files.push({ path: relative, sha256: digest(bytes), bytes: bytes.length, provenance: await currentStatus(source, relative), content: bytes });
  }
  const safeOutputs = [];
  for (const relative of outputPaths) {
    await assertInputPolicy(source, relative, anchors);
    safeOutputs.push(safeRelativePath.parse(relative));
  }
  const fileEntries = files.map(({ path: filePath, sha256, bytes, provenance }) => ({ path: filePath, sha256, bytes, provenance }));
  const dirtyEntries = fileEntries.filter((entry) => entry.provenance !== 'committed').map(({ path: filePath, sha256, bytes }) => ({ path: filePath, sha256, bytes }));
  const body = { schema_version: 1 as const, owner: 'vibe-supervisor-task-inputs' as const, source, base_commit: base, files: fileEntries, dirty_overlay_sha256: digest(canonical(dirtyEntries)), allowed_output_paths: safeOutputs, contract_sha256: contractSha256, policy_sha256: policyDigest(options.allowedRoots, scopes), total_files: fileEntries.length, total_bytes: totalBytes, token_count: null as null };
  const manifest = taskInputManifestSchema.parse({ ...body, manifest_sha256: manifestHash(body) });
  await mkdir(output, { mode: 0o700 });
  try {
    await assertOwnedDirectory(output);
    await mkdir(path.join(output, 'context'), { mode: 0o700 });
    for (const file of files) {
      const destination = path.join(output, 'context', file.path);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, file.content, { mode: 0o600, flag: 'wx' });
    }
    await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) { throw new Error(`Prepared context creation failed; inspect the private partial directory at ${output}: ${(error as Error).message}`); }
  return { status: 'prepared', files: manifest.total_files, bytes: manifest.total_bytes, token_count: null, manifest_sha256: manifest.manifest_sha256 };
}

export async function verifyTaskInputs(directory: string, policy: { allowedRoots: readonly string[]; exclusions: readonly ExclusionScope[] }, requiredFiles?: readonly string[]): Promise<Record<string, unknown>> {
  const root = path.resolve(directory);
  await assertOwnedDirectory(root);
  const manifest = taskInputManifestSchema.parse(JSON.parse((await readOwnedFile(path.join(root, 'manifest.json'), 256 * 1024)).toString('utf8')));
  const { manifest_sha256: claimed, ...body } = manifest;
  if (manifestHash(body) !== claimed) throw new Error('Task input manifest digest mismatch');
  const source = await resolveSource(manifest.source);
  const admitted = await resolveAdmittedWorkspace(source, policy.allowedRoots);
  if (admitted.workspace !== source || policyDigest(policy.allowedRoots, policy.exclusions) !== manifest.policy_sha256) throw new Error('Task input authorization policy changed');
  if (source !== manifest.source || await resolveBaseCommit(source, 'HEAD') !== manifest.base_commit) throw new Error('Prepared task inputs are stale: source base changed');
  if (requiredFiles && (requiredFiles.length !== manifest.files.length || requiredFiles.some((file, index) => file !== manifest.files[index]?.path))) throw new Error('Required task input file list differs from the prepared manifest');
  const dirty = [];
  const anchors = workspaceAnchors(policy.exclusions, source);
  const expectedCopies = new Set(manifest.files.map((entry) => entry.path.split('/').join(path.sep)));
  const expectedDirectories = new Set<string>();
  for (const file of expectedCopies) {
    let parent = path.dirname(file);
    while (parent !== '.') { expectedDirectories.add(parent); parent = path.dirname(parent); }
  }
  let totalBytes = 0;
  for (const entry of manifest.files) {
    await assertInputPolicy(source, entry.path, anchors);
    const sourceBytes = await readSourceFile(source, entry.path);
    const provenance = await currentStatus(source, entry.path);
    if (digest(sourceBytes) !== entry.sha256 || sourceBytes.length !== entry.bytes || provenance !== entry.provenance) throw new Error(`Required source changed: ${entry.path}`);
    const copyPath = path.join(root, 'context', entry.path);
    await assertPrivateCopyPath(root, copyPath);
    const copied = await readOwnedFile(copyPath, MAX_TASK_INPUT_BYTES);
    if (digest(copied) !== entry.sha256 || copied.length !== entry.bytes) throw new Error(`Prepared context bytes changed: ${entry.path}`);
    totalBytes += copied.length;
    if (provenance !== 'committed') dirty.push({ path: entry.path, sha256: entry.sha256, bytes: entry.bytes });
  }
  const actualCopies: string[] = [];
  const walkCopies = async (relative: string): Promise<void> => {
    const directoryPath = path.join(root, 'context', relative);
    for (const name of await readdir(directoryPath)) {
      const child = path.join(relative, name);
      const absolute = path.join(root, 'context', child);
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid()) || (info.mode & 0o077) !== 0) throw new Error('Unsafe prepared context inventory');
      if (info.isDirectory() && expectedDirectories.has(child)) await walkCopies(child);
      else if (info.isFile() && info.nlink === 1) actualCopies.push(child);
      else throw new Error('Unsupported prepared context inventory entry');
    }
  };
  await walkCopies('');
  if (actualCopies.length !== expectedCopies.size || actualCopies.some((file) => !expectedCopies.has(file))) throw new Error('Prepared context contains missing or unlisted files');
  const topLevel = await readdir(root);
  if (topLevel.length !== 2 || !topLevel.includes('context') || !topLevel.includes('manifest.json')) throw new Error('Prepared directory contains unlisted files');
  for (const relative of manifest.allowed_output_paths) await assertInputPolicy(source, relative, anchors);
  if (totalBytes !== manifest.total_bytes || digest(canonical(dirty)) !== manifest.dirty_overlay_sha256) throw new Error('Prepared context totals or dirty overlay changed');
  return { status: 'verified', files: manifest.total_files, bytes: manifest.total_bytes, token_count: null, manifest_sha256: claimed };
}

export async function configExclusions(config: SupervisorConfig, workspace: string): Promise<ExclusionScope[]> { return exclusionScopesForWorkspace(config, workspace); }

async function assertPrivateCopyPath(root: string, file: string): Promise<void> {
  const relative = path.relative(root, file);
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Unsafe prepared context path');
    if (current !== file && (!info.isDirectory() || (info.mode & 0o077) !== 0)) throw new Error('Unsafe prepared context directory');
  }
}
