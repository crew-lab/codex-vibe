import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';

type Wire = { state?: string; result?: unknown; workspace_snapshot_sha256?: string; limits?: { max_turns?: number } };
const fault = vi.hoisted(() => ({ code: 'ENOSPC', remaining: 0, when: (_wire: Wire) => false, fired: 0 }));

vi.mock('../../src/persistence/atomic.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/persistence/atomic.js')>();
  return {
    ...original,
    atomicWriteJson: async (file: string, value: unknown, ...rest: unknown[]) => {
      if (fault.remaining > 0 && file.endsWith('meta.json') && fault.when(value as Wire)) {
        fault.remaining -= 1; fault.fired += 1;
        throw Object.assign(new Error(`${fault.code}: no space left on device, write`), { code: fault.code });
      }
      return (original.atomicWriteJson as (...args: unknown[]) => Promise<void>)(file, value, ...rest);
    }
  };
});

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const restore: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  fault.remaining = 0; fault.fired = 0; fault.when = () => false;
  for (const directory of restore.splice(0)) await chmod(directory, 0o700).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 200));
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

async function harness(overrides: Partial<typeof DEFAULT_CONFIG> = {}) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-storage-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
  const backend = new FakeBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], ...overrides }, data, [backend]);
  return { backend, manager, source, data };
}

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

const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;

async function waitForLaunchManifest(manager: RunManager, runId: string): Promise<void> {
  const runs = (manager as unknown as { runs: Map<string, { manifestWrite?: Promise<void> }> }).runs;
  const write = runs.get(runId)?.manifestWrite;
  expect(write).toBeDefined();
  await write;
}
const SECRET_TEXT = 'findings-that-must-not-appear-in-storage-errors';

async function runningWithTranscript(h: Awaited<ReturnType<typeof harness>>, task = 'review') {
  const started = await h.manager.reviewStart({ task, cwd: h.source });
  await waitFor(() => h.manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
  await h.backend.callbacks.get(started.run_id)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: SECRET_TEXT } });
  return started.run_id;
}

