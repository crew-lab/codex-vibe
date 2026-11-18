import { lstat, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateDir, createPrivateFile, writePrivateFileAtomic } from '../../security/paths.js';
import { parsePinManifest, serializePinManifest, type PinManifest } from './pin.js';

export const PIN_HISTORY_DIRECTORY = 'pin-history';
export const PIN_HISTORY_KEEP = 3;

export interface PinReplacement {
  previousVersion: string | null;
  historyPath: string | null;
}

function historyStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function safeVersion(version: string): string {
  return version.replace(/[^0-9A-Za-z.+_]/g, '_');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function historyPattern(stem: string): RegExp {
  return new RegExp(`^${escapeRegExp(stem)}-[0-9A-Za-z.+_]+-(\\d{8}T\\d{6}Z)(?:-(\\d+))?\\.json$`);
}

async function existingRegularFile(file: string): Promise<boolean> {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${file} is not a regular file`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function archive(directory: string, stem: string, version: string, now: Date, bytes: Buffer): Promise<string> {
  const base = `${stem}-${safeVersion(version)}-${historyStamp(now)}`;
  for (let suffix = 0; ; suffix += 1) {
    const candidate = path.join(directory, suffix === 0 ? `${base}.json` : `${base}-${suffix}.json`);
    try { await createPrivateFile(candidate, bytes, 'wx'); return candidate; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
}

async function pruneHistory(directory: string, stem: string, kept: string): Promise<void> {
  const pattern = historyPattern(stem);
  const entries = (await readdir(directory)).flatMap((name) => {
    const match = pattern.exec(name);
    return match && path.join(directory, name) !== kept ? [{ name, stamp: match[1] ?? '', suffix: Number(match[2] ?? 0) }] : [];
  });
  entries.sort((a, b) => (a.stamp !== b.stamp ? (a.stamp < b.stamp ? 1 : -1) : b.suffix - a.suffix));
  for (const stale of entries.slice(PIN_HISTORY_KEEP - 1)) await unlink(path.join(directory, stale.name));
}

export async function replacePinManifest(manifestPath: string, manifest: PinManifest, now: () => Date = () => new Date()): Promise<PinReplacement> {
  const target = path.resolve(manifestPath);
  const serialized = Buffer.from(serializePinManifest(manifest));
  let previous: Buffer | undefined;
  if (await existingRegularFile(target)) previous = await readFile(target);
  let previousVersion: string | null = null;
  if (previous) { try { previousVersion = parsePinManifest(previous.toString('utf8')).version; } catch { previousVersion = null; } }
  if (!previous || previous.equals(serialized)) {
    await writePrivateFileAtomic(target, serialized);
    return { previousVersion, historyPath: null };
  }
  const directory = path.join(path.dirname(target), PIN_HISTORY_DIRECTORY);
  const stem = path.basename(target).replace(/\.json$/i, '');
  await createPrivateDir(directory);
  const historyPath = await archive(directory, stem, previousVersion ?? 'unknown', now(), previous);
  await writePrivateFileAtomic(target, serialized);
  await pruneHistory(directory, stem, historyPath);
  return { previousVersion, historyPath };
}
