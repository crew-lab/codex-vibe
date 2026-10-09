import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, BackendCapabilities, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend, SupervisorConfig } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AcpBackend } from '../../src/backends/acp.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';

const childScript = vi.hoisted(() => ({ path: '' }));
const spawnFault = vi.hoisted(() => ({ armed: false }));

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

vi.mock('../../src/process/managed.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/process/managed.js')>();
  return {
    ...original,
    spawnManaged: (...args: Parameters<typeof original.spawnManaged>) => {
      if (spawnFault.armed) { spawnFault.armed = false; throw new Error('injected spawn failure'); }
      return original.spawnManaged(...args);
    }
  };
});

const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const SECRET = 'sk-abcdef1234567890xyz';
const roots: string[] = [];
const pidDirs: string[] = [];

afterEach(async () => {
  spawnFault.armed = false; childScript.path = '';
  for (const pidDir of pidDirs.splice(0)) {
    for (const name of await readdir(pidDir).catch(() => [] as string[])) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeParent() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-failure-')); roots.push(parent);
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
const settled = (state: unknown) => ['completed', 'failed', 'cancelled', 'recoverable'].includes(String(state));
const available = (backend: 'acp' | 'programmatic'): BackendCapabilities => ({ available: true, backend, supportsContinue: true, supportsPermissionResponse: true });

class ScriptedBackend implements SupervisorBackend {
  callbacks = new Map<string, BackendCallbacks>();
  probeResult: BackendCapabilities;
  startError: Error | undefined;
  probeCalls = 0;
  constructor(readonly kind: 'acp' | 'programmatic', probeResult?: BackendCapabilities) { this.probeResult = probeResult ?? available(kind); }
  async probe() { this.probeCalls += 1; return this.probeResult; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    if (this.startError) throw this.startError;
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(_handle: BackendRunHandle) {}
  async close() {}
  async recover(_record: RunRecord) { return undefined; }
}

function managerFor(source: string, data: string, backends: SupervisorBackend[], overrides: Partial<SupervisorConfig> = {}) {
  return new RunManager({ ...DEFAULT_CONFIG, backend: 'programmatic', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600, ...overrides }, data, backends);
}

async function failedRun(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: 'review', cwd: source });
  return waitFor(() => manager.status({ run_id: started.run_id }), (value) => settled(value.state)).then((status) => ({ id: started.run_id, status }));
}

class FakeAcpBackend extends AcpBackend {
  pidDir: string | undefined;
  constructor(private readonly testMode: string, dataDir: string, allowedWorkspaceRoots: string[]) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots, paths: { vibeAcp: 'fake-acp', dataDir } }, dataDir);
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: this.testMode, ...(this.pidDir ? { FAKE_PID_DIR: this.pidDir } : {}) } };
  }
  override async probe() { return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true }; }
}

class FixtureAcp extends AcpBackend {
  pidDir = '';
  constructor(private readonly testMode: string, private readonly script: string, dataDir?: string) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', paths: { vibeAcp: script, ...(dataDir ? { dataDir } : {}) } }, dataDir);
  }
  protected override executable(): string { return this.script; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: this.testMode, ...(this.pidDir ? { FAKE_PID_DIR: this.pidDir } : {}) } };
  }
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function installFakeVibe(root: string, childBody: string, version = '2.25.8') {
  const dir = path.join(root, 'fake-vibe');
  await mkdir(dir);
  const vibe = path.join(dir, 'vibe');
  await writeExecutable(vibe, ['#!/usr/bin/env python3', `open(${JSON.stringify(path.join(dir, 'probe-count'))}, "a").write("x\\n")`, `print("vibe ${version}")`, ''].join('\n'));
  const child = path.join(dir, 'child.mjs');
  await writeFile(child, [childBody, ''].join('\n'));
  childScript.path = child;
  return { dir, vibe, probeCount: async () => (await readFile(path.join(dir, 'probe-count'), 'utf8').catch(() => '')).split('\n').filter(Boolean).length };
}

