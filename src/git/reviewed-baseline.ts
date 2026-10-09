import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createPrivateFile, isPathWithinRoot, resolveCanonicalRoot } from '../security/paths.js';
import { environmentSecrets, patchContainsCredential } from '../security/redaction.js';
import { assertNoProjectVibeExtensions, assertSimpleGlobRoot } from '../backends/profile.js';
import { preparationGit as boundedGit, resolveBaseCommit, resolveGitRoot } from './worktree.js';

// Snapshot operations must never inherit the caller's external index.
const git = (cwd: string, args: string[], _env = process.env, codes = [0]): Promise<Buffer> =>
  boundedGit(cwd, args, { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG }, codes);

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const entry = z.object({ path: z.string().min(1).max(1024), operation: z.enum(['add', 'replace', 'delete']), baseSha256: sha.nullable(), reviewedSha256: sha.nullable(), mode: z.enum(['100644', '100755']).optional() }).strict();
export const baselineInputSchema = z.object({ source: z.string().min(1), baseRef: z.string().min(1).max(512), outputParent: z.string().min(1), entries: z.array(entry).min(1).max(64) }).strict();
export type BaselineInput = z.infer<typeof baselineInputSchema>;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TREE = 100 * 1024 * 1024;
export const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function refuse(): never { throw new Error('Reviewed baseline validation failed; source preserved.'); }
function safePath(name: string, overlay: boolean): void {
  const parts = name.split('/');
  if (path.isAbsolute(name) || /[\\:\x00-\x1f\x7f]/.test(name) || parts.some(p => !p || p === '.' || p === '..' || p.startsWith('-'))) refuse();
  if (parts.some(p => /^\.env(?:\.|$)/i.test(p) || /^\.envrc(?:\.|$)/i.test(p) || /\.(pem|key|p12|pfx)$/i.test(p) || ['.git', '.codex', '.aws', '.ssh', '.vibe'].includes(p.toLowerCase()))) refuse();
  if (overlay && parts.some(p => ['.agents', 'agents.md', 'claude.md', 'gemini.md', '.vibeignore'].includes(p.toLowerCase()))) refuse();
}
function safeContent(bytes: Buffer, textOnly = false): void {
  if (bytes.length > MAX_FILE || (textOnly && (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)))) refuse();
  const patch = 'diff --git a/file b/file\n@@ -0,0 +1 @@\n' + bytes.toString('utf8').split('\n').map(l => '+' + l).join('\n');
  if (patchContainsCredential(patch, environmentSecrets())) refuse();
}
async function noLinks(root: string, relative: string, missing = false): Promise<void> {
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    try { const st = await lstat(current); if (st.isSymbolicLink()) refuse(); }
    catch (error) { if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
async function sourceBytes(root: string, relative: string): Promise<Buffer> {
  await noLinks(root, relative);
  const file = path.join(root, relative);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE) refuse();
    const bytes = await handle.readFile(); if (await realpath(file) !== file) refuse(); const after = await handle.stat(); const current = await lstat(file);
    if (before.ino !== current.ino || before.dev !== current.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.size !== bytes.length) refuse();
    safeContent(bytes, true); return bytes;
  } finally { await handle.close(); }
}
interface FileEntry { name: string; mode: string; bytes: Buffer }
export async function prepareReviewedBaseline(value: unknown, allowedRoots: readonly string[], create = false): Promise<Record<string, unknown>> {
  const input = baselineInputSchema.parse(value);
  if (!path.isAbsolute(input.source) || !path.isAbsolute(input.outputParent)) refuse();
  const source = await resolveCanonicalRoot(input.source, allowedRoots);
  const parent = await resolveCanonicalRoot(input.outputParent, allowedRoots);
  if (source !== path.resolve(input.source) || parent !== path.resolve(input.outputParent) || isPathWithinRoot(source, parent)) refuse();
  await noLinks(path.parse(source).root, source.slice(path.parse(source).root.length));
  await noLinks(path.parse(parent).root, parent.slice(path.parse(parent).root.length));
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.uid !== process.getuid?.() || parentInfo.mode & 0o077) refuse();
  if (await resolveGitRoot(source) !== source) refuse();
  assertSimpleGlobRoot(source); await assertNoProjectVibeExtensions(source);
  const filters = await git(source, ['config', '--local', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], process.env, [0, 1]);
  if (filters.length) refuse();
  const base = await resolveBaseCommit(source, input.baseRef);
  const list = (await git(source, ['ls-tree', '-r', '-z', base])).toString('utf8').split('\0').filter(Boolean);
  if (list.length > 4096) refuse();
  const files = new Map<string, FileEntry>(); const folded = new Set<string>(); let total = 0;
  for (const record of list) {
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t(.+)$/.exec(record); if (!match) refuse();
    const name = match[3]!; safePath(name, false);
    if (folded.has(name.toLowerCase())) refuse(); folded.add(name.toLowerCase());
    const bytes = await git(source, ['cat-file', 'blob', match[2]!]); safeContent(bytes); total += bytes.length;
    if (total > MAX_TREE) refuse(); files.set(name, { name, mode: match[1]!, bytes });
  }
  const selected = new Set<string>(); const selectedBytes = new Map<string, Buffer>();
  for (const e of input.entries) {
    safePath(e.path, true);
    if (selected.has(e.path.toLowerCase())) refuse(); selected.add(e.path.toLowerCase());
    const original = files.get(e.path);
    if ((original ? digest(original.bytes) : null) !== e.baseSha256 || (e.operation === 'add') !== !original) refuse();
    if (!original && folded.has(e.path.toLowerCase())) refuse();
    if ((e.operation === 'delete') !== (e.reviewedSha256 === null) || (e.operation !== 'delete' && !e.mode)) refuse();
    // No index mutation, and ignored content cannot enter through an overlay.
    if ((await git(source, ['check-ignore', '--no-index', '--', e.path], process.env, [0, 1])).length) refuse();
    if (e.operation === 'delete') {
      await noLinks(source, e.path, true);
      if (await lstat(path.join(source, e.path)).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; })) refuse();
    } else {
      const bytes = await sourceBytes(source, e.path); if (digest(bytes) !== e.reviewedSha256) refuse();
      const st = await lstat(path.join(source, e.path)); if (((st.mode & 0o111) ? '100755' : '100644') !== e.mode) refuse();
      selectedBytes.set(e.path, bytes);
    }
  }
  const checkSource = async (): Promise<void> => {
    for (const e of input.entries) {
      if (e.operation === 'delete') { await noLinks(source, e.path, true); if (await lstat(path.join(source, e.path)).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; })) refuse(); }
      else { if (digest(await sourceBytes(source, e.path)) !== e.reviewedSha256) refuse(); const st = await lstat(path.join(source, e.path)); if (((st.mode & 0o111) ? '100755' : '100644') !== e.mode) refuse(); }
    }
  };
  const finalPaths = new Set(files.keys()); let finalSize = total;
  for (const e of input.entries) {
    finalSize -= files.get(e.path)?.bytes.length ?? 0;
    if (e.operation === 'delete') finalPaths.delete(e.path);
    else { finalPaths.add(e.path); finalSize += selectedBytes.get(e.path)!.length; }
  }
  if (finalSize > MAX_TREE || finalPaths.size > 4096) refuse();
  for (const name of finalPaths) { const parts = name.split('/'); parts.pop(); while (parts.length) { if (finalPaths.has(parts.join('/'))) refuse(); parts.pop(); } }
  await checkSource();
  const provenance = { schema_version: 1, original_source: source, original_base: base, entries: input.entries };
  if (!create) return { status: 'validated_dry_run', ...provenance, manifest_sha256: digest(Buffer.from(JSON.stringify(provenance))), creates_snapshot_commit: true };
  const output = await mkdtemp(path.join(parent, 'reviewed-baseline-')); const repo = path.join(output, 'repo');
  // Failed creations are retained, owner-private, for explicit safe recovery.
  try {
    await mkdir(repo, { mode: 0o700 }); await git(repo, ['-c', 'init.templateDir=', 'init', '--quiet']);
    const write = async (f: FileEntry): Promise<void> => {
      await mkdir(path.dirname(path.join(repo, f.name)), { recursive: true, mode: 0o700 });
      await createPrivateFile(path.join(repo, f.name), f.bytes); await chmod(path.join(repo, f.name), f.mode === '100755' ? 0o700 : 0o600);
    };
    for (const f of files.values()) await write(f);
    const stage = async (names: string[]): Promise<void> => { for (let i = 0; i < names.length; i += 100) await git(repo, ['add', '--force', '--', ...names.slice(i, i + 100)]); };
    const commit = async (message: string): Promise<void> => { await git(repo, ['-c', 'user.name=Supervisor snapshot', '-c', 'user.email=snapshot@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.filemode=true', 'commit', '--quiet', '--allow-empty', '-m', message]); };
    await stage([...files.keys()]); await commit('Declared original baseline');
    for (const e of input.entries) {
      if (e.operation === 'delete') { await rm(path.join(repo, e.path)); files.delete(e.path); }
      else { const f = { name: e.path, mode: e.mode!, bytes: selectedBytes.get(e.path)! }; if (files.has(e.path)) await rm(path.join(repo, e.path)); await write(f); files.set(e.path, f); }
    }
    await stage(input.entries.map(e => e.path)); await commit('Reviewed effective baseline');
    await checkSource();
    for (const f of files.values()) {
      const h = await open(path.join(repo, f.name), constants.O_RDONLY | constants.O_NOFOLLOW); try { if (digest(await h.readFile()) !== digest(f.bytes)) refuse(); } finally { await h.close(); }
    }
    if ((await git(repo, ['status', '--porcelain'])).length) refuse();
    const snapshot = await resolveBaseCommit(repo);
    const body = { status: 'prepared', ...provenance, source_workspace: repo, base_ref: snapshot, files: [...files.values()].map(f => ({ path: f.name, sha256: digest(f.bytes), mode: f.mode })) };
    const report = { ...body, manifest_sha256: digest(Buffer.from(JSON.stringify(body))) };
    await createPrivateFile(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n'); await chmod(path.join(output, 'manifest.json'), 0o400);
    return { ...report, manifest_path: path.join(output, 'manifest.json') };
  } catch {
    await createPrivateFile(path.join(output, 'failure.json'), JSON.stringify({ status: 'preparation_failed', source_preserved: true }) + '\n').catch(() => undefined);
    throw new Error(`Baseline preparation failed; owned private output retained at ${output}`);
  }
}
