import path from 'node:path';
import { aggregateDailyUsage, loadAllRunRecords } from '../../core/usage-ledger.js';
import type { DailyUsageReport, DailyUsageRow, DailyUsageSummary } from '../../core/usage-ledger.js';
import { fail } from '../fail.js';
import { resolveDataDir } from '../runs.js';
import type { RunsInvocation } from '../runs.js';

const USAGE = 'Usage: vibe-supervisor runs [--config <path>] usage [--since <YYYY-MM-DD>] [--root <path>] [--json]';

export interface UsageCliOptions {
  since: string | null;
  root: string | null;
  json: boolean;
}

export async function runsUsage(invocation: RunsInvocation): Promise<void> {
  const options = parseOptions(invocation);
  const { dataDir } = await resolveDataDir(invocation.configPath);
  const records = await loadAllRunRecords(dataDir);
  const report = aggregateDailyUsage(records, {
    ...(options.since !== null ? { since: options.since } : {}),
    ...(options.root !== null ? { root: options.root } : {})
  });
  process.stdout.write(options.json ? renderJson(report) : renderHuman(report));
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function renderHuman(report: DailyUsageReport): string {
  const header = [
    '| Date | Root | Runs | Tokens | Model Calls | Cost (USD) |',
    '|---|---|---|---|---|---|'
  ];
  const rows = report.rows.map(
    (row) =>
      `| ${row.date} | ${cell(row.root)} | ${row.runs} | ${row.tokens.toLocaleString('en-US')} | ${row.modelCalls} | $${row.costUsd.toFixed(2)} |`
  );
  const lines = [...header, ...rows, summaryLine(report.summary)];
  return `${lines.join('\n')}\n`;
}

function summaryLine(summary: DailyUsageSummary): string {
  const windowParts: string[] = [];
  if (summary.since) windowParts.push(`since ${summary.since}`);
  if (summary.root) windowParts.push(`root ${summary.root}`);
  const filterDesc = windowParts.length > 0 ? ` (${windowParts.join(', ')})` : '';
  return `Total: ${summary.totalRuns} runs, ${summary.totalTokens.toLocaleString('en-US')} tokens, ${summary.totalModelCalls} model calls, $${summary.totalCostUsd.toFixed(2)} estimated USD${filterDesc}.`;
}

function renderJson(report: DailyUsageReport): string {
  const lines = report.rows.map((row: DailyUsageRow) =>
    JSON.stringify({
      kind: 'row',
      date: row.date,
      root: row.root,
      runs: row.runs,
      tokens: row.tokens,
      model_calls: row.modelCalls,
      cost_usd: row.costUsd
    })
  );
  lines.push(
    JSON.stringify({
      kind: 'summary',
      since: summaryOrNull(report.summary.since),
      root: summaryOrNull(report.summary.root),
      total_runs: report.summary.totalRuns,
      total_tokens: report.summary.totalTokens,
      total_model_calls: report.summary.totalModelCalls,
      total_cost_usd: report.summary.totalCostUsd
    })
  );
  return `${lines.join('\n')}\n`;
}

function summaryOrNull(value: string | null): string | null {
  return value ?? null;
}

export function parseOptions(invocation: RunsInvocation): UsageCliOptions {
  let since: string | null = null;
  let root: string | null = null;
  let json = false;

  for (let index = 1; index < invocation.positional.length; index++) {
    const flag = invocation.positional[index];
    if (flag === '--json' && !json) {
      json = true;
    } else if (flag === '--since' && since === null) {
      const value = invocation.positional[++index];
      if (!value || !validDay(value)) {
        fail('runs usage --since requires a calendar date as YYYY-MM-DD.', 2);
      }
      since = value;
    } else if (flag === '--root' && root === null) {
      const value = invocation.positional[++index];
      if (!value || value.startsWith('--')) {
        fail('runs usage --root requires a directory path.', 2);
      }
      root = path.resolve(value);
    } else {
      fail(USAGE, 2);
    }
  }

  return { since, root, json };
}

function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);
}