function startInput(root: string): StartRunInput {
  const runId = crypto.randomUUID();
  const workspace = path.join(root, 'workspace'); const runDirectory = path.join(root, 'run', runId);
  return { runId, mode: 'review', task: 'Inspect', cwd: workspace, workerWorkspace: workspace, runDirectory, limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 1_000_000, maxTranscriptBytes: 1_000_000, maxArtifactBytes: 1_000_000 } };
}

const noCallbacks: BackendCallbacks = { onEvent: () => undefined, onPendingRequest: () => undefined, onState: () => undefined };

describe('ACP exit before the prompt response', () => {
  it('fails a run whose ACP process exits 0 mid-turn with VSUP_BACKEND_CRASHED', async () => {
    const { source, data, pidDir } = await makeParent();
    const backend = new FakeAcpBackend('exit-zero-mid-turn', data, [source]); backend.pidDir = pidDir;
    const manager = managerFor(source, data, [backend], { backend: 'acp' });
    try {
      const { status, id } = await failedRun(manager, source);
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_BACKEND_CRASHED', message: expect.stringMatching(/before the turn finished/) });
      expect((await manager.result({ run_id: id })).state).toBe('failed');
      expect(await waitFor(async () => activeSlots(manager), (value) => value === 0)).toBe(0);
    } finally { await manager.shutdown(); }
  });

  it('never reports completed to the backend callbacks when the process exits 0 mid-turn', async () => {
    const { parent, pidDir } = await makeParent();
    const script = path.join(parent, 'vibe-acp'); await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const backend = new FixtureAcp('exit-zero-mid-turn', script); backend.pidDir = pidDir;
    const input = startInput(parent);
    await mkdir(input.cwd, { recursive: true }); await mkdir(input.runDirectory, { recursive: true });
    const states: Array<{ state: string; error?: { code?: string } }> = [];
    await backend.start(input, { ...noCallbacks, onState: (state, update) => { states.push({ state, ...(update?.error ? { error: update.error } : {}) }); } });
    await waitFor(async () => states, (value) => value.some((entry) => entry.state === 'failed'));
    expect(states.map((entry) => entry.state)).not.toContain('completed');
    expect(states.find((entry) => entry.state === 'failed')?.error?.code).toBe('VSUP_BACKEND_CRASHED');
  });

  it('applies the same rule to a recovered session', async () => {
    const { source, data, pidDir } = await makeParent();
    const config = { backend: 'acp' as const, workerIdleTtlSeconds: 600 };
    const firstBackend = new FakeAcpBackend('normal', data, [source]); firstBackend.pidDir = pidDir;
    const first = managerFor(source, data, [firstBackend], config);
    const started = await first.reviewStart({ task: 'review', cwd: source });
    await waitFor(() => first.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
    await first.shutdown();
    const metaPath = path.join(data, 'runs', started.run_id, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    meta.state = 'running'; delete meta.finished_at; delete meta.result;
    await writeFile(metaPath, JSON.stringify(meta));
    const secondBackend = new FakeAcpBackend('exit-zero-mid-turn', data, [source]); secondBackend.pidDir = pidDir;
    const second = managerFor(source, data, [secondBackend], config);
    try {
      await second.initialize();
      await second.continue({ run_id: started.run_id, message: 'again' });
      const status = await waitFor(() => second.status({ run_id: started.run_id }), (value) => value.state === 'completed' || value.state === 'failed');
      expect(status.state).toBe('failed');
      expect(status.error).toMatchObject({ code: 'VSUP_BACKEND_CRASHED', message: expect.stringMatching(/before the turn finished/) });
    } finally { await second.shutdown(); }
  }, 30_000);
});

describe('an empty final message', () => {
  it('treats an empty or blank summary like a missing one when finalizing', async () => {
    for (const summary of ['', '   \n']) {
      const { source, data } = await makeParent();
      const backend = new ScriptedBackend('programmatic');
      const manager = managerFor(source, data, [backend], { backend: 'programmatic' });
      try {
        const started = await manager.reviewStart({ task: 'review', cwd: source });
        await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
        await backend.callbacks.get(started.run_id)?.onState('completed', { result: { stopReason: 'end_turn', summary } });
        const result = await manager.result({ run_id: started.run_id });
        expect(result.summary).toBe('Vibe completed the delegated task.');
      } finally { await manager.shutdown(); }
    }
  });

  it('adds the no-final-message warning when the programmatic Vibe produced nothing', async () => {
    const { parent, source, data } = await makeParent();
    const { vibe } = await installFakeVibe(parent, 'process.exit(0);');
    const manager = managerFor(source, data, [new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } })], { backend: 'programmatic' });
    try {
      const { status, id } = await failedRun(manager, source);
      expect(status.state).toBe('completed');
      const result = await manager.result({ run_id: id });
      expect(result).toMatchObject({ stop_reason: 'end_turn', warnings: ['Vibe produced no final message.'], summary: 'Vibe completed the delegated task.' });
    } finally { await manager.shutdown(); }
  });

  it('adds no warning when the programmatic Vibe produced a message', async () => {
    const { parent, source, data } = await makeParent();
    const { vibe } = await installFakeVibe(parent, "console.log(JSON.stringify({ role: 'assistant', text: 'All good.' })); process.exit(0);");
    const manager = managerFor(source, data, [new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } })], { backend: 'programmatic' });
    try {
      const { status, id } = await failedRun(manager, source);
      expect(status.state).toBe('completed');
      expect(await manager.result({ run_id: id })).toMatchObject({ summary: expect.stringContaining('All good.'), warnings: [] });
    } finally { await manager.shutdown(); }
  });
});

