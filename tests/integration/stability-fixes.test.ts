import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { SCHEMA_VERSION } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runToWire } from '../../src/core/serialization.js';
import { AcpBackend } from '../../src/backends/acp.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const DAY = 86_400_000;
const roots: string[] = [];
const pidDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const pidDir of pidDirs.splice(0)) {
    for (const name of await readdir(pidDir).catch(() => [] as string[])) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sandbox() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-stable-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); const pidDir = path.join(parent, 'pids');
  await mkdir(source); await mkdir(pidDir); await mkdir(path.join(data, 'runs'), { recursive: true, mode: 0o700 }); pidDirs.push(pidDir);
  return { parent, source, data, pidDir };
}

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

const exists = (file: string) => stat(file).then(() => true, () => false);
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function age(directory: string, days: number): Promise<void> {
  const when = new Date(Date.now() - days * DAY);
  await utimes(directory, when, when);
}

function validRecord(runId: string, source: string): RunRecord {
  const stamp = new Date(Date.now() - 30 * DAY).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION, runId, backend: 'programmatic', mode: 'review', state: 'cancelled', sourceWorkspace: source, workerWorkspace: source,
    createdAt: stamp, updatedAt: stamp, finishedAt: stamp, taskSha256: 'a'.repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_000_000, maxTranscriptBytes: 1_000_000, maxArtifactBytes: 1_000_000 }
  };
}

class IdleBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  terminated: string[] = [];
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel() {}
  async close() {}
  async terminateNow(handle: BackendRunHandle) { this.terminated.push(handle.runId); }
  async recover(_record: RunRecord) { return undefined; }
}

describe('retention of run directories that failed to load', () => {
  async function orphan(data: string, kind: 'garbage' | 'oversized' | 'mismatched' | 'empty' | 'symlink' | 'newer', source: string): Promise<string> {
    const runId = randomUUID();
    const directory = path.join(data, 'runs', runId);
    await mkdir(directory, { mode: 0o700 });
    const meta = path.join(directory, 'meta.json');
    if (kind === 'garbage') await writeFile(meta, '{not json', { mode: 0o600 });
    if (kind === 'oversized') await writeFile(meta, `{"pad":"${'x'.repeat(1_100_000)}"}`, { mode: 0o600 });
    if (kind === 'newer') await writeFile(meta, JSON.stringify({ ...runToWire(validRecord(runId, source)), schema_version: 2 }), { mode: 0o600 });
    if (kind === 'mismatched') await writeFile(meta, JSON.stringify(runToWire(validRecord(randomUUID(), source))), { mode: 0o600 });
    await writeFile(path.join(directory, 'events.ndjson'), '', { mode: 0o600 });
    await age(directory, 30);
    return runId;
  }

  it('removes old run directories whose record is missing or not JSON, and keeps records it cannot interpret', async () => {
    const { source, data } = await sandbox();
    const ids = await Promise.all((['garbage', 'empty'] as const).map((kind) => orphan(data, kind, source)));
    const kept = await Promise.all((['oversized', 'mismatched', 'newer'] as const).map((kind) => orphan(data, kind, source)));
    const fresh = randomUUID();
    await mkdir(path.join(data, 'runs', fresh), { mode: 0o700 });
    await writeFile(path.join(data, 'runs', fresh, 'meta.json'), '{not json', { mode: 0o600 });
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source] }, data, [new IdleBackend()]);
    try {
      const result = await manager.cleanup() as { removed_run_ids: string[] };
      expect([...result.removed_run_ids].sort()).toEqual([...ids].sort());
      for (const id of ids) expect(await exists(path.join(data, 'runs', id))).toBe(false);
      expect(await exists(path.join(data, 'runs', fresh))).toBe(true);
      for (const id of kept) expect(await exists(path.join(data, 'runs', id))).toBe(true);
    } finally { await manager.shutdown(); }
  });

  it('keeps an old orphan that owns a worktree, reports it and writes a diagnostic', async () => {
    const { source, data } = await sandbox();
    await exec('git', ['init', '-q'], { cwd: source });
    await writeFile(path.join(source, 'a.txt'), 'a\n');
    await exec('git', ['add', 'a.txt'], { cwd: source });
    await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init'], { cwd: source });
    const runId = await orphan(data, 'garbage', source);
    const worktree = path.join(data, 'worktrees', runId);
    await mkdir(path.dirname(worktree), { recursive: true, mode: 0o700 });
    await exec('git', ['worktree', 'add', '--detach', worktree], { cwd: source });
    await age(path.join(data, 'runs', runId), 30);
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write);
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source] }, data, [new IdleBackend()]);
    try {
      const result = await manager.cleanup() as { removed_run_ids: string[]; unverified_worktrees?: Array<{ run_id: string; path: string }> };
      expect(result.removed_run_ids).toEqual([]);
      expect(result.unverified_worktrees).toEqual([{ run_id: runId, path: worktree }]);
      expect(await exists(path.join(data, 'runs', runId))).toBe(true);
      expect(await exists(worktree)).toBe(true);
      expect(writes.join('')).toContain(runId);
    } finally { await manager.shutdown(); }
  });
});

