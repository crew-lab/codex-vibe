import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendCapabilities, PendingRequest, StartRunInput } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AcpBackend } from '../../src/backends/acp.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';
import { PROBE_FAILURE_TTL_MS } from '../../src/backends/probe-cache.js';
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
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-probe-reject-'));
  roots.push(root);
  return root;
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

const available: BackendCapabilities = { available: true, backend: 'acp', executable: 'x', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
const unavailable: BackendCapabilities = { available: false, backend: 'acp', executable: 'x', supportsContinue: false, supportsPermissionResponse: false, details: { reason: 'nope' } };

class ProbeCountingAcp extends AcpBackend {
  runs = 0;
  result: BackendCapabilities = available;
  delayMs = 0;
  constructor(private readonly script: string) { super({ ...DEFAULT_CONFIG, backend: 'acp', paths: { vibeAcp: script } }); }
  protected override executable(): string { return this.script; }
  protected override async runProbe(): Promise<BackendCapabilities> {
    this.runs += 1;
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.result;
  }
}

describe('backend probe cache', () => {
  async function acpScript() {
    const root = await makeRoot();
    const script = path.join(root, 'vibe-acp');
    await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    return { root, script };
  }

  it('probes once for repeated calls', async () => {
    const { script } = await acpScript();
    const backend = new ProbeCountingAcp(script);
    await backend.probe(); await backend.probe(); await backend.probe();
    expect(backend.runs).toBe(1);
  });

  it('re-probes when the executable changes', async () => {
    const { script } = await acpScript();
    const backend = new ProbeCountingAcp(script);
    await backend.probe();
    const later = new Date(Date.now() + 60_000);
    await utimes(script, later, later);
    await backend.probe();
    expect(backend.runs).toBe(2);
    await writeExecutable(script, '#!/bin/sh\nexit 1\n');
    await backend.probe();
    expect(backend.runs).toBe(3);
  });

  it('re-probes when the launcher interpreter changes', async () => {
    const root = await makeRoot();
    const interpreter = path.join(root, 'python-like');
    await writeExecutable(interpreter, '#!/bin/sh\nexit 0\n');
    const script = path.join(root, 'vibe-acp');
    await writeExecutable(script, `#!${interpreter}\n`);
    const backend = new ProbeCountingAcp(script);
    await backend.probe(); await backend.probe();
    expect(backend.runs).toBe(1);
    const later = new Date(Date.now() + 60_000);
    await utimes(interpreter, later, later);
    await backend.probe();
    expect(backend.runs).toBe(2);
  });

  it('expires a successful probe after the success TTL', async () => {
    const { script } = await acpScript();
    const backend = new ProbeCountingAcp(script);
    vi.useFakeTimers({ toFake: ['Date'] });
    await backend.probe();
    vi.advanceTimersByTime(9 * 60_000);
    await backend.probe();
    expect(backend.runs).toBe(1);
    vi.advanceTimersByTime(2 * 60_000);
    await backend.probe();
    expect(backend.runs).toBe(2);
  });

  it('retries a failed probe after the short TTL only', async () => {
    const { script } = await acpScript();
    const backend = new ProbeCountingAcp(script);
    backend.result = unavailable;
    vi.useFakeTimers({ toFake: ['Date'] });
    expect((await backend.probe()).available).toBe(false);
    vi.advanceTimersByTime(10_000);
    await backend.probe();
    expect(backend.runs).toBe(1);
    backend.result = available;
    vi.advanceTimersByTime(55_000);
    expect((await backend.probe()).available).toBe(true);
    expect(backend.runs).toBe(2);
  });

  it('keeps a failed probe for sixty seconds', async () => {
    const { script } = await acpScript();
    const backend = new ProbeCountingAcp(script);
    backend.result = unavailable;
    vi.useFakeTimers({ toFake: ['Date'] });
    await backend.probe();
    vi.advanceTimersByTime(59_000);
    await backend.probe();
    expect(backend.runs).toBe(1);
    vi.advanceTimersByTime(2_000);
    await backend.probe();
    expect(backend.runs).toBe(2);
    expect(PROBE_FAILURE_TTL_MS).toBe(60_000);
  });

  it('shares one in-flight probe between concurrent callers', async () => {
    const { script } = await acpScript();
    const backend = new ProbeCountingAcp(script);
    backend.delayMs = 100;
    const results = await Promise.all(Array.from({ length: 8 }, () => backend.probe()));
    expect(backend.runs).toBe(1);
    expect(results.every((result) => result.available)).toBe(true);
  });

  it('bypasses the cache with fresh and refreshes the entry', async () => {
    const { script } = await acpScript();
    const backend = new ProbeCountingAcp(script);
    await backend.probe();
    await backend.probe({ fresh: true });
    expect(backend.runs).toBe(2);
    await backend.probe();
    expect(backend.runs).toBe(2);
  });

  it('does not share the cache between backend instances', async () => {
    const { script } = await acpScript();
    const first = new ProbeCountingAcp(script); const second = new ProbeCountingAcp(script);
    await first.probe(); await second.probe();
    expect(first.runs + second.runs).toBe(2);
  });

  it('caches the programmatic version probe and honours executable changes and fresh', async () => {
    const root = await makeRoot();
    const counter = path.join(root, 'count');
    const script = path.join(root, 'vibe');
    await writeExecutable(script, `#!/bin/sh\necho x >> ${counter}\necho "vibe 2.25.8"\n`);
    const backend = new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe: script } });
    const spawns = async () => (await readFile(counter, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
    expect((await backend.probe()).available).toBe(true);
    await backend.probe();
    expect(await spawns()).toBe(1);
    await backend.probe({ fresh: true });
    expect(await spawns()).toBe(2);
    const later = new Date(Date.now() + 60_000);
    await utimes(script, later, later);
    await backend.probe();
    expect(await spawns()).toBe(3);
  });
});

