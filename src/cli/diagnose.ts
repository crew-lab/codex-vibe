import { loadResolvedConfig, resolveConfigSelection } from '../config/config.js';
import { formatDoctorCheck, runDoctor } from '../diagnostics/doctor.js';
import type { SupervisorConfig } from '../contracts.js';
import { fail } from './fail.js';

function print(value: unknown): void { process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`); }

export function parseDoctorArgs(args: string[]): { json: boolean; config?: string } {
  let json = false; let config: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') {
      if (json) fail('--json may be supplied once.', 2);
      json = true;
    }
    else if (arg === '--config') {
      const value = args[++index];
      if (!value || value.startsWith('--') || config) fail('--config requires one path.', 2);
      config = value;
    } else fail('Unknown doctor option. Usage: vibe-supervisor doctor [--json] [--config <path>]', 2);
  }
  return { json, ...(config ? { config } : {}) };
}

async function loadForDoctor(configPath: string | undefined): Promise<{ config: SupervisorConfig; selection: ReturnType<typeof resolveConfigSelection>; fingerprint: string }> {
  if (!configPath) {
    const resolved = await loadResolvedConfig();
    return { config: resolved.config, selection: resolved, fingerprint: resolved.fingerprint };
  }
  const selection = resolveConfigSelection(configPath);
  const resolved = await loadResolvedConfig({ configPath: selection.configPath });
  return { config: resolved.config, selection, fingerprint: resolved.fingerprint };
}

export async function doctorCommand(args: string[]): Promise<void> {
  const options = parseDoctorArgs(args);
  const resolved = await loadForDoctor(options.config);
  const report = await runDoctor(resolved.config, { configPath: resolved.selection.configPath, configSource: resolved.selection.source, dataDir: resolved.selection.dataDir, fingerprint: resolved.fingerprint });
  if (options.json) print(report);
  else print(report.checks.map(formatDoctorCheck).join('\n'));
  if (!report.ok) process.exitCode = 1;
}
