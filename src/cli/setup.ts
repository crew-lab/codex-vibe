import { chmod, copyFile, lstat, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parse, stringify } from 'smol-toml';
import { resolveCommand } from '../backends/launcher.js';
import { configFingerprint, loadResolvedConfig, resolveConfigSelection } from '../config/config.js';
import { APP_VERSION } from '../version.js';
import { validateConfig } from '../config/validation.js';
import { formatDoctorCheck, runDoctor } from '../diagnostics/doctor.js';
import { assertWorkspaceRootScope, createPrivateDir, createPrivateFile, expandHome, resolveCanonicalWorkspaceRoot, validateWorkspaceRootsAtUse } from '../security/paths.js';
import { applyCodexPlan, planCodexConfig, type CodexScope } from './codex.js';
import { configInvalid, fail } from './fail.js';

type Document = Record<string, unknown>;

export interface SetupOptions {
  workspace: string;
  configPath?: string;
  codex: CodexScope;
  isolated: boolean;
  yes: boolean;
  dryRun: boolean;
  interactive: boolean;
  confirm?: (question: string) => Promise<boolean>;
}

export interface WorkspaceUpdate { file: string; created: boolean; added: boolean; canonical: string; notes: string[]; backup?: string }
export interface WorkspacePlan { file: string; created: boolean; added: boolean; canonical: string; notes: string[]; text?: string; changed: boolean }

export const RELOAD_NOTE = 'Restart the Codex MCP server to apply the new allowlist (reconnect the client when it uses --isolated); a running server keeps the list it started with.';

const MAX_CONFIG_BYTES = 1_048_576;

function say(line: string): void { process.stdout.write(`${line}\n`); }

export function initialConfigText(): string {
  return stringify({ version: 1, allowed_workspace_roots: [], paths: {} });
}

export async function canonicalWorkspace(input: string): Promise<string> {
  let resolved: string;
  try { resolved = assertWorkspaceRootScope(input); }
  catch (error) { return fail(`Workspace is too broad or unsafe: ${input}. ${(error as Error).message}`, 2); }
  let info;
  try { info = await lstat(resolved); } catch { return fail(`Workspace does not exist: ${resolved}`, 2); }
  if (info.isSymbolicLink()) fail(`Workspace must not be a symlink; pass the real directory: ${resolved}`, 2);
  if (!info.isDirectory()) fail(`Workspace must be a directory: ${resolved}`, 2);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) fail(`Workspace must use its canonical path without symlink components: ${resolved}`, 2);
  try { await resolveCanonicalWorkspaceRoot(canonical); } catch (error) { fail(`Workspace is too broad or unsafe: ${canonical}. ${(error as Error).message}`, 2); }
  return canonical;
}

export async function readConfigSource(file: string): Promise<{ text: string; document: Document } | undefined> {
  let info;
  try { info = await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  if (info.isSymbolicLink() || !info.isFile()) fail(`Refusing unsafe config path: ${file}`, 2);
  if (info.size > MAX_CONFIG_BYTES) fail('Config exceeds 1 MiB.', 2);
  try { const text = await readFile(file, 'utf8'); return { text, document: parse(text) as Document }; }
  catch (error) { throw configInvalid(`Invalid supervisor configuration: ${(error as Error).message}`); }
}

export async function readConfigDocument(file: string): Promise<Document | undefined> {
  return (await readConfigSource(file))?.document;
}

async function comparable(root: string): Promise<string> {
  const resolved = path.resolve(expandHome(root));
  try { return await realpath(resolved); } catch { return resolved; }
}

async function addRoot(document: Document, canonical: string): Promise<boolean> {
  const roots = document.allowed_workspace_roots ?? [];
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== 'string')) fail('allowed_workspace_roots must be an array of strings; no changes were made.', 2);
  for (const root of roots as string[]) if (await comparable(root) === canonical) return false;
  document.allowed_workspace_roots = [...(roots as string[]), canonical];
  return true;
}

