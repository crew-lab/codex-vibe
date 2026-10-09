import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, PendingRequest, RunRecord, RunState, StartRunInput, SupervisorBackend, SupervisorConfig } from '../../src/contracts.js';
import { supervisorError } from '../../src/contracts.js';
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

class SettleBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  readonly cancelled: string[] = [];
  readonly closed: string[] = [];
  readonly handles = new Set<string>();
  reportsCancel = true;
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    if (input.task === 'fail-start') throw supervisorError('VSUP_BACKEND_UNAVAILABLE', 'start failed');
    this.handles.add(input.runId);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(handle: BackendRunHandle) {
    this.cancelled.push(handle.runId);
    if (this.reportsCancel) await this.callbacks.get(handle.runId)?.onState('cancelled');
  }
  async close(handle: BackendRunHandle) { this.closed.push(handle.runId); }
  async recover(_record: RunRecord) { return undefined; }
}

const SETTLED: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled', 'recoverable', 'closed']);
const EXECUTE_WITHOUT_REJECT: PendingRequest = { requestId: 'req-1', kind: 'permission', title: 'Run a command', options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }], tool: { kind: 'execute' } };

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

function collectUnhandledRejections() {
  const reasons: unknown[] = [];
  const listener = (reason: unknown) => { reasons.push(reason); };
  process.on('unhandledRejection', listener);
  return { reasons, stop: () => { process.off('unhandledRejection', listener); } };
}

interface Context { manager: RunManager; backend: SettleBackend; data: string }
interface Scenario {
  name: string;
  task?: string;
  blocker?: boolean;
  fakeTimers?: boolean;
  timeout?: number;
  silentCancel?: boolean;
  shutdown?: boolean;
  config?: Partial<SupervisorConfig>;
  end(context: Context, runId: string): Promise<void>;
  state: RunState;
  errorCode?: string;
  launched: boolean;
  handleReleased: boolean;
}

const base: Scenario[] = [
  { name: 'the launch fails', task: 'fail-start', end: async () => undefined, state: 'failed', errorCode: 'VSUP_BACKEND_UNAVAILABLE', launched: true, handleReleased: false },
  { name: 'the backend reports completed', end: async ({ backend }, id) => { await backend.callbacks.get(id)?.onState('completed', { result: { summary: 'done' } }); }, state: 'completed', launched: true, handleReleased: false },
  { name: 'the backend reports failed', end: async ({ backend }, id) => { await backend.callbacks.get(id)?.onState('failed', { error: supervisorError('VSUP_BACKEND_CRASHED', 'crashed') }); }, state: 'failed', errorCode: 'VSUP_BACKEND_CRASHED', launched: true, handleReleased: true },
  { name: 'the backend reports cancelled on its own', end: async ({ backend }, id) => { await backend.callbacks.get(id)?.onState('cancelled'); }, state: 'cancelled', launched: true, handleReleased: true },
  { name: 'the user cancels a running run', end: async ({ manager }, id) => { await manager.cancel({ run_id: id }); }, state: 'cancelled', launched: true, handleReleased: true },
  { name: 'the user cancels a queued run', blocker: true, end: async ({ manager }, id) => { await manager.cancel({ run_id: id }); }, state: 'cancelled', launched: false, handleReleased: false },
  { name: 'the deadline expires', fakeTimers: true, timeout: 30, end: async () => { await vi.advanceTimersByTimeAsync(31_000); }, state: 'failed', errorCode: 'VSUP_TIMEOUT', launched: true, handleReleased: true },
  { name: 'the transcript limit is reached', config: { limits: { ...DEFAULT_CONFIG.limits, maxTranscriptBytes: 8 } }, end: async ({ backend }, id) => { await backend.callbacks.get(id)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'this text is longer than the limit' } }); }, state: 'failed', errorCode: 'VSUP_OUTPUT_LIMIT', launched: true, handleReleased: true },
  { name: 'a permission request violates the policy and offers no rejection', end: async ({ backend }, id) => { await backend.callbacks.get(id)?.onPendingRequest(EXECUTE_WITHOUT_REJECT); }, state: 'failed', errorCode: 'VSUP_PERMISSION_DENIED', launched: true, handleReleased: true },
  { name: 'artifact finalization fails a completed turn', config: { limits: { ...DEFAULT_CONFIG.limits, maxArtifactBytes: 10 } }, end: async ({ backend }, id) => { await backend.callbacks.get(id)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'findings that exceed ten bytes' } }); await backend.callbacks.get(id)?.onState('completed', { result: { summary: 'done' } }); }, state: 'failed', errorCode: 'VSUP_OUTPUT_LIMIT', launched: true, handleReleased: true },
  { name: 'a failure is reported after the run already completed', end: async ({ backend }, id) => { await backend.callbacks.get(id)?.onState('completed', { result: { summary: 'done' } }); await backend.callbacks.get(id)?.onState('failed', { error: supervisorError('VSUP_BACKEND_CRASHED', 'late') }); }, state: 'completed', launched: true, handleReleased: true },
  { name: 'the supervisor shuts down under a running run', shutdown: true, end: async ({ manager }) => { await manager.shutdown(); }, state: 'recoverable', launched: true, handleReleased: true },
  { name: 'the supervisor shuts down under a queued run', shutdown: true, blocker: true, end: async ({ manager }) => { await manager.shutdown(); }, state: 'cancelled', errorCode: 'VSUP_CANCELLED', launched: false, handleReleased: false },
];
const quietBackend = new Set(['the user cancels a running run', 'the deadline expires', 'the transcript limit is reached', 'a permission request violates the policy and offers no rejection']);
const scenarios: Scenario[] = base.flatMap((scenario) => quietBackend.has(scenario.name) ? [scenario, { ...scenario, name: `${scenario.name} (backend cancel reports nothing)`, silentCancel: true }] : [scenario]);