describe('programmatic turn-limit exits', () => {
  const turnLimitMarker = (turns: number) => `<vibe_stop_event>Turn limit of ${turns} reached</vibe_stop_event>`;
  const marker = turnLimitMarker(DEFAULT_CONFIG.limits.maxTurnsReview);
  const otherMarker = turnLimitMarker(DEFAULT_CONFIG.limits.maxTurnsReview + 1);
  const cases = [
    { name: 'matching pinned markers, including an unterminated last streaming line', code: 1, stdout: marker, stderr: marker, capped: true },
    { name: 'a marker mentioned only by the assistant', code: 1, stdout: marker, stderr: 'boom', capped: false },
    { name: 'a marker on stderr without a streamed assistant marker', code: 1, stdout: 'Partial findings.', stderr: marker, capped: false },
    { name: 'a marker for a different configured turn limit', code: 1, stdout: otherMarker, stderr: otherMarker, capped: false },
    { name: 'a genuine crash after a matching marker', code: 2, stdout: marker, stderr: marker, capped: false },
    { name: 'an additional error after the marker', code: 1, stdout: marker, stderr: `${marker}\nError: 401 Unauthorized`, capped: false },
    { name: 'a marker in ordinary successful assistant output', code: 0, stdout: marker, stderr: marker, capped: false },
  ];
  it.each(cases)('$name', async (test) => {
    const { parent, source, data } = await makeParent();
    const entry = JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'text', text: test.stdout }] });
    const body = `process.stdout.write(${JSON.stringify(entry.slice(0, 17))}); setTimeout(() => { process.stdout.write(${JSON.stringify(entry.slice(17))}); process.stderr.write(${JSON.stringify(test.stderr + '\n')}); process.exitCode = ${test.code}; }, 20);`;
    const { vibe } = await installFakeVibe(parent, body);
    const manager = managerFor(source, data, [new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } })], { backend: 'programmatic' });
    try {
      const { id, status } = await failedRun(manager, source);
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

describe('backend selection errors', () => {
  it('puts detected_version in the real programmatic probe', async () => {
    const { parent } = await makeParent();
    const { vibe } = await installFakeVibe(parent, 'process.exit(0);', '2.26.0');
    const backend = new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } });
    expect((await backend.probe()).details).toMatchObject({ detected_version: '2.26.0' });
  });

  it('flags a missing programmatic executable in the real probe', async () => {
    const { parent, source, data } = await makeParent();
    const backend = new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe: path.join(parent, 'nowhere', 'vibe') } });
    expect((await backend.probe()).details).toMatchObject({ executable_missing: true });
    const manager = managerFor(source, data, [backend], { backend: 'programmatic' });
    try { expect((await failedRun(manager, source)).status.error).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND' }); }
    finally { await manager.shutdown(); }
  });

  it('puts detected_version in the real ACP probe and flags a missing ACP executable', async () => {
    const { parent, source, data } = await makeParent();
    const script = path.join(parent, 'vibe-acp'); await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const wrong = new FixtureAcp('wrong-version', script);
    expect((await wrong.probe()).details).toMatchObject({ detected_version: '2.26.0' });
    const missing = new AcpBackend({ ...DEFAULT_CONFIG, backend: 'acp', paths: { vibeAcp: path.join(parent, 'nowhere', 'vibe-acp') } });
    expect((await missing.probe()).details).toMatchObject({ executable_missing: true });
    const manager = managerFor(source, data, [missing], { backend: 'acp' });
    try { expect((await failedRun(manager, source)).status.error).toMatchObject({ code: 'VSUP_VIBE_ACP_NOT_FOUND' }); }
    finally { await manager.shutdown(); }
  });
});

