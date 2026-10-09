import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, PendingRequest, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AcpBackend } from '../../src/backends/acp.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';

const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const pidDirs: string[] = [];

afterEach(async () => {
  for (const pidDir of pidDirs.splice(0)) {
    for (const name of await readdir(pidDir).catch(() => [] as string[])) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const isAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 10)); value = await read(); }
  return value;
}

async function makeParent(prefix: string, sourceName = 'source') {
  const parent = await mkdtemp(path.join(canonicalTmp, prefix)); roots.push(parent);
  const source = path.join(parent, sourceName); const data = path.join(parent, 'data'); const pidDir = path.join(parent, 'pids');
  await mkdir(source); await mkdir(pidDir); pidDirs.push(pidDir);
  return { parent, source, data, pidDir };
}

async function initRepository(directory: string): Promise<void> {
  await writeFile(path.join(directory, 'tracked.txt'), 'original\n');
  await exec('git', ['init', '-q'], { cwd: directory });
  await exec('git', ['config', 'user.email', 'vsup@example.invalid'], { cwd: directory });
  await exec('git', ['config', 'user.name', 'Vibe Supervisor Test'], { cwd: directory });
  await exec('git', ['add', 'tracked.txt'], { cwd: directory });
  await exec('git', ['commit', '-qm', 'baseline'], { cwd: directory });
}

class HangingAcpBackend extends AcpBackend {
  constructor(dataDir: string, roots: string[], private readonly pidDir: string, startTimeoutMs?: number) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: roots, paths: { vibeAcp: 'fake-acp' } }, dataDir, startTimeoutMs === undefined ? {} : { startTimeoutMs });
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: 'new-hang', FAKE_PID_DIR: this.pidDir } };
  }
  override async probe() {
    return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
}

async function negotiating(options: { startTimeoutMs?: number; maxConcurrentRuns?: number } = {}) {
  const { source, data, pidDir } = await makeParent('vsup-negotiate-');
  const backend = new HangingAcpBackend(data, [source], pidDir, options.startTimeoutMs);
  const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], maxConcurrentRuns: options.maxConcurrentRuns ?? 1 }, data, [backend]);
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  const pids = await waitFor(async () => (await readdir(pidDir)).map(Number), (value) => value.length === 1);
  expect(pids).toHaveLength(1);
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'negotiating');
  return { manager, source, started, pid: pids[0]!, pidDir };
}

