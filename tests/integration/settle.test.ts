import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { supervisorError } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class SettleBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  readonly cancelled: string[] = [];
  readonly closed: string[] = [];
  startFailure = false;
  completeInsideStart = false;
  cancelFailure = false;
  closeFailure = false;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    if (this.startFailure) throw supervisorError('VSUP_BACKEND_CRASHED', 'start failed');
    const handle = { runId: input.runId, backend: this.kind, opaque: {} };
    callbacks.onSpawn?.(handle);
    if (this.completeInsideStart) {
      await callbacks.onState('completed', { result: { summary: 'completed before start returned' } });
    }
    return { handle, initialState: 'running' };
  }
  async cancel(handle: BackendRunHandle) { this.cancelled.push(handle.runId); if (this.cancelFailure) throw new Error('owned worker still alive'); }
  async close(handle: BackendRunHandle) { this.closed.push(handle.runId); if (this.closeFailure) throw new Error('process group still alive'); }
}

async function setup(limits = DEFAULT_CONFIG.limits) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-settle-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source);
  const backend = new SettleBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], limits }, data, [backend]);
  return { manager, backend, data, source };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

const state = (manager: RunManager, runId: string) => manager.status({ run_id: runId }).then((value) => String(value.state));
const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;
async function readResult(data: string, runId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(data, 'runs', runId, 'result.json'), 'utf8')) as Record<string, unknown>;
}

