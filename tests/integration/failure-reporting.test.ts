import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { TEST_CONFIG } from '../unit/support/test-config.js';
import { RunManager } from '../../src/core/run-manager.js';

const canonicalTmp = await realpath(tmpdir());
const SECRET = 'sk-abcdef1234567890xyz';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeParent() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-failure-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source);
  return { parent, source, data };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

class ScriptedBackend implements SupervisorBackend {
  readonly kind = 'app-server' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  startError: Error | undefined;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    if (this.startError) throw this.startError;
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async cancel(_handle: BackendRunHandle) {}
  async close(_handle: BackendRunHandle) {}
}

function managerFor(source: string, data: string, backend: SupervisorBackend) {
  return new RunManager({ ...TEST_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
}

async function running(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
  return started.run_id;
}

describe('failure and privacy reporting', () => {
  it('persists a redacted diagnostic before settling a backend launch failure', async () => {
    const { source, data } = await makeParent();
    const backend = new ScriptedBackend();
    backend.startError = Object.assign(new Error(`could not start with ${SECRET}`), { code: 'VSUP_BACKEND_ERROR' });
    const manager = managerFor(source, data, backend);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'failed');
      expect(status.state).toBe('failed');
      const events = (await readFile(path.join(data, 'runs', started.run_id, 'events.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; source: string; data: Record<string, unknown> });
      const diagnostics = events.filter((event) => event.type === 'diagnostic' && event.source === 'supervisor');
      expect(diagnostics).toHaveLength(1);
      expect(String(diagnostics[0]?.data.message)).toContain('VSUP_BACKEND_ERROR');
      expect(JSON.stringify(events)).not.toContain(SECRET);
      const text = (await manager.status({ run_id: started.run_id })).events as Array<{ type: string; text?: string }>;
      expect(text.find((event) => event.type === 'diagnostic')?.text).toContain('VSUP_BACKEND_ERROR');
    } finally { await manager.shutdown(); }
  });

  it('caps safe supervisor text and strips private tool and assistant payloads from status', async () => {
    const { source, data } = await makeParent();
    const backend = new ScriptedBackend(); const manager = managerFor(source, data, backend);
    const id = await running(manager, source); const callbacks = backend.callbacks.get(id)!;
    try {
      await callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text: `stderr line ${'x'.repeat(900)}` } });
      await callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { message: 'a message', reason: 'a_reason' } });
      await callbacks.onEvent({ source: 'supervisor', type: 'timeout', severity: 'warning', data: { timeout_seconds: 5 } });
      await callbacks.onEvent({ source: 'vibe', type: 'diagnostic', severity: 'info', data: { text: 'from vibe, not the supervisor' } });
      await callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'assistant words' } });
      await callbacks.onEvent({ source: 'vibe', type: 'tool_call', severity: 'info', data: { title: 'Read file', kind: 'read', status: 'pending', rawInput: { path: '/secret/path' }, text: 'tool text' } });
      const events = (await manager.status({ run_id: id })).events as Array<Record<string, unknown>>;
      const byType = (type: string) => events.filter((event) => event.type === type);
      const [long, short, vibeDiagnostic] = byType('diagnostic');
      expect(String(long?.text)).toHaveLength(400);
      expect(String(long?.text).startsWith('stderr line')).toBe(true);
      expect(short?.text).toBe('a message');
      expect(byType('timeout')[0]).toEqual({ seq: expect.any(Number), type: 'timeout' });
      expect(vibeDiagnostic).toEqual({ seq: 4, type: 'diagnostic' });
      expect(byType('message')[0]).toEqual({ seq: expect.any(Number), type: 'message' });
      expect(byType('tool_call')[0]).toEqual({ seq: expect.any(Number), type: 'tool_call', title: 'Read file', kind: 'read', status: 'pending' });
      expect(JSON.stringify(events)).not.toContain('/secret/path');
      expect(JSON.stringify(events)).not.toContain('assistant words');
    } finally { await manager.shutdown(); }
  });

  it('reports when the reviewed source changes during a read-only run', async () => {
    const { source, data } = await makeParent();
    const backend = new ScriptedBackend(); const manager = managerFor(source, data, backend);
    const id = await running(manager, source); const callbacks = backend.callbacks.get(id)!;
    try {
      await writeFile(path.join(source, 'late.txt'), 'late\n');
      await callbacks.onState('completed', { result: { summary: 'done' } });
      const events = (await manager.status({ run_id: id })).events as Array<{ type: string; text?: string }>;
      expect(events.find((event) => event.type === 'review_integrity')?.text).toMatch(/changed/);
    } finally { await manager.shutdown(); }
  });
});
