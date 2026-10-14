import path from 'node:path';
import { constants } from 'node:fs';
import { access, lstat, open, opendir, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { supervisorError } from '../../contracts.js';
import { resolveCommand } from '../launcher.js';
import { SUPPORTED_VIBE } from '../pinned.js';

const manifestSchema = z.object({
  format: z.literal(1), vibe_version: z.literal(SUPPORTED_VIBE), platform: z.literal('darwin'),
  architecture: z.literal('arm64'), python: z.literal('3.12'),
  source_commit: z.string().regex(/^[a-f0-9]{40}$/),
  wheel: z.object({ filename: z.string(), url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  dependencies: z.record(z.string().regex(/^[a-z0-9-]+$/), z.string().min(1).max(128)),
  files: z.record(z.string().min(1).max(4096), z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();

export type CompatibilityManifest = z.infer<typeof manifestSchema>;
export interface VerifiedInstallation { executable: string; interpreter: string; siteRoot: string; filesChecked: number; version: string }

function refused(reason: string): never {
  throw supervisorError('VSUP_VIBE_VERSION_UNSUPPORTED', 'The pinned app-server installation could not be verified. No Vibe session was started.', { reason });
}

async function regular(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o022) !== 0) refused('unsafe_runtime_file');
}

async function digestFile(file: string): Promise<string> {
  await regular(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 268_435_456) refused('runtime_file_limit');
    const digest = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 1_048_576 })) {
      const data = Buffer.from(chunk as Buffer); bytes += data.length;
      if (bytes > 268_435_456) refused('runtime_file_limit');
      digest.update(data);
    }
    const after = await handle.stat(); const named = await lstat(file);
    if (bytes !== before.size || after.size !== before.size || after.ctimeMs !== before.ctimeMs || after.mtimeMs !== before.mtimeMs || named.ino !== before.ino || named.dev !== before.dev || named.isSymbolicLink()) refused('runtime_file_changed');
    return digest.digest('hex');
  } finally { await handle.close(); }
}

export async function loadCompatibilityManifest(): Promise<CompatibilityManifest> {
  const file = new URL('./vibe-2.26.1-macos-arm64.json', import.meta.url);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576) refused('unsafe_compatibility_manifest');
  const manifest = manifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  if (Object.keys(manifest.files).length > 4096 || !manifest.files['mistralai_vibe_local_harness/_native.abi3.so'] || !manifest.files['vibe/app_server/protocol.py']) refused('incomplete_compatibility_manifest');
  return manifest;
}

/** Compare bytes against the published wheel, never against installation-generated expectations. */
export async function verifySite(siteRoot: string, manifest: CompatibilityManifest): Promise<number> {
  if (await realpath(siteRoot) !== siteRoot || !(await lstat(siteRoot)).isDirectory()) refused('unsafe_site_root');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (relative.includes('\\') || path.posix.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '' || part === '.')) refused('unsafe_manifest_path');
    if (await realpath(path.dirname(path.join(siteRoot, relative))) !== path.dirname(path.join(siteRoot, relative))) refused('symlinked_runtime_directory');
    if (await digestFile(path.join(siteRoot, relative)) !== expected) refused('runtime_hash_mismatch');
  }
  let seen = 0;
  const directories = ['vibe', 'mistralai_vibe_local_harness'];
  for (let index = 0; index < directories.length; index++) {
    const directory = directories[index] as string;
    const handle = await opendir(path.join(siteRoot, directory));
    for await (const entry of handle) {
      if (++seen > 20_000) refused('runtime_inventory_limit');
      if (entry.isSymbolicLink()) refused('symlinked_runtime_entry');
      const relative = directory + '/' + entry.name;
      if (entry.isDirectory()) { if (entry.name !== '__pycache__') directories.push(relative); }
      else if (!entry.isFile() || !(relative in manifest.files)) refused('unexpected_runtime_file');
    }
  }
  const found = new Set<string>();
  const entries = await opendir(siteRoot);
  for await (const entry of entries) {
    if (++seen > 20_000) refused('runtime_inventory_limit');
    if (!entry.name.endsWith('.dist-info')) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) refused('unsafe_dependency_metadata');
    const file = path.join(siteRoot, entry.name, 'METADATA');
    await regular(file);
    if ((await lstat(file)).size > 1_048_576) refused('dependency_metadata_limit');
    const metadata = await readFile(file, 'utf8');
    const rawName = /^Name: ([^\r\n]+)$/m.exec(metadata)?.[1];
    const version = /^Version: ([^\r\n]+)$/m.exec(metadata)?.[1];
    if (!rawName || !version) refused('invalid_dependency_metadata');
    const name = rawName.toLowerCase().replace(/[-_.]+/g, '-');
    const expected = manifest.dependencies[name];
    if (expected === undefined) continue;
    if (found.has(name) || version !== expected) refused('dependency_version_mismatch');
    found.add(name);
  }
  if (found.size !== Object.keys(manifest.dependencies).length) refused('missing_pinned_dependency');
  return Object.keys(manifest.files).length;
}

export async function verifyInstallation(command: string): Promise<VerifiedInstallation> {
  const manifest = await loadCompatibilityManifest();
  if (process.platform !== manifest.platform || process.arch !== manifest.architecture) refused('unsupported_platform');
  const executable = await realpath(await resolveCommand(command, process.env));
  await regular(executable); await access(executable, constants.X_OK);
  const handle = await open(executable, constants.O_RDONLY | constants.O_NOFOLLOW);
  let header: string;
  try {
    const bytes = Buffer.alloc(4096); const result = await handle.read(bytes, 0, bytes.length, 0);
    header = bytes.subarray(0, result.bytesRead).toString('utf8').split('\n', 1)[0] ?? '';
  } finally { await handle.close(); }
  const interpreter = /^#!(\/[^\r\n\s]+\/python(?:3(?:\.12)?)?)$/.exec(header)?.[1];
  if (!interpreter || path.dirname(interpreter) !== path.dirname(executable)) refused('unsupported_interpreter_layout');
  await access(interpreter, constants.X_OK);
  const siteRoot = path.join(path.dirname(path.dirname(executable)), 'lib', 'python3.12', 'site-packages');
  const filesChecked = await verifySite(siteRoot, manifest);
  return { executable, interpreter, siteRoot, filesChecked, version: manifest.vibe_version };
}
