import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRecord, SupervisorBackend, SupervisorConfig } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadConfig } from '../../src/config/config.js';
import { validateConfig } from '../../src/config/validation.js';
import { validateFindings } from '../../src/core/findings.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runToWire } from '../../src/core/serialization.js';
import { canonicalBudgets } from '../../src/core/usage-ledger.js';
import { runDoctor } from '../../src/diagnostics/doctor.js';
import { patchContainsCredential, redactSecrets } from '../../src/security/redaction.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function privateTemp(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), prefix)));
  await chmod(dir, 0o700);
  tempRoots.push(dir);
  return dir;
}

async function privateDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

async function saveRun(home: string, record: RunRecord): Promise<void> {
  const directory = await privateDir(path.join(await privateDir(path.join(home, 'runs')), record.runId));
  await writeFile(path.join(directory, 'meta.json'), JSON.stringify(runToWire(record)), { mode: 0o600 });
}

function spentRecord(root: string, amount: number): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId: '00000000-0000-4000-8000-0000000000aa',
    backend: 'app-server',
    mode: 'review',
    state: 'completed',
    sourceWorkspace: root,
    workerWorkspace: root,
    admittedRoot: root,
    createdAt: now,
    updatedAt: now,
    taskSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    limits: { timeoutSeconds: 60, maxTurns: 10, maxEventBytes: 1048576, maxTranscriptBytes: 1048576, maxArtifactBytes: 1048576 },
    usage: { cost: { amount, currency: 'USD', authoritative: false } }
  };
}

async function readinessBlockers(manager: RunManager, workspace: string): Promise<Array<{ code: string; details?: Record<string, unknown> }>> {
  const status = await manager.status({ workspace, operation: 'review' });
  return status.blockers as Array<{ code: string; details?: Record<string, unknown> }>;
}

const pin = { vibe_pin_manifest: '/data/pin.json' };

describe('Google credential redaction (F3)', () => {
  it('redacts Google API keys and key query parameters', () => {
    const key = ['AI', 'za', 'Sy', 'b1C2d3E4f5'.repeat(3), 'g6H'].join('');
    expect(key).toHaveLength(39);
    expect(redactSecrets(`using ${key} now`)).toBe('using [REDACTED] now');
    expect(redactSecrets(`GET https://generativelanguage.googleapis.com/v1/models?alt=sse&key=${'opaque'}Value123 HTTP/1.1`))
      .toBe('GET https://generativelanguage.googleapis.com/v1/models?alt=sse&key=[REDACTED] HTTP/1.1');
    expect(redactSecrets('GET /v1/models?key=abc123def&alt=sse')).toBe('GET /v1/models?key=[REDACTED]&alt=sse');
    expect(patchContainsCredential(`diff --git a/x b/x\n@@ -0,0 +1 @@\n+const k = "${key}";\n`)).toBe(true);
  });
});

