import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareIsolatedHome } from '../../src/config/isolated-home.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AppServerBackend } from '../../src/backends/app-server.js';
import { createIsolatedRunRouter } from '../../src/core/isolated-run-router.js';
import { loadConfig } from '../../src/config/config.js';
import { runToWire } from '../../src/core/serialization.js';
import type { RunRecord } from '../../src/contracts.js';

const PATHS = '[paths]\nvibe_pin_manifest = "/unused/vibe-pin-manifest.json"\n';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function template(source = `version = 1\nallowed_workspace_roots = []\n${PATHS}`): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-isolation-')));
  dirs.push(root);
  await writeFile(path.join(root, 'config.toml'), source, { mode: 0o600 });
  return root;
}

describe('per-connection isolated storage', () => {
  it('allows simultaneous owners while preserving configuration and excluding source state', async () => {
    const source = `version = 1\nallowed_workspace_roots = []\n${PATHS}`;
    const root = await template(source);
    const env = { VIBE_SUPERVISOR_HOME: root };
    const shared = new RunManager(await loadConfig({ env }), root);
    await shared.initialize();
    const owners: RunManager[] = [];
    try {
      const prepared = await Promise.all([prepareIsolatedHome(env), prepareIsolatedHome(env)]);
      const homes = prepared.map(entry => entry.home);
      expect(new Set(homes).size).toBe(2);
      for (const home of homes) {
        expect((await readdir(home)).sort()).toEqual(['config.toml', 'supervisor.lock']);
        expect(await readFile(path.join(home, 'config.toml'), 'utf8')).toBe(source);
        expect((await stat(home)).mode & 0o777).toBe(0o700);
        expect((await stat(path.join(home, 'config.toml'))).mode & 0o777).toBe(0o600);
        const owner = new RunManager(await loadConfig({ env: { VIBE_SUPERVISOR_HOME: home } }), home, [], prepared[homes.indexOf(home)]!.lock);
        owners.push(owner); await owner.initialize();
      }
      expect(await readFile(path.join(root, 'config.toml'), 'utf8')).toBe(source);
    } finally { await Promise.all(owners.map(owner => owner.shutdown())); await shared.shutdown(); }
  });

  it('rejects symlinked configuration and template ancestors', async () => {
    const root = await template();
    await rm(path.join(root, 'config.toml'));
    await writeFile(path.join(root, 'actual.toml'), `version = 1\nallowed_workspace_roots = []\n${PATHS}`);
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

  it('places isolated storage below an explicitly selected config parent and ignores the default home', async () => {
    const root = await template('version = 1\nbackend = "acp"\n');
    const artifact = path.join(root, 'artifact'); await mkdir(artifact, { mode: 0o700 });
    const configPath = path.join(artifact, 'config.toml'); const config = `version = 1\nallowed_workspace_roots = []\n${PATHS}`;
    await writeFile(configPath, config, { mode: 0o600 });
    const prepared = await prepareIsolatedHome({ VIBE_SUPERVISOR_HOME: root }, undefined, configPath);
    expect(prepared.home.startsWith(path.join(artifact, 'mcp-sessions'))).toBe(true);
    expect(await readFile(path.join(prepared.home, 'config.toml'), 'utf8')).toBe(config);
    await prepared.lock.release();
  });
});

const CONFIG_V1 = `version = 1\nallowed_workspace_roots = []\n${PATHS}`;
const CONFIG_V2 = `version = 1\nallowed_workspace_roots = []\n\n[retention]\ndays = 2\n\n${PATHS}`;

async function sessionNames(root: string): Promise<string[]> {
  return (await readdir(path.join(root, 'mcp-sessions'))).sort();
}

async function hold(prepared: { home: string; lock: import('../../src/core/owner-lock.js').OwnerLock }): Promise<RunManager> {
  const manager = new RunManager(await loadConfig({ env: { VIBE_SUPERVISOR_HOME: prepared.home } }), prepared.home, [], prepared.lock);
  await manager.initialize();
  return manager;
}

function unusedPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid;
}

function record(): RunRecord {
  const runId = randomUUID(); const now = new Date().toISOString();
  return {
    schemaVersion: 1, runId, backend: 'app-server', mode: 'review', state: 'completed', sourceWorkspace: '/tmp', workerWorkspace: '/tmp',
    createdAt: now, updatedAt: now, launchedAt: now, taskSha256: 'a'.repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_048_576, maxTranscriptBytes: 1_048_576, maxArtifactBytes: 8_388_608 }
  };
}

