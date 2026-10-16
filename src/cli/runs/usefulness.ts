import path from 'node:path';
import { contractDigest } from '../../acceptance/schema.js';
import type { Assessment } from '../../acceptance/schema.js';
import type { RunRecord } from '../../contracts.js';
import { supervisorError } from '../../contracts.js';
import { runFromWire } from '../../core/serialization.js';
import { readOwnedFile } from '../../reporting/private-files.js';
import { fail } from '../fail.js';
import { enumerateRunDirectories, resolveDataDir } from '../runs.js';
import type { RunsInvocation } from '../runs.js';

export const MAX_RUNS_SCANNED = 10_000;
const MAX_META_BYTES = 1024 * 1024;
const MAX_REASON_CHARS = 300;
const SETTLED_STATES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled', 'closed']);
const USAGE = 'Usage: vibe-supervisor runs [--config <path>] usefulness [--since <YYYY-MM-DD>] [--json]';

export type UsefulnessDecision = 'accepted' | 'rejected' | 'deferred';

export interface UsefulnessRow {
  date: string;
  supervisorVersion: string;
  runId: string;
  shape: string;
  measure: string;
  decision: Exclude<UsefulnessDecision, 'deferred'>;
  reason: string;
}

export interface UsefulnessSummary {
  since: string | null;
  accepted: number;
  rejected: number;
  deferred: number;
  unassessed: number;
  notAssessableReview: number;
  unbound: number;
  unreadable: number;
  rate: number | null;
}

export interface UsefulnessReport {
  rows: UsefulnessRow[];
  summary: UsefulnessSummary;
}

export async function runsUsefulness(invocation: RunsInvocation): Promise<void> {
  const options = parseOptions(invocation);
  const { dataDir } = await resolveDataDir(invocation.configPath);
  const directories = await enumerateRunDirectories(dataDir);
  if (directories.length > MAX_RUNS_SCANNED) {
    const message = `More than ${MAX_RUNS_SCANNED} saved runs; narrow the data directory before measuring usefulness.`;
    throw Object.assign(new Error(message), supervisorError('VSUP_INVALID_STATE', message));
  }
  const records: RunRecord[] = [];
  let unreadable = 0;
  for (const directory of directories) {
    try { records.push(runFromWire(JSON.parse((await readOwnedFile(path.join(directory, 'meta.json'), MAX_META_BYTES)).toString('utf8')))); }
    catch { unreadable++; }
  }
  const report = buildUsefulnessReport(records, options.since, unreadable);
  process.stdout.write(options.json ? renderJson(report) : renderHuman(report));
}

export function buildUsefulnessReport(records: readonly RunRecord[], since: string | null, unreadable = 0): UsefulnessReport {
  const rows: UsefulnessRow[] = [];
  const summary: UsefulnessSummary = { since, accepted: 0, rejected: 0, deferred: 0, unassessed: 0, notAssessableReview: 0, unbound: 0, unreadable, rate: null };
  const ordered = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runId.localeCompare(b.runId));
  for (const record of ordered) {
    if (!SETTLED_STATES.has(record.state)) continue;
    if (since !== null && record.createdAt.slice(0, 10) < since) continue;
    if (record.mode === 'review') { summary.notAssessableReview++; continue; }
    const bound = (record.assessments ?? []).filter((assessment) => isBound(record, assessment));
    summary.unbound += (record.assessments?.length ?? 0) - bound.length;
    const latest = bound.at(-1);
    if (!latest) { summary.unassessed++; continue; }
    if (latest.decision === 'deferred') { summary.deferred++; continue; }
    summary[latest.decision]++;
    rows.push({
      date: record.createdAt.slice(0, 10),
      supervisorVersion: record.supervisorVersion ?? 'unknown',
      runId: record.runId,
      shape: describeShape(record),
      measure: describeMeasure(record),
      decision: latest.decision,
      reason: tidyReason(latest.reason)
    });
  }
  const decided = summary.accepted + summary.rejected;
  summary.rate = decided === 0 ? null : summary.accepted / decided;
  return { rows, summary };
}

function isBound(record: RunRecord, assessment: Assessment): boolean {
  const patch = record.result?.artifacts?.find((artifact) => artifact.name === 'diff.patch');
  return record.acceptanceContract !== undefined && assessment.contract_sha256 === contractDigest(record.acceptanceContract) && patch !== undefined && assessment.patch_sha256 === patch.sha256;
}

