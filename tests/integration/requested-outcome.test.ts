import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class CompletingCancelBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async cancel(handle: BackendRunHandle) { await this.callbacks.get(handle.runId)?.onState('completed', { result: { summary: 'finished anyway' } }); }
  async close() {}
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function startRunning(timeoutSeconds?: number) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-requested-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source);
  const backend = new CompletingCancelBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
  const started = await manager.reviewStart({ task: 'review', cwd: source, ...(timeoutSeconds ? { timeout_seconds: timeoutSeconds } : {}) });
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
  return { manager, runId: started.run_id, data };
}

const readEvents = async (data: string, runId: string) => (await readFile(path.join(data, 'runs', runId, 'events.ndjson'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;

describe('a supervisor decision wins over a backend that reports completed', () => {
  it('ends a cancelled run as cancelled', async () => {
    const { manager, runId, data } = await startRunning();
    try {
      expect(await manager.cancel({ run_id: runId })).toMatchObject({ state: 'cancelled' });
      expect(await manager.status({ run_id: runId })).toMatchObject({ state: 'cancelled' });
      expect(JSON.parse(await readFile(path.join(data, 'runs', runId, 'result.json'), 'utf8'))).toMatchObject({ state: 'cancelled' });
      expect(await waitFor(async () => activeSlots(manager), (value) => value === 0)).toBe(0);
    } finally { await manager.shutdown(); }
  });

  it('ends an expired run as failed with VSUP_TIMEOUT and records the timeout event', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const { manager, runId, data } = await startRunning(30);
    try {
      await vi.advanceTimersByTimeAsync(31_000);
      const status = await waitFor(() => manager.status({ run_id: runId }), (value) => value.state !== 'running');
      expect(status).toMatchObject({ state: 'failed', error: { code: 'VSUP_TIMEOUT' } });
      expect((await readEvents(data, runId)).filter((event) => event.type === 'timeout')).toEqual([expect.objectContaining({ data: { timeout_seconds: 30 } })]);
      expect(await waitFor(async () => activeSlots(manager), (value) => value === 0)).toBe(0);
    } finally { await manager.shutdown(); }
  }, 30_000);
});
