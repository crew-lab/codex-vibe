import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import { spawnManaged } from '../../process/managed.js';

export const CREDENTIAL_ENV = 'MISTRAL_API_KEY';
export const SECURITY_BINARY = '/usr/bin/security';
export const KEYCHAIN_SERVICES = ['ai.mistral.vibe', 'vibe'] as const;
export const KEYCHAIN_PATH = '/usr/bin:/bin';
export const KEYCHAIN_TIMEOUT_MS = 5000;
export const MAX_KEYCHAIN_OUTPUT_BYTES = 8 * 1024;

const REDACTED = '[REDACTED]';

export class ResolvedCredential {
  readonly #value: string;
  constructor(value: string) { this.#value = value; }
  environment(): { MISTRAL_API_KEY: string } { return { MISTRAL_API_KEY: this.#value }; }
  secret(): string { return this.#value; }
  toString(): string { return REDACTED; }
  toJSON(): string { return REDACTED; }
  [inspect.custom](): string { return `ResolvedCredential ${REDACTED}`; }
}

export interface KeychainRequest {
  executable: string;
  args: readonly string[];
  env: { HOME: string; PATH: string };
  timeoutMs: number;
  maxOutputBytes: number;
}

export type KeychainRunResult =
  | { kind: 'exit'; code: number; output: Buffer }
  | { kind: 'timeout' }
  | { kind: 'oversize' }
  | { kind: 'failed' };

export type KeychainRunner = (request: KeychainRequest) => Promise<KeychainRunResult>;

export type CredentialStatus =
  | 'environment' | 'keychain' | 'skipped-platform' | 'skipped-home'
  | 'not-found' | 'locked' | 'denied' | 'timeout' | 'oversize' | 'invalid-output' | 'error';

export interface CredentialResolution {
  status: CredentialStatus;
  detail: string;
  credential: ResolvedCredential | undefined;
}

export type HomeRejection = 'unset' | 'not-normalized' | 'not-absolute' | 'missing' | 'symlink' | 'not-directory' | 'not-owner';

export interface ResolveCredentialOptions {
  environment?: NodeJS.ProcessEnv;
  home?: string | undefined;
  platform?: NodeJS.Platform;
  runner?: KeychainRunner;
  executable?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const EXIT_REASONS: Readonly<Record<number, CredentialStatus>> = { 44: 'not-found', 36: 'locked', 51: 'denied', 128: 'denied' };
const REASON_PRIORITY: readonly CredentialStatus[] = ['locked', 'denied', 'timeout', 'oversize', 'invalid-output', 'error', 'not-found'];

export const spawnKeychainRunner: KeychainRunner = async (request) => {
  let managed: ReturnType<typeof spawnManaged>;
  try {
    managed = spawnManaged(request.executable, request.args, {
      cwd: request.env.HOME,
      env: request.env,
      maxStdoutBytes: request.maxOutputBytes,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return { kind: 'failed' }; }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void managed.terminate(0).catch(() => {}); }, request.timeoutMs);
  let code: number | null;
  try { ({ code } = await managed.done); }
  catch { return { kind: 'failed' }; }
  finally { clearTimeout(timer); }
  if (timedOut) return { kind: 'timeout' };
  if (managed.stdout.truncated) return { kind: 'oversize' };
  if (code === null) return { kind: 'failed' };
  return { kind: 'exit', code, output: managed.stdout.toBuffer() };
};

export async function checkOriginalHome(raw: string | undefined): Promise<{ path: string | undefined; reason: HomeRejection | 'ok' }> {
  if (!raw) return { path: undefined, reason: 'unset' };
  if (raw.includes('\0')) return { path: undefined, reason: 'not-normalized' };
  if (!path.isAbsolute(raw)) return { path: undefined, reason: 'not-absolute' };
  const trimmed = raw.replace(/\/+$/, '');
  if (!trimmed || path.normalize(trimmed) !== trimmed) return { path: undefined, reason: 'not-normalized' };
  let info;
  try { info = await lstat(trimmed); } catch { return { path: undefined, reason: 'missing' }; }
  if (info.isSymbolicLink()) return { path: undefined, reason: 'symlink' };
  if (!info.isDirectory()) return { path: undefined, reason: 'not-directory' };
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) return { path: undefined, reason: 'not-owner' };
  return { path: trimmed, reason: 'ok' };
}

export function decodeKeychainOutput(output: Buffer): string | undefined {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(output); } catch { return undefined; }
  if (text.endsWith('\n')) text = text.slice(0, -1);
  if (!text || /[\0\r\n]/.test(text)) return undefined;
  return text;
}

function statusRank(status: string): number {
  const base = status.startsWith('error') ? 'error' : status;
  return REASON_PRIORITY.indexOf(base as CredentialStatus);
}

async function lookupKeychain(home: string, options: Required<Pick<ResolveCredentialOptions, 'runner' | 'executable' | 'timeoutMs' | 'maxOutputBytes'>>): Promise<CredentialResolution> {
  const reasons: Array<{ service: string; reason: string }> = [];
  for (const service of KEYCHAIN_SERVICES) {
    let result: KeychainRunResult;
    try {
      result = await options.runner({
        executable: options.executable,
        args: ['find-generic-password', '-a', CREDENTIAL_ENV, '-s', service, '-w'],
        env: { HOME: home, PATH: KEYCHAIN_PATH },
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
      });
    } catch { result = { kind: 'failed' }; }
    if (result.kind === 'timeout') { reasons.push({ service, reason: 'timeout' }); continue; }
    if (result.kind === 'oversize') { reasons.push({ service, reason: 'oversize' }); continue; }
    if (result.kind === 'failed') { reasons.push({ service, reason: 'error' }); continue; }
    if (result.code !== 0) { reasons.push({ service, reason: EXIT_REASONS[result.code] ?? `error-${result.code}` }); continue; }
    const value = decodeKeychainOutput(result.output);
    if (value === undefined) { reasons.push({ service, reason: 'invalid-output' }); continue; }
    return { status: 'keychain', detail: '', credential: new ResolvedCredential(value) };
  }
  const detail = reasons.map(({ service, reason }) => `${service}=${reason}`).join(',');
  const top = reasons.map(({ reason }) => reason).sort((a, b) => statusRank(a) - statusRank(b))[0];
  const status = top === undefined ? 'not-found' : top.startsWith('error') ? 'error' : top as CredentialStatus;
  return { status, detail, credential: undefined };
}

export async function resolveCredential(options: ResolveCredentialOptions = {}): Promise<CredentialResolution> {
  const environment = options.environment ?? process.env;
  const existing = environment[CREDENTIAL_ENV];
  if (existing) return { status: 'environment', detail: '', credential: new ResolvedCredential(existing) };
  if ((options.platform ?? process.platform) !== 'darwin') return { status: 'skipped-platform', detail: '', credential: undefined };
  const home = await checkOriginalHome('home' in options ? options.home : environment.HOME);
  if (home.path === undefined) return { status: 'skipped-home', detail: home.reason, credential: undefined };
  return lookupKeychain(home.path, {
    runner: options.runner ?? spawnKeychainRunner,
    executable: options.executable ?? SECURITY_BINARY,
    timeoutMs: options.timeoutMs ?? KEYCHAIN_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? MAX_KEYCHAIN_OUTPUT_BYTES,
  });
}