describe('an ACP worker that hangs during negotiation', () => {
  it('is killed by vibe_close before the slot is released', async () => {
    const { manager, started, pid } = await negotiating();
    try {
      expect(activeSlots(manager)).toBe(1);
      expect(isAlive(pid)).toBe(true);
      const violations: string[] = [];
      let finished = false;
      const sampler = (async () => {
        while (!finished) {
          if (activeSlots(manager) === 0 && isAlive(pid)) violations.push('slot released while the worker was alive');
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      })();
      const closed = await manager.close({ run_id: started.run_id });
      finished = true; await sampler;
      expect(closed).toMatchObject({ state: 'closed' });
      expect(violations).toEqual([]);
      expect(await waitFor(() => isAlive(pid), (alive) => !alive, 3000)).toBe(false);
      expect(activeSlots(manager)).toBe(0);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('is killed when the run deadline fires, and the run fails with VSUP_TIMEOUT', async () => {
    const { manager, started, pid } = await negotiating();
    try {
      const runtime = (manager as unknown as { requireRun(id: string): unknown }).requireRun(started.run_id);
      await (manager as unknown as { deadline(runtime: unknown): Promise<void> }).deadline(runtime);
      const status = await manager.status({ run_id: started.run_id });
      expect(status).toMatchObject({ state: 'failed', error: { code: 'VSUP_TIMEOUT' } });
      expect(isAlive(pid)).toBe(false);
      expect(activeSlots(manager)).toBe(0);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('is killed by vibe_close with cancel semantics and frees the slot for a queued run only afterwards', async () => {
    const { manager, source, started, pid } = await negotiating();
    try {
      const queued = await manager.reviewStart({ task: 'second', cwd: source });
      expect(queued.state).toBe('queued');
      await manager.close({ run_id: started.run_id });
      expect(isAlive(pid)).toBe(false);
      await waitFor(() => manager.status({ run_id: queued.run_id }), (value) => value.state === 'negotiating');
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('fails the start after the negotiation limit and leaves no process', async () => {
    const { manager, started, pid } = await negotiating({ startTimeoutMs: 500 });
    try {
      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'failed');
      expect(status).toMatchObject({ state: 'failed', error: { code: 'VSUP_ACP_INIT_FAILED', message: 'Vibe ACP did not finish session/new within 0.5 seconds.' } });
      expect(isAlive(pid)).toBe(false);
      expect(await waitFor(() => activeSlots(manager), (value) => value === 0)).toBe(0);
    } finally { await manager.shutdown(); }
  }, 30_000);
});

class QuietBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  readonly starts: StartRunInput[] = [];
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.starts.push(input); this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(_handle: BackendRunHandle) {}
  async close() {}
  async recover(_record: RunRecord) { return undefined; }
}

class LateStartBackend extends QuietBackend {
  readonly cancelled: BackendRunHandle[] = [];
  readonly closed: BackendRunHandle[] = [];
  release!: () => void;
  readonly gate = new Promise<void>((resolve) => { this.release = resolve; });
  failDuringStart = false;
  override async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    if (this.failDuringStart) await callbacks.onState('failed', { error: { code: 'VSUP_BACKEND_CRASHED', message: 'crashed', remediation: '', retryable: false } });
    await this.gate;
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  override async cancel(handle: BackendRunHandle) { this.cancelled.push(handle); }
  override async close(handle?: BackendRunHandle) { if (handle) this.closed.push(handle); }
}

async function managerFor(source: string, data: string) {
  const backend = new QuietBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [backend]);
  return { backend, manager };
}

async function noRunsOrWorktrees(manager: RunManager, data: string): Promise<void> {
  expect(await manager.runsList()).toEqual([]);
  expect(await readdir(path.join(data, 'worktrees')).catch(() => [] as string[])).toEqual([]);
}

describe('edit runs must start at the repository root', () => {
  it('refuses a subdirectory cwd at start, before any run or worktree exists', async () => {
    const { source, data } = await makeParent('vsup-edit-root-');
    await initRepository(source);
    const sub = path.join(source, 'services', 'api'); await mkdir(sub, { recursive: true });
    const { backend, manager } = await managerFor(source, data);
    try {
      await expect(manager.editStart({ task: 'edit', cwd: sub })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID', message: expect.stringContaining(source) });
      await noRunsOrWorktrees(manager, data);
      expect(backend.starts).toEqual([]);
    } finally { await manager.shutdown(); }
  });

  it('still accepts the repository root for edits and a subdirectory for reviews', async () => {
    const { source, data } = await makeParent('vsup-edit-root-ok-');
    await initRepository(source);
    const sub = path.join(source, 'services'); await mkdir(sub);
    const { backend, manager } = await managerFor(source, data);
    try {
      const edit = await manager.editStart({ task: 'edit', cwd: source });
      const review = await manager.reviewStart({ task: 'review', cwd: sub });
      await waitFor(() => backend.starts.length, (count) => count === 2);
      expect(edit.source_workspace).toBe(source);
      expect(review.source_workspace).toBe(sub);
    } finally { await manager.shutdown(); }
  });
});

describe('workspace and context problems are refused synchronously', () => {
  it('reports a missing context_files entry as VSUP_WORKSPACE_INVALID', async () => {
    const { source, data } = await makeParent('vsup-context-');
    const { backend, manager } = await managerFor(source, data);
    try {
      await expect(manager.reviewStart({ task: 'review', cwd: source, context_files: ['missing.ts'] })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID', message: 'context_files entry does not exist: missing.ts' });
      await expect(manager.reviewStart({ task: 'review', cwd: source, context_files: ['../outside.ts'] })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID' });
      await noRunsOrWorktrees(manager, data);
      expect(backend.starts).toEqual([]);
    } finally { await manager.shutdown(); }
  });

  it.each([
    ['a project .vibe directory', async (source: string) => { await mkdir(path.join(source, '.vibe')); }, '.vibe'],
    ['a project .agents file', async (source: string) => { await writeFile(path.join(source, '.agents'), 'unsafe'); }, '.agents'],
    ['a symlinked .agents directory', async (source: string) => { await mkdir(path.join(source, 'agent-target')); await symlink(path.join(source, 'agent-target'), path.join(source, '.agents')); }, '.agents'],
    ['a symlinked .vibeignore', async (source: string) => { await writeFile(path.join(source, 'real-ignore'), ''); await symlink(path.join(source, 'real-ignore'), path.join(source, '.vibeignore')); }, '.vibeignore']
  ])('refuses %s before accepting a review or creating an edit worktree', async (_name, prepare, needle) => {
    const { source, data } = await makeParent('vsup-profile-');
    await initRepository(source);
    await prepare(source);
    const { backend, manager } = await managerFor(source, data);
    try {
      await expect(manager.reviewStart({ task: 'review', cwd: source })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID', message: expect.stringContaining(needle) });
      await expect(manager.editStart({ task: 'edit', cwd: source })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID', message: expect.stringContaining(needle) });
      await noRunsOrWorktrees(manager, data);
      expect(backend.starts).toEqual([]);
    } finally { await manager.shutdown(); }
  });

  it.each([false, true])('accepts a real .agents directory without altering it (tracked: %s)', async (tracked) => {
    const { source, data } = await makeParent('vsup-project-agents-');
    await initRepository(source);
    await mkdir(path.join(source, '.agents', 'skills'), { recursive: true });
    const content = 'project instructions must not be inherited\n';
    await writeFile(path.join(source, '.agents', 'skills', 'canary.md'), content);
    if (tracked) {
      await exec('git', ['add', '.agents'], { cwd: source });
      await exec('git', ['commit', '-qm', 'project skills fixture'], { cwd: source });
    }
    const { backend, manager } = await managerFor(source, data);
    try {
      const review = await manager.reviewStart({ task: 'review', cwd: source });
      const edit = await manager.editStart({ task: 'edit', cwd: source });
      await waitFor(() => backend.starts.length, count => count === 2);
      expect(backend.starts).toHaveLength(2);
      expect(review.source_workspace).toBe(source);
      expect(edit.worker_workspace).not.toBe(source);
      expect(await readFile(path.join(source, '.agents', 'skills', 'canary.md'), 'utf8')).toBe(content);
      if (tracked) expect(await readFile(path.join(edit.worker_workspace, '.agents', 'skills', 'canary.md'), 'utf8')).toBe(content);
    } finally { await manager.shutdown(); }
  });

  it('refuses a workspace path containing glob characters', async () => {
    const { source, data } = await makeParent('vsup-glob-', 'repo[1]');
    await initRepository(source);
    const { backend, manager } = await managerFor(source, data);
    try {
      await expect(manager.reviewStart({ task: 'review', cwd: source })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID', message: expect.stringContaining('glob characters') });
      await expect(manager.editStart({ task: 'edit', cwd: source })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID', message: expect.stringContaining('glob characters') });
      await noRunsOrWorktrees(manager, data);
      expect(backend.starts).toEqual([]);
    } finally { await manager.shutdown(); }
  });
});

describe('permission error codes', () => {
  it('uses VSUP_PERMISSION_DENIED when a response is refused by policy and VSUP_PERMISSION_REQUIRED for continuing with a pending decision', async () => {
    const { source, data } = await makeParent('vsup-codes-');
    await writeFile(path.join(source, 'a.txt'), 'a\n');
    const link = path.join(source, 'link'); await symlink(path.join(source, 'a.txt'), link);
    const { backend, manager } = await managerFor(source, data);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => backend.callbacks.has(started.run_id), Boolean);
      await waitFor(async () => (await manager.status({ run_id: started.run_id })).state, (state) => state === 'running');
      const pending: PendingRequest = { requestId: 'req-1', kind: 'permission', title: 'Read link', options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' }], tool: { kind: 'read', locations: [link] } };
      await backend.callbacks.get(started.run_id)!.onPendingRequest(pending);
      await waitFor(async () => (await manager.status({ run_id: started.run_id })).state, (state) => state === 'waiting_permission');
      await expect(manager.continue({ run_id: started.run_id, message: 'more' })).rejects.toMatchObject({ code: 'VSUP_PERMISSION_REQUIRED' });
      await expect(manager.respond({ run_id: started.run_id, request_id: 'req-1', kind: 'permission', option_id: 'unknown-option' })).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT' });
      await unlink(link); await symlink('/etc/hosts', link);
      await expect(manager.respond({ run_id: started.run_id, request_id: 'req-1', kind: 'permission', option_id: 'allow-once' })).rejects.toMatchObject({ code: 'VSUP_PERMISSION_DENIED' });
    } finally { await manager.shutdown(); }
  });
});

describe('a handle returned after the run already settled', () => {
  it('is cancelled and closed, never registered, when the run failed during start', async () => {
    const { source, data } = await makeParent('vsup-late-fail-');
    const backend = new LateStartBackend(); backend.failDuringStart = true;
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(async () => (await manager.status({ run_id: started.run_id })).state, (state) => state === 'failed');
      backend.release();
      await waitFor(() => backend.closed.length, (count) => count === 1);
      expect(backend.cancelled).toHaveLength(1);
      const runtime = (manager as unknown as { requireRun(id: string): { handle?: unknown } }).requireRun(started.run_id);
      expect(runtime.handle).toBeUndefined();
      expect(await manager.status({ run_id: started.run_id })).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
      expect(activeSlots(manager)).toBe(0);
    } finally { backend.release(); await manager.shutdown(); }
  });

  it('is cancelled and closed when the deadline fired while start was in flight', async () => {
    const { source, data } = await makeParent('vsup-late-deadline-');
    const backend = new LateStartBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => backend.callbacks.has(started.run_id), Boolean);
      const runtime = (manager as unknown as { requireRun(id: string): { handle?: unknown } }).requireRun(started.run_id);
      const deadline = (manager as unknown as { deadline(runtime: unknown): Promise<void> }).deadline(runtime);
      await new Promise((resolve) => setTimeout(resolve, 50));
      backend.release();
      await deadline;
      expect(await manager.status({ run_id: started.run_id })).toMatchObject({ state: 'failed', error: { code: 'VSUP_TIMEOUT' } });
      await waitFor(() => backend.closed.length, (count) => count === 1);
      expect(backend.cancelled).toHaveLength(1);
      expect(runtime.handle).toBeUndefined();
      expect(activeSlots(manager)).toBe(0);
    } finally { backend.release(); await manager.shutdown(); }
  });
});
