import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, StartRunInput, SupervisorEvent } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AcpBackend } from '../../src/backends/acp.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import { PROMPT_FILE_NAME, removePromptFile } from '../../src/backends/launcher.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';
import { ORIGINAL_HOME_ENV } from '../../src/security/environment.js';

const spawnFault = vi.hoisted(() => ({ armed: false }));
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
const roots: string[] = [];
const pidDirs: string[] = [];

const savedHome = process.env.HOME;

afterEach(async () => {
  spawnFault.armed = false;
  childScript.path = '';
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  for (const pidDir of pidDirs.splice(0)) {
    for (const name of await readdir(pidDir).catch(() => [] as string[])) {
      const pid = Number(name);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-backend-fixes-'));
  roots.push(root);
  return root;
}

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

class FixtureAcpBackend extends AcpBackend {
  readonly launchEnvs: NodeJS.ProcessEnv[] = [];
  pidDir: string | undefined;
  constructor(private readonly testMode: string, dataDir?: string, allowedWorkspaceRoots: string[] = []) {
    super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots, paths: { vibeAcp: 'fake-acp', ...(dataDir ? { dataDir } : {}) } }, dataDir);
  }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    this.launchEnvs.push({ ...profile.env });
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: this.testMode, ...(this.pidDir ? { FAKE_PID_DIR: this.pidDir } : {}) } };
  }
  override async probe() {
    return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
  probeProcess() { return this.runProbe(); }
}

function makeInput(root: string): StartRunInput {
  const runId = crypto.randomUUID();
  const workspace = path.join(root, 'workspace');
  const runDirectory = path.join(root, 'run', runId);
  return { runId, mode: 'review', task: 'Inspect the workspace', cwd: workspace, workerWorkspace: workspace, runDirectory, limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 1_000_000, maxTranscriptBytes: 1_000_000, maxArtifactBytes: 1_000_000 } };
}

async function prepared() {
  const root = await makeRoot();
  const input = makeInput(root);
  await mkdir(input.cwd, { recursive: true });
  await mkdir(input.runDirectory, { recursive: true });
  return { root, input };
}

function recordingCallbacks(log: string[]): BackendCallbacks & { texts: () => string[] } {
  const texts: string[] = [];
  return {
    onEvent: (event) => {
      if (event.type === 'message') {
        const text = String((event.data as { text?: string }).text ?? '');
        texts.push(text);
        log.push(`message:${text}`);
      }
    },
    onPendingRequest: () => undefined,
    onState: (state) => { log.push(`state:${state}`); },
    texts: () => texts
  };
}

const FIRST = 'first complete line\n';
const PARTIAL = 'partial line without newline';

