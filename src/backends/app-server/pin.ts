import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isPathWithinRoot } from '../../security/paths.js';
import { SUPPORTED_VIBE } from './supported-vibe.js';

export type PinFailureReason =
  | 'executable-invalid' | 'executable-missing' | 'shebang-unreadable' | 'shebang-unsupported'
  | 'interpreter-missing' | 'environment-unsupported' | 'environment-mismatch'
  | 'dist-info-missing' | 'dist-info-ambiguous' | 'version-unreadable' | 'version-mismatch'
  | 'record-unreadable' | 'record-malformed' | 'record-mismatch'
  | 'manifest-unreadable' | 'manifest-invalid' | 'manifest-version-mismatch'
  | 'script-unlisted' | 'file-missing' | 'file-extra' | 'file-mismatch' | 'file-unsafe'
  | 'limit-exceeded';

export class PinCheckError extends Error {
  readonly code: 'VSUP_VIBE_NOT_FOUND' | 'VSUP_VIBE_VERSION_UNSUPPORTED';
  constructor(readonly reason: PinFailureReason, message: string, readonly details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'PinCheckError';
    this.code = reason === 'executable-missing' || reason === 'interpreter-missing' ? 'VSUP_VIBE_NOT_FOUND' : 'VSUP_VIBE_VERSION_UNSUPPORTED';
  }
}

export interface PinLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxRecordBytes: number;
  maxManifestBytes: number;
}

export const DEFAULT_PIN_LIMITS: PinLimits = {
  maxFiles: 20_000,
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxRecordBytes: 4 * 1024 * 1024,
  maxManifestBytes: 8 * 1024 * 1024,
};

const MAX_SCRIPT_BYTES = 4096;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_LISTED_PATHS = 20;
const READ_CHUNK_BYTES = 1024 * 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const manifestSchema = z.strictObject({
  format: z.literal(1),
  version: z.string().min(1).max(64),
  record_sha256: z.string().regex(SHA256_HEX),
  files: z.record(z.string().min(1).max(1024), z.string().regex(SHA256_HEX)),
});

export type PinManifest = z.infer<typeof manifestSchema>;

export interface LocatedEnvironment {
  environmentRoot: string;
  executable: string;
  sitePackages: string;
  distInfo: string;
  version: string;
}

export interface PinnedEnvironment extends LocatedEnvironment {
  fileCount: number;
  totalBytes: number;
  recordSha256: string;
}

export interface PinCheckOptions {
  executable: string;
  manifest?: PinManifest;
  manifestPath?: string;
  expectedVersion?: string;
  limits?: Partial<PinLimits>;
  signal?: AbortSignal;
}

interface RecordEntry {
  relative: string;
  absolute: string;
}

type FileProblemKind = 'missing' | 'unsafe' | 'too-large';

class FileProblem extends Error {
  constructor(readonly kind: FileProblemKind) {
    super(kind);
  }
}

function resolveLimits(partial: Partial<PinLimits> | undefined): PinLimits {
  const limits = { ...DEFAULT_PIN_LIMITS, ...partial };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  return limits;
}

function limited(list: readonly string[]): { paths: string[]; total: number } {
  return { paths: list.slice(0, MAX_LISTED_PATHS), total: list.length };
}

