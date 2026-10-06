#!/usr/bin/env node
import { chmod, copyFile, lstat, open, readFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { parse } from 'smol-toml';
import { getConfigPath, getDataDir, loadConfig } from './config/config.js';
import { validateConfig } from './config/validation.js';
import { DEFAULT_CONFIG } from './config/defaults.js';
import { createPrivateDir, createPrivateFile } from './security/paths.js';
import { runDoctor } from './diagnostics/doctor.js';
import { installProcessGuards } from './diagnostics/background.js';
import { readNdjsonRecovering } from './persistence/ndjson.js';
import { startMcpStdio } from './mcp/server.js';
import type { RunManagerTools } from './mcp/tools.js';
import { supervisorError, type SupervisorErrorCode } from './contracts.js';
import { environmentSecrets, redactSecrets } from './security/redaction.js';

const APP_VERSION = '0.9.0-rc.3';

function print(value: unknown): void { process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`); }
function fail(message: string, code = 1): never { process.exitCode = code; throw Object.assign(new Error(message), { code: 'VSUP_INVALID_ARGUMENT' }); }
const CODEX_TOOL_TIMEOUT_SECONDS = 600;
function quoteToml(value: string): string { return JSON.stringify(value); }
function defaultConfigToml(): string {
  const limits = DEFAULT_CONFIG.limits;
  return `version = 1\nbackend = "${DEFAULT_CONFIG.backend}"\nallowed_workspace_roots = []\nmax_concurrent_runs = 2\nmax_queued_runs = 8\nworker_idle_ttl_seconds = 600\n\n[retention]\ndays = 7\npreserve_failed_runs = true\n\n[limits]\nreview_timeout_seconds = ${limits.reviewTimeoutSeconds}\nedit_timeout_seconds = ${limits.editTimeoutSeconds}\nmax_turns_review = ${limits.maxTurnsReview}\nmax_turns_edit = ${limits.maxTurnsEdit}\nmax_event_bytes = ${limits.maxEventBytes}\nmax_transcript_bytes = ${limits.maxTranscriptBytes}\nmax_artifact_bytes = ${limits.maxArtifactBytes}\nmax_mcp_result_chars = ${limits.maxMcpResultChars}\nmcp_result_format = "${limits.mcpResultFormat}"\n\n[phase1]\nallow_temporary_trust = false\n\n[security]\nallow_shell_in_review = false\nallow_shell_in_edit = false\nallow_network_tools = false\nlog_raw_acp = false\npersist_reasoning = false\n`;
}

async function initConfig(): Promise<void> {
  const dir = getDataDir(); await createPrivateDir(dir);
  const config = getConfigPath();
  try { await lstat(config); fail(`Config already exists at ${config}; edit it directly or back it up first.`, 2); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await createPrivateFile(config, defaultConfigToml());
  print(`Created private config at ${config}`);
}

async function validateConfigFile(file: string): Promise<void> {
  const source = await readFile(file, 'utf8');
  if (Buffer.byteLength(source) > 1_048_576) fail('Config exceeds 1 MiB.', 2);
  const config = validateConfig(parse(source));
  print({ valid: true, config });
}

async function configureCodex(scope: 'user' | 'project', dryRun: boolean, projectPath = process.cwd()): Promise<void> {
  if (scope === 'project') {
    const info = await lstat(path.resolve(projectPath));
    if (info.isSymbolicLink() || !info.isDirectory()) fail('Project path must be an existing real directory.', 2);
  }
  const baseDir = scope === 'user' ? path.join(process.env.HOME ?? homedir(), '.codex') : path.join(path.resolve(projectPath), '.codex');
  const file = path.join(baseDir, 'config.toml');
  try { const info = await lstat(file); if (info.isSymbolicLink() || !info.isFile()) fail(`Refusing unsafe Codex config path: ${file}`, 2); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const executable = process.execPath;
  const cliPath = path.resolve(process.argv[1] ?? 'dist/cli.js');
  const block = `[mcp_servers.vibe-supervisor]\ncommand = ${quoteToml(executable)}\nargs = [${quoteToml(cliPath)}, "serve", "--stdio"]\ntool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SECONDS}\n`;
  let original = '';
  try { original = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let updated: string;
  let parsedExisting: Record<string, unknown> = {};
  if (original.trim()) parsedExisting = parse(original) as Record<string, unknown>;
  const servers = parsedExisting.mcp_servers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) fail('Codex config mcp_servers must be a table; no changes were made.', 2);
  const existingEntry = servers && typeof servers === 'object' ? (servers as Record<string, unknown>)['vibe-supervisor'] : undefined;
  const target = { command: executable, args: [cliPath, 'serve', '--stdio'], tool_timeout_sec: CODEX_TOOL_TIMEOUT_SECONDS };
  if (existingEntry && typeof existingEntry === 'object' && !Array.isArray(existingEntry)) {
    const entry = existingEntry as Record<string, unknown>;
    if (entry.command === target.command && JSON.stringify(entry.args) === JSON.stringify(target.args) && entry.tool_timeout_sec === target.tool_timeout_sec && Object.keys(entry).length === 3) {
      print({ changed: false, file, config: block }); return;
    }
  }
  const targetHeader = /^\s*(?:\[\s*mcp_servers\s*\.\s*(?:"vibe-supervisor"|'vibe-supervisor'|vibe-supervisor)\s*\]|\[\s*"mcp_servers"\s*\.\s*(?:"vibe-supervisor"|'vibe-supervisor'|vibe-supervisor)\s*\])\s*(?:#.*)?$/m;
  const headerMatch = targetHeader.exec(original);
  if (headerMatch) {
    const start = headerMatch.index;
    const nextHeader = /^\s*\[[^\]]+\]\s*(?:#.*)?$/gm;
    nextHeader.lastIndex = start + headerMatch[0].length;
    const next = nextHeader.exec(original);
    const end = next?.index ?? original.length;
    updated = `${original.slice(0, start)}${block.trimEnd()}\n${original.slice(end)}`;
  } else {
    if (existingEntry !== undefined) fail('Found a non-section mcp_servers.vibe-supervisor entry that cannot be updated safely.', 2);
    updated = `${original}${original.length === 0 || original.endsWith('\n\n') ? '' : original.endsWith('\n') ? '\n' : '\n\n'}${block}`;
  }
  try { parse(updated); } catch { fail('Generated Codex TOML did not validate; no changes were made.', 2); }
  if (dryRun) { print({ changed: true, file, preview: block }); return; }
  await createPrivateDir(baseDir);
  try { const info = await lstat(file); if (info.isSymbolicLink() || !info.isFile()) fail(`Refusing unsafe Codex config path: ${file}`, 2); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let backup: string | undefined;
  if (original) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(file, backup);
    await chmod(backup, 0o600);
  }
  const temp = `${file}.${process.pid}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(updated, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
  print({ changed: true, file, backup });
}

async function getManager(): Promise<{ manager: RunManagerTools & { initialize(): Promise<void>; runsList(): Promise<unknown[]>; cleanup(id?: string): Promise<unknown>; shutdown(): Promise<void> }; config: Awaited<ReturnType<typeof loadConfig>>; dataDir: string }> {
  const config = await loadConfig({ createDataDir: true });
  const dataDir = config.paths?.dataDir ?? getDataDir();
  const { RunManager } = await import('./core/run-manager.js');
  const manager = new RunManager(config, dataDir) as RunManagerTools & { initialize(): Promise<void>; runsList(): Promise<unknown[]>; cleanup(id?: string): Promise<unknown>; shutdown(): Promise<void> };
  await manager.initialize();
  return { manager, config, dataDir };
}

async function serve(): Promise<void> {
  const { manager, config } = await getManager();
  const handle = startMcpStdio(manager, { config, onError: (message) => process.stderr.write(`${message}\n`) });
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
      print('Usage: vibe-supervisor <serve --stdio|doctor [--json]|init|configure-codex --user|--project [--dry-run]|test-acp|config validate [path]|runs list|show|tail|cleanup [run-id]|--version>'); return;
    }
    if (command === 'init') { if (args.length) fail('init accepts no options.', 2); return await initConfig(); }
    if (command === 'config' && args[0] === 'validate') { if (args.length > 2) fail('Usage: vibe-supervisor config validate [path]', 2); return await validateConfigFile(args[1] ?? getConfigPath()); }
    if (command === 'configure-codex') {
      const scopeArg = args.find((arg) => arg.startsWith('--scope='))?.slice('--scope='.length);
      const scopeIndex = args.indexOf('--scope');
      const scope = args.includes('--user') ? 'user' : args.includes('--project') ? 'project' : (scopeArg ?? (scopeIndex >= 0 ? args[scopeIndex + 1] : undefined) ?? 'user');
      if (args.includes('--user') && args.includes('--project')) fail('Choose only one scope.', 2);
      if (args.includes('--user') && scope !== 'user' || args.includes('--project') && scope !== 'project') fail('Conflicting Codex configuration scopes.', 2);
      if (scope !== 'user' && scope !== 'project') fail('Scope must be user or project.', 2);
      const known = new Set(['--user', '--project', '--dry-run', '--scope', '--path']);
      if (args.some((arg) => arg.startsWith('--') && !known.has(arg) && !arg.startsWith('--scope=') && !arg.startsWith('--path='))) fail('Unknown configure-codex option.', 2);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? '';
        if (arg === '--scope' || arg === '--path') { const next = args[i + 1]; if (!next || next.startsWith('--')) fail(`${arg} requires a value.`, 2); i++; continue; }
        if (arg.startsWith('--scope=') || arg.startsWith('--path=') || arg === '--user' || arg === '--project' || arg === '--dry-run') continue;
        fail(`Unexpected configure-codex argument: ${arg}`, 2);
      }
      const pathIndex = args.indexOf('--path');
      const projectPath = args.find((arg) => arg.startsWith('--path='))?.slice('--path='.length) ?? (pathIndex >= 0 ? args[pathIndex + 1] : undefined) ?? process.cwd();
      return await configureCodex(scope, args.includes('--dry-run'), projectPath);
    }
    if (command === 'doctor') {
      if (args.some((arg) => arg !== '--json')) fail('Unknown doctor option.', 2);
      const config = await loadConfig(); const report = await runDoctor(config);
      print(args.includes('--json') ? report : report.checks.map((check) => `${check.status === 'unverified' ? 'UNVERIFIED' : check.ok ? 'PASS' : 'CHECK'} ${check.name}: ${check.message}${check.version ? ` (${check.version})` : ''}${check.stderr_tail ? `\n  Vibe ACP stderr: ${check.stderr_tail}` : ''}`).join('\n'));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    if (command === 'serve') { if (args.length !== 1 || args[0] !== '--stdio') fail('Usage: vibe-supervisor serve --stdio', 2); return await serve(); }
    if (command === 'runs') return await runsCommand(args);
    if (command === 'test-acp') {
      if (args.length) fail('test-acp accepts no options.', 2);
      const config = await loadConfig();
      const backendModulePath = './backends/acp.js';
      const { AcpBackend } = await import(backendModulePath);
      const report = await new AcpBackend(config).probe();
      print(report);
      if (!report.available) {
        process.exitCode = 1;
        const tail = report.details?.stderr_tail;
        if (typeof tail === 'string' && tail) process.stderr.write(`vibe-acp stderr:\n${redactSecrets(tail, environmentSecrets())}\n`);
      }
      return;
    }
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runCli();
}
