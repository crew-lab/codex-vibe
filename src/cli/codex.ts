import { chmod, copyFile, lstat, open, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { createPrivateDir } from '../security/paths.js';
import { fail } from './fail.js';

export type CodexScope = 'user' | 'project';
export interface CodexPlan { file: string; baseDir: string; block: string; changed: boolean; original: string; updated: string }

const CODEX_TOOL_TIMEOUT_SECONDS = 600;
const CODEX_STARTUP_TIMEOUT_SECONDS = 30;

function quoteToml(value: string): string { return JSON.stringify(value); }

async function assertSafeFile(file: string): Promise<void> {
  try { const info = await lstat(file); if (info.isSymbolicLink() || !info.isFile()) fail(`Refusing unsafe Codex config path: ${file}`, 2); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export async function planCodexConfig(scope: CodexScope, projectPath: string, isolated: boolean, configPath?: string): Promise<CodexPlan> {
  if (scope === 'project') {
    const info = await lstat(path.resolve(projectPath));
    if (info.isSymbolicLink() || !info.isDirectory()) fail('Project path must be an existing real directory.', 2);
  }
  const baseDir = scope === 'user' ? path.join(process.env.HOME ?? homedir(), '.codex') : path.join(path.resolve(projectPath), '.codex');
  const file = path.join(baseDir, 'config.toml');
  await assertSafeFile(file);
  const executable = process.execPath;
  const cliPath = path.resolve(process.argv[1] ?? 'dist/cli.js');
  const launchArgs = [cliPath, 'serve', '--stdio', ...(isolated ? ['--isolated'] : []), ...(configPath ? ['--config', path.resolve(configPath)] : [])];
  const block = `[mcp_servers.vibe-supervisor]\ncommand = ${quoteToml(executable)}\nargs = [${launchArgs.map(quoteToml).join(', ')}]\nstartup_timeout_sec = ${CODEX_STARTUP_TIMEOUT_SECONDS}\ntool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SECONDS}\n`;
  let original = '';
  try { original = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let parsedExisting: Record<string, unknown> = {};
  if (original.trim()) {
    try { parsedExisting = parse(original) as Record<string, unknown>; }
    catch (error) { fail(`Codex config ${file} is not valid TOML (${(error as Error).message.split('\n')[0]}); no changes were made.`, 2); }
  }
  const servers = parsedExisting.mcp_servers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) fail('Codex config mcp_servers must be a table; no changes were made.', 2);
  const existingEntry = servers && typeof servers === 'object' ? (servers as Record<string, unknown>)['vibe-supervisor'] : undefined;
  const target = { command: executable, args: launchArgs, startup_timeout_sec: CODEX_STARTUP_TIMEOUT_SECONDS, tool_timeout_sec: CODEX_TOOL_TIMEOUT_SECONDS };
  if (existingEntry && typeof existingEntry === 'object' && !Array.isArray(existingEntry)) {
    const entry = existingEntry as Record<string, unknown>;
    if (entry.command === target.command && JSON.stringify(entry.args) === JSON.stringify(target.args) && entry.startup_timeout_sec === target.startup_timeout_sec && entry.tool_timeout_sec === target.tool_timeout_sec && Object.keys(entry).length === 4) {
      return { file, baseDir, block, changed: false, original, updated: original };
    }
  }
  const targetHeader = /^\s*(?:\[\s*mcp_servers\s*\.\s*(?:"vibe-supervisor"|'vibe-supervisor'|vibe-supervisor)\s*\]|\[\s*"mcp_servers"\s*\.\s*(?:"vibe-supervisor"|'vibe-supervisor'|vibe-supervisor)\s*\])\s*(?:#.*)?$/m;
  const headerMatch = targetHeader.exec(original);
  let updated: string;
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
  return { file, baseDir, block, changed: true, original, updated };
}

export async function applyCodexPlan(plan: CodexPlan): Promise<{ backup?: string }> {
  await createPrivateDir(plan.baseDir);
  await assertSafeFile(plan.file);
  let backup: string | undefined;
  if (plan.original) {
    backup = `${plan.file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(plan.file, backup);
    await chmod(backup, 0o600);
  }
  const temp = `${plan.file}.${process.pid}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(plan.updated, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, plan.file);
  return backup ? { backup } : {};
}