describe('one-shot settlement', () => {
  it('records startup failure and releases the reserved capacity', async () => {
    const context = await setup(); context.backend.startFailure = true;
    try {
      const started = await context.manager.reviewStart({ task: 'fail start', cwd: context.source });
      const status = await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === 'failed');
      expect(status.error).toMatchObject({ code: 'VSUP_BACKEND_CRASHED' });
      await waitFor(async () => activeSlots(context.manager), (value) => value === 0);
      expect(await readResult(context.data, started.run_id)).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
    } finally { await context.manager.shutdown(); }
  });

  it('releases a completed process immediately and ignores a late failure callback', async () => {
    const context = await setup();
    try {
      const started = await context.manager.reviewStart({ task: 'complete', cwd: context.source });
      await waitFor(() => state(context.manager, started.run_id), (value) => value === 'running');
      const callbacks = context.backend.callbacks.get(started.run_id)!;
      await callbacks.onState('completed', { result: { summary: 'done' } });
      await callbacks.onState('failed', { error: supervisorError('VSUP_BACKEND_CRASHED', 'late') });
      expect(await state(context.manager, started.run_id)).toBe('completed');
      expect(await waitFor(async () => context.backend.closed.slice(), (closed) => closed.includes(started.run_id))).toEqual([started.run_id]);
      expect(context.backend.cancelled).toEqual([]);
      expect(activeSlots(context.manager)).toBe(0);
      expect(await readResult(context.data, started.run_id)).toMatchObject({ state: 'completed', summary: 'done' });
    } finally { await context.manager.shutdown(); }
  });

  it('does not reattach a handle when completion arrives before backend start returns', async () => {
    const context = await setup();
    context.backend.completeInsideStart = true;
    try {
      const first = await context.manager.reviewStart({ task: 'complete during start', cwd: context.source });
      expect(await waitFor(() => state(context.manager, first.run_id), (value) => value === 'completed')).toBe('completed');
      expect(await waitFor(async () => context.backend.closed.slice(), (closed) => closed.includes(first.run_id))).toEqual([first.run_id]);
      await waitFor(async () => activeSlots(context.manager), (slots) => slots === 0);

      context.backend.completeInsideStart = false;
      const second = await context.manager.reviewStart({ task: 'next run', cwd: context.source });
      expect(await waitFor(() => state(context.manager, second.run_id), (value) => value === 'running')).toBe('running');
      await context.backend.callbacks.get(second.run_id)?.onState('completed', { result: { summary: 'done' } });
      expect(context.backend.closed).toEqual([first.run_id, second.run_id]);
    } finally { await context.manager.shutdown(); }
  });

  it('turns backend failure into a bounded failed result and releases the worker once', async () => {
    const context = await setup();
    try {
      const started = await context.manager.reviewStart({ task: 'fail', cwd: context.source });
      await waitFor(() => state(context.manager, started.run_id), (value) => value === 'running');
      await context.backend.callbacks.get(started.run_id)?.onState('failed', { error: supervisorError('VSUP_BACKEND_CRASHED', 'crashed') });
      expect(await state(context.manager, started.run_id)).toBe('failed');
      expect(context.backend.closed).toEqual([started.run_id]);
      expect(activeSlots(context.manager)).toBe(0);
      expect(await readResult(context.data, started.run_id)).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
    } finally { await context.manager.shutdown(); }
  });

  it('rejects a simultaneous second start without creating or queueing a run', async () => {
    const context = await setup();
    try {
      const first = await context.manager.reviewStart({ task: 'first', cwd: context.source });
      await waitFor(() => state(context.manager, first.run_id), (value) => value === 'running');
      await expect(context.manager.reviewStart({ task: 'second', cwd: context.source })).rejects.toMatchObject({ code: 'VSUP_LIMIT_EXCEEDED' });
      expect(await context.manager.runsList()).toHaveLength(1);
      expect(context.backend.callbacks.size).toBe(1);
      await context.backend.callbacks.get(first.run_id)?.onState('completed', { result: { summary: 'done' } });
    } finally { await context.manager.shutdown(); }
  });

  it('settles shutdown as interrupted failure and closes the owned worker exactly once', async () => {
    const context = await setup();
    const started = await context.manager.reviewStart({ task: 'active', cwd: context.source });
    await waitFor(() => state(context.manager, started.run_id), (value) => value === 'running');
    await context.manager.shutdown();
    expect(await state(context.manager, started.run_id)).toBe('failed');
    expect(context.backend.cancelled).toEqual([started.run_id]);
    expect(context.backend.closed).toEqual([started.run_id]);
    expect(activeSlots(context.manager)).toBe(0);
  });

  it('retains the active slot and live handle when close cannot prove worker termination, then permits a safe retry', async () => {
    const context = await setup();
    try {
      const started = await context.manager.reviewStart({ task: 'active worker', cwd: context.source });
      await waitFor(() => state(context.manager, started.run_id), (value) => value === 'running');
      context.backend.cancelFailure = true;

      const failedClose = await context.manager.close({ run_id: started.run_id, cleanup_worktree: true });
      expect(failedClose).toMatchObject({ state: 'running', worker_termination_unverified: true, error: { code: 'VSUP_BACKEND_ERROR' } });
      expect(activeSlots(context.manager)).toBe(1);
      expect(context.backend.closed).toEqual([]);
      await expect(context.manager.reviewStart({ task: 'must not overlap', cwd: context.source })).rejects.toMatchObject({ code: 'VSUP_LIMIT_EXCEEDED' });

      context.backend.cancelFailure = false;
      const retried = await context.manager.close({ run_id: started.run_id });
      expect(retried.state).toBe('closed');
      expect(context.backend.cancelled).toEqual([started.run_id, started.run_id]);
      expect(context.backend.closed).toEqual([started.run_id]);
      expect(activeSlots(context.manager)).toBe(0);
    } finally { await context.manager.shutdown(); }
  });

  it('does not release the slot when backend close fails after cancellation, and retries close on the same handle', async () => {
    const context = await setup();
    try {
      const started = await context.manager.reviewStart({ task: 'close fails', cwd: context.source });
      await waitFor(() => state(context.manager, started.run_id), (value) => value === 'running');
      context.backend.closeFailure = true;

      const failedClose = await context.manager.close({ run_id: started.run_id });
      expect(failedClose).toMatchObject({ state: 'failed', worker_termination_unverified: true, error: { code: 'VSUP_BACKEND_ERROR' } });
      expect(activeSlots(context.manager)).toBe(1);
      expect(context.backend.closed).toEqual([started.run_id, started.run_id]);
      await expect(context.manager.reviewStart({ task: 'must not overlap', cwd: context.source })).rejects.toMatchObject({ code: 'VSUP_LIMIT_EXCEEDED' });

      context.backend.closeFailure = false;
      const retried = await context.manager.close({ run_id: started.run_id });
      expect(retried.state).toBe('closed');
      expect(context.backend.closed).toEqual([started.run_id, started.run_id, started.run_id]);
      expect(activeSlots(context.manager)).toBe(0);
    } finally { await context.manager.shutdown(); }
  });

  it('keeps shutdown ownership when termination is unverified and drains after a later owned-handle retry', async () => {
    const context = await setup();
    const started = await context.manager.reviewStart({ task: 'shutdown with live worker', cwd: context.source });
    await waitFor(() => state(context.manager, started.run_id), (value) => value === 'running');
    context.backend.cancelFailure = true;
    const result = await context.manager.shutdown(25);
    expect(result).toMatchObject({ timedOut: false, terminationUnverified: true });
    expect(activeSlots(context.manager)).toBe(1);
    expect((context.manager as unknown as { ownerLock?: unknown }).ownerLock).toBeDefined();
    expect(context.backend.closed).toEqual([]);

    context.backend.cancelFailure = false;
    await waitFor(async () => activeSlots(context.manager), (value) => value === 0, 5_000);
    await context.manager.shutdown();
    expect((context.manager as unknown as { ownerLock?: unknown }).ownerLock).toBeUndefined();
    expect(context.backend.closed).toEqual([started.run_id]);
  });

  it('fails on transcript overflow while preserving the output-limit error', async () => {
    const limits = { ...DEFAULT_CONFIG.limits, maxTranscriptBytes: 8 };
    const context = await setup(limits);
    try {
      const started = await context.manager.reviewStart({ task: 'overflow', cwd: context.source });
      await waitFor(() => state(context.manager, started.run_id), (value) => value === 'running');
      await context.backend.callbacks.get(started.run_id)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'this is too long' } });
      expect(await waitFor(() => state(context.manager, started.run_id), (value) => value === 'failed')).toBe('failed');
      expect((await context.manager.status({ run_id: started.run_id })).error).toMatchObject({ code: 'VSUP_OUTPUT_LIMIT' });
      await waitFor(async () => context.backend.closed.includes(started.run_id), Boolean);
      expect(context.backend.closed).toEqual([started.run_id]);
    } finally { await context.manager.shutdown(); }
  });
});
