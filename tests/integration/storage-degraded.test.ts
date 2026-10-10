import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';

const fault = vi.hoisted(() => ({ events: false }));

vi.mock('../../src/persistence/event-log.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/persistence/event-log.js')>();
  class FaultingEventLog extends original.EventLog {
    protected override async write(payload: string): Promise<void> {
      if (fault.events) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      return super.write(payload);
    }
  }
  return { ...original, EventLog: FaultingEventLog };
});

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

afterEach(async () => {
  fault.events = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async cancel(handle: BackendRunHandle) { await this.callbacks.get(handle.runId)?.onState('cancelled'); }
  async close(_handle: BackendRunHandle) {}
  async recover(_record: RunRecord) { return undefined; }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

describe('event storage degradation', () => {
  it('keeps the warning while event flushes fail, then clears after a successful flush', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-degraded-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      const callbacks = backend.callbacks.get(started.run_id);
      fault.events = true;
      await callbacks?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'temporary failure' } });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await manager.status({ run_id: started.run_id })).warnings).toHaveLength(1);
      expect((await manager.status({ run_id: started.run_id })).state).toBe('running');
      expect((await manager.status({ run_id: started.run_id })).warnings).toHaveLength(1);
      fault.events = false;
      await callbacks?.onState('completed');
      expect((await manager.status({ run_id: started.run_id })).warnings).toBeUndefined();
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('retains accepted events in memory during a failed flush and flushes them on recovery', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-degraded-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      const callbacks = backend.callbacks.get(started.run_id);
      fault.events = true;
      await callbacks?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'progress' } });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const degraded = await manager.status({ run_id: started.run_id });
      expect(degraded.warnings).toHaveLength(1);
      expect((degraded.events as { type: string }[]).some((event) => event.type === 'message')).toBe(true);
      fault.events = false;
      await callbacks?.onState('completed');
      expect((await manager.status({ run_id: started.run_id })).warnings).toBeUndefined();
    } finally { await manager.shutdown(); }
  }, 30_000);
});
