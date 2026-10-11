import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm, rmdir, opendir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';

const distRoot = process.env.VIBE_SUPERVISOR_DIST_DIR ? path.resolve(process.env.VIBE_SUPERVISOR_DIST_DIR) : path.resolve(import.meta.dirname, '..', 'dist');
const load = (relative) => import(pathToFileURL(path.join(distRoot, relative)).href);
const { createPrivateFile, isPathWithinRoot, resolveCanonicalRoot } = await load('security/paths.js');
const { environmentSecrets, patchContainsCredential } = await load('security/redaction.js');
const { assertNoProjectVibeExtensions, assertSimpleGlobRoot } = await load('backends/profile.js');
const { preparationGit: boundedGit, resolveBaseCommit, resolveGitRoot } = await load('git/worktree.js');
const { loadResolvedConfig, resolveConfigSelection } = await load('config/config.js');
const { APP_VERSION } = await load('version.js');
const { SUPPORTED_VIBE } = await load('backends/pinned.js');

const git = (cwd, args, codes = [0]) =>
  boundedGit(cwd, args, { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG }, codes);

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const entry = z.object({ path: z.string().min(1).max(1024), operation: z.enum(['add', 'replace', 'delete']), baseSha256: sha.nullable(), reviewedSha256: sha.nullable(), mode: z.enum(['100644', '100755']).optional() }).strict();
const publicTemplate = z.object({ path: z.literal('.env.example'), sha256: sha }).strict();
export const baselineInputSchema = z.object({ source: z.string().min(1), baseRef: z.string().min(1).max(512), outputParent: z.string().min(1), entries: z.array(entry).min(1).max(64), publicTemplates: z.array(publicTemplate).max(1).optional() }).strict();
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TREE = 100 * 1024 * 1024;
async function readPrivateInput(file) {
  if (path.resolve(file) !== file) refuse('input');
  let current = path.parse(file).root; const ancestors = [];
  for (const part of file.slice(current.length).split(path.sep)) {
    current = path.join(current, part); const info = await lstat(current);
    if (info.isSymbolicLink()) refuse('input');
    if (current !== file) {
      const stickyRoot = info.uid === 0 && (info.mode & 0o1000) !== 0;
      if (!info.isDirectory() || ![0, process.getuid?.()].includes(info.uid) || (info.mode & 0o022 && !stickyRoot)) refuse('input');
      ancestors.push({ path: current, ino: info.ino, dev: info.dev, uid: info.uid, mode: info.mode });
    }
  }
  const before = await lstat(file);
  if (!before.isFile() || before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0 || before.nlink !== 1 || before.size > 8 * 1024 * 1024) refuse('input');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat(); if (opened.ino !== before.ino || opened.dev !== before.dev) refuse('input');
    const bytes = await handle.readFile(); const after = await handle.stat(); const currentFile = await lstat(file);
    if (after.size !== before.size || bytes.length !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || currentFile.ino !== before.ino || currentFile.dev !== before.dev) refuse('input');
    for (const parent of ancestors) { const info = await lstat(parent.path); if (info.isSymbolicLink() || !info.isDirectory() || info.ino !== parent.ino || info.dev !== parent.dev || info.uid !== parent.uid || info.mode !== parent.mode) refuse('input'); }
    if (await realpath(file) !== file) refuse('input');
    return bytes.toString('utf8');
  } finally { await handle.close(); }
}
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const DIAGNOSTICS = Object.freeze({
  config: ['VSBASE_CONFIG_INVALID', 'config'], schema: ['VSBASE_SCHEMA_INVALID', 'schema'], input: ['VSBASE_INPUT_INVALID', 'input'],
  path: ['VSBASE_PATH_REFUSED', 'path'], sensitive_filename: ['VSBASE_SENSITIVE_FILENAME_REFUSED', 'sensitive_filename'],
  sensitive_content: ['VSBASE_SENSITIVE_CONTENT_REFUSED', 'sensitive_content'], hash: ['VSBASE_HASH_MISMATCH', 'hash'],
  stale_source: ['VSBASE_SOURCE_CHANGED', 'stale_source'],
  output_ownership: ['VSBASE_OUTPUT_OWNERSHIP_FAILED', 'output_ownership'], unexpected: ['VSBASE_UNEXPECTED_FAILURE', 'unexpected'],
});
export class BaselinePreparationError extends Error {
  constructor(kind = 'input') {
    const [code, stage] = DIAGNOSTICS[kind] ?? DIAGNOSTICS.unexpected;
    super('Reviewed baseline preparation failed.');
    this.name = 'BaselinePreparationError'; this.code = code; this.stage = stage;
  }
}
function refuse(kind = 'input') { throw new BaselinePreparationError(kind); }
function safePath(name, overlay, publicTemplate = false) {
  const parts = name.split('/');
  if (path.isAbsolute(name) || /[\\:\x00-\x1f\x7f]/.test(name) || parts.some(p => !p || p === '.' || p === '..' || p.startsWith('-'))) refuse('path');
  const isAllowedTemplate = publicTemplate && name === '.env.example';
  if (parts.some(p => (/^\.env(?:\.|$)/i.test(p) || /^\.envrc(?:\.|$)/i.test(p) || /\.(pem|key|p12|pfx)$/i.test(p)) && !isAllowedTemplate) || parts.some(p => ['.git', '.codex', '.aws', '.ssh', '.vibe'].includes(p.toLowerCase()))) refuse('sensitive_filename');
  if (overlay && parts.some(p => ['.agents', 'agents.md', 'claude.md', 'gemini.md', '.vibeignore'].includes(p.toLowerCase()))) refuse('path');
}
function safeContent(bytes, textOnly = false, publicTemplate = false) {
  if (bytes.length > MAX_FILE || (textOnly && (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)))) refuse('sensitive_content');
  const patch = 'diff --git a/file b/file\n@@ -0,0 +1 @@\n' + bytes.toString('utf8').split('\n').map(l => '+' + l).join('\n');
  if (patchContainsCredential(patch, environmentSecrets())) refuse('sensitive_content');
  if (publicTemplate) validatePublicDotenv(bytes);
}
function validatePublicDotenv(bytes) {
  if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)) refuse('sensitive_content');
  const text = bytes.toString('utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      const comment = trimmed.slice(1).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(comment) || /:\/\/[^\s@]*@/.test(comment)) refuse('sensitive_content');
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) refuse('sensitive_content');
    const key = match[1]; const value = match[2].trim();
    const placeholder = /^(?:\$\{(?:[A-Za-z_][A-Za-z0-9_]{0,63}|\.\.\.)\}|<[A-Z_][A-Z0-9_]{0,63}>|YOUR_[A-Z0-9_]{1,60})$/.test(value);
    const publicLiteral = /^(?:true|false|development|production|test|debug|info|warn|error)$/i.test(value);
    if (value !== '' && !placeholder && !publicLiteral) refuse('sensitive_content');
    if (/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CREDENTIAL)/i.test(key) && value !== '' && !placeholder) refuse('sensitive_content');
  }
}
async function noLinks(root, relative, missing = false) {
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    try { const st = await lstat(current); if (st.isSymbolicLink()) refuse('path'); }
    catch (error) { if (missing && error.code === 'ENOENT') return; throw error; }
  }
}
async function sourceBytes(root, relative, publicTemplate = false) {
  await noLinks(root, relative);
  const file = path.join(root, relative);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE) refuse();
    const bytes = await handle.readFile(); if (await realpath(file) !== file) refuse(); const after = await handle.stat(); const current = await lstat(file);
    if (before.ino !== current.ino || before.dev !== current.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.size !== bytes.length) refuse();
    safeContent(bytes, true, publicTemplate); return bytes;
  } finally { await handle.close(); }
}
async function validateDeletedSourcePath(root, relative, entries) {
  const parts = relative.split('/'); let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info;
    try { info = await lstat(current); } catch (error) {
      if (error.code === 'ENOENT') return;
      if (error.code === 'ENOTDIR' && entries.some(entry => entry.operation !== 'delete' && entry.path === parts.slice(0, index).join('/'))) return;
      throw error;
    }
    if (info.isSymbolicLink()) refuse('path');
    if (index < parts.length - 1) {
      if (!info.isDirectory()) {
        if (entries.some(entry => entry.operation !== 'delete' && entry.path === parts.slice(0, index + 1).join('/'))) return;
        refuse('path');
      }
      continue;
    }
    if (info.isDirectory()) { await validateReplacementDirectory(root, relative, entries); return; }
    refuse('path');
  }
}
async function validateReplacementDirectory(root, relative, entries) {
  const prefix = `${relative}/`;
  const expectedFiles = new Set(entries.filter(entry => entry.operation !== 'delete' && entry.path.startsWith(prefix)).map(entry => entry.path));
  if (!expectedFiles.size) refuse('path');
  const expectedDirectories = new Set();
  for (const file of expectedFiles) {
    const parts = file.slice(0, file.lastIndexOf('/')).split('/');
    for (let length = 1; length <= parts.length; length += 1) expectedDirectories.add(parts.slice(0, length).join('/'));
  }
  const seenFiles = new Set(); let walkedEntries = 0;
  const walk = async currentRelative => {
    const directory = await opendir(path.join(root, currentRelative));
    for await (const item of directory) {
      walkedEntries += 1; if (walkedEntries > 4096) refuse('path');
      const child = `${currentRelative}/${item.name}`; const info = await lstat(path.join(root, child));
      if (info.isSymbolicLink()) refuse('path');
      if (info.isDirectory()) { if (!expectedDirectories.has(child)) refuse('path'); await walk(child); }
      else if (info.isFile() && info.nlink === 1 && expectedFiles.has(child)) seenFiles.add(child);
      else refuse('path');
    }
  };
  await walk(relative);
  if (seenFiles.size !== expectedFiles.size) refuse('path');
}