describe('experimental Antigravity opt-in', () => {
  it('rejects backend = "antigravity" without experimental.antigravity, accepts it with the opt-in, and defaults to app-server', async () => {
    expect(() => validateConfig({ version: 1, backend: 'antigravity' })).toThrow(/experimental[\s\S]*antigravity = true[\s\S]*docs\/target-acceptance\.md/);
    expect(() => validateConfig({ version: 1, backend: 'antigravity', experimental: { antigravity: false } })).toThrow(/experimental/);
    expect(() => validateConfig({ version: 1, backend: 'antigravity', experimental: { antigravity: 'yes' } })).toThrow();
    expect(() => validateConfig({ version: 1, paths: pin, experimental: { other: true } })).toThrow();
    const accepted = validateConfig({ version: 1, backend: 'antigravity', experimental: { antigravity: true } });
    expect(accepted.backend).toBe('antigravity');
    expect(accepted.experimental).toEqual({ antigravity: true });
    expect(validateConfig({ version: 1, paths: pin }).backend).toBeUndefined();

    const home = await privateTemp('vsup-optin-');
    await writeFile(path.join(home, 'config.toml'), 'version = 1\nbackend = "antigravity"\n', { mode: 0o600 });
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: home }, requirePinManifest: false })).rejects.toMatchObject({
      supervisor: { code: 'VSUP_CONFIG_INVALID', message: expect.stringContaining('experimental') }
    });
    await writeFile(path.join(home, 'config.toml'), 'version = 1\nbackend = "antigravity"\n[experimental]\nantigravity = true\n', { mode: 0o600 });
    expect((await loadConfig({ env: { VIBE_SUPERVISOR_HOME: home }, requirePinManifest: false })).backend).toBe('antigravity');

    const manager = new RunManager({ ...DEFAULT_CONFIG }, await privateTemp('vsup-default-backend-'));
    await manager.initialize();
    try {
      expect((await manager.status({ workspace: home, operation: 'review' })).backend).toBe('app-server');
      expect((await manager.status({ workspace: home, operation: 'review' })).backend_experimental).toBe(false);
    } finally {
      await manager.shutdown();
    }
  });

  it('reports the antigravity backend as experimental in doctor and readiness', async () => {
    const stub = {
      kind: 'antigravity',
      probe: async () => ({ available: true, backend: 'antigravity', executable: '/x/agy', version: '1.4.0', details: { sha256: 'f'.repeat(64) } }),
      runtimeCheck: async () => ({ executable: 'agy', resolved_executable: '/x/agy', executable_found: true, pinned_version: '1.4.0', version_verified: false }),
      preparationCheck: async () => ({ status: 'missing', candidate_sha256: null, version: '0', reason: 'test' })
    } as unknown as SupervisorBackend;
    const config: SupervisorConfig = { ...DEFAULT_CONFIG, backend: 'antigravity', experimental: { antigravity: true } };
    const report = await runDoctor(config, { dataDir: await privateTemp('vsup-doctor-exp-') }, { backend: stub });
    expect(report.provenance.backend_experimental).toBe(true);
    expect(report.checks.find((check) => check.name === 'antigravity')?.message).toMatch(/^Experimental backend/);

    const workspace = await privateTemp('vsup-exp-ready-');
    const manager = new RunManager({ ...config, allowedWorkspaceRoots: [workspace] }, await privateTemp('vsup-exp-data-'), [stub]);
    await manager.initialize();
    try {
      const status = await manager.status({ workspace, operation: 'review' });
      expect(status).toMatchObject({ backend: 'antigravity', backend_experimental: true });
    } finally {
      await manager.shutdown();
    }
  });
});

