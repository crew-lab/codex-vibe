import { mkdtemp, mkdir, realpath, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AppServerBackend } from '../../src/backends/app-server.js';
import { validateConfig } from '../../src/config/validation.js';
import { spawnManaged } from '../../src/process/managed.js';
import type { BackendRunHandle, StartRunInput, RunState } from '../../src/contracts.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture(scenario = 'normal') {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-app-server-'))); directories.push(root);
  const workspace = path.join(root, 'workspace'); const runDirectory = path.join(root, 'run');
  await Promise.all([mkdir(workspace), mkdir(runDirectory)]);
  await writeFile(path.join(workspace, 'file.txt'), 'fixture'); await writeFile(path.join(workspace, '.env'), 'private-canary');
  const input: StartRunInput = { runId: '00000000-0000-4000-8000-000000000001', mode: 'review', task: 'Inspect the fixture', cwd: workspace, workerWorkspace: workspace, runDirectory, limits: { timeoutSeconds: 30, maxTurns: 12, maxEventBytes: 1_048_576, maxTranscriptBytes: 4096, maxArtifactBytes: 4096 } };
  const receipt = path.join(root, 'receipt.json');
  const backend = new AppServerBackend(validateConfig({ version: 1 }), { launch: async (_input, profile) => {
    const env = { ...profile.env }; delete env.MISTRAL_API_KEY; delete env.VIBE_SUPERVISOR_ORIGINAL_HOME;
    const child = spawnManaged(process.execPath, [path.resolve('tests/fixtures/fake-vibe-app-server.mjs'), scenario, receipt], { cwd: runDirectory, env, forwardEnv: Object.keys(env), stdio: ['pipe', 'pipe', 'pipe'], maxStdoutBytes: 1_048_576, maxStderrBytes: 4096 });
    return { process: child, executable: 'independent-fixture', version: '2.26.1' };
  } });
  const states: { state: RunState; update: unknown }[] = []; const events: unknown[] = []; let handle: BackendRunHandle | undefined;
  const callbacks = { onEvent: (event: unknown) => { events.push(event); }, onState: (state: RunState, update?: unknown) => { states.push({ state, update }); }, onSpawn: (value: BackendRunHandle) => { handle = value; } };
  return { input, backend, callbacks, states, events, receipt, get handle() { return handle; } };
}

describe('app-server backend against independent wire fixture', () => {
  it.each(['normal', 'approval', 'secret', 'shell-denied'])('completes %s with no replay, safe events and verified cleanup', async scenario => {
    const f = await fixture(scenario); const started = await f.backend.start(f.input, f.callbacks);
    try {
      await vi.waitFor(() => expect(f.states.some(value => value.state === 'completed')).toBe(true), { timeout: 5000 });
      expect(f.states.some(value => value.state === 'failed')).toBe(false);
      expect(JSON.stringify(f.events)).not.toContain('private-reasoning-canary');
      expect(JSON.stringify(f.events)).not.toContain('private-canary');
      expect(JSON.stringify(f.events)).not.toContain('filePath');
    } finally { await f.backend.close(started.handle); }
    await expect(access(path.join(f.input.runDirectory, 'tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
    const methods = JSON.parse(await readFile(f.receipt, 'utf8')).methods as string[];
    expect(methods.filter(method => method === 'turn/start')).toHaveLength(1);
    expect(methods).not.toContain('session/resume'); expect(methods).not.toContain('session/continue');
    if (scenario !== 'normal') expect(methods.indexOf('callback-ack')).toBeLessThan(methods.indexOf('callback/result'));
  });
  it.each(['version-drift', 'wrong-model'])('refuses %s before sending the task', async scenario => {
    const f = await fixture(scenario);
    await expect(f.backend.start(f.input, f.callbacks)).rejects.toMatchObject({ code: scenario === 'version-drift' ? 'VSUP_VIBE_VERSION_UNSUPPORTED' : 'VSUP_BACKEND_ERROR' });
    expect(JSON.parse(await readFile(f.receipt, 'utf8')).methods).not.toContain('turn/start');
  });
  it.each(['malformed', 'offprofile-execute', 'older-unsafe-effect', 'repeated-cursor'])('fails %s and preserves the failed outcome', async scenario => {
    const f = await fixture(scenario);
    try { await f.backend.start(f.input, f.callbacks); } catch { /* Startup and event processing race; either path must fail. */ }
    await vi.waitFor(() => expect(f.states.some(value => value.state === 'failed')).toBe(true), { timeout: 5000 });
    if (f.handle) await f.backend.close(f.handle);
    expect(f.states.some(value => value.state === 'completed')).toBe(false);
  });
  it('cancels during initialization without sending a task or leaving private runtime data', async () => {
    const f = await fixture('slow-init');
    const started = f.backend.start(f.input, f.callbacks);
    const rejected = started.catch(error => error);
    await vi.waitFor(() => expect(f.handle).toBeDefined());
    await f.backend.cancel(f.handle!);
    expect(await rejected).toMatchObject({ code: 'VSUP_CANCELLED' });
    expect(JSON.parse(await readFile(f.receipt, 'utf8')).methods).not.toContain('turn/start');
    await expect(access(path.join(f.input.runDirectory, 'vibe-home'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
