import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';

const fault = vi.hoisted(() => ({ metaRemaining: 0, events: false }));

vi.mock('../../src/persistence/atomic.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/persistence/atomic.js')>();
  return {
    ...original,
    atomicWriteJson: async (file: string, value: unknown, ...rest: unknown[]) => {
      if (fault.metaRemaining > 0 && file.endsWith('meta.json')) { fault.metaRemaining -= 1; throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); }
      return (original.atomicWriteJson as (...args: unknown[]) => Promise<void>)(file, value, ...rest);
    }
  };
});

vi.mock('../../src/persistence/ndjson.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/persistence/ndjson.js')>();
  return {
    ...original,
    appendNdjson: async (...args: Parameters<typeof original.appendNdjson>) => {
      if (fault.events) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      return original.appendNdjson(...args);
    }
  };
});

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

afterEach(async () => {
  fault.metaRemaining = 0; fault.events = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
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

describe('the storage warning stays until both kinds of write work again', () => {
  it('keeps warning after a meta write succeeds while event appends still fail, and clears once an event is appended', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-degraded-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      const callbacks = backend.callbacks.get(started.run_id);
      fault.events = true; fault.metaRemaining = 1;
      await callbacks?.onState('ready');
      expect((await manager.status({ run_id: started.run_id })).warnings).toHaveLength(1);
      await callbacks?.onState('running');
      expect((await manager.status({ run_id: started.run_id })).state).toBe('running');
      expect((await manager.status({ run_id: started.run_id })).warnings).toHaveLength(1);
      fault.events = false;
      await callbacks?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'progress' } });
      expect((await manager.status({ run_id: started.run_id })).warnings).toBeUndefined();
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('clears the warning once a meta write and an event append both succeeded after the failure', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-degraded-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      const callbacks = backend.callbacks.get(started.run_id);
      fault.metaRemaining = 1;
      await callbacks?.onState('ready');
      expect((await manager.status({ run_id: started.run_id })).warnings).toHaveLength(1);
      await callbacks?.onState('running');
      expect((await manager.status({ run_id: started.run_id })).warnings).toHaveLength(1);
      await callbacks?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'progress' } });
      expect((await manager.status({ run_id: started.run_id })).warnings).toBeUndefined();
    } finally { await manager.shutdown(); }
  }, 30_000);
});