describe('F4: the last partial line survives a cancel, close or crash mid-turn', () => {
  it('emits the buffered partial line before cancel returns, exactly once', async () => {
    const { input } = await prepared();
    const backend = new FixtureAcpBackend('partial-wait');
    const log: string[] = [];
    const callbacks = recordingCallbacks(log);
    const started = await backend.start(input, callbacks);
    await waitFor(() => callbacks.texts().join(''), (text) => text.includes('first complete line'));
    expect(callbacks.texts().join('')).toBe(FIRST);
    await backend.cancel(started.handle);
    expect(callbacks.texts().join('')).toBe(`${FIRST}${PARTIAL}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(callbacks.texts().filter((text) => text.includes(PARTIAL))).toHaveLength(1);
  });

  it('emits the buffered partial line before close returns, exactly once', async () => {
    const { input } = await prepared();
    const backend = new FixtureAcpBackend('partial-wait');
    const callbacks = recordingCallbacks([]);
    const started = await backend.start(input, callbacks);
    await waitFor(() => callbacks.texts().join(''), (text) => text.includes('first complete line'));
    await backend.close(started.handle);
    expect(callbacks.texts().join('')).toBe(`${FIRST}${PARTIAL}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(callbacks.texts().filter((text) => text.includes(PARTIAL))).toHaveLength(1);
  });

  it('emits the partial line before reporting a failure when the agent dies mid-turn', async () => {
    const { input } = await prepared();
    const backend = new FixtureAcpBackend('partial-crash');
    const log: string[] = [];
    const callbacks = recordingCallbacks(log);
    const started = await backend.start(input, callbacks);
    await waitFor(() => log, (entries) => entries.includes('state:failed'));
    await backend.close(started.handle);
    const tail = log.indexOf(`message:${PARTIAL}`);
    expect(tail).toBeGreaterThanOrEqual(0);
    expect(tail).toBeLessThan(log.indexOf('state:failed'));
    expect(log.filter((entry) => entry === `message:${PARTIAL}`)).toHaveLength(1);
  });

  it('emits an unterminated tail exactly once when the turn ends normally', async () => {
    const { input } = await prepared();
    const backend = new FixtureAcpBackend('chunked');
    const log: string[] = [];
    const callbacks = recordingCallbacks(log);
    const started = await backend.start(input, callbacks);
    await waitFor(() => log, (entries) => entries.includes('state:completed'));
    await backend.close(started.handle);
    expect(callbacks.texts().join('')).toBe('Hello world');
    expect(log.filter((entry) => entry === 'state:completed')).toHaveLength(1);
  });

  it('lands the partial line in transcript.md when RunManager cancels mid-line', async () => {
    const root = await makeRoot();
    const source = path.join(root, 'source');
    const data = path.join(root, 'data');
    await mkdir(source);
    const pidDir = path.join(root, 'pids');
    await mkdir(pidDir);
    pidDirs.push(pidDir);
    const backend = new FixtureAcpBackend('partial-wait', data, [source]);
    backend.pidDir = pidDir;
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 0 }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      const runDirectory = path.join(data, 'runs', started.run_id);
      await waitFor(() => readFile(path.join(runDirectory, 'events.ndjson'), 'utf8').catch(() => ''), (raw) => raw.includes('first complete line'));
      await manager.cancel({ run_id: started.run_id });
      const transcript = await readFile(path.join(runDirectory, 'transcript.md'), 'utf8');
      expect(transcript).toContain('first complete line');
      expect(transcript).toContain(PARTIAL);
      const events = (await readFile(path.join(runDirectory, 'events.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; data?: { text?: string } });
      expect(events.filter((event) => event.type === 'message' && event.data?.text?.includes(PARTIAL))).toHaveLength(1);
    } finally { await manager.shutdown(); }
  });
});

async function installFakeVibe(root: string, childBody: string) {
  const dir = path.join(root, 'fake-vibe');
  await mkdir(dir);
  const vibe = path.join(dir, 'vibe');
  await writeFile(vibe, [
    '#!/usr/bin/env python3',
    'import os',
    `open(${JSON.stringify(path.join(dir, 'probe-original-home'))}, "w").write(os.environ.get(${JSON.stringify(ORIGINAL_HOME_ENV)}, "unset"))`,
    'print("vibe 2.25.8")',
    ''
  ].join('\n'));
  await chmod(vibe, 0o755);
  const child = path.join(dir, 'child.mjs');
  await writeFile(child, [
    "import fs from 'node:fs';",
    `const dir = ${JSON.stringify(dir)};`,
    `fs.writeFileSync(dir + '/start-original-home', process.env[${JSON.stringify(ORIGINAL_HOME_ENV)}] ?? 'unset');`,
    "const promptFile = process.env.VIBE_SUPERVISOR_PROMPT_FILE;",
    childBody,
    ''
  ].join('\n'));
  childScript.path = child;
  return { dir, vibe };
}

function programmaticBackend(vibe: string) {
  return new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } });
}

function collecting(): BackendCallbacks & { events: Array<Pick<SupervisorEvent, 'type' | 'data'>>; states: string[] } {
  const events: Array<Pick<SupervisorEvent, 'type' | 'data'>> = [];
  const states: string[] = [];
  return {
    events, states,
    onEvent: (event) => { events.push({ type: event.type, data: event.data ?? {} }); },
    onPendingRequest: () => undefined,
    onState: (state) => { states.push(state); }
  };
}

const promptPath = (input: StartRunInput) => path.join(input.runDirectory, PROMPT_FILE_NAME);
const exists = (file: string) => lstat(file).then(() => true, () => false);

