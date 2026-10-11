import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';
import { RunManager } from '../../src/core/run-manager.js';

const childScript = vi.hoisted(() => ({ path: '' }));

vi.mock('../../src/backends/launcher.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/backends/launcher.js')>();
  return {
    ...original,
    buildVibeLaunch: async (...args: Parameters<typeof original.buildVibeLaunch>) => {
      const launch = await original.buildVibeLaunch(...args);
      return childScript.path ? { ...launch, command: process.execPath, args: [childScript.path] } : launch;
    }
  };
});

const canonicalTmp = await realpath(tmpdir());
const SECRET = 'sk-abcdef1234567890xyz';
const roots: string[] = [];

afterEach(async () => {
  childScript.path = '';
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
  readonly kind = 'programmatic' as const;
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
  return new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
}

async function running(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
  return started.run_id;
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function installFakeVibe(root: string, childBody: string, version = '2.26.1') {
  const dir = path.join(root, 'fake-vibe');
  await mkdir(dir);
  const vibe = path.join(dir, 'vibe');
  await writeExecutable(vibe, ['#!/usr/bin/env python3', `print("vibe ${version}")`, ''].join('\n'));
  const child = path.join(dir, 'child.mjs');
  await writeFile(child, [childBody, ''].join('\n'));
  childScript.path = child;
  const config = { ...DEFAULT_CONFIG, paths: { vibe } };
  return { vibe, backend: new ProgrammaticBackend(config) };
}

async function settled(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
  return { id: started.run_id, status };
}

describe('programmatic one-shot result reporting', () => {
  it('turns an empty final message into a useful summary and warning', async () => {
    const { parent, source, data } = await makeParent();
    const { backend } = await installFakeVibe(parent, 'process.exit(0);');
    const manager = managerFor(source, data, backend);
    try {
      const { id, status } = await settled(manager, source);
      expect(status.state).toBe('completed');
      expect(await manager.result({ run_id: id })).toMatchObject({ stop_reason: 'end_turn', warnings: ['Vibe produced no final message.'], summary: 'Vibe completed the delegated task.' });
    } finally { await manager.shutdown(); }
  });

  it('keeps an assistant final message without a no-message warning', async () => {
    const { parent, source, data } = await makeParent();
    const { backend } = await installFakeVibe(parent, "console.log(JSON.stringify({ role: 'assistant', text: 'All good.' })); process.exit(0);");
    const manager = managerFor(source, data, backend);
    try {
      const { id, status } = await settled(manager, source);
      expect(status.state).toBe('completed');
      expect(await manager.result({ run_id: id })).toMatchObject({ summary: expect.stringContaining('All good.'), warnings: [] });
    } finally { await manager.shutdown(); }
  });

  it.each([
    { label: 'a matching pinned turn-limit marker', code: 1, stdout: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>`, stderr: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>`, capped: true },
    { label: 'an assistant-only marker', code: 1, stdout: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>`, stderr: 'boom', capped: false },
    { label: 'a stderr-only marker', code: 1, stdout: 'Partial findings.', stderr: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>`, capped: false },
    { label: 'a marker for another turn limit', code: 1, stdout: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview + 1} reached</vibe_stop_event>`, stderr: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview + 1} reached</vibe_stop_event>`, capped: false },
    { label: 'a crash after the marker', code: 2, stdout: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>`, stderr: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>`, capped: false },
    { label: 'an additional error after the marker', code: 1, stdout: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>`, stderr: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>\nError: 401 Unauthorized`, capped: false },
    { label: 'a marker in successful assistant output', code: 0, stdout: `<vibe_stop_event>Turn limit of ${DEFAULT_CONFIG.limits.maxTurnsReview} reached</vibe_stop_event>`, stderr: '', capped: false },
  ])('classifies $label safely', async (test) => {
    const { parent, source, data } = await makeParent();
    const entry = JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'text', text: test.stdout }] });
    const body = `process.stdout.write(${JSON.stringify(entry)}); process.stderr.write(${JSON.stringify(test.stderr + '\n')}); process.exitCode = ${test.code};`;
    const { backend } = await installFakeVibe(parent, body);
    const manager = managerFor(source, data, backend);
    try {
      const { id, status } = await settled(manager, source);
      const result = await manager.result({ run_id: id });
      if (test.capped) {
        expect(status.state).toBe('completed');
        expect(status.error).toBeUndefined();
        expect(result).toMatchObject({ stop_reason: 'max_turn_requests', warnings: [expect.stringContaining('max_turn_requests')] });
        expect(result.summary).toContain('turn limit');
        expect(result.summary).not.toContain('<vibe_stop_event>');
        const saved = JSON.parse(await readFile(path.join(data, 'runs', id, 'result.json'), 'utf8'));
        expect(saved).toMatchObject({ state: 'completed', stop_reason: 'max_turn_requests', warnings: [expect.stringContaining('max_turn_requests')] });
        expect(saved.error).toBeUndefined();
      } else if (test.code === 0) {
        expect(result).toMatchObject({ state: 'completed', stop_reason: 'end_turn' });
      } else {
        expect(result).toMatchObject({ state: 'failed', error: { code: test.stderr.includes('401 Unauthorized') ? 'VSUP_AUTH_REQUIRED' : 'VSUP_BACKEND_CRASHED' } });
        expect(result.stop_reason).toBeUndefined();
      }
    } finally { await manager.shutdown(); }
  });
});

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
