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
afterEach(async () => { fault.events = false; await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

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

describe('an event flush that hits ENOSPC', () => {
  it('degrades the run, keeps the events in memory, and heals after a later meta write and flush', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-flush-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      for (let attempt = 0; attempt < 500 && (await manager.status({ run_id: started.run_id })).state !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      const callbacks = backend.callbacks.get(started.run_id)!;
      fault.events = true;
      await callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'progress' } });
      await callbacks.onState('ready');
      const degraded = await manager.status({ run_id: started.run_id });
      expect(degraded.warnings).toHaveLength(1);
      expect(degraded.state).toBe('ready');
      expect((degraded.events as { type: string }[]).some((event) => event.type === 'message')).toBe(true);
      await callbacks.onState('running');
      expect((await manager.status({ run_id: started.run_id })).warnings).toHaveLength(1);
      fault.events = false;
      await callbacks.onState('ready');
      expect((await manager.status({ run_id: started.run_id })).warnings).toBeUndefined();
      await callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'more progress' } });
      expect((await manager.status({ run_id: started.run_id })).warnings).toBeUndefined();
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('degrades from a timer flush with no state change', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-flush-')); roots.push(parent);
    const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      for (let attempt = 0; attempt < 500 && (await manager.status({ run_id: started.run_id })).state !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      fault.events = true;
      await backend.callbacks.get(started.run_id)!.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'progress' } });
      let status = await manager.status({ run_id: started.run_id });
      for (let attempt = 0; attempt < 100 && !status.warnings; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 20)); status = await manager.status({ run_id: started.run_id }); }
      expect(status.warnings).toHaveLength(1);
    } finally { await manager.shutdown(); }
  }, 30_000);
});
