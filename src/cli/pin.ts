import path from 'node:path';
import { resolveAppServerExecutable } from '../backends/app-server.js';
import { PinCheckError, inspectInstall, serializePinManifest, type RecordProblems } from '../backends/app-server/pin.js';
import { replacePinManifest } from '../backends/app-server/pin-replace.js';
import { loadResolvedConfig } from '../config/config.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { supervisorError, type SupervisorConfig } from '../contracts.js';
import { createPrivateFile } from '../security/paths.js';
import { selectedVibeVersion } from '../backends/app-server/supported-vibe.js';
import { fail } from './fail.js';
import { isOwnerLockContention, type OwnerLock } from '../core/owner-lock.js';
import { acquirePreparationLock, preparationRunningMessage } from '../preparation/lock.js';

export const PIN_MANIFEST_USAGE = 'Usage: vibe-supervisor pin-manifest [--config <path>] [--executable <path>] [--output <path>] [--force]';

export interface PinManifestArgs {
  config?: string;
  executable?: string;
  output?: string;
  force: boolean;
}

export function parsePinManifestArgs(args: string[]): PinManifestArgs {
  const parsed: PinManifestArgs = { force: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--config' || arg === '--executable' || arg === '--output') {
      if (seen.has(arg)) fail(`${arg} may be supplied once.`, 2);
      seen.add(arg);
      const value = args[++index];
      if (!value || value.startsWith('--')) fail(`${arg} requires a path.`, 2);
      if (arg === '--config') parsed.config = value;
      else if (arg === '--executable') parsed.executable = value;
      else parsed.output = value;
    } else if (arg === '--force') {
      if (seen.has(arg)) fail('--force may be supplied once.', 2);
      seen.add(arg);
      parsed.force = true;
    } else fail(`Unknown pin-manifest argument: ${String(arg)}. ${PIN_MANIFEST_USAGE}`, 2);
  }
  return parsed;
}

const WARNED_PATHS = 3;

function recordWarning(problems: RecordProblems): string | undefined {
  const parts: string[] = [];
  for (const [label, list] of [['without a sha256 hash', problems.unhashed], ['that differ from their RECORD hash', problems.mismatched]] as const) {
    if (list.length === 0) continue;
    const shown = list.slice(0, WARNED_PATHS).join(', ');
    parts.push(`${list.length} file(s) ${label} (${shown}${list.length > WARNED_PATHS ? ', ...' : ''})`);
  }
  return parts.length === 0 ? undefined : `Warning: RECORD lists ${parts.join('; ')}. The manifest still pins what is installed now.\n`;
}

function print(line: string): void { process.stdout.write(`${line}\n`); }

interface PinConfig { config: SupervisorConfig; dataDir?: string }

async function loadConfigForPin(options: PinManifestArgs): Promise<PinConfig> {
  try {
    const resolved = await loadResolvedConfig({ requirePinManifest: false, ...(options.config ? { configPath: options.config } : {}) });
    return { config: resolved.config, dataDir: resolved.dataDir };
  }
  catch (error) {
    if (options.output === undefined) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    if (options.executable === undefined) {
      process.stderr.write('The configuration could not be read. Pass --executable <path> together with --output <path> to write the manifest without it.\n');
      throw error;
    }
    process.stderr.write(`Ignoring the unusable configuration and using --executable and --output alone: ${reason}\n`);
    return { config: { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits }, retention: { ...DEFAULT_CONFIG.retention } } };
  }
}

async function lockForConfiguredManifest(loaded: PinConfig, target: string): Promise<OwnerLock | undefined> {
  const configured = loaded.config.paths?.vibePinManifest;
  if (loaded.dataDir === undefined || !configured || !path.isAbsolute(configured) || path.resolve(configured) !== target) return undefined;
  try { return await acquirePreparationLock(loaded.config, loaded.dataDir); }
  catch (error) {
    if (isOwnerLockContention(error)) fail(preparationRunningMessage(error).replace('run prepare check again', 'run pin-manifest again'), 1);
    throw error;
  }
}

export async function pinManifestCommand(args: string[]): Promise<void> {
  const options = parsePinManifestArgs(args);
  const loaded = await loadConfigForPin(options);
  const { config } = loaded;
  const output = options.output ?? config.paths?.vibePinManifest;
  if (!output) fail('No output path: set paths.vibe_pin_manifest in the configuration or pass --output <path>.', 2);
  if (!path.isAbsolute(output)) fail('The output path must be absolute.', 2);
  let executable: string;
  try { executable = await resolveAppServerExecutable(config, options.executable); }
  catch { throw Object.assign(new Error('The vibe-app-server executable could not be located.'), { supervisor: supervisorError('VSUP_VIBE_NOT_FOUND', 'The vibe-app-server executable could not be located; pass --executable <path> or set paths.vibe or paths.app_server.') }); }
  const target = path.resolve(output);
  const lock = options.force ? await lockForConfiguredManifest(loaded, target) : undefined;
  try { await writePinManifest(options, config, executable, target, output); }
  finally { await lock?.release(); }
}

async function writePinManifest(options: PinManifestArgs, config: SupervisorConfig, executable: string, target: string, output: string): Promise<void> {
  let inspection;
  try { inspection = await inspectInstall({ executable, expectedVersion: selectedVibeVersion(config.vibeVersion) }); }
  catch (error) {
    if (error instanceof PinCheckError) {
      const detail = Object.keys(error.details).length > 0 ? ` ${JSON.stringify(error.details)}` : '';
      throw Object.assign(new Error(error.message), { supervisor: supervisorError(error.code, `${error.message} [${error.reason}]${detail}`, { reason: error.reason }) });
    }
    throw error;
  }
  const { manifest, recordProblems } = inspection;
  if (options.force) await replacePinManifest(target, manifest);
  else {
    await createPrivateFile(target, serializePinManifest(manifest), 'wx').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail(`${output} already exists; pass --force to replace it.`, 2);
      throw error;
    });
  }
  const warning = recordWarning(recordProblems);
  if (warning) process.stderr.write(warning);
  print(`Wrote the pin manifest for Vibe ${manifest.version} (${Object.keys(manifest.files).length} files, RECORD sha256 ${manifest.record_sha256}) to ${output}.`);
  print('The manifest records what is installed now: review that this is the Vibe build you intend to supervise before relying on it.');
}
