import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AntigravityBackend, antigravityChildEnvironment, isSupportedAntigravityVersion, resolveAntigravityApiKey, onlyBuiltinAntigravitySkills, selectAntigravityApiKey, type AntigravityBackendOptions } from '../../src/backends/antigravity.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runToWire } from '../../src/core/serialization.js';
import type { RunRecord, StartRunInput } from '../../src/contracts.js';
import { authorizedReviewStart } from '../support/authorized-start.js';

const roots: string[] = [];
const canonicalTmp = await realpath(tmpdir());
const passedPreparation: AntigravityBackendOptions = {
  launchdLookup: async () => undefined,
  preparation: { check: async () => ({ status: 'passed', candidate_sha256: 'a'.repeat(64), version: '2.1.0', reason: 'test' }) }
};
beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'fixed-test-key');
  vi.stubEnv('GOOGLE_API_KEY', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-headless-lifecycle-'));
  roots.push(root);
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  execFileSync('git', ['init', '-q', workspace]);
  const marker = path.join(root, 'invocations');
  const executable = path.join(root, 'mock-agy');
  const prefix = `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(marker)}, process.argv.includes('--version') ? 'version\\n' : 'worker\\n');\nif (process.argv.includes('--version')) { console.log('1.5.8'); process.exit(0); }\n`;
  const config = { ...DEFAULT_CONFIG, backend: 'antigravity' as const, experimental: { antigravity: true }, allowedWorkspaceRoots: [workspace], paths: { antigravity: executable } };
  const backend = new AntigravityBackend(config, passedPreparation);
  const input: StartRunInput = {
    runId: randomUUID(), mode: 'review', task: 'Mock authentication lifecycle', cwd: workspace, workerWorkspace: workspace,
    runDirectory: path.join(root, 'run'),
    limits: { timeoutSeconds: 1, maxTurns: 2, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
  };
  return { root, workspace, marker, executable, prefix, config, backend, input };
}

async function waitForFile(file: string) {
  await vi.waitFor(async () => expect(await readFile(file, 'utf8')).toBe('waiting'), { timeout: 5000 });
}

async function privateStateGone(directory: string) {
  for (const name of ['antigravity-home', 'antigravity-tmp']) {
    await expect(lstat(path.join(directory, name))).rejects.toMatchObject({ code: 'ENOENT' });
  }
}

describe('Antigravity headless admission and lifecycle regressions', () => {
  it('selects a nonblank Google fallback and forwards only the selected credential value', () => {
    const source = { GEMINI_API_KEY: '   ', GOOGLE_API_KEY: ' fixed-google-value ', ANTIGRAVITY_API_KEY: 'unused-value' };
    expect(selectAntigravityApiKey(source)).toBe('fixed-google-value');
    const child = antigravityChildEnvironment(source, '/private-home', '/private-tmp');
    expect(child.GEMINI_API_KEY).toBe('fixed-google-value');
    expect(child.GOOGLE_API_KEY).toBe('fixed-google-value');
    expect(child.ANTIGRAVITY_API_KEY).toBeUndefined();
    expect(selectAntigravityApiKey({ GEMINI_API_KEY: ' first ', GOOGLE_API_KEY: ' second ' })).toBe('first');
  });

  it('resolves the key from the environment first and from launchd only on macOS when the environment has none', async () => {
    const asked: string[] = [];
    const lookup = async (name: string) => { asked.push(name); return name === 'GOOGLE_API_KEY' ? ' launchd-google-value \n' : undefined; };
    expect(await resolveAntigravityApiKey({ GEMINI_API_KEY: ' environment-value ' }, 'darwin', lookup)).toBe('environment-value');
    expect(asked).toEqual([]);
    expect(await resolveAntigravityApiKey({ GEMINI_API_KEY: '  ' }, 'darwin', lookup)).toBe('launchd-google-value');
    expect(asked).toEqual(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
    expect(await resolveAntigravityApiKey({}, 'linux', lookup)).toBeUndefined();
    expect(asked).toEqual(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
    expect(await resolveAntigravityApiKey({}, 'darwin', async () => undefined)).toBeUndefined();
  });

  it('never writes a launchd-resolved key into the supervisor environment', async () => {
    const source: NodeJS.ProcessEnv = {};
    await resolveAntigravityApiKey(source, 'darwin', async () => 'launchd-value');
    expect(source).toEqual({});
  });

  it('accepts ANTIGRAVITY_API_KEY as the last fallback and passes it on only as the selected key', () => {
    const source = { GEMINI_API_KEY: '', ANTIGRAVITY_API_KEY: ' antigravity-only-value ' };
    expect(selectAntigravityApiKey(source)).toBe('antigravity-only-value');
    const child = antigravityChildEnvironment(source, '/private-home', '/private-tmp');
    expect(child.GEMINI_API_KEY).toBe('antigravity-only-value');
    expect(child.GOOGLE_API_KEY).toBe('antigravity-only-value');
    expect(child.ANTIGRAVITY_API_KEY).toBeUndefined();
  });

  it('accepts any built-in skill by flag and refuses everything else', () => {
    expect(onlyBuiltinAntigravitySkills([])).toBe(true);
    expect(onlyBuiltinAntigravitySkills([{ name: 'automation', builtin: true }, { name: 'brand-new-skill', builtin: true }])).toBe(true);
    expect(onlyBuiltinAntigravitySkills([{ name: 'automation', scope: 'builtin' }])).toBe(false);
    expect(onlyBuiltinAntigravitySkills([{ name: 'automation', builtin: false, scope: 'builtin' }])).toBe(false);
    expect(onlyBuiltinAntigravitySkills([{ name: 'automation', builtin: true }, { name: 'automation', builtin: true }])).toBe(false);
    expect(onlyBuiltinAntigravitySkills([{ name: '', builtin: true }])).toBe(false);
    expect(onlyBuiltinAntigravitySkills([{ name: 7, builtin: true }])).toBe(false);
    expect(onlyBuiltinAntigravitySkills([{ builtin: true }])).toBe(false);
    expect(onlyBuiltinAntigravitySkills(['automation'])).toBe(false);
    expect(onlyBuiltinAntigravitySkills([null])).toBe(false);
  });

  it('accepts stable agy versions at or above the minimum only', () => {
    for (const version of ['1.5.8', '1.5.9', '1.6.0', '2.0.0']) expect(isSupportedAntigravityVersion(version)).toBe(true);
    for (const version of ['1.5.7', '1.4.9', '1.5.8-beta', 'garbage', '', null, undefined]) expect(isSupportedAntigravityVersion(version)).toBe(false);
  });

  it('refuses missing credentials before any executable invocation or private directory creation', async () => {
    const f = await fixture();
    await writeFile(f.executable, f.prefix + "process.exit(0);\n", { mode: 0o700 });
    vi.stubEnv('GEMINI_API_KEY', ' ');
    vi.stubEnv('GOOGLE_API_KEY', '');
    await expect(f.backend.start(f.input, { onEvent() {}, onState() {} })).rejects.toMatchObject({ details: { reason: 'missing_gemini_api_key' } });
    await expect(lstat(f.marker)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(f.input.runDirectory!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lists a missing key in readiness, refuses the start without spending the grant, and starts with the same grant once the key is set', async () => {
    const f = await fixture();
    await writeFile(f.executable, f.prefix + "process.exit(0);\n", { mode: 0o700 });
    vi.stubEnv('GEMINI_API_KEY', '');
    const manager = new RunManager(f.config, path.join(f.root, 'data'), [f.backend]);
    try {
      await manager.initialize();
      const missing = await manager.status({ workspace: f.workspace, operation: 'review' });
      expect(missing).toMatchObject({ eligible: false, admission: { credential: { status: 'absent' }, pin: 'not_applicable' } });
      expect(missing.blockers).toContainEqual(expect.objectContaining({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'missing_gemini_api_key' } }));
      const request = { task: 'Review the key handling.', cwd: f.workspace, wait_seconds: 0 };
      const grant = await manager.authorizeDispatch('review', request, 'codex-vibe-test-owner', new Date(Date.now() + 3_600_000).toISOString());
      const start = () => manager.reviewStart({ ...request, authorization_id: grant.authorization_id, attempt_id: grant.attempt_id });
      await expect(start()).rejects.toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'missing_gemini_api_key', attempt_consumed: false } });
      expect(await readFile(f.marker, 'utf8').catch(() => '')).not.toContain('worker');
      vi.stubEnv('GEMINI_API_KEY', 'fixed-test-key');
      const present = await manager.status({ workspace: f.workspace, operation: 'review' });
      expect(present).toMatchObject({ admission: { credential: { status: 'present', source: 'environment' } } });
      expect(JSON.stringify(present)).not.toContain('fixed-test-key');
      const started = await start();
      await vi.waitFor(async () => expect(await readFile(f.marker, 'utf8')).toContain('worker'), { timeout: 10_000 });
      await vi.waitFor(async () => expect(['completed', 'failed']).toContain((await manager.status({ run_id: started.run_id })).state), { timeout: 15_000 });
      const events = await readFile(path.join(f.root, 'data', 'runs', started.run_id, 'events.ndjson'), 'utf8');
      expect(await manager.result({ run_id: started.run_id, detail: 'full' })).not.toHaveProperty('context_reads');
      expect(events).not.toContain('fixed-test-key');
    } finally { await manager.shutdown(); }
  }, 30_000);

  it('reports the prompt as sent before it spawns agy with it, and not when it refuses before spawning', async () => {
    const f = await fixture();
    await writeFile(f.executable, f.prefix + "process.exit(0);\n", { mode: 0o700 });
    const order: string[] = [];
    let settled!: () => void;
    const done = new Promise<void>((resolve) => { settled = resolve; });
    const started = await f.backend.start(f.input, {
      onEvent() {},
      onPromptSent() { order.push('prompt'); },
      onSpawn() { order.push('spawn'); },
      onState(state) { if (state === 'failed' || state === 'completed' || state === 'cancelled') settled(); }
    });
    await done;
    await f.backend.close(started.handle);
    expect(order).toEqual(['prompt', 'spawn']);
    vi.stubEnv('GEMINI_API_KEY', '');
    const refused: string[] = [];
    await expect(f.backend.start({ ...f.input, runId: randomUUID(), runDirectory: path.join(f.root, 'run-2') }, { onEvent() {}, onPromptSent() { refused.push('prompt'); }, onState() {} })).rejects.toMatchObject({ details: { reason: 'missing_gemini_api_key' } });
    expect(refused).toEqual([]);
  });

  it.each([
    [false, 'enforced', false],
    [true, 'bypassed', true]
  ] as const)('passes --dangerously-skip-permissions only when antigravity_skip_permissions is %s and logs the %s layer', async (skip, layer, expectFlag) => {
    const f = await fixture();
    const argvFile = path.join(f.root, 'argv.json');
    await writeFile(f.executable, f.prefix + `fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`, { mode: 0o700 });
    const config = { ...f.config, experimental: { antigravity: true, antigravitySkipPermissions: skip } };
    const backend = new AntigravityBackend(config, passedPreparation);
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const stderrLines: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { stderrLines.push(String(chunk)); return true; }) as typeof process.stderr.write);
    let settled!: () => void;
    const done = new Promise<void>((resolve) => { settled = resolve; });
    try {
      const started = await backend.start(f.input, {
        onEvent(event) { events.push({ type: event.type, data: event.data as Record<string, unknown> }); },
        onState(state) { if (state === 'failed' || state === 'completed' || state === 'cancelled') settled(); }
      });
      await done;
      await backend.close(started.handle);
    } finally { stderr.mockRestore(); }
    const argv = JSON.parse(await readFile(argvFile, 'utf8')) as string[];
    expect(argv.includes('--dangerously-skip-permissions')).toBe(expectFlag);
    const bypassNotice = events.find((event) => event.type === 'diagnostic' && event.data.reason === 'antigravity_permission_layer_bypassed');
    expect(Boolean(bypassNotice)).toBe(expectFlag);
    if (expectFlag) {
      expect(bypassNotice?.data.agy_permission_layer).toBe(layer);
      expect(stderrLines.some((line) => line.includes('--dangerously-skip-permissions'))).toBe(true);
    }
  });

  it('cancels a worker waiting for authentication and removes its browser interception state', async () => {
    const f = await fixture();
    const waiting = path.join(f.root, 'waiting');
    await writeFile(f.executable, f.prefix + `fs.writeFileSync(${JSON.stringify(waiting)}, 'waiting');\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    const started = await f.backend.start(f.input, { onEvent() {}, onState() {} });
    try {
      await waitForFile(waiting);
      await expect(lstat(path.join(f.input.runDirectory!, 'antigravity-home', '.bin', 'open'))).resolves.toBeDefined();
      await f.backend.cancel(started.handle);
    } finally { await f.backend.close(started.handle); }
    await privateStateGone(f.input.runDirectory!);
  });

  it('applies the supervisor deadline to an authentication wait and cleans the worker home', async () => {
    const f = await fixture();
    const waiting = path.join(f.root, 'waiting');
    await writeFile(f.executable, f.prefix + `fs.writeFileSync(${JSON.stringify(waiting)}, 'waiting');\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    const data = path.join(f.root, 'data');
    const manager = new RunManager(f.config, data, [f.backend]);
    try {
      await manager.initialize();
      const started = await authorizedReviewStart(manager, { task: 'Mock auth wait', cwd: f.workspace, timeout_seconds: 30, wait_seconds: 1 });
      await vi.waitFor(async () => {
        expect(await manager.status({ run_id: started.run_id })).toMatchObject({ state: 'failed', error: { code: 'VSUP_TIMEOUT' } });
      }, { timeout: 35000, interval: 100 });
      expect(await readFile(waiting, 'utf8')).toBe('waiting');
      await privateStateGone(path.join(data, 'runs', started.run_id));
    } finally { await manager.shutdown(); }
  }, 45000);

  it('removes interrupted authentication private state on restart without replaying the worker', async () => {
    const f = await fixture();
    const data = path.join(f.root, 'data');
    const runId = randomUUID();
    const runDirectory = path.join(data, 'runs', runId);
    const stamp = new Date(Date.now() - 600_000).toISOString();
    const record: RunRecord = {
      schemaVersion: 1, runId, backend: 'antigravity', mode: 'review', state: 'running',
      sourceWorkspace: f.workspace, workerWorkspace: f.workspace, createdAt: stamp, updatedAt: stamp, launchedAt: stamp,
      taskSha256: 'a'.repeat(64), limits: f.input.limits
    };
    await mkdir(path.join(runDirectory, 'antigravity-home', '.bin'), { recursive: true });
    await mkdir(path.join(runDirectory, 'antigravity-tmp'));
    await writeFile(path.join(runDirectory, 'antigravity-home', '.bin', 'open'), 'interrupted shim');
    await writeFile(path.join(runDirectory, 'meta.json'), JSON.stringify(runToWire(record)));
    const manager = new RunManager(f.config, data, [f.backend], undefined, { recoveryWorkerWindowMs: 0 });
    try {
      await manager.initialize();
      const status = await manager.status({ run_id: runId });
      expect(status).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
      await privateStateGone(runDirectory);
      await expect(lstat(f.marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await manager.shutdown(); }
  });
});