async function openRegular(file: string): Promise<FileHandle> {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new FileProblem(code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unsafe');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FileProblem('unsafe');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readBounded(file: string, maxBytes: number): Promise<Buffer> {
  const handle = await openRegular(file);
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new FileProblem('too-large');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

async function readHead(file: string, maxBytes: number): Promise<string> {
  const handle = await openRegular(file);
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

async function hashRegular(file: string, maxFileBytes: number, remainingBytes: number): Promise<{ sha256: string; size: number }> {
  const handle = await openRegular(file);
  try {
    const cap = Math.min(maxFileBytes, remainingBytes);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let size = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > cap) throw new FileProblem('too-large');
      hash.update(buffer.subarray(0, bytesRead));
    }
    return { sha256: hash.digest('hex'), size };
  } finally { await handle.close(); }
}

function sha256Of(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function parseShebang(head: string): string | undefined {
  const lines = head.split('\n');
  const first = lines[0] ?? '';
  if (!first.startsWith('#!')) return undefined;
  if (first === '#!/bin/sh') {
    const match = /^'''exec' (?:"([^"\n]+)"|(\S+)) "\$0" "\$@"$/.exec(lines[1] ?? '');
    return match ? (match[1] ?? match[2]) : undefined;
  }
  const interpreter = first.slice(2);
  return interpreter && !/\s/.test(interpreter) ? interpreter : undefined;
}

export async function locateEnvironment(executable: string, expectedVersion: string = SUPPORTED_VIBE, limits?: Partial<PinLimits>): Promise<LocatedEnvironment> {
  resolveLimits(limits);
  if (typeof executable !== 'string' || !path.isAbsolute(executable) || executable.includes('\0')) {
    throw new PinCheckError('executable-invalid', 'The vibe-app-server executable must be an absolute path.');
  }
  let script: string;
  try { script = await realpath(executable); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new PinCheckError(code === 'ENOENT' ? 'executable-missing' : 'executable-invalid', 'The vibe-app-server executable cannot be resolved.', { code });
  }
  let headText: string;
  try { headText = await readHead(script, MAX_SCRIPT_BYTES); }
  catch { throw new PinCheckError('shebang-unreadable', 'The vibe-app-server script cannot be read as a regular file.'); }
  const interpreter = parseShebang(headText);
  if (interpreter === undefined || !path.isAbsolute(interpreter) || path.normalize(interpreter) !== interpreter) {
    throw new PinCheckError('shebang-unsupported', 'The vibe-app-server script must start with an absolute interpreter path.');
  }
  if (!/^python3?(\.\d+)?$/.test(path.basename(interpreter)) || path.basename(path.dirname(interpreter)) !== 'bin') {
    throw new PinCheckError('shebang-unsupported', 'The interpreter must be a python executable in a bin directory.');
  }
  try { await stat(interpreter); }
  catch { throw new PinCheckError('interpreter-missing', 'The interpreter named by the vibe-app-server script does not exist.'); }
  let environmentRoot: string;
  try { environmentRoot = await realpath(path.dirname(path.dirname(interpreter))); }
  catch { throw new PinCheckError('interpreter-missing', 'The interpreter environment does not exist.'); }
  try {
    const info = await lstat(path.join(environmentRoot, 'pyvenv.cfg'));
    if (!info.isFile()) throw new Error('not a file');
  } catch { throw new PinCheckError('environment-unsupported', 'The interpreter is not in a virtual environment (no pyvenv.cfg).'); }
  if (path.dirname(script) !== path.join(environmentRoot, 'bin')) {
    throw new PinCheckError('environment-mismatch', 'The vibe-app-server script is not in the bin directory of the environment its shebang names.');
  }

  const libDirectory = path.join(environmentRoot, 'lib');
  let pythonDirectories: string[];
  try { pythonDirectories = (await readdir(libDirectory)).filter((name) => /^python3\.\d+$/.test(name)); }
  catch { throw new PinCheckError('dist-info-missing', 'The environment has no lib directory.'); }
  const found: Array<{ sitePackages: string; distInfo: string; name: string }> = [];
  for (const pythonDirectory of pythonDirectories.sort()) {
    const sitePackages = path.join(libDirectory, pythonDirectory, 'site-packages');
    let names: string[];
    try { names = await readdir(sitePackages); } catch { continue; }
    if (names.length > MAX_DIRECTORY_ENTRIES * 10) throw new PinCheckError('limit-exceeded', 'The site-packages directory is unreasonably large.');
    for (const name of names) {
      if (/^mistral[-_.]vibe-[^-]+\.dist-info$/i.test(name)) found.push({ sitePackages, distInfo: path.join(sitePackages, name), name });
    }
  }
  if (found.length === 0) throw new PinCheckError('dist-info-missing', 'No mistral_vibe dist-info directory was found in the environment.');
  if (found.length > 1) throw new PinCheckError('dist-info-ambiguous', 'More than one mistral_vibe dist-info directory was found.', { names: found.map((entry) => entry.name) });
  const [entry] = found;
  if (!entry) throw new PinCheckError('dist-info-missing', 'No mistral_vibe dist-info directory was found in the environment.');
  try {
    if (await realpath(entry.distInfo) !== entry.distInfo || !(await lstat(entry.distInfo)).isDirectory()) throw new Error('not canonical');
  } catch { throw new PinCheckError('file-unsafe', 'The dist-info directory is not a canonical real directory.'); }

  const nameVersion = /^mistral[-_.]vibe-([^-]+)\.dist-info$/i.exec(entry.name)?.[1] ?? '';
  let metadataText: string;
  try { metadataText = (await readBounded(path.join(entry.distInfo, 'METADATA'), MAX_METADATA_BYTES)).toString('utf8'); }
  catch { throw new PinCheckError('version-unreadable', 'The METADATA file cannot be read.'); }
  const headers = metadataText.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const versions = headers.split(/\r?\n/).filter((line) => line.startsWith('Version:')).map((line) => line.slice('Version:'.length).trim());
  if (versions.length !== 1 || !versions[0]) throw new PinCheckError('version-unreadable', 'METADATA does not carry exactly one Version header.');
  if (nameVersion !== expectedVersion || versions[0] !== expectedVersion) {
    throw new PinCheckError('version-mismatch', `Installed mistral_vibe is not the pinned version ${expectedVersion}.`, { directory: nameVersion, metadata: versions[0], expected: expectedVersion });
  }
  return { environmentRoot, executable: script, sitePackages: entry.sitePackages, distInfo: entry.distInfo, version: versions[0] };
}

export function parseRecord(text: string): Array<{ path: string; hash: string; size: string }> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let fieldStarted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"' && !fieldStarted) { quoted = true; fieldStarted = true; }
    else if (char === ',') { row.push(field); field = ''; fieldStarted = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      if (fieldStarted || field !== '' || row.length > 0) { row.push(field); rows.push(row); }
      row = []; field = ''; fieldStarted = false;
    } else { field += char; fieldStarted = true; }
  }
  if (quoted) throw new PinCheckError('record-malformed', 'RECORD has an unterminated quoted field.');
  if (fieldStarted || field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.map((fields) => {
    if (fields.length !== 3) throw new PinCheckError('record-malformed', 'Every RECORD row must have exactly three fields.');
    return { path: fields[0] as string, hash: fields[1] as string, size: fields[2] as string };
  });
}

function isVolatile(relative: string, recordRelative: string): boolean {
  return relative === recordRelative || (relative.split('/').includes('__pycache__') && relative.endsWith('.pyc'));
}

async function readRecord(located: LocatedEnvironment, limits: PinLimits): Promise<{ recordSha256: string; entries: RecordEntry[]; listed: Set<string> }> {
  const recordFile = path.join(located.distInfo, 'RECORD');
  let data: Buffer;
  try { data = await readBounded(recordFile, limits.maxRecordBytes); }
  catch (error) {
    if (error instanceof FileProblem && error.kind === 'too-large') throw new PinCheckError('limit-exceeded', 'RECORD exceeds the size limit.');
    throw new PinCheckError('record-unreadable', 'RECORD cannot be read as a regular file.');
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new PinCheckError('record-malformed', 'RECORD is not valid UTF-8.'); }
  const rows = parseRecord(text);
  if (rows.length === 0) throw new PinCheckError('record-malformed', 'RECORD is empty.');
  if (rows.length > limits.maxFiles) throw new PinCheckError('limit-exceeded', 'RECORD lists more files than the limit.', { files: rows.length, limit: limits.maxFiles });
  const recordRelative = path.relative(located.sitePackages, recordFile).split(path.sep).join('/');
  const entries: RecordEntry[] = [];
  const listed = new Set<string>();
  for (const row of rows) {
    const relative = row.path;
    if (!relative || relative.includes('\0') || relative.includes('\\') || relative.startsWith('/') || relative.endsWith('/') || relative.split('/').some((segment) => segment === '' || segment === '.')) {
      throw new PinCheckError('record-malformed', 'RECORD lists a path that is not a normalized relative path.');
    }
    if (listed.has(relative)) throw new PinCheckError('record-malformed', 'RECORD lists the same path twice.');
    listed.add(relative);
    const absolute = path.join(located.sitePackages, relative);
    if (!isPathWithinRoot(located.environmentRoot, absolute)) throw new PinCheckError('file-unsafe', 'RECORD lists a path outside the environment.');
    if (isVolatile(relative, recordRelative)) continue;
    entries.push({ relative, absolute });
  }
  return { recordSha256: sha256Of(data), entries, listed };
}

interface HashOutcome {
  hashes: Map<string, string>;
  missing: string[];
  unsafe: string[];
  totalBytes: number;
}

async function hashEntries(entries: readonly RecordEntry[], limits: PinLimits, signal: AbortSignal | undefined): Promise<HashOutcome> {
  const outcome: HashOutcome = { hashes: new Map(), missing: [], unsafe: [], totalBytes: 0 };
  const canonicalDirectories = new Map<string, boolean>();
  for (const entry of entries) {
    signal?.throwIfAborted();
    const directory = path.dirname(entry.absolute);
    let canonical = canonicalDirectories.get(directory);
    if (canonical === undefined) {
      canonical = await realpath(directory).then((resolved) => resolved === directory, () => false);
      canonicalDirectories.set(directory, canonical);
    }
    if (!canonical) {
      const exists = await lstat(directory).then(() => true, () => false);
      (exists ? outcome.unsafe : outcome.missing).push(entry.relative);
      continue;
    }
    try {
      const { sha256, size } = await hashRegular(entry.absolute, limits.maxFileBytes, limits.maxTotalBytes - outcome.totalBytes);
      outcome.totalBytes += size;
      outcome.hashes.set(entry.relative, sha256);
    } catch (error) {
      if (!(error instanceof FileProblem)) throw error;
      if (error.kind === 'missing') outcome.missing.push(entry.relative);
      else if (error.kind === 'unsafe') outcome.unsafe.push(entry.relative);
      else throw new PinCheckError('limit-exceeded', 'The installed files exceed the byte limits.', { path: entry.relative, maxFileBytes: limits.maxFileBytes, maxTotalBytes: limits.maxTotalBytes });
    }
  }
  return outcome;
}

async function findUnlisted(located: LocatedEnvironment, listed: ReadonlySet<string>, limits: PinLimits): Promise<string[]> {
  const topLevel = new Set<string>();
  for (const relative of listed) {
    const segments = relative.split('/');
    if (segments.length > 1 && segments[0] !== '..') topLevel.add(segments[0] as string);
  }
  const extra: string[] = [];
  let visited = 0;
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(path.join(located.sitePackages, relative), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '__pycache__') continue;
      visited += 1;
      if (visited > limits.maxFiles * 2) throw new PinCheckError('limit-exceeded', 'The covered directories contain more entries than the limit.');
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(child);
      else if (!listed.has(child)) extra.push(child);
    }
  };
  for (const name of [...topLevel].sort()) {
    try { await walk(name); }
    catch (error) {
      if (error instanceof PinCheckError) throw error;
      throw new PinCheckError('file-unsafe', 'A covered directory cannot be scanned.', { directory: name });
    }
  }
  return extra.sort();
}

export async function loadPinManifest(file: string, limits?: Partial<PinLimits>): Promise<PinManifest> {
  const { maxManifestBytes } = resolveLimits(limits);
  let data: Buffer;
  try { data = await readBounded(await realpath(file), maxManifestBytes); }
  catch { throw new PinCheckError('manifest-unreadable', 'The pin manifest cannot be read as a bounded regular file.'); }
  return parsePinManifest(data.toString('utf8'));
}

export function parsePinManifest(text: string): PinManifest {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new PinCheckError('manifest-invalid', 'The pin manifest is not valid JSON.'); }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new PinCheckError('manifest-invalid', `The pin manifest is invalid at ${issue?.path.join('.') || 'the top level'}.`);
  }
  return result.data;
}

export function serializePinManifest(manifest: PinManifest): string {
  const files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ format: manifest.format, version: manifest.version, record_sha256: manifest.record_sha256, files }, null, 2)}\n`;
}

export async function generatePinManifest(options: Omit<PinCheckOptions, 'manifest' | 'manifestPath'>): Promise<PinManifest> {
  const limits = resolveLimits(options.limits);
  const expectedVersion = options.expectedVersion ?? SUPPORTED_VIBE;
  const located = await locateEnvironment(options.executable, expectedVersion, limits);
  const { recordSha256, entries, listed } = await readRecord(located, limits);
  const outcome = await hashEntries(entries, limits, options.signal);
  if (outcome.missing.length > 0) throw new PinCheckError('file-missing', 'Files listed in RECORD are missing.', { missing: limited(outcome.missing) });
  if (outcome.unsafe.length > 0) throw new PinCheckError('file-unsafe', 'Files listed in RECORD are not plain regular files.', { unsafe: limited(outcome.unsafe) });
  const extra = await findUnlisted(located, listed, limits);
  if (extra.length > 0) throw new PinCheckError('file-extra', 'Files exist that RECORD does not list.', { extra: limited(extra) });
  return { format: 1, version: located.version, record_sha256: recordSha256, files: Object.fromEntries(outcome.hashes) };
}

export async function verifyPinnedInstall(options: PinCheckOptions): Promise<PinnedEnvironment> {
  const limits = resolveLimits(options.limits);
  const expectedVersion = options.expectedVersion ?? SUPPORTED_VIBE;
  const located = await locateEnvironment(options.executable, expectedVersion, limits);
  const manifest = options.manifest ?? (options.manifestPath === undefined ? undefined : await loadPinManifest(options.manifestPath, limits));
  if (!manifest) throw new TypeError('A pin manifest or manifest path is required');
  if (manifest.version !== expectedVersion) {
    throw new PinCheckError('manifest-version-mismatch', `The pin manifest is for ${manifest.version}, not ${expectedVersion}.`, { manifest: manifest.version, expected: expectedVersion });
  }
  const manifestFiles = new Map(Object.entries(manifest.files));
  if (manifestFiles.size > limits.maxFiles) throw new PinCheckError('limit-exceeded', 'The pin manifest lists more files than the limit.');
  const { recordSha256, entries, listed } = await readRecord(located, limits);
  if (recordSha256 !== manifest.record_sha256) throw new PinCheckError('record-mismatch', 'RECORD does not match the pinned digest.');

  const verified = new Set(entries.map((entry) => entry.relative));
  const scriptRelative = path.relative(located.sitePackages, located.executable).split(path.sep).join('/');
  if (!verified.has(scriptRelative)) throw new PinCheckError('script-unlisted', 'The vibe-app-server script is not covered by RECORD.');

  const unpinned = entries.filter((entry) => !manifestFiles.has(entry.relative)).map((entry) => entry.relative);
  const unlisted = [...manifestFiles.keys()].filter((relative) => !verified.has(relative));
  const outcome = await hashEntries(entries.filter((entry) => manifestFiles.has(entry.relative)), limits, options.signal);
  const mismatched = [...outcome.hashes].filter(([relative, digest]) => manifestFiles.get(relative) !== digest).map(([relative]) => relative);
  const extra = [...unpinned, ...await findUnlisted(located, listed, limits)];
  const missing = [...unlisted, ...outcome.missing];

  const details = {
    ...(mismatched.length > 0 ? { mismatched: limited(mismatched) } : {}),
    ...(missing.length > 0 ? { missing: limited(missing) } : {}),
    ...(extra.length > 0 ? { extra: limited(extra) } : {}),
    ...(outcome.unsafe.length > 0 ? { unsafe: limited(outcome.unsafe) } : {}),
  };
  if (outcome.unsafe.length > 0) throw new PinCheckError('file-unsafe', 'Installed files are not plain regular files.', details);
  if (mismatched.length > 0) throw new PinCheckError('file-mismatch', 'Installed files differ from the pinned digests.', details);
  if (missing.length > 0) throw new PinCheckError('file-missing', 'Pinned files are missing from the installation.', details);
  if (extra.length > 0) throw new PinCheckError('file-extra', 'The installation has files that the pin does not cover.', details);
  return { ...located, fileCount: outcome.hashes.size, totalBytes: outcome.totalBytes, recordSha256 };
}
