import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, RunRecord, StartRunInput } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { SCHEMA_VERSION } from '../../src/contracts.js';
import { AcpBackend } from '../../src/backends/acp.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';
import { IDLE_DEADLINE_MARGIN_SECONDS, WORKER_DEADLINE_FILE_ENV, WORKER_DEADLINE_FILE_NAME, writeWorkerDeadline } from '../../src/backends/worker-deadline.js';

const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const T0 = Date.UTC(2030, 0, 1, 12, 0, 0);
const TIMEOUT = 30;
const IDLE_TTL = DEFAULT_CONFIG.workerIdleTtlSeconds;
const seconds = (ms: number) => Math.ceil(ms / 1000);

const roots: string[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0); });
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeAcpBackend extends AcpBackend {
  launchEnv: NodeJS.ProcessEnv = {};
  constructor(private readonly testMode: string, dataDir: string, allowedWorkspaceRoots: string[]) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots, paths: { vibeAcp: 'fake-acp' } }, dataDir);
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    this.launchEnv = { ...profile.env, FAKE_ACP_CASE: this.testMode };
    return { command: process.execPath, args: [fixture], env: this.launchEnv };
  }
}

async function makeRun() {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-deadline-')); roots.push(root);
  const data = path.join(root, 'data');
  const workspace = path.join(root, 'workspace');
  const runId = crypto.randomUUID();
  const runDirectory = path.join(data, 'runs', runId);
  await mkdir(workspace, { recursive: true }); await mkdir(runDirectory, { recursive: true });
  const input: StartRunInput = { runId, mode: 'review', task: 'Inspect the workspace', cwd: workspace, workerWorkspace: workspace, runDirectory, limits: { timeoutSeconds: TIMEOUT, maxTurns: 5, maxEventBytes: 1_000_000, maxTranscriptBytes: 1_000_000, maxArtifactBytes: 1_000_000 } };
  return { root, data, workspace, runDirectory, input, file: path.join(runDirectory, WORKER_DEADLINE_FILE_NAME) };
}

const readDeadline = async (file: string) => Number((await readFile(file, 'utf8')).trim());

