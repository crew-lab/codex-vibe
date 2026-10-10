import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

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
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-durable-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source); await writeFile(path.join(source, 'file.txt'), 'content\n');
  const backend = new FakeBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], ...overrides }, data, [backend]);
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  for (let attempt = 0; attempt < 500 && (await manager.status({ run_id: started.run_id })).state !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  return { manager, backend, runId: started.run_id, callbacks: backend.callbacks.get(started.run_id)!, eventsFile: path.join(data, 'runs', started.run_id, 'events.ndjson'), metaFile: path.join(data, 'runs', started.run_id, 'meta.json') };
}

async function diskEvents(file: string): Promise<{ seq: number; type: string; data: Record<string, unknown> }[]> {
  const text = await readFile(file, 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { seq: number; type: string; data: Record<string, unknown> });
}

describe('buffered event persistence', () => {
  it('keeps order and seq for 1,000 events on disk and in memory, well under the old per-event cost', async () => {
    const { manager, runId, callbacks, eventsFile } = await harness({ limits: { ...DEFAULT_CONFIG.limits, maxEventBytes: 50_000_000 } });
    try {
      const began = performance.now();
      for (let index = 1; index <= 1000; index += 1) await callbacks.onEvent({ source: 'vibe', type: 'tool_call', severity: 'info', data: { title: `call ${index}` } });
      await callbacks.onState('completed');
      await manager.result({ run_id: runId });
      const elapsed = performance.now() - began;
      expect(elapsed).toBeLessThan(1500);
      const onDisk = await diskEvents(eventsFile);
      const content = onDisk.filter((event) => event.type === 'tool_call');
      expect(content).toHaveLength(1000);
      expect(onDisk.map((event) => event.seq)).toEqual(onDisk.map((_, index) => index + 1));
      expect(content.map((event) => event.data.title)).toEqual(Array.from({ length: 1000 }, (_, index) => `call ${index + 1}`));
      const status = await manager.status({ run_id: runId, after_seq: 990, max_events: 100 });
      expect(status.last_seq).toBe(onDisk.at(-1)?.seq);
      expect((status.events as { seq: number }[]).map((event) => event.seq)).toEqual(onDisk.slice(990).map((event) => event.seq));
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('never persists a state change ahead of the events that preceded it', async () => {
    const { manager, runId, callbacks, eventsFile, metaFile } = await harness();
    try {
      for (const title of ['before completion', 'final event']) {
        await callbacks.onEvent({ source: 'vibe', type: 'tool_call', severity: 'info', data: { title } });
      }
      const expected = (await manager.status({ run_id: runId })).last_seq as number;
      await callbacks.onState('completed');
      await manager.result({ run_id: runId });
      const meta = JSON.parse(await readFile(metaFile, 'utf8')) as { state: string };
      expect(meta.state).toBe('completed');
      expect((await diskEvents(eventsFile)).at(-1)?.seq).toBe(expected);
    } finally { await manager.shutdown(); }
  });

  it('flushes everything on settle and on shutdown', async () => {
    const { manager, callbacks, eventsFile } = await harness();
    await callbacks.onEvent({ source: 'vibe', type: 'tool_call', severity: 'info', data: { title: 'last words' } });
    await manager.shutdown();
    expect((await diskEvents(eventsFile)).some((event) => event.data.title === 'last words')).toBe(true);
  });

  it('flushes on its own within the window', async () => {
    const { manager, callbacks, eventsFile } = await harness();
    try {
      await callbacks.onEvent({ source: 'vibe', type: 'tool_call', severity: 'info', data: { title: 'lonely' } });
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect((await diskEvents(eventsFile)).some((event) => event.data.title === 'lonely')).toBe(true);
    } finally { await manager.shutdown(); }
  });

  it('still fails the run with VSUP_OUTPUT_LIMIT when the event byte cap is reached', async () => {
    const { manager, runId, callbacks } = await harness({ limits: { ...DEFAULT_CONFIG.limits, maxEventBytes: 3000 } });
    try {
      for (let index = 0; index < 40; index += 1) await callbacks.onEvent({ source: 'vibe', type: 'tool_call', severity: 'info', data: { title: 'x'.repeat(200) } });
      let status = await manager.status({ run_id: runId });
      for (let attempt = 0; attempt < 200 && status.state !== 'failed'; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 20)); status = await manager.status({ run_id: runId }); }
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_OUTPUT_LIMIT' });
    } finally { await manager.shutdown(); }
  }, 30_000);
});
