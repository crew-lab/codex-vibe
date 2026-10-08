import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..');
const report = path.join(repo, 'scripts', 'soak-report.mjs');
const driver = path.join(repo, 'scripts', 'soak.mjs');
const fixture = path.join(repo, 'tests', 'fixtures', 'fake-supervisor-server.mjs');
const canonicalTmp = await realpath(tmpdir());
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

type Json = Record<string, unknown>;
interface Outcome { code: number | null; stdout: string; stderr: string }

function run(script: string, args: string[], env: Record<string, string> = {}): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function git(workspace: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', workspace, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed`))));
  });
}

async function directoryWith(summary: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(canonicalTmp, 'vsup-report-')); scratch.push(directory);
  await writeFile(path.join(directory, 'summary.json'), typeof summary === 'string' ? summary : JSON.stringify(summary));
  return directory;
}

const bucket = (runs: number, failed = 0) => ({ runs, ok: runs - failed, failed });
const latency = (count: number, p50: number, p95: number) => ({ count, p50, p95 });
const home = () => ({ run_directories: 5, total_bytes: 1000, runs_bytes: 900, max_run_bytes: 300, per_run_limit_bytes: 1000, oversized_runs: [], leftover_worktrees: [], missing_runs: [] });
const truncationDetail = (truncated: number, completed: number) => `${truncated} of ${completed} completed runs ended truncated (${((truncated * 100) / completed).toFixed(1)}%, limit 10% overall and per kind and backend)`;
const criteria = (change: (item: Json) => Json = (item) => item): Json[] => [
  { id: 'zero_unexpected_failures', status: 'PASS', detail: '0 unexpected failures' },
  { id: 'zero_permission_requests', status: 'PASS', detail: '0 permission or input requests' },
  { id: 'no_leaked_processes_or_worktrees', status: 'PASS', detail: '0 orphaned or descendant vibe processes, 0 leftover worktrees' },
  { id: 'bounded_artifacts', status: 'PASS', detail: '0 run directories above the per-run limit' },
  { id: 'retention_keeps_recent_runs', status: 'PASS', detail: '0 recorded runs missing from disk (retention.days 14)' },
  { id: 'truncated_within_threshold', status: 'PASS', detail: truncationDetail(3, 100) },
  { id: 'all_planned_runs', status: 'PASS', detail: '100/100 runs attempted' },
  { id: 'acp_scenarios_exercised', status: 'PASS', detail: 'Requires successful continuation, reload and exercised mid-turn close.' },
].map(change);

function passing(): Json {
  return {
    schema_version: 1,
    total_timeout_seconds: 7200,
    time_limit_reached: false,
    diagnostics_enabled: false,
    started_at: '2026-10-09T08:00:00.000Z',
    finished_at: '2026-10-09T09:55:00.000Z',
    seed: 'soak',
    node: 'v24.19.0',
    platform: 'darwin-arm64',
    server_command: ['node', 'dist/cli.js', 'serve', '--stdio'],
    plan: { reviews: 60, edits: 30, acp: 10, hosted_turns: 160 },
    stopped_early: false,
    fatal: null,
    totals: { runs: 100, ok: 100, failed: 0 },
    by_kind: { review: bucket(60), edit: bucket(30), acp: bucket(10) },
    by_backend: { programmatic: bucket(90), acp: bucket(10) },
    by_scenario: { review: bucket(60) },
    truncated: { runs: 3, by_kind: { review: 3 }, by_backend: { programmatic: 3 } },
    task_compliance: { audited: 58, unavailable: 2, over_bounds: 4, final_answer_missing: 1, edits_outside_requested_file: 2 },
    latency_ms: { time_to_first_event: latency(95, 1200, 4100), time_to_settled: latency(95, 14000, 38000) },
    failures_by_code: {},
    permission_requests: 0,
    restarts: { reloaded: 3, error: 0, other: 0, not_exercised: 0 },
    close_mid_turn: { exercised: 3, not_exercised: 0 },
    tool_calls: 700,
    events: 5000,
    cost: { reported: 100, amount: 2.5, currency: 'USD', authoritative: false },
    leftovers: { processes: { baseline: [], after: [], new_unrelated: [], leaked: [] }, registered_worktrees: [], homes: { programmatic: home(), acp: home() } },
    servers: [],
    criteria: criteria(),
    result: 'PASS',
  };
}