describe('budgets by canonical root (F5, F6, F7)', () => {
  it('applies a budget written with ~ to the canonical admitted root', async () => {
    const base = await privateTemp('vsup-budget-home-');
    const home = await privateDir(path.join(base, 'home'));
    const workspace = await privateDir(path.join(home, 'project'));
    const dataDir = await privateDir(path.join(base, 'data'));
    await saveRun(dataDir, spentRecord(workspace, 5));
    const savedHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const config = validateConfig({ version: 1, allowed_workspace_roots: ['~/project'], budgets: { '~/project': { max_cost_usd_per_day: 4 } }, paths: pin }, home);
      const manager = new RunManager(config, dataDir);
      await manager.initialize();
      try {
        const blockers = await readinessBlockers(manager, workspace);
        expect(blockers.find((blocker) => blocker.code === 'VSUP_BUDGET_EXCEEDED')?.details).toMatchObject({ admitted_root: workspace, current_cost_usd: 5 });
        expect([...(await canonicalBudgets(config)).keys()]).toEqual([workspace]);
      } finally {
        await manager.shutdown();
      }
    } finally {
      process.env.HOME = savedHome;
    }
  });

  it('fails closed with VSUP_CONFIG_INVALID when a budget root is not canonical (/tmp is /private/tmp)', async () => {
    const canonicalTmpRoot = await realpath('/tmp').catch(() => '/tmp');
    const aliased = await mkdtemp(path.join(canonicalTmpRoot, 'vsup-budget-alias-'));
    tempRoots.push(aliased);
    const spelled = path.join('/tmp', path.basename(aliased));
    const config: SupervisorConfig = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [spelled], budgets: { [spelled]: { maxCostUsdPerDay: 1 } } };
    if (canonicalTmpRoot === '/tmp') {
      expect([...(await canonicalBudgets(config)).keys()]).toEqual([aliased]);
      return;
    }
    await expect(canonicalBudgets(config)).rejects.toMatchObject({ code: 'VSUP_CONFIG_INVALID', details: { budget_root: spelled } });
    await expect(canonicalBudgets({ ...DEFAULT_CONFIG, budgets: { [path.join(aliased, 'gone')]: { maxCostUsdPerDay: 1 } } })).resolves.toEqual(new Map());
  });

  it('rejects a USD budget with the antigravity backend at config and admission time', async () => {
    const workspace = await privateTemp('vsup-agy-budget-');
    expect(() => validateConfig({
      version: 1, backend: 'antigravity', experimental: { antigravity: true },
      allowed_workspace_roots: [workspace], budgets: { [workspace]: { max_cost_usd_per_day: 3 } }
    })).toThrow(/max_cost_usd_per_day/);

    const manager = new RunManager(
      { ...DEFAULT_CONFIG, backend: 'antigravity', experimental: { antigravity: true }, allowedWorkspaceRoots: [workspace], budgets: { [workspace]: { maxCostUsdPerDay: 3 } } },
      await privateTemp('vsup-agy-budget-data-')
    );
    await manager.initialize();
    try {
      const blockers = await readinessBlockers(manager, workspace);
      expect(blockers.find((blocker) => blocker.code === 'VSUP_BACKEND_ERROR')?.details).toMatchObject({ reason: 'price_unavailable', max_cost_usd_per_day: 3 });
    } finally {
      await manager.shutdown();
    }
  });

  it('counts every isolated session under the shared data root, not only the current session home', async () => {
    const dataRoot = await privateTemp('vsup-budget-shared-');
    const workspace = await privateTemp('vsup-budget-work-');
    const sessions = await privateDir(path.join(dataRoot, 'mcp-sessions'));
    const otherSession = await privateDir(path.join(sessions, 'session-other1'));
    const currentSession = await privateDir(path.join(sessions, 'session-curr01'));
    await saveRun(otherSession, spentRecord(workspace, 5));
    const config = validateConfig({ version: 1, allowed_workspace_roots: [workspace], budgets: { [workspace]: { max_cost_usd_per_day: 4 } }, paths: pin });
    const manager = new RunManager(config, currentSession, [], undefined, { sessionId: 'session-curr01', usageDataDir: dataRoot });
    await manager.initialize();
    try {
      const blockers = await readinessBlockers(manager, workspace);
      expect(blockers.find((blocker) => blocker.code === 'VSUP_BUDGET_EXCEEDED')?.details).toMatchObject({ current_cost_usd: 5 });
    } finally {
      await manager.shutdown();
    }
  });
});

describe('finding line bounds (F16)', () => {
  it('rejects findings whose lines exceed the file and accepts lines that exist', async () => {
    const workspace = await privateTemp('vsup-findings-lines-');
    await writeFile(path.join(workspace, 'three.ts'), 'one\ntwo\nthree\n');
    await writeFile(path.join(workspace, 'open.ts'), 'one\ntwo');
    await writeFile(path.join(workspace, 'empty.ts'), '');
    const finding = (file: string, startLine: number, endLine?: number) => ({ message: `${file}:${startLine}`, location: { path: file, startLine, ...(endLine === undefined ? {} : { endLine }) } });
    const result = await validateFindings({
      workspace,
      rawFindings: [
        finding('three.ts', 3),
        finding('three.ts', 1, 3),
        finding('three.ts', 4),
        finding('three.ts', 2, 9),
        finding('open.ts', 2),
        finding('open.ts', 3),
        finding('empty.ts', 1),
        finding('missing.ts', 1)
      ]
    });
    expect(result.findings.map((item) => item.message)).toEqual(['three.ts:3', 'three.ts:1', 'open.ts:2']);
    expect(result.rejected.map((item) => [(item.raw as { message: string }).message, item.reason])).toEqual([
      ['three.ts:4', 'line_out_of_bounds'],
      ['three.ts:2', 'line_out_of_bounds'],
      ['open.ts:3', 'line_out_of_bounds'],
      ['empty.ts:1', 'line_out_of_bounds'],
      ['missing.ts:1', 'file_not_found']
    ]);
  });
});