class FixtureAcp extends AcpBackend {
  outcomeFile = '';
  pidDir = '';
  options: unknown;
  filePath = '';
  probeSpawns = 0;
  constructor(private readonly testMode: string, private readonly script: string, dataDir?: string, allowedWorkspaceRoots: string[] = []) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots, paths: { vibeAcp: script, ...(dataDir ? { dataDir } : {}) } }, dataDir);
  }
  protected override executable(): string { return this.script; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return {
      command: process.execPath,
      args: [fixture],
      env: {
        ...profile.env, FAKE_ACP_CASE: this.testMode, FAKE_FILE_PATH: this.filePath,
        ...(this.outcomeFile ? { FAKE_OUTCOME_FILE: this.outcomeFile } : {}),
        ...(this.pidDir ? { FAKE_PID_DIR: this.pidDir } : {}),
        ...(this.options ? { FAKE_PERMISSION_OPTIONS: JSON.stringify(this.options) } : {})
      }
    };
  }
}

function startInput(root: string): StartRunInput {
  const runId = crypto.randomUUID();
  const workspace = path.join(root, 'workspace'); const runDirectory = path.join(root, 'run', runId);
  return { runId, mode: 'review', task: 'Inspect', cwd: workspace, workerWorkspace: workspace, runDirectory, limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 1_000_000, maxTranscriptBytes: 1_000_000, maxArtifactBytes: 1_000_000 } };
}

describe('probe sharing between probe and start', () => {
  it('spawns Vibe once per run and never for an availability probe', async () => {
    const root = await makeRoot();
    const script = path.join(root, 'vibe-acp');
    await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const pidDir = path.join(root, 'pids'); await mkdir(pidDir); pidDirs.push(pidDir);
    const backend = new FixtureAcp('soak', script);
    backend.pidDir = pidDir;
    for (let index = 0; index < 2; index += 1) {
      const input = startInput(root);
      await mkdir(input.cwd, { recursive: true }); await mkdir(input.runDirectory, { recursive: true });
      const states: string[] = [];
      const started = await backend.start(input, { onEvent: () => undefined, onPendingRequest: () => undefined, onState: (state) => { states.push(state); } });
      await waitFor(() => states, (value) => value.includes('completed'));
      await backend.close(started.handle);
    }
    const spawned = (await readdir(pidDir)).length;
    expect(spawned).toBe(2);
  });
});

interface Harness {
  root: string;
  backend: FixtureAcp;
  input: StartRunInput;
  events: Array<{ type?: string; data?: { text?: string } }>;
  updates: Array<{ state: string; update?: { result?: { stopReason?: string } } }>;
  pending: Promise<PendingRequest>;
  callbacks: BackendCallbacks;
  outcomes(): Promise<unknown[]>;
}