describe('shutdown deadline', () => {
  function stick(manager: RunManager, runId: string): void {
    const runtime = (manager as unknown as { requireRun(id: string): unknown }).requireRun(runId);
    (manager as unknown as { serial(runtime: unknown, fn: () => Promise<void>): Promise<void> }).serial(runtime, () => new Promise<void>(() => {})).catch(() => undefined);
  }

  it('gives up on a stuck run chain, terminates the worker, frees the owner lock and leaves the run recoverable', async () => {
    const { source, data } = await sandbox();
    const backend = new IdleBackend();
    const config = { ...DEFAULT_CONFIG, backend: 'programmatic' as const, allowedWorkspaceRoots: [source] };
    const manager = new RunManager(config, data, [backend]);
    const started = await manager.reviewStart({ task: 'review', cwd: source });
    await waitFor(() => backend.callbacks.has(started.run_id), Boolean);
    await waitFor(async () => (await manager.status({ run_id: started.run_id })).state, (state) => state === 'running');
    stick(manager, started.run_id);
    const began = Date.now();
    const outcome = await manager.shutdown(300);
    expect(outcome).toEqual({ timedOut: true });
    expect(Date.now() - began).toBeLessThan(5000);
    expect(backend.terminated).toEqual([started.run_id]);
    const meta = JSON.parse(await readFile(path.join(data, 'runs', started.run_id, 'meta.json'), 'utf8')) as { state: string };
    expect(['completed', 'cancelled', 'failed', 'closed']).not.toContain(meta.state);
    const next = new RunManager(config, data, [new IdleBackend()]);
    try { await next.initialize(); expect((await next.runsList()).map((row) => row.run_id)).toContain(started.run_id); }
    finally { await next.shutdown(); }
  });

  it('kills a real ACP worker process group when the deadline expires', async () => {
    const { source, data, pidDir } = await sandbox();
    class SilentAcp extends AcpBackend {
      constructor() { super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], paths: { vibeAcp: 'fake-acp' } }, data); }
      protected override executable(): string { return 'fake-acp'; }
      protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
        return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: 'silent', FAKE_PID_DIR: pidDir } };
      }
      override async probe() { return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true }; }
    }
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source] }, data, [new SilentAcp()]);
    const started = await manager.reviewStart({ task: 'review', cwd: source });
    await waitFor(async () => (await manager.status({ run_id: started.run_id })).state, (state) => state === 'running');
    const pids = (await waitFor(() => readdir(pidDir), (names) => names.length > 0)).map(Number);
    expect(pids.length).toBeGreaterThan(0);
    stick(manager, started.run_id);
    expect(await manager.shutdown(300)).toEqual({ timedOut: true });
    expect(await waitFor(() => pids.filter(isAlive), (alive) => alive.length === 0, 8000)).toEqual([]);
  }, 30_000);
});

describe('policy auto-deny delivery failure', () => {
  class RefusingAcp extends AcpBackend {
    constructor(dataDir: string, root: string, private readonly pidDir: string, private readonly options: unknown) {
      super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [root], paths: { vibeAcp: 'fake-acp' } }, dataDir);
    }
    protected override executable(): string { return 'fake-acp'; }
    protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
      return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: 'permission', FAKE_PID_DIR: this.pidDir, FAKE_FILE_PATH: '/etc/hosts', FAKE_PERMISSION_OPTIONS: JSON.stringify(this.options) } };
    }
    override async probe() { return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true }; }
  }
  const options = [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' }];

  it('resolves the ACP request with the refusal and keeps the run going when the deny response cannot be delivered', async () => {
    const { source, data, pidDir } = await sandbox();
    const backend = new RefusingAcp(data, source, pidDir, options);
    vi.spyOn(backend, 'respond').mockRejectedValue(new Error('request already cleared'));
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed', 8000);
      expect(status.state).toBe('completed');
      const events = (await readFile(path.join(data, 'runs', started.run_id, 'events.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; severity: string });
      expect(events.some((event) => event.type === 'permission_denied_by_policy')).toBe(true);
      expect(events.some((event) => event.type === 'permission_deny_undelivered' && event.severity === 'warning')).toBe(true);
    } finally { await manager.shutdown(); }
  }, 30_000);
});
