#!/usr/bin/env node
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants as fsConstants } from 'node:fs';
import { loadConfig, loadResolvedConfig } from './config/config.js';
import type { OwnerLock } from './core/owner-lock.js';
import { prepareIsolatedHome } from './config/isolated-home.js';
import { APP_VERSION } from './version.js';
import { doctorCommand } from './cli/diagnose.js';
import { fail } from './cli/fail.js';
import { allowCommand, setupCommand } from './cli/setup.js';
import { installProcessGuards } from './diagnostics/background.js';
import { readNdjsonRecovering } from './persistence/ndjson.js';
import { startMcpStdio } from './mcp/server.js';
import type { RunManagerTools } from './mcp/tools.js';
import { supervisorError, type SupervisorErrorCode } from './contracts.js';
import { environmentSecrets, redactSecrets } from './security/redaction.js';

function print(value: unknown): void { process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`); }
async function getManager(ownerLock?: OwnerLock, configPath?: string): Promise<{ manager: RunManagerTools & { initialize(): Promise<void>; runsList(): Promise<unknown[]>; cleanup(id?: string): Promise<unknown>; startAutomaticRetention?(): void; shutdown(): Promise<{ timedOut: boolean }> }; config: Awaited<ReturnType<typeof loadConfig>>; dataDir: string }> {
  const resolved = await loadResolvedConfig({ createDataDir: true, ...(configPath ? { configPath } : {}) });
  const { config, dataDir } = resolved;
  const { RunManager } = await import('./core/run-manager.js');
  const manager = new RunManager(config, dataDir, [], ownerLock) as RunManagerTools & { initialize(): Promise<void>; runsList(): Promise<unknown[]>; cleanup(id?: string): Promise<unknown>; startAutomaticRetention?(): void; shutdown(): Promise<{ timedOut: boolean }> };
  await manager.initialize();
  return { manager, config, dataDir };
}

async function serve(ownerLock?: OwnerLock, configPath?: string): Promise<void> {
  let ready: Awaited<ReturnType<typeof getManager>>;
  try { ready = await getManager(ownerLock, configPath); }
  catch (error) { await ownerLock?.release(); throw error; }
  const { manager, config } = ready;
  const handle = startMcpStdio(manager, { config, onError: (message) => process.stderr.write(`${message}\n`) });
  manager.startAutomaticRetention?.();
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return; closing = true;
    await handle.close().catch(() => {});
    const outcome = await manager.shutdown().catch((error) => { process.stderr.write(`Shutdown failed: ${String((error as Error).message)}\n`); return undefined; });
    if (outcome?.timedOut) process.stderr.write('', () => process.exit(1));
  };
  installProcessGuards({ shutdown: close });
  process.stdin.once('end', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
}

function validRunId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function runsCommand(args: string[]): Promise<void> {
  let configPath: string | undefined; const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--config') {
      const value = args[++index];
      if (!value || value.startsWith('--') || configPath) fail('runs --config requires one path.', 2);
      configPath = path.resolve(value);
    } else positional.push(args[index] as string);
  }
  const [subcommand, id] = positional;
  if (positional.length !== (subcommand === 'list' ? 1 : subcommand === 'cleanup' ? (id ? 2 : 1) : 2)) fail('Usage: vibe-supervisor runs [--config <path>] <list|show|tail|cleanup> [run-id]', 2);
  const resolved = await loadResolvedConfig(configPath ? { configPath } : {}); const config = resolved.config; const dataDir = resolved.dataDir;
  const runsDir = path.join(dataDir, 'runs');
  if (subcommand === 'list') {
    let entries: string[];
    try { entries = await readdir(runsDir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { print([]); return; } throw error; }
    const rows: unknown[] = [];
    for (const runId of entries.filter(validRunId)) {
      try {
        const record = await readJsonPrivate(path.join(runsDir, runId, 'meta.json'));
        rows.push(record);
      } catch { /* ignore partial or invalid run directories */ }
    }
    print(rows); return;
  }
  if (subcommand === 'show') {
    if (!id || !validRunId(id)) fail('runs show requires a valid run UUID.', 2);
    const directory = path.join(runsDir, id);
    const [record, result] = await Promise.all([
      readJsonPrivate(path.join(directory, 'meta.json')),
      readJsonPrivate(path.join(directory, 'result.json')).catch(() => undefined),
    ]);
    print({ record, result }); return;
  }
  if (subcommand === 'tail') {
    if (!id || !validRunId(id)) fail('runs tail requires a valid run UUID.', 2);
    const events = await readNdjsonRecovering(path.join(runsDir, id, 'events.ndjson'), { maxBytes: config.limits.maxEventBytes });
    print(events.slice(-20)); return;
  }
  if (subcommand === 'cleanup') {
    if (id && !validRunId(id)) fail('runs cleanup run-id must be a valid UUID.', 2);
    const { manager } = await getManager(undefined, configPath);
    try { print(await manager.cleanup(id)); } finally { await manager.shutdown(); }
    return;
  }
  fail('Usage: vibe-supervisor runs <list|show|tail|cleanup> [run-id]', 2);
}

async function readJsonPrivate(file: string): Promise<unknown> {
  const directory = await lstat(path.dirname(file));
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('Unsafe run record directory.');
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error('Unsafe or oversized run record.');
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally { await handle.close(); }
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;
  try {
    if (command === '--version' || command === '-v') { print(APP_VERSION); return; }
    if (command === 'help' || command === '--help' || command === '-h' || !command) {
      print('Usage: vibe-supervisor <setup --workspace <dir> [--config <path>] [--codex user|project] [--isolated] [--yes|--dry-run]|allow [--config <path>] <dir>|doctor [--json] [--config <path>]|serve --stdio [--config <path>] [--isolated]|runs [--config <path>] list|show|tail|cleanup [run-id]|--version>'); return;
    }
    if (command === 'doctor') return await doctorCommand(args);
    if (command === 'setup') return await setupCommand(args);
    if (command === 'allow') return await allowCommand(args);
    if (command === 'serve') {
      if (!args.includes('--stdio')) fail('Usage: vibe-supervisor serve --stdio [--config <path>] [--isolated]', 2);
      let isolated = false; let configPath: string | undefined; let stdio = false;
      for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--stdio') { if (stdio) fail('Duplicate --stdio.', 2); stdio = true; continue; }
        if (arg === '--isolated') { if (isolated) fail('Duplicate --isolated.', 2); isolated = true; continue; }
        if (arg === '--config') {
          const value = args[++index];
          if (!value || value.startsWith('--') || configPath) fail('--config requires one path.', 2);
          configPath = path.resolve(value); continue;
        }
        fail('Usage: vibe-supervisor serve --stdio [--config <path>] [--isolated]', 2);
      }
      if (isolated) {
        const { home, lock, adopted } = await prepareIsolatedHome(process.env, undefined, configPath);
        process.env.VIBE_SUPERVISOR_HOME = home;
        process.stderr.write(`Vibe private session directory (${adopted ? 'adopted' : 'created'}): ${home}\n`);
        return await serve(lock);
      }
      return await serve(undefined, configPath);
    }
    if (command === 'runs') return await runsCommand(args);
    fail(`Unknown command: ${command}`, 2);
  } catch (error) {
    const errorValue = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; supervisor?: unknown } : {};
    const code = typeof errorValue.code === 'string' && errorValue.code.startsWith('VSUP_') ? errorValue.code as SupervisorErrorCode : 'VSUP_INTERNAL';
    const detail = typeof errorValue.message === 'string' ? errorValue.message : 'Command failed.';
    const safe = errorValue.supervisor && typeof errorValue.supervisor === 'object' ? errorValue.supervisor as { code?: string; message?: string; remediation?: string } : supervisorError(code, detail);
    process.stderr.write(`${redactSecrets(`${safe.code ?? code}: ${safe.message ?? detail}${safe.remediation ? ` ${safe.remediation}` : ''}`, environmentSecrets())}\n`);
    process.exitCode = process.exitCode || 1;
  }
}

const entryPath = process.argv[1] ? await realpath(path.resolve(process.argv[1])).catch(() => undefined) : undefined;
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void runCli();
}
