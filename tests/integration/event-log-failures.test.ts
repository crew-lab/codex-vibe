import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

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

async function running(maxEventBytes = DEFAULT_CONFIG.limits.maxEventBytes) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-evlog-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
  const backend = new FakeBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits, maxEventBytes }, allowedWorkspaceRoots: [source] }, data, [backend]);
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  for (let attempt = 0; attempt < 500 && (await manager.status({ run_id: started.run_id })).state !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const directory = path.join(data, 'runs', started.run_id);
  return { manager, callbacks: backend.callbacks.get(started.run_id)!, runId: started.run_id, directory, events: path.join(directory, 'events.ndjson') };
}

const message = (text: string) => ({ source: 'vibe' as const, type: 'message', severity: 'info' as const, data: { text } });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('event log faults inside a running run', () => {
  it('recreates a deleted run directory and resumes recording events', async () => {
    const { manager, callbacks, runId, directory, events } = await running();
    try {
      await callbacks.onEvent(message('before'));
      await manager.result({ run_id: runId });
      await rm(directory, { recursive: true });
      await callbacks.onEvent(message('after deletion'));
      await callbacks.onState('completed');
      await manager.result({ run_id: runId });
      expect(await readFile(events, 'utf8')).toContain('after deletion');
      expect(await readFile(events, 'utf8')).not.toContain('background_failure');
      expect(JSON.parse(await readFile(path.join(directory, 'meta.json'), 'utf8')).state).toBe('completed');
    } finally { await manager.shutdown(); }
  }, 30_000);

  it.each(['directory', 'symlink'])('degrades with VSUP_STORAGE_ERROR when events.ndjson becomes a %s, without looping or a false output limit', async (kind) => {
    const { manager, callbacks, runId, directory, events } = await running(4096);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
    try {
      await callbacks.onEvent(message('before'));
      await manager.result({ run_id: runId });
      const target = path.join(directory, 'elsewhere');
      await rm(events);
      if (kind === 'directory') await mkdir(events); else { await writeFile(target, ''); await symlink(target, events); }
      await callbacks.onEvent(message('first lost'));
      for (let index = 0; index < 5; index += 1) await callbacks.onEvent(message(`event ${index} ${'x'.repeat(20)}`));
      await sleep(1500);
      const status = await manager.status({ run_id: runId });
      expect(status.error).toBeUndefined();
      expect(status.state).toBe('running');
      expect(status.warnings).toHaveLength(1);
      expect(JSON.parse(await readFile(path.join(directory, 'meta.json'), 'utf8'))).toMatchObject({ state: 'running' });
      expect(JSON.parse(await readFile(path.join(directory, 'meta.json'), 'utf8')).error).toBeUndefined();
      if (kind === 'directory') expect(await readdir(events)).toEqual([]); else { expect(await readFile(target, 'utf8')).toBe(''); expect((await lstat(events)).isSymbolicLink()).toBe(true); }
      const written = stderr.mock.calls.map((call) => String(call[0]));
      expect(written.filter((line) => line.includes('VSUP_STORAGE_ERROR')).length).toBeLessThanOrEqual(2);
      expect(written.some((line) => line.includes('background_failure'))).toBe(false);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('settles with a storage error instead of an output limit when the log is unusable at the end', async () => {
    const { manager, callbacks, runId, directory, events } = await running();
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
    try {
      await callbacks.onEvent(message('before'));
      await manager.result({ run_id: runId });
      await rm(events); await mkdir(events);
      await callbacks.onEvent(message('lost'));
      await callbacks.onState('completed', { result: { summary: 'done' } });
      const status = await manager.status({ run_id: runId });
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_STORAGE_ERROR', details: { code: 'EISDIR' } });
      expect(JSON.parse(await readFile(path.join(directory, 'meta.json'), 'utf8')).state).toBe('failed');
      expect((await stat(events)).isDirectory()).toBe(true);
    } finally { await manager.shutdown(); }
  }, 30_000);
});
