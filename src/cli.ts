#!/usr/bin/env node
import { validationCommand } from "./cli/validation.js";
import { prepareCommand } from "./cli/prepare.js";
import { runsCommand } from './cli/runs.js';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, loadResolvedConfig, resolveConfigSelection } from './config/config.js';
import { selectedConfigPolicy } from './config/policy.js';
import { inspectWorkspaceRoots } from './security/paths.js';
import type { OwnerLock } from './core/owner-lock.js';
import { prepareIsolatedHome } from './config/isolated-home.js';
import { createIsolatedRunRouter } from './core/isolated-run-router.js';
import { APP_VERSION } from './version.js';
import { doctorCommand } from './cli/diagnose.js';
import { fail } from './cli/fail.js';
import { pinManifestCommand } from './cli/pin.js';
import { allowCommand, setupCommand } from './cli/setup.js';
import { installProcessGuards } from './diagnostics/background.js';
import { startMcpStdio } from './mcp/server.js';
import type { RunManagerTools } from './mcp/tools.js';
import { supervisorError, type SupervisorErrorCode } from './contracts.js';
import { environmentSecrets, redactSecrets } from './security/redaction.js';

function print(value: unknown): void { process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`); }
async function getManager(ownerLock?: OwnerLock, configPath?: string, isolatedHome?: string): Promise<{ manager: RunManagerTools & { initialize(): Promise<void>; runsList(): Promise<unknown[]>; cleanup(id?: string): Promise<unknown>; startAutomaticRetention?(): void; shutdown(): Promise<{ timedOut: boolean }> }; config: Awaited<ReturnType<typeof loadConfig>>; dataDir: string; policy: ReturnType<typeof selectedConfigPolicy> }> {
  const resolved = await loadResolvedConfig({ createDataDir: isolatedHome === undefined, requirePinManifest: false, ...(configPath ? { configPath } : {}) });
  const config = resolved.config;
  const dataDir = isolatedHome ?? resolved.dataDir;
  const policy = selectedConfigPolicy(resolved.configPath);
  for (const lost of (await inspectWorkspaceRoots(config.allowedWorkspaceRoots)).unavailable) process.stderr.write(`Allowed workspace root ${lost.root} is unavailable and denied until it is restored: ${lost.reason}\n`);
  const { RunManager } = await import('./core/run-manager.js');
  const manager = new RunManager(config, dataDir, [], ownerLock, { policy, ...(isolatedHome ? { sessionId: path.basename(isolatedHome) } : {}) }) as RunManagerTools & { initialize(): Promise<void>; runsList(): Promise<unknown[]>; cleanup(id?: string): Promise<unknown>; startAutomaticRetention?(): void; shutdown(): Promise<{ timedOut: boolean }> };
  await manager.initialize();
  return { manager, config, dataDir, policy };
}

async function serve(ownerLock?: OwnerLock, configPath?: string, isolated?: { sessions: string; home: string }): Promise<void> {
  let ready: Awaited<ReturnType<typeof getManager>>;
  try { ready = await getManager(ownerLock, configPath, isolated?.home); }
  catch (error) { await ownerLock?.release(); throw error; }
  const { manager, config, policy } = ready;
  const tools = isolated ? createIsolatedRunRouter(manager, { sessions: isolated.sessions, currentHome: isolated.home, config, policy }) : manager;
  const stopRouting = isolated ? () => tools.shutdown() : undefined;
  const handle = startMcpStdio(tools, { config, onError: (message) => process.stderr.write(`${message}\n`) });
  manager.startAutomaticRetention?.();
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return; closing = true;
    await handle.close().catch(() => {});
    await stopRouting?.().catch((error: unknown) => process.stderr.write(`Isolated run routing shutdown failed: ${String((error as Error).message)}\n`));
    const outcome = await manager.shutdown().catch((error) => { process.stderr.write(`Shutdown failed: ${String((error as Error).message)}\n`); return undefined; });
    if (outcome?.timedOut) process.stderr.write('', () => process.exit(1));
  };
  installProcessGuards({ shutdown: close });
  process.stdin.once('end', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
}

async function cleanupWithManager(configPath: string | undefined, runId: string | undefined): Promise<unknown> {
  const { manager } = await getManager(undefined, configPath);
  try { return await manager.cleanup(runId); } finally { await manager.shutdown(); }
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;
  try {
    if (command === '--version' || command === '-v') { print(APP_VERSION); return; }
    if (command === 'help' || command === '--help' || command === '-h' || !command) {
      print('Usage: vibe-supervisor <setup --workspace <dir> [--config <path>] [--codex user|project] [--isolated] [--yes|--dry-run]|allow [--config <path>] <dir>|doctor [--json] [--config <path>]|pin-manifest [--config <path>] [--executable <path>] [--output <path>] [--force]|serve --stdio [--config <path>] [--isolated]|runs [--config <path>] list|show|tail|cleanup [run-id] | runs verify|export <run-id> --out <directory> [--include patch,events] [--validation <file>] | runs sarif <run-id> [--output <file>]|--version>'); return;
    }
    if (command === 'doctor') return await doctorCommand(args);
    if (command === 'pin-manifest') return await pinManifestCommand(args);
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
        const selected = resolveConfigSelection(configPath, process.env).configPath;
        const { home, sessions, lock, adopted } = await prepareIsolatedHome(process.env, undefined, configPath);
        process.env.VIBE_SUPERVISOR_HOME = home;
        process.stderr.write(`Vibe private session directory (${adopted ? 'adopted' : 'created'}): ${home}\nSelected configuration (reread before every readiness check and start): ${selected}\n`);
        return await serve(lock, selected, { home, sessions });
      }
      return await serve(undefined, configPath);
    }
    if (command === 'validation') { print(await validationCommand(args)); return; }
    if (command === 'prepare') { const result = await prepareCommand(args); print(result); if ((result as {status?: string}).status !== 'passed') process.exitCode = 1; return; }
    if (command === 'runs') return await runsCommand(args, { cleanup: cleanupWithManager });
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
