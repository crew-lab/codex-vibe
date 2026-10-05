import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AcpBackend } from '../../src/backends/acp.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';

const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const SECRET = 'sk-abcdef1234567890xyz';

const roots: string[] = [];
const pidDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const pidDir of pidDirs.splice(0)) {
    for (const name of await readdir(pidDir).catch(() => [] as string[])) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeAcpBackend extends AcpBackend {
  pidDir: string | undefined;
  constructor(private readonly testMode: string, dataDir: string, allowedWorkspaceRoots: string[]) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots, paths: { vibeAcp: 'fake-acp', dataDir } }, dataDir);
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return {
      command: process.execPath,
      args: [fixture],
      env: { ...profile.env, FAKE_ACP_CASE: this.testMode, ...(this.pidDir ? { FAKE_PID_DIR: this.pidDir } : {}) }
    };
  }
  override async probe() {
    return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
}

class FakeBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  readonly cancelled: string[] = [];
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(handle: BackendRunHandle) {
    this.cancelled.push(handle.runId);
    await this.callbacks.get(handle.runId)?.onState('cancelled');
  }
  async close() {}
  async recover(_record: RunRecord) { return undefined; }
}

async function makeParent() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-regress-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source);
  return { parent, source, data };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

async function readMessageTexts(runDirectory: string): Promise<string[]> {
  const raw = await readFile(path.join(runDirectory, 'events.ndjson'), 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; data?: { text?: string } })
    .filter((event) => event.type === 'message').map((event) => event.data?.text ?? '');
}

async function runAcpReview(mode: string, workerIdleTtlSeconds = 0) {
  const { source, data } = await makeParent();
  const backend = new FakeAcpBackend(mode, data, [source]);
  const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], workerIdleTtlSeconds }, data, [backend]);
  try {
    const started = await manager.reviewStart({ task: 'review', cwd: source });
    const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
    expect(status.state).toBe('completed');
    return { runDirectory: path.join(data, 'runs', started.run_id), manager, runId: started.run_id };
  } catch (error) { await manager.shutdown(); throw error; }
}

function collectUnhandledRejections() {
  const reasons: unknown[] = [];
  const listener = (reason: unknown) => { reasons.push(reason); };
  process.on('unhandledRejection', listener);
  return { reasons, stop: () => { process.off('unhandledRejection', listener); } };
}

