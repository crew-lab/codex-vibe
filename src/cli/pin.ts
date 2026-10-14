import path from 'node:path';
import { resolveAppServerExecutable } from '../backends/app-server.js';
import { PinCheckError, generatePinManifest, serializePinManifest } from '../backends/app-server/pin.js';
import { loadResolvedConfig } from '../config/config.js';
import { supervisorError } from '../contracts.js';
import { createPrivateFile } from '../security/paths.js';
import { fail } from './fail.js';

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

function print(line: string): void { process.stdout.write(`${line}\n`); }

export async function pinManifestCommand(args: string[]): Promise<void> {
  const options = parsePinManifestArgs(args);
  const resolved = await loadResolvedConfig(options.config ? { configPath: options.config } : {});
  const { config } = resolved;
  const output = options.output ?? config.paths?.vibePinManifest;
  if (!output) fail('No output path: set paths.vibe_pin_manifest in the configuration or pass --output <path>.', 2);
  if (!path.isAbsolute(output)) fail('The output path must be absolute.', 2);
  let executable: string;
  try { executable = await resolveAppServerExecutable(config, options.executable); }
  catch { throw Object.assign(new Error('The vibe-app-server executable could not be located.'), { supervisor: supervisorError('VSUP_VIBE_NOT_FOUND', 'The vibe-app-server executable could not be located; pass --executable <path> or set paths.vibe or paths.app_server.') }); }
  let manifest;
  try { manifest = await generatePinManifest({ executable }); }
  catch (error) {
    if (error instanceof PinCheckError) {
      const detail = Object.keys(error.details).length > 0 ? ` ${JSON.stringify(error.details)}` : '';
      throw Object.assign(new Error(error.message), { supervisor: supervisorError(error.code, `${error.message} [${error.reason}]${detail}`, { reason: error.reason }) });
    }
    throw error;
  }
  await createPrivateFile(path.resolve(output), serializePinManifest(manifest), options.force ? 'w' : 'wx')
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail(`${output} already exists; pass --force to replace it.`, 2);
      throw error;
    });
  print(`Wrote the pin manifest for Vibe ${manifest.version} (${Object.keys(manifest.files).length} files, RECORD sha256 ${manifest.record_sha256}) to ${output}.`);
  print('The manifest records what is installed now: review that this is the Vibe build you intend to supervise before relying on it.');
}
