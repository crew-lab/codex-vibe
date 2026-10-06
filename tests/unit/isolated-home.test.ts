import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareIsolatedHome } from '../../src/config/isolated-home.js';
import { RunManager } from '../../src/core/run-manager.js';
import { loadConfig } from '../../src/config/config.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function template(source = 'version = 1\nallowed_workspace_roots = []\n'): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-isolation-')));
  dirs.push(root);
  await writeFile(path.join(root, 'config.toml'), source, { mode: 0o600 });
  return root;
}

describe('per-connection isolated storage', () => {
  it('allows simultaneous owners while preserving configuration and excluding source state', async () => {
    const source = 'version = 1\nbackend = "acp"\nallowed_workspace_roots = []\nworker_idle_ttl_seconds = 120\n';
    const root = await template(source);
    const env = { VIBE_SUPERVISOR_HOME: root };
    const shared = new RunManager(await loadConfig({ env }), root);
    await shared.initialize();
    const owners: RunManager[] = [];
    try {
      const homes = await Promise.all([prepareIsolatedHome(env), prepareIsolatedHome(env)]);
      expect(new Set(homes).size).toBe(2);
      for (const home of homes) {
        expect(await readdir(home)).toEqual(['config.toml']);
        expect(await readFile(path.join(home, 'config.toml'), 'utf8')).toBe(source);
        expect((await stat(home)).mode & 0o777).toBe(0o700);
        expect((await stat(path.join(home, 'config.toml'))).mode & 0o777).toBe(0o600);
        const owner = new RunManager(await loadConfig({ env: { VIBE_SUPERVISOR_HOME: home } }), home);
        owners.push(owner); await owner.initialize();
      }
      expect(await readFile(path.join(root, 'config.toml'), 'utf8')).toBe(source);
    } finally { await Promise.all(owners.map(owner => owner.shutdown())); await shared.shutdown(); }
  });

  it('rejects explicit shared storage without creating a session', async () => {
    const root = await template('version = 1\nallowed_workspace_roots = []\n[paths]\ndata_dir = "/some/shared/directory"\n');
    await expect(prepareIsolatedHome({ VIBE_SUPERVISOR_HOME: root })).rejects.toThrow('paths.data_dir');
    expect(await readdir(root)).toEqual(['config.toml']);
  });

  it('rejects symlinked configuration and template ancestors', async () => {
    const root = await template();
    await rm(path.join(root, 'config.toml'));
    await writeFile(path.join(root, 'actual.toml'), 'version = 1\nallowed_workspace_roots = []\n');
    await symlink(path.join(root, 'actual.toml'), path.join(root, 'config.toml'));
    await expect(prepareIsolatedHome({ VIBE_SUPERVISOR_HOME: root })).rejects.toThrow();
    const other = await template();
    await symlink(other, path.join(root, 'alias'));
    await expect(prepareIsolatedHome({ VIBE_SUPERVISOR_HOME: path.join(root, 'alias') })).rejects.toThrow();
  });

  it('fails closed for invalid, oversized or missing configuration', async () => {
    const root = await template('version = 1\nallow_shell = true\n');
    await expect(prepareIsolatedHome({ VIBE_SUPERVISOR_HOME: root })).rejects.toThrow();
    await writeFile(path.join(root, 'config.toml'), '#'.repeat(1_048_577));
    await expect(prepareIsolatedHome({ VIBE_SUPERVISOR_HOME: root })).rejects.toThrow();
    await rm(path.join(root, 'config.toml'));
    await expect(prepareIsolatedHome({ VIBE_SUPERVISOR_HOME: root })).rejects.toThrow();
  });
});