async function sourceInvariants(source, entries) {
  const head = (await git(source, ['rev-parse', '--verify', 'HEAD'])).toString('utf8').trim();
  const indexPath = (await git(source, ['rev-parse', '--git-path', 'index'])).toString('utf8').trim();
  const absoluteIndex = path.isAbsolute(indexPath) ? indexPath : path.resolve(source, indexPath);
  let indexSha256 = null;
  let indexInfo;
  try {
    indexInfo = await lstat(absoluteIndex);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (indexInfo) {
    if (!indexInfo.isFile() || indexInfo.isSymbolicLink() || indexInfo.size > 64 * 1024 * 1024) refuse('path');
    const handle = await open(absoluteIndex, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat(); const bytes = await handle.readFile(); const after = await handle.stat(); const current = await lstat(absoluteIndex);
      if (!before.isFile() || before.ino !== current.ino || before.dev !== current.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.length !== after.size) refuse('stale_source');
      indexSha256 = digest(bytes);
    } finally { await handle.close(); }
  }
  const refs = (await git(source, ['for-each-ref', '--format=%(refname) %(objectname)'])).toString('utf8').trim().split('\n').filter(Boolean).sort();
  const selected = [];
  for (const item of entries) {
    if (item.operation === 'delete') {
      let kind = 'missing';
      try { const info = await lstat(path.join(source, item.path)); kind = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'; }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      selected.push({ path: item.path, operation: item.operation, kind, reviewed_sha256: null });
    } else {
      const bytes = await sourceBytes(source, item.path, item.path === '.env.example');
      const info = await lstat(path.join(source, item.path));
      selected.push({ path: item.path, operation: item.operation, kind: 'file', reviewed_sha256: digest(bytes), mode: (info.mode & 0o111) ? '100755' : '100644' });
    }
  }
  return { head, index_sha256: indexSha256, refs_sha256: digest(Buffer.from(refs.join('\n'))), selected };
}
async function pruneSnapshotEmptyParents(repo, relative) {
  let directory = path.dirname(path.join(repo, relative));
  while (directory !== repo && isPathWithinRoot(repo, directory)) {
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) break;
      await rmdir(directory);
    } catch (error) {
      if (error.code === 'ENOENT') { directory = path.dirname(directory); continue; }
      if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST') break;
      refuse('output_ownership');
    }
    directory = path.dirname(directory);
  }
}
async function prepareReviewedBaselineInner(value, allowedRoots, create = false, expectedManifestSha256, configuration) {
  let input;
  try { input = baselineInputSchema.parse(value); } catch { refuse('schema'); }
  const templates = new Map((input.publicTemplates ?? []).map(template => [template.path, template.sha256]));
  if (!path.isAbsolute(input.source) || !path.isAbsolute(input.outputParent)) refuse('path');
  let source; let parent;
  try { source = await resolveCanonicalRoot(input.source, allowedRoots); parent = await resolveCanonicalRoot(input.outputParent, allowedRoots); }
  catch { refuse('path'); }
  if (source !== path.resolve(input.source) || parent !== path.resolve(input.outputParent) || isPathWithinRoot(source, parent)) refuse('path');
  await noLinks(path.parse(source).root, source.slice(path.parse(source).root.length));
  await noLinks(path.parse(parent).root, parent.slice(path.parse(parent).root.length));
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.uid !== process.getuid?.() || parentInfo.mode & 0o077) refuse('output_ownership');
  try { if (await resolveGitRoot(source) !== source) refuse('path'); } catch (error) { if (error instanceof BaselinePreparationError) throw error; refuse('path'); }
  assertSimpleGlobRoot(source); await assertNoProjectVibeExtensions(source);
  const filters = await git(source, ['config', '--local', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], [0, 1]);
  if (filters.length) refuse();
  const base = await resolveBaseCommit(source, input.baseRef);
  const list = (await git(source, ['ls-tree', '-r', '-z', base])).toString('utf8').split('\0').filter(Boolean);
  if (list.length > 4096) refuse();
  const files = new Map(); const folded = new Set(); let total = 0;
  for (const record of list) {
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(record); if (!match) refuse('path');
    const name = match[3]; const isTemplate = templates.has(name); safePath(name, false, isTemplate);
    if (folded.has(name.toLowerCase())) refuse('path'); folded.add(name.toLowerCase());
    const bytes = await git(source, ['cat-file', 'blob', match[2]]); safeContent(bytes, false, isTemplate); total += bytes.length;
    if (total > MAX_TREE) refuse(); files.set(name, { name, mode: match[1], bytes });
  }
  const selected = new Set(); const selectedBytes = new Map();
  for (const e of input.entries) {
    safePath(e.path, true, templates.has(e.path));
    if (selected.has(e.path.toLowerCase())) refuse(); selected.add(e.path.toLowerCase());
    const original = files.get(e.path);
    if ((original ? digest(original.bytes) : null) !== e.baseSha256 || (e.operation === 'add') !== !original) refuse('hash');
    if (!original && folded.has(e.path.toLowerCase())) refuse('path');
    if ((e.operation === 'delete') !== (e.reviewedSha256 === null) || (e.operation !== 'delete' && !e.mode)) refuse('input');
    if ((await git(source, ['check-ignore', '--no-index', '--', e.path], [0, 1])).length) refuse();
    if (e.operation === 'delete') {
      await validateDeletedSourcePath(source, e.path, input.entries);
    } else {
      const isTemplate = templates.has(e.path); const bytes = await sourceBytes(source, e.path, isTemplate);
      if (digest(bytes) !== e.reviewedSha256) refuse('hash');
      const st = await lstat(path.join(source, e.path)); if (((st.mode & 0o111) ? '100755' : '100644') !== e.mode) refuse();
      selectedBytes.set(e.path, bytes);
    }
  }
  for (const [templatePath, expectedHash] of templates) {
    const item = input.entries.find(e => e.path === templatePath);
    const baseFile = files.get(templatePath);
    if (item?.operation === 'delete') refuse('sensitive_filename');
    const effectiveBytes = item ? selectedBytes.get(templatePath) : baseFile?.bytes;
    if (!effectiveBytes) refuse('sensitive_filename');
    if (digest(effectiveBytes) !== expectedHash) refuse('hash');
    validatePublicDotenv(effectiveBytes);
  }
  const checkSource = async () => {
    for (const e of input.entries) {
      if (e.operation === 'delete') await validateDeletedSourcePath(source, e.path, input.entries);
      else { if (digest(await sourceBytes(source, e.path)) !== e.reviewedSha256) refuse('hash'); const st = await lstat(path.join(source, e.path)); if (((st.mode & 0o111) ? '100755' : '100644') !== e.mode) refuse('input'); }
    }
  };
  let sourceState;
  try { sourceState = await sourceInvariants(source, input.entries); } catch (error) { if (error instanceof BaselinePreparationError) throw error; refuse('stale_source'); }
  const finalPaths = new Set(files.keys()); let finalSize = total;
  for (const e of input.entries) {
    finalSize -= files.get(e.path)?.bytes.length ?? 0;
    if (e.operation === 'delete') finalPaths.delete(e.path);
    else { finalPaths.add(e.path); finalSize += selectedBytes.get(e.path).length; }
  }
  if (finalSize > MAX_TREE || finalPaths.size > 4096) refuse();
  for (const name of finalPaths) { const parts = name.split('/'); parts.pop(); while (parts.length) { if (finalPaths.has(parts.join('/'))) refuse(); parts.pop(); } }
  await checkSource();
  const provenance = { schema_version: 1, original_source: source, original_base: base, source_invariants: sourceState, entries: input.entries,
    ...(input.publicTemplates?.length ? { public_templates: input.publicTemplates.map(t => ({ path: t.path, sha256: t.sha256, opted_in: true })) } : {}) };
  const manifestSha256 = digest(Buffer.from(JSON.stringify({ ...provenance, ...(configuration ? { configuration } : {}) })));
  if (expectedManifestSha256 && expectedManifestSha256 !== manifestSha256) refuse('stale_source');
  if (!create) return { status: 'validated_dry_run', ...provenance, ...(configuration ? { configuration } : {}), manifest_sha256: manifestSha256, creates_snapshot_commit: true };
  let output;
  try { output = await mkdtemp(path.join(parent, 'reviewed-baseline-')); } catch { refuse('output_ownership'); }
  const repo = path.join(output, 'repo');
  try {
    try { await mkdir(repo, { mode: 0o700 }); } catch { refuse('output_ownership'); }
    await git(repo, ['-c', 'init.templateDir=', 'init', '--quiet']);
    const write = async (f) => {
      await mkdir(path.dirname(path.join(repo, f.name)), { recursive: true, mode: 0o700 });
      await createPrivateFile(path.join(repo, f.name), f.bytes); await chmod(path.join(repo, f.name), f.mode === '100755' ? 0o700 : 0o600);
    };
    for (const f of files.values()) await write(f);
    const stage = async (names) => { for (let i = 0; i < names.length; i += 100) await git(repo, ['add', '--force', '--', ...names.slice(i, i + 100)]); };
    const commit = async (message) => { await git(repo, ['-c', 'user.name=Supervisor snapshot', '-c', 'user.email=snapshot@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.filemode=true', 'commit', '--quiet', '--allow-empty', '-m', message]); };
    await stage([...files.keys()]); await commit('Declared original baseline');
    for (const e of input.entries.filter(entry => entry.operation === 'delete')) { await rm(path.join(repo, e.path)); files.delete(e.path); }
    for (const e of input.entries.filter(entry => entry.operation === 'delete')) await pruneSnapshotEmptyParents(repo, e.path);
    for (const e of input.entries.filter(entry => entry.operation !== 'delete')) {
      const f = { name: e.path, mode: e.mode, bytes: selectedBytes.get(e.path) };
      const target = path.join(repo, e.path);
      const targetInfo = await lstat(target).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (targetInfo?.isDirectory()) {
        try { await rmdir(target); } catch { refuse('output_ownership'); }
      } else if (targetInfo) await rm(target);
      await write(f); files.set(e.path, f);
    }
    await stage(input.entries.map(e => e.path)); await commit('Reviewed effective baseline');
    await checkSource();
    const afterSourceState = await sourceInvariants(source, input.entries);
    if (JSON.stringify(afterSourceState) !== JSON.stringify(sourceState)) refuse('stale_source');
    const verifiedSnapshot = await resolveBaseCommit(repo);
    for (const f of files.values()) {
      const h = await open(path.join(repo, f.name), constants.O_RDONLY | constants.O_NOFOLLOW); try { const actual = await h.readFile(); if (digest(actual) !== digest(f.bytes)) refuse('output_ownership'); if (templates.has(f.name)) { if (digest(actual) !== templates.get(f.name)) refuse('hash'); validatePublicDotenv(actual); } } finally { await h.close(); }
    }
    const snapshotTree = (await git(repo, ['ls-tree', '-r', '-z', verifiedSnapshot])).toString('utf8').split('\0').filter(Boolean).map(record => {
      const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(record); if (!match) refuse('output_ownership');
      return { mode: match[1], oid: match[2], path: match[3] };
    }).sort((a, b) => a.path.localeCompare(b.path));
    const expectedTree = [...files.values()].map(f => ({ mode: f.mode, oid: null, path: f.name })).sort((a, b) => a.path.localeCompare(b.path));
    if (snapshotTree.length !== expectedTree.length || snapshotTree.some((actual, index) => {
      const expected = expectedTree[index]; if (!expected || actual.path !== expected.path || actual.mode !== expected.mode) return true;
      return false;
    })) refuse('output_ownership');
    for (const actual of snapshotTree) {
      const expected = files.get(actual.path); if (!expected) refuse('output_ownership');
      const blob = await git(repo, ['cat-file', 'blob', actual.oid]);
      if (digest(blob) !== digest(expected.bytes)) refuse('output_ownership');
    }
    if ((await git(repo, ['status', '--porcelain'])).length) refuse();
    const body = { status: 'prepared', ...provenance, ...(configuration ? { configuration } : {}), source_workspace: repo, base_ref: verifiedSnapshot, files: [...files.values()].map(f => ({ path: f.name, sha256: digest(f.bytes), mode: f.mode })) };
    const report = { ...body, manifest_sha256: digest(Buffer.from(JSON.stringify(body))) };
    await createPrivateFile(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n'); await chmod(path.join(output, 'manifest.json'), 0o400);
    return { ...report, manifest_path: path.join(output, 'manifest.json') };
  } catch (error) {
    const diagnostic = error instanceof BaselinePreparationError ? error : new BaselinePreparationError('unexpected');
    diagnostic.retained_output_id = path.basename(output);
    let receiptWritten = false;
    diagnostic.retained_output_path = output;
    try { await createPrivateFile(path.join(output, 'failure.json'), JSON.stringify({ status: 'preparation_failed', source_preserved: true, code: diagnostic.code, stage: diagnostic.stage, retained_output_id: diagnostic.retained_output_id, retained_output_path: output, output_disposition: 'retained' }) + '\n'); receiptWritten = true; } catch { /* report the retained resource even when the receipt itself could not be written */ }
    diagnostic.output_disposition = receiptWritten ? 'retained_with_failure_receipt' : 'retained_without_failure_receipt';
    throw diagnostic;
  }
}

