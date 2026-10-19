import { execFileSync } from 'node:child_process';
import { appendFile, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AntigravityBackend,
  antigravityChildEnvironment,
  classifyStreamEntry,
  resolveAntigravityExecutable,
  type AntigravityBackendOptions,
  type AntigravityHandle
} from '../../src/backends/antigravity.js';
import { evaluateAntigravityToolCall, writeAntigravityPreToolHook } from '../../src/backends/antigravity-hook.js';
import * as managedModule from '../../src/process/managed.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { BackendCallbacks, StartRunInput, SupervisorError } from '../../src/contracts.js';
import { preparationIdentity } from '../../src/preparation/evidence.js';
import { resolveExecutableFile } from '../../src/security/executable.js';
import { APP_VERSION } from '../../src/version.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

const passedPreparation: AntigravityBackendOptions = {
  preparation: {
    check: async () => ({ status: 'passed', candidate_sha256: 'a'.repeat(64), version: APP_VERSION, reason: 'test' })
  }
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-agy-fixes-'));
  roots.push(root);
  return root;
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function waitFor<T>(read: () => T, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = read();
  }
  return value;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function runInput(root: string, workspace: string, overrides: Partial<StartRunInput['limits']> = {}): StartRunInput {
  return {
    runId: '12345678-1234-4234-8234-123456789abc',
    mode: 'review',
    task: 'Review fixes',
    cwd: workspace,
    workerWorkspace: workspace,
    runDirectory: path.join(root, 'run'),
    exclusions: [],
    limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240, ...overrides }
  };
}

interface Recorded {
  events: Array<Parameters<BackendCallbacks['onEvent']>[0]>;
  states: Array<{ state: string; error?: SupervisorError; summary?: string }>;
  callbacks: BackendCallbacks;
}

function recorder(): Recorded {
  const events: Recorded['events'] = [];
  const states: Recorded['states'] = [];
  return {
    events,
    states,
    callbacks: {
      onEvent(event) { events.push(event); },
      onState(state, update) {
        states.push({ state, ...(update?.error ? { error: update.error } : {}), ...(update?.result?.summary ? { summary: update.result.summary } : {}) });
      }
    }
  };
}

const terminalStates = new Set(['completed', 'failed', 'cancelled']);

function terminal(recorded: Recorded): Recorded['states'][number] | undefined {
  return recorded.states.find((entry) => terminalStates.has(entry.state));
}

