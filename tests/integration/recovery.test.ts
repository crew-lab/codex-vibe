import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
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
  readonly kind = 'programmatic' as const;
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

function baseRecord(source: string, backend: 'programmatic' | 'acp' = 'programmatic'): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, runId: randomUUID(), backend: backend as 'programmatic', mode: 'review', state: 'running',
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
  it('marks an interrupted programmatic run failed without starting, replaying, or signaling a saved PID', async () => {
    const { source, data } = await setup();
    const record = baseRecord(source);
    record.process = { pid: 99999999, executable: '/not-used/vibe', version: '2.26.1' };
    const directory = await writeRecord(data, record);
    const metaBefore = await readFile(path.join(directory, 'meta.json'), 'utf8');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      await manager.initialize();
      const status = await manager.status({ run_id: record.runId });
      expect(status).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
      expect((status.error as { message: string }).message).toContain('not resumed or replayed');
      expect(backend.starts).toBe(0);
      expect(backend.cancels).toEqual([]);
      expect(backend.closes).toEqual([]);
      expect(activeSlots(manager)).toBe(0);
      expect(await readFile(path.join(directory, 'meta.json'), 'utf8')).not.toBe(metaBefore);
      expect(await readFile(path.join(directory, 'result.json'), 'utf8')).toContain('not resumed or replayed');
    } finally { await manager.shutdown(); }
  });

  it('leaves historical ACP metadata and artifacts byte-identical and never loads or cleans them', async () => {
    const { source, data } = await setup();
    const record = baseRecord(source);
    const directory = await writeRecord(data, record, 'acp');
    const metaPath = path.join(directory, 'meta.json');
    const before = await readFile(metaPath, 'utf8');
    const artifactDir = path.join(directory, 'artifacts');
    await mkdir(artifactDir);
    const artifactPath = path.join(artifactDir, 'legacy.txt');
    await writeFile(artifactPath, 'historical output\n');
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      await manager.initialize();
      expect(await readFile(metaPath, 'utf8')).toBe(before);
      expect(await readFile(artifactPath, 'utf8')).toBe('historical output\n');
      expect(backend.starts).toBe(0);
      await expect(manager.status({ run_id: record.runId })).rejects.toMatchObject({ code: 'VSUP_NOT_FOUND' });
      expect(await readdir(path.join(data, 'runs'))).toContain(record.runId);
    } finally { await manager.shutdown(); }
  });

  it('releases the active worker on shutdown and stores an interrupted failure', async () => {
    const { source, data } = await setup();
    const backend = new FakeBackend();
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    const started = await manager.reviewStart({ task: 'one shot', cwd: source });
    await waitFor(() => manager.status({ run_id: started.run_id }), (status) => status.state === 'running');
    await manager.shutdown();
    const meta = JSON.parse(await readFile(path.join(data, 'runs', started.run_id, 'meta.json'), 'utf8')) as { state: string; error?: { code: string } };
    expect(meta).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
    expect(backend.cancels).toEqual([started.run_id]);
    expect(backend.closes).toEqual([started.run_id]);
    expect(activeSlots(manager)).toBe(0);
  });
});
