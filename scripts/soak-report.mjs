import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_SUMMARY_BYTES = 8 * 1024 * 1024;
const NOT_RECORDED = 'not recorded';
const PERMISSION_FAILURE = 'driver:permission_request';
const SUPERVISOR_CRITERIA = ['zero_unexpected_failures', 'truncated_within_threshold', 'zero_permission_requests', 'no_leaked_processes_or_worktrees', 'bounded_artifacts', 'retention_keeps_recent_runs'];
const RESULTS = new Set(['PASS', 'FAIL', 'INCOMPLETE']);

const USAGE = `Usage: node scripts/soak-report.mjs <soak-output-dir | summary.json> [options]

  --candidate <version>   Release candidate under test, for example rc.9
  --commit <sha>          Commit the candidate was built from (7 to 40 hex digits)
  --date <YYYY-MM-DD>     Date of the run
  --format markdown|json  Output format (default markdown)

Reads summary.json written by scripts/soak.mjs and prints, to stdout, one Phase D table row, the D18 verdict
and evidence lines with their conditions. It reads only the given path: no network, no Vibe, no writes. A
missing or malformed field is an error (exit 2); a value the summary does not hold is printed as "not recorded".
The exit code reports whether the report could be produced, not whether the soak passed.
`;

class Usage extends Error {}
class Invalid extends Error {}

function parseCommandLine(argv) {
  const o = { input: undefined, candidate: undefined, commit: undefined, date: undefined, format: 'markdown', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const take = () => {
      index += 1;
      if (index >= argv.length) throw new Usage(`${flag} needs a value.`);
      return argv[index];
    };
    if (flag === '--help' || flag === '-h') o.help = true;
    else if (flag === '--candidate') o.candidate = take();
    else if (flag === '--commit') o.commit = take();
    else if (flag === '--date') o.date = take();
    else if (flag === '--format') o.format = take();
    else if (flag.startsWith('-')) throw new Usage(`Unknown option: ${flag}`);
    else if (o.input === undefined) o.input = flag;
    else throw new Usage(`Unexpected argument: ${flag}`);
  }
  if (o.help) return o;
  if (!o.input) throw new Usage('A soak output directory or summary.json path is required.');
  if (o.candidate !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(o.candidate)) throw new Usage('--candidate must be a short version label such as rc.9.');
  if (o.commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(o.commit)) throw new Usage('--commit must be 7 to 40 hexadecimal digits.');
  if (o.date !== undefined && !(/^\d{4}-\d{2}-\d{2}$/.test(o.date) && !Number.isNaN(Date.parse(`${o.date}T00:00:00Z`)) && new Date(`${o.date}T00:00:00Z`).toISOString().startsWith(o.date))) throw new Usage('--date must be a real date as YYYY-MM-DD.');
  if (o.format !== 'markdown' && o.format !== 'json') throw new Usage('--format must be markdown or json.');
  return o;
}