const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RunManager regressions', () => {
  it('concatenates streamed ACP chunks into a transcript without inserting newlines between chunks', async () => {
    const { runDirectory, manager } = await runAcpReview('chunked');
    try {
      const transcript = await readFile(path.join(runDirectory, 'transcript.md'), 'utf8');
      expect(transcript.replace(/\n+$/, '')).toBe('Hello world');
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('redacts a secret that is split across consecutive ACP message chunks', async () => {
    const { runDirectory, manager } = await runAcpReview('split-secret');
    try {
      const transcript = await readFile(path.join(runDirectory, 'transcript.md'), 'utf8');
      const rawEvents = await readFile(path.join(runDirectory, 'events.ndjson'), 'utf8');
      const joinedMessages = (await readMessageTexts(runDirectory)).join('');
      expect(transcript).not.toContain(SECRET);
      expect(rawEvents).not.toContain(SECRET);
      expect(joinedMessages).not.toContain(SECRET);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('leaves no vibe-acp process alive after a restart recovers a completed run and its idle TTL elapses', async () => {
    const { parent, source, data } = await makeParent();
    const pidDir = path.join(parent, 'pids'); await mkdir(pidDir); pidDirs.push(pidDir);
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 1 };
    const firstBackend = new FakeAcpBackend('normal', data, [source]); firstBackend.pidDir = pidDir;
    const first = new RunManager(config, data, [firstBackend]);
    let second: RunManager | undefined;
    try {
      const started = await first.reviewStart({ task: 'review', cwd: source });
      const status = await waitFor(() => first.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
      expect(status.state).toBe('completed');
      await first.shutdown();
      const secondBackend = new FakeAcpBackend('normal', data, [source]); secondBackend.pidDir = pidDir;
      second = new RunManager(config, data, [secondBackend]);
      await second.initialize();
      const pids = (await readdir(pidDir)).map(Number);
      expect(pids.length).toBeLessThanOrEqual(2);
      const alive = await waitFor(async () => pids.filter(isAlive), (value) => value.length === 0, 6_000);
      expect(alive, 'fixture processes still alive after idle TTL').toEqual([]);
      expect(await second.status({ run_id: started.run_id })).toMatchObject({ state: 'completed' });
    } finally { await first.shutdown(); await second?.shutdown(); }
  }, 30_000);

  it('lazily reloads a recovered completed ACP run on continue and runs a second prompt', async () => {
    const { parent, source, data } = await makeParent();
    const pidDir = path.join(parent, 'pids'); await mkdir(pidDir); pidDirs.push(pidDir);
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 };
    const firstBackend = new FakeAcpBackend('normal', data, [source]); firstBackend.pidDir = pidDir;
    const first = new RunManager(config, data, [firstBackend]);
    let second: RunManager | undefined;
    try {
      const started = await first.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => first.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
      await first.shutdown();
      const secondBackend = new FakeAcpBackend('normal', data, [source]); secondBackend.pidDir = pidDir;
      second = new RunManager(config, data, [secondBackend]);
      await second.initialize();
      const pidsBefore = (await readdir(pidDir)).length;
      expect(pidsBefore).toBe(1);
      await second.continue({ run_id: started.run_id, message: 'again' });
      const lastSeq = (await second.status({ run_id: started.run_id })).last_seq as number;
      const status = await waitFor(() => second!.status({ run_id: started.run_id }), (value) => value.state === 'completed' && (value.last_seq as number) > lastSeq);
      expect(status.state).toBe('completed');
      expect((await readdir(pidDir)).length).toBe(2);
      const transcript = await readFile(path.join(data, 'runs', started.run_id, 'transcript.md'), 'utf8');
      expect(transcript.split('\n').filter(Boolean)).toEqual(['reply-1', 'reply-1']);
    } finally { await first.shutdown(); await second?.shutdown(); }
  }, 30_000);

  it('turns a source workspace change during a review into a warning instead of failing the run', async () => {
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    await writeFile(path.join(source, 'file.txt'), 'original\n');
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 0 }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      await writeFile(path.join(source, 'file.txt'), 'modified by someone else, longer content\n');
      await backend.callbacks.get(started.run_id)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'partial findings' } });
      await backend.callbacks.get(started.run_id)?.onState('completed', { result: { summary: 'done' } });
      const status = await manager.status({ run_id: started.run_id });
      expect(status.state).toBe('completed');
      const result = await manager.result({ run_id: started.run_id });
      expect(result.summary).toBe('done');
      const warnings = result.warnings as string[];
      expect(warnings.some((warning) => /workspace|source/i.test(warning) && /chang|modif/i.test(warning))).toBe(true);
      expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'transcript.md' })]));
      expect((await stat(path.join(data, 'runs', started.run_id, 'result.json'))).isFile()).toBe(true);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('records a diagnostic event when a backend reports a state transition that is invalid for the run', async () => {
    const collector = collectUnhandledRejections();
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 0 }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      const callbacks = backend.callbacks.get(started.run_id);
      await callbacks?.onState('completed', { result: { summary: 'done' } });
      expect((await manager.status({ run_id: started.run_id })).state).toBe('completed');
      await expect(Promise.resolve(callbacks?.onState('waiting_input'))).resolves.toBeUndefined();
      expect((await manager.status({ run_id: started.run_id })).state).toBe('completed');
      const lines = (await readFile(path.join(data, 'runs', started.run_id, 'events.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      const diagnostics = lines.filter((event) => event.type === 'diagnostic' && (event.data as Record<string, unknown>).reason === 'ignored_backend_state_transition');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ source: 'supervisor', severity: 'warning', data: { backend_state: 'waiting_input', run_state: 'completed' } });
      expect(String((diagnostics[0]?.data as Record<string, unknown>).message)).toContain('completed -> waiting_input');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(collector.reasons).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);

  it('starts the run timeout when the run launches rather than when it is queued', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], maxConcurrentRuns: 1, maxQueuedRuns: 2, workerIdleTtlSeconds: 0 }, data, [backend]);
    try {
      const runA = await manager.reviewStart({ task: 'a', cwd: source, timeout_seconds: 7200 });
      await waitFor(() => manager.status({ run_id: runA.run_id }), (value) => value.state === 'running', 5_000);
      const runB = await manager.reviewStart({ task: 'b', cwd: source, timeout_seconds: 30 });
      expect(runB.state).toBe('queued');
      await vi.advanceTimersByTimeAsync(31_000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await manager.status({ run_id: runB.run_id })).state).toBe('queued');
      await manager.cancel({ run_id: runA.run_id });
      const running = await waitFor(() => manager.status({ run_id: runB.run_id }), (value) => value.state === 'running', 5_000);
      expect(running.state).toBe('running');
      await vi.advanceTimersByTimeAsync(31_000);
      const failed = await waitFor(() => manager.status({ run_id: runB.run_id }), (value) => value.state === 'failed', 5_000);
      expect(failed.state).toBe('failed');
      expect(failed.error).toMatchObject({ code: 'VSUP_TIMEOUT' });
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('closing a completed ACP run reports closed without a failed transition', async () => {
    const collector = collectUnhandledRejections();
    const { runDirectory, manager, runId } = await runAcpReview('normal', 600);
    try {
      const closed = await manager.close({ run_id: runId });
      expect(closed.state).toBe('closed');
      await settle();
      const status = await manager.status({ run_id: runId });
      expect(status.state).toBe('closed');
      expect(status.error).toBeUndefined();
      const meta = JSON.parse(await readFile(path.join(runDirectory, 'meta.json'), 'utf8')) as { state: string; error?: unknown };
      expect(meta.state).toBe('closed');
      expect(meta.error).toBeUndefined();
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);

  it('idle expiry of a completed ACP run keeps it completed without a failed transition', async () => {
    const collector = collectUnhandledRejections();
    const { runDirectory, manager, runId } = await runAcpReview('normal', 1);
    try {
      await settle(2_500);
      const status = await manager.status({ run_id: runId });
      expect(status.state).toBe('completed');
      expect(status.error).toBeUndefined();
      const meta = JSON.parse(await readFile(path.join(runDirectory, 'meta.json'), 'utf8')) as { state: string; error?: unknown };
      expect(meta.state).toBe('completed');
      expect(meta.error).toBeUndefined();
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);

  it('shutting down with a completed but unclosed ACP run produces no unhandled rejection', async () => {
    const collector = collectUnhandledRejections();
    const { runDirectory, manager, runId } = await runAcpReview('normal', 600);
    try {
      await manager.shutdown();
      await settle();
      const meta = JSON.parse(await readFile(path.join(runDirectory, 'meta.json'), 'utf8')) as { state: string; error?: unknown };
      expect(meta.state).toBe('completed');
      expect(meta.error).toBeUndefined();
      expect(runId).toBeTruthy();
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);

  it('bounds live idle ACP sessions to maxConcurrentRuns', async () => {
    const { parent, source, data } = await makeParent();
    const pidDir = path.join(parent, 'pids'); await mkdir(pidDir); pidDirs.push(pidDir);
    const backend = new FakeAcpBackend('normal', data, [source]); backend.pidDir = pidDir;
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], maxConcurrentRuns: 1, workerIdleTtlSeconds: 600 }, data, [backend]);
    try {
      const runIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const started = await manager.reviewStart({ task: `review ${index}`, cwd: source });
        const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
        expect(status.state, JSON.stringify(status.error)).toBe('completed');
        runIds.push(started.run_id);
      }
      const pids = (await readdir(pidDir)).map(Number);
      expect(pids.length).toBe(3);
      const alive = await waitFor(async () => pids.filter(isAlive), (value) => value.length <= 1, 5_000);
      expect(alive.length, 'live idle fixture processes').toBeLessThanOrEqual(1);
      for (const runId of runIds) expect((await manager.status({ run_id: runId })).state).toBe('completed');
    } finally { await manager.shutdown(); }
  }, 30_000);
});
