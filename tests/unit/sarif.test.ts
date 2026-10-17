import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FindingsArtifact, ReviewFinding } from '../../src/contracts.js';
import { computeFindingFingerprint, convertFindingsToSarif, severityToSarifLevel } from '../../src/core/sarif.js';
import { runsSarif } from '../../src/cli/runs/sarif.js';
import { APP_VERSION } from '../../src/version.js';

describe('SARIF 2.1.0 conversion', () => {
  const sampleFinding: ReviewFinding = {
    id: 'f1',
    ruleId: 'security/no-eval',
    message: 'Direct use of eval detected',
    location: {
      path: 'src/core/runner.ts',
      startLine: 42,
      endLine: 45,
      startColumn: 5,
      endColumn: 18
    },
    severity: 'error'
  };

  const sampleArtifact: FindingsArtifact = {
    version: 1,
    findings: [
      sampleFinding,
      {
        id: 'f2',
        ruleId: 'lint/no-console',
        message: 'Unexpected console.log statement',
        location: { path: 'src/util.ts', startLine: 10 },
        severity: 'warning'
      },
      {
        id: 'f3',
        ruleId: 'perf/avoid-sync-fs',
        message: 'Prefer async fs calls',
        location: { path: 'src/io.ts', startLine: 88 },
        severity: 'info'
      },
      {
        id: 'f4',
        ruleId: 'style/naming',
        message: 'Variable could be const',
        location: { path: 'src/style.ts', startLine: 3 },
        severity: 'hint'
      }
    ],
    rejected: [],
    summary: { total: 4, errors: 1, warnings: 1, info: 1, hints: 1, rejected: 0 }
  };

  it('maps severities to SARIF levels', () => {
    expect(severityToSarifLevel('error')).toBe('error');
    expect(severityToSarifLevel('warning')).toBe('warning');
    expect(severityToSarifLevel('info')).toBe('note');
    expect(severityToSarifLevel('hint')).toBe('note');
  });

  it('computes deterministic partial fingerprint', () => {
    const fingerprint = computeFindingFingerprint(sampleFinding);
    const expected = createHash('sha256')
      .update('security/no-eval:src/core/runner.ts:42')
      .digest('hex');
    expect(fingerprint).toBe(expected);
  });

  it('converts FindingsArtifact to valid SARIF 2.1.0 document', () => {
    const sarif = convertFindingsToSarif(sampleArtifact);

    expect(sarif.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);

    const run = sarif.runs[0]!;
    expect(run.tool.driver.name).toBe('vibe-supervisor');
    expect(run.tool.driver.version).toBe(APP_VERSION);
    expect(run.tool.driver.rules).toHaveLength(4);

    expect(run.results).toHaveLength(4);

    const firstResult = run.results[0]!;
    expect(firstResult.ruleId).toBe('security/no-eval');
    expect(firstResult.level).toBe('error');
    expect(firstResult.message.text).toBe('Direct use of eval detected');
    expect(firstResult.locations[0]!.physicalLocation.artifactLocation).toEqual({
      uri: 'src/core/runner.ts',
      uriBaseId: '%SRCROOT%'
    });
    expect(firstResult.locations[0]!.physicalLocation.region).toEqual({
      startLine: 42,
      endLine: 45,
      startColumn: 5,
      endColumn: 18
    });
    expect(firstResult.partialFingerprints?.['vibeSupervisorFinding/v1']).toBe(
      computeFindingFingerprint(sampleFinding)
    );

    // Levels mapping check
    expect(run.results[1]!.level).toBe('warning');
    expect(run.results[2]!.level).toBe('note');
    expect(run.results[3]!.level).toBe('note');
  });
});

describe('runs sarif CLI subcommand', () => {
  const roots: string[] = [];
  const written: string[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  const runId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    written.length = 0;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  });

  afterEach(async () => {
    writeSpy.mockRestore();
    written.length = 0;
    process.exitCode = undefined;
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  async function setupMockRun(options: { hasFindings?: boolean } = {}): Promise<{ dataDir: string; configPath: string; runDir: string }> {
    const dataDir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-sarif-test-')));
    roots.push(dataDir);
    await chmod(dataDir, 0o700);

    const configPath = path.join(dataDir, 'config.toml');
    await writeFile(configPath, 'version = 1\nallowed_workspace_roots = []\n', { mode: 0o600 });

    const runsDir = path.join(dataDir, 'runs');
    await mkdir(runsDir, { mode: 0o700 });

    const runDir = path.join(runsDir, runId);
    await mkdir(runDir, { mode: 0o700 });

    const meta = {
      schemaVersion: 1,
      runId,
      backend: 'app-server',
      mode: 'review',
      output: 'findings',
      state: 'closed',
      sourceWorkspace: '/repo',
      workerWorkspace: '/repo',
      createdAt: '2026-10-17T10:00:00.000Z',
      updatedAt: '2026-10-17T10:05:00.000Z'
    };
    await writeFile(path.join(runDir, 'meta.json'), JSON.stringify(meta), { mode: 0o600 });

    if (options.hasFindings !== false) {
      const artifactDir = path.join(runDir, 'artifacts');
      await mkdir(artifactDir, { mode: 0o700 });

      const findingsArtifact: FindingsArtifact = {
        version: 1,
        findings: [
          {
            id: 'find-1',
            ruleId: 'security/xss',
            message: 'Potential XSS',
            location: { path: 'src/view.ts', startLine: 12 },
            severity: 'error'
          }
        ],
        rejected: [],
        summary: { total: 1, errors: 1, warnings: 0, info: 0, hints: 0, rejected: 0 }
      };
      await writeFile(path.join(artifactDir, 'findings.json'), JSON.stringify(findingsArtifact), { mode: 0o600 });
    }

    return { dataDir, configPath, runDir };
  }

  it('prints SARIF JSON to stdout', async () => {
    const { configPath } = await setupMockRun({ hasFindings: true });

    await runsSarif({
      subcommand: 'sarif',
      positional: ['sarif', runId],
      configPath,
      services: { cleanup: async () => ({}) }
    });

    const outputText = written.join('');
    const parsed = JSON.parse(outputText) as { version: string; runs: Array<{ results: Array<{ ruleId: string }> }> };
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0]!.results[0]!.ruleId).toBe('security/xss');
  });

  it('writes SARIF JSON to specified --output file', async () => {
    const { configPath, dataDir } = await setupMockRun({ hasFindings: true });
    const outputFile = path.join(dataDir, 'sarif-out.json');

    await runsSarif({
      subcommand: 'sarif',
      positional: ['sarif', runId, '--output', outputFile],
      configPath,
      services: { cleanup: async () => ({}) }
    });

    expect(written).toHaveLength(0);
    const content = await readFile(outputFile, 'utf8');
    const parsed = JSON.parse(content) as { version: string };
    expect(parsed.version).toBe('2.1.0');
  });

  it('throws VSUP_INVALID_STATE when findings artifact is absent', async () => {
    const { configPath } = await setupMockRun({ hasFindings: false });

    await expect(
      runsSarif({
        subcommand: 'sarif',
        positional: ['sarif', runId],
        configPath,
        services: { cleanup: async () => ({}) }
      })
    ).rejects.toMatchObject({
      code: 'VSUP_INVALID_STATE'
    });
  });

  it('rejects invalid run UUID', async () => {
    const { configPath } = await setupMockRun({ hasFindings: true });

    await expect(
      runsSarif({
        subcommand: 'sarif',
        positional: ['sarif', 'not-a-uuid'],
        configPath,
        services: { cleanup: async () => ({}) }
      })
    ).rejects.toThrow();
  });
});
