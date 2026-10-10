import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { hashWorkspace } from '../../src/core/workspace-snapshot.js';

const persistFault = vi.hoisted(() => ({ armed: false, fired: false }));

vi.mock('../../src/persistence/atomic.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/persistence/atomic.js')>();
  return {
    ...original,
    atomicWriteJson: async (file: string, value: unknown, ...rest: unknown[]) => {
      const record = value as { state?: string; workspace_snapshot_sha256?: string };
      if (persistFault.armed && file.endsWith('meta.json') && record.state === 'starting' && record.workspace_snapshot_sha256) {
        persistFault.armed = false; persistFault.fired = true;
        throw new Error('injected persist failure');
      }
      return (original.atomicWriteJson as (...args: unknown[]) => Promise<void>)(file, value, ...rest);
    }
  };
});

const canonicalTmp = await realpath(tmpdir());

const roots: string[] = [];

const unreadable: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const file of unreadable.splice(0)) await chmod(file, 0o700).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  readonly cancelled: string[] = [];
  readonly closed: string[] = [];
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async cancel(handle: BackendRunHandle) {
    this.cancelled.push(handle.runId);
    await this.callbacks.get(handle.runId)?.onState('cancelled');
  }
  async close(handle: BackendRunHandle) { this.closed.push(handle.runId); }
}

async function makeParent() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-regress-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source);
  return { parent, source, data };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

function collectUnhandledRejections() {
  const reasons: unknown[] = [];
  const listener = (reason: unknown) => { reasons.push(reason); };
  process.on('unhandledRejection', listener);
  return { reasons, stop: () => { process.off('unhandledRejection', listener); } };
}

