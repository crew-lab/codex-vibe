import { lstat, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateDir, writePrivateFileAtomic } from '../../security/paths.js';
import { parsePinManifest, serializePinManifest, type PinManifest } from './pin.js';

export const PIN_HISTORY_DIRECTORY = 'pin-history';
export const PIN_HISTORY_KEEP = 3;

const HISTORY_NAME = /^vibe-pin-.+-(\d{8}T\d{6}Z)\.json$/;

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

async function pruneHistory(directory: string): Promise<void> {
  const names = (await readdir(directory)).filter((name) => HISTORY_NAME.test(name));
  const stamped = names.map((name) => ({ name, stamp: HISTORY_NAME.exec(name)?.[1] ?? '' }));
  stamped.sort((a, b) => (a.stamp === b.stamp ? (a.name < b.name ? 1 : -1) : a.stamp < b.stamp ? 1 : -1));
  for (const stale of stamped.slice(PIN_HISTORY_KEEP)) await unlink(path.join(directory, stale.name));
}

export async function replacePinManifest(manifestPath: string, manifest: PinManifest, now: () => Date = () => new Date()): Promise<PinReplacement> {
  const target = path.resolve(manifestPath);
  let replacement: PinReplacement = { previousVersion: null, historyPath: null };
  if (await existingRegularFile(target)) {
    const previous = await readFile(target);
    let version = 'unknown';
    let previousVersion: string | null = null;
    try { previousVersion = parsePinManifest(previous.toString('utf8')).version; version = previousVersion; } catch { previousVersion = null; }
    const directory = path.join(path.dirname(target), PIN_HISTORY_DIRECTORY);
    await createPrivateDir(directory);
    const historyPath = path.join(directory, `vibe-pin-${safeVersion(version)}-${historyStamp(now())}.json`);
    await writePrivateFileAtomic(historyPath, previous);
    await pruneHistory(directory);
    replacement = { previousVersion, historyPath };
  }
  await writePrivateFileAtomic(target, serializePinManifest(manifest));
  return replacement;
}