async function harness(mode: string, options?: unknown): Promise<Harness> {
  const root = await makeRoot();
  const script = path.join(root, 'vibe-acp');
  await writeExecutable(script, '#!/bin/sh\nexit 0\n');
  const backend = new FixtureAcp(mode, script);
  backend.outcomeFile = path.join(root, 'outcomes.ndjson');
  backend.pidDir = path.join(root, 'pids'); await mkdir(backend.pidDir); pidDirs.push(backend.pidDir);
  backend.options = options;
  const input = startInput(root);
  backend.filePath = path.join(input.cwd, 'source.txt');
  await mkdir(input.cwd, { recursive: true }); await mkdir(input.runDirectory, { recursive: true });
  const events: Harness['events'] = []; const updates: Harness['updates'] = [];
  let resolvePending!: (request: PendingRequest) => void;
  const pending = new Promise<PendingRequest>((resolve) => { resolvePending = resolve; });
  const callbacks: BackendCallbacks = {
    onEvent: (event) => { events.push(event as Harness['events'][number]); },
    onPendingRequest: (request) => { if (request) resolvePending(request); },
    onState: (state, update) => { updates.push({ state, update: update as Harness['updates'][number]['update'] }); }
  };
  const outcomes = async () => (await readFile(backend.outcomeFile, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown);
  return { root, backend, input, events, updates, pending, callbacks, outcomes };
}

async function noLiveFixtureProcesses(pidDir: string): Promise<boolean> {
  const pids = (await readdir(pidDir)).map(Number);
  const alive = await waitFor(() => pids.filter(isAlive), (value) => value.length === 0, 5_000);
  return alive.length === 0;
}

describe('ACP reject and cancel semantics', () => {
  it.each(['reject-once', 'reject-always'])('answers a rejection with the selected %s option and lets the turn continue', async (optionId) => {
    const kind = optionId === 'reject-once' ? 'reject_once' : 'reject_always';
    const h = await harness('permission', [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId, name: 'Reject', kind }]);
    const started = await h.backend.start(h.input, h.callbacks);
    const pending = await h.pending;
    await h.backend.respond(started.handle, { requestId: pending.requestId, kind: 'permission', optionId });
    await waitFor(() => h.updates, (value) => value.some((entry) => entry.state === 'completed'));
    expect(await h.outcomes()).toEqual([{ outcome: { outcome: 'selected', optionId } }]);
    expect(h.updates.find((entry) => entry.state === 'completed')?.update?.result?.stopReason).toBe('end_turn');
    expect(JSON.stringify(h.events)).toContain('permission rejected, continuing');
    await h.backend.close(started.handle);
  });

  it('still refuses allow_always', async () => {
    const h = await harness('permission', [{ optionId: 'allow-always', name: 'Always', kind: 'allow_always' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }]);
    const started = await h.backend.start(h.input, h.callbacks);
    const pending = await h.pending;
    await expect(h.backend.respond(started.handle, { requestId: pending.requestId, kind: 'permission', optionId: 'allow-always' })).rejects.toMatchObject({ code: 'VSUP_PERMISSION_DENIED' });
    expect(await h.outcomes()).toEqual([]);
    await h.backend.cancel(started.handle);
  });

  it('answers a pending permission request cancelled when the run is cancelled and leaves no process', async () => {
    const h = await harness('permission');
    const started = await h.backend.start(h.input, h.callbacks);
    await h.pending;
    await h.backend.cancel(started.handle);
    const outcomes = await waitFor(() => h.outcomes(), (value) => value.length > 0);
    expect(outcomes).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    expect(h.updates.map((entry) => entry.state)).not.toContain('completed');
    expect(await noLiveFixtureProcesses(h.backend.pidDir)).toBe(true);
  });

  it('answers a pending elicitation with action cancel when the run is cancelled', async () => {
    const h = await harness('elicitation');
    const started = await h.backend.start(h.input, h.callbacks);
    await h.pending;
    await h.backend.cancel(started.handle);
    const outcomes = await waitFor(() => h.outcomes(), (value) => value.length > 0);
    expect(outcomes).toEqual([{ action: 'cancel' }]);
    expect(await noLiveFixtureProcesses(h.backend.pidDir)).toBe(true);
  });

  it('answers a pending permission request cancelled when the run handle is closed', async () => {
    const h = await harness('permission');
    const started = await h.backend.start(h.input, h.callbacks);
    await h.pending;
    await h.backend.close(started.handle);
    const outcomes = await waitFor(() => h.outcomes(), (value) => value.length > 0);
    expect(outcomes).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    expect(await noLiveFixtureProcesses(h.backend.pidDir)).toBe(true);
  });
});