describe('explicit backends skip the availability probe', () => {
  const running = async (manager: RunManager, source: string) => {
    const started = await manager.reviewStart({ task: 'review', cwd: source });
    return waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
  };
  const versionStderr = "process.stderr.write('Vibe privacy shim supports exactly 2.25.8; found 2.26.0\\n'); process.exit(1);";

  it('starts an explicit ACP backend with a single spawn and continues without another', async () => {
    const { parent, source, data, pidDir } = await makeParent();
    const script = path.join(parent, 'vibe-acp'); await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const backend = new FixtureAcp('normal', script, data); backend.pidDir = pidDir;
    const manager = managerFor(source, data, [backend], { backend: 'acp' });
    try {
      const { id, status } = await failedRun(manager, source);
      expect(status.state).toBe('completed');
      expect((await readdir(pidDir)).length).toBe(1);
      await waitFor(async () => activeSlots(manager), (value) => value === 0);
      await manager.continue({ run_id: id, message: 'again' });
      await waitFor(() => manager.status({ run_id: id }), (value) => value.state === 'completed' && JSON.stringify(value).includes('reply-2'));
      expect((await readdir(pidDir)).length).toBe(1);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('does not run vibe --version before an explicit programmatic start', async () => {
    const { parent, source, data } = await makeParent();
    const { vibe, probeCount } = await installFakeVibe(parent, 'process.exit(0);');
    const manager = managerFor(source, data, [new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } })], { backend: 'programmatic' });
    try {
      expect((await failedRun(manager, source)).status.state).toBe('completed');
      expect(await probeCount()).toBe(0);
    } finally { await manager.shutdown(); }
  });

  it('does not probe either backend when the config names one', async () => {
    const { source, data } = await makeParent();
    const acp = new ScriptedBackend('acp'); const programmatic = new ScriptedBackend('programmatic');
    const manager = managerFor(source, data, [acp, programmatic], { backend: 'programmatic' });
    try {
      await running(manager, source);
      expect([acp.probeCalls, programmatic.probeCalls]).toEqual([0, 0]);
    } finally { await manager.shutdown(); }
  });

  it('reports a wrong ACP version from the real initialize with both versions and a single spawn', async () => {
    const { parent, source, data, pidDir } = await makeParent();
    const script = path.join(parent, 'vibe-acp'); await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const backend = new FixtureAcp('wrong-version', script, data); backend.pidDir = pidDir;
    const manager = managerFor(source, data, [backend], { backend: 'acp' });
    try {
      const { status } = await failedRun(manager, source);
      expect(status.error).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', message: expect.stringMatching(/2\.26\.0.*2\.25\.8/) });
      expect((await readdir(pidDir)).length).toBe(1);
    } finally { await manager.shutdown(); }
  });

  it('maps the shim version message on stderr to the unsupported-version code for ACP', async () => {
    const { parent, source, data } = await makeParent();
    const child = path.join(parent, 'shim-child.mjs'); await writeFile(child, `${versionStderr}\n`);
    childScript.path = child;
    const script = path.join(parent, 'vibe-acp'); await writeExecutable(script, '#!/usr/bin/env python3\n');
    const manager = managerFor(source, data, [new AcpBackend({ ...DEFAULT_CONFIG, backend: 'acp', paths: { vibeAcp: script, dataDir: data } }, data)], { backend: 'acp' });
    try { expect((await failedRun(manager, source)).status.error).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', message: expect.stringMatching(/2\.26\.0.*2\.25\.8/) }); }
    finally { await manager.shutdown(); }
  });

  it('maps the shim version message on stderr to the unsupported-version code for programmatic', async () => {
    const { parent, source, data } = await makeParent();
    const { vibe } = await installFakeVibe(parent, versionStderr);
    const manager = managerFor(source, data, [new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } })], { backend: 'programmatic' });
    try { expect((await failedRun(manager, source)).status.error).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', message: expect.stringMatching(/2\.26\.0.*2\.25\.8/) }); }
    finally { await manager.shutdown(); }
  });

  it('keeps other early programmatic failures as a crash', async () => {
    const { parent, source, data } = await makeParent();
    const { vibe } = await installFakeVibe(parent, "process.stderr.write('boom\\n'); process.exit(3);");
    const manager = managerFor(source, data, [new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } })], { backend: 'programmatic' });
    try { expect((await failedRun(manager, source)).status.error).toMatchObject({ code: 'VSUP_BACKEND_CRASHED' }); }
    finally { await manager.shutdown(); }
  });
});

