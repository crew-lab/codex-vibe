import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import type { ManagedProcess } from '../../process/managed.js';

const execFileAsync = promisify(execFile);

export async function resolveCommand(command: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (path.isAbsolute(command)) return command;
  let result;
  try { result = await execFileAsync('/usr/bin/which', [command], { env, timeout: 5000, maxBuffer: 8192 }); }
  catch (error) {
    if ((error as { code?: unknown }).code === 1) throw Object.assign(new Error(`Cannot resolve executable ${command}`), { code: 'ENOENT' });
    throw error;
  }
  const resolved = result.stdout.trim().split('\n')[0];
  if (!resolved) throw new Error(`Cannot resolve executable ${command}`);
  return resolved;
}

export function isExecutableMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

async function shebangWords(executable: string): Promise<string[]> {
  const handle = await open(executable, 'r');
  let firstLine: string;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Vibe executable is not a bounded regular file');
    const bytes = Buffer.alloc(512);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    firstLine = bytes.subarray(0, bytesRead).toString('utf8').split(/\r?\n/, 1)[0] ?? '';
  } finally { await handle.close(); }
  if (!firstLine.startsWith('#!')) throw new Error('Vibe entrypoint has no Python shebang; refusing unverified runtime');
  return firstLine.slice(2).trim().split(/\s+/);
}

export async function describeMissing(executable: string, error: unknown, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  if (!isExecutableMissing(error)) return {};
  let resolved: string;
  try { resolved = await resolveCommand(executable, env); }
  catch { return { executable_missing: true }; }
  try { await lstat(resolved); }
  catch (failure) { if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return { executable_missing: true }; }
  const words = await shebangWords(resolved).catch(() => []);
  const interpreter = words[0] === '/usr/bin/env' ? words[1] : words[0];
  return { interpreter_missing: true, ...(interpreter ? { interpreter } : {}) };
}

export function interpreterMissingMessage(interpreter: unknown): string {
  return `The interpreter for the Vibe launcher${typeof interpreter === 'string' ? ` (${interpreter})` : ''} was not found; install it or correct the launcher's shebang.`;
}

export function spawned(process: ManagedProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.child.pid !== undefined) { resolve(); return; }
    process.child.once('spawn', () => resolve());
    process.child.once('error', reject);
  });
}