async function loadSummary(input) {
  let target = path.resolve(input);
  let info;
  try { info = await lstat(target); } catch { throw new Invalid(`Cannot read ${target}.`); }
  if (info.isDirectory()) {
    target = path.join(target, 'summary.json');
    try { info = await lstat(target); } catch { throw new Invalid(`No summary.json in ${path.dirname(target)}.`); }
  }
  if (!info.isFile()) throw new Invalid(`${target} is not a regular file.`);
  if (info.size > MAX_SUMMARY_BYTES) throw new Invalid(`${target} is larger than ${MAX_SUMMARY_BYTES} bytes.`);
  try { return JSON.parse(await readFile(target, 'utf8')); }
  catch (error) { throw new Invalid(`${target} is not valid JSON: ${error.message}`); }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function checkSummary(summary) {
  const problems = [];
  const at = (name, value) => {
    const parts = name.split('.');
    let current = value;
    for (const part of parts) { if (!isObject(current)) return undefined; current = current[part]; }
    return current;
  };
  const require = (name, test, expectation) => { if (!test(at(name, summary))) problems.push(`${name} must be ${expectation}`); };
  const optional = (name, test, expectation) => { const value = at(name, summary); if (value !== undefined && !test(value)) problems.push(`${name} must be ${expectation} when present`); };
  const count = (value) => isCount(value);
  const text = (value) => typeof value === 'string' && value.length > 0;
  const bucketTable = (value) => isObject(value) && Object.values(value).every((item) => isObject(item) && isCount(item.runs) && isCount(item.ok) && isCount(item.failed));
  const countTable = (value) => isObject(value) && Object.values(value).every(isCount);
  const list = (value) => Array.isArray(value);
  const percentileSet = (value) => isObject(value) && isCount(value.count) && (value.p50 === null || isNumber(value.p50)) && (value.p95 === null || isNumber(value.p95));

  if (!isObject(summary)) return ['summary.json must hold a JSON object'];
  if (summary.schema_version !== 1) problems.push('schema_version must be 1');
  for (const name of ['totals.runs', 'totals.ok', 'totals.failed', 'plan.reviews', 'plan.edits', 'plan.acp', 'truncated.runs', 'permission_requests']) require(name, count, 'a non-negative integer');
  require('stopped_early', (value) => typeof value === 'boolean', 'a boolean');
  require('fatal', (value) => value === null || text(value), 'null or a string');
  require('result', (value) => RESULTS.has(value), 'PASS, FAIL or INCOMPLETE');
  require('by_kind', bucketTable, 'a table of run buckets');
  require('by_backend', bucketTable, 'a table of run buckets');
  require('truncated.by_kind', countTable, 'a table of counts');
  require('truncated.by_backend', countTable, 'a table of counts');
  require('failures_by_code', countTable, 'a table of counts');
  require('leftovers.processes.leaked', list, 'an array');
  require('leftovers.registered_worktrees', list, 'an array');
  require('leftovers.homes', (value) => isObject(value) && Object.values(value).every((home) => isObject(home) && list(home.leftover_worktrees) && list(home.oversized_runs) && list(home.missing_runs)), 'a table of homes with leftover_worktrees, oversized_runs and missing_runs arrays');
  require('criteria', (value) => list(value) && value.every((item) => isObject(item) && text(item.id) && (item.status === 'PASS' || item.status === 'FAIL') && typeof item.detail === 'string'), 'an array of criteria with id, PASS or FAIL status and detail');
  for (const name of ['task_compliance.audited', 'task_compliance.unavailable', 'task_compliance.over_bounds', 'task_compliance.final_answer_missing', 'task_compliance.edits_outside_requested_file', 'tool_calls', 'events', 'cost.reported', 'total_timeout_seconds', 'plan.hosted_turns']) {
    optional(name, (value) => count(value) || (name === 'total_timeout_seconds' && value === null), 'a non-negative integer');
  }
  optional('time_limit_reached', (value) => typeof value === 'boolean', 'a boolean');
  optional('diagnostics_enabled', (value) => typeof value === 'boolean', 'a boolean');
  optional('cost.amount', isNumber, 'a non-negative number');
  optional('cost.currency', (value) => value === null || text(value), 'null or a string');
  optional('latency_ms.time_to_first_event', percentileSet, 'a count with p50 and p95');
  optional('latency_ms.time_to_settled', percentileSet, 'a count with p50 and p95');
  for (const name of ['started_at', 'finished_at']) optional(name, (value) => text(value) && !Number.isNaN(Date.parse(value)), 'an ISO timestamp');
  for (const name of ['seed', 'node', 'platform']) optional(name, text, 'a non-empty string');
  if (problems.length) return problems;

  const kindRuns = Object.values(summary.by_kind).reduce((sum, item) => sum + item.runs, 0);
  const backendRuns = Object.values(summary.by_backend).reduce((sum, item) => sum + item.runs, 0);
  if (summary.totals.ok + summary.totals.failed !== summary.totals.runs) problems.push('totals.ok plus totals.failed must equal totals.runs');
  if (kindRuns !== summary.totals.runs) problems.push('by_kind runs must add up to totals.runs');
  if (backendRuns !== summary.totals.runs) problems.push('by_backend runs must add up to totals.runs');
  if (summary.totals.runs > summary.plan.reviews + summary.plan.edits + summary.plan.acp) problems.push('totals.runs exceeds the planned runs');
  const ids = summary.criteria.map((item) => item.id);
  if (new Set(ids).size !== ids.length) problems.push('criteria ids must be unique');
  for (const id of SUPERVISOR_CRITERIA) if (!ids.includes(id)) problems.push(`criteria is missing ${id}`);
  return problems;
}

const sumLengths = (summary, key) => Object.values(summary.leftovers.homes).reduce((sum, home) => sum + home[key].length, 0);

function parseTruncation(detail) {
  const head = /^(\d+) of (\d+) completed runs ended truncated \((\d+(?:\.\d+)?)%, limit (\d+)% overall and per kind and backend\)((?:; [^;]+: \d+ of \d+ \(\d+(?:\.\d+)?%\) exceeds the limit)*)$/.exec(detail);
  if (!head) throw new Invalid('The truncated_within_threshold detail does not have the format scripts/soak.mjs writes.');
  const buckets = [...head[5].matchAll(/; ([^;]+): (\d+) of (\d+) \((\d+(?:\.\d+)?)%\) exceeds the limit/g)].map((match) => ({ name: match[1], truncated: Number(match[2]), completed: Number(match[3]), percent: Number(match[4]) }));
  return { truncated: Number(head[1]), completed: Number(head[2]), percent: Number(head[3]), limit: Number(head[4]), buckets };
}

function evaluate(summary) {
  const status = (id) => summary.criteria.find((item) => item.id === id);
  const unexpected = Object.entries(summary.failures_by_code).filter(([code]) => code !== PERMISSION_FAILURE).reduce((sum, [, count]) => sum + count, 0);
  const truncation = parseTruncation(status('truncated_within_threshold').detail);
  if (truncation.truncated !== summary.truncated.runs) throw new Invalid('truncated.runs disagrees with the truncated_within_threshold detail.');
  const leakedProcesses = summary.leftovers.processes.leaked.length;
  const leakedWorktrees = sumLengths(summary, 'leftover_worktrees') + summary.leftovers.registered_worktrees.length;
  const oversized = sumLengths(summary, 'oversized_runs');
  const missing = sumLengths(summary, 'missing_runs');
  const withinThreshold = truncation.buckets.length === 0 && truncation.percent <= truncation.limit;
  const rows = [
    { id: 'zero_unexpected_failures', measured: `${unexpected} unexpected failures${summary.fatal ? `; fatal: ${summary.fatal}` : ''}${unexpected ? ` (${Object.entries(summary.failures_by_code).filter(([code]) => code !== PERMISSION_FAILURE).map(([code, count]) => `${code} ${count}`).join(', ')})` : ''}`, threshold: '0, no fatal error', pass: unexpected === 0 && !summary.fatal },
    { id: 'truncated_within_threshold', measured: `${truncation.truncated} of ${truncation.completed} completed runs truncated (${truncation.percent.toFixed(1)}%)${truncation.buckets.map((bucket) => `; ${bucket.name}: ${bucket.truncated} of ${bucket.completed} (${bucket.percent.toFixed(1)}%)`).join('')}`, threshold: `at most ${truncation.limit}% overall and per kind and backend`, pass: withinThreshold },
    { id: 'zero_permission_requests', measured: `${summary.permission_requests} permission or input requests`, threshold: '0', pass: summary.permission_requests === 0 },
    { id: 'no_leaked_processes_or_worktrees', measured: `${leakedProcesses} leaked vibe processes, ${leakedWorktrees} leftover worktrees`, threshold: '0 and 0', pass: leakedProcesses === 0 && leakedWorktrees === 0 },
    { id: 'bounded_artifacts', measured: `${oversized} run directories above the per-run limit`, threshold: '0', pass: oversized === 0 },
    { id: 'retention_keeps_recent_runs', measured: `${missing} recorded runs missing from disk`, threshold: '0', pass: missing === 0 },
  ];
  for (const row of rows) {
    const recorded = status(row.id).status;
    if (recorded !== (row.pass ? 'PASS' : 'FAIL')) throw new Invalid(`summary.json is inconsistent: ${row.id} is recorded ${recorded} but its fields measure ${row.pass ? 'PASS' : 'FAIL'}.`);
  }
  const planned = summary.plan.reviews + summary.plan.edits + summary.plan.acp;
  for (const item of summary.criteria.filter((entry) => !SUPERVISOR_CRITERIA.includes(entry.id))) {
    const measured = item.id === 'all_planned_runs' ? `${summary.totals.runs}/${planned} runs attempted` : item.detail;
    const threshold = item.id === 'all_planned_runs' ? 'every planned run attempted' : 'as recorded by the driver';
    const pass = item.status === 'PASS';
    if (item.id === 'all_planned_runs' && pass !== (summary.totals.runs === planned)) throw new Invalid('summary.json is inconsistent: all_planned_runs disagrees with totals.runs.');
    rows.push({ id: item.id, measured, threshold, pass });
  }
  const allPass = rows.every((row) => row.pass);
  if (summary.result === 'PASS' && !allPass) throw new Invalid('summary.json is inconsistent: result is PASS but a criterion fails.');
  if (summary.result === 'FAIL' && allPass) throw new Invalid('summary.json is inconsistent: result is FAIL but every criterion passes.');
  return { rows, result: summary.result, unexpected, truncation, planned };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const mix = (table, field = 'runs') => Object.entries(table).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => `${typeof item === 'number' ? item : item[field]} ${name}`).join(', ') || 'none';
const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const milliseconds = (value) => (value === null || value === undefined ? NOT_RECORDED : `${Math.round(value)} ms`);

function conditions(summary, options, evaluation) {
  const parts = [
    `candidate ${options.candidate ?? NOT_RECORDED}`,
    `commit ${options.commit ?? NOT_RECORDED}`,
    `date ${options.date ?? NOT_RECORDED}`,
    `${summary.platform ?? NOT_RECORDED}`,
    `Node ${summary.node ?? NOT_RECORDED}`,
    'Vibe version and model not recorded in summary.json',
    `${summary.totals.runs} of ${evaluation.planned} planned runs (${plural(summary.plan.reviews, 'review')}, ${plural(summary.plan.edits, 'edit')}, ${plural(summary.plan.acp, 'ACP run')})`,
    `backends ${mix(summary.by_backend)}`,
    `seed ${summary.seed ?? NOT_RECORDED}`,
  ];
  return parts.join('; ');
}

function describeRow(summary, evaluation) {
  const { totals } = summary;
  const planned = evaluation.planned;
  const lead = summary.result === 'PASS' ? `PASS: ${totals.runs}/${planned} runs` : summary.result === 'INCOMPLETE' ? `INCOMPLETE at ${totals.runs}/${planned}` : `FAIL at ${totals.runs}/${planned}`;
  const pieces = [`${totals.ok} ok, ${totals.failed} failed`];
  const failures = Object.entries(summary.failures_by_code).sort(([left], [right]) => left.localeCompare(right));
  if (failures.length) pieces.push(`failures by code: ${failures.map(([code, count]) => `${code} ${count}`).join(', ')}`);
  if (summary.fatal) pieces.push(`fatal: ${summary.fatal}`);
  pieces.push(`${evaluation.truncation.truncated} of ${evaluation.truncation.completed} completed runs truncated`);
  pieces.push(`${summary.permission_requests} permission requests`);
  const settled = summary.latency_ms?.time_to_settled;
  if (settled) pieces.push(`settled p50 ${milliseconds(settled.p50)}, p95 ${milliseconds(settled.p95)}`);
  if (summary.cost?.amount !== undefined) pieces.push(`cost ${summary.cost.amount} ${summary.cost.currency ?? 'unknown currency'} (non-authoritative)`);
  const failed = evaluation.rows.filter((row) => !row.pass).map((row) => row.id);
  if (failed.length) pieces.push(`failed criteria: ${failed.join(', ')}`);
  if (summary.stopped_early) pieces.push('stopped early');
  if (summary.time_limit_reached) pieces.push('overall time limit reached');
  return `${lead}: ${pieces.join('; ')}`;
}

function compliance(summary) {
  const value = summary.task_compliance;
  if (!value) return null;
  return {
    audited: value.audited ?? NOT_RECORDED,
    unavailable: value.unavailable ?? NOT_RECORDED,
    over_bounds: value.over_bounds ?? NOT_RECORDED,
    final_answer_missing: value.final_answer_missing ?? NOT_RECORDED,
    edits_outside_requested_file: value.edits_outside_requested_file ?? NOT_RECORDED,
  };
}

function evidenceLines(summary, options, evaluation) {
  const where = conditions(summary, options, evaluation);
  const lines = [];
  const add = (claim) => lines.push({ claim, evidence: `${where}; source: soak summary.json` });
  const { totals } = summary;
  add(`${totals.ok} of ${totals.runs} soak runs ok, ${totals.failed} failed; kinds ${mix(summary.by_kind)}; result ${summary.result}`);
  const failures = Object.entries(summary.failures_by_code).sort(([left], [right]) => left.localeCompare(right));
  add(failures.length ? `Failures by code: ${failures.map(([code, count]) => `${code} ${count}`).join(', ')}` : 'No failures by code');
  const settled = summary.latency_ms?.time_to_settled;
  const first = summary.latency_ms?.time_to_first_event;
  if (settled && first) add(`Time to first event p50 ${milliseconds(first.p50)}, p95 ${milliseconds(first.p95)} (${first.count} runs); time to settled p50 ${milliseconds(settled.p50)}, p95 ${milliseconds(settled.p95)} (${settled.count} runs); successful runs except mid-turn close; measured after the start call returned`);
  else add(`Latency percentiles: ${NOT_RECORDED}`);
  add(`${evaluation.truncation.truncated} of ${evaluation.truncation.completed} completed runs truncated (${evaluation.truncation.percent.toFixed(1)}%, limit ${evaluation.truncation.limit}%); by kind ${mix(summary.truncated.by_kind)}; by backend ${mix(summary.truncated.by_backend)}`);
  add(`${summary.permission_requests} permission or input requests`);
  add(`${evaluation.rows.find((row) => row.id === 'no_leaked_processes_or_worktrees').measured}; ${evaluation.rows.find((row) => row.id === 'bounded_artifacts').measured}; ${evaluation.rows.find((row) => row.id === 'retention_keeps_recent_runs').measured}`);
  if (summary.cost?.amount !== undefined) add(`Reported cost ${summary.cost.amount} ${summary.cost.currency ?? 'unknown currency'} over ${summary.cost.reported ?? NOT_RECORDED} runs with a cost figure; the supervisor's non-authoritative figure`);
  else add(`Cost: ${NOT_RECORDED}`);
  if (summary.restarts) add(`Supervisor restarts: ${summary.restarts.reloaded} reloaded, ${summary.restarts.error} errors, ${summary.restarts.other} other, ${summary.restarts.not_exercised} not exercised; graceful stops, not SIGKILL`);
  const audit = compliance(summary);
  if (audit) add(`Task compliance, informational: ${audit.audited} runs audited, ${audit.unavailable} records unavailable, ${audit.over_bounds} over their read or search bounds, ${audit.final_answer_missing} without a final answer, ${audit.edits_outside_requested_file} edits outside the requested file`);
  else add(`Task compliance: ${NOT_RECORDED}`);
  return lines;
}

function build(summary, options) {
  const evaluation = evaluate(summary);
  const supervisorPass = evaluation.rows.every((row) => row.pass);
  const stepName = `D18 soak, ${options.candidate ?? `candidate ${NOT_RECORDED}`}${options.commit || options.date ? ` (${[options.commit, options.date].filter(Boolean).join(', ')})` : ''}`;
  return {
    candidate: options.candidate ?? null,
    commit: options.commit ?? null,
    date: options.date ?? null,
    row: { step: stepName, result: describeRow(summary, evaluation) },
    verdict: {
      result: evaluation.result,
      supervisor_reliability: summary.result === 'INCOMPLETE' ? 'INCOMPLETE' : supervisorPass ? 'PASS' : 'FAIL',
      criteria: evaluation.rows.map((row) => ({ id: row.id, status: row.pass ? 'PASS' : 'FAIL', measured: row.measured, threshold: row.threshold })),
      task_compliance: compliance(summary) ?? NOT_RECORDED,
    },
    evidence: evidenceLines(summary, options, evaluation),
  };
}

function renderMarkdown(report) {
  const lines = ['## Phase D table row', '', '| Step | Result |', '|---|---|', `| ${cell(report.row.step)} | ${cell(report.row.result)} |`, '', '## D18 verdict', '', `Supervisor reliability: ${report.verdict.supervisor_reliability}`, '', '| Criterion | Measured | Threshold | Status |', '|---|---|---|---|'];
  for (const row of report.verdict.criteria) lines.push(`| ${cell(row.id)} | ${cell(row.measured)} | ${cell(row.threshold)} | ${row.status} |`);
  lines.push('', 'Model task compliance (informational, not part of the verdict):', '');
  if (typeof report.verdict.task_compliance === 'string') lines.push(`- ${report.verdict.task_compliance}`);
  else for (const [name, value] of Object.entries(report.verdict.task_compliance)) lines.push(`- ${name}: ${value}`);
  lines.push('', '## Evidence lines', '', '| Claim | Evidence |', '|---|---|');
  for (const line of report.evidence) lines.push(`| ${cell(line.claim)} | ${cell(line.evidence)} |`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseCommandLine(process.argv.slice(2));
  if (options.help) { process.stdout.write(USAGE); return 0; }
  const summary = await loadSummary(options.input);
  const problems = checkSummary(summary);
  if (problems.length) throw new Invalid(`summary.json is malformed:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  const report = build(summary, options);
  process.stdout.write(options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exitCode = 2;
}
