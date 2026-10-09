import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend, SupervisorConfig } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AcpBackend } from '../../src/backends/acp.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';

const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const pidDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const pidDir of pidDirs.splice(0)) {
    for (const name of await readdir(pidDir).catch(() => [] as string[])) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class ContinuableBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(handle: BackendRunHandle) { await this.callbacks.get(handle.runId)?.onState('cancelled'); }
  async close() {}
  async recover(_record: RunRecord) { return undefined; }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;

describe('review integrity on a continued run', () => {
  it.each(['cancel', 'deadline'] as const)('assesses the second turn that ends by %s instead of keeping the first turn verdict', async (ending) => {
    if (ending === 'deadline') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-continue-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source);
    await writeFile(path.join(source, 'file.txt'), 'original\n');
    const backend = new ContinuableBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 } satisfies SupervisorConfig, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source, timeout_seconds: 30 });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      await backend.callbacks.get(started.run_id)?.onState('completed', { result: { summary: 'turn 1' } });
      expect((await manager.result({ run_id: started.run_id, detail: 'full' })).integrity).toMatchObject({ status: 'verified' });

      await manager.continue({ run_id: started.run_id, message: 'second turn' });
      expect((await manager.status({ run_id: started.run_id })).state).toBe('running');
      await writeFile(path.join(source, 'file.txt'), 'changed during turn two\n');
      if (ending === 'cancel') await manager.cancel({ run_id: started.run_id });
      else await vi.advanceTimersByTimeAsync(31_000);

      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => ['failed', 'cancelled'].includes(String(value.state)));
      expect(status.state).toBe(ending === 'cancel' ? 'cancelled' : 'failed');
      const result = await manager.result({ run_id: started.run_id, detail: 'full' });
      expect(result.integrity).toMatchObject({ status: 'changed', changed_paths: ['file.txt'] });
      const written = JSON.parse(await readFile(path.join(data, 'runs', started.run_id, 'result.json'), 'utf8')) as { integrity?: { status: string } };
      expect(written.integrity?.status).toBe('changed');
      expect(await waitFor(async () => activeSlots(manager), (value) => value === 0)).toBe(0);
    } finally { await manager.shutdown(); }
  }, 30_000);
});

class DeadSessionBackend extends AcpBackend {
  pidDir = '';
  constructor(private readonly testMode: string, dataDir: string, allowedWorkspaceRoots: string[], private continueAfterExit = false) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots, paths: { vibeAcp: 'fake-acp' } }, dataDir);
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: this.testMode, FAKE_PID_DIR: this.pidDir } };
  }
  override async probe() {
    return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
  override async continue(handle: BackendRunHandle, message: string): Promise<void> {
    if (this.continueAfterExit) { this.continueAfterExit = false; await (handle.opaque as { process: { done: Promise<unknown> } }).process.done; }
    return super.continue(handle, message);
  }
}

const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function completedRun(testMode: string, continueAfterExit: boolean) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-dead-session-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); const pidDir = path.join(parent, 'pids');
  await mkdir(source); await mkdir(pidDir); pidDirs.push(pidDir);
  const backend = new DeadSessionBackend(testMode, data, [source], continueAfterExit); backend.pidDir = pidDir;
  const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [backend]);
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
  expect((await manager.status({ run_id: started.run_id })).state).toBe('completed');
  await waitFor(async () => activeSlots(manager), (value) => value === 0);
  return { manager, backend, runId: started.run_id, data, pidDir };
}

async function waitForExit(pidDir: string): Promise<void> {
  const [pid] = (await readdir(pidDir)).map(Number);
  await waitFor(async () => isAlive(pid ?? 0), (alive) => !alive);
  expect(isAlive(pid ?? 0)).toBe(false);
}

describe('continuing an ACP session whose process already exited', () => {
  it('reconnects within the same continue call after the process exited and was already released', async () => {
    const { manager, runId, data, pidDir } = await completedRun('exit-idle', false);
    try {
      await waitForExit(pidDir);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const continued = await manager.continue({ run_id: runId, message: 'again' });
      expect(continued.state).toBe('running');
      const status = await waitFor(() => manager.status({ run_id: runId }), (value) => value.state === 'completed' || value.state === 'failed', 8000);
      expect(status.state).toBe('completed');
      expect(await readdir(pidDir)).toHaveLength(2);
      expect((await readFile(path.join(data, 'runs', runId, 'transcript.md'), 'utf8')).split('\n').filter(Boolean)).toEqual(['reply-1', 'reply-1']);
      expect(await waitFor(async () => activeSlots(manager), (value) => value === 0)).toBe(0);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('drops a handle that turns out dead during the call and reconnects instead of waiting for the timeout', async () => {
    const { manager, runId, data, pidDir } = await completedRun('exit-idle', true);
    try {
      const continued = await manager.continue({ run_id: runId, message: 'again' });
      expect(continued.state).toBe('running');
      const status = await waitFor(() => manager.status({ run_id: runId }), (value) => value.state === 'completed' || value.state === 'failed', 8000);
      expect(status).toMatchObject({ state: 'completed' });
      expect(await readdir(pidDir)).toHaveLength(2);
      expect((await readFile(path.join(data, 'runs', runId, 'transcript.md'), 'utf8')).split('\n').filter(Boolean)).toEqual(['reply-1', 'reply-1']);
      expect(await waitFor(async () => activeSlots(manager), (value) => value === 0)).toBe(0);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it.each([false, true])('fails fast with VSUP_SESSION_NOT_RESUMABLE and releases the slot when the session cannot be loaded (continue after exit: %s)', async (continueAfterExit) => {
    const { manager, runId, pidDir } = await completedRun('exit-idle-noload', continueAfterExit);
    try {
      if (!continueAfterExit) { await waitForExit(pidDir); await new Promise((resolve) => setTimeout(resolve, 200)); }
      const begun = Date.now();
      await expect(manager.continue({ run_id: runId, message: 'again' })).rejects.toMatchObject({ code: 'VSUP_SESSION_NOT_RESUMABLE' });
      expect(Date.now() - begun).toBeLessThan(5000);
      expect(activeSlots(manager)).toBe(0);
      expect(['completed', 'recoverable']).toContain((await manager.status({ run_id: runId })).state);
      expect(await readdir(pidDir)).toHaveLength(1);
    } finally { await manager.shutdown(); }
  }, 30_000);
});
