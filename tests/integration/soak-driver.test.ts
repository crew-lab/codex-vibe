import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..');
const driver = path.join(repo, 'scripts', 'soak.mjs');
const fixture = path.join(repo, 'tests', 'fixtures', 'fake-supervisor-server.mjs');
const canonicalTmp = await realpath(tmpdir());
const scratch: string[] = [];
const strays: number[] = [];

afterEach(async () => {
  for (const pid of strays.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

interface Criterion { id: string; status: string; detail: string }
interface Summary {
  result: string;
  totals: { runs: number; ok: number; failed: number };
  by_kind: Record<string, { runs: number; ok: number; failed: number }>;
  by_backend: Record<string, { runs: number; ok: number; failed: number }>;
  latency_ms: { time_to_first_event: { count: number; p50: number | null; p95: number | null }; time_to_settled: { count: number; p50: number | null; p95: number | null } };
  failures_by_code: Record<string, number>;
  permission_requests: number;
  restarts: { reloaded: number; error: number; other: number; not_exercised: number };
  close_mid_turn: { exercised: number; not_exercised: number };
  stopped_early: boolean;
  truncated: { runs: number; by_kind: Record<string, number>; by_backend: Record<string, number> };
  cost: { reported: number; amount: number };
  leftovers: { processes: { leaked: { pid: number }[] }; homes: Record<string, { leftover_worktrees: string[]; total_bytes: number; missing_runs: string[] }> };
  servers: { backend: string; servers_started: number }[];
  criteria: Criterion[];
}
interface RunRecord {
  backend: string; kind: string; scenario: string | null; taskId: string; runId: string | null; toolCalls: number; events: number;
  permissionRequests: number; requests: { responded: string | null }[]; timeToFirstEventMs: number | null; timeToSettledMs: number | null;
  finalState: string | null; stopReason: string | null; integrity: string | null; closeState: string | null; worktreeRemoved: boolean | null;
  restart: { outcome?: string; exercised: boolean } | null; closeMid: { exercised: boolean } | null; usage: unknown;
  turns: { label: string; state: string | null }[]; failures: { code: string }[]; ok: boolean;
}

async function sandbox() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-soak-')); scratch.push(parent);
  const workspace = path.join(parent, 'workspace');
  const template = path.join(parent, 'template');
  await mkdir(workspace); await mkdir(template, { mode: 0o700 });
  await writeFile(path.join(workspace, 'a.js'), 'console.log(1);\n');
  await writeFile(path.join(workspace, '.env'), 'TOKEN=fake\n');
  await git(workspace, ['init', '-q']);
  await git(workspace, ['add', 'a.js']);
  await git(workspace, ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init']);
  const configPath = path.join(template, 'config.toml');
  await writeFile(configPath, `version = 1\nbackend = "programmatic"\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n`, { mode: 0o600 });
  return { parent, workspace, template, configPath, out: path.join(parent, 'evidence'), log: path.join(parent, 'fake.log') };
}

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed`))));
  });
}

interface Outcome { code: number | null; stdout: string; stderr: string }

function soak(box: Awaited<ReturnType<typeof sandbox>>, args: string[], env: Record<string, string> = {}): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [driver, '--workspace', box.workspace, ...args], {
      env: { ...process.env, VIBE_SUPERVISOR_HOME: box.template, VIBE_SUPERVISOR_DIST_DIR: process.env.VIBE_SUPERVISOR_TEST_DIST ?? '', FAKE_EVENT_LOG: box.log, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 100_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const real = (box: Awaited<ReturnType<typeof sandbox>>, counts: { reviews: number; edits: number; acp: number }, extra: string[] = []) => [
  '--reviews', String(counts.reviews), '--edits', String(counts.edits), '--acp', String(counts.acp),
  '--yes', '--out', box.out, '--server-command', process.execPath, '--server-arg', fixture,
  '--start-wait', '0', '--wait-seconds', '20', ...extra,
];

const readSummary = async (box: Awaited<ReturnType<typeof sandbox>>) => JSON.parse(await readFile(path.join(box.out, 'summary.json'), 'utf8')) as Summary;
const readRuns = async (box: Awaited<ReturnType<typeof sandbox>>) => (await readFile(path.join(box.out, 'runs.ndjson'), 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as RunRecord);
const criterion = (summary: Summary, id: string) => summary.criteria.find((item) => item.id === id)?.status;
const fakeLog = async (box: Awaited<ReturnType<typeof sandbox>>) => (await readFile(box.log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { operation: string; optionId?: string; runId?: string });
const digest = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');
const exists = (file: string) => stat(file).then(() => true, () => false);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('soak driver', () => {
  it('prints the plan and a cost warning and starts nothing without --yes', async () => {
    const box = await sandbox();
    const outcome = await soak(box, ['--reviews', '2', '--edits', '1', '--acp', '2', '--out', box.out, '--server-command', process.execPath, '--server-arg', fixture]);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('runs: 5 (reviews 2, edits 1, acp 2)');
    expect(outcome.stdout).toContain('COST WARNING');
    expect(outcome.stdout).toContain('Nothing was started');
    expect(await exists(box.out)).toBe(false);
    expect(await exists(box.log)).toBe(false);
  });

  it('refuses more than 500 runs, unknown options and a workspace outside the template allowlist', async () => {
    const box = await sandbox();
    const tooMany = await soak(box, ['--reviews', '300', '--edits', '201']);
    expect(tooMany.code).toBe(2);
    expect(tooMany.stderr).toContain('500');
    expect((await soak(box, ['--bogus'])).code).toBe(2);
    await writeFile(box.configPath, `version = 1\nbackend = "programmatic"\nallowed_workspace_roots = [${JSON.stringify(path.join(box.parent, 'elsewhere'))}]\n`, { mode: 0o600 });
    const denied = await soak(box, real(box, { reviews: 1, edits: 0, acp: 0 }));
    expect(denied.code).toBe(2);
    expect(denied.stderr).toContain('allowlist');
    expect(await exists(box.out)).toBe(false);
    expect(await exists(box.log)).toBe(false);
  });

  it('runs a clean mixed soak, records every run and passes every criterion', async () => {
    const box = await sandbox();
    const before = await digest(box.configPath);
    const templateListing = await readdir(box.template);
    const outcome = await soak(box, real(box, { reviews: 3, edits: 2, acp: 4 }), { FAKE_MODE_ACP: 'slow', FAKE_DELAY_MS: '60' });
    expect(outcome.stderr).not.toContain('FAILED');
    expect(outcome.code).toBe(0);
    const summary = await readSummary(box);
    expect(summary.result).toBe('PASS');
    expect(summary.criteria.map((item) => item.status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
    expect(criterion(summary, 'truncated_within_threshold')).toBe('PASS');
    expect(summary.truncated.runs).toBe(0);
    expect(summary.totals).toEqual({ runs: 9, ok: 9, failed: 0 });
    expect(summary.by_kind).toMatchObject({ review: { runs: 3 }, edit: { runs: 2 }, acp: { runs: 4 } });
    expect(summary.by_backend).toMatchObject({ programmatic: { runs: 5 }, acp: { runs: 4 } });
    expect(summary.latency_ms.time_to_first_event.count).toBeGreaterThanOrEqual(5);
    expect(summary.latency_ms.time_to_settled.p50).toBeGreaterThan(0);
    expect(summary.latency_ms.time_to_settled.p95).toBeGreaterThanOrEqual(summary.latency_ms.time_to_settled.p50 ?? 0);
    expect(summary.failures_by_code).toEqual({});
    expect(summary.permission_requests).toBe(0);
    expect(summary.restarts.reloaded).toBe(2);
    expect(summary.close_mid_turn.exercised).toBe(1);
    expect(summary.cost.reported).toBeGreaterThan(0);
    expect(summary.leftovers.processes.leaked).toEqual([]);
    expect(Object.values(summary.leftovers.homes).flatMap((home) => home.leftover_worktrees)).toEqual([]);
    expect(summary.servers.find((item) => item.backend === 'acp')?.servers_started).toBe(3);

    const runs = await readRuns(box);
    expect(runs).toHaveLength(9);
    for (const run of runs) {
      expect(run.ok).toBe(true);
      expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(run.taskId).toMatch(/^[a-z-]+$/);
      expect(run.toolCalls).toBeGreaterThanOrEqual(3);
      expect(run.closeState).toBe('closed');
      expect(run.events).toBeGreaterThan(0);
    }
    const text = await readFile(path.join(box.out, 'runs.ndjson'), 'utf8');
    expect(text).not.toContain('Review the file');
    expect(text).not.toContain('Create one new file');
    expect(runs.filter((run) => run.kind === 'edit').every((run) => run.worktreeRemoved === true)).toBe(true);
    expect(runs.filter((run) => run.kind === 'review').every((run) => run.integrity === 'verified' && run.stopReason === 'end_turn')).toBe(true);
    const byScenario = Object.fromEntries(runs.filter((run) => run.scenario).map((run) => [run.scenario, run]));
    expect(byScenario.continue?.turns.map((turn) => turn.label)).toEqual(['start', 'continue']);
    expect(byScenario.close_mid?.closeMid).toEqual(expect.objectContaining({ exercised: true }));
    expect(byScenario.close_mid?.closeState).toBe('closed');
    expect(byScenario.restart_completed?.restart).toMatchObject({ outcome: 'reloaded' });
    expect(byScenario.restart_in_progress?.restart).toMatchObject({ outcome: 'reloaded', exercised: true });

    const operations = await fakeLog(box);
    expect(operations.filter((item) => item.operation === 'start')).toHaveLength(9);
    expect(operations.filter((item) => item.operation === 'recover').length).toBeGreaterThanOrEqual(2);
    expect(operations.filter((item) => item.operation === 'respond')).toEqual([]);

    expect(await digest(box.configPath)).toBe(before);
    expect(await readdir(box.template)).toEqual(templateListing);
    for (const target of [box.out, path.join(box.out, 'home-programmatic'), path.join(box.out, 'home-acp')]) expect((await stat(target)).mode & 0o077).toBe(0);
    for (const file of ['runs.ndjson', 'summary.json', 'home-programmatic/config.toml', 'home-acp/config.toml']) expect((await stat(path.join(box.out, file))).mode & 0o077).toBe(0);
    expect(await readFile(path.join(box.out, 'home-acp', 'config.toml'), 'utf8')).toContain('backend = "acp"');
    expect(await readFile(path.join(box.out, 'home-programmatic', 'config.toml'), 'utf8')).toContain('backend = "programmatic"');
  }, 120_000);

  it('orders runs deterministically for a seed', async () => {
    const first = await sandbox(); const second = await sandbox();
    const args = (box: Awaited<ReturnType<typeof sandbox>>) => real(box, { reviews: 6, edits: 0, acp: 0 }, ['--seed', 'repeatable']);
    expect((await soak(first, args(first))).code).toBe(0);
    expect((await soak(second, args(second))).code).toBe(0);
    const sequence = async (box: Awaited<ReturnType<typeof sandbox>>) => (await readRuns(box)).map((run) => run.taskId);
    expect(await sequence(first)).toEqual(await sequence(second));
  }, 60_000);

  it('answers a permission request with the reject option, counts it, and fails the criterion', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 0, edits: 0, acp: 1 }), { FAKE_MODE_ACP: 'permission' });
    expect(outcome.code).toBe(1);
    const summary = await readSummary(box);
    expect(criterion(summary, 'zero_permission_requests')).toBe('FAIL');
    expect(criterion(summary, 'zero_unexpected_failures')).toBe('PASS');
    expect(summary.result).toBe('FAIL');
    const [run] = await readRuns(box);
    expect(run?.permissionRequests).toBe(1);
    expect(run?.requests[0]?.responded).toBe('reject');
    expect(run?.finalState).toBe('completed');
    const responses = (await fakeLog(box)).filter((item) => item.operation === 'respond');
    expect(responses.map((item) => item.optionId)).toEqual(['reject-once']);
  }, 60_000);

  it('fails the unexpected-failure criterion for a backend failure and stops early on request', async () => {
    const box = await sandbox();
    const env = { FAKE_MODE_PROGRAMMATIC: 'crash', FAKE_ONLY_NTH: '2' };
    const outcome = await soak(box, real(box, { reviews: 4, edits: 0, acp: 0 }), env);
    expect(outcome.code).toBe(1);
    const summary = await readSummary(box);
    expect(criterion(summary, 'zero_unexpected_failures')).toBe('FAIL');
    expect(criterion(summary, 'zero_permission_requests')).toBe('PASS');
    expect(summary.failures_by_code).toEqual({ VSUP_BACKEND_CRASHED: 1 });
    expect(summary.totals).toEqual({ runs: 4, ok: 3, failed: 1 });

    const stopping = await sandbox();
    const stopped = await soak(stopping, real(stopping, { reviews: 4, edits: 0, acp: 0 }, ['--stop-on-fail']), env);
    expect(stopped.code).toBe(1);
    const stoppedSummary = await readSummary(stopping);
    expect(stoppedSummary.stopped_early).toBe(true);
    expect(stoppedSummary.totals.runs).toBe(2);
  }, 90_000);

  it('enforces the per-run timeout, closes the run and records it as failed', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 1, edits: 0, acp: 0 }, ['--run-timeout', '2', '--wait-seconds', '1']), { FAKE_MODE_PROGRAMMATIC: 'slow', FAKE_DELAY_MS: '5000' });
    expect(outcome.code).toBe(1);
    const [run] = await readRuns(box);
    expect(run?.failures.map((failure) => failure.code)).toContain('driver:run_timeout');
    expect(run?.closeState).toBe('closed');
    expect(run?.ok).toBe(false);
    expect(criterion(await readSummary(box), 'zero_unexpected_failures')).toBe('FAIL');
  }, 60_000);

  it('lets the supervisor settle a silent worker before the driver deadline', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 0, edits: 1, acp: 0 }, ['--run-timeout', '60', '--wait-seconds', '1']), { FAKE_MODE_PROGRAMMATIC: 'silent' });
    expect(outcome.code).toBe(1);
    const [run] = await readRuns(box);
    expect(run?.failures.map((failure) => failure.code)).toContain('VSUP_TIMEOUT');
    expect(run?.failures.map((failure) => failure.code)).not.toContain('driver:run_timeout');
    expect(run?.closeState).toBe('closed');
    expect(run?.worktreeRemoved).toBe(true);
    const starts = (await readFile(box.log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((entry) => entry.operation === 'start');
    expect(starts[0].timeoutSeconds).toBe(30);
  }, 60_000);

  it('preserves a shorter configured worker deadline', async () => {
    const box = await sandbox();
    await writeFile(box.configPath, (await readFile(box.configPath, 'utf8')) + '\n[limits]\nreview_timeout_seconds = 45\n');
    expect((await soak(box, real(box, { reviews: 1, edits: 0, acp: 0 }))).code).toBe(0);
    const starts = (await readFile(box.log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((entry) => entry.operation === 'start');
    expect(starts[0].timeoutSeconds).toBe(45);
  });

  it('preserves only validated diagnostic fields before closing the run', async () => {
    const box = await sandbox();
    expect((await soak(box, real(box, { reviews: 1, edits: 0, acp: 0 }, ['--diagnostics']), { FAKE_DIAGNOSTICS_MODE: 'valid' })).code).toBe(0);
    const [run] = await readRuns(box);
    const file = path.join(box.out, 'diagnostics', `${run?.runId}.json`);
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain('PRIVATE-FIXTURE-CANARY');
    expect(JSON.parse(text)).toEqual({ schema_version: 1, stages: [{ stage: 'launch', elapsed_ms: 1 }], snapshots: [] });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('rejects symlinked diagnostics without changing the run outcome', async () => {
    const box = await sandbox();
    expect((await soak(box, real(box, { reviews: 1, edits: 0, acp: 0 }, ['--diagnostics']), { FAKE_DIAGNOSTICS_MODE: 'symlink' })).code).toBe(0);
    expect(await exists(path.join(box.out, 'diagnostics'))).toBe(false);
    expect((await readRuns(box))[0]?.closeState).toBe('closed');
  });

  it('bounds the overall hosted budget and cleans up without starting another run', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 3, edits: 0, acp: 0 }, ['--total-timeout', '63', '--wait-seconds', '1', '--diagnostics']), { FAKE_MODE_PROGRAMMATIC: 'silent' });
    expect(outcome.code).toBe(1);
    const summary = await readSummary(box);
    expect(summary.result).toBe('INCOMPLETE');
    expect(summary.totals.runs).toBe(1);
    const [run] = await readRuns(box);
    expect(run?.failures.map((failure) => failure.code)).toContain('driver:total_timeout');
    expect(run?.closeState).toBe('closed');
    expect(criterion(summary, 'no_leaked_processes_or_worktrees')).toBe('PASS');
    expect((await fakeLog(box)).filter((entry) => entry.operation === 'start')).toHaveLength(1);
  }, 30_000);

  it('survives a server that exits mid-soak, records the failure and carries on with a fresh server', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 3, edits: 0, acp: 0 }), { FAKE_MODE_PROGRAMMATIC: 'exit', FAKE_ONLY_NTH: '2' });
    expect(outcome.code).toBe(1);
    const summary = await readSummary(box);
    expect(summary.totals.runs).toBe(3);
    expect(summary.totals.failed).toBeGreaterThanOrEqual(1);
    expect(summary.totals.ok).toBeGreaterThanOrEqual(1);
    expect(summary.servers.find((item) => item.backend === 'programmatic')?.servers_started).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it('reports a truncated run with the partial-result warning in its own bucket without failing the soak', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 10, edits: 0, acp: 0 }), { FAKE_MODE_PROGRAMMATIC: 'truncated', FAKE_ONLY_NTH: '3' });
    expect(outcome.code).toBe(0);
    const summary = await readSummary(box);
    expect(summary.result).toBe('PASS');
    expect(summary.truncated).toEqual({ runs: 1, by_kind: { review: 1 }, by_backend: { programmatic: 1 } });
    expect(summary.failures_by_code).toEqual({});
    expect(criterion(summary, 'zero_unexpected_failures')).toBe('PASS');
    expect(criterion(summary, 'truncated_within_threshold')).toBe('PASS');
    const runs = await readRuns(box);
    expect(runs.filter((run) => run.stopReason === 'max_turn_requests')).toHaveLength(1);
    expect(runs.every((run) => run.ok)).toBe(true);
  }, 90_000);

  it('counts max_tokens with the warning as truncated too', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 10, edits: 0, acp: 0 }), { FAKE_MODE_PROGRAMMATIC: 'truncated', FAKE_ONLY_NTH: '1', FAKE_STOP_REASON: 'max_tokens' });
    expect(outcome.code).toBe(0);
    expect((await readSummary(box)).truncated.runs).toBe(1);
  }, 90_000);

  it('fails truncated_within_threshold above the configured percentage and honours --max-truncated-percent', async () => {
    const box = await sandbox();
    const env = { FAKE_MODE_PROGRAMMATIC: 'truncated', FAKE_ONLY_NTH: '2' };
    const outcome = await soak(box, real(box, { reviews: 4, edits: 0, acp: 0 }), env);
    expect(outcome.code).toBe(1);
    const summary = await readSummary(box);
    expect(criterion(summary, 'truncated_within_threshold')).toBe('FAIL');
    expect(criterion(summary, 'zero_unexpected_failures')).toBe('PASS');
    expect(summary.result).toBe('FAIL');
    const relaxed = await sandbox();
    expect((await soak(relaxed, real(relaxed, { reviews: 4, edits: 0, acp: 0 }, ['--max-truncated-percent', '25']), env)).code).toBe(0);
    expect(criterion(await readSummary(relaxed), 'truncated_within_threshold')).toBe('PASS');
    expect((await soak(box, ['--max-truncated-percent', '101'])).code).toBe(2);
  }, 90_000);

  it('still fails max_turn_requests without the partial-result warning', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 3, edits: 0, acp: 0 }), { FAKE_MODE_PROGRAMMATIC: 'truncated', FAKE_ONLY_NTH: '2', FAKE_STRIP_WARNINGS: '1' });
    expect(outcome.code).toBe(1);
    const summary = await readSummary(box);
    expect(summary.failures_by_code).toEqual({ 'driver:stop_reason_max_turn_requests': 1 });
    expect(summary.truncated.runs).toBe(0);
    expect(criterion(summary, 'zero_unexpected_failures')).toBe('FAIL');
  }, 90_000);

  it('does not stop on truncation with --stop-on-fail', async () => {
    const box = await sandbox();
    const outcome = await soak(box, real(box, { reviews: 10, edits: 0, acp: 0 }, ['--stop-on-fail']), { FAKE_MODE_PROGRAMMATIC: 'truncated', FAKE_ONLY_NTH: '1' });
    expect(outcome.code).toBe(0);
    const summary = await readSummary(box);
    expect(summary.stopped_early).toBe(false);
    expect(summary.totals.runs).toBe(10);
    expect(summary.truncated.runs).toBe(1);
  }, 90_000);

  it('sends bounded built-in tasks that name their limits and require a final answer', async () => {
    const box = await sandbox();
    expect((await soak(box, real(box, { reviews: 2, edits: 2, acp: 4 }))).code).toBe(0);
    const operations = await readFile(box.log, 'utf8');
    const entries = operations.trim().split('\n').map((line) => JSON.parse(line) as { operation: string; task?: string; message?: string });
    const tasks = entries.filter((entry) => entry.operation === 'start').map((entry) => entry.task ?? '');
    expect(tasks).toHaveLength(8);
    const long = tasks.filter((task) => task.startsWith('Read every source file'));
    expect(long.length).toBeGreaterThan(0);
    for (const task of tasks.filter((item) => !long.includes(item))) {
      expect(task).toMatch(/at most|exactly/i);
      expect(task).toMatch(/answer|reply|stop/i);
      expect(task).not.toContain('{file}');
      expect(task).not.toContain('{n}');
    }
    for (const task of tasks.filter((item) => !long.includes(item) && !/^(Create|In the file)/.test(item))) {
      expect(task).toMatch(/at most \w+ searches/);
      expect(task).toMatch(/at most 5 lines/);
    }
    const followups = entries.filter((entry) => entry.operation === 'continue').map((entry) => entry.message ?? '');
    expect(followups.length).toBeGreaterThan(0);
    for (const message of followups) expect(message).toMatch(/previous task is finished|same/i);
  }, 90_000);

  it('describes the bounded tasks and the truncation rule in the help and the plan', async () => {
    const box = await sandbox();
    const help = await soak(box, ['--help']);
    expect(help.stdout).toContain('--max-truncated-percent');
    expect(help.stdout).toMatch(/bounded/i);
    const plan = await soak(box, ['--reviews', '1', '--out', box.out, '--server-command', process.execPath, '--server-arg', fixture]);
    expect(plan.stdout).toMatch(/bounded/i);
    expect(plan.stdout).toContain('truncated');
  });

  it('never touches processes it did not start and reports a leaked child without killing it', async () => {
    const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', 'vibe-unrelated-bystander'], { stdio: 'ignore' });
    strays.push(bystander.pid ?? 0);
    const clean = await sandbox();
    const pass = await soak(clean, real(clean, { reviews: 2, edits: 0, acp: 0 }));
    expect(pass.code).toBe(0);
    expect(alive(bystander.pid ?? 0)).toBe(true);
    expect((await readSummary(clean)).leftovers.processes.leaked).toEqual([]);

    const box = await sandbox();
    const pidFile = path.join(box.parent, 'leaked.pid');
    const failed = await soak(box, real(box, { reviews: 1, edits: 0, acp: 0 }), { FAKE_MODE_PROGRAMMATIC: 'leak', FAKE_LEAK_PID_FILE: pidFile });
    const leakedPid = Number(await readFile(pidFile, 'utf8'));
    strays.push(leakedPid);
    expect(failed.code).toBe(1);
    const summary = await readSummary(box);
    expect(criterion(summary, 'no_leaked_processes_or_worktrees')).toBe('FAIL');
    expect(summary.leftovers.processes.leaked.map((item) => item.pid)).toEqual([leakedPid]);
    expect(alive(leakedPid)).toBe(true);
    expect(alive(bystander.pid ?? 0)).toBe(true);
  }, 90_000);
});
