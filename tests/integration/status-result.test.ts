import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { bounded } from '../../src/mcp/tools.js';

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class FakeBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  files: Record<string, string> = {};
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    for (const [name, text] of Object.entries(this.files)) await writeFile(path.join(input.workerWorkspace, name), text);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async cancel(handle: BackendRunHandle) { await this.callbacks.get(handle.runId)?.onState('cancelled'); }
  async close() {}
}

async function harness(git = false) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-status-result-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source); await writeFile(path.join(source, 'tracked.txt'), 'original\n');
  if (git) {
    await exec('git', ['init', '-q'], { cwd: source });
    await exec('git', ['config', 'user.email', 'vsup@example.invalid'], { cwd: source });
    await exec('git', ['config', 'user.name', 'Vibe Supervisor Test'], { cwd: source });
    await exec('git', ['add', 'tracked.txt'], { cwd: source });
    await exec('git', ['commit', '-qm', 'baseline'], { cwd: source });
  }
  const backend = new FakeBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
  return { manager, backend, source };
}

async function running(manager: RunManager, source: string, mode: 'review' | 'edit' = 'review') {
  const started = mode === 'review' ? await manager.reviewStart({ task: 'review', cwd: source }) : await manager.editStart({ task: 'edit', cwd: source });
  for (let attempt = 0; attempt < 500 && (await manager.status({ run_id: started.run_id })).state !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  return started.run_id;
}

describe('vibe_status result', () => {
  it('has no result while the run is unsettled', async () => {
    const { manager, source } = await harness();
    try {
      const runId = await running(manager, source);
      expect('result' in await manager.status({ run_id: runId })).toBe(false);
    } finally { await manager.shutdown(); }
  });

  it('embeds exactly the compact vibe_result once the run completed, including next_action', async () => {
    const { manager, backend, source } = await harness();
    try {
      const runId = await running(manager, source);
      await backend.callbacks.get(runId)!.onEvent({ source: 'vibe', type: 'agent_message', severity: 'info', data: { text: 'finding' } });
      await backend.callbacks.get(runId)!.onState('completed', { result: { summary: 'All good' } });
      const status = await manager.status({ run_id: runId });
      const compact = await manager.result({ run_id: runId });
      expect(status.result).toEqual(compact);
      expect(status.result).toMatchObject({ run_id: runId, state: 'completed', summary: 'All good', next_action: expect.any(String) });
      expect(Object.keys(status.result as object).sort()).toEqual(Object.keys(compact).sort());
    } finally { await manager.shutdown(); }
  });

  it('embeds the result for failed and cancelled runs and carries the error', async () => {
    const { manager, backend, source } = await harness();
    try {
      const failedId = await running(manager, source);
      await backend.callbacks.get(failedId)!.onState('failed', { error: { code: 'VSUP_BACKEND_ERROR', message: 'boom', remediation: 'retry', retryable: false } });
      const failed = await manager.status({ run_id: failedId });
      expect(failed.result).toEqual(await manager.result({ run_id: failedId }));
      expect(failed.result).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR' }, next_action: expect.any(String) });
      const cancelledId = await running(manager, source);
      await manager.cancel({ run_id: cancelledId });
      const cancelled = await manager.status({ run_id: cancelledId });
      expect(cancelled.result).toMatchObject({ state: 'cancelled', next_action: expect.any(String) });
    } finally { await manager.shutdown(); }
  });

  it('returns the settled result from a status wait without a second call', async () => {
    const { manager, backend, source } = await harness();
    try {
      const runId = await running(manager, source);
      const waiting = manager.status({ run_id: runId, wait_seconds: 30 });
      setTimeout(() => { void backend.callbacks.get(runId)!.onState('completed', { result: { summary: 'Done waiting' } }); }, 50);
      expect(await waiting).toMatchObject({ state: 'completed', result: { summary: 'Done waiting' } });
    } finally { await manager.shutdown(); }
  });

  it('keeps the protected fields when a large patch and many files exceed max_mcp_result_chars', async () => {
    const { manager, backend, source } = await harness(true);
    const files: Record<string, string> = { 'large.txt': `${'y'.repeat(6000)}\n` };
    for (let index = 0; index < 52; index += 1) files[`f${String(index).padStart(2, '0')}.txt`] = 'a\n';
    backend.files = files;
    try {
      const runId = await running(manager, source, 'edit');
      await backend.callbacks.get(runId)!.onState('completed', { result: { summary: 'Done ' + 'z'.repeat(3000), warnings: ['careful'] } });
      const status = await manager.status({ run_id: runId });
      const result = status.result as Record<string, unknown>;
      expect(result.patch_path).toEqual(expect.stringContaining('diff.patch'));
      for (const limit of [8000, 2000, 900]) {
        const shaped = bounded(status, limit);
        expect(shaped.text.length).toBeLessThanOrEqual(limit);
        const value = shaped.structuredContent as Record<string, unknown>;
        const nested = (value.result ?? {}) as Record<string, unknown>;
        expect(value.run_id).toBe(runId);
        expect(value.state).toBe('completed');
        expect(nested.next_action ?? value.next_action).toEqual(expect.any(String));
        expect(nested.patch_path ?? value.patch_path).toEqual(expect.stringContaining('diff.patch'));
        expect(nested.warnings ?? value.warnings).toEqual(['careful']);
      }
    } finally { await manager.shutdown(); }
  });
});
