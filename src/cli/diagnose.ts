import { resolve } from 'node:path';
import { loadConfig } from '../config/config.js';
import { validateConfig } from '../config/validation.js';
import { formatDoctorCheck, runDoctor } from '../diagnostics/doctor.js';
import type { SupervisorConfig } from '../contracts.js';
import { configInvalid, fail } from './fail.js';
import { readConfigDocument } from './setup.js';

function print(value: unknown): void { process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`); }

export function parseDoctorArgs(args: string[]): { json: boolean; config?: string } {
  let json = false; let config: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--config') {
      const value = args[++index];
      if (!value || value.startsWith('--')) fail('--config requires a path.', 2);
      config = value;
    } else fail('Unknown doctor option. Usage: vibe-supervisor doctor [--json] [--config <path>]', 2);
  }
  return { json, ...(config ? { config } : {}) };
}

async function loadForDoctor(configPath: string | undefined): Promise<SupervisorConfig> {
  if (!configPath) return loadConfig();
  const file = resolve(configPath);
  const raw = await readConfigDocument(file);
  if (raw === undefined) fail(`Config not found: ${file}`, 2);
  try { return validateConfig(raw); } catch (error) { throw configInvalid(`Invalid supervisor configuration: ${(error as Error).message}`); }
}

export async function doctorCommand(args: string[]): Promise<void> {
  const options = parseDoctorArgs(args);
  const config = await loadForDoctor(options.config);
  const report = await runDoctor(config);
  if (options.json) print(report);
  else print(report.checks.map(formatDoctorCheck).join('\n'));
  if (!report.ok) process.exitCode = 1;
}