const VERSION_PREAMBLE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('1.4.0'); process.exit(0); }
`;

describe('Antigravity hook path arguments (F1)', () => {
  it('denies every unreadable or unknown path argument identically in the TypeScript twin and the embedded hook', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const home = path.join(root, 'home');
    await mkdir(path.join(workspace, 'clean'), { recursive: true });
    await writeFile(path.join(workspace, 'sample.ts'), 'export const a = 1;\n');
    await writeFile(path.join(workspace, 'clean', 'file.txt'), 'hello\n');
    await writeAntigravityPreToolHook(home, { mode: 'edit', workerWorkspace: workspace, excludedAnchors: [] });
    const hookScript = path.join(home, '.gemini', 'antigravity-cli', 'pre-tool-hook.mjs');
    const sample = path.join(workspace, 'sample.ts');

    const cases: Array<{ name: string; tool: string; args: unknown; decision: 'allow' | 'deny'; reason?: string }> = [
      { name: 'directory tool without a path', tool: 'list_dir', args: {}, decision: 'deny', reason: 'missing_file_path' },
      { name: 'directory tool without args', tool: 'list_dir', args: undefined, decision: 'deny', reason: 'missing_file_path' },
      { name: 'path as an array', tool: 'list_dir', args: { DirectoryPath: [workspace, '/etc'] }, decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'unlisted case variant', tool: 'list_dir', args: { directorypath: '/etc' }, decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'key of another tool', tool: 'list_dir', args: { TargetFile: '/etc/passwd' }, decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'numeric path', tool: 'view_file', args: { AbsolutePath: 42 }, decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'empty path', tool: 'view_file', args: { AbsolutePath: '  ' }, decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'extra unknown path argument', tool: 'view_file', args: { AbsolutePath: sample, OtherFile: '/etc/passwd' }, decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'args as an array', tool: 'view_file', args: [sample], decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'args as invalid JSON text', tool: 'list_dir', args: '{not json', decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'args as oversized JSON text', tool: 'view_file', args: JSON.stringify({ AbsolutePath: sample, pad: 'x'.repeat(1_100_000) }), decision: 'deny', reason: 'path_argument_unreadable' },
      { name: 'args as JSON text inside the workspace', tool: 'view_file', args: JSON.stringify({ AbsolutePath: sample }), decision: 'allow' },
      { name: 'args as JSON text outside the workspace', tool: 'view_file', args: JSON.stringify({ AbsolutePath: '/etc/hosts' }), decision: 'deny', reason: 'path_outside_workspace' },
      { name: 'boolean flag beside a valid path', tool: 'write_to_file', args: { TargetFile: sample, EmptyFile: false, CodeContent: 'x' }, decision: 'allow' },
      { name: 'shallow listing of a clean subdirectory', tool: 'list_dir', args: { DirectoryPath: path.join(workspace, 'clean') }, decision: 'allow' }
    ];

    for (const testCase of cases) {
      const payload = { toolCall: { name: testCase.tool, ...(testCase.args === undefined ? {} : { args: testCase.args }) }, stepIdx: 1 };
      const twin = await evaluateAntigravityToolCall({ mode: 'edit', workerWorkspace: workspace, excludedAnchors: [] }, payload);
      const hookOutput = execFileSync(process.execPath, [hookScript], { input: JSON.stringify(payload), encoding: 'utf8' });
      const hook = JSON.parse(hookOutput.trim()) as { decision: string; reason?: string };
      expect({ name: testCase.name, decision: twin.decision, reason: twin.reason ?? undefined }).toEqual({ name: testCase.name, decision: testCase.decision, reason: testCase.reason });
      expect({ name: testCase.name, ...hook }).toEqual({ name: testCase.name, decision: testCase.decision, ...(testCase.reason ? { reason: testCase.reason } : {}) });
    }
  });
});

describe('Antigravity visible-answer allowlist (F2)', () => {
  it('classifies only known visible shapes as text and withholds every other text-bearing entry', () => {
    expect(classifyStreamEntry({ event: 'step_update', step_update: { step_type: 'planner_response', content: 'visible' } })).toEqual({ text: 'visible', withheld: false });
    expect(classifyStreamEntry({ event: 'result', result: { status: 'SUCCESS', response: 'final' } })).toEqual({ text: 'final', withheld: false });
    expect(classifyStreamEntry({ event: 'agent_note', text: 'hidden note' })).toEqual({ text: '', withheld: true });
    expect(classifyStreamEntry({ event: 'step_update', step_update: { content: 'untyped step' } })).toEqual({ text: '', withheld: true });
    expect(classifyStreamEntry({ event: 'step_update', step_update: { step_type: 'internal_monologue', content: 'hmm' } })).toEqual({ text: '', withheld: true });
    expect(classifyStreamEntry('bare string')).toEqual({ text: '', withheld: true });
    expect(classifyStreamEntry({ event: 'step_update', step_update: { step_type: 'planner_response', content: [{ type: 'text', text: 'a' }, { type: 'thinking', thinking: 'b' }] } })).toEqual({ text: 'a', withheld: true });
    expect(classifyStreamEntry({ event: 'step_update', step_update: { step_type: 'view_file', tool_name: 'view_file', args: { AbsolutePath: '/w/a' } } })).toEqual({ text: '', withheld: false });
    expect(classifyStreamEntry({ event: 'init', init: { cwd: '/w' } })).toEqual({ text: '', withheld: false });
  });

  it('neither emits nor persists text from unknown event shapes and counts them in reasoning_observation', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const script = path.join(root, 'mock-agy');
    await writeExecutable(script, `${VERSION_PREAMBLE}
