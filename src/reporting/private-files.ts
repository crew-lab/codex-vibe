import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

type FileRole = 'request' | 'contract' | 'patch' | 'validation' | 'artifact' | 'directory';
type FileReason = 'missing' | 'permission' | 'link' | 'type' | 'owner' | 'mode' | 'size' | 'changed' | 'invalid_json' | 'invalid_schema' | 'mismatch' | 'duplicate';

function fileFailure(role: FileRole, reason: FileReason): Error {
  const code = role === 'artifact' || role === 'directory' ? 'VSUP_ARTIFACT_ERROR' : 'VSUP_INVALID_ARGUMENT';
  const guidance = reason === 'mismatch' ? 'External validation refers to another patch; provide validation for this patch.' : reason === 'duplicate' ? 'Duplicate validation IDs; provide unique IDs.' : reason === 'invalid_json' || reason === 'invalid_schema' ? 'Provide valid JSON matching the required schema.' : role === 'directory' ? 'Use a canonical, owner-private directory.' : 'Use a canonical, owned, single-link file with safe permissions and within the size limit.';
  return Object.assign(new Error(`Cannot read ${role}: ${reason}. ${guidance}`), { code, details: { role, reason } });
}

function failureFor(error: unknown, role: FileRole): never {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') throw fileFailure(role, 'missing');
  if (code === 'EACCES' || code === 'EPERM') throw fileFailure(role, 'permission');
  if (code === 'ELOOP') throw fileFailure(role, 'link');
  throw error;
}

function check(info: Stats, role: FileRole, maxBytes: number, privateFile: boolean): void {
  if (info.isSymbolicLink()) throw fileFailure(role, 'link');
  if (!info.isFile()) throw fileFailure(role, 'type');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw fileFailure(role, 'owner');
  if (info.nlink !== 1) throw fileFailure(role, 'link');
  if ((info.mode & (privateFile ? 0o077 : 0o022)) !== 0) throw fileFailure(role, 'mode');
  if (info.size > maxBytes) throw fileFailure(role, 'size');
}

function same(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

async function readChecked(file: string, maxBytes: number, role: FileRole, privateFile: boolean): Promise<Buffer> {
  try {
    if (!path.isAbsolute(file)) throw fileFailure(role, 'link');
    const before = await lstat(file);
    check(before, role, maxBytes, privateFile);
    if (await realpath(file) !== file) throw fileFailure(role, 'link');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      check(opened, role, maxBytes, privateFile);
      if (!same(before, opened)) throw fileFailure(role, 'changed');
      const buffer = Buffer.alloc(Math.min(maxBytes + 1, opened.size + 1));
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat();
      let current: Stats; let resolved: string;
      try { current = await lstat(file); resolved = await realpath(file); }
      catch (error) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw fileFailure(role, 'changed'); throw error; }
      if (length > maxBytes || !same(opened, after) || !same(opened, current) || resolved !== file || length !== opened.size) throw fileFailure(role, 'changed');
      return buffer.subarray(0, length);
    } finally { await handle.close(); }
  } catch (error) { failureFor(error, role); }
}

export function invalidValidationInput(reason: 'mismatch' | 'duplicate'): Error {
  return fileFailure('validation', reason);
}

export function parseInputJson<T>(bytes: Buffer, role: 'request' | 'contract' | 'validation', schema: z.ZodType<T>): T {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw fileFailure(role, 'invalid_json');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) throw fileFailure(role, 'invalid_json'); throw error; }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fileFailure(role, 'invalid_schema');
  return parsed.data;
}

export async function readInputFile(file: string, maxBytes: number, role: 'request' | 'contract' | 'patch' | 'validation'): Promise<Buffer> {
  return readChecked(file, maxBytes, role, false);
}

export async function readOwnedFile(file: string, maxBytes = 100 * 1024 * 1024): Promise<Buffer> {
  return readChecked(file, maxBytes, 'artifact', true);
}

export async function assertOwnedDirectory(directory: string): Promise<void> {
  try {
    if (!path.isAbsolute(directory)) throw fileFailure('directory', 'link');
    const info = await lstat(directory);
    if (info.isSymbolicLink() || await realpath(directory) !== directory) throw fileFailure('directory', 'link');
    if (!info.isDirectory()) throw fileFailure('directory', 'type');
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw fileFailure('directory', 'owner');
    if ((info.mode & 0o077) !== 0) throw fileFailure('directory', 'mode');
  } catch (error) { failureFor(error, 'directory'); }
}