function recorder(file: string) {
  const seen: Array<{ state: string; deadline: number }> = [];
  const callbacks: BackendCallbacks = {
    onEvent: () => undefined,
    onPendingRequest: () => undefined,
    onState: async (state) => { seen.push({ state, deadline: await readDeadline(file) }); }
  };
  const completed = () => seen.filter((entry) => entry.state === 'completed').length;
  const until = async (count: number) => {
    for (let attempt = 0; attempt < 500 && completed() < count; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(completed()).toBe(count);
  };
  return { seen, callbacks, until };
}

describe('worker deadline file', () => {
  it('is written before launch with the initial deadline, owner-only, and passed to the child', async () => {
    const { data, workspace, runDirectory, input, file } = await makeRun();
    const backend = new FakeAcpBackend('permission', data, [workspace]);
    const { callbacks } = recorder(file);
    const started = await backend.start(input, callbacks);
    try {
      expect(backend.launchEnv[WORKER_DEADLINE_FILE_ENV]).toBe(file);
      expect(backend.launchEnv.VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS).toBe(String(TIMEOUT));
      expect(await readDeadline(file)).toBe(seconds(T0) + TIMEOUT);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(path.dirname(file)).toBe(runDirectory);
    } finally { await backend.cancel(started.handle); }
  });

  it('rewrites the deadline at every turn start and covers the idle window after each turn', async () => {
    const { data, workspace, input, file } = await makeRun();
    const backend = new FakeAcpBackend('normal', data, [workspace]);
    const { seen, callbacks, until } = recorder(file);
    const started = await backend.start(input, callbacks);
    try {
      await until(1);
      const idle = seconds(T0) + IDLE_TTL + IDLE_DEADLINE_MARGIN_SECONDS;
      expect(seen.map((entry) => entry.state)).toEqual(['running', 'completed']);
      expect(seen[0]?.deadline).toBe(seconds(T0) + TIMEOUT);
      expect(seen[1]?.deadline).toBe(idle);
      expect(await readDeadline(file)).toBe(idle);

      const later = T0 + 25 * 60 * 1000;
      vi.setSystemTime(later);
      await backend.continue(started.handle, 'one more check');
      await until(2);
      expect(seen.map((entry) => entry.state)).toEqual(['running', 'completed', 'running', 'completed']);
      expect(seen[2]?.deadline).toBe(seconds(later) + TIMEOUT);
      expect(seen[3]?.deadline).toBe(seconds(later) + IDLE_TTL + IDLE_DEADLINE_MARGIN_SECONDS);
      expect(seen[2]?.deadline).toBeGreaterThan(seen[1]?.deadline ?? 0);
    } finally { await backend.close(started.handle); }
  });

  it('is written by recovery before the child starts and extended by the continuation', async () => {
    const { data, workspace, runDirectory, input, file } = await makeRun();
    await mkdir(path.join(runDirectory, 'child-home')); await mkdir(path.join(runDirectory, 'vibe-home'));
    const backend = new FakeAcpBackend('load', data, [workspace]);
    const { seen, callbacks, until } = recorder(file);
    const record: RunRecord = {
      schemaVersion: SCHEMA_VERSION, runId: input.runId, backend: 'acp', mode: 'review', state: 'recoverable',
      sourceWorkspace: workspace, workerWorkspace: workspace, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskSha256: 'a'.repeat(64),
      limits: input.limits, acp: { protocolVersion: 1, sessionId: 'fake-session-1', capabilities: { loadSession: true }, runDirectory, home: path.join(runDirectory, 'child-home'), vibeHome: path.join(runDirectory, 'vibe-home'), profileMode: 'review' }
    };
    const handle = await backend.recover(record, callbacks);
    try {
      expect(handle).toBeTruthy();
      expect(backend.launchEnv[WORKER_DEADLINE_FILE_ENV]).toBe(file);
      expect(await readDeadline(file)).toBe(seconds(T0) + TIMEOUT);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      const later = T0 + 25 * 60 * 1000;
      vi.setSystemTime(later);
      await backend.continue(handle!, 'continue after reload');
      await until(1);
      expect(seen[0]).toEqual({ state: 'running', deadline: seconds(later) + TIMEOUT });
    } finally { await backend.close(handle!); }
  });

  it('refuses to start through a symlink in place of the file', async () => {
    const { root, data, workspace, input, file } = await makeRun();
    const elsewhere = path.join(root, 'elsewhere');
    await writeFile(elsewhere, '1', { mode: 0o600 });
    await symlink(elsewhere, file);
    const backend = new FakeAcpBackend('normal', data, [workspace]);
    await expect(backend.start(input, recorder(file).callbacks)).rejects.toBeTruthy();
    expect(await readFile(elsewhere, 'utf8')).toBe('1');
  });
});

describe('writeWorkerDeadline', () => {
  it('replaces the file atomically with a single integer and mode 0600', async () => {
    const { runDirectory, file } = await makeRun();
    await writeWorkerDeadline(runDirectory, 1_900_000_000);
    await writeWorkerDeadline(runDirectory, 1_900_000_500);
    expect(await readFile(file, 'utf8')).toBe('1900000500\n');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('refuses a symlinked or non-regular target and a symlinked run directory', async () => {
    const { root, runDirectory, file } = await makeRun();
    const elsewhere = path.join(root, 'elsewhere');
    await writeFile(elsewhere, 'keep');
    await symlink(elsewhere, file);
    await expect(writeWorkerDeadline(runDirectory, 1_900_000_000)).rejects.toThrow();
    expect(await readFile(elsewhere, 'utf8')).toBe('keep');
    const linked = path.join(root, 'linked');
    await symlink(runDirectory, linked);
    await expect(writeWorkerDeadline(linked, 1_900_000_000)).rejects.toThrow();
  });

  it('rejects non-finite and non-positive deadlines', async () => {
    const { runDirectory } = await makeRun();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -4]) await expect(writeWorkerDeadline(runDirectory, value)).rejects.toThrow();
  });

  it('keeps the session running and reports a diagnostic when a deadline write fails', async () => {
    const { data, workspace, input, file } = await makeRun();
    const backend = new FakeAcpBackend('normal', data, [workspace]);
    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const states: string[] = [];
    const callbacks: BackendCallbacks = {
      onEvent: (event) => { events.push(event as { type: string; data?: Record<string, unknown> }); },
      onPendingRequest: () => undefined,
      onState: (state) => { states.push(state); }
    };
    const started = await backend.start(input, callbacks);
    try {
      for (let attempt = 0; attempt < 500 && !states.includes('completed'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(states).toContain('completed');
      await rm(file, { force: true });
      await mkdir(file);
      await backend.continue(started.handle, 'Follow up');
      for (let attempt = 0; attempt < 500 && states.filter((state) => state === 'completed').length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(states.filter((state) => state === 'completed')).toHaveLength(2);
      expect(states).not.toContain('failed');
      expect(events.some((event) => event.type === 'diagnostic' && event.data?.reason === 'worker_deadline_write_failed')).toBe(true);
    } finally { await backend.close(started.handle); }
  });

  it('writes nothing into the run directory after close', async () => {
    const { data, workspace, input, runDirectory } = await makeRun();
    const backend = new FakeAcpBackend('normal', data, [workspace]);
    const started = await backend.start(input, { onEvent: () => undefined, onPendingRequest: () => undefined, onState: () => undefined });
    await backend.close(started.handle);
    const { readdir } = await import('node:fs/promises');
    const before = (await readdir(runDirectory)).sort();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await readdir(runDirectory)).sort()).toEqual(before);
    expect(before.some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});