async function writeRun(home: string, run: RunRecord): Promise<void> {
  const directory = path.join(home, 'runs', run.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'meta.json'), JSON.stringify(runToWire(run)), { mode: 0o600 });
}

describe('session directory reuse', () => {
  it('gives simultaneous starts different directories and both initialize', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const first = await prepareIsolatedHome(env); const second = await prepareIsolatedHome(env);
    expect(first.adopted).toBe(false); expect(second.adopted).toBe(false);
    expect(first.home).not.toBe(second.home);
    const managers = [await hold(first), await hold(second)];
    await Promise.all(managers.map(manager => manager.shutdown()));
    expect(await sessionNames(root)).toHaveLength(2);
  });

  it('adopts the released directory, keeps its runs reachable and refreshes the configuration', async () => {
    const root = await template(CONFIG_V1); const env = { VIBE_SUPERVISOR_HOME: root };
    const first = await prepareIsolatedHome(env);
    const run = record();
    await writeRun(first.home, run);
    const owner = await hold(first);
    expect((await owner.status({ run_id: run.runId })).state).toBe('completed');
    await owner.shutdown();
    await writeFile(path.join(root, 'config.toml'), CONFIG_V2, { mode: 0o600 });
    const again = await prepareIsolatedHome(env);
    expect(again.adopted).toBe(true);
    expect(again.home).toBe(first.home);
    expect(await readFile(path.join(again.home, 'config.toml'), 'utf8')).toBe(CONFIG_V2);
    expect((await stat(path.join(again.home, 'config.toml'))).mode & 0o777).toBe(0o600);
    const reconnected = await hold(again);
    try { expect((await reconnected.status({ run_id: run.runId })).state).toBe('completed'); }
    finally { await reconnected.shutdown(); }
    expect(await sessionNames(root)).toHaveLength(1);
  });

  it('prefers the most recently used free directory', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const a = await prepareIsolatedHome(env); const b = await prepareIsolatedHome(env);
    await a.lock.release(); await b.lock.release();
    await utimes(a.home, new Date(2030, 0, 1), new Date(2030, 0, 1));
    await utimes(b.home, new Date(2020, 0, 1), new Date(2020, 0, 1));
    const next = await prepareIsolatedHome(env);
    expect(next.home).toBe(a.home);
    await next.lock.release();
  });

  it('adopts a directory whose lock belongs to a dead process', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const first = await prepareIsolatedHome(env);
    await first.lock.release();
    await writeFile(path.join(first.home, 'supervisor.lock'), JSON.stringify({ pid: unusedPid(), token: randomUUID(), started_at: new Date().toISOString() }), { mode: 0o600 });
    const again = await prepareIsolatedHome(env);
    expect(again.adopted).toBe(true); expect(again.home).toBe(first.home);
    await again.lock.release();
  });

  it('skips a directory held by a live owner and creates a new one', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const first = await prepareIsolatedHome(env);
    const owner = await hold(first);
    const messages: string[] = [];
    try {
      const second = await prepareIsolatedHome(env, line => messages.push(line));
      expect(second.adopted).toBe(false); expect(second.home).not.toBe(first.home);
      // Restricted runners can forbid the bounded `ps` probe used to identify a live PID.
      // In that case the candidate is still skipped fail-closed and a fresh directory is used.
      expect(messages.length === 0 || messages.every(message => /spawn EPERM/.test(message))).toBe(true);
      await second.lock.release();
    } finally { await owner.shutdown(); }
  });

  it('skips and leaves untouched a symlinked or group-readable candidate', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const sessions = path.join(root, 'mcp-sessions');
    await mkdir(sessions, { mode: 0o700 });
    const target = await mkdtemp(path.join(tmpdir(), 'vsup-target-')); dirs.push(target);
    await symlink(target, path.join(sessions, 'session-aaaaaa'));
    const open = path.join(sessions, 'session-bbbbbb');
    await mkdir(open, { mode: 0o755 }); await chmod(open, 0o755);
    const messages: string[] = [];
    const prepared = await prepareIsolatedHome(env, line => messages.push(line));
    expect(prepared.adopted).toBe(false);
    expect([path.join(sessions, 'session-aaaaaa'), open]).not.toContain(prepared.home);
    expect(await readdir(target)).toEqual([]);
    expect(await readdir(open)).toEqual([]);
    expect((await stat(open)).mode & 0o777).toBe(0o755);
    expect(messages).toHaveLength(2);
    await prepared.lock.release();
  });

  it('ignores names outside the session pattern', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const sessions = path.join(root, 'mcp-sessions');
    await mkdir(path.join(sessions, 'other'), { recursive: true, mode: 0o700 });
    const prepared = await prepareIsolatedHome(env);
    expect(prepared.adopted).toBe(false);
    expect(await readdir(path.join(sessions, 'other'))).toEqual([]);
    await prepared.lock.release();
  });

  it('lets exactly one of two concurrent starts adopt the single free directory', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const first = await prepareIsolatedHome(env);
    await first.lock.release();
    const results = await Promise.all([prepareIsolatedHome(env), prepareIsolatedHome(env)]);
    expect(results.filter(result => result.adopted)).toHaveLength(1);
    expect(results.filter(result => !result.adopted)).toHaveLength(1);
    expect(new Set(results.map(result => result.home)).size).toBe(2);
    expect(results.find(result => result.adopted)!.home).toBe(first.home);
    await Promise.all(results.map(result => result.lock.release()));
  });

});