async function resolvePaths(document: Document, notes: string[]): Promise<boolean> {
  const existing = document.paths ?? {};
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) fail('paths must be a table; no changes were made.', 2);
  const paths = existing as Record<string, unknown>;
  let changed = false;
  for (const [key, name] of [['vibe', 'vibe']] as const) {
    if (typeof paths[key] === 'string') { notes.push(`${name}: keeping configured ${String(paths[key])}`); continue; }
    try {
      const resolved = path.resolve(await resolveCommand(name, process.env.PATH === undefined ? {} : { PATH: process.env.PATH }));
      paths[key] = resolved; changed = true;
      notes.push(`${name}: resolved from PATH to ${resolved}`);
    } catch { notes.push(`${name}: not found on PATH; [paths].${key} left unset. Install it and rerun setup, or set it by hand.`); }
  }
  document.paths = paths;
  return changed;
}

async function writeConfig(file: string, text: string, created: boolean): Promise<void> {
  if (created) { await createPrivateFile(file, text); return; }
  const temp = `${file}.${process.pid}.tmp`;
  await rm(temp, { force: true });
  await createPrivateFile(temp, text);
  await rename(temp, file);
}

export async function planWorkspaceConfig(canonical: string, options: { resolveExecutables: boolean; configPath?: string }): Promise<WorkspacePlan> {
  const file = resolveConfigSelection(options.configPath).configPath;
  const existing = await readConfigSource(file);
  const created = existing === undefined;
  const document: Document = existing?.document ?? parse(initialConfigText()) as Document;
  const notes: string[] = [];
  const added = await addRoot(document, canonical);
  const pathsChanged = options.resolveExecutables ? await resolvePaths(document, notes) : false;
  try {
    const config = validateConfig(document);
    await validateWorkspaceRootsAtUse(config.allowedWorkspaceRoots);
  }
  catch (error) { throw configInvalid(`Invalid supervisor configuration at ${file}; no changes were made: ${(error as Error).message} Supported fields are version, allowed_workspace_roots, retention, limits, and paths.vibe. Remove unsupported fields instead of relying on them.`); }
  const changed = created || added || pathsChanged;
  return { file, created, added, canonical, notes, changed, ...(changed ? { text: stringify(document) } : {}) };
}

