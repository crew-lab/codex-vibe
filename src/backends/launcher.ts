import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateFile } from '../security/paths.js';
import { supervisorError } from '../contracts.js';
import type { BackendKind, SupervisorError, SupervisorErrorCode } from '../contracts.js';
import type { ManagedProcess } from '../process/managed.js';
import { SUPPORTED_VIBE } from './pinned.js';
import type { VibeChildProfile } from './profile.js';

const execFileAsync = promisify(execFile);
export const PROMPT_FILE_ENV = 'VIBE_SUPERVISOR_PROMPT_FILE';
export const PROMPT_FILE_NAME = 'task-prompt.txt';
const SHIM_ASSET = new URL('./runtime/vibe_supervisor_launcher.py', import.meta.url);

export interface VibeLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

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

export async function pythonFor(executable: string, env: NodeJS.ProcessEnv): Promise<string> {
  const words = await shebangWords(executable);
  if (words[0] === '/usr/bin/env' && words[1]) return resolveCommand(words[1], env);
  if (words[0]?.startsWith('/')) return words[0];
  throw new Error('Unsupported Vibe Python shebang');
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

export function interpreterMissingMessage(backend: BackendKind, interpreter: unknown): string {
  return `The interpreter for the ${backend} Vibe launcher${typeof interpreter === 'string' ? ` (${interpreter})` : ''} was not found; install it or correct the launcher's shebang.`;
}

export function versionUnsupported(backend: BackendKind, detected: string): SupervisorError {
  return supervisorError('VSUP_VIBE_VERSION_UNSUPPORTED', `Found Vibe ${detected} (${backend} backend); this release supports exactly Vibe ${SUPPORTED_VIBE}.`, { detected_version: detected });
}

export function versionMismatchOnStderr(backend: BackendKind, stderr: string): SupervisorError | undefined {
  const detected = stderr.match(/supports exactly \S+; found (\S+)/)?.[1];
  return detected ? versionUnsupported(backend, detected) : undefined;
}

const RATE_LIMIT_PATTERN = /\b(?:http|status(?: code)?|error|code)\W{0,3}429\b|\b429\W{1,3}(?:too many|rate)|\(429\)|\btoo many requests\b/i;
const AUTH_PATTERN = /missing api key|\bunauthori[sz]ed\b|\bforbidden\b|\b(?:http|status(?: code)?|error|code)\W{0,3}40[13]\b|\(40[13]\)|\b40[13]\W{1,3}(?:unauthori[sz]ed|forbidden)/i;
const TAIL_LINES = 5;

export function stderrTailText(text: string): string {
  return text.split('\n').filter((line) => line.trim()).slice(-TAIL_LINES).join('\n');
}

export function rateLimitFailure(text: string): SupervisorError | undefined {
  return RATE_LIMIT_PATTERN.test(text) ? supervisorError('VSUP_RATE_LIMITED', 'Vibe was rate limited by its provider (HTTP 429).', undefined, true) : undefined;
}

export function authFailureText(text: string): boolean {
  return AUTH_PATTERN.test(text);
}

export function classifyFailureText(text: string, fallback: SupervisorErrorCode, message = text): SupervisorError {
  if (authFailureText(text)) return supervisorError('VSUP_AUTH_REQUIRED', message);
  return rateLimitFailure(text) ?? supervisorError(fallback, message);
}

export function isCodedError(error: unknown): error is SupervisorError {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' && (error as { code: string }).code.startsWith('VSUP_');
}

export async function classifyStartFailure(backend: BackendKind, executable: string, error: unknown, stderr = ''): Promise<unknown> {
  const mismatch = versionMismatchOnStderr(backend, stderr);
  if (mismatch) return mismatch;
  if (isCodedError(error)) return error;
  const missing = await describeMissing(executable, error);
  if (missing.executable_missing === true) return supervisorError(backend === 'acp' ? 'VSUP_VIBE_ACP_NOT_FOUND' : 'VSUP_VIBE_NOT_FOUND', backend === 'acp' ? 'The vibe-acp executable was not found.' : 'The vibe executable was not found.', missing);
  if (missing.interpreter_missing === true) return supervisorError('VSUP_BACKEND_UNAVAILABLE', interpreterMissingMessage(backend, missing.interpreter), missing);
  const tail = stderrTailText(stderr);
  if (authFailureText(tail)) return supervisorError('VSUP_AUTH_REQUIRED', 'Vibe rejected the credentials (authentication failure).');
  return rateLimitFailure(tail) ?? error;
}

export function spawned(process: ManagedProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.child.pid !== undefined) { resolve(); return; }
    process.child.once('spawn', () => resolve());
    process.child.once('error', reject);
  });
}

/** Run the installed Vibe module through the pinned, redacting persistence shim. */
export async function buildVibeLaunch(
  executable: string,
  entrypoint: 'acp' | 'programmatic',
  args: readonly string[],
  profile: VibeChildProfile,
  runDirectory: string,
  options: { promptText?: string } = {},
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
  const env: NodeJS.ProcessEnv = { ...profile.env, VIBE_SUPERVISOR_ENTRYPOINT: entrypoint };
  if (options.promptText !== undefined) {
    if (entrypoint !== 'programmatic') throw new Error('Only the programmatic launch accepts a prompt file');
    const promptFile = path.join(runDirectory, PROMPT_FILE_NAME);
    await createPrivateFile(promptFile, options.promptText);
    env[PROMPT_FILE_ENV] = promptFile;
  }
  return { command: python, args: [shim, ...args], env };
}

export type PromptFileOutcome = 'removed' | 'absent' | 'refused';

/** Delete the supervisor-written prompt file only when it is still a regular file directly inside a real run directory. */
export async function removePromptFile(runDirectory: string): Promise<PromptFileOutcome> {
  const file = path.join(runDirectory, PROMPT_FILE_NAME);
  try {
    const directory = await lstat(runDirectory);
    if (directory.isSymbolicLink() || !directory.isDirectory()) return 'refused';
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) return 'refused';
    await unlink(file);
    return 'removed';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'refused';
  }
}

export const shimSourcePath = fileURLToPath(SHIM_ASSET);