const withoutAcp = (items: Json[]) => items.filter((item) => item.id !== 'acp_scenarios_exercised');
const reportFor = (summary: unknown, extra: string[] = []) => directoryWith(summary).then((directory) => run(report, [directory, '--candidate', 'rc.9', '--commit', 'abc1234', '--date', '2026-10-09', ...extra]));

describe('soak report', () => {
  it('turns a passing full soak into a row, a verdict and evidence lines', async () => {
    const outcome = await reportFor(passing());
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('| D18 soak, rc.9 (abc1234, 2026-10-09) | PASS: 100/100 runs: 100 ok, 0 failed; 3 of 100 completed runs truncated; 0 permission requests; settled p50 14000 ms, p95 38000 ms; cost 2.5 USD (non-authoritative) |');
    expect(outcome.stdout).toContain('Supervisor reliability: PASS');
    expect(outcome.stdout).toContain('| truncated_within_threshold | 3 of 100 completed runs truncated (3.0%) | at most 10% overall and per kind and backend | PASS |');
    expect(outcome.stdout).toContain('| all_planned_runs | 100/100 runs attempted | every planned run attempted | PASS |');
    expect(outcome.stdout).toContain('Model task compliance (informational, not part of the verdict):');
    expect(outcome.stdout).toContain('- over_bounds: 4');
    expect(outcome.stdout).toContain('candidate rc.9; commit abc1234; date 2026-10-09; darwin-arm64; Node v24.19.0; Vibe version and model not recorded in summary.json; 100 of 100 planned runs (60 reviews, 30 edits, 10 ACP runs); backends 10 acp, 90 programmatic; seed soak; source: soak summary.json');
    expect(outcome.stdout).not.toContain('FAIL');
  });

  it('accepts the summary file path and emits json', async () => {
    const directory = await directoryWith(passing());
    const outcome = await run(report, [path.join(directory, 'summary.json'), '--format', 'json']);
    expect(outcome.code).toBe(0);
    const parsed = JSON.parse(outcome.stdout);
    expect(parsed.verdict.result).toBe('PASS');
    expect(parsed.verdict.supervisor_reliability).toBe('PASS');
    expect(parsed.candidate).toBeNull();
    expect(parsed.row.step).toBe('D18 soak, candidate not recorded');
    expect(parsed.verdict.criteria).toHaveLength(8);
    expect(parsed.evidence.length).toBeGreaterThanOrEqual(8);
    expect(parsed.evidence.every((line: { evidence: string }) => line.evidence.includes('candidate not recorded'))).toBe(true);
  });

  it('reports a failure that stopped the soak early with the failing criterion and its code', async () => {
    const summary = passing();
    Object.assign(summary, {
      stopped_early: true,
      totals: { runs: 20, ok: 19, failed: 1 },
      by_kind: { review: bucket(12), edit: bucket(8, 1) },
      by_backend: { programmatic: bucket(20, 1) },
      truncated: { runs: 0, by_kind: {}, by_backend: {} },
      failures_by_code: { VSUP_TIMEOUT: 1 },
      criteria: withoutAcp(criteria((item) => {
        if (item.id === 'zero_unexpected_failures') return { ...item, status: 'FAIL', detail: '1 unexpected failures' };
        if (item.id === 'all_planned_runs') return { ...item, status: 'FAIL', detail: '20/100 runs attempted' };
        if (item.id === 'truncated_within_threshold') return { ...item, detail: truncationDetail(0, 19) };
        return item;
      })),
      result: 'FAIL',
    });
    const outcome = await reportFor(summary);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('| D18 soak, rc.9 (abc1234, 2026-10-09) | FAIL at 20/100: 19 ok, 1 failed; failures by code: VSUP_TIMEOUT 1;');
    expect(outcome.stdout).toContain('failed criteria: zero_unexpected_failures, all_planned_runs; stopped early');
    expect(outcome.stdout).toContain('| zero_unexpected_failures | 1 unexpected failures (VSUP_TIMEOUT 1) | 0, no fatal error | FAIL |');
    expect(outcome.stdout).toContain('Supervisor reliability: FAIL');
    expect(outcome.stdout).toContain('Failures by code: VSUP_TIMEOUT 1');
  });

  it('fails the truncation criterion over the threshold and names the bucket', async () => {
    const summary = passing();
    Object.assign(summary, {
      truncated: { runs: 15, by_kind: { review: 15 }, by_backend: { programmatic: 15 } },
      criteria: criteria((item) => (item.id === 'truncated_within_threshold'
        ? { ...item, status: 'FAIL', detail: `${truncationDetail(15, 100)}; kind review: 15 of 60 (25.0%) exceeds the limit; backend programmatic: 15 of 90 (16.7%) exceeds the limit` }
        : item)),
      result: 'FAIL',
    });
    const outcome = await reportFor(summary);
    expect(outcome.stdout).toContain('| truncated_within_threshold | 15 of 100 completed runs truncated (15.0%); kind review: 15 of 60 (25.0%); backend programmatic: 15 of 90 (16.7%) | at most 10% overall and per kind and backend | FAIL |');
    expect(outcome.stdout).toContain('failed criteria: truncated_within_threshold');
  });

  it('keeps model task compliance violations out of the verdict', async () => {
    const summary = passing();
    summary.task_compliance = { audited: 60, unavailable: 0, over_bounds: 40, final_answer_missing: 25, edits_outside_requested_file: 10 };
    const directory = await directoryWith(summary);
    const outcome = await run(report, [directory]);
    expect(outcome.stdout).toContain('Supervisor reliability: PASS');
    expect(outcome.stdout).toContain('- over_bounds: 40');
    expect(outcome.stdout).toContain('- final_answer_missing: 25');
    expect(outcome.stdout).toContain('Task compliance, informational: 60 runs audited, 0 records unavailable, 40 over their read or search bounds, 25 without a final answer, 10 edits outside the requested file');
    expect(JSON.parse((await run(report, [directory, '--format', 'json'])).stdout).verdict.result).toBe('PASS');
  });

  it('reports values absent from the summary as not recorded without inventing them', async () => {
    const summary = passing();
    for (const key of ['task_compliance', 'latency_ms', 'cost', 'restarts', 'node', 'platform', 'seed']) delete summary[key];
    const outcome = await reportFor(summary);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('Task compliance: not recorded');
    expect(outcome.stdout).toContain('Latency percentiles: not recorded');
    expect(outcome.stdout).toContain('Cost: not recorded');
    expect(outcome.stdout).toContain('Node not recorded; Vibe version and model not recorded');
    expect(outcome.stdout).toContain('- not recorded');
    expect(outcome.stdout).not.toContain('settled p50');
  });

  it('marks an overall time limit as incomplete', async () => {
    const summary = passing();
    Object.assign(summary, {
      time_limit_reached: true,
      stopped_early: true,
      result: 'INCOMPLETE',
      totals: { runs: 80, ok: 80, failed: 0 },
      by_kind: { review: bucket(60), edit: bucket(20) },
      by_backend: { programmatic: bucket(80) },
      truncated: { runs: 0, by_kind: {}, by_backend: {} },
      criteria: withoutAcp(criteria((item) => {
        if (item.id === 'all_planned_runs') return { ...item, status: 'FAIL', detail: '80/100 runs attempted' };
        if (item.id === 'truncated_within_threshold') return { ...item, detail: truncationDetail(0, 80) };
        return item;
      })),
    });
    const outcome = await reportFor(summary);
    expect(outcome.stdout).toContain('INCOMPLETE at 80/100');
    expect(outcome.stdout).toContain('overall time limit reached');
    expect(outcome.stdout).toContain('Supervisor reliability: INCOMPLETE');
  });

  it.each<[string, unknown, string]>([
    ['not json', '{', 'not valid JSON'],
    ['an array', '[]', 'must hold a JSON object'],
    ['a wrong schema version', { ...passing(), schema_version: 2 }, 'schema_version must be 1'],
    ['a missing totals field', { ...passing(), totals: { runs: 100, ok: 100 } }, 'totals.failed must be a non-negative integer'],
    ['a string count', { ...passing(), permission_requests: '0' }, 'permission_requests must be a non-negative integer'],
    ['an unknown result', { ...passing(), result: 'GREEN' }, 'result must be PASS, FAIL or INCOMPLETE'],
    ['a malformed optional section', { ...passing(), cost: { reported: 1, amount: 'two' } }, 'cost.amount must be a non-negative number when present'],
    ['a missing criterion', { ...passing(), criteria: criteria().filter((item) => item.id !== 'bounded_artifacts') }, 'criteria is missing bounded_artifacts'],
    ['totals that do not add up', { ...passing(), totals: { runs: 100, ok: 90, failed: 0 } }, 'totals.ok plus totals.failed must equal totals.runs'],
    ['more runs than planned', { ...passing(), plan: { reviews: 1, edits: 0, acp: 0, hosted_turns: 1 } }, 'totals.runs exceeds the planned runs'],
    ['an unreadable truncation detail', { ...passing(), criteria: criteria((item) => (item.id === 'truncated_within_threshold' ? { ...item, detail: 'some truncation' } : item)) }, 'truncated_within_threshold detail does not have the format'],
    ['a recorded status that the fields contradict', { ...passing(), permission_requests: 2 }, 'zero_permission_requests is recorded PASS but its fields measure FAIL'],
    ['a PASS result over a failing criterion', { ...passing(), failures_by_code: { VSUP_TIMEOUT: 1 }, criteria: criteria((item) => (item.id === 'zero_unexpected_failures' ? { ...item, status: 'FAIL' } : item)) }, 'result is PASS but a criterion fails'],
  ])('rejects %s with a clear error and a non-zero exit', async (_name, summary, message) => {
    const outcome = await reportFor(summary);
    expect(outcome.code).toBe(2);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain(message);
  });

  it('rejects a missing path, a directory without summary.json and bad options', async () => {
    const empty = await mkdtemp(path.join(canonicalTmp, 'vsup-report-')); scratch.push(empty);
    expect((await run(report, [path.join(empty, 'missing')])).stderr).toContain('Cannot read');
    expect((await run(report, [empty])).stderr).toContain('No summary.json');
    const input = await directoryWith(passing());
    for (const args of [[], [input, '--commit', 'xyz'], [input, '--date', '2026-02-30'], [input, '--format', 'html'], [input, '--bogus'], [input, input], [input, '--candidate']]) {
      const outcome = await run(report, args);
      expect(outcome.code).toBe(2);
      expect(outcome.stdout).toBe('');
      expect(outcome.stderr.length).toBeGreaterThan(0);
    }
  });

  it('does not write into the soak directory', async () => {
    const directory = await directoryWith(passing());
    const before = await readFile(path.join(directory, 'summary.json'), 'utf8');
    await run(report, [directory]);
    expect(await readFile(path.join(directory, 'summary.json'), 'utf8')).toBe(before);
  });

  it('reports a summary produced by the real driver against the fake supervisor', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-report-driver-')); scratch.push(parent);
    const workspace = path.join(parent, 'workspace');
    const template = path.join(parent, 'template');
    const out = path.join(parent, 'evidence');
    await mkdir(workspace); await mkdir(template, { mode: 0o700 });
    await writeFile(path.join(workspace, 'a.js'), 'console.log(1);\n');
    await git(workspace, ['init', '-q']); await git(workspace, ['add', 'a.js']); await git(workspace, ['commit', '-qm', 'init']);
    await writeFile(path.join(template, 'config.toml'), `version = 1\nbackend = "programmatic"\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n`, { mode: 0o600 });
    const soak = await run(driver, ['--workspace', workspace, '--reviews', '2', '--edits', '1', '--acp', '0', '--yes', '--out', out, '--server-command', process.execPath, '--server-arg', fixture, '--start-wait', '0', '--wait-seconds', '20'], { VIBE_SUPERVISOR_HOME: template, VIBE_SUPERVISOR_DIST_DIR: process.env.VIBE_SUPERVISOR_TEST_DIST ?? '', FAKE_EVENT_LOG: path.join(parent, 'fake.log') });
    expect(soak.code).toBe(0);
    const outcome = await run(report, [out, '--candidate', 'rc.test', '--format', 'json']);
    expect(outcome.stderr).toBe('');
    expect(outcome.code).toBe(0);
    const parsed = JSON.parse(outcome.stdout);
    const summary = JSON.parse(await readFile(path.join(out, 'summary.json'), 'utf8'));
    expect(parsed.verdict.result).toBe(summary.result);
    expect(parsed.verdict.result).toBe('PASS');
    expect(parsed.row.result).toContain(`PASS: ${summary.totals.runs}/3 runs`);
    expect(parsed.verdict.criteria.map((item: { id: string }) => item.id).sort()).toEqual(summary.criteria.map((item: { id: string }) => item.id).sort());
  }, 100_000);
});
