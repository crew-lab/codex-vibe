import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { exportReport, locateSavedRun } from '../reporting/export.js';
import { loadResolvedConfig } from '../config/config.js';
import { readNdjsonRecovering } from '../persistence/ndjson.js';
import { supervisorError } from '../contracts.js';
import { fail } from './fail.js';
import { runsUsefulness } from './runs/usefulness.js';

export const MAX_SESSION_DIRECTORIES = 128;
export const SESSION_SCAN_LIMIT_MESSAGE = 'The isolated session namespace exceeds its safe scan limit; inspect it manually.';
const SESSION_NAME = /^session-[A-Za-z0-9]{6}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RUN_JSON_BYTES = 100 * 1024 * 1024;
const RUNS_USAGE = 'Usage: vibe-supervisor runs [--config <path>] <list|show|tail|cleanup|usefulness|verify|export> [run-id]';
const REPORT_USAGE = 'Usage: runs verify|export <run-id> --out <directory> [--include patch,events] [--validation <file>]';

export interface RunsServices {
  cleanup(configPath: string | undefined, runId: string | undefined): Promise<unknown>;
}

export interface RunsInvocation {
  subcommand: string;
  positional: readonly string[];
  configPath: string | undefined;
  services: RunsServices;
}

export type RunsSubcommand = (invocation: RunsInvocation) => Promise<void>;

export const RUNS_SUBCOMMANDS: Readonly<Record<string, RunsSubcommand>> = {
  list: listRuns,
  show: showRun,
  tail: tailRun,
  cleanup: cleanupRuns,
  verify: reportRun,
  export: reportRun,
  usefulness: runsUsefulness
};

export async function runsCommand(args: readonly string[], services: RunsServices): Promise<void> {
  let configPath: string | undefined; const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--config') {
      const value = args[++index];
      if (!value || value.startsWith('--') || configPath) fail('runs --config requires one path.', 2);
      configPath = path.resolve(value);
    } else positional.push(args[index] as string);
  }
  const subcommand = positional[0] ?? '';
  const handler = Object.hasOwn(RUNS_SUBCOMMANDS, subcommand) ? RUNS_SUBCOMMANDS[subcommand] : undefined;
  if (!handler) fail(RUNS_USAGE, 2);
  await handler({ subcommand, positional, configPath, services });
}

export function validRunId(id: string): boolean {
  return RUN_ID.test(id);
}

export async function resolveDataDir(configPath: string | undefined): Promise<{ dataDir: string; config: Awaited<ReturnType<typeof loadResolvedConfig>>['config'] }> {
  const resolved = await loadResolvedConfig({ requirePinManifest: false, ...(configPath ? { configPath } : {}) });
  return { dataDir: resolved.dataDir, config: resolved.config };
}

export async function enumerateRunDirectories(dataDir: string): Promise<string[]> {
  const root = await realpath(dataDir);
  const homes = [root, ...await sessionHomes(path.join(root, 'mcp-sessions'))];
  const directories: string[] = [];
  for (const home of homes) directories.push(...await runDirectoriesIn(path.join(home, 'runs')));
  return directories;
}

export async function readRunJson(file: string): Promise<unknown> {
  const directory = await lstat(path.dirname(file));
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('Unsafe run record directory.');
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_RUN_JSON_BYTES) throw new Error('Unsafe or oversized run record.');
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally { await handle.close(); }
}

async function sessionHomes(sessions: string): Promise<string[]> {
  if (!await privateDirectory(sessions, 'session root')) return [];
  const entries = await readdir(sessions);
  if (entries.length > MAX_SESSION_DIRECTORIES) throw invalidState(SESSION_SCAN_LIMIT_MESSAGE);
  const homes: string[] = [];
  for (const name of entries.filter((entry) => SESSION_NAME.test(entry)).sort()) {
    const home = path.join(sessions, name);
    if (await privateDirectory(home, 'session directory')) homes.push(home);
  }
  return homes;
}

async function runDirectoriesIn(runs: string): Promise<string[]> {
  if (!await privateDirectory(runs, 'run directory')) return [];
  const directories: string[] = [];
  for (const name of (await readdir(runs)).filter(validRunId).sort()) {
    const directory = path.join(runs, name);
    const info = await lstat(directory).catch(() => undefined);
    if (!info || info.isSymbolicLink() || !info.isDirectory() || foreignOwner(info.uid)) continue;
    directories.push(directory);
  }
  return directories;
}

