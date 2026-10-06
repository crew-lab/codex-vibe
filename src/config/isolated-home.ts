import { constants } from 'node:fs';
import { mkdtemp, open } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'smol-toml';
import { getConfigPath, getDataDir, loadConfig } from './config.js';
import { validateConfig } from './validation.js';
import { createPrivateDir, createPrivateFile } from '../security/paths.js';

/** Snapshot configuration only. Each independently connected MCP server owns its own storage. */
export async function prepareIsolatedHome(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  // Validate canonical ancestors using the same configuration loader as ordinary startup.
  await loadConfig({ env });
  const handle = await open(getConfigPath(env), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let source: string;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1_048_576) throw new Error('Isolation requires a regular configuration file no larger than 1 MiB.');
    source = await handle.readFile('utf8');
  } finally { await handle.close(); }
  if (Buffer.byteLength(source) > 1_048_576) throw new Error('Configuration exceeds 1 MiB.');
  const config = validateConfig(parse(source));
  if (config.paths?.dataDir) throw new Error('Isolated startup refuses paths.data_dir; use VIBE_SUPERVISOR_HOME to select the template home instead.');
  const sessions = path.join(getDataDir(env), 'mcp-sessions');
  await createPrivateDir(sessions);
  const home = await mkdtemp(path.join(sessions, 'session-'));
  await createPrivateDir(home);
  await createPrivateFile(path.join(home, 'config.toml'), source);
  return home;
}