const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RunManager regressions', () => {
  it('turns a source workspace change during a review into a warning instead of failing the run', async () => {
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    await writeFile(path.join(source, 'file.txt'), 'original\n');
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      await writeFile(path.join(source, 'file.txt'), 'modified by someone else, longer content\n');
      await backend.callbacks.get(started.run_id)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'partial findings' } });
      await backend.callbacks.get(started.run_id)?.onState('completed', { result: { summary: 'done' } });
      const status = await manager.status({ run_id: started.run_id });
      expect(status.state).toBe('completed');
      const result = await manager.result({ run_id: started.run_id });
      expect(result.summary).toBe('done');
      const warnings = result.warnings as string[];
      expect(warnings.some((warning) => /workspace|source/i.test(warning) && /chang|modif/i.test(warning))).toBe(true);
      expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'transcript.md' })]));
      expect((await stat(path.join(data, 'runs', started.run_id, 'result.json'))).isFile()).toBe(true);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('records a diagnostic event when a backend reports a state transition that is invalid for the run', async () => {
    const collector = collectUnhandledRejections();
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      const callbacks = backend.callbacks.get(started.run_id);
      await callbacks?.onState('completed', { result: { summary: 'done' } });
      expect((await manager.status({ run_id: started.run_id })).state).toBe('completed');
      await expect(Promise.resolve(callbacks?.onState('running'))).resolves.toBeUndefined();
      expect((await manager.status({ run_id: started.run_id })).state).toBe('completed');
      const readDiagnostics = async () => (await readFile(path.join(data, 'runs', started.run_id, 'events.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>).filter((event) => event.type === 'diagnostic' && (event.data as Record<string, unknown>).reason === 'ignored_backend_state_transition');
      const diagnostics = await waitFor(readDiagnostics, (value) => value.length > 0);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ source: 'supervisor', severity: 'warning', data: { backend_state: 'running', run_state: 'completed' } });
      expect(String((diagnostics[0]?.data as Record<string, unknown>).message)).toContain('completed -> running');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(collector.reasons).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);

  it('closing a completed one-shot run reports closed without a failed transition', async () => {
    const collector = collectUnhandledRejections();
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    const started = await manager.reviewStart({ task: 'review', cwd: source });
    await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
    await backend.callbacks.get(started.run_id)?.onState('completed', { result: { summary: 'done' } });
    const runDirectory = path.join(data, 'runs', started.run_id);
    try {
      const closed = await manager.close({ run_id: started.run_id });
      expect(closed.state).toBe('closed');
      await settle();
      const status = await manager.status({ run_id: started.run_id });
      expect(status.state).toBe('closed');
      expect(status.error).toBeUndefined();
      const meta = JSON.parse(await readFile(path.join(runDirectory, 'meta.json'), 'utf8')) as { state: string; error?: unknown };
      expect(meta.state).toBe('closed');
      expect(meta.error).toBeUndefined();
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);

  it('shutting down with a completed but unclosed one-shot run produces no unhandled rejection', async () => {
    const collector = collectUnhandledRejections();
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    const started = await manager.reviewStart({ task: 'review', cwd: source });
    await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
    await backend.callbacks.get(started.run_id)?.onState('completed', { result: { summary: 'done' } });
    const runDirectory = path.join(data, 'runs', started.run_id);
    try {
      await manager.shutdown();
      await settle();
      const meta = JSON.parse(await readFile(path.join(runDirectory, 'meta.json'), 'utf8')) as { state: string; error?: unknown };
      expect(meta.state).toBe('completed');
      expect(meta.error).toBeUndefined();
      expect(started.run_id).toBeTruthy();
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);

  it.skipIf(process.getuid?.() === 0)('proceeds with a warning when the source workspace cannot be snapshotted', async () => {
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    const locked = path.join(source, 'locked');
    await mkdir(locked); await writeFile(path.join(locked, 'secret.txt'), 'secret\n'); await chmod(locked, 0o000); unreadable.push(locked);
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      const running = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running' || value.state === 'failed');
      expect(running.state, JSON.stringify(running.error)).toBe('running');
      await backend.callbacks.get(started.run_id)?.onState('completed', { result: { summary: 'done', warnings: ['backend warning'] } });
      const result = await manager.result({ run_id: started.run_id });
      expect(result.state).toBe('completed');
      const warnings = result.warnings as string[];
      expect(warnings).toContain('backend warning');
      expect(warnings.some((warning) => /could not be snapshotted/.test(warning))).toBe(true);
      const onDisk = JSON.parse(await readFile(path.join(data, 'runs', started.run_id, 'result.json'), 'utf8')) as { warnings: string[] };
      expect(onDisk.warnings.some((warning) => /could not be snapshotted/.test(warning))).toBe(true);
      expect(warnings.some((warning) => /changed during|could not be verified/.test(warning))).toBe(false);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('fails the run when saving the record right after a successful snapshot fails', async () => {
    const backend = new FakeBackend();
    const { source, data } = await makeParent();
    await writeFile(path.join(source, 'file.txt'), 'content\n');
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    persistFault.armed = true; persistFault.fired = false;
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'failed' || value.state === 'running');
      expect(persistFault.fired).toBe(true);
      expect(status.state).toBe('failed');
      const result = await manager.result({ run_id: started.run_id });
      expect((result.warnings as string[]).some((warning) => /could not be snapshotted/.test(warning))).toBe(false);
    } finally { persistFault.armed = false; await manager.shutdown(); }
  }, 30_000);

  it('hashWorkspace enforces the entry limit and bounds only the hashed bytes', async () => {
    const { source } = await makeParent();
    await writeFile(path.join(source, 'a.txt'), 'aaaa'); await writeFile(path.join(source, 'b.txt'), 'bbbb'); await writeFile(path.join(source, 'c.txt'), 'cccc');
    expect(await hashWorkspace(source)).toMatch(/^[0-9a-f]{64}$/);
    await expect(hashWorkspace(source, { maxFiles: 2, maxBytes: 1_000 })).rejects.toMatchObject({ code: 'VSUP_OUTPUT_LIMIT' });
    await expect(hashWorkspace(source, { maxFiles: 3, maxBytes: 0 })).resolves.toMatch(/^[0-9a-f]{64}$/);
    spawnSync('git', ['init', '-q'], { cwd: source });
    await expect(hashWorkspace(source, { maxFiles: 10, maxBytes: 8 })).rejects.toMatchObject({ code: 'VSUP_OUTPUT_LIMIT' });
    await expect(hashWorkspace(source, { maxFiles: 10, maxBytes: 12 })).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('releases the programmatic worker when artifact finalization fails a completed run', async () => {
    const collector = collectUnhandledRejections();
    const { source, data } = await makeParent();
    const backend = new FakeBackend();
    const config = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], limits: { ...DEFAULT_CONFIG.limits, maxArtifactBytes: 10 } };
    const manager = new RunManager(config, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      await backend.callbacks.get(started.run_id)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'findings exceed the artifact limit' } });
      await backend.callbacks.get(started.run_id)?.onState('completed', { result: { summary: 'done' } });
      const status = await manager.status({ run_id: started.run_id });
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_OUTPUT_LIMIT' });
      await settle(300);
      const lines = (await readFile(path.join(data, 'runs', started.run_id, 'events.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines.filter((event) => (event.data as Record<string, unknown> | undefined)?.reason === 'ignored_backend_state_transition')).toEqual([]);
      expect((await manager.status({ run_id: started.run_id })).state).toBe('failed');
      expect(backend.closed).toEqual([started.run_id]);
      expect(collector.reasons.map(String)).toEqual([]);
    } finally { collector.stop(); await manager.shutdown(); }
  }, 30_000);

  describe('failed runs release their backend session exactly once', () => {
    async function start(overrides: Partial<typeof DEFAULT_CONFIG> = {}) {
      const backend = new FakeBackend();
      const { source, data } = await makeParent();
      const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], ...overrides }, data, [backend]);
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
      return { backend, manager, runId: started.run_id, data };
    }
    const released = (backend: FakeBackend, runId: string) => backend.closed.filter((id) => id === runId).length;

    it('when the backend reports failed while its process is still alive', async () => {
      const collector = collectUnhandledRejections();
      const { backend, manager, runId, data } = await start();
      try {
        await backend.callbacks.get(runId)?.onState('failed', { error: { code: 'VSUP_OUTPUT_LIMIT', message: 'limit', remediation: 'r', retryable: false } });
        await settle(100);
        expect((await manager.status({ run_id: runId })).state).toBe('failed');
        expect(released(backend, runId)).toBe(1);
        expect(backend.closed).toEqual([runId]);
        await manager.shutdown();
        expect(released(backend, runId)).toBe(1);
        expect(collector.reasons).toEqual([]);
        const events = await readFile(path.join(data, 'runs', runId, 'events.ndjson'), 'utf8');
        expect(events).not.toContain('ignored_backend_state_transition');
      } finally { collector.stop(); await manager.shutdown(); }
    }, 30_000);

    it('when a completed run fails during artifact finalization', async () => {
      const { backend, manager, runId } = await start({ limits: { ...DEFAULT_CONFIG.limits, maxArtifactBytes: 10 } });
      try {
        await backend.callbacks.get(runId)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'findings that exceed ten bytes' } });
        await backend.callbacks.get(runId)?.onState('completed', { result: { summary: 'done' } });
        expect((await manager.status({ run_id: runId })).state).toBe('failed');
        await settle(100);
        expect(backend.closed).toEqual([runId]);
        expect(backend.cancelled).toEqual([]);
        await manager.close({ run_id: runId });
        expect(backend.closed).toEqual([runId]);
      } finally { await manager.shutdown(); }
    }, 30_000);

    it('when a failure is reported after the run already completed', async () => {
      const { backend, manager, runId } = await start();
      try {
        await backend.callbacks.get(runId)?.onState('completed', { result: { summary: 'done' } });
        await backend.callbacks.get(runId)?.onState('failed', { error: { code: 'VSUP_BACKEND_CRASHED', message: 'late', remediation: 'r', retryable: false } });
        await settle(100);
        expect((await manager.status({ run_id: runId })).state).toBe('completed');
        expect(backend.closed).toEqual([runId]);
        await manager.shutdown();
        expect(backend.closed).toEqual([runId]);
      } finally { await manager.shutdown(); }
    }, 30_000);

    it('when the transcript limit fails the run', async () => {
      const { backend, manager, runId } = await start({ limits: { ...DEFAULT_CONFIG.limits, maxTranscriptBytes: 8 } });
      try {
        await backend.callbacks.get(runId)?.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'this text is longer than the limit' } });
        const status = await waitFor(() => manager.status({ run_id: runId }), (value) => value.state === 'failed');
        expect(status.state).toBe('failed');
        await settle(100);
        expect(backend.cancelled).toEqual([runId]);
        expect(released(backend, runId)).toBe(1);
        await manager.shutdown();
        expect(released(backend, runId)).toBe(1);
      } finally { await manager.shutdown(); }
    }, 30_000);

    it('when the deadline expires', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
      const backend = new FakeBackend();
      const { source, data } = await makeParent();
      const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
      try {
        const started = await manager.reviewStart({ task: 'review', cwd: source, timeout_seconds: 30 });
        await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running', 5_000);
        await vi.advanceTimersByTimeAsync(31_000);
        const failed = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'failed', 5_000);
        expect(failed.error).toMatchObject({ code: 'VSUP_TIMEOUT' });
        await manager.shutdown();
        expect(backend.cancelled).toEqual([started.run_id]);
        expect(released(backend, started.run_id)).toBe(1);
      } finally { await manager.shutdown(); }
    }, 30_000);
  });
});
