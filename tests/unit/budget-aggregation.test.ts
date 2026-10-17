import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '../../src/contracts.js';
import {
  aggregateDailyUsage,
  calculateRollingUsage,
  checkBudgetAdmission,
  enumerateRunDirectories,
  loadAllRunRecords
} from '../../src/core/usage-ledger.js';
import { parseOptions, runsUsage } from '../../src/cli/runs/usage.js';
import { runToWire } from '../../src/core/serialization.js';
import { RunManager } from '../../src/core/run-manager.js';
import { validateConfig } from '../../src/config/validation.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeDataDir(prefix: string): Promise<string> {
  const canonicalTmp = await realpath(os.tmpdir());
  const dir = await realpath(await mkdtemp(path.join(canonicalTmp, prefix)));
  await chmod(dir, 0o700);
  tempRoots.push(dir);
  return dir;
}

async function saveRun(home: string, record: RunRecord): Promise<string> {
  const runs = path.join(home, 'runs');
  await mkdir(runs, { recursive: true, mode: 0o700 });
  await chmod(runs, 0o700);
  const directory = path.join(runs, record.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(path.join(directory, 'meta.json'), JSON.stringify(runToWire(record)), { mode: 0o600 });
  return directory;
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId: overrides.runId ?? '11111111-2222-4333-8444-555555555555',
    backend: 'app-server',
    mode: 'review',
    state: 'completed',
    sourceWorkspace: overrides.sourceWorkspace ?? '/workspace/project-a',
    workerWorkspace: overrides.workerWorkspace ?? '/workspace/project-a',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    taskSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    limits: {
      timeoutSeconds: 60,
      maxTurns: 10,
      maxEventBytes: 1048576,
      maxTranscriptBytes: 1048576,
      maxArtifactBytes: 1048576
    },
    ...overrides
  };
}

