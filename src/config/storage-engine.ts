import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { supervisorError } from '../contracts.js';

/** Read-only preflight before isolated startup can replace any configuration. */
export async function assertAppServerStorage(root: string): Promise<void> {
  let entries;
  try {
    const runs = path.join(root, 'runs');
    const info = await lstat(runs);
    if (!info.isDirectory() || info.isSymbolicLink()) throw supervisorError('VSUP_CONFIG_INVALID', 'Storage run root is unsafe.');
    entries = await readdir(runs, { withFileTypes: true });
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (entries.length > 10_000) throw supervisorError('VSUP_CONFIG_INVALID', 'Storage inventory exceeds the bounded engine check.');
  for (const entry of entries) {
    if (!/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw supervisorError('VSUP_CONFIG_INVALID', 'Storage contains an unsafe run directory.');
    let handle;
    try {
      handle = await open(path.join(root, 'runs', entry.name, 'meta.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile() || info.size > 1_048_576) throw new Error('Invalid run metadata.');
      const value: unknown = JSON.parse(await handle.readFile('utf8'));
      if (!value || typeof value !== 'object' || !('backend' in value) || value.backend !== 'app-server') throw new Error('Foreign or unknown engine.');
    } catch {
      throw supervisorError('VSUP_CONFIG_INVALID', 'Select separate Supervisor 2.0 storage; existing run identity is foreign or unverifiable. No configuration or run was migrated.');
    } finally { await handle?.close(); }
  }
}

export async function assertAppServerTemplateStorage(root: string): Promise<void> {
  await assertAppServerStorage(root);
  const sessions = path.join(root, 'mcp-sessions');
  let entries;
  try {
    const info = await lstat(sessions);
    if (!info.isDirectory() || info.isSymbolicLink()) throw supervisorError('VSUP_CONFIG_INVALID', 'Storage session root is unsafe.');
    entries = await readdir(sessions, { withFileTypes: true });
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (entries.length > 4096) throw supervisorError('VSUP_CONFIG_INVALID', 'Session inventory exceeds the bounded engine check.');
  for (const entry of entries) {
    if (!/^session-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
    const directory = path.join(sessions, entry.name);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw supervisorError('VSUP_CONFIG_INVALID', 'Storage contains an unsafe session directory.');
    await assertAppServerStorage(directory);
  }
}
