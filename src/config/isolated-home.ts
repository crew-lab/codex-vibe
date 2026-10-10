import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'smol-toml';
import { loadConfig, resolveConfigSelection } from './config.js';
import { validateConfig } from './validation.js';
import { acquireOwnerLock, isOwnerLockContention } from '../core/owner-lock.js';
import type { OwnerLock } from '../core/owner-lock.js';
import { createPrivateDir, createPrivateFile } from '../security/paths.js';

export interface IsolatedHome { home: string; lock: OwnerLock; adopted: boolean }

const SESSION_NAME = /^session-[A-Za-z0-9]{6}$/;
const MAX_CREATE_ATTEMPTS = 8;

function reportToStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function readTemplate(env: NodeJS.ProcessEnv, configPath?: string): Promise<{ source: string; dataDir: string }> {
  const selection = resolveConfigSelection(configPath, env);
  await loadConfig({ env, ...(configPath ? { configPath: selection.configPath } : {}) });
  const handle = await open(selection.configPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let source: string;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1_048_576) throw new Error('Isolation requires a regular configuration file no larger than 1 MiB.');
    source = await handle.readFile('utf8');
  } finally { await handle.close(); }
  if (Buffer.byteLength(source) > 1_048_576) throw new Error('Configuration exceeds 1 MiB.');
  validateConfig(parse(source));
  return { source, dataDir: selection.dataDir };
}

async function candidates(sessions: string, report: (message: string) => void): Promise<string[]> {
  const found: Array<{ directory: string; usedAt: number }> = [];
  for (const name of await readdir(sessions)) {
    if (!SESSION_NAME.test(name)) continue;
    const directory = path.join(sessions, name);
    try {
      const info = await lstat(directory);
      const foreign = typeof process.getuid === 'function' && info.uid !== process.getuid();
      if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || foreign) {
        report(`Skipping unsafe isolated session directory ${directory}; inspect it manually.`);
        continue;
      }
      found.push({ directory, usedAt: info.mtimeMs });
    } catch (error) {
      report(`Skipping isolated session directory ${directory}: ${(error as Error).message}`);
    }
  }
  return found.sort((a, b) => b.usedAt - a.usedAt).map(entry => entry.directory);
}

async function writeSnapshot(home: string, source: string): Promise<void> {
  const target = path.join(home, 'config.toml');
  const temporary = path.join(home, `config.toml.${process.pid}.${Date.now()}.tmp`);
  try {
    await createPrivateFile(temporary, source);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function claim(directory: string, source: string, report: (message: string) => void): Promise<OwnerLock | undefined> {
  let lock: OwnerLock;
  try { lock = await acquireOwnerLock(directory); }
  catch (error) {
    if (!isOwnerLockContention(error)) report(`Skipping isolated session directory ${directory}: ${(error as Error).message}`);
    return undefined;
  }
  try {
    await writeSnapshot(directory, source);
    return lock;
  } catch (error) {
    await lock.release();
    report(`Skipping isolated session directory ${directory}: ${(error as Error).message}`);
    return undefined;
  }
}

export async function prepareIsolatedHome(env: NodeJS.ProcessEnv = process.env, report: (message: string) => void = reportToStderr, configPath?: string): Promise<IsolatedHome> {
  const template = await readTemplate(env, configPath);
  const source = template.source;
  const sessions = path.join(template.dataDir, 'mcp-sessions');
  await createPrivateDir(sessions);
  for (const directory of await candidates(sessions, report)) {
    const lock = await claim(directory, source, report);
    if (lock) return { home: directory, lock, adopted: true };
  }
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const home = await mkdtemp(path.join(sessions, 'session-'));
    await createPrivateDir(home);
    const lock = await claim(home, source, report);
    if (lock) return { home, lock, adopted: false };
  }
  throw new Error('Could not claim a private session directory; retry shortly.');
}