describe('F5: the task prompt file never outlives its launcher', () => {
  it('removes the prompt file when the child exits without consuming it', async () => {
    const { root, input } = await prepared();
    const { vibe } = await installFakeVibe(root, 'process.exit(1);');
    const callbacks = collecting();
    await programmaticBackend(vibe).start(input, callbacks);
    await waitFor(() => callbacks.states, (states) => states.includes('failed'));
    expect(callbacks.states).toContain('failed');
    expect(await exists(promptPath(input))).toBe(false);
  });

  it('removes the prompt file when spawning throws', async () => {
    const { root, input } = await prepared();
    const { vibe } = await installFakeVibe(root, 'process.exit(1);');
    const backend = programmaticBackend(vibe);
    await backend.probe();
    spawnFault.armed = true;
    await expect(backend.start(input, collecting())).rejects.toThrow('injected spawn failure');
    expect(await exists(promptPath(input))).toBe(false);
  });

  it('leaves no prompt file after a child that consumed it', async () => {
    const { root, input } = await prepared();
    const { vibe } = await installFakeVibe(root, 'fs.rmSync(promptFile); process.exit(0);');
    const callbacks = collecting();
    await programmaticBackend(vibe).start(input, callbacks);
    await waitFor(() => callbacks.states, (states) => states.includes('completed'));
    expect(callbacks.states).toContain('completed');
    expect(await exists(promptPath(input))).toBe(false);
    expect(callbacks.events.filter((event) => JSON.stringify(event.data).includes(PROMPT_FILE_NAME))).toEqual([]);
  });

  it('does not follow a symlink that replaced the prompt file and reports the refusal', async () => {
    const { root, input } = await prepared();
    const { dir, vibe } = await installFakeVibe(root, "fs.rmSync(promptFile); fs.symlinkSync(dir + '/outside.txt', promptFile); process.exit(1);");
    const outside = path.join(dir, 'outside.txt');
    await writeFile(outside, 'precious');
    const callbacks = collecting();
    await programmaticBackend(vibe).start(input, callbacks);
    await waitFor(() => callbacks.states, (states) => states.includes('failed'));
    expect(await readFile(outside, 'utf8')).toBe('precious');
    expect((await lstat(promptPath(input))).isSymbolicLink()).toBe(true);
    expect(callbacks.events.some((event) => event.type === 'diagnostic' && JSON.stringify(event.data).includes('prompt file'))).toBe(true);
  });

  it('removePromptFile removes only a regular file inside the run directory', async () => {
    const root = await makeRoot();
    const runDirectory = path.join(root, 'run');
    await mkdir(runDirectory);
    const target = path.join(runDirectory, PROMPT_FILE_NAME);
    expect(await removePromptFile(runDirectory)).toBe('absent');
    await writeFile(target, 'task');
    expect(await removePromptFile(runDirectory)).toBe('removed');
    expect(await exists(target)).toBe(false);
    await mkdir(target);
    expect(await removePromptFile(runDirectory)).toBe('refused');
    expect(await exists(target)).toBe(true);
    await rm(target, { recursive: true });
    const linkedRun = path.join(root, 'linked-run');
    await symlink(runDirectory, linkedRun);
    await writeFile(target, 'task');
    expect(await removePromptFile(linkedRun)).toBe('refused');
    expect(await exists(target)).toBe(true);
  });
});

describe('F6: probes never carry the original HOME to the launcher shim', () => {
  it('omits the original-HOME variable from the ACP probe launch and keeps it for start', async () => {
    const { root, input } = await prepared();
    const realHome = path.join(root, 'real-home');
    await mkdir(realHome);
    process.env.HOME = realHome;
    const backend = new FixtureAcpBackend('normal');
    const probed = await backend.probeProcess();
    expect(probed.available).toBe(true);
    expect(backend.launchEnvs).toHaveLength(1);
    expect(backend.launchEnvs[0]?.[ORIGINAL_HOME_ENV]).toBeUndefined();
    const started = await backend.start(input, recordingCallbacks([]));
    await backend.close(started.handle);
    expect(backend.launchEnvs).toHaveLength(2);
    expect(backend.launchEnvs[1]?.[ORIGINAL_HOME_ENV]).toBe(realHome);
  });

  it('omits the original-HOME variable from the programmatic probe and keeps it for start', async () => {
    const { root, input } = await prepared();
    const realHome = path.join(root, 'real-home');
    await mkdir(realHome);
    process.env.HOME = realHome;
    const { dir, vibe } = await installFakeVibe(root, 'process.exit(1);');
    const callbacks = collecting();
    const backend = programmaticBackend(vibe);
    expect((await backend.probe()).available).toBe(true);
    expect(await readFile(path.join(dir, 'probe-original-home'), 'utf8')).toBe('unset');
    await backend.start(input, callbacks);
    await waitFor(() => callbacks.states, (states) => states.includes('failed'));
    expect(await readFile(path.join(dir, 'start-original-home'), 'utf8')).toBe(realHome);
  });
});