describe('isolated run UUID routing', () => {
  async function routerFor(current: Awaited<ReturnType<typeof prepareIsolatedHome>>) {
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: current.home } });
    const manager = new RunManager(config, current.home, [], current.lock);
    await manager.initialize();
    const router = createIsolatedRunRouter(manager, { sessions: current.sessions, currentHome: current.home, config });
    return { manager, router };
  }

  it('finds a completed run in an older session and closes it there', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const older = await prepareIsolatedHome(env); const saved = record();
    await writeRun(older.home, saved);
    const oldOwner = await hold(older);
    const current = await prepareIsolatedHome(env);
    expect(current.home).not.toBe(older.home);
    await oldOwner.shutdown();
    const { manager, router } = await routerFor(current);
    try {
      expect((await router.status({ run_id: saved.runId })).state).toBe('completed');
      expect((await router.result({ run_id: saved.runId })).state).toBe('completed');
      expect((await router.close({ run_id: saved.runId })).state).toBe('closed');
      expect((await router.status({ run_id: saved.runId })).state).toBe('closed');
      expect(JSON.parse(await readFile(path.join(older.home, 'runs', saved.runId, 'meta.json'), 'utf8')).state).toBe('closed');
    } finally { await manager.shutdown(); }
  });

  it('recovers interrupted data without starting a backend task', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const older = await prepareIsolatedHome(env); const saved = record();
    const oldOwner = await hold(older);
    await oldOwner.shutdown();
    saved.state = 'running';
    await writeRun(older.home, saved);
    const current = await prepareIsolatedHome(env);
    const { manager, router } = await routerFor(current);
    const start = vi.spyOn(AppServerBackend.prototype, 'start');
    try {
      const status = await router.status({ run_id: saved.runId });
      expect(status.state).toBe('failed');
      expect((await router.result({ run_id: saved.runId })).state).toBe('failed');
      expect(start).not.toHaveBeenCalled();
    } finally { start.mockRestore(); await manager.shutdown(); }
  });

  it('serializes concurrent borrowed operations and drains them before router shutdown', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const older = await prepareIsolatedHome(env); const saved = record();
    await writeRun(older.home, saved);
    const oldOwner = await hold(older);
    const current = await prepareIsolatedHome(env);
    await oldOwner.shutdown();
    const { manager, router } = await routerFor(current);
    let entered!: () => void; let release!: () => void;
    const didEnter = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const originalStatus = RunManager.prototype.status;
    const statusSpy = vi.spyOn(RunManager.prototype, 'status').mockImplementation(async function (input, wait) {
      entered();
      await gate;
      return originalStatus.call(this, input, wait);
    });
    try {
      const pending = router.status({ run_id: saved.runId });
      await didEnter;
      const queued = router.result({ run_id: saved.runId }).then(
        value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      let drained = false;
      const stopping = router.shutdown().then(() => { drained = true; });
      await Promise.resolve();
      expect(drained).toBe(false);
      await expect(router.result({ run_id: saved.runId })).rejects.toMatchObject({ code: 'VSUP_INVALID_STATE' });
      await expect(router.reviewStart({ task: 'must not run', cwd: root })).rejects.toMatchObject({ code: 'VSUP_INVALID_STATE' });
      await expect(router.editStart({ task: 'must not run', cwd: root })).rejects.toMatchObject({ code: 'VSUP_INVALID_STATE' });
      release();
      expect((await pending).state).toBe('completed');
      expect((await queued).error).toMatchObject({ code: 'VSUP_INVALID_STATE' });
      await stopping;
      expect(drained).toBe(true);
    } finally { release(); statusSpy.mockRestore(); await manager.shutdown(); }
  });

  it('fails when the saved session still has a live owner', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const older = await prepareIsolatedHome(env); const saved = record();
    await writeRun(older.home, saved);
    const oldOwner = await hold(older);
    const heldLock = await readFile(path.join(older.home, 'supervisor.lock'), 'utf8');
    const current = await prepareIsolatedHome(env);
    const { manager, router } = await routerFor(current);
    try {
      let rejected: unknown;
      try { await router.result({ run_id: saved.runId }); } catch (error) { rejected = error; }
      expect(rejected).toBeInstanceOf(Error);
      expect(['VSUP_OWNER_LOCKED', 'EPERM']).toContain((rejected as NodeJS.ErrnoException).code);
      expect(JSON.parse(await readFile(path.join(older.home, 'runs', saved.runId, 'meta.json'), 'utf8')).state).toBe('completed');
      expect(await readFile(path.join(older.home, 'supervisor.lock'), 'utf8')).toBe(heldLock);
    } finally { await Promise.all([manager.shutdown(), oldOwner.shutdown()]); }
  });

  it('rejects a UUID duplicated across sessions, including the current session', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const older = await prepareIsolatedHome(env); const saved = record();
    await writeRun(older.home, saved);
    const oldOwner = await hold(older);
    const current = await prepareIsolatedHome(env);
    await oldOwner.shutdown();
    await writeRun(current.home, saved);
    const { manager, router } = await routerFor(current);
    try {
      await expect(router.status({ run_id: saved.runId })).rejects.toMatchObject({ code: 'VSUP_INVALID_STATE' });
      expect(JSON.parse(await readFile(path.join(current.home, 'runs', saved.runId, 'meta.json'), 'utf8')).state).toBe('completed');
    } finally { await manager.shutdown(); }
  });

  it('rejects symlinked UUID paths and invalid IDs without following them', async () => {
    const root = await template(); const env = { VIBE_SUPERVISOR_HOME: root };
    const older = await prepareIsolatedHome(env); const saved = record();
    await mkdir(path.join(older.home, 'runs'), { mode: 0o700 });
    const target = await mkdtemp(path.join(tmpdir(), 'vsup-run-target-')); dirs.push(target);
    await symlink(target, path.join(older.home, 'runs', saved.runId));
    await older.lock.release();
    const current = await prepareIsolatedHome(env);
    const { manager, router } = await routerFor(current);
    try {
      await expect(router.status({ run_id: saved.runId })).rejects.toMatchObject({ code: 'VSUP_INVALID_STATE' });
      await expect(router.result({ run_id: 'not-a-uuid' })).rejects.toMatchObject({ code: 'VSUP_NOT_FOUND' });
      expect(await readdir(target)).toEqual([]);
    } finally { await manager.shutdown(); }
  });
});