async function readResultFile(data: string, runId: string): Promise<{ state: string; error?: { code: string }; integrity?: { status: string } } | undefined> {
  try { return JSON.parse(await readFile(path.join(data, 'runs', runId, 'result.json'), 'utf8')) as { state: string; error?: { code: string }; integrity?: { status: string } }; }
  catch { return undefined; }
}

describe('settle: every end-of-run path ends the run the same way', () => {
  it.each(scenarios)('$name', async (scenario) => {
    if (scenario.fakeTimers) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const collector = collectUnhandledRejections();
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-settle-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source);
    const backend = new SettleBackend(); backend.reportsCancel = !scenario.silentCancel;
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], maxConcurrentRuns: 1, maxQueuedRuns: 4, workerIdleTtlSeconds: 600, ...scenario.config }, data, [backend]);
    const state = (id: string) => manager.status({ run_id: id }).then((value) => value.state as string);
    const context: Context = { manager, backend, data };
    try {
      const blocker = scenario.blocker ? await manager.reviewStart({ task: 'blocker', cwd: source }) : undefined;
      if (blocker) await waitFor(() => state(blocker.run_id), (value) => value === 'running');
      const target = await manager.reviewStart({ task: scenario.task ?? 'target', cwd: source, ...(scenario.timeout ? { timeout_seconds: scenario.timeout } : {}) });
      if (!scenario.blocker && scenario.task !== 'fail-start') await waitFor(() => state(target.run_id), (value) => value === 'running');
      const follow = await manager.reviewStart({ task: 'follow', cwd: source });
      if (scenario.task !== 'fail-start') expect(await state(follow.run_id)).toBe('queued');
      if (scenario.blocker) expect(await state(target.run_id)).toBe('queued');

      await scenario.end(context, target.run_id);
      const settled = await waitFor(() => state(target.run_id), (value) => SETTLED.has(value));
      expect(settled).toBe(scenario.state);
      const status = await manager.status({ run_id: target.run_id });
      if (scenario.errorCode) expect(status.error).toMatchObject({ code: scenario.errorCode }); else expect(status.error).toBeUndefined();

      const result = await readResultFile(data, target.run_id);
      expect(result, 'result.json must exist').toBeDefined();
      expect(result?.state).toBe(scenario.state);
      if (scenario.errorCode) expect(result?.error).toEqual(status.error); else expect(result?.error).toBeUndefined();
      if (scenario.launched && scenario.state !== 'recoverable') expect(result?.integrity?.status, 'launched review runs carry integrity').toBeDefined();
      if (!scenario.launched) expect(result?.integrity).toBeUndefined();

      const released = [...backend.cancelled, ...backend.closed].filter((id) => id === target.run_id).length;
      if (scenario.handleReleased) expect(released, 'backend session released exactly once').toBe(1); else expect(released).toBe(0);

      if (scenario.shutdown) {
        expect(await state(follow.run_id)).toBe('cancelled');
        expect(await readResultFile(data, follow.run_id)).toBeDefined();
        expect((manager as unknown as { activeSlots: number }).activeSlots).toBe(0);
        return;
      }
      if (blocker) await manager.cancel({ run_id: blocker.run_id });
      expect(await waitFor(() => state(follow.run_id), (value) => value === 'running')).toBe('running');
      await manager.cancel({ run_id: follow.run_id });
      expect((manager as unknown as { activeSlots: number }).activeSlots, 'slot accounting returns to zero').toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);
});

class AcpPolicyBackend extends AcpBackend {
  constructor(dataDir: string, roots: string[], private readonly pidDir: string) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: roots, paths: { vibeAcp: 'fake-acp', dataDir } }, dataDir);
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: 'permission', FAKE_PID_DIR: this.pidDir, FAKE_FILE_PATH: '/etc/hosts', FAKE_PERMISSION_OPTIONS: JSON.stringify([{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }]) } };
  }
  override async probe() {
    return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
}

describe('settle with a real ACP process', () => {
  it('a policy failure writes artifacts, records integrity and leaves no worker process', async () => {
    const collector = collectUnhandledRejections();
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-settle-acp-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); const pidDir = path.join(parent, 'pids');
    await mkdir(source); await mkdir(pidDir); pidDirs.push(pidDir);
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [new AcpPolicyBackend(data, [source], pidDir)]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => SETTLED.has(String(value.state)));
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_PERMISSION_DENIED' });
      const result = await readResultFile(data, started.run_id);
      expect(result?.state).toBe('failed');
      expect(result?.integrity?.status).toBe('verified');
      expect((await stat(path.join(data, 'runs', started.run_id, 'transcript.md'))).isFile()).toBe(true);
      const pids = (await readdir(pidDir)).map(Number);
      const alive = await waitFor(async () => pids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }), (value) => value.length === 0, 5_000);
      expect(alive).toEqual([]);
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);
});
