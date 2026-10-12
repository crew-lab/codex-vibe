import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareIsolatedHome } from '../../src/config/isolated-home.js';
import { runCli } from '../../src/cli.js';
import { RunManager } from '../../src/core/run-manager.js';
import { createIsolatedRunRouter, MAX_SIBLING_SESSIONS } from '../../src/core/isolated-run-router.js';
import { pruneIsolatedSessions } from '../../src/core/session-pruning.js';
import type { SessionSweep } from '../../src/core/session-pruning.js';
import { loadConfig } from '../../src/config/config.js';
import { runToWire } from '../../src/core/serialization.js';
import type { RunRecord } from '../../src/contracts.js';

const DAY = 86_400_000;
const RETENTION_DAYS = 7;
const dirs: string[] = [];
const managers: RunManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.shutdown().catch(() => undefined)));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function template(): Promise<{ root: string; sessions: string; env: NodeJS.ProcessEnv }> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-prune-')));
  dirs.push(root);
  await writeFile(path.join(root, 'config.toml'), `version = 1\nallowed_workspace_roots = []\n\n[retention]\ndays = ${RETENTION_DAYS}\n`, { mode: 0o600 });
  return { root, sessions: path.join(root, 'mcp-sessions'), env: { VIBE_SUPERVISOR_HOME: root } };
}

async function freeSessions(env: NodeJS.ProcessEnv, count: number): Promise<string[]> {
  const prepared = [];
  for (let index = 0; index < count; index += 1) prepared.push(await prepareIsolatedHome(env, () => undefined));
  await Promise.all(prepared.map(entry => entry.lock.release()));
  return prepared.map(entry => entry.home);
}

async function freeSession(env: NodeJS.ProcessEnv): Promise<string> {
  return (await freeSessions(env, 1))[0]!;
}

async function held(env: NodeJS.ProcessEnv, sessionNamespace?: string): Promise<{ home: string; manager: RunManager }> {
  const prepared = await prepareIsolatedHome(env, () => undefined);
  const manager = new RunManager(await loadConfig({ env }), prepared.home, [], prepared.lock, sessionNamespace ? { sessionNamespace } : {});
  managers.push(manager);
  await manager.initialize();
  return { home: prepared.home, manager };
}

function record(state: RunRecord['state'], updatedAt = new Date(Date.now() - 30 * DAY).toISOString()): RunRecord {
  return {
    schemaVersion: 1, runId: randomUUID(), backend: 'programmatic', mode: 'review', state, sourceWorkspace: '/tmp', workerWorkspace: '/tmp',
    createdAt: updatedAt, updatedAt, launchedAt: updatedAt, taskSha256: 'a'.repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_048_576, maxTranscriptBytes: 1_048_576, maxArtifactBytes: 8_388_608 }
  };
}

async function writeRun(home: string, run: RunRecord): Promise<void> {
  const directory = path.join(home, 'runs', run.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'meta.json'), JSON.stringify(runToWire(run)), { mode: 0o600 });
}

async function age(home: string, days = 30): Promise<void> {
  const when = new Date(Date.now() - days * DAY);
  for (const name of await readdir(home)) {
    const entry = path.join(home, name);
    if (name === 'runs') for (const run of await readdir(entry)) await utimes(path.join(entry, run), when, when);
    if (!(await lstat(entry)).isSymbolicLink()) await utimes(entry, when, when);
  }
  await utimes(home, when, when);
}

function sweep(sessions: string, currentHome?: string, maxSessions?: number): Promise<SessionSweep> {
  return pruneIsolatedSessions({ sessions, retentionDays: RETENTION_DAYS, ...(currentHome ? { currentHome } : {}), ...(maxSessions ? { maxSessions } : {}) });
}

function reasonOf(result: SessionSweep, home: string): string | undefined {
  return result.kept_sessions.find(entry => entry.session === path.basename(home))?.reason;
}

async function exists(target: string): Promise<boolean> {
  return lstat(target).then(() => true, () => false);
}

