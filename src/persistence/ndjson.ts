import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createPrivateDir } from '../security/paths.js';
import { sanitizeForPersistence } from './atomic.js';

export interface NdjsonReadOptions { maxBytes?: number; truncatePartial?: boolean }

/** Reads valid complete records and ignores a torn final record after a crash. */
export async function readNdjsonRecovering<T = unknown>(file: string, options: NdjsonReadOptions = {}): Promise<T[]> {
  let bytes: Buffer;
  let input;
  try { input = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  try {
    const info = await input.stat();
    if (!info.isFile()) throw new Error('Refusing unsafe NDJSON input');
    if (info.size > (options.maxBytes ?? 50 * 1024 * 1024)) throw new RangeError('NDJSON store exceeds configured byte limit');
    bytes = await input.readFile();
  } finally { await input.close(); }
  if (bytes.byteLength > (options.maxBytes ?? 50 * 1024 * 1024)) throw new RangeError('NDJSON store exceeds configured byte limit');
  const lastNewline = bytes.lastIndexOf(0x0a);
  const completeLength = lastNewline + 1;
  if (options.truncatePartial && completeLength < bytes.length) {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe NDJSON recovery target');
    const handle = await open(file, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
    try { await handle.truncate(completeLength); await handle.sync(); } finally { await handle.close(); }
  }
  const complete = bytes.subarray(0, completeLength).toString('utf8');
  const records: T[] = [];
  for (const line of complete.split('\n')) {
    if (!line) continue;
    records.push(JSON.parse(line) as T);
  }
  return records;
}

export async function appendNdjson(file: string, value: unknown, options: { maxBytes?: number; sentinels?: readonly string[] } = {}): Promise<void> {
  const absolute = path.resolve(file);
  const directory = path.dirname(absolute);
  await createPrivateDir(directory);
  try { const info = await lstat(absolute); if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe NDJSON target'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const payload = JSON.stringify(sanitizeForPersistence(value, options.sentinels)) + '\n';
  const size = Buffer.byteLength(payload);
  if (size > (options.maxBytes ?? 50 * 1024 * 1024)) throw new RangeError('NDJSON record exceeds configured byte limit');
  const handle = await open(absolute, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await handle.chmod(0o600);
    const stat = await handle.stat();
    if (stat.size + size > (options.maxBytes ?? 50 * 1024 * 1024)) throw new RangeError('NDJSON store exceeds configured byte limit');
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
}