describe('launch failure diagnostics', () => {
  it('appends a redacted diagnostic event before the run settles as failed', async () => {
    const { source, data } = await makeParent();
    const backend = new ScriptedBackend('programmatic');
    backend.startError = Object.assign(new Error(`could not start with ${SECRET}`), { code: 'VSUP_BACKEND_UNAVAILABLE' });
    const manager = managerFor(source, data, [backend], { backend: 'programmatic' });
    try {
      const { status, id } = await failedRun(manager, source);
      expect(status.state).toBe('failed');
      const events = (await readFile(path.join(data, 'runs', id, 'events.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; source: string; data: Record<string, unknown> });
      const diagnostics = events.filter((event) => event.type === 'diagnostic' && event.source === 'supervisor');
      expect(diagnostics).toHaveLength(1);
      expect(String(diagnostics[0]?.data.message)).toContain('VSUP_BACKEND_UNAVAILABLE');
      expect(JSON.stringify(events)).not.toContain(SECRET);
      const text = (await manager.status({ run_id: id })).events as Array<{ type: string; text?: string }>;
      expect(text.find((event) => event.type === 'diagnostic')?.text).toContain('VSUP_BACKEND_UNAVAILABLE');
    } finally { await manager.shutdown(); }
  });
});

describe('vibe_status event text', () => {
  async function running() {
    const { source, data } = await makeParent();
    const backend = new ScriptedBackend('programmatic');
    const manager = managerFor(source, data, [backend], { backend: 'programmatic' });
    const started = await manager.reviewStart({ task: 'review', cwd: source });
    await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === 'running');
    return { source, manager, backend, id: started.run_id, callbacks: backend.callbacks.get(started.run_id)! };
  }

  it('shows capped text for supervisor diagnostics and keeps other event data stripped', async () => {
    const { manager, callbacks, id } = await running();
    try {
      await callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text: `stderr line ${'x'.repeat(900)}` } });
      await callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { message: 'a message', reason: 'a_reason' } });
      await callbacks.onEvent({ source: 'supervisor', type: 'permission_denied_by_policy', severity: 'warning', data: { request_id: 'r1', reason: 'Shell is disabled' } });
      await callbacks.onEvent({ source: 'supervisor', type: 'timeout', severity: 'warning', data: { timeout_seconds: 5 } });
      await callbacks.onEvent({ source: 'vibe', type: 'diagnostic', severity: 'info', data: { text: 'from vibe, not the supervisor' } });
      await callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'assistant words' } });
      await callbacks.onEvent({ source: 'acp', type: 'tool_call', severity: 'info', data: { title: 'Read file', kind: 'read', status: 'pending', rawInput: { path: '/secret/path' }, text: 'tool text' } });
      const events = (await manager.status({ run_id: id })).events as Array<Record<string, unknown>>;
      const byType = (type: string) => events.filter((event) => event.type === type);
      const [long, short, vibeDiagnostic] = byType('diagnostic');
      expect(String(long?.text)).toHaveLength(400);
      expect(String(long?.text).startsWith('stderr line')).toBe(true);
      expect(short?.text).toBe('a message');
      expect(byType('permission_denied_by_policy')[0]?.text).toBe('Shell is disabled');
      expect(byType('timeout')[0]).toEqual({ seq: expect.any(Number), type: 'timeout' });
      expect(vibeDiagnostic).toEqual({ seq: 5, type: 'diagnostic' });
      expect(byType('message')[0]).toEqual({ seq: expect.any(Number), type: 'message' });
      expect(byType('tool_call')[0]).toEqual({ seq: expect.any(Number), type: 'tool_call', title: 'Read file', kind: 'read', status: 'pending' });
      expect(JSON.stringify(events)).not.toContain('/secret/path');
      expect(JSON.stringify(events)).not.toContain('assistant words');
    } finally { await manager.shutdown(); }
  });

  it('shows the review integrity explanation', async () => {
    const { source, manager, callbacks, id } = await running();
    try {
      await writeFile(path.join(source, 'late.txt'), 'late\n');
      await callbacks.onState('completed', { result: { summary: 'done' } });
      const events = (await manager.status({ run_id: id })).events as Array<{ type: string; text?: string }>;
      expect(events.find((event) => event.type === 'review_integrity')?.text).toMatch(/changed/);
    } finally { await manager.shutdown(); }
  });
});

  it('spawns nothing but the session for runs that start fine', async () => {
    const { parent, pidDir } = await makeParent();
    const script = path.join(parent, 'vibe-acp'); await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const backend = new FixtureAcp('soak', script); backend.pidDir = pidDir;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const input = startInput(parent);
      await mkdir(input.cwd, { recursive: true }); await mkdir(input.runDirectory, { recursive: true });
      const started = await backend.start(input, noCallbacks);
      await backend.close(started.handle);
    }
    expect((await readdir(pidDir)).length).toBe(2);
  });

describe('probe stderr', () => {
  it('captures a redacted stderr tail when the ACP probe fails', async () => {
    const { parent } = await makeParent();
    const script = path.join(parent, 'vibe-acp'); await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const capabilities = await new FixtureAcp('init-stderr', script).probe();
    expect(capabilities.available).toBe(false);
    const tail = String(capabilities.details?.stderr_tail);
    expect(tail).toContain('cannot start');
    expect(tail).not.toContain(SECRET);
    expect(tail.length).toBeLessThanOrEqual(1024);
  });

  it('adds no stderr tail to a successful probe', async () => {
    const { parent } = await makeParent();
    const script = path.join(parent, 'vibe-acp'); await writeExecutable(script, '#!/bin/sh\nexit 0\n');
    const capabilities = await new FixtureAcp('normal', script).probe();
    expect(capabilities.available).toBe(true);
    expect(capabilities.details?.stderr_tail).toBeUndefined();
  });
});