describe('isolated session pruning', () => {
  it('prunes a stale free session that holds no runs and leaves no retired entry behind', async () => {
    const { sessions, env } = await template();
    const stale = await freeSession(env);
    await age(stale);
    const result = await sweep(sessions);
    expect(result.pruned_sessions).toEqual([path.basename(stale)]);
    expect(result.kept_sessions).toEqual([]);
    expect(await readdir(sessions)).toEqual([]);
  });

  it('prunes a stale session whose runs retention would remove anyway', async () => {
    const { sessions, env } = await template();
    const stale = await freeSession(env);
    await writeRun(stale, record('closed'));
    await writeRun(stale, record('cancelled'));
    await mkdir(path.join(stale, 'worktrees'), { mode: 0o700 });
    await age(stale);
    expect((await sweep(sessions)).pruned_sessions).toEqual([path.basename(stale)]);
    expect(await exists(stale)).toBe(false);
  });

  it('keeps a session owned by a live supervisor and leaves its lock untouched', async () => {
    const { sessions, env } = await template();
    const live = await held(env);
    await age(live.home);
    const lock = await readFile(path.join(live.home, 'supervisor.lock'), 'utf8');
    const result = await sweep(sessions);
    expect(result.pruned_sessions).toEqual([]);
    expect(reasonOf(result, live.home)).toBe('live_owner');
    expect(await readFile(path.join(live.home, 'supervisor.lock'), 'utf8')).toBe(lock);
  });

  it('keeps sessions that were used recently or hold runs retention keeps', async () => {
    const { sessions, env } = await template();
    const [recent, recentRun, failed, completed] = await freeSessions(env, 4) as [string, string, string, string];
    await writeRun(recentRun, record('closed', new Date().toISOString()));
    await age(recentRun);
    await writeRun(failed, record('failed'));
    await age(failed);
    await writeRun(completed, record('completed'));
    await age(completed);
    const result = await sweep(sessions);
    expect(result.pruned_sessions).toEqual([]);
    expect(reasonOf(result, recent)).toBe('recently_used');
    expect(reasonOf(result, recentRun)).toBe('run_retained');
    expect(reasonOf(result, failed)).toBe('run_retained');
    expect(reasonOf(result, completed)).toBe('run_retained');
    for (const home of [recent, recentRun, failed, completed]) expect(await exists(home)).toBe(true);
  });

  it('keeps a session with a retained worktree, recorded or on disk', async () => {
    const { sessions, env } = await template();
    const [recorded, onDisk] = await freeSessions(env, 2) as [string, string];
    const run = record('closed');
    run.worktree = { path: path.join(recorded, 'worktrees', run.runId), baseRef: 'HEAD', createdBySupervisor: true };
    await writeRun(recorded, run);
    await age(recorded);
    await mkdir(path.join(onDisk, 'worktrees', randomUUID()), { recursive: true, mode: 0o700 });
    await age(onDisk);
    const result = await sweep(sessions);
    expect(result.pruned_sessions).toEqual([]);
    expect(reasonOf(result, recorded)).toBe('worktree_retained');
    expect(reasonOf(result, onDisk)).toBe('worktree_retained');
  });

  it('keeps and reports symlinked, group-readable, unreadable and unexpected sessions without touching them', async () => {
    const { sessions, env } = await template();
    await mkdir(sessions, { mode: 0o700 });
    const target = await mkdtemp(path.join(tmpdir(), 'vsup-prune-target-')); dirs.push(target);
    const link = path.join(sessions, 'session-aaaaaa');
    await symlink(target, link);
    const open = path.join(sessions, 'session-bbbbbb');
    await mkdir(open, { mode: 0o755 }); await chmod(open, 0o755); await age(open);
    const [garbled, stray] = await freeSessions(env, 2) as [string, string];
    await mkdir(path.join(garbled, 'runs', randomUUID()), { recursive: true, mode: 0o700 });
    const runId = (await readdir(path.join(garbled, 'runs')))[0]!;
    await writeFile(path.join(garbled, 'runs', runId, 'meta.json'), '{"schema_version":', { mode: 0o600 });
    await age(garbled);
    await writeFile(path.join(stray, 'notes.txt'), 'keep me', { mode: 0o600 });
    await age(stray);
    const result = await sweep(sessions);
    expect(result.pruned_sessions).toEqual([]);
    expect(reasonOf(result, link)).toBe('unsafe');
    expect(reasonOf(result, open)).toBe('unsafe');
    expect(reasonOf(result, garbled)).toBe('unreadable');
    expect(reasonOf(result, stray)).toBe('unexpected_entry');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readdir(target)).toEqual([]);
    expect((await stat(open)).mode & 0o777).toBe(0o755);
    expect(await readFile(path.join(stray, 'notes.txt'), 'utf8')).toBe('keep me');
  });

  it('refuses to prune anything in a namespace that is not private', async () => {
    const { sessions, env } = await template();
    const stale = await freeSession(env);
    await age(stale);
    await chmod(sessions, 0o755);
    const result = await sweep(sessions);
    expect(result.pruned_sessions).toEqual([]);
    expect(result.kept_sessions.map(entry => entry.reason)).toEqual(['unsafe_namespace']);
    expect(await exists(stale)).toBe(true);
    await chmod(sessions, 0o700);
  });

  it('bounds the work per sweep, oldest first, and defers the rest', async () => {
    const { sessions, env } = await template();
    const homes = await freeSessions(env, 3);
    await age(homes[0]!, 40); await age(homes[1]!, 30); await age(homes[2]!, 20);
    const first = await sweep(sessions, undefined, 2);
    expect(first.pruned_sessions.sort()).toEqual([path.basename(homes[0]!), path.basename(homes[1]!)].sort());
    expect(first.kept_sessions).toEqual([expect.objectContaining({ session: path.basename(homes[2]!), reason: 'deferred' })]);
    expect((await sweep(sessions, undefined, 2)).pruned_sessions).toEqual([path.basename(homes[2]!)]);
  });

  it('removes a retired session left behind by an interrupted sweep', async () => {
    const { sessions } = await template();
    const retired = path.join(sessions, '.pruned-session-abcdef-0123456789abcdef');
    await mkdir(path.join(retired, 'runs'), { recursive: true, mode: 0o700 });
    await chmod(sessions, 0o700);
    await sweep(sessions);
    expect(await exists(retired)).toBe(false);
  });

  it('never prunes the current session or a session another live supervisor owns', async () => {
    const { sessions, env } = await template();
    const a = await held(env, sessions);
    const b = await held(env, sessions);
    const stale = await freeSession(env);
    await Promise.all([age(a.home), age(b.home), age(stale)]);
    const [fromA, fromB] = await Promise.all([a.manager.cleanup(), b.manager.cleanup()]) as SessionSweep[];
    expect(await exists(a.home)).toBe(true);
    expect(await exists(b.home)).toBe(true);
    expect(await exists(stale)).toBe(false);
    expect([...fromA!.pruned_sessions, ...fromB!.pruned_sessions]).toEqual([path.basename(stale)]);
    expect(reasonOf(fromA!, b.home)).toBe('live_owner');
    expect(reasonOf(fromB!, a.home)).toBe('live_owner');
    expect(reasonOf(fromA!, a.home)).toBeUndefined();
    expect(reasonOf(fromB!, b.home)).toBeUndefined();
  });

  it('prunes from automatic retention after serving starts', async () => {
    const { sessions, env } = await template();
    const current = await held(env, sessions);
    const stale = await freeSession(env);
    await age(stale);
    current.manager.startAutomaticRetention({ firstDelayMs: 0 });
    await vi.waitFor(async () => { expect(await exists(stale)).toBe(false); }, { timeout: 5000 });
    expect(await exists(current.home)).toBe(true);
  });

  it('still adopts a free session after pruning, or creates one when none is left', async () => {
    const { sessions, env } = await template();
    const [stale, fresh] = await freeSessions(env, 2) as [string, string];
    await age(stale);
    expect((await sweep(sessions)).pruned_sessions).toEqual([path.basename(stale)]);
    const adopted = await prepareIsolatedHome(env, () => undefined);
    expect(adopted).toMatchObject({ adopted: true, home: fresh });
    await adopted.lock.release();
    await age(fresh);
    expect((await sweep(sessions)).pruned_sessions).toEqual([path.basename(fresh)]);
    const created = await prepareIsolatedHome(env, () => undefined);
    expect(created.adopted).toBe(false);
    expect((await readdir(sessions)).filter(name => name.startsWith('session-'))).toEqual([path.basename(created.home)]);
    await created.lock.release();
  });
});

