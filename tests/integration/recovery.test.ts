import { authorizedReviewStart } from "../support/authorized-start.js";
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { TEST_CONFIG } from '../unit/support/test-config.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runToWire } from '../../src/core/serialization.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
  starts = 0;
  cancels: string[] = [];
  closes: string[] = [];
  callbacks = new Map<string, BackendCallbacks>();
  async probe() { return { available: true, backend: this.kind, version: '2.26.1' }; }
  readonly kind = 'app-server' as const;
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.starts += 1;
    this.callbacks.set(input.runId, callbacks);
    const handle = { runId: input.runId, backend: this.kind, opaque: {} };
    callbacks.onSpawn?.(handle);
    return { handle, initialState: 'running' };
  }
  async cancel(handle: BackendRunHandle) { this.cancels.push(handle.runId); }
  async close(handle: BackendRunHandle) { this.closes.push(handle.runId); }
}

async function setup() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-reduced-restart-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source);
  return { parent, source, data };
}

function baseRecord(source: string): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, runId: randomUUID(), backend: 'app-server', mode: 'review', state: 'running',
    sourceWorkspace: source, workerWorkspace: source, createdAt: now, updatedAt: now, launchedAt: now,
    taskSha256: 'a'.repeat(64), limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_048_576, maxTranscriptBytes: 1_048_576, maxArtifactBytes: 8_388_608 }
  };
}

async function writeRecord(data: string, record: RunRecord, backendOverride?: string): Promise<string> {
  const directory = path.join(data, 'runs', record.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const wire = runToWire(record);
  if (backendOverride) wire.backend = backendOverride;
  await writeFile(path.join(directory, 'meta.json'), JSON.stringify(wire), { mode: 0o600 });
  return directory;
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 10_000;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;

describe('one-shot restart behavior', () => {
  it('marks an interrupted run failed without starting, replaying, or signaling a saved PID', async () => {
    const { source, data } = await setup();
    const record = baseRecord(source);
    record.process = { pid: 99999999, executable: '/not-used/vibe', version: '2.26.1' };
    const directory = await writeRecord(data, record);
    const metaBefore = await readFile(path.join(directory, 'meta.json'), 'utf8');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...TEST_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      await manager.initialize();
      const status = await manager.status({ run_id: record.runId });
      expect(status).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
      expect((status.error as { message: string }).message).toContain('not resumed or replayed');
      const recovered = JSON.parse(await readFile(path.join(directory, 'meta.json'), 'utf8')) as { execution_state?: string; started_at?: string };
      expect(recovered.execution_state).toBe('failed');
      expect(recovered.started_at).toBeUndefined();
      expect(backend.starts).toBe(0);
      expect(backend.cancels).toEqual([]);
      expect(backend.closes).toEqual([]);
      expect(activeSlots(manager)).toBe(0);
      expect(await readFile(path.join(directory, 'meta.json'), 'utf8')).not.toBe(metaBefore);
      expect(await readFile(path.join(directory, 'result.json'), 'utf8')).toContain('not resumed or replayed');
    } finally { await manager.shutdown(); }
  });

  async function privateDirectories(directory: string): Promise<string[]> {
    const names = ['child-home', 'vibe-home', 'tmp'];
    for (const name of names) await mkdir(path.join(directory, name), { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, 'child-home', 'state.json'), '{}');
    return names.map((name) => path.join(directory, name));
  }

  const present = (file: string) => readdir(path.dirname(file)).then((names) => names.includes(path.basename(file)));

  it('keeps the private directories until the reaper window of a worker that may still be alive has passed', async () => {
    const { source, data } = await setup();
    const record = baseRecord(source);
    const directory = await writeRecord(data, record);
    const [home] = await privateDirectories(directory);
    const manager = new RunManager({ ...TEST_CONFIG, allowedWorkspaceRoots: [source] }, data, [new FakeBackend()], undefined, { recoveryWorkerWindowMs: 700 });
    try {
      const begun = Date.now();
      const initializing = manager.initialize();
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await present(home as string)).toBe(true);
      await initializing;
      expect(Date.now() - begun).toBeGreaterThanOrEqual(650);
      for (const name of ['child-home', 'vibe-home', 'tmp']) expect(await present(path.join(directory, name))).toBe(false);
      expect(await manager.status({ run_id: record.runId })).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
    } finally { await manager.shutdown(); }
  });

  it('does not wait when the run has no private directories left', async () => {
    const { source, data } = await setup();
    const record = baseRecord(source);
    await writeRecord(data, record);
    const manager = new RunManager({ ...TEST_CONFIG, allowedWorkspaceRoots: [source] }, data, [new FakeBackend()], undefined, { recoveryWorkerWindowMs: 5000 });
    try {
      const begun = Date.now();
      await manager.initialize();
      expect(Date.now() - begun).toBeLessThan(2500);
    } finally { await manager.shutdown(); }
  });

  it('does not wait when the recorded reaper deadline has long passed', async () => {
    const { source, data } = await setup();
    const record = baseRecord(source);
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    Object.assign(record, { createdAt: old, updatedAt: old, launchedAt: old });
    const directory = await writeRecord(data, record);
    await privateDirectories(directory);
    const manager = new RunManager({ ...TEST_CONFIG, allowedWorkspaceRoots: [source] }, data, [new FakeBackend()], undefined, { recoveryWorkerWindowMs: 5000 });
    try {
      const begun = Date.now();
      await manager.initialize();
      expect(Date.now() - begun).toBeLessThan(2500);
      expect(await present(path.join(directory, 'child-home'))).toBe(false);
    } finally { await manager.shutdown(); }
  });

  it('skips a saved record with an unknown backend, leaving its metadata and artifacts byte-identical', async () => {
    const { source, data } = await setup();
    const record = baseRecord(source);
    const directory = await writeRecord(data, record, 'unknown-backend');
    const metaPath = path.join(directory, 'meta.json');
    const before = await readFile(metaPath, 'utf8');
    const artifactDir = path.join(directory, 'artifacts');
    await mkdir(artifactDir);
    const artifactPath = path.join(artifactDir, 'output.txt');
    await writeFile(artifactPath, 'saved output\n');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...TEST_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      await manager.initialize();
      expect(await readFile(metaPath, 'utf8')).toBe(before);
      expect(await readFile(artifactPath, 'utf8')).toBe('saved output\n');
      expect(backend.starts).toBe(0);
      await expect(manager.status({ run_id: record.runId })).rejects.toMatchObject({ code: 'VSUP_NOT_FOUND' });
      expect(await readdir(path.join(data, 'runs'))).toContain(record.runId);
    } finally { await manager.shutdown(); }
  });

  it('releases the active worker on shutdown and stores an interrupted failure', async () => {
    const { source, data } = await setup();
    const backend = new FakeBackend();
    const manager = new RunManager({ ...TEST_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    const started = await authorizedReviewStart(manager, { task: 'one shot', cwd: source });
    await waitFor(() => manager.status({ run_id: started.run_id }), (status) => status.state === 'running');
    await manager.shutdown();
    const meta = JSON.parse(await readFile(path.join(data, 'runs', started.run_id, 'meta.json'), 'utf8')) as { state: string; error?: { code: string } };
    expect(meta).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
    expect(backend.cancels).toEqual([started.run_id]);
    expect(backend.closes).toEqual([started.run_id]);
    expect(activeSlots(manager)).toBe(0);
  });
});
