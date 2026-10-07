import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { bounded } from '../../src/mcp/tools.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class FakeBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  async probe() { return { available: true, backend: this.kind, supportsContinue: false, supportsPermissionResponse: false }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(handle: BackendRunHandle) { await this.callbacks.get(handle.runId)?.onState('cancelled'); }
  async close() {}
  async recover(_record: RunRecord) { return undefined; }
}

async function harness(backend: 'auto' | 'programmatic') {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-paging-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source); await writeFile(path.join(source, 'tracked.txt'), 'original\n');
  const fake = new FakeBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, backend, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [fake]);
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  for (let attempt = 0; attempt < 500 && (await manager.status({ run_id: started.run_id })).state !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  return { manager, fake, runId: started.run_id };
}

describe('vibe_status paging through the MCP size cap', () => {
  it('delivers every event exactly once when each reply is trimmed', async () => {
    const { manager, fake, runId } = await harness('programmatic');
    try {
      const callbacks = fake.callbacks.get(runId)!;
      for (let index = 0; index < 30; index += 1) await callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'info', data: { text: `${String(index).padStart(2, '0')}-${'x'.repeat(396)}` } });
      const seen: number[] = [];
      let after = 0;
      for (let page = 0; page < 40; page += 1) {
        const reply = bounded(await manager.status({ run_id: runId, after_seq: after, max_events: 100 }), DEFAULT_CONFIG.limits.maxMcpResultChars).structuredContent as { events: { seq: number }[]; next_after_seq: number; next_action: string };
        for (const event of reply.events) seen.push(event.seq);
        expect(reply.next_after_seq).toBe(reply.events.at(-1)?.seq ?? after);
        expect(reply.next_action).toContain(`after_seq=${reply.next_after_seq}`);
        if (reply.events.length === 0) break;
        after = reply.next_after_seq;
      }
      const delivered = new Set(seen);
      expect(seen).toHaveLength(delivered.size);
      const all = (await manager.status({ run_id: runId, after_seq: 0, max_events: 100 }) as { events: { seq: number }[] }).events.map((event) => event.seq);
      expect(seen).toEqual(all);
    } finally { await manager.shutdown(); }
  });
});

describe('next_action follows the run backend', () => {
  it('does not offer vibe_continue to a programmatic run started through backend auto', async () => {
    const { manager, fake, runId } = await harness('auto');
    try {
      await fake.callbacks.get(runId)!.onState('completed', { result: { stopReason: 'end_turn', summary: 'done' } });
      const status = await manager.status({ run_id: runId }) as { backend: string; next_action: string; result: { next_action: string } };
      expect(status.backend).toBe('programmatic');
      expect(status.next_action).not.toContain('vibe_continue');
      expect(status.result.next_action).not.toContain('vibe_continue');
      expect(((await manager.result({ run_id: runId, detail: 'full' })) as { next_action: string }).next_action).not.toContain('vibe_continue');
    } finally { await manager.shutdown(); }
  });
});

describe('bounded status events', () => {
  it('keeps the head of the events and points next_after_seq at the last one delivered', () => {
    const events = Array.from({ length: 30 }, (_, index) => ({ seq: index + 6, type: 'diagnostic', text: 'y'.repeat(400) }));
    const reply = bounded({ run_id: 'r', state: 'running', last_seq: 35, next_after_seq: 35, events, next_action: 'Call vibe_status again with after_seq=35 and wait_seconds 120-300.' }, 8000).structuredContent as { events: { seq: number }[]; next_after_seq: number; next_action: string; events_total: number };
    expect(reply.events[0]?.seq).toBe(6);
    expect(reply.next_after_seq).toBe(reply.events.at(-1)?.seq);
    expect(reply.next_action).toContain(`after_seq=${reply.next_after_seq}`);
    expect(reply.events_total).toBe(30);
  });

  it('rewinds next_after_seq to just before the first event when none survive', () => {
    const events = [{ seq: 6, type: 'diagnostic', text: 'z'.repeat(9000) }, { seq: 7, type: 'diagnostic', text: 'z'.repeat(9000) }];
    const reply = bounded({ run_id: 'r', state: 'running', last_seq: 7, next_after_seq: 7, events, next_action: 'Call vibe_status again with after_seq=7.' }, 1000).structuredContent as { events?: unknown[]; next_after_seq: number };
    expect(reply.events ?? []).toHaveLength(0);
    expect(reply.next_after_seq).toBe(5);
  });
});
