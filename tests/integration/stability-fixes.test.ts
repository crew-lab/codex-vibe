import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { SCHEMA_VERSION } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runToWire } from '../../src/core/serialization.js';

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const DAY = 86_400_000;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sandbox() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-stable-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source); await mkdir(path.join(data, 'runs'), { recursive: true, mode: 0o700 });
  return { parent, source, data };
}

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

const exists = (file: string) => stat(file).then(() => true, () => false);

async function age(directory: string, days: number): Promise<void> {
  const when = new Date(Date.now() - days * DAY);
  await utimes(directory, when, when);
}

function validRecord(runId: string, source: string): RunRecord {
  const stamp = new Date(Date.now() - 30 * DAY).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION, runId, backend: 'programmatic', mode: 'review', state: 'cancelled', sourceWorkspace: source, workerWorkspace: source,
    createdAt: stamp, updatedAt: stamp, finishedAt: stamp, taskSha256: 'a'.repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_000_000, maxTranscriptBytes: 1_000_000, maxArtifactBytes: 1_000_000 }
  };
}

class IdleBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  terminated: string[] = [];
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async cancel() {}
  async close() {}
  async terminateNow(handle: BackendRunHandle) { this.terminated.push(handle.runId); }
}

describe('retention of run directories that failed to load', () => {
  async function orphan(data: string, kind: 'garbage' | 'oversized' | 'mismatched' | 'empty' | 'symlink' | 'newer', source: string): Promise<string> {
    const runId = randomUUID();
    const directory = path.join(data, 'runs', runId);
    await mkdir(directory, { mode: 0o700 });
    const meta = path.join(directory, 'meta.json');
    if (kind === 'garbage') await writeFile(meta, '{not json', { mode: 0o600 });
    if (kind === 'oversized') await writeFile(meta, `{"pad":"${'x'.repeat(1_100_000)}"}`, { mode: 0o600 });
    if (kind === 'newer') await writeFile(meta, JSON.stringify({ ...runToWire(validRecord(runId, source)), schema_version: 2 }), { mode: 0o600 });
    if (kind === 'mismatched') await writeFile(meta, JSON.stringify(runToWire(validRecord(randomUUID(), source))), { mode: 0o600 });
    await writeFile(path.join(directory, 'events.ndjson'), '', { mode: 0o600 });
    await age(directory, 30);
    return runId;
  }

  it('removes old run directories whose record is missing or not JSON, and keeps records it cannot interpret', async () => {
    const { source, data } = await sandbox();
    const ids = await Promise.all((['garbage', 'empty'] as const).map((kind) => orphan(data, kind, source)));
    const kept = await Promise.all((['oversized', 'mismatched', 'newer'] as const).map((kind) => orphan(data, kind, source)));
    const fresh = randomUUID();
    await mkdir(path.join(data, 'runs', fresh), { mode: 0o700 });
    await writeFile(path.join(data, 'runs', fresh, 'meta.json'), '{not json', { mode: 0o600 });
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [new IdleBackend()]);
    try {
      const result = await manager.cleanup() as { removed_run_ids: string[] };
      expect([...result.removed_run_ids].sort()).toEqual([...ids].sort());
      for (const id of ids) expect(await exists(path.join(data, 'runs', id))).toBe(false);
      expect(await exists(path.join(data, 'runs', fresh))).toBe(true);
      for (const id of kept) expect(await exists(path.join(data, 'runs', id))).toBe(true);
    } finally { await manager.shutdown(); }
  });

  it('keeps an old orphan that owns a worktree, reports it and writes a diagnostic', async () => {
    const { source, data } = await sandbox();
    await exec('git', ['init', '-q'], { cwd: source });
    await writeFile(path.join(source, 'a.txt'), 'a\n');
    await exec('git', ['add', 'a.txt'], { cwd: source });
    await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init'], { cwd: source });
    const runId = await orphan(data, 'garbage', source);
    const worktree = path.join(data, 'worktrees', runId);
    await mkdir(path.dirname(worktree), { recursive: true, mode: 0o700 });
    await exec('git', ['worktree', 'add', '--detach', worktree], { cwd: source });
    await age(path.join(data, 'runs', runId), 30);
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write);
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [new IdleBackend()]);
    try {
      const result = await manager.cleanup() as { removed_run_ids: string[]; unverified_worktrees?: Array<{ run_id: string; path: string }> };
      expect(result.removed_run_ids).toEqual([]);
      expect(result.unverified_worktrees).toEqual([{ run_id: runId, path: worktree }]);
      expect(await exists(path.join(data, 'runs', runId))).toBe(true);
      expect(await exists(worktree)).toBe(true);
      expect(writes.join('')).toContain(runId);
    } finally { await manager.shutdown(); }
  });
});

describe('shutdown deadline', () => {
  function stick(manager: RunManager, runId: string): () => void {
    const runtime = (manager as unknown as { requireRun(id: string): unknown }).requireRun(runId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (manager as unknown as { serial(runtime: unknown, fn: () => Promise<void>): Promise<void> }).serial(runtime, () => gate).catch(() => undefined);
    return release;
  }

  it('keeps the owner lock while a stuck run chain may still write, then releases it after the chain settles', async () => {
    const { source, data } = await sandbox();
    const backend = new IdleBackend();
    const config = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] };
    const manager = new RunManager(config, data, [backend]);
    const started = await manager.reviewStart({ task: 'review', cwd: source });
    await waitFor(() => backend.callbacks.has(started.run_id), Boolean);
    await waitFor(async () => (await manager.status({ run_id: started.run_id })).state, (state) => state === 'running');
    const releaseChain = stick(manager, started.run_id);
    const began = Date.now();
    const outcomePromise = manager.shutdown(300);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(await access(path.join(data, 'supervisor.lock')).then(() => true, () => false)).toBe(true);
    releaseChain();
    const outcome = await outcomePromise;
    expect(outcome).toEqual({ timedOut: true });
    expect(Date.now() - began).toBeLessThan(5000);
    expect(backend.terminated).toEqual([started.run_id]);
    const meta = JSON.parse(await readFile(path.join(data, 'runs', started.run_id, 'meta.json'), 'utf8')) as { state: string };
    expect(meta.state).toBe('failed');
    await expect(access(path.join(data, 'supervisor.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    const next = new RunManager(config, data, [new IdleBackend()]);
    try { await next.initialize(); expect((await next.runsList()).map((row) => row.run_id)).toContain(started.run_id); }
    finally { await next.shutdown(); }
  });

});