export async function prepareReviewedBaseline(value, allowedRoots, create = false, expectedManifestSha256, configuration) {
  try { return await prepareReviewedBaselineInner(value, allowedRoots, create, expectedManifestSha256, configuration); }
  catch (error) { if (error instanceof BaselinePreparationError) throw error; throw new BaselinePreparationError('unexpected'); }
}

export const baselineUsage = 'Usage: prepare-reviewed-baseline.mjs manifest.json [--config <path>] [--create --expect-manifest-sha256 <dry-run-sha256>]. Default: dry-run. --create requires the matching dry-run receipt hash, then writes private snapshot commits in a disposable repository; it never stages, commits, or changes refs in the original source repository.';
export async function baselineCommand(args) {
  if (args.length === 1 && args[0] === '--help') return { status: 'help', usage: baselineUsage };
  if (args[0] === '--help') throw new BaselinePreparationError('input');
  const file = args[0]; let create = false; let configPath; let expectedManifest;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--create') { if (create) throw new BaselinePreparationError('input'); create = true; }
    else if (arg === '--config' || arg === '--expect-manifest-sha256') {
      const value = args[++index]; if (!value || value.startsWith('--')) throw new BaselinePreparationError('input');
      if (arg === '--config') { if (configPath) throw new BaselinePreparationError('input'); configPath = value; }
      else { if (expectedManifest) throw new BaselinePreparationError('input'); expectedManifest = value; }
    } else throw new BaselinePreparationError('input');
  }
  if (!file || (expectedManifest && !/^[a-f0-9]{64}$/.test(expectedManifest))) throw new BaselinePreparationError('input');
  if ((expectedManifest && !create) || (create && !expectedManifest)) throw new BaselinePreparationError('input');
  let resolved; let selectedConfigPath;
  try {
    try {
      const explicitPath = configPath ? path.resolve(configPath) : undefined;
      selectedConfigPath = resolveConfigSelection(explicitPath).configPath;
      resolved = await loadResolvedConfig(explicitPath ? { configPath: explicitPath } : {});
    } catch { const error = new BaselinePreparationError('config'); if (selectedConfigPath) error.config_path = selectedConfigPath; throw error; }
    let raw;
    try { raw = JSON.parse(await readPrivateInput(path.resolve(file))); } catch { throw new BaselinePreparationError('input'); }
    const localProvenance = { executable: process.execPath, application_version: APP_VERSION, compiled_runtime: path.resolve(distRoot), config_path: resolved.configPath, config_source: resolved.source, config_fingerprint: resolved.fingerprint, data_directory: resolved.dataDir, vibe_configured_path: resolved.config.paths?.vibe ?? null, vibe_supported_version: SUPPORTED_VIBE };
    return await prepareReviewedBaseline(raw, resolved.config.allowedWorkspaceRoots, create, expectedManifest, localProvenance);
  } catch (error) { if (error instanceof BaselinePreparationError) throw error; throw new BaselinePreparationError('unexpected'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try { console.log(JSON.stringify(await baselineCommand(process.argv.slice(2)), null, 2)); }
  catch (error) {
    const diagnostic = error instanceof BaselinePreparationError ? error : new BaselinePreparationError('unexpected');
    console.error(JSON.stringify({ status: 'preparation_failed', code: diagnostic.code, stage: diagnostic.stage, source_preserved: true, ...(diagnostic.config_path ? { config_path: diagnostic.config_path } : {}), ...(diagnostic.retained_output_id ? { retained_output_id: diagnostic.retained_output_id, retained_output_path: diagnostic.retained_output_path, output_disposition: diagnostic.output_disposition } : {}) })); process.exitCode = 1;
  }
}
