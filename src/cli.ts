#!/usr/bin/env node
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants as fsConstants } from 'node:fs';
import { parse } from 'smol-toml';
import { configFileIgnoredKeys, getConfigPath, getDataDir, loadConfig } from './config/config.js';
import { ignoredConfigKeys, validateConfig } from './config/validation.js';
import type { OwnerLock } from './core/owner-lock.js';
import { prepareIsolatedHome } from './config/isolated-home.js';
import { APP_VERSION } from './version.js';
import { applyCodexPlan, planCodexConfig, type CodexScope } from './cli/codex.js';
import { doctorCommand, testAcpCommand } from './cli/diagnose.js';
import { fail } from './cli/fail.js';
import { baselineCommand, auditEditCommand } from './cli/worker-tools.js';
import { allowCommand, initialConfigText, setupCommand } from './cli/setup.js';
import { createPrivateDir, createPrivateFile } from './security/paths.js';
import { installProcessGuards } from './diagnostics/background.js';
import { readNdjsonRecovering } from './persistence/ndjson.js';
import { startMcpStdio } from './mcp/server.js';
import type { RunManagerTools } from './mcp/tools.js';
import { supervisorError, type SupervisorErrorCode } from './contracts.js';
import { environmentSecrets, redactSecrets } from './security/redaction.js';

