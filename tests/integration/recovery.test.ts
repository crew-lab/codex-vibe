import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, RunState, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runToWire } from '../../src/core/serialization.js';
import { AcpBackend } from '../../src/backends/acp.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';

const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const pidDirs: string[] = [];

afterEach(async () => {
  for (const pidDir of pidDirs.splice(0)) {
    for (const name of await readdir(pidDir).catch(() => [] as string[])) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeAcpBackend extends AcpBackend {
  pidDir: string | undefined;
  constructor(private readonly testMode: string, dataDir: string, allowedWorkspaceRoots: string[]) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots, paths: { vibeAcp: 'fake-acp', dataDir } }, dataDir);
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: this.testMode, ...(this.pidDir ? { FAKE_PID_DIR: this.pidDir } : {}) } };
  }
  override async probe() {
    return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
}

class FakeBackend implements SupervisorBackend {
  recoverCalls = 0;
  constructor(readonly kind: 'acp' | 'programmatic' = 'programmatic') {}
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, _callbacks: BackendCallbacks): Promise<BackendStartResult> {
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(_handle: BackendRunHandle) {}
  async close() {}
  async recover(_record: RunRecord) { this.recoverCalls += 1; return undefined; }
}

async function makeParent() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-recovery-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data'); const pidDir = path.join(parent, 'pids');
  await mkdir(source); await mkdir(pidDir); pidDirs.push(pidDir);
  return { parent, source, data, pidDir };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;

function baseRecord(source: string, backend: 'acp' | 'programmatic', state: RunState, withSession: boolean, extra: Partial<RunRecord> = {}): RunRecord {
  const runId = randomUUID();
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, runId, backend, mode: 'review', state, sourceWorkspace: source, workerWorkspace: source,
    createdAt: now, updatedAt: now, launchedAt: now, taskSha256: 'a'.repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_048_576, maxTranscriptBytes: 1_048_576, maxArtifactBytes: 8_388_608 },
    ...(withSession ? { acp: { protocolVersion: 1, sessionId: 'fake-session-1', capabilities: { loadSession: true }, runDirectory: '', home: '', vibeHome: '', profileMode: 'review' as const } } : {}),
    ...extra
  };
}

async function writeRecord(data: string, record: RunRecord): Promise<string> {
  const directory = path.join(data, 'runs', record.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'meta.json'), JSON.stringify(runToWire(record)), { mode: 0o600 });
  return directory;
}

async function readMeta(data: string, runId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(data, 'runs', runId, 'meta.json'), 'utf8')) as Record<string, unknown>;
}

const pending = { requestId: 'req-1', kind: 'permission' as const, title: 'Read file', options: [{ optionId: 'allow', name: 'Allow once' }] };

