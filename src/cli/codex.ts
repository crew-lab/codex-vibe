import { chmod, copyFile, lstat, open, readFile, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { editStartSchema, reviewStartSchema, statusSchema } from '../mcp/schemas.js';
import { createPrivateDir } from '../security/paths.js';
import { fail } from './fail.js';

export type CodexScope = 'user' | 'project';
export interface CodexPlan { file: string; baseDir: string; block: string; changed: boolean; original: string; updated: string }
export interface CodexConfigFile { file: string; baseDir: string }
export interface CodexServers { original: string; servers: Record<string, unknown> }
export interface CodexLaunch { executable: string; cliPath: string }

export const CODEX_TOOL_TIMEOUT_SECONDS = 600;
const CODEX_STARTUP_TIMEOUT_SECONDS = 30;
const TOOL_TIMEOUT_MARGIN_SECONDS = 60;
export const DEFAULT_SERVER_NAME = 'vibe-supervisor';
const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function longestWaitSeconds(): number {
  const limits = [reviewStartSchema, editStartSchema, statusSchema].map((schema) => schema.shape.wait_seconds.unwrap().maxValue);
  if (limits.some((limit) => limit === null || !Number.isFinite(limit))) throw new Error('A tool wait_seconds schema has no finite maximum.');
  return Math.max(...(limits as number[]));
}

export const MAX_TOOL_WAIT_SECONDS = longestWaitSeconds();
export const MIN_CODEX_TOOL_TIMEOUT_SECONDS = MAX_TOOL_WAIT_SECONDS + TOOL_TIMEOUT_MARGIN_SECONDS;

export class CodexConfigProblem extends Error {}

function quoteToml(value: string): string { return JSON.stringify(value); }

async function assertSafeFile(file: string): Promise<void> {
  try { const info = await lstat(file); if (info.isSymbolicLink() || !info.isFile()) throw new CodexConfigProblem(`Refusing unsafe Codex config path: ${file}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export function isServerName(value: string): boolean {
  return SERVER_NAME.test(value);
}

export function codexConfigFile(scope: CodexScope, projectPath: string): CodexConfigFile {
  const baseDir = scope === 'user' ? path.join(process.env.HOME ?? homedir(), '.codex') : path.join(path.resolve(projectPath), '.codex');
  return { baseDir, file: path.join(baseDir, 'config.toml') };
}

export function installationLaunch(): CodexLaunch {
  return { executable: process.execPath, cliPath: path.resolve(process.argv[1] ?? 'dist/cli.js') };
}

export function serveArgs(cliPath: string, isolated: boolean, configPath?: string): string[] {
  return [cliPath, 'serve', '--stdio', ...(isolated ? ['--isolated'] : []), ...(configPath ? ['--config', path.resolve(configPath)] : [])];
}

async function assertReadableFile(file: string): Promise<void> {
  try { if (!(await stat(file)).isFile()) throw new CodexConfigProblem(`Codex config path is not a regular file: ${file}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export async function readCodexServers(file: string): Promise<CodexServers> {
  await assertReadableFile(file);
  let original = '';
  try { original = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let parsedExisting: Record<string, unknown> = {};
  if (original.trim()) {
    try { parsedExisting = parse(original) as Record<string, unknown>; }
    catch (error) { throw new CodexConfigProblem(`Codex config ${file} is not valid TOML (${(error as Error).message.split('\n')[0]})`); }
  }
  const servers = parsedExisting.mcp_servers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) throw new CodexConfigProblem(`Codex config ${file}: mcp_servers must be a table`);
  return { original, servers: (servers ?? {}) as Record<string, unknown> };
}

export async function planCodexConfig(scope: CodexScope, projectPath: string, isolated: boolean, configPath?: string, serverName: string = DEFAULT_SERVER_NAME): Promise<CodexPlan> {
  if (!isServerName(serverName)) fail('The server name may use letters, digits, - and _ only (at most 64).', 2);
  if (scope === 'project') {
    const info = await lstat(path.resolve(projectPath));
    if (info.isSymbolicLink() || !info.isDirectory()) fail('Project path must be an existing real directory.', 2);
  }
  const { baseDir, file } = codexConfigFile(scope, projectPath);
  const { executable, cliPath } = installationLaunch();
  const launchArgs = serveArgs(cliPath, isolated, configPath);
  const block = `[mcp_servers.${serverName}]\ncommand = ${quoteToml(executable)}\nargs = [${launchArgs.map(quoteToml).join(', ')}]\nstartup_timeout_sec = ${CODEX_STARTUP_TIMEOUT_SECONDS}\ntool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SECONDS}\n`;
  let read: CodexServers;
  try { await assertSafeFile(file); read = await readCodexServers(file); }
  catch (error) { if (error instanceof CodexConfigProblem) fail(`${error.message}; no changes were made.`, 2); throw error; }
  const { original, servers } = read;
  const existingEntry = Object.hasOwn(servers, serverName) ? servers[serverName] : undefined;
  const target = { command: executable, args: launchArgs, startup_timeout_sec: CODEX_STARTUP_TIMEOUT_SECONDS, tool_timeout_sec: CODEX_TOOL_TIMEOUT_SECONDS };
  if (existingEntry && typeof existingEntry === 'object' && !Array.isArray(existingEntry)) {
    const entry = existingEntry as Record<string, unknown>;
    if (entry.command === target.command && JSON.stringify(entry.args) === JSON.stringify(target.args) && entry.startup_timeout_sec === target.startup_timeout_sec && entry.tool_timeout_sec === target.tool_timeout_sec && Object.keys(entry).length === 4) {
      return { file, baseDir, block, changed: false, original, updated: original };
    }
  }
  const key = `(?:"${serverName}"|'${serverName}'|${serverName})`;
  const targetHeader = new RegExp(`^\\s*(?:\\[\\s*mcp_servers\\s*\\.\\s*${key}\\s*\\]|\\[\\s*"mcp_servers"\\s*\\.\\s*${key}\\s*\\])\\s*(?:#.*)?$`, 'm');
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
    if (existingEntry !== undefined) fail(`Found a non-section mcp_servers.${serverName} entry that cannot be updated safely.`, 2);
    updated = `${original}${original.length === 0 || original.endsWith('\n\n') ? '' : original.endsWith('\n') ? '\n' : '\n\n'}${block}`;
  }
  try { parse(updated); } catch { fail('Generated Codex TOML did not validate; no changes were made.', 2); }
  return { file, baseDir, block, changed: true, original, updated };
}

export async function applyCodexPlan(plan: CodexPlan): Promise<{ backup?: string }> {
  await createPrivateDir(plan.baseDir);
  try { await assertSafeFile(plan.file); }
  catch (error) { if (error instanceof CodexConfigProblem) fail(error.message, 2); throw error; }
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