describe('runs cleanup', () => {
  it('reports pruned and kept isolated sessions with reasons', async () => {
    const { root, env } = await template();
    const [stale, recent] = await freeSessions(env, 2) as [string, string];
    await age(stale);
    vi.stubEnv('VIBE_SUPERVISOR_HOME', root);
    const printed: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { printed.push(String(chunk)); return true; }) as typeof process.stdout.write);
    try { await runCli(['runs', 'cleanup']); }
    finally { write.mockRestore(); vi.unstubAllEnvs(); }
    expect(process.exitCode ?? 0).toBe(0);
    const report = JSON.parse(printed.join('')) as SessionSweep & { removed_run_ids: string[] };
    expect(report.removed_run_ids).toEqual([]);
    expect(report.pruned_sessions).toEqual([path.basename(stale)]);
    expect(report.kept_sessions).toEqual([expect.objectContaining({ session: path.basename(recent), path: recent, reason: 'recently_used' })]);
  });
});

describe('isolated run lookup with a large or damaged namespace', () => {
  it('reaches runs in the current session and a valid sibling past the scan limit and an unsafe sibling', async () => {
    const { root, sessions } = await template();
    await mkdir(sessions, { mode: 0o700 });
    for (let index = 0; index < MAX_SIBLING_SESSIONS + 12; index += 1) await mkdir(path.join(sessions, `session-m${String(index).padStart(5, '0')}`), { mode: 0o700 });
    const unsafe = path.join(sessions, 'session-000000');
    await mkdir(unsafe, { mode: 0o755 }); await chmod(unsafe, 0o755);
    const sibling = path.join(sessions, 'session-000001');
    await mkdir(sibling, { mode: 0o700 });
    const siblingRun = record('completed');
    await writeRun(sibling, siblingRun);
    const unreachable = path.join(sessions, 'session-zzzzzy');
    await mkdir(unreachable, { mode: 0o700 });
    const unreachableRun = record('completed');
    await writeRun(unreachable, unreachableRun);
    const currentHome = path.join(sessions, 'session-zzzzzz');
    await mkdir(currentHome, { mode: 0o700 });
    const currentRun = record('completed');
    await writeRun(currentHome, currentRun);
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } });
    const manager = new RunManager(config, currentHome);
    managers.push(manager);
    await manager.initialize();
    const reports: string[] = [];
    const router = createIsolatedRunRouter(manager, { sessions, currentHome, config, report: message => reports.push(message) });
    expect((await router.status({ run_id: currentRun.runId })).state).toBe('completed');
    expect((await router.status({ run_id: siblingRun.runId })).state).toBe('completed');
    expect((await router.close({ run_id: siblingRun.runId })).state).toBe('closed');
    await expect(router.status({ run_id: unreachableRun.runId })).rejects.toMatchObject({
      code: 'VSUP_NOT_FOUND', details: { skipped_sessions: ['session-000000'], unscanned_sessions: 15 }
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain(unsafe);
    expect((await stat(unsafe)).mode & 0o777).toBe(0o755);
    await router.shutdown();
  });

  it('still fails closed when a run ID appears in the current session and a sibling', async () => {
    const { root, sessions } = await template();
    await mkdir(sessions, { mode: 0o700 });
    const run = record('completed');
    const sibling = path.join(sessions, 'session-aaaaaa');
    const currentHome = path.join(sessions, 'session-bbbbbb');
    await mkdir(sibling, { mode: 0o700 }); await mkdir(currentHome, { mode: 0o700 });
    await writeRun(sibling, run); await writeRun(currentHome, run);
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } });
    const manager = new RunManager(config, currentHome);
    managers.push(manager);
    await manager.initialize();
    const router = createIsolatedRunRouter(manager, { sessions, currentHome, config, report: () => undefined });
    await expect(router.status({ run_id: run.runId })).rejects.toMatchObject({ code: 'VSUP_INVALID_STATE' });
    await router.shutdown();
  });
});