describe('storage faults', () => {
  it('fails the run with VSUP_STORAGE_ERROR when the completion persist hits ENOSPC, and keeps the pipeline moving', async () => {
    const collector = collectUnhandledRejections();
    const h = await harness();
    try {
      const runId = await runningWithTranscript(h);
      await expect(h.manager.reviewStart({ task: 'follow', cwd: h.source })).rejects.toMatchObject({ code: 'VSUP_LIMIT_EXCEEDED' });
      fault.remaining = 1; fault.when = (wire) => wire.state === 'running' && wire.result !== undefined;
      await h.backend.callbacks.get(runId)?.onState('completed', { result: { summary: 'done' } });
      const status = await h.manager.status({ run_id: runId });
      expect(fault.fired).toBe(1);
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_STORAGE_ERROR', details: { code: 'ENOSPC', directory: path.join(h.data, 'runs', runId) } });
      expect(JSON.stringify(status.error)).not.toContain(SECRET_TEXT);
      expect(JSON.parse(await readFile(path.join(h.data, 'runs', runId, 'meta.json'), 'utf8')).state).toBe('failed');
      expect(JSON.parse(await readFile(path.join(h.data, 'runs', runId, 'result.json'), 'utf8')).state).toBe('failed');
      expect(activeSlots(h.manager)).toBe(0);
      const follow = await h.manager.reviewStart({ task: 'follow', cwd: h.source });
      expect((await waitFor(() => h.manager.status({ run_id: follow.run_id }), (value) => value.state === 'running')).state).toBe('running');
      await h.manager.cancel({ run_id: follow.run_id });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await h.manager.shutdown(); }
  }, 30_000);

  it('keeps the in-memory outcome and reports a warning while the state cannot be saved', async () => {
    const collector = collectUnhandledRejections();
    const h = await harness();
    try {
      const runId = await runningWithTranscript(h);
      fault.remaining = Infinity; fault.when = () => true;
      await h.backend.callbacks.get(runId)?.onState('completed', { result: { summary: 'done' } });
      const status = await h.manager.status({ run_id: runId });
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_STORAGE_ERROR', details: { code: 'ENOSPC' } });
      expect(String((status.warnings as string[])[0])).toMatch(/could not be saved.*ENOSPC/);
      expect(activeSlots(h.manager)).toBe(0);
      expect(JSON.parse(await readFile(path.join(h.data, 'runs', runId, 'meta.json'), 'utf8')).state).toBe('running');
      fault.remaining = 0;
      const next = await h.manager.reviewStart({ task: 'next', cwd: h.source });
      const running = await waitFor(() => h.manager.status({ run_id: next.run_id }), (value) => value.state === 'running');
      expect(running.state).toBe('running');
      expect(running.warnings).toBeUndefined();
      await h.manager.cancel({ run_id: runId });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await h.manager.shutdown(); }
  }, 30_000);

  it('lets the first persist of start() propagate VSUP_STORAGE_ERROR without creating a run', async () => {
    const h = await harness();
    try {
      fault.remaining = 1; fault.when = (wire) => wire.state === 'starting' && !wire.workspace_snapshot_sha256;
      await expect(h.manager.reviewStart({ task: 'review', cwd: h.source })).rejects.toMatchObject({ code: 'VSUP_STORAGE_ERROR', details: { code: 'ENOSPC' } });
      expect(await h.manager.runsList()).toEqual([]);
      expect(activeSlots(h.manager)).toBe(0);
      const started = await h.manager.reviewStart({ task: 'review', cwd: h.source });
      expect((await waitFor(() => h.manager.status({ run_id: started.run_id }), (value) => value.state === 'running')).state).toBe('running');
    } finally { await h.manager.shutdown(); }
  }, 30_000);

  it.each(['EACCES', 'EPERM', 'EROFS', 'EIO', 'EDQUOT', 'EMFILE'])('maps %s from a persist to VSUP_STORAGE_ERROR', async (code) => {
    const h = await harness();
    try {
      fault.code = code; fault.remaining = 1; fault.when = (wire) => wire.state === 'starting' && !wire.workspace_snapshot_sha256;
      await expect(h.manager.reviewStart({ task: 'review', cwd: h.source })).rejects.toMatchObject({ code: 'VSUP_STORAGE_ERROR', details: { code } });
    } finally { fault.code = 'ENOSPC'; await h.manager.shutdown(); }
  }, 30_000);

  it.skipIf(process.getuid?.() === 0)('fails the run with EACCES when the run directory becomes unwritable mid-run', async () => {
    const collector = collectUnhandledRejections();
    const h = await harness();
    try {
      const runId = await runningWithTranscript(h);
      await expect(h.manager.reviewStart({ task: 'follow', cwd: h.source })).rejects.toMatchObject({ code: 'VSUP_LIMIT_EXCEEDED' });
      await waitForLaunchManifest(h.manager, runId);
      const runDirectory = path.join(h.data, 'runs', runId);
      await chmod(runDirectory, 0o500); restore.push(runDirectory);
      await h.backend.callbacks.get(runId)?.onState('completed', { result: { summary: 'done' } });
      await chmod(runDirectory, 0o700);
      const status = await h.manager.status({ run_id: runId });
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_STORAGE_ERROR', details: { code: 'EACCES' } });
      expect(JSON.stringify(status.error)).not.toContain(SECRET_TEXT);
      expect(activeSlots(h.manager)).toBe(0);
      const follow = await h.manager.reviewStart({ task: 'follow', cwd: h.source });
      expect((await waitFor(() => h.manager.status({ run_id: follow.run_id }), (value) => value.state === 'running')).state).toBe('running');
      await h.manager.cancel({ run_id: follow.run_id });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await h.manager.shutdown(); }
  }, 30_000);

  it('does not reject a programmatic run when recording an event fails', async () => {
    const collector = collectUnhandledRejections();
    const h = await harness();
    const manager = h.manager;
    const failing = vi.spyOn(manager as unknown as { appendEvent(...args: unknown[]): Promise<void> }, 'appendEvent').mockRejectedValue(Object.assign(new Error('write failed'), { code: 'ENOSPC' }));
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: h.source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      await h.backend.callbacks.get(started.run_id)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'progress' } });
      await h.backend.callbacks.get(started.run_id)?.onState('completed');
      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
      expect(failing).toHaveBeenCalled();
      expect(status.state).toBe('completed');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);
});