describe('ACP refusal of requests the supervisor cannot evaluate', () => {
  const rejectOnly = [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' }];
  const noSelectedAllow = (outcomes: unknown[]) => outcomes.every((entry) => !JSON.stringify(entry).includes('allow'));

  it('selects reject-once for an uncorrelated request and lets the turn end', async () => {
    const h = await harness('uncorrelated', rejectOnly);
    const started = await h.backend.start(h.input, h.callbacks);
    await waitFor(() => h.updates, (value) => value.some((entry) => entry.state === 'completed'));
    const outcomes = await h.outcomes();
    expect(outcomes).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject-once' } }]);
    expect(noSelectedAllow(outcomes)).toBe(true);
    expect(h.updates.find((entry) => entry.state === 'completed')?.update?.result?.stopReason).toBe('end_turn');
    const denied = h.events.find((event) => event.type === 'permission_denied') as { data?: { outcome?: string } } | undefined;
    expect(denied?.data?.outcome).toBe('rejected');
    await h.backend.close(started.handle);
  });

  it('prefers reject_once over reject_always', async () => {
    const h = await harness('uncorrelated', [{ optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' }, { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' }]);
    const started = await h.backend.start(h.input, h.callbacks);
    await waitFor(() => h.updates, (value) => value.some((entry) => entry.state === 'completed'));
    expect(await h.outcomes()).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject-once' } }]);
    await h.backend.close(started.handle);
  });

  it('falls back to reject_always when it is the only reject option', async () => {
    const h = await harness('uncorrelated', [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' }]);
    const started = await h.backend.start(h.input, h.callbacks);
    await waitFor(() => h.updates, (value) => value.some((entry) => entry.state === 'completed'));
    expect(await h.outcomes()).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject-always' } }]);
    await h.backend.close(started.handle);
  });

  it('answers cancelled for an uncorrelated request when only allow options are offered', async () => {
    const h = await harness('uncorrelated', [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' }]);
    const started = await h.backend.start(h.input, h.callbacks);
    const outcomes = await waitFor(() => h.outcomes(), (value) => value.length > 0);
    expect(outcomes).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    const denied = h.events.find((event) => event.type === 'permission_denied') as { data?: { outcome?: string } } | undefined;
    expect(denied?.data?.outcome).toBe('cancelled');
    await h.backend.close(started.handle);
  });

  it('selects reject for an overlapping duplicate request and keeps the first pending', async () => {
    const h = await harness('duplicate', rejectOnly);
    const started = await h.backend.start(h.input, h.callbacks);
    const pending = await h.pending;
    const duplicate = await waitFor(() => h.outcomes(), (value) => value.length > 0);
    expect(duplicate).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject-once' } }]);
    await h.backend.respond(started.handle, { requestId: pending.requestId, kind: 'permission', optionId: 'reject-once' });
    await waitFor(() => h.updates, (value) => value.some((entry) => entry.state === 'completed'));
    const outcomes = await h.outcomes();
    expect(outcomes).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject-once' } }, { outcome: { outcome: 'selected', optionId: 'reject-once' } }]);
    expect(noSelectedAllow(outcomes)).toBe(true);
    expect(h.updates.find((entry) => entry.state === 'completed')?.update?.result?.stopReason).toBe('end_turn');
    await h.backend.close(started.handle);
  });
});

describe('policy auto-deny through RunManager', () => {
  it('answers an out-of-root permission with the selected reject option and completes the run', async () => {
    const root = await makeRoot();
    const source = path.join(root, 'source'); const data = path.join(root, 'data'); const outside = path.join(root, 'outside.txt');
    await mkdir(source); await writeFile(outside, 'secret');
    const script = path.join(root, 'vibe-acp');
    await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const backend = new FixtureAcp('permission', script, data, [source]);
    backend.outcomeFile = path.join(root, 'outcomes.ndjson');
    backend.pidDir = path.join(root, 'pids'); await mkdir(backend.pidDir); pidDirs.push(backend.pidDir);
    backend.filePath = outside;
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
      expect(status.state).toBe('completed');
      const outcomes = (await readFile(backend.outcomeFile, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown);
      expect(outcomes).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject-once' } }]);
      await manager.close({ run_id: started.run_id });
    } finally { await manager.shutdown(); }
    expect(await noLiveFixtureProcesses(backend.pidDir)).toBe(true);
  });
});
