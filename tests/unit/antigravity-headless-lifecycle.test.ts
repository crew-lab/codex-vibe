import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AntigravityBackend, antigravityChildEnvironment, isSupportedAntigravityVersion, onlyAllowedAntigravityBuiltinSkills, selectAntigravityApiKey, type AntigravityBackendOptions } from '../../src/backends/antigravity.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runToWire } from '../../src/core/serialization.js';
import type { RunRecord, StartRunInput } from '../../src/contracts.js';
import { authorizedReviewStart } from '../support/authorized-start.js';

const roots: string[] = [];
const canonicalTmp = await realpath(tmpdir());
const passedPreparation: AntigravityBackendOptions = {
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
  const prefix = `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(marker)}, process.argv.includes('--version') ? 'version\\n' : 'worker\\n');\nif (process.argv.includes('--version')) { console.log('1.4.4'); process.exit(0); }\n`;
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

  it('accepts ANTIGRAVITY_API_KEY as the last fallback and passes it on only as the selected key', () => {
    const source = { GEMINI_API_KEY: '', ANTIGRAVITY_API_KEY: ' antigravity-only-value ' };
    expect(selectAntigravityApiKey(source)).toBe('antigravity-only-value');
    const child = antigravityChildEnvironment(source, '/private-home', '/private-tmp');
    expect(child.GEMINI_API_KEY).toBe('antigravity-only-value');
    expect(child.GOOGLE_API_KEY).toBe('antigravity-only-value');
    expect(child.ANTIGRAVITY_API_KEY).toBeUndefined();
  });

  it('accepts a pinned skill only with builtin: true, and only qualified agy versions', () => {
    expect(onlyAllowedAntigravityBuiltinSkills([{ name: 'automation', builtin: true }])).toBe(true);
    expect(onlyAllowedAntigravityBuiltinSkills([{ name: 'antigravity-guide', builtin: true }])).toBe(true);
    expect(onlyAllowedAntigravityBuiltinSkills([{ name: 'antigravity_guide', builtin: true }])).toBe(true);
    expect(onlyAllowedAntigravityBuiltinSkills([{ name: 'automation', scope: 'builtin' }])).toBe(false);
    expect(onlyAllowedAntigravityBuiltinSkills([{ name: 'automation', builtin: false, scope: 'builtin' }])).toBe(false);
    expect(onlyAllowedAntigravityBuiltinSkills([{ name: 'automation', builtin: true }, { name: 'automation', builtin: true }])).toBe(false);
    expect(isSupportedAntigravityVersion('1.4.9')).toBe(true);
    expect(isSupportedAntigravityVersion('1.4.8')).toBe(true);
    expect(isSupportedAntigravityVersion('1.4.7')).toBe(true);
    expect(isSupportedAntigravityVersion('1.4.6')).toBe(false);
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