export async function applyWorkspacePlan(plan: WorkspacePlan): Promise<WorkspaceUpdate> {
  const { text, changed: _changed, ...update } = plan;
  if (text === undefined) return update;
  await createPrivateDir(path.dirname(plan.file));
  if (plan.created) { await writeConfig(plan.file, text, true); return update; }
  const backup = `${plan.file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(plan.file, backup);
  await chmod(backup, 0o600);
  await writeConfig(plan.file, text, false);
  return { ...update, backup };
}

export async function updateWorkspaceConfig(workspace: string, options: { resolveExecutables: boolean; configPath?: string }): Promise<WorkspaceUpdate> {
  const canonical = await canonicalWorkspace(workspace);
  return await applyWorkspacePlan(await planWorkspaceConfig(canonical, options));
}

function reportUpdate(update: WorkspaceUpdate): void {
  if (update.backup) say(`Rewrote ${update.file} without its comments or layout; the previous file is kept as ${update.backup}`);
  if (update.added) say(RELOAD_NOTE);
}

export function parseSetupArgs(args: string[]): Omit<SetupOptions, 'interactive' | 'confirm'> {
  let workspace: string | undefined; let configPath: string | undefined; let codex: CodexScope = 'user'; let isolated = true; let yes = false; let dryRun = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--workspace' || arg === '--codex' || arg === '--config') {
      if (seen.has(arg)) fail(`${arg} may be supplied once.`, 2);
      seen.add(arg);
      const value = args[++index];
      if (!value || value.startsWith('--')) fail(`${arg} requires a value.`, 2);
      if (arg === '--workspace') workspace = value;
      else if (arg === '--config') configPath = value;
      else if (value === 'user' || value === 'project') codex = value;
      else fail('--codex must be user or project.', 2);
    } else if (arg === '--isolated' || arg === '--yes' || arg === '--dry-run') {
      if (seen.has(arg)) fail(`${arg} may be supplied once.`, 2);
      seen.add(arg);
      if (arg === '--isolated') isolated = true;
      else if (arg === '--yes') yes = true;
      else dryRun = true;
    }
    else fail(`Unknown setup argument: ${String(arg)}. Usage: vibe-supervisor setup --workspace <dir> [--codex user|project] [--isolated] [--yes|--dry-run]`, 2);
  }
  if (!workspace) fail('Usage: vibe-supervisor setup --workspace <dir> [--codex user|project] [--isolated] [--yes|--dry-run]', 2);
  if (yes && dryRun) fail('--yes and --dry-run cannot be combined.', 2);
  return { workspace, ...(configPath ? { configPath } : {}), codex, isolated, yes, dryRun };
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}

export async function runSetup(options: SetupOptions): Promise<void> {
  const canonical = await canonicalWorkspace(options.workspace);
  const configPlan = await planWorkspaceConfig(canonical, { resolveExecutables: true, ...(options.configPath ? { configPath: options.configPath } : {}) });
  const selection = resolveConfigSelection(options.configPath);
  const plannedConfig = configPlan.text === undefined
    ? (await loadResolvedConfig({ configPath: configPlan.file })).config
    : validateConfig(parse(configPlan.text));
  const plannedFingerprint = configFingerprint(plannedConfig);
  const plan = await planCodexConfig(options.codex, canonical, options.isolated, configPlan.file);
  if (options.dryRun) {
    say(`Dry run: ${configPlan.created ? 'would create private config' : 'would use config'} at ${configPlan.file}`);
    say(`Provenance: ${JSON.stringify({ executable: process.execPath, application_version: APP_VERSION, config_path: configPlan.file, config_source: selection.source, config_fingerprint: plannedFingerprint, data_directory: selection.dataDir, storage_role: 'configuration-template', vibe_version: 'unknown-not-probed' })}`);
    say(configPlan.added ? `Would allow workspace: ${canonical}` : `Workspace already allowed: ${canonical}`);
    for (const note of configPlan.notes) say(note);
    say(plan.changed ? `Would change ${plan.file}:\n${plan.block}` : `Codex config is already up to date: ${plan.file}`);
    say('Nothing was written.');
    return;
  }
  const update = await applyWorkspacePlan(configPlan);
  say(`${update.created ? 'Created private config' : 'Using config'} at ${update.file}`);
  say(update.added ? `Allowed workspace: ${update.canonical}` : `Workspace already allowed: ${update.canonical}`);
  for (const note of update.notes) say(note);
  reportUpdate(update);
  const resolved = await loadResolvedConfig({ configPath: configPlan.file });
  const report = await runDoctor(resolved.config, { configPath: resolved.configPath, configSource: resolved.source, dataDir: resolved.dataDir, fingerprint: resolved.fingerprint });
  say(`Provenance: ${JSON.stringify({ executable: report.provenance.executable, application_version: report.provenance.app_version, vibe_version: report.provenance.vibe_version ?? null, config_path: resolved.configPath, config_source: selection.source, config_fingerprint: resolved.fingerprint, data_directory: resolved.dataDir, storage_role: 'configuration-template' })}`);
  const lines = report.checks.map(formatDoctorCheck).filter((line) => !line.startsWith('PASS '));
  say(lines.length ? `Doctor (non-PASS checks only):\n${lines.join('\n')}` : 'Doctor: all checks PASS.');
  if (!plan.changed) say(`Codex config is already up to date: ${plan.file}`);
  else {
    say(`Codex config change for ${plan.file}:\n${plan.block}`);
    const approved = options.yes || (options.interactive && await (options.confirm ?? askYesNo)(`Write this to ${plan.file}?`));
    if (approved) {
      const { backup } = await applyCodexPlan(plan);
      say(`Wrote ${plan.file}${backup ? ` (backup ${backup})` : ''}. Restart Codex to load it.`);
    } else say(`Not written. Rerun with --yes to write it.`);
  }
  if (!report.ok) process.exitCode = 1;
}

export async function setupCommand(args: string[]): Promise<void> {
  const parsed = parseSetupArgs(args);
  await runSetup({ ...parsed, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
}

export async function allowCommand(args: string[]): Promise<void> {
  let configPath: string | undefined; let workspace: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--config') {
      const value = args[++index]; if (!value || value.startsWith('--') || configPath) fail('allow --config requires one path.', 2);
      configPath = value;
    } else if (!workspace) workspace = args[index]; else fail('Usage: vibe-supervisor allow [--config <path>] <dir>', 2);
  }
  if (!workspace || workspace.startsWith('--')) return fail('Usage: vibe-supervisor allow [--config <path>] <dir>', 2);
  const update = await updateWorkspaceConfig(workspace, { resolveExecutables: false, ...(configPath ? { configPath } : {}) });
  say(update.added ? `Allowed workspace: ${update.canonical} (${update.file})` : `Workspace already allowed: ${update.canonical}`);
  reportUpdate(update);
}