console.log(JSON.stringify({ event: 'agent_note', text: 'HIDDEN-NOTE' }));
console.log(JSON.stringify({ event: 'step_update', step_update: { step_index: 1, content: 'HIDDEN-UNTYPED' } }));
console.log('HIDDEN-PLAIN-LINE');
console.log(JSON.stringify({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'planner_response', content: 'visible answer' } }));
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'final answer' } }));
`);
    const backend = new AntigravityBackend({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } }, passedPreparation);
    const recorded = recorder();
    const started = await backend.start(runInput(root, workspace), recorded.callbacks);
    await (started.handle as AntigravityHandle).opaque.process.done;
    const final = await waitFor(() => terminal(recorded), Boolean);
    expect(final?.state).toBe('completed');
    const persisted = JSON.stringify({ events: recorded.events, states: recorded.states });
    expect(persisted).toContain('visible answer');
    expect(persisted).toContain('final answer');
    expect(persisted).not.toContain('HIDDEN');
    const observation = recorded.events.find((event) => event.data?.reason === 'reasoning_observation');
    expect(observation?.data).toMatchObject({ streamed_entries: 3, withheld_text_entries: 3 });
  });
});

describe('Antigravity child environment and redaction (F3, F4/F10)', () => {
  it('builds the agy environment from an explicit allowlist without home overrides or the Mistral key', () => {
    const env = antigravityChildEnvironment({
      PATH: '/bin', LANG: 'C', LC_ALL: 'C', HOME: '/real-home', TMPDIR: '/real-tmp',
      GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'k', ANTIGRAVITY_API_KEY: 'a',
      MISTRAL_API_KEY: 'm', ANTIGRAVITY_HOME: '/elsewhere', XDG_CONFIG_HOME: '/xdg', GEMINI_CLI_HOME: '/gh', UNRELATED: 'x'
    }, '/run/home', '/run/tmp');
    expect(env).toEqual({
      PATH: '/bin', LANG: 'C', LC_ALL: 'C', GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'k', ANTIGRAVITY_API_KEY: 'a',
      HOME: '/run/home', TMPDIR: '/run/tmp', AGY_CLI_OSC7501: 'off'
    });
  });

  it('spawns agy with only the allowlisted environment and redacts the forwarded Google key from stdout and stderr', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const envFile = path.join(root, 'agy-env.json');
    const script = path.join(root, 'mock-agy');
    await writeExecutable(script, `${VERSION_PREAMBLE}
