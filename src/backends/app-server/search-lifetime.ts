import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { lstat, opendir, readFile, realpath, unlink } from 'node:fs/promises';
import { supervisorError } from '../../contracts.js';

const exec = promisify(execFile);

/** Read-only PID inspection; no PID from a marker is ever signalled or resumed. */
async function originalProcessAlive(pid: number, startedAt: number): Promise<boolean> {
  try {
    const { stdout } = await exec('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }, timeout: 2000, maxBuffer: 4096 });
    const start = Date.parse(stdout.trim() + ' UTC');
    if (!Number.isFinite(start)) throw new Error('Unparseable process start');
    return Math.abs(start - startedAt) <= 2000;
  } catch (error) {
    const value = error as { code?: unknown; stdout?: string; stderr?: string };
    if (value.code === 1 && !value.stdout?.trim() && !value.stderr?.trim()) return false;
    throw supervisorError('VSUP_BACKEND_ERROR', 'Search sidecar liveness could not be established.');
  }
}

export async function waitForSearchTermination(directory: string, nonce: string, runId: string, parentPid: number, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory || (info.mode & 0o077) !== 0) throw supervisorError('VSUP_BACKEND_ERROR', 'Unsafe search lifetime registry.');
    let live = false; let count = 0;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (++count > 64 || !entry.isFile() || entry.isSymbolicLink() || !/^\d+\.json$/.test(entry.name)) throw supervisorError('VSUP_BACKEND_ERROR', 'Unsafe search lifetime record.');
      const file = path.join(directory, entry.name); const before = await lstat(file);
      if (before.size > 4096 || (before.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && before.uid !== process.getuid())) throw supervisorError('VSUP_BACKEND_ERROR', 'Unsafe search lifetime record permissions.');
      let record: Record<string, unknown>;
      try { record = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>; }
      catch { throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid search lifetime record.'); }
      if (record.nonce !== nonce || record.runId !== runId || record.parentPid !== parentPid || typeof record.pid !== 'number' || !Number.isSafeInteger(record.pid) || record.pid <= 0 || entry.name !== `${record.pid}.json` || typeof record.startedAt !== 'number' || !Number.isFinite(record.startedAt)) throw supervisorError('VSUP_BACKEND_ERROR', 'Foreign search lifetime record.');
      if (await originalProcessAlive(record.pid, record.startedAt)) live = true;
      else {
        const after = await lstat(file);
        if (after.ino !== before.ino || after.dev !== before.dev || after.mtimeMs !== before.mtimeMs) throw supervisorError('VSUP_BACKEND_ERROR', 'Search lifetime record changed while checking.');
        await unlink(file);
      }
    }
    if (!live) return;
    if (performance.now() >= deadline) throw supervisorError('VSUP_BACKEND_ERROR', 'Search sidecar termination remains unverified.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
