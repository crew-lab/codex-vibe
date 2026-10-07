import { resolve } from 'node:path';
import { getConfigPath, loadConfig } from '../config/config.js';
import { ignoredConfigKeys, validateConfig } from '../config/validation.js';
import { formatDoctorCheck, runDoctor } from '../diagnostics/doctor.js';
import { environmentSecrets, redactSecrets } from '../security/redaction.js';
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

async function loadForDoctor(configPath: string | undefined): Promise<{ config: SupervisorConfig; warnings: string[] }> {
  const file = configPath ? resolve(configPath) : getConfigPath();
  const raw = await readConfigDocument(file);
  if (configPath && raw === undefined) fail(`Config not found: ${file}`, 2);
  const warnings = raw === undefined ? [] : ignoredConfigKeys(raw).map((key) => `ignored key ${key}; it has no effect`);
  if (!configPath) return { config: await loadConfig(), warnings };
  let config: SupervisorConfig;
  try { config = validateConfig(raw); } catch (error) { throw configInvalid(`Invalid supervisor configuration: ${(error as Error).message}`); }
  return { config: config.paths?.dataDir ? { ...config, paths: { ...config.paths, dataDir: resolve(config.paths.dataDir) } } : config, warnings };
}

export async function doctorCommand(args: string[]): Promise<void> {
  const options = parseDoctorArgs(args);
  const { config, warnings } = await loadForDoctor(options.config);
  const report = await runDoctor(config);
  if (options.json) print({ ...report, warnings });
  else print([...report.checks.map(formatDoctorCheck), ...warnings.map((warning) => `WARN config: ${warning}`)].join('\n'));
  if (!report.ok) process.exitCode = 1;
}

export async function testAcpCommand(args: string[]): Promise<void> {
  if (args.length) fail('test-acp accepts no options.', 2);
  process.stderr.write('test-acp is now part of doctor: run "vibe-supervisor doctor" and read its acp-initialize check.\n');
  const config = await loadConfig();
  const backendModulePath = '../backends/acp.js';
  const { AcpBackend } = await import(backendModulePath);
  const report = await new AcpBackend(config).probe();
  print(report);
  if (!report.available) {
    process.exitCode = 1;
    const tail = report.details?.stderr_tail;
    if (typeof tail === 'string' && tail) process.stderr.write(`vibe-acp stderr:\n${redactSecrets(tail, environmentSecrets())}\n`);
  }
}
