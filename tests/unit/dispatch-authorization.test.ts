import { mkdtemp, mkdir, realpath, rm, utimes, writeFile, readFile, readdir, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as paths from '../../src/security/paths.js';
import { DispatchGrants } from '../../src/core/dispatch-grants.js';
import { RunManager } from '../../src/core/run-manager.js';
import type { BackendCallbacks, BackendRunHandle, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { TEST_CONFIG } from './support/test-config.js';
import { runFromWire, runToWire } from '../../src/core/serialization.js';
import { canonical, digest, type AcceptanceContract } from '../../src/acceptance/schema.js';
import { prepareTaskInputs, type TaskInputManifest } from '../../src/preparation/task-inputs.js';
import * as taskInputs from '../../src/preparation/task-inputs.js';

const roots: string[] = [];
const managers: RunManager[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  lastInput?: StartRunInput;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks) {
    this.starts++;
    this.callbacks = callbacks;
    this.lastInput = input;
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

async function preparedFixture() {
  const setup = await fixture();
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: setup.source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture');
  const base = git('rev-parse', 'HEAD');
  const contract: AcceptanceContract = { schema_version: 1, allowed_changed_paths: ['note.txt'], required_changed_paths: [], checks: [{ id: 'note-exists', kind: 'file_exists', path: 'note.txt' }], required_validations: [] };
  const contractFile = path.join(setup.root, 'contract.json');
  await writeFile(contractFile, JSON.stringify(contract), { mode: 0o600 });
  const directory = path.join(setup.root, 'prepared');
  const prepared = await prepareTaskInputs({ source: setup.source, base, files: ['note.txt'], output: directory, contractFile, allowedRoots: setup.config.allowedWorkspaceRoots });
  const request = { task: 'edit', cwd: setup.source, base_ref: base, acceptance_contract: contract, prepared_inputs: { directory, manifest_sha256: prepared.manifest_sha256 as string } };
  return { ...setup, git, base, contractFile, directory, request };
}

type PreparedFixture = Awaited<ReturnType<typeof preparedFixture>>;
const preparedFaults = ['source bytes', 'copied bytes', 'copy permissions', 'inventory', 'base', 'scope', 'selected digest', 'policy'] as const;

async function alterPrepared(setup: PreparedFixture, fault: typeof preparedFaults[number]): Promise<() => Promise<void>> {
  if (fault === 'copy permissions') {
    const file = path.join(setup.directory, 'context', 'note.txt');
    await chmod(file, 0o644);
    return async () => { await chmod(file, 0o600); };
  }
  if (fault === 'source bytes' || fault === 'copied bytes') {
    const file = fault === 'source bytes' ? path.join(setup.source, 'note.txt') : path.join(setup.directory, 'context', 'note.txt');
    const saved = await readFile(file);
    await writeFile(file, 'modified\n');
    return async () => { await writeFile(file, saved); };
  }
  if (fault === 'inventory') {
    const file = path.join(setup.directory, 'context', 'extra.txt');
    await writeFile(file, 'unlisted\n', { mode: 0o600 });
    return async () => { await rm(file); };
  }
  if (fault === 'policy') {
    Object.assign(setup.config, { excludedGlobs: { [setup.source]: ['ignored/**'] } });
    return async () => { delete (setup.config as { excludedGlobs?: unknown }).excludedGlobs; };
  }
  const selected = setup.request.prepared_inputs.manifest_sha256;
  if (fault === 'selected digest') {
    setup.request.prepared_inputs.manifest_sha256 = '0'.repeat(64);
    return async () => { setup.request.prepared_inputs.manifest_sha256 = selected; };
  }
  const file = path.join(setup.directory, 'manifest.json');
  const saved = await readFile(file);
  const manifest = JSON.parse(saved.toString('utf8')) as TaskInputManifest;
  if (fault === 'base') manifest.base_commit = '0'.repeat(40);
  else manifest.allowed_output_paths = ['other.txt'];
  const { manifest_sha256: _claimed, ...body } = manifest;
  manifest.manifest_sha256 = digest(canonical(body));
  setup.request.prepared_inputs.manifest_sha256 = manifest.manifest_sha256;
  await writeFile(file, JSON.stringify(manifest));
  return async () => { await writeFile(file, saved); setup.request.prepared_inputs.manifest_sha256 = selected; };
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
  it.each(preparedFaults)('rejects invalid prepared %s before issuing or consuming a grant and releases admission', async fault => {
    const setup = await preparedFixture();
    const { manager, request, shared, backend } = setup;
    const issue = vi.spyOn(DispatchGrants.prototype, 'issue');
    const consume = vi.spyOn(DispatchGrants.prototype, 'consume');
    const authorize = () => manager.authorizeDispatch('edit', request, 'test-owner-message', new Date(Date.now() + 60_000).toISOString());
    const failure = { code: fault === 'copy permissions' ? 'VSUP_ARTIFACT_ERROR' : 'VSUP_INVALID_ARGUMENT' };
    let restore = await alterPrepared(setup, fault);
    await expect(authorize()).rejects.toMatchObject(failure);
    expect(issue).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    await expect(readdir(path.join(shared, 'dispatch-grants'))).rejects.toMatchObject({ code: 'ENOENT' });
    await restore();
    const issued = await authorize();
    restore = await alterPrepared(setup, fault);
    const ids = { authorization_id: issued.authorization_id, attempt_id: issued.attempt_id };
    await expect(manager.editStart({ ...request, ...ids })).rejects.toMatchObject(failure);
    expect(consume).not.toHaveBeenCalled();
    expect(backend.starts).toBe(0);
    await expect(readdir(path.join(shared, 'dispatch-grants', 'consumed'))).rejects.toMatchObject({ code: 'ENOENT' });
    await restore();
    const started = await manager.editStart({ ...request, ...ids });
    await state(manager, started.run_id, 'running');
    expect(issue).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(backend.starts).toBe(1);
    expect(backend.lastInput?.preparedContextFiles?.map(file => ({ path: file.path, content: file.content }))).toEqual([{ path: 'note.txt', content: 'original\n' }]);
    await manager.close({ run_id: started.run_id });
    await expect(manager.editStart({ ...request, ...ids })).rejects.toMatchObject({ code: 'VSUP_ATTEMPT_CONSUMED' });
    expect(backend.starts).toBe(1);
  });

  it.each(['issue', 'consume'] as const)('bounds full prepared verification by the current admission deadline before %s', async phase => {
    const { manager, request, backend } = await preparedFixture();
    const authorize = () => manager.authorizeDispatch('edit', request, 'test-owner-message', new Date(Date.now() + 60_000).toISOString());
    let issued = phase === 'consume' ? await authorize() : undefined;
    await manager.initialize();
    const issue = vi.spyOn(DispatchGrants.prototype, 'issue');
    const consume = vi.spyOn(DispatchGrants.prototype, 'consume');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const verification = vi.spyOn(taskInputs, 'verifyTaskInputs').mockImplementationOnce(() => new Promise(() => {}));
    const pending = phase === 'issue' ? authorize() : manager.editStart({ ...request, authorization_id: issued!.authorization_id, attempt_id: issued!.attempt_id });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'VSUP_PREPARATION_TIMEOUT' });
    await vi.waitFor(() => expect(verification).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_001);
    await rejected;
    expect(issue).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(backend.starts).toBe(0);
    vi.useRealTimers();
    verification.mockRestore();
    issued ??= await authorize();
    const started = await manager.editStart({ ...request, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id });
    await state(manager, started.run_id, 'running');
    expect(backend.starts).toBe(1);
  });

  it.each(['issue', 'consume'] as const)('preserves an unexpected prepared verification fault before %s without spending authorization', async phase => {
    const { manager, request, backend } = await preparedFixture();
    const authorize = () => manager.authorizeDispatch('edit', request, 'test-owner-message', new Date(Date.now() + 60_000).toISOString());
    let issued = phase === 'consume' ? await authorize() : undefined;
    const issue = vi.spyOn(DispatchGrants.prototype, 'issue');
    const consume = vi.spyOn(DispatchGrants.prototype, 'consume');
    const fault = new Error('unexpected verifier fault');
    vi.spyOn(taskInputs, 'verifyTaskInputs').mockRejectedValueOnce(fault);
    const pending = phase === 'issue' ? authorize() : manager.editStart({ ...request, authorization_id: issued!.authorization_id, attempt_id: issued!.attempt_id });
    await expect(pending).rejects.toBe(fault);
    expect(issue).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(backend.starts).toBe(0);
    issued ??= await authorize();
    const started = await manager.editStart({ ...request, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id });
    await state(manager, started.run_id, 'running');
    expect(backend.starts).toBe(1);
  });

  it('admits current workspace policy before inspecting selected prepared state', async () => {
    const { manager, root, request, backend } = await preparedFixture();
    const verification = vi.spyOn(taskInputs, 'verifyTaskInputs');
    const invalid = { ...request, cwd: root, prepared_inputs: { ...request.prepared_inputs, directory: path.join(root, 'missing') } };
    await expect(manager.authorizeDispatch('edit', invalid, 'test-owner-message', new Date(Date.now() + 60_000).toISOString())).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID' });
    await expect(manager.editStart({ ...invalid, authorization_id: randomUUID(), attempt_id: randomUUID() })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID' });
    expect(verification).not.toHaveBeenCalled();
    expect(backend.starts).toBe(0);
  });

  it('binds verified prepared inputs to the admitted source and selected immutable edit base', async () => {
    const { manager, source, root, git, base, request, backend } = await preparedFixture();
    const issue = vi.spyOn(DispatchGrants.prototype, 'issue');
    const other = path.join(source, 'nested-repository');
    execFileSync('git', ['clone', '-q', source, other], { cwd: root, stdio: 'ignore' });
    await expect(manager.authorizeDispatch('edit', { ...request, cwd: other }, 'test-owner-message', new Date(Date.now() + 60_000).toISOString())).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT', message: expect.stringContaining('edit source or base') });
    git('commit', '-q', '--allow-empty', '-m', 'new base');
    const latest = git('rev-parse', 'HEAD');
    git('checkout', '-q', base);
    await expect(manager.authorizeDispatch('edit', { ...request, base_ref: latest }, 'test-owner-message', new Date(Date.now() + 60_000).toISOString())).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT', message: expect.stringContaining('edit source or base') });
    expect(issue).not.toHaveBeenCalled();
    expect(backend.starts).toBe(0);
  });

  it.each(['after consumption', 'after launch verification'] as const)('keeps a prepared-input race %s failed without replay and releases the slot', async phase => {
    const { manager, request, directory, shared, backend } = await preparedFixture();
    const authorize = () => manager.authorizeDispatch('edit', request, 'test-owner-message', new Date(Date.now() + 60_000).toISOString());
    const issued = await authorize();
    const copy = path.join(directory, 'context', 'note.txt');
    const saved = await readFile(copy);
    if (phase === 'after consumption') {
      const originalConsume = DispatchGrants.prototype.consume;
      vi.spyOn(DispatchGrants.prototype, 'consume').mockImplementationOnce(async function (input) {
        await originalConsume.call(this, input);
        await writeFile(copy, 'changed after consumption\n');
      });
    } else {
      const originalVerify = taskInputs.verifyTaskInputs;
      let verifications = 0;
      vi.spyOn(taskInputs, 'verifyTaskInputs').mockImplementation(async (...args) => {
        const verified = await originalVerify(...args);
        if (++verifications === 2) await writeFile(copy, 'changed after launch verification\n');
        return verified;
      });
    }
    const ids = { authorization_id: issued.authorization_id, attempt_id: issued.attempt_id };
    const started = await manager.editStart({ ...request, ...ids });
    await state(manager, started.run_id, 'failed');
    expect((await manager.status({ run_id: started.run_id })).error).toMatchObject({ code: 'VSUP_INVALID_ARGUMENT' });
    expect(backend.starts).toBe(0);
    expect(await readdir(path.join(shared, 'dispatch-grants', 'consumed'))).toContain(`${issued.attempt_id}.json`);
    await manager.close({ run_id: started.run_id });
    await writeFile(copy, saved);
    await expect(manager.editStart({ ...request, ...ids })).rejects.toMatchObject({ code: 'VSUP_ATTEMPT_CONSUMED' });
    const fresh = await authorize();
    const second = await manager.editStart({ ...request, authorization_id: fresh.authorization_id, attempt_id: fresh.attempt_id });
    await state(manager, second.run_id, 'running');
    expect(backend.starts).toBe(1);
  });

  it.each(['prepare_directory', 'write_grant'] as const)('names a denied %s operation without launching or returning a grant', async operation => {
    const { manager, source, shared, backend } = await fixture();
    const denied = Object.assign(new Error('private filesystem detail'), { code: 'EPERM' });
    if (operation === 'prepare_directory') {
      const original = paths.createPrivateDir;
      vi.spyOn(paths, 'createPrivateDir').mockImplementation(async directory => { if (directory === shared) throw denied; await original(directory); });
    } else {
      vi.spyOn(DispatchGrants.prototype, 'issue').mockRejectedValue(denied);
    }
    let failure: unknown;
    try { await grant(manager, source); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'VSUP_STORAGE_ERROR', details: { phase: 'grant_registration', operation, code: 'EPERM' }, remediation: expect.stringContaining('scoped administrative command permission') });
    expect((failure as Error).message).not.toContain('private filesystem detail');
    expect(backend.starts).toBe(0);
    await expect(readFile(path.join(shared, 'dispatch-grants', 'consumed'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

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
    await expect(manager.reviewStart({ task: 'changed', cwd: source, ...ids })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', details: { differing_fields: ['task'] } });
    await expect(manager.reviewStart({ task: 'review', cwd: source, max_turns: 3, ...ids })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', details: { differing_fields: ['limits'] } });
    expect(backend.starts).toBe(0);
    const started = await manager.reviewStart({ task: 'review', cwd: source, ...ids });
    await state(manager, started.run_id, 'running');
    expect(backend.starts).toBe(1);
  });

  it('binds review workspace changes and leaves the worker unstarted', async () => {
    const { manager, source, backend } = await fixture();
    const issued = await grant(manager, source);
    await writeFile(path.join(source, 'note.txt'), 'changed contents\n');
    await expect(manager.reviewStart({ task: 'review', cwd: source, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', details: { differing_fields: ['review_content'] } });
    expect(backend.starts).toBe(0);
  });

  it('binds review content, not timestamps or Git-ignored output', async () => {
    const { manager, source, backend } = await fixture();
    await writeFile(path.join(source, '.gitignore'), 'node_modules/\n');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: source, stdio: 'ignore' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'fixture');
    const issued = await grant(manager, source);
    const later = new Date(Date.now() + 120_000);
    await utimes(path.join(source, 'note.txt'), later, later);
    await mkdir(path.join(source, 'node_modules'));
    await writeFile(path.join(source, 'node_modules', 'cache.json'), '{}\n');
    const started = await manager.reviewStart({ task: 'review', cwd: source, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id });
    await state(manager, started.run_id, 'running');
    expect(backend.starts).toBe(1);
  });

  it('binds an untracked file that Git does not ignore', async () => {
    const { manager, source, backend } = await fixture();
    execFileSync('git', ['init', '-q'], { cwd: source, stdio: 'ignore' });
    const issued = await grant(manager, source);
    await writeFile(path.join(source, 'added.txt'), 'new\n');
    await expect(manager.reviewStart({ task: 'review', cwd: source, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    expect(backend.starts).toBe(0);
  });

  it('binds allowed_write_paths into the edit authorization and the run record', async () => {
    const { manager, source, backend, data } = await fixture();
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: source, stdio: 'ignore' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'fixture');
    const expires = new Date(Date.now() + 60_000).toISOString();
    const issued = await manager.authorizeDispatch('edit', { task: 'edit', cwd: source, allowed_write_paths: ['note.txt'] }, 'test-owner-message', expires);
    const ids = { authorization_id: issued.authorization_id, attempt_id: issued.attempt_id };
    await expect(manager.editStart({ task: 'edit', cwd: source, allowed_write_paths: ['other.txt'], ...ids })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', details: { differing_fields: ['allowed_write_paths'] } });
    await expect(manager.editStart({ task: 'edit', cwd: source, ...ids })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    const started = await manager.editStart({ task: 'edit', cwd: source, allowed_write_paths: ['note.txt'], ...ids });
    await state(manager, started.run_id, 'running');
    expect(backend.starts).toBe(1);
    expect(backend.lastInput?.allowedWritePaths).toEqual(['note.txt']);
    const record = runFromWire(runToWire(runFromWire(JSON.parse(await readFile(path.join(data, 'runs', started.run_id, 'meta.json'), 'utf8')))));
    expect(record.allowedWritePaths).toEqual(['note.txt']);
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
