import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, loadResolvedConfig } from '../config/config.js';
import { configExclusions, prepareTaskInputs, taskInputManifestSchema, verifyTaskInputs } from '../preparation/task-inputs.js';
import { readOwnedFile } from '../reporting/private-files.js';
import { RunManager } from '../core/run-manager.js';
import { selectedConfigPolicy } from '../config/policy.js';
import { z } from 'zod';
import { resolveAdmittedWorkspace } from '../security/paths.js';

function parse(args: string[], allowed: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!; const value = args[index + 1];
    if (!allowed.includes(key) || !value || value.startsWith('--') || values.has(key)) throw new Error('Invalid task command arguments');
    values.set(key, value);
  }
  return values;
}

export async function taskCommand(args: string[]): Promise<unknown> {
  if (args[0] === 'authorize') {
    const values = parse(args.slice(1), ['--request', '--owner-reference', '--expires-at', '--config']);
    for (const key of ['--request', '--owner-reference', '--expires-at', '--config']) if (!values.has(key)) throw new Error(`Missing ${key}`);
    const document = z.object({ operation: z.enum(['review', 'edit']), request: z.record(z.string(), z.unknown()) }).strict().parse(JSON.parse((await readOwnedFile(path.resolve(values.get('--request')!), 256 * 1024)).toString('utf8')));
    const resolved = await loadResolvedConfig({ configPath: path.resolve(values.get('--config')!), createDataDir: false, requirePinManifest: false });
    const manager = new RunManager(resolved.config, resolved.dataDir, [], undefined, { policy: selectedConfigPolicy(resolved.configPath), usageDataDir: resolved.dataDir });
    return manager.authorizeDispatch(document.operation, document.request as unknown as Parameters<RunManager['authorizeDispatch']>[1], values.get('--owner-reference')!, values.get('--expires-at')!);
  }
  if (args[0] === 'prepare') {
    const values = parse(args.slice(1), ['--source', '--base', '--files', '--output-paths', '--out', '--contract', '--config']);
    for (const key of ['--source', '--base', '--files', '--out']) if (!values.has(key)) throw new Error(`Missing ${key}`);
    const source = path.resolve(values.get('--source')!);
    const config = await loadConfig({ createDataDir: false, ...(values.has('--config') ? { configPath: path.resolve(values.get('--config')!) } : {}) });
    const files = values.get('--files')!.split(',');
    const outputPaths = values.get('--output-paths')?.split(',');
    return prepareTaskInputs({ source, base: values.get('--base')!, files, output: values.get('--out')!, allowedRoots: config.allowedWorkspaceRoots, ...(outputPaths ? { outputPaths } : {}), ...(values.has('--contract') ? { contractFile: path.resolve(values.get('--contract')!) } : {}), exclusions: await configExclusions(config, await realpath(source)) });
  }
  if (args[0] === 'verify') {
    const values = parse(args.slice(1), ['--dir', '--files', '--config']);
    if (!values.has('--dir')) throw new Error('Missing --dir');
    const directory = path.resolve(values.get('--dir')!);
    const config = await loadConfig({ createDataDir: false, ...(values.has('--config') ? { configPath: path.resolve(values.get('--config')!) } : {}) });
    const manifest = taskInputManifestSchema.parse(JSON.parse((await readOwnedFile(path.join(directory, 'manifest.json'), 256 * 1024)).toString('utf8')));
    await resolveAdmittedWorkspace(manifest.source, config.allowedWorkspaceRoots);
    const exclusions = await configExclusions(config, manifest.source);
    return verifyTaskInputs(directory, { allowedRoots: config.allowedWorkspaceRoots, exclusions }, values.has('--files') ? values.get('--files')!.split(',') : undefined);
  }
  throw new Error('Usage: vibe-supervisor task authorize --request <private-json> --owner-reference <instruction-reference> --expires-at <UTC-ISO-time> --config <file> | task prepare --source <canonical-git-root> --base <full-commit> --files <path,...> --out <new-private-directory> [--output-paths <path,...>] [--contract <json>] [--config <file>] | task verify --dir <prepared-directory> [--files <path,...>] [--config <file>]');
}
