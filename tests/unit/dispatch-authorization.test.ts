import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RunManager } from '../../src/core/run-manager.js';
import type { BackendCallbacks, BackendRunHandle, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { TEST_CONFIG } from './support/test-config.js';
import { runFromWire, runToWire } from '../../src/core/serialization.js';

const roots: string[] = [];
const managers: RunManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.shutdown()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

class Backend implements SupervisorBackend {
  readonly kind = 'app-server' as const;
  starts = 0;
  closes = 0;
  cancels = 0;
  crash = false;
  callbacks?: BackendCallbacks;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks) {
    this.starts++;
    this.callbacks = callbacks;
    if (this.crash) throw new Error('fixture startup failure');
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' as const };
  }
  async cancel(_handle: BackendRunHandle) { this.cancels++; }
  async close(_handle: BackendRunHandle) { this.closes++; }
}

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-dispatch-test-')));
  roots.push(root);
  const source = path.join(root, 'source');
  await mkdir(source, { mode: 0o700 });
  await writeFile(path.join(source, 'note.txt'), 'original\n');
  const config = { ...TEST_CONFIG, allowedWorkspaceRoots: [source] };
  const shared = path.join(root, 'shared');
  const backend = new Backend();
  const data = path.join(root, 'session-a');
  const manager = new RunManager(config, data, [backend], undefined, { usageDataDir: shared });
  managers.push(manager);
  return { root, source, config, shared, backend, data, manager };
}

async function grant(manager: RunManager, source: string, task = 'review') {
  return manager.authorizeDispatch('review', { task, cwd: source }, 'test-owner-message', new Date(Date.now() + 60_000).toISOString());
}

async function state(manager: RunManager, id: string, expected: string) {
  for (let index = 0; index < 200; index++) {
    const status = await manager.status({ run_id: id });
    if (status.state === expected) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Expected state ${expected}`);
}

describe('durable dispatch authorization', () => {
  it('requires identifiers before any worker launch', async () => {
    const { manager, source, backend } = await fixture();
    await expect(manager.reviewStart({ task: 'review', cwd: source } as never)).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT' });
    await expect(manager.reviewStart({ task: 'review', cwd: source, authorization_id: randomUUID(), attempt_id: randomUUID() })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    expect(backend.starts).toBe(0);
  });

  it('registers a grant alongside a live server without starting a worker', async () => {
    const { manager, source, config, data, shared, backend } = await fixture();
    await manager.initialize();
    const admin = new RunManager(config, data, [], undefined, { usageDataDir: shared });
    const issued = await grant(admin, source);
    expect(issued.authorization_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(backend.starts).toBe(0);
  });

  it('rejects a changed task without consuming the original matching grant', async () => {
    const { manager, source, backend } = await fixture();
    const issued = await grant(manager, source);
    await expect(manager.reviewStart({ task: 'changed', cwd: source, ...issued })).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT' });
    const ids = { authorization_id: issued.authorization_id, attempt_id: issued.attempt_id };
    await expect(manager.reviewStart({ task: 'changed', cwd: source, ...ids })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    expect(backend.starts).toBe(0);
    const started = await manager.reviewStart({ task: 'review', cwd: source, ...ids });
    await state(manager, started.run_id, 'running');
    expect(backend.starts).toBe(1);
  });

  it('binds review workspace changes and leaves the worker unstarted', async () => {
    const { manager, source, backend } = await fixture();
    const issued = await grant(manager, source);
    await writeFile(path.join(source, 'note.txt'), 'changed contents\n');
    await expect(manager.reviewStart({ task: 'review', cwd: source, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    expect(backend.starts).toBe(0);
  });

  it('allows exactly one start across isolated session managers sharing grants', async () => {
    const { manager, root, source, config, shared, backend } = await fixture();
    const otherBackend = new Backend();
    const other = new RunManager(config, path.join(root, 'session-b'), [otherBackend], undefined, { usageDataDir: shared });
    managers.push(other);
    const issued = await grant(manager, source);
    const request = { task: 'review', cwd: source, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id };
    const results = await Promise.allSettled([manager.reviewStart(request), other.reviewStart(request)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const denied = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(denied.reason).toMatchObject({ code: 'VSUP_ATTEMPT_CONSUMED' });
    const accepted = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<{ run_id: string }>;
    await state(results[0]!.status === 'fulfilled' ? manager : other, accepted.value.run_id, 'running');
    expect(backend.starts + otherBackend.starts).toBe(1);
  });

  it('keeps an attempt consumed after startup failure and permits a fresh authorization', async () => {
    const { manager, source, backend } = await fixture();
    backend.crash = true;
    const issued = await grant(manager, source);
    const request = { task: 'review', cwd: source, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id };
    const started = await manager.reviewStart(request);
    await state(manager, started.run_id, 'failed');
    await manager.close({ run_id: started.run_id });
    await expect(manager.reviewStart(request)).rejects.toMatchObject({ code: 'VSUP_ATTEMPT_CONSUMED' });
    backend.crash = false;
    const fresh = await grant(manager, source);
    const second = await manager.reviewStart({ ...request, authorization_id: fresh.authorization_id, attempt_id: fresh.attempt_id });
    await state(manager, second.run_id, 'running');
    expect(backend.starts).toBe(2);
  });

  it('retains dispatch identifiers through serialization, close and restart without replay', async () => {
    const { manager, source, backend, config, data, shared } = await fixture();
    const issued = await grant(manager, source);
    const request = { task: 'review', cwd: source, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id };
    const started = await manager.reviewStart(request);
    await state(manager, started.run_id, 'running');
    await manager.close({ run_id: started.run_id });
    const meta = JSON.parse(await readFile(path.join(data, 'runs', started.run_id, 'meta.json'), 'utf8'));
    expect(meta.dispatch).toEqual({ grant_id: issued.authorization_id, attempt_id: issued.attempt_id, request_sha256: issued.request_sha256 });
    expect(runToWire(runFromWire(meta)).dispatch).toEqual(meta.dispatch);
    await manager.shutdown();
    const newBackend = new Backend();
    const restarted = new RunManager(config, data, [newBackend], undefined, { usageDataDir: shared });
    managers.push(restarted);
    await restarted.initialize();
    await rm(path.join(data, 'runs', started.run_id), { recursive: true });
    await expect(restarted.reviewStart(request)).rejects.toMatchObject({ code: 'VSUP_ATTEMPT_CONSUMED' });
    expect(backend.starts).toBe(1);
    expect(newBackend.starts).toBe(0);
  });

  it('fails and releases an unexpected awaiting-validation backend instead of retaining it', async () => {
    const { manager, source, backend } = await fixture();
    const issued = await grant(manager, source);
    const started = await manager.reviewStart({ task: 'review', cwd: source, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id });
    await state(manager, started.run_id, 'running');
    await backend.callbacks!.onState('awaiting_validation');
    await state(manager, started.run_id, 'failed');
    expect(backend.closes).toBeGreaterThan(0);
  });
});
