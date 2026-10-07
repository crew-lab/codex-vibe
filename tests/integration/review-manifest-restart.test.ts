import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class RecoveringBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(_handle: BackendRunHandle) {}
  async close() {}
  async recover(record: RunRecord, callbacks: BackendCallbacks): Promise<BackendRunHandle> {
    this.callbacks.set(record.runId, callbacks);
    return { runId: record.runId, backend: this.kind, opaque: {} };
  }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function setup() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-manifest-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source);
  const run = (args: string[]) => { const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); };
  run(['init', '-q']); run(['config', 'user.email', 'test@example.invalid']); run(['config', 'user.name', 'Test']);
  await writeFile(path.join(source, 'file.txt'), 'original\n'); await writeFile(path.join(source, 'other.txt'), 'other\n');
  run(['add', '-A']); run(['commit', '-qm', 'base']);
  const config = { ...DEFAULT_CONFIG, backend: 'programmatic' as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 };
  return { source, data, config };
}

async function startAndRestart(source: string, data: string, config: typeof DEFAULT_CONFIG, options: { dropManifest?: boolean } = {}) {
  const first = new RunManager(config, data, [new RecoveringBackend()]);
  const started = await first.reviewStart({ task: 'review', cwd: source });
  await waitFor(() => first.status({ run_id: started.run_id }), (value) => value.state === 'running');
  const directory = path.join(data, 'runs', started.run_id);
  await waitFor(async () => (await readdir(directory)).some((name) => name.includes('manifest')), (found) => found, 3000);
  await first.shutdown();
  if (options.dropManifest) for (const name of await readdir(directory)) if (name.includes('manifest')) await unlink(path.join(directory, name));
  const backend = new RecoveringBackend();
  const second = new RunManager(config, data, [backend]);
  await second.initialize();
  return { second, backend, runId: started.run_id, directory };
}

async function finishSecondTurn(second: RunManager, backend: RecoveringBackend, runId: string) {
  expect((await second.status({ run_id: runId })).state).toBe('recoverable');
  await second.continue({ run_id: runId, message: 'again' });
  await backend.callbacks.get(runId)!.onState('completed', { result: { summary: 'second turn' } });
  return (await second.result({ run_id: runId, detail: 'full' })).integrity as Record<string, unknown>;
}

describe('review integrity after a supervisor restart', () => {
  it('stays verified when a file is only touched while the run is recoverable', async () => {
    const { source, data, config } = await setup();
    const { second, backend, runId } = await startAndRestart(source, data, config);
    try {
      const later = new Date(Date.now() + 60_000);
      await utimes(path.join(source, 'file.txt'), later, later);
      expect(await finishSecondTurn(second, backend, runId)).toMatchObject({ status: 'verified' });
    } finally { await second.shutdown(); }
  }, 30_000);

  it('reports the changed path after a real change', async () => {
    const { source, data, config } = await setup();
    const { second, backend, runId } = await startAndRestart(source, data, config);
    try {
      await writeFile(path.join(source, 'file.txt'), 'edited while recoverable\n');
      expect(await finishSecondTurn(second, backend, runId)).toMatchObject({ status: 'changed', changed_paths: ['file.txt'] });
    } finally { await second.shutdown(); }
  }, 30_000);

  it('keeps the manifest owner-only and free of file content', async () => {
    const { source, data, config } = await setup();
    const { second, directory } = await startAndRestart(source, data, config);
    try {
      const name = (await readdir(directory)).find((entry) => entry.includes('manifest'))!;
      const info = await stat(path.join(directory, name));
      expect(info.mode & 0o777).toBe(0o600);
      const text = await readFile(path.join(directory, name), 'utf8');
      expect(text).toContain('file.txt');
      expect(text).not.toContain('original');
    } finally { await second.shutdown(); }
  }, 30_000);

  it('reports unverified, never changed, for a run saved without a manifest', async () => {
    const { source, data, config } = await setup();
    const { second, backend, runId } = await startAndRestart(source, data, config, { dropManifest: true });
    try {
      const later = new Date(Date.now() + 60_000);
      await utimes(path.join(source, 'file.txt'), later, later);
      const integrity = await finishSecondTurn(second, backend, runId);
      expect(integrity).toMatchObject({ status: 'unverified' });
      expect(String(integrity.reason)).toMatch(/manifest/i);
    } finally { await second.shutdown(); }
  }, 30_000);

  it('reports unverified when the saved manifest no longer matches the recorded digest', async () => {
    const { source, data, config } = await setup();
    const { second, backend, runId, directory } = await startAndRestart(source, data, config);
    try {
      const name = (await readdir(directory)).find((entry) => entry.includes('manifest'))!;
      await writeFile(path.join(directory, name), '{"schema_version":1,"sha256":"00","entries":[]}');
      expect(await finishSecondTurn(second, backend, runId)).toMatchObject({ status: 'unverified' });
    } finally { await second.shutdown(); }
  }, 30_000);
});