fs.writeFileSync(${JSON.stringify(envFile)}, JSON.stringify(process.env));
process.stderr.write('auth failed for ' + process.env.GEMINI_API_KEY + '\\n');
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'echo ' + process.env.GEMINI_API_KEY } }));
`);
    const geminiValue = ['gem', 'sentinel', 'value', '7731'].join('-');
    const saved = { ...process.env };
    Object.assign(process.env, {
      GEMINI_API_KEY: geminiValue,
      MISTRAL_API_KEY: 'mistral-must-not-reach-agy',
      ANTIGRAVITY_HOME: path.join(root, 'redirected'),
      XDG_CONFIG_HOME: path.join(root, 'xdg'),
      UNRELATED_VARIABLE: 'x'
    });
    try {
      const backend = new AntigravityBackend({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } }, passedPreparation);
      const recorded = recorder();
      const started = await backend.start(runInput(root, workspace), recorded.callbacks);
      await (started.handle as AntigravityHandle).opaque.process.done;
      const final = await waitFor(() => terminal(recorded), Boolean);
      expect(final?.state).toBe('completed');

      const childEnv = JSON.parse(await readFile(envFile, 'utf8')) as Record<string, string>;
      const allowed = new Set(['PATH', 'LANG', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTIGRAVITY_API_KEY', 'HOME', 'TMPDIR', 'AGY_CLI_OSC7501', 'VIBE_SUPERVISOR_CHILD', '__CF_USER_TEXT_ENCODING']);
      expect(Object.keys(childEnv).filter((key) => !allowed.has(key) && !key.startsWith('LC_'))).toEqual([]);
      expect(childEnv.MISTRAL_API_KEY).toBeUndefined();
      expect(childEnv.ANTIGRAVITY_HOME).toBeUndefined();
      expect(childEnv.XDG_CONFIG_HOME).toBeUndefined();
      expect(childEnv.HOME).toBe(path.join(root, 'run', 'antigravity-home'));

      const persisted = JSON.stringify({ events: recorded.events, states: recorded.states });
      expect(persisted).not.toContain(geminiValue);
      expect(persisted).toContain('[REDACTED]');
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});

describe('Antigravity executable resolution (F8, F9)', () => {
  it('resolves one regular executable file for both the receipt identity and execution', async () => {
    const root = await makeRoot();
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    const third = path.join(root, 'third');
    await mkdir(first);
    await mkdir(second);
    await mkdir(path.join(third, 'agy-fixture'), { recursive: true });
    await writeFile(path.join(first, 'agy-fixture'), 'not executable\n', { mode: 0o644 });
    await writeExecutable(path.join(second, 'agy-fixture'), `${VERSION_PREAMBLE}`);
    const savedPath = process.env.PATH;
    process.env.PATH = [third, first, second, savedPath ?? ''].join(path.delimiter);
    try {
      expect(await resolveExecutableFile('agy-fixture')).toBe(path.join(second, 'agy-fixture'));
      const resolved = await resolveAntigravityExecutable('agy-fixture');
      expect(resolved.resolvedPath).toBe(path.join(second, 'agy-fixture'));
      const shadowed = await preparationIdentity({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: 'agy-fixture' } }, 'c'.repeat(64));
      process.env.PATH = [second, savedPath ?? ''].join(path.delimiter);
      expect(await preparationIdentity({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: 'agy-fixture' } }, 'c'.repeat(64))).toBe(shadowed);
      await expect(resolveExecutableFile(path.join(first, 'agy-fixture'))).rejects.toThrow();
      await expect(resolveExecutableFile(path.join(third, 'agy-fixture'))).rejects.toThrow(/regular file/);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it('re-hashes the executed binary immediately before spawn', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const marker = path.join(root, 'spawned');
    const script = path.join(root, 'mock-agy');
    await writeExecutable(script, `${VERSION_PREAMBLE}
fs.writeFileSync(${JSON.stringify(marker)}, 'spawned');
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'ran' } }));
`);
    const backend = new AntigravityBackend({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } }, {
      preparation: {
        check: async () => {
          await appendFile(script, '\n');
          return { status: 'passed', candidate_sha256: 'a'.repeat(64), version: APP_VERSION, reason: 'test' };
        }
      }
    });
    await expect(backend.start(runInput(root, workspace), recorder().callbacks)).rejects.toMatchObject({
      code: 'VSUP_ANTIGRAVITY_EXEC_FAILED',
      details: { reason: 'binary_digest_drift' }
    });
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('probes --version with a minimal environment and a throwaway home', async () => {
    const root = await makeRoot();
    const probeFile = path.join(root, 'probe.json');
    const script = path.join(root, 'mock-agy');
    await writeExecutable(script, `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(probeFile)}, JSON.stringify({ env: process.env, cwd: process.cwd() }));
