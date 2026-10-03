import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateFile } from '../security/paths.js';
import type { VibeChildProfile } from './profile.js';

const execFileAsync = promisify(execFile);
const SHIM_ASSET = new URL('./runtime/vibe_supervisor_launcher.py', import.meta.url);

export interface VibeLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export async function resolveCommand(command: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (path.isAbsolute(command)) return command;
  const result = await execFileAsync('/usr/bin/which', [command], { env, timeout: 5000, maxBuffer: 8192 });
  const resolved = result.stdout.trim().split('\n')[0];
  if (!resolved) throw new Error(`Cannot resolve executable ${command}`);
  return resolved;
}

async function pythonFor(executable: string, env: NodeJS.ProcessEnv): Promise<string> {
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
  const words = firstLine.slice(2).trim().split(/\s+/);
  if (words[0] === '/usr/bin/env' && words[1]) return resolveCommand(words[1], env);
  if (words[0]?.startsWith('/')) return words[0];
  throw new Error('Unsupported Vibe Python shebang');
}

/** Run the installed Vibe module through the pinned, redacting persistence shim. */
export async function buildVibeLaunch(
  executable: string,
  entrypoint: 'acp' | 'programmatic',
  args: readonly string[],
  profile: VibeChildProfile,
  runDirectory: string,
): Promise<VibeLaunch> {
  const resolved = await resolveCommand(executable, profile.env);
  const python = await pythonFor(resolved, profile.env);
  const shim = path.join(runDirectory, 'vibe_supervisor_launcher.py');
  const content = await readFile(SHIM_ASSET);
  try { await createPrivateFile(shim, content); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(shim);
    if (!existing.equals(content)) throw new Error('Run directory contains a different Vibe launcher shim');
  }
  const env = { ...profile.env, VIBE_SUPERVISOR_ENTRYPOINT: entrypoint };
  return { command: python, args: [shim, ...args], env };
}

export const shimSourcePath = fileURLToPath(SHIM_ASSET);