function print(value: unknown): void { process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`); }
async function initConfig(): Promise<void> {
  const dir = getDataDir(); await createPrivateDir(dir);
  const config = getConfigPath();
  try { await lstat(config); fail(`Config already exists at ${config}; edit it directly or back it up first.`, 2); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await createPrivateFile(config, initialConfigText());
  print(`Created private config at ${config}`);
}

async function validateConfigFile(file: string): Promise<void> {
  const source = await readFile(file, 'utf8');
  if (Buffer.byteLength(source) > 1_048_576) fail('Config exceeds 1 MiB.', 2);
  const raw = parse(source);
  const config = validateConfig(raw);
  const ignored = ignoredConfigKeys(raw);
  if (ignored.length) process.stderr.write(`Ignored config keys (no effect): ${ignored.join(', ')}\n`);
  print({ valid: true, config, ...(ignored.length ? { ignored_keys: ignored } : {}) });
}

async function configureCodex(scope: CodexScope, dryRun: boolean, projectPath = process.cwd(), isolated = false): Promise<void> {
  const plan = await planCodexConfig(scope, projectPath, isolated);
  if (!plan.changed) { print({ changed: false, file: plan.file, config: plan.block }); return; }
  if (dryRun) { print({ changed: true, file: plan.file, preview: plan.block }); return; }
  const { backup } = await applyCodexPlan(plan);
  print({ changed: true, file: plan.file, backup });
}

async function getManager(ownerLock?: OwnerLock): Promise<{ manager: RunManagerTools & { initialize(): Promise<void>; runsList(): Promise<unknown[]>; cleanup(id?: string): Promise<unknown>; startAutomaticRetention?(): void; shutdown(): Promise<void> }; config: Awaited<ReturnType<typeof loadConfig>>; dataDir: string }> {
  const config = await loadConfig({ createDataDir: true });
  const dataDir = config.paths?.dataDir ?? getDataDir();
  const { RunManager } = await import('./core/run-manager.js');
  const manager = new RunManager(config, dataDir, [], ownerLock) as RunManagerTools & { initialize(): Promise<void>; runsList(): Promise<unknown[]>; cleanup(id?: string): Promise<unknown>; startAutomaticRetention?(): void; shutdown(): Promise<void> };
  await manager.initialize();
  return { manager, config, dataDir };
}

async function serve(ownerLock?: OwnerLock): Promise<void> {
  const ignored = await configFileIgnoredKeys();
  if (ignored.length) process.stderr.write(`Ignored config keys (no effect): ${ignored.join(', ')}\n`);
  let ready: Awaited<ReturnType<typeof getManager>>;
  try { ready = await getManager(ownerLock); }
  catch (error) { await ownerLock?.release(); throw error; }
  const { manager, config } = ready;
  const handle = startMcpStdio(manager, { config, onError: (message) => process.stderr.write(`${message}\n`) });
  manager.startAutomaticRetention?.();
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return; closing = true;
    await handle.close().catch(() => {});
    await manager.shutdown().catch((error) => process.stderr.write(`Shutdown failed: ${String((error as Error).message)}\n`));
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
  const [subcommand, id] = args;
  if (args.length !== (subcommand === 'list' ? 1 : subcommand === 'cleanup' ? (id ? 2 : 1) : 2)) fail('Usage: vibe-supervisor runs <list|show|tail|cleanup> [run-id]', 2);
  const config = await loadConfig(); const dataDir = config.paths?.dataDir ?? getDataDir();
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
    const { manager } = await getManager();
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
      print('Usage: vibe-supervisor <setup --workspace <dir> [--codex user|project] [--isolated] [--yes]|allow <dir>|doctor [--json] [--config <path>]|serve --stdio [--isolated]|init|configure-codex --user|--project [--path <dir>] [--dry-run] [--isolated]|runs list|show|tail|cleanup [run-id]|baseline prepare manifest.json [--create]|audit-edit private-home run-id [--files /absolute/private/scope.json]|--version>'); return;
    }
    if (command === 'init') { if (args.length) fail('init accepts no options.', 2); return await initConfig(); }
    if (command === 'config' && args[0] === 'validate') {
      if (args.length > 2) fail('Usage: vibe-supervisor config validate [path]', 2);
      process.stderr.write('config validate is now part of doctor: run "vibe-supervisor doctor --config <path>".\n');
      return await validateConfigFile(args[1] ?? getConfigPath());
    }
    if (command === 'configure-codex') {
      const known = new Set(['--user', '--project', '--dry-run', '--isolated']);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? '';
        if (arg === '--path') { const next = args[i + 1]; if (!next || next.startsWith('--')) fail('--path requires a value.', 2); i++; continue; }
        if (!known.has(arg)) fail(arg.startsWith('--') ? 'Unknown configure-codex option.' : `Unexpected configure-codex argument: ${arg}`, 2);
      }
      if (args.includes('--user') && args.includes('--project')) fail('Choose only one scope.', 2);
      const pathIndex = args.indexOf('--path');
      if (pathIndex >= 0 && !args.includes('--project')) fail('--path requires --project.', 2);
      const scope: CodexScope = args.includes('--project') ? 'project' : 'user';
      return await configureCodex(scope, args.includes('--dry-run'), pathIndex >= 0 ? args[pathIndex + 1] : process.cwd(), args.includes('--isolated'));
    }
    if (command === 'baseline') { print(await baselineCommand(args)); return; }
    if (command === 'audit-edit') { const report = await auditEditCommand(args); print(report); if ((report as { status?: string }).status !== 'validated') process.exitCode = 1; return; }
    if (command === 'doctor') return await doctorCommand(args);
    if (command === 'setup') return await setupCommand(args);
    if (command === 'allow') return await allowCommand(args);
    if (command === 'serve') {
      if (args[0] !== '--stdio' || args.length > 2 || (args.length === 2 && args[1] !== '--isolated')) fail('Usage: vibe-supervisor serve --stdio [--isolated]', 2);
      if (args.includes('--isolated')) {
        const { home, lock, adopted } = await prepareIsolatedHome();
        process.env.VIBE_SUPERVISOR_HOME = home;
        process.stderr.write(`Vibe private session directory (${adopted ? 'adopted' : 'created'}): ${home}\n`);
        return await serve(lock);
      }
      return await serve();
    }
    if (command === 'runs') return await runsCommand(args);
    if (command === 'test-acp') return await testAcpCommand(args);
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
