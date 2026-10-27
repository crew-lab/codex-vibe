import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveExecutableFile } from '../security/executable.js';

const exec = promisify(execFile);

export async function authorizeWithNode(executable: string, args: readonly string[]): Promise<unknown> {
  if (!path.isAbsolute(executable) || /[\u0000-\u001f\u007f]/.test(executable)) throw new Error('--runtime-node requires the absolute Node executable reported by vibe_status.supervisor_runtime.executable');
  const node = await resolveExecutableFile(executable);
  if (node === await realpath(process.execPath)) return undefined;
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const probe = await exec(node, ['-p', 'JSON.stringify({version:process.versions.node,executable:process.execPath})'], { env, timeout: 5_000, maxBuffer: 4096 });
  const runtime = JSON.parse(probe.stdout) as { version?: string; executable?: string };
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(runtime.version ?? '');
  if (!version || Number(version[1]) < 20 || (Number(version[1]) === 20 && Number(version[2]) < 19) || typeof runtime.executable !== 'string' || await realpath(runtime.executable) !== node) throw new Error('--runtime-node must identify Node >=20.19');
  const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
  const result = await exec(node, [cli, 'task', ...args], { env, timeout: 40_000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout) as unknown;
}
