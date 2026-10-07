import { lstat, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const WORKER_DEADLINE_FILE_ENV = 'VIBE_SUPERVISOR_WORKER_DEADLINE_FILE';
export const WORKER_DEADLINE_FILE_NAME = 'worker-deadline';
export const IDLE_DEADLINE_MARGIN_SECONDS = 30;

export function turnDeadlineSeconds(timeoutSeconds: number, nowMs = Date.now()): number {
  return Math.ceil(nowMs / 1000) + timeoutSeconds;
}

export function idleDeadlineSeconds(idleTtlSeconds: number, nowMs = Date.now()): number {
  return Math.ceil(nowMs / 1000) + Math.max(idleTtlSeconds, 0) + IDLE_DEADLINE_MARGIN_SECONDS;
}

export async function writeWorkerDeadline(runDirectory: string, epochSeconds: number): Promise<string> {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) throw new Error('Worker deadline must be a positive epoch time');
  const directory = path.resolve(runDirectory);
  const directoryInfo = await lstat(directory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error('Run directory must be a real directory');
  const file = path.join(directory, WORKER_DEADLINE_FILE_NAME);
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe worker deadline target');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temp = path.join(directory, `.${WORKER_DEADLINE_FILE_NAME}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(`${Math.ceil(epochSeconds)}\n`, 'utf8');
    await handle.close(); handle = undefined;
    await rename(temp, file);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return file;
}
