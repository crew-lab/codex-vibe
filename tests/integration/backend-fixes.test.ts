import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendCallbacks, StartRunInput, SupervisorEvent } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { PROMPT_FILE_NAME, removePromptFile } from '../../src/backends/launcher.js';
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

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

const savedHome = process.env.HOME;

afterEach(async () => {
  spawnFault.armed = false;
  childScript.path = '';
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
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

async function installFakeVibe(root: string, childBody: string) {
  const dir = path.join(root, 'fake-vibe');
  await mkdir(dir);
  const vibe = path.join(dir, 'vibe');
  await writeFile(vibe, [
    '#!/usr/bin/env python3',
    'import os',
    `open(${JSON.stringify(path.join(dir, 'probe-original-home'))}, "w").write(os.environ.get(${JSON.stringify(ORIGINAL_HOME_ENV)}, "unset"))`,
    'print("vibe 2.26.1")',
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
  return new ProgrammaticBackend({ ...DEFAULT_CONFIG, paths: { vibe } });
}

function collecting(): BackendCallbacks & { events: Array<Pick<SupervisorEvent, 'type' | 'data'>>; states: string[] } {
  const events: Array<Pick<SupervisorEvent, 'type' | 'data'>> = [];
  const states: string[] = [];
  return {
    events, states,
    onEvent: (event) => { events.push({ type: event.type, data: event.data ?? {} }); },
    onState: (state) => { states.push(state); }
  };
}

const promptPath = (input: StartRunInput) => path.join(input.runDirectory, PROMPT_FILE_NAME);
const exists = (file: string) => lstat(file).then(() => true, () => false);

describe('rate limits from the programmatic child', () => {
  it('maps an HTTP 429 on stderr to a retryable VSUP_RATE_LIMITED failure', async () => {
    const { root, input } = await prepared();
    const { vibe } = await installFakeVibe(root, "process.stderr.write('HTTP 429 Too Many Requests\\n'); process.exitCode = 1;");
    const errors: Array<{ code: string; retryable: boolean }> = [];
    const callbacks: BackendCallbacks = {
      onEvent: () => undefined,
      onState: (state, update) => { if (state === 'failed' && update?.error) errors.push(update.error); }
    };
    await programmaticBackend(vibe).start(input, callbacks);
    await waitFor(() => errors, (value) => value.length > 0);
    expect(errors[0]).toMatchObject({ code: 'VSUP_RATE_LIMITED', retryable: true });
  });

  it('reads a 401 with rate-limit headers as VSUP_AUTH_REQUIRED', async () => {
    const { root, input } = await prepared();
    const { vibe } = await installFakeVibe(root, "process.stderr.write('x-ratelimit-limit: 100\\nHTTP 401 Unauthorized\\n'); process.exitCode = 1;");
    const errors: Array<{ code: string; retryable: boolean }> = [];
    const callbacks: BackendCallbacks = { onEvent: () => undefined, onState: (state, update) => { if (state === 'failed' && update?.error) errors.push(update.error); } };
    await programmaticBackend(vibe).start(input, callbacks);
    await waitFor(() => errors, (value) => value.length > 0);
    expect(errors[0]).toMatchObject({ code: 'VSUP_AUTH_REQUIRED', retryable: false });
  });

  it('keeps a crash after an earlier retry log line as VSUP_BACKEND_CRASHED', async () => {
    const { root, input } = await prepared();
    const lines = ['retrying after rate limit (HTTP 429)', ...Array.from({ length: 8 }, (_, index) => `step ${index} ok`), 'Traceback: boom'];
    const { vibe } = await installFakeVibe(root, `process.stderr.write(${JSON.stringify(lines.join('\n') + '\n')}); process.exitCode = 1;`);
    const errors: Array<{ code: string; retryable: boolean }> = [];
    const callbacks: BackendCallbacks = { onEvent: () => undefined, onState: (state, update) => { if (state === 'failed' && update?.error) errors.push(update.error); } };
    await programmaticBackend(vibe).start(input, callbacks);
    await waitFor(() => errors, (value) => value.length > 0);
    expect(errors[0]).toMatchObject({ code: 'VSUP_BACKEND_CRASHED', retryable: false });
  });

  it('keeps an unrelated non-zero exit as VSUP_BACKEND_CRASHED', async () => {
    const { root, input } = await prepared();
    const { vibe } = await installFakeVibe(root, "process.stderr.write('processed 4290 files\\n'); process.exitCode = 1;");
    const errors: Array<{ code: string; retryable: boolean }> = [];
    const callbacks: BackendCallbacks = {
      onEvent: () => undefined,
      onState: (state, update) => { if (state === 'failed' && update?.error) errors.push(update.error); }
    };
    await programmaticBackend(vibe).start(input, callbacks);
    await waitFor(() => errors, (value) => value.length > 0);
    expect(errors[0]).toMatchObject({ code: 'VSUP_BACKEND_CRASHED', retryable: false });
  });
});

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

describe('programmatic output limits', () => {
  it('fails the run when stderr exceeds the event limit instead of leaving it running', async () => {
    const { root, input } = await prepared();
    const { vibe } = await installFakeVibe(root, "process.stderr.write('x'.repeat(200000)); setTimeout(() => {}, 30000);");
    const limited = { ...input, limits: { ...input.limits, maxEventBytes: 1024 } };
    const errors: Array<{ code: string }> = [];
    const callbacks: BackendCallbacks = {
      onEvent: () => undefined,
      onState: (state, update) => { if (state === 'failed' && update?.error) errors.push(update.error); }
    };
    await programmaticBackend(vibe).start(limited, callbacks);
    await waitFor(() => errors, (value) => value.length > 0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'VSUP_OUTPUT_LIMIT' });
  });
});
