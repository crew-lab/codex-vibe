import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, StartRunInput, SupervisorError } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AcpBackend } from '../../src/backends/acp.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';

const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const pidDirs: string[] = [];
const savedPath = process.env.PATH;

afterEach(async () => {
  if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
  for (const pidDir of pidDirs.splice(0)) {
    for (const name of await readdir(pidDir).catch(() => [] as string[])) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-labels-')); roots.push(root);
  const source = path.join(root, 'source'); const data = path.join(root, 'data'); const pidDir = path.join(root, 'pids');
  await mkdir(source); await mkdir(pidDir); pidDirs.push(pidDir);
  return { root, source, data, pidDir };
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function failedRun(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  return waitFor(() => manager.status({ run_id: started.run_id }), (value) => ['failed', 'cancelled', 'completed'].includes(String(value.state)));
}

describe('a missing interpreter is not reported as a missing Vibe executable', () => {
  it('reports an absolute shebang interpreter that does not exist for the ACP launcher', async () => {
    const { root, source, data } = await makeRoot();
    const script = path.join(root, 'vibe-acp');
    await writeExecutable(script, '#!/nonexistent/dir/python3\n');
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source], paths: { vibeAcp: script, dataDir: data } };
    const probe = await new AcpBackend(config, data).probe({ fresh: true });
    expect(probe.available).toBe(false);
    expect(probe.details).toMatchObject({ interpreter_missing: true, interpreter: '/nonexistent/dir/python3' });
    expect(probe.details?.executable_missing).toBeUndefined();
    const manager = new RunManager(config, data, [new AcpBackend(config, data)]);
    try {
      const status = await failedRun(manager, source);
      expect(status.error).toMatchObject({ code: 'VSUP_BACKEND_UNAVAILABLE', message: expect.stringContaining('/nonexistent/dir/python3') });
      expect((status.error as SupervisorError).message).toMatch(/interpreter/i);
    } finally { await manager.shutdown(); }
  });

  it('reports a python3 that is not on PATH for the ACP launcher', async () => {
    const { root, source, data } = await makeRoot();
    const script = path.join(root, 'vibe-acp');
    await writeExecutable(script, '#!/usr/bin/env python3\n');
    const empty = path.join(root, 'empty-path'); await mkdir(empty);
    process.env.PATH = empty;
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source], paths: { vibeAcp: script, dataDir: data } };
    const probe = await new AcpBackend(config, data).probe({ fresh: true });
    expect(probe.details).toMatchObject({ interpreter_missing: true, interpreter: 'python3' });
    expect(probe.details?.executable_missing).toBeUndefined();
    const manager = new RunManager(config, data, [new AcpBackend(config, data)]);
    try {
      expect((await failedRun(manager, source)).error).toMatchObject({ code: 'VSUP_BACKEND_UNAVAILABLE', message: expect.stringContaining('python3') });
    } finally { await manager.shutdown(); }
  });

  it('reports a shebang interpreter that does not exist for the programmatic launcher', async () => {
    const { root, source, data } = await makeRoot();
    const script = path.join(root, 'vibe');
    await writeExecutable(script, '#!/nonexistent/dir/python3\n');
    const config = { ...DEFAULT_CONFIG, backend: 'programmatic' as const, allowedWorkspaceRoots: [source], paths: { vibe: script, dataDir: data } };
    const probe = await new ProgrammaticBackend(config).probe({ fresh: true });
    expect(probe.details).toMatchObject({ interpreter_missing: true });
    expect(probe.details?.executable_missing).toBeUndefined();
    const manager = new RunManager(config, data, [new ProgrammaticBackend(config)]);
    try {
      expect((await failedRun(manager, source)).error).toMatchObject({ code: 'VSUP_BACKEND_UNAVAILABLE', message: expect.stringMatching(/interpreter/i) });
    } finally { await manager.shutdown(); }
  });

  it.each([['acp', 'VSUP_VIBE_ACP_NOT_FOUND'], ['programmatic', 'VSUP_VIBE_NOT_FOUND']] as const)('still reports a configured %s executable that does not exist as %s', async (kind, code) => {
    const { root, source, data } = await makeRoot();
    const missing = path.join(root, 'no-such-vibe');
    const config = { ...DEFAULT_CONFIG, backend: kind, allowedWorkspaceRoots: [source], paths: kind === 'acp' ? { vibeAcp: missing, dataDir: data } : { vibe: missing, dataDir: data } };
    const backend = kind === 'acp' ? new AcpBackend(config, data) : new ProgrammaticBackend(config);
    const manager = new RunManager(config, data, [backend]);
    try {
      const probe = await backend.probe({ fresh: true });
      expect(probe.details).toMatchObject({ executable_missing: true });
      expect((await failedRun(manager, source)).error).toMatchObject({ code });
    } finally { await manager.shutdown(); }
  });
});

class LabelBackend extends AcpBackend {
  constructor(private readonly testMode: string, dataDir: string, roots: string[], private readonly pidDir: string) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: roots, paths: { vibeAcp: 'fake-acp', dataDir } }, dataDir);
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: this.testMode, FAKE_PID_DIR: this.pidDir } };
  }
  override async probe() {
    return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
}

describe('ACP connection errors are labeled by phase', () => {
  it.each([
    ['mid-turn-error', 'VSUP_ACP_PROTOCOL_ERROR'],
    ['mid-turn-401', 'VSUP_AUTH_REQUIRED'],
    ['mid-turn-429', 'VSUP_RATE_LIMITED'],
  ])('labels a %s failure after the session is ready as %s', async (mode, code) => {
    const { source, data, pidDir } = await makeRoot();
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 }, data, [new LabelBackend(mode, data, [source], pidDir)]);
    try {
      const status = await failedRun(manager, source);
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code, ...(code === 'VSUP_RATE_LIMITED' ? { retryable: true } : {}) });
    } finally { await manager.shutdown(); }
  }, 30_000);

  it.each([
    ['init-401', 'VSUP_AUTH_REQUIRED'],
    ['init-429', 'VSUP_RATE_LIMITED'],
    ['broken-json', 'VSUP_ACP_INIT_FAILED'],
  ])('keeps labeling a %s failure before the session is ready as %s', async (mode, code) => {
    const { source, data, pidDir } = await makeRoot();
    const backend = new LabelBackend(mode, data, [source], pidDir);
    const reported: SupervisorError[] = [];
    const callbacks: BackendCallbacks = { onEvent: async () => undefined, onPendingRequest: async () => undefined, onState: async (state, update) => { if (state === 'failed' && update?.error) reported.push(update.error); } };
    const runDirectory = path.join(data, 'runs', 'labels'); await mkdir(runDirectory, { recursive: true });
    const input: StartRunInput = { runId: 'labels', mode: 'review', task: 'review', cwd: source, workerWorkspace: source, runDirectory, limits: { timeoutSeconds: 60, maxTurns: 3, maxEventBytes: 1_048_576, maxTranscriptBytes: 1_048_576, maxArtifactBytes: 8_388_608 } };
    await expect(backend.start(input, callbacks)).rejects.toBeDefined();
    await waitFor(async () => reported.length, (value) => value > 0, 3000);
    expect(reported[0]).toMatchObject({ code, ...(code === 'VSUP_RATE_LIMITED' ? { retryable: true } : {}) });
  }, 30_000);
});