describe('restart recovery', () => {
  it('maps every non-terminal record without spawning, holding a slot or touching artifacts', async () => {
    const { source, data, pidDir } = await makeParent();
    const backend = new FakeAcpBackend('normal', data, [source]); backend.pidDir = pidDir;
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source] };
    const cases: Array<{ state: RunState; session: boolean; expectState: RunState; code?: string; extra?: Partial<RunRecord> }> = [];
    for (const session of [true, false]) {
      cases.push({ state: 'queued', session, expectState: 'cancelled', code: 'VSUP_CANCELLED' });
      cases.push({ state: 'starting', session, expectState: 'cancelled', code: 'VSUP_CANCELLED' });
      cases.push({ state: 'negotiating', session, expectState: 'recoverable', ...(session ? {} : { code: 'VSUP_SESSION_NOT_RESUMABLE' }) });
      cases.push({ state: 'running', session, expectState: 'recoverable', ...(session ? {} : { code: 'VSUP_SESSION_NOT_RESUMABLE' }) });
      cases.push({ state: 'waiting_permission', session, expectState: 'recoverable', code: 'VSUP_REQUEST_EXPIRED', extra: { pendingRequest: pending } });
      cases.push({ state: 'completed', session, expectState: 'completed' });
    }
    const written: Array<{ runId: string; spec: (typeof cases)[number]; before: string }> = [];
    for (const spec of cases) {
      const record = baseRecord(source, 'acp', spec.state, spec.session, spec.extra);
      await writeRecord(data, record);
      written.push({ runId: record.runId, spec, before: await readFile(path.join(data, 'runs', record.runId, 'meta.json'), 'utf8') });
    }
    const manager = new RunManager(config, data, [backend]);
    try {
      const started = Date.now();
      await manager.initialize();
      expect(Date.now() - started).toBeLessThan(1000);
      expect(activeSlots(manager)).toBe(0);
      expect(await readdir(pidDir)).toEqual([]);
      for (const { runId, spec, before } of written) {
        const label = `${spec.state} session=${spec.session}`;
        const status = await manager.status({ run_id: runId });
        expect(status.state, label).toBe(spec.expectState);
        expect((status.error as { code?: string } | undefined)?.code, label).toBe(spec.code);
        expect(status.pending_request, label).toBeUndefined();
        const meta = await readMeta(data, runId);
        expect(meta.state, label).toBe(spec.expectState);
        expect(meta.pending_request, label).toBeUndefined();
        const resultPath = path.join(data, 'runs', runId, 'result.json');
        if (spec.state === 'completed') {
          expect(await readFile(path.join(data, 'runs', runId, 'meta.json'), 'utf8'), label).toBe(before);
          await expect(stat(resultPath), label).rejects.toMatchObject({ code: 'ENOENT' });
        } else {
          const result = JSON.parse(await readFile(resultPath, 'utf8')) as { state: string; integrity?: unknown; warnings: string[] };
          expect(result.state, label).toBe(spec.expectState);
          expect(result.integrity, label).toBeUndefined();
          expect(result.warnings.some((warning) => warning.includes('restarted before this run finished')), label).toBe(true);
          expect(result.warnings.some((warning) => warning.includes('could not be finalized')), label).toBe(false);
        }
      }
      expect(await readdir(pidDir)).toEqual([]);
    } finally { await manager.shutdown(); }
  });

  it('continues a recovered ACP run lazily: loads the session on demand, runs, and completes', async () => {
    const { source, data, pidDir } = await makeParent();
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 };
    const firstBackend = new FakeAcpBackend('normal', data, [source]); firstBackend.pidDir = pidDir;
    const first = new RunManager(config, data, [firstBackend]);
    const started = await first.reviewStart({ task: 'review', cwd: source });
    await waitFor(() => first.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
    await first.shutdown();
    const metaPath = path.join(data, 'runs', started.run_id, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    meta.state = 'running'; meta.launched_at = '2020-01-01T00:00:00.000Z'; delete meta.finished_at; delete meta.result;
    await writeFile(metaPath, JSON.stringify(meta));
    expect(await readdir(pidDir)).toHaveLength(1);
    const secondBackend = new FakeAcpBackend('marker', data, [source]); secondBackend.pidDir = pidDir;
    const second = new RunManager(config, data, [secondBackend]);
    try {
      await second.initialize();
      expect(await readFile(path.join(data, 'runs', started.run_id, 'transcript.md'), 'utf8')).not.toContain('continued-turn-marker');
      expect(await second.status({ run_id: started.run_id })).toMatchObject({ state: 'recoverable' });
      expect((await second.status({ run_id: started.run_id })).error).toBeUndefined();
      expect(activeSlots(second)).toBe(0);
      expect(await readdir(pidDir)).toHaveLength(1);
      const continued = await second.continue({ run_id: started.run_id, message: 'again' });
      expect(continued.state).toBe('running');
      expect(activeSlots(second)).toBe(1);
      expect(((await readMeta(data, started.run_id)).launched_at as string) > '2020-01-01T00:00:00.000Z').toBe(true);
      const status = await waitFor(() => second.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
      expect(status.state).toBe('completed');
      expect(await waitFor(async () => activeSlots(second), (value) => value === 0)).toBe(0);
      expect(await readdir(pidDir)).toHaveLength(2);
      expect(await readFile(path.join(data, 'runs', started.run_id, 'transcript.md'), 'utf8')).toContain('continued-turn-marker');
      expect((await second.result({ run_id: started.run_id })).state).toBe('completed');
    } finally { await first.shutdown(); await second.shutdown(); }
  }, 30_000);

  it('fails a continuation of a recoverable programmatic run with VSUP_SESSION_NOT_RESUMABLE and keeps it recoverable', async () => {
    const { source, data } = await makeParent();
    const backend = new FakeBackend();
    const record = baseRecord(source, 'programmatic', 'running', false);
    await writeRecord(data, record);
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      await manager.initialize();
      expect(await manager.status({ run_id: record.runId })).toMatchObject({ state: 'recoverable', error: { code: 'VSUP_SESSION_NOT_RESUMABLE' } });
      await expect(manager.continue({ run_id: record.runId, message: 'again' })).rejects.toMatchObject({ code: 'VSUP_SESSION_NOT_RESUMABLE' });
      expect(backend.recoverCalls).toBe(1);
      expect(activeSlots(manager)).toBe(0);
      expect(await manager.status({ run_id: record.runId })).toMatchObject({ state: 'recoverable', error: { code: 'VSUP_SESSION_NOT_RESUMABLE' } });
      expect(await readMeta(data, record.runId)).toMatchObject({ state: 'recoverable', error: { code: 'VSUP_SESSION_NOT_RESUMABLE' } });
    } finally { await manager.shutdown(); }
  });

  it('records the failed lazy recovery on a recoverable ACP run that had no error before', async () => {
    const { source, data } = await makeParent();
    const backend = new FakeBackend('acp');
    const record = baseRecord(source, 'acp', 'running', true);
    await writeRecord(data, record);
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      await manager.initialize();
      expect((await manager.status({ run_id: record.runId })).error).toBeUndefined();
      await expect(manager.continue({ run_id: record.runId, message: 'again' })).rejects.toMatchObject({ code: 'VSUP_SESSION_NOT_RESUMABLE' });
      expect(await manager.status({ run_id: record.runId })).toMatchObject({ state: 'recoverable', error: { code: 'VSUP_SESSION_NOT_RESUMABLE' } });
    } finally { await manager.shutdown(); }
  });

  it('rejects a continuation without a free slot before trying to recover', async () => {
    const { source, data } = await makeParent();
    const backend = new FakeBackend('acp');
    const record = baseRecord(source, 'acp', 'running', true);
    await writeRecord(data, record);
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], maxConcurrentRuns: 1 }, data, [backend]);
    try {
      await manager.initialize();
      const busy = await manager.reviewStart({ task: 'holds the only slot', cwd: source });
      await waitFor(() => manager.status({ run_id: busy.run_id }), (value) => value.state === 'running');
      await expect(manager.continue({ run_id: record.runId, message: 'again' })).rejects.toMatchObject({ code: 'VSUP_LIMIT_EXCEEDED' });
      expect(backend.recoverCalls).toBe(0);
      expect((await manager.status({ run_id: record.runId })).state).toBe('recoverable');
      expect(activeSlots(manager)).toBe(1);
    } finally { await manager.shutdown(); }
  });

  it('gives up on a session/load that never answers, leaves no process, and keeps the run recoverable', async () => {
    const { source, data, pidDir } = await makeParent();
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source] };
    const firstBackend = new FakeAcpBackend('normal', data, [source]); firstBackend.pidDir = pidDir;
    const first = new RunManager(config, data, [firstBackend]);
    const started = await first.reviewStart({ task: 'review', cwd: source });
    await waitFor(() => first.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
    await first.shutdown();
    const metaPath = path.join(data, 'runs', started.run_id, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    meta.state = 'running'; delete meta.finished_at; delete meta.result;
    await writeFile(metaPath, JSON.stringify(meta));
    const secondBackend = new FakeAcpBackend('load-hang', data, [source]); secondBackend.pidDir = pidDir;
    const second = new RunManager(config, data, [secondBackend]);
    try {
      await second.initialize();
      const begun = Date.now();
      await expect(second.continue({ run_id: started.run_id, message: 'again' })).rejects.toMatchObject({ code: 'VSUP_SESSION_NOT_RESUMABLE', message: 'Vibe did not finish loading the session within 30 seconds.' });
      const elapsed = Date.now() - begun;
      expect(elapsed).toBeGreaterThan(28_000);
      expect(elapsed).toBeLessThan(40_000);
      expect(activeSlots(second)).toBe(0);
      expect(await second.status({ run_id: started.run_id })).toMatchObject({ state: 'recoverable', error: { code: 'VSUP_SESSION_NOT_RESUMABLE', message: 'Vibe did not finish loading the session within 30 seconds.' } });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const pids = (await readdir(pidDir)).map(Number);
      expect(pids).toHaveLength(2);
      const livePids = await waitFor(async () => pids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }), (value) => value.length === 0, 3000);
      expect(livePids).toEqual([]);
      expect(await second.status({ run_id: started.run_id })).toMatchObject({ state: 'recoverable' });
    } finally { await first.shutdown(); await second.shutdown(); }
  }, 70_000);
});