console.log('1.4.0');
`);
    const saved = { ...process.env };
    Object.assign(process.env, { GEMINI_API_KEY: 'probe-gemini-value', MISTRAL_API_KEY: 'probe-mistral-value', ANTIGRAVITY_HOME: '/redirected' });
    try {
      const resolved = await resolveAntigravityExecutable(script);
      expect(resolved.version).toBe('1.4.0');
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
    const probe = JSON.parse(await readFile(probeFile, 'utf8')) as { env: Record<string, string>; cwd: string };
    expect(probe.env.GEMINI_API_KEY).toBeUndefined();
    expect(probe.env.MISTRAL_API_KEY).toBeUndefined();
    expect(probe.env.ANTIGRAVITY_HOME).toBeUndefined();
    expect(probe.env.PATH).toBe(process.env.PATH);
    expect(probe.env.HOME).not.toBe(process.env.HOME);
    expect(probe.env.HOME).toBe(probe.cwd);
    await expect(lstat(probe.env.HOME!)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('Antigravity process lifecycle (F14, F15)', () => {
  it('fails immediately with VSUP_OUTPUT_LIMIT when stderr overflows', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const script = path.join(root, 'mock-agy');
    await writeExecutable(script, `${VERSION_PREAMBLE}
process.stderr.write('e'.repeat(8192));
setTimeout(() => process.exit(0), 30000);
`);
    const backend = new AntigravityBackend({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } }, passedPreparation);
    const recorded = recorder();
    const startedAt = Date.now();
    await backend.start(runInput(root, workspace, { maxEventBytes: 1024 }), recorded.callbacks);
    const final = await waitFor(() => terminal(recorded), Boolean);
    expect(final?.state).toBe('failed');
    expect(final?.error).toMatchObject({ code: 'VSUP_OUTPUT_LIMIT', details: { stream: 'stderr' } });
    expect(Date.now() - startedAt).toBeLessThan(8000);
  });

  it('terminates leftover helpers in the process group after a natural exit before reporting', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const pidFile = path.join(root, 'helper.pid');
    const script = path.join(root, 'mock-agy');
    await writeExecutable(script, `${VERSION_PREAMBLE}
const { spawn } = require('node:child_process');
const helper = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
helper.unref();
fs.writeFileSync(${JSON.stringify(pidFile)}, String(helper.pid));
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'done' } }));
process.exit(0);
`);
    const backend = new AntigravityBackend({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } }, passedPreparation);
    const recorded = recorder();
    let helperAliveAtTerminal: boolean | undefined;
    const callbacks: BackendCallbacks = {
      onEvent: recorded.callbacks.onEvent,
      async onState(state, update) {
        if (terminalStates.has(state)) helperAliveAtTerminal = processAlive(Number(await readFile(pidFile, 'utf8')));
        await recorded.callbacks.onState(state, update);
      }
    };
    await backend.start(runInput(root, workspace), callbacks);
    const final = await waitFor(() => terminal(recorded), Boolean, 12_000);
    const helperPid = Number(await readFile(pidFile, 'utf8'));
    try {
      expect({ state: final?.state, error: final?.error?.message }).toEqual({ state: 'completed', error: undefined });
      expect(helperAliveAtTerminal).toBe(false);
    } finally {
      if (processAlive(helperPid)) process.kill(helperPid, 'SIGKILL');
    }
  });

  it('reports termination_unverified instead of a terminal success when the group cannot be verified gone', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const script = path.join(root, 'mock-agy');
    await writeExecutable(script, `${VERSION_PREAMBLE}
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'done' } }));
`);
    const original = managedModule.spawnManaged;
    vi.spyOn(managedModule, 'spawnManaged').mockImplementation((executablePath, args, options) => {
      const managed = original(executablePath, args, options);
      return Object.assign(Object.create(Object.getPrototypeOf(managed) as object) as typeof managed, managed, {
        terminate: async () => { throw new Error('Managed process termination is unverified: the owned process group may still be alive.'); }
      });
    });
    const backend = new AntigravityBackend({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } }, passedPreparation);
    const recorded = recorder();
    await backend.start(runInput(root, workspace), recorded.callbacks);
    const final = await waitFor(() => terminal(recorded), Boolean);
    expect(final?.state).toBe('failed');
    expect(final?.error).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'termination_unverified' } });
    expect(recorded.events.some((event) => event.data?.reason === 'termination_unverified')).toBe(true);
    expect(recorded.states.some((entry) => entry.state === 'completed')).toBe(false);
  });
});
