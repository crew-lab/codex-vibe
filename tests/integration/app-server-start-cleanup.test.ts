import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppServerBackend } from '../../src/backends/app-server.js';
import { ResolvedCredential } from '../../src/backends/app-server/credentials.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { BackendCallbacks, BackendRunHandle, RunState, StartRunInput, SupervisorError } from '../../src/contracts.js';
import { makeLaunchableFakeVibe } from '../unit/support/launchable-fake-vibe.js';

const seen = vi.hoisted(() => ({
  failTerminate: 0,
  withoutStdio: false,
  terminateCalls: 0,
  reaperStops: 0,
  spawned: [] as Array<{ executable: string; options: Record<string, unknown> }>
}));

vi.mock('../../src/process/managed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/process/managed.js')>();
  return {
    ...actual,
    spawnManaged: (executable: string, args: readonly string[], options: Record<string, unknown>) => {
      seen.spawned.push({ executable, options });
      const real = actual.spawnManaged(executable, args, options as never);
      const child = real.child;
      const hidden = new Proxy(child, {
        get(target, property) {
          if (property === 'stdout' || property === 'stdin') return null;
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function' ? (value as (...values: unknown[]) => unknown).bind(target) : value;
        }
      });
      return new Proxy(real, {
        get(target, property) {
          if (property === 'child') return seen.withoutStdio ? hidden : child;
          if (property === 'terminate') {
            return async (grace?: number) => {
              seen.terminateCalls += 1;
              if (seen.failTerminate > 0) { seen.failTerminate -= 1; throw new Error('termination could not be verified'); }
              return target.terminate(grace);
            };
          }
          return Reflect.get(target, property, target) as unknown;
        }
      });
    }
  };
});

vi.mock('../../src/process/reaper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/process/reaper.js')>();
  return {
    ...actual,
    startReaper: async (options: Parameters<typeof actual.startReaper>[0]) => {
      const handle = await actual.startReaper(options);
      return { ...handle, stop: () => { seen.reaperStops += 1; return handle.stop(); } };
    }
  };
});

const scratch: string[] = [];
const handles: Array<{ backend: AppServerBackend; handle: BackendRunHandle }> = [];

afterEach(async () => {
  seen.failTerminate = 0;
  seen.withoutStdio = false;
  seen.terminateCalls = 0;
  seen.reaperStops = 0;
  seen.spawned.length = 0;
  for (const { backend, handle } of handles.splice(0)) await backend.close(handle).catch(() => undefined);
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function setup(scenario: Record<string, unknown>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'vsup-start-cleanup-')));
  scratch.push(base);
  const workspace = path.join(base, 'workspace');
  const runDirectory = path.join(base, 'run');
  mkdirSync(workspace);
  mkdirSync(runDirectory);
  const fake = await makeLaunchableFakeVibe(path.join(base, 'fake'), { scenario });
  const spawnedHandles: BackendRunHandle[] = [];
  const states: RunState[] = [];
  const backend = new AppServerBackend(DEFAULT_CONFIG, {
    executable: fake.appServer,
    pin: { manifestPath: fake.manifest },
    resolveCredential: async () => ({ status: 'environment', detail: '', credential: new ResolvedCredential('start-cleanup-credential-for-tests') }),
    reaper: { pollMs: 50, graceMs: 200 },
    timing: { interruptGraceMs: 300, stdinGraceMs: 300, terminateGraceMs: 300, interruptTimeoutMs: 500, statsThrottleMs: 0 }
  });
  const callbacks: BackendCallbacks = {
    onEvent: () => undefined,
    onSpawn: (handle) => { spawnedHandles.push(handle); handles.push({ backend, handle }); },
    onState: (state) => { states.push(state); }
  };
  const input: StartRunInput = {
    runId: `run-${path.basename(base)}`,
    mode: 'review',
    task: 'Review the repository.',
    cwd: workspace,
    workerWorkspace: workspace,
    runDirectory,
    limits: { timeoutSeconds: 20, maxTurns: 20, maxEventBytes: 50_000_000, maxTranscriptBytes: 10_000_000, maxArtifactBytes: 10_000_000 }
  };
  return { base, fake, backend, callbacks, input, spawnedHandles, states };
}

async function rejection(promise: Promise<unknown>): Promise<SupervisorError> {
  try { await promise; } catch (error) { return error as SupervisorError; }
  throw new Error('expected the promise to reject');
}

describe('a failed start whose worker termination could not be verified', () => {
  it('keeps the reaper running and the handle usable, and lets a retry finish the cleanup', async () => {
    const run = await setup({ name: 'drift', serverVersion: '2.27.0' });
    seen.failTerminate = 1;

    const failure = await rejection(run.backend.start(run.input, run.callbacks));

    expect(failure.code).toBe('VSUP_VIBE_VERSION_UNSUPPORTED');
    expect(seen.terminateCalls).toBe(1);
    expect(seen.reaperStops).toBe(0);
    expect(run.spawnedHandles).toHaveLength(1);

    await run.backend.close(run.spawnedHandles[0] as BackendRunHandle);

    expect(seen.terminateCalls).toBe(2);
    expect(seen.reaperStops).toBe(1);
  });

  it('stops the reaper once, after the termination succeeded', async () => {
    const run = await setup({ name: 'drift', serverVersion: '2.27.0' });

    await rejection(run.backend.start(run.input, run.callbacks));

    expect(seen.terminateCalls).toBe(1);
    expect(seen.reaperStops).toBe(1);
  });
});

describe('a worker spawned without piped standard streams', () => {
  it('still terminates the worker during cleanup instead of throwing on the missing client', async () => {
    const run = await setup({ name: 'no-streams', steps: [{ op: 'hold' }] });
    seen.withoutStdio = true;

    const failure = await rejection(run.backend.start(run.input, run.callbacks));

    expect(failure.code).toBe('VSUP_INTERNAL');
    expect(seen.terminateCalls).toBe(1);
  });
});

describe('the spawned worker', () => {
  it('is the exact path the pin verified and does not keep a second copy of stdout', async () => {
    const run = await setup({ name: 'plain', steps: [{ op: 'say', text: 'Done.' }] });
    const linked = run.fake.appServer;
    const resolved = realpathSync(linked);
    expect(resolved).not.toBe(linked);

    const terminal = new Promise<RunState>((resolve) => {
      const onState = run.callbacks.onState;
      run.callbacks.onState = async (state, update) => { await onState(state, update); if (state === 'completed' || state === 'failed') resolve(state); };
    });
    const started = await run.backend.start(run.input, run.callbacks);
    await terminal;

    expect(seen.spawned).toHaveLength(1);
    expect(seen.spawned[0]?.executable).toBe(resolved);
    expect(started.process?.executable).toBe(resolved);
    expect(seen.spawned[0]?.options.retainStdout).toBe(false);
  });
});