describe('usage ledger and budget aggregation', () => {
  it('calculates rolling 24-hour usage accurately and filters out expired runs', () => {
    const root = '/workspace/project-a';
    const baseTime = Date.parse('2026-10-17T12:00:00.000Z');

    const records: RunRecord[] = [
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000001',
        admittedRoot: root,
        createdAt: '2026-10-17T11:00:00.000Z', // 1 hour ago (within 24h)
        usage: { tokensUsed: 1000, modelCalls: 2, cost: { amount: 0.15, currency: 'USD', authoritative: false } }
      }),
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000002',
        admittedRoot: root,
        createdAt: '2026-10-16T13:00:00.000Z', // 23 hours ago (within 24h)
        usage: { promptTokens: 300, completionTokens: 200, modelCalls: 1, cost: { amount: 0.05, currency: 'USD', authoritative: false } }
      }),
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000003',
        admittedRoot: root,
        createdAt: '2026-10-16T11:00:00.000Z', // 25 hours ago (expired from 24h window)
        usage: { tokensUsed: 5000, modelCalls: 10, cost: { amount: 2.5, currency: 'USD', authoritative: false } }
      }),
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000004',
        admittedRoot: '/workspace/other-project', // different root
        createdAt: '2026-10-17T11:30:00.000Z',
        usage: { tokensUsed: 2000, modelCalls: 4, cost: { amount: 0.8, currency: 'USD', authoritative: false } }
      })
    ];

    const rolling = calculateRollingUsage({
      records,
      root,
      now: baseTime,
      windowHours: 24
    });

    expect(rolling.runCount).toBe(2);
    expect(rolling.totalTokens).toBe(1500); // 1000 + 500
    expect(rolling.modelCalls).toBe(3); // 2 + 1
    expect(rolling.totalCostUsd).toBe(0.2); // 0.15 + 0.05
    expect(rolling.root).toBe(root);
  });

  it('handles records with no cost by contributing 0 cost while counting tokens', () => {
    const root = '/workspace/project-a';
    const now = Date.parse('2026-10-17T12:00:00.000Z');

    const records: RunRecord[] = [
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000001',
        admittedRoot: root,
        createdAt: '2026-10-17T11:00:00.000Z',
        usage: { tokensUsed: 800, modelCalls: 2 } // No cost field
      })
    ];

    const rolling = calculateRollingUsage({ records, root, now });
    expect(rolling.runCount).toBe(1);
    expect(rolling.totalTokens).toBe(800);
    expect(rolling.totalCostUsd).toBe(0);
  });

  it('enforces budget admission checks accurately', async () => {
    const root = '/workspace/project-a';
    const records: RunRecord[] = [
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000001',
        admittedRoot: root,
        createdAt: new Date().toISOString(),
        usage: { cost: { amount: 4.5, currency: 'USD', authoritative: false } }
      })
    ];

    // Under budget
    const allowCheck = await checkBudgetAdmission({
      dataDir: '/nonexistent',
      admittedRoot: root,
      budget: { maxCostUsdPerDay: 5.0 },
      records
    });
    expect(allowCheck.allowed).toBe(true);
    expect(allowCheck.currentCostUsd).toBe(4.5);
    expect(allowCheck.limitCostUsd).toBe(5.0);

    // Over budget
    const denyCheck = await checkBudgetAdmission({
      dataDir: '/nonexistent',
      admittedRoot: root,
      budget: { maxCostUsdPerDay: 4.0 },
      records
    });
    expect(denyCheck.allowed).toBe(false);
    expect(denyCheck.currentCostUsd).toBe(4.5);
    expect(denyCheck.limitCostUsd).toBe(4.0);

    // At exact budget ceiling (rejection on reach)
    const exactCeilingCheck = await checkBudgetAdmission({
      dataDir: '/nonexistent',
      admittedRoot: root,
      budget: { maxCostUsdPerDay: 4.5 },
      records
    });
    expect(exactCeilingCheck.allowed).toBe(false);

    // Unconfigured budget allows unconditionally
    const unconfigured = await checkBudgetAdmission({
      dataDir: '/nonexistent',
      admittedRoot: root,
      budget: {},
      records
    });
    expect(unconfigured.allowed).toBe(true);
  });

  it('aggregates daily usage grouped by calendar date (UTC) and root', () => {
    const rootA = '/workspace/project-a';
    const rootB = '/workspace/project-b';

    const records: RunRecord[] = [
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000001',
        admittedRoot: rootA,
        createdAt: '2026-10-17T10:00:00.000Z',
        usage: { tokensUsed: 1000, modelCalls: 2, cost: { amount: 0.1, currency: 'USD', authoritative: false } }
      }),
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000002',
        admittedRoot: rootA,
        createdAt: '2026-10-17T14:00:00.000Z',
        usage: { tokensUsed: 1500, modelCalls: 3, cost: { amount: 0.15, currency: 'USD', authoritative: false } }
      }),
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000003',
        admittedRoot: rootB,
        createdAt: '2026-10-17T11:00:00.000Z',
        usage: { tokensUsed: 500, modelCalls: 1, cost: { amount: 0.05, currency: 'USD', authoritative: false } }
      }),
      makeRunRecord({
        runId: '00000000-0000-4000-8000-000000000004',
        admittedRoot: rootA,
        createdAt: '2026-10-16T20:00:00.000Z',
        usage: { tokensUsed: 2000, modelCalls: 4, cost: { amount: 0.2, currency: 'USD', authoritative: false } }
      })
    ];

    const report = aggregateDailyUsage(records);
    expect(report.rows.length).toBe(3); // (2026-10-17, rootA), (2026-10-17, rootB), (2026-10-16, rootA)

    // Verify ordering: descending by date, ascending by root
    expect(report.rows[0]).toEqual({
      date: '2026-10-17',
      root: rootA,
      runs: 2,
      tokens: 2500,
      modelCalls: 5,
      costUsd: 0.25
    });
    expect(report.rows[1]).toEqual({
      date: '2026-10-17',
      root: rootB,
      runs: 1,
      tokens: 500,
      modelCalls: 1,
      costUsd: 0.05
    });
    expect(report.rows[2]).toEqual({
      date: '2026-10-16',
      root: rootA,
      runs: 1,
      tokens: 2000,
      modelCalls: 4,
      costUsd: 0.2
    });

    expect(report.summary).toEqual({
      since: null,
      root: null,
      totalRuns: 4,
      totalTokens: 5000,
      totalModelCalls: 10,
      totalCostUsd: 0.5
    });

    // Test with --since filter
    const filteredSince = aggregateDailyUsage(records, { since: '2026-10-17' });
    expect(filteredSince.rows.length).toBe(2);
    expect(filteredSince.summary.totalRuns).toBe(3);
    expect(filteredSince.summary.totalCostUsd).toBe(0.3);

    // Test with --root filter
    const filteredRoot = aggregateDailyUsage(records, { root: rootB });
    expect(filteredRoot.rows.length).toBe(1);
    expect(filteredRoot.summary.totalRuns).toBe(1);
    expect(filteredRoot.summary.totalCostUsd).toBe(0.05);
  });

  it('scans runs across standard dataDir and isolated session homes', async () => {
    const dataDir = await makeDataDir('vsup-ledger-');

    const standardRecord = makeRunRecord({
      runId: '00000000-0000-4000-8000-000000000001',
      admittedRoot: '/workspace/project',
      usage: { tokensUsed: 100, cost: { amount: 0.01, currency: 'USD', authoritative: false } }
    });
    await saveRun(dataDir, standardRecord);

    const session = path.join(dataDir, 'mcp-sessions', 'session-abc123');
    await mkdir(session, { recursive: true, mode: 0o700 });
    await chmod(session, 0o700);

    const sessionRecord = makeRunRecord({
      runId: '00000000-0000-4000-8000-000000000002',
      admittedRoot: '/workspace/project',
      usage: { tokensUsed: 200, cost: { amount: 0.02, currency: 'USD', authoritative: false } }
    });
    await saveRun(session, sessionRecord);

    const dirs = await enumerateRunDirectories(dataDir);
    expect(dirs.length).toBe(2);

    const records = await loadAllRunRecords(dataDir);
    expect(records.length).toBe(2);

    const rolling = calculateRollingUsage({ records, root: '/workspace/project' });
    expect(rolling.runCount).toBe(2);
    expect(rolling.totalTokens).toBe(300);
    expect(rolling.totalCostUsd).toBe(0.03);
  });

  it('parses runs usage CLI flags and validates dates and roots', () => {
    const valid = parseOptions({
      subcommand: 'usage',
      positional: ['usage', '--since', '2026-10-15', '--root', '/my/project', '--json'],
      configPath: undefined,
      services: { cleanup: async () => {} }
    });
    expect(valid.json).toBe(true);
    expect(valid.since).toBe('2026-10-15');
    expect(valid.root).toBe(path.resolve('/my/project'));

    // Rejection of invalid date
    expect(() =>
      parseOptions({
        subcommand: 'usage',
        positional: ['usage', '--since', 'not-a-date'],
        configPath: undefined,
        services: { cleanup: async () => {} }
      })
    ).toThrow(/calendar date as YYYY-MM-DD/);

    // Rejection of missing root argument
    expect(() =>
      parseOptions({
        subcommand: 'usage',
        positional: ['usage', '--root'],
        configPath: undefined,
        services: { cleanup: async () => {} }
      })
    ).toThrow(/runs usage --root requires a directory path/);
  });

  it('runsUsage prints formatted table and JSON lines', async () => {
    const dataDir = await makeDataDir('vsup-usage-cli-');

    const record = makeRunRecord({
      runId: '00000000-0000-4000-8000-000000000001',
      admittedRoot: '/workspace/demo',
      createdAt: '2026-10-17T10:00:00.000Z',
      usage: { tokensUsed: 1250, modelCalls: 3, cost: { amount: 0.125, currency: 'USD', authoritative: false } }
    });
    await saveRun(dataDir, record);

    const configPath = path.join(dataDir, 'config.toml');
    await writeFile(
      configPath,
      `version = 1\nallowed_workspace_roots = ["/workspace/demo"]\n[paths]\nvibe_pin_manifest = "/tmp/pin.json"\n`,
      { mode: 0o600 }
    );

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      // Test human output
      await runsUsage({
        subcommand: 'usage',
        positional: ['usage'],
        configPath,
        services: { cleanup: async () => {} }
      });
      expect(output).toContain('| Date | Root | Runs | Tokens | Model Calls | Cost (USD) |');
      expect(output).toContain('2026-10-17');
      expect(output).toContain('/workspace/demo');
      expect(output).toContain('1,250');
      expect(output).toContain('$0.13');
      expect(output).toContain('Total: 1 runs, 1,250 tokens, 3 model calls, $0.13 estimated USD.');

      // Test JSON lines output
      output = '';
      await runsUsage({
        subcommand: 'usage',
        positional: ['usage', '--json'],
        configPath,
        services: { cleanup: async () => {} }
      });
      const lines = output.trim().split('\n').map((line) => JSON.parse(line));
      expect(lines.length).toBe(2);
      expect(lines[0]).toEqual({
        kind: 'row',
        date: '2026-10-17',
        root: '/workspace/demo',
        runs: 1,
        tokens: 1250,
        model_calls: 3,
        cost_usd: 0.125
      });
      expect(lines[1]).toEqual({
        kind: 'summary',
        since: null,
        root: null,
        total_runs: 1,
        total_tokens: 1250,
        total_model_calls: 3,
        total_cost_usd: 0.125
      });
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('rejects new runs and reports readiness blocker when root daily budget is exceeded', async () => {
    const dataDir = await makeDataDir('vsup-rm-budget-');
    const workspace = await makeDataDir('vsup-work-');

    // Write earlier run that consumed $5.00 within 24h
    const priorRecord = makeRunRecord({
      runId: '00000000-0000-4000-8000-000000000001',
      admittedRoot: workspace,
      sourceWorkspace: workspace,
      createdAt: new Date().toISOString(),
      usage: { cost: { amount: 5.0, currency: 'USD', authoritative: false } }
    });
    await saveRun(dataDir, priorRecord);

    // Create config with daily budget of $4.00 for workspace
    const config = validateConfig(
      {
        version: 1,
        allowed_workspace_roots: [workspace],
        budgets: {
          [workspace]: { max_cost_usd_per_day: 4.0 }
        },
        paths: { vibe_pin_manifest: '/tmp/pin.json' }
      },
      undefined,
      { requirePinManifest: false }
    );

    const manager = new RunManager(config, dataDir, [], undefined);
    await manager.initialize();

    // Verify readiness reports blocker
    const status = await manager.readiness({ operation: 'review', workspace });
    expect(status.eligible).toBe(false);
    expect(status.blockers.some((b) => b.code === 'VSUP_BUDGET_EXCEEDED')).toBe(true);

    // Verify start throws VSUP_BUDGET_EXCEEDED
    await expect(
      manager.reviewStart({ task: 'check security', cwd: workspace })
    ).rejects.toMatchObject({
      code: 'VSUP_BUDGET_EXCEEDED',
      details: {
        admitted_root: workspace,
        current_cost_usd: 5.0,
        max_cost_usd_per_day: 4.0
      }
    });

    await manager.shutdown();
  });
});