async function privateDirectory(directory: string, label: string): Promise<boolean> {
  let info;
  try { info = await lstat(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || foreignOwner(info.uid)) throw invalidState(`An unsafe ${label} was found at ${directory}; inspect it manually.`);
  if (await realpath(directory).catch(() => undefined) !== path.resolve(directory)) throw invalidState(`The ${label} path ${directory} changed or resolves through a link; inspect it manually.`);
  return true;
}

function foreignOwner(uid: number): boolean {
  return typeof process.getuid === 'function' && uid !== process.getuid();
}

function invalidState(message: string): Error {
  return Object.assign(new Error(message), supervisorError('VSUP_INVALID_STATE', message));
}

function print(value: unknown): void { process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`); }

function requireArity(invocation: RunsInvocation, counts: readonly number[]): void {
  if (!counts.includes(invocation.positional.length)) fail(RUNS_USAGE, 2);
}

async function listRuns(invocation: RunsInvocation): Promise<void> {
  requireArity(invocation, [1]);
  const { dataDir } = await resolveDataDir(invocation.configPath);
  const rows: unknown[] = [];
  for (const directory of await enumerateRunDirectories(dataDir)) {
    try { rows.push(await readRunJson(path.join(directory, 'meta.json'))); }
    catch { continue; }
  }
  print(rows);
}

async function showRun(invocation: RunsInvocation): Promise<void> {
  requireArity(invocation, [2]);
  const id = invocation.positional[1] ?? '';
  if (!validRunId(id)) fail('runs show requires a valid run UUID.', 2);
  const { dataDir } = await resolveDataDir(invocation.configPath);
  const directory = path.join(dataDir, 'runs', id);
  const [record, result] = await Promise.all([
    readRunJson(path.join(directory, 'meta.json')),
    readRunJson(path.join(directory, 'result.json')).catch(() => undefined),
  ]);
  print({ record, result });
}

async function tailRun(invocation: RunsInvocation): Promise<void> {
  requireArity(invocation, [2]);
  const id = invocation.positional[1] ?? '';
  if (!validRunId(id)) fail('runs tail requires a valid run UUID.', 2);
  const { dataDir, config } = await resolveDataDir(invocation.configPath);
  const events = await readNdjsonRecovering(path.join(dataDir, 'runs', id, 'events.ndjson'), { maxBytes: config.limits.maxEventBytes });
  print(events.slice(-20));
}

async function cleanupRuns(invocation: RunsInvocation): Promise<void> {
  const id = invocation.positional[1];
  requireArity(invocation, [id ? 2 : 1]);
  if (id && !validRunId(id)) fail('runs cleanup run-id must be a valid UUID.', 2);
  print(await invocation.services.cleanup(invocation.configPath, id));
}

async function reportRun(invocation: RunsInvocation): Promise<void> {
  const { positional } = invocation;
  const id = positional[1];
  if (!id || !validRunId(id)) fail('runs verify/export requires a run UUID.', 2);
  let output: string | undefined; let validationFile: string | undefined; let include: ('patch' | 'events')[] = [];
  const seen = new Set<string>();
  for (let index = 2; index < positional.length; index++) {
    const flag = positional[index]!; const value = positional[++index];
    if (seen.has(flag) || !value || value.startsWith('--')) fail('Invalid or repeated report option.', 2);
    seen.add(flag);
    if (flag === '--out') output = path.resolve(value);
    else if (flag === '--validation') validationFile = path.resolve(value);
    else if (flag === '--include' && invocation.subcommand === 'export' && value.split(',').every((item) => item === 'patch' || item === 'events')) include = [...new Set(value.split(',') as ('patch' | 'events')[])];
    else fail(REPORT_USAGE, 2);
  }
  if (!output) fail('--out is required.', 2);
  const { dataDir } = await resolveDataDir(invocation.configPath);
  const directory = await locateSavedRun(dataDir, id);
  print(await exportReport({ directory, output, include, ...(validationFile ? { validationFile } : {}), verifyOnly: invocation.subcommand === 'verify' }));
}