function describeShape(record: RunRecord): string {
  const checks = record.acceptanceContract?.checks.length;
  const changed = record.result?.changedFiles?.length;
  const parts: string[] = [record.mode];
  if (checks !== undefined) parts.push(plural(checks, 'contract check'));
  if (changed !== undefined) parts.push(plural(changed, 'changed file'));
  return parts.join(', ');
}

function describeMeasure(record: RunRecord): string {
  const parts: string[] = [`max_turns ${record.limits.maxTurns}`];
  if (record.result?.stopReason) parts.push(record.result.stopReason);
  const started = Date.parse(record.startedAt ?? record.createdAt);
  const finished = Date.parse(record.finishedAt ?? '');
  if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) parts.push(`${Math.round((finished - started) / 1000)} s`);
  const usage = record.usage;
  if (usage?.tokensUsed !== undefined) parts.push(`${usage.tokensUsed.toLocaleString('en-US')} tokens`);
  if (typeof usage?.modelCalls === 'number') parts.push(plural(usage.modelCalls, 'model call'));
  if (usage?.cost) parts.push(`about ${usage.cost.amount.toFixed(2)} ${usage.cost.currency}`);
  return parts.join(', ');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function tidyReason(reason: string): string {
  const flat = reason.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_REASON_CHARS ? `${flat.slice(0, MAX_REASON_CHARS - 1)}…` : flat;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function renderHuman(report: UsefulnessReport): string {
  const lines = report.rows.map((row) => `| ${row.date} | ${cell(row.supervisorVersion)} | \`${row.runId.slice(0, 8)}\` | ${cell(row.shape)} | ${cell(row.measure)} | ${row.decision === 'accepted' ? 'Yes' : 'No'} | ${cell(row.reason)} |`);
  lines.push(summaryLine(report.summary));
  return `${lines.join('\n')}\n`;
}

function summaryLine(summary: UsefulnessSummary): string {
  const decided = summary.accepted + summary.rejected;
  const window = summary.since ? ` since ${summary.since}` : '';
  const head = decided === 0
    ? `No edit runs with a decision${window}`
    : `Accepted ${summary.accepted} of ${plural(decided, 'edit run')} with a decision${window} (${Math.round((summary.rate ?? 0) * 100)}%), rejected ${summary.rejected}`;
  const notes = [`${plural(summary.unassessed, 'settled edit run')} without a decision`];
  if (summary.deferred > 0) notes.push(`${summary.deferred} deferred`);
  if (summary.unbound > 0) notes.push(`${plural(summary.unbound, 'assessment')} ignored for not matching the saved contract and patch`);
  notes.push(`${plural(summary.notAssessableReview, 'review')} not assessable (review)`);
  if (summary.unreadable > 0) notes.push(`${plural(summary.unreadable, 'run record')} unreadable`);
  return `${head}; ${notes.join('; ')}.`;
}

function renderJson(report: UsefulnessReport): string {
  const lines = report.rows.map((row) => JSON.stringify({
    kind: 'row', date: row.date, supervisor_version: row.supervisorVersion, run_id: row.runId, shape: row.shape, measure: row.measure, accepted: row.decision === 'accepted', reason: row.reason
  }));
  const { summary } = report;
  lines.push(JSON.stringify({
    kind: 'summary', since: summary.since, accepted: summary.accepted, rejected: summary.rejected, deferred: summary.deferred, unassessed: summary.unassessed,
    not_assessable_review: summary.notAssessableReview, unbound_assessments: summary.unbound, unreadable: summary.unreadable, acceptance_rate: summary.rate
  }));
  return `${lines.join('\n')}\n`;
}

function parseOptions(invocation: RunsInvocation): { since: string | null; json: boolean } {
  let since: string | null = null;
  let json = false;
  for (let index = 1; index < invocation.positional.length; index++) {
    const flag = invocation.positional[index];
    if (flag === '--json' && !json) json = true;
    else if (flag === '--since' && since === null) {
      const value = invocation.positional[++index];
      if (!value || !validDay(value)) fail('runs usefulness --since requires a calendar date as YYYY-MM-DD.', 2);
      since = value;
    } else fail(USAGE, 2);
  }
  return { since, json };
}

function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);
}
