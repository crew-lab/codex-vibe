import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RootBudget, RunRecord } from '../contracts.js';
import { supervisorError } from '../contracts.js';
import { runFromWire } from './serialization.js';
import { isPathWithinRoot } from '../security/paths.js';

export const MAX_SESSION_DIRECTORIES = 128;
export const MAX_RUNS_SCANNED = 10_000;
export const MAX_META_BYTES = 1024 * 1024;
export const SESSION_SCAN_LIMIT_MESSAGE = 'The isolated session namespace exceeds its safe scan limit; inspect it manually.';

const SESSION_NAME = /^session-[A-Za-z0-9]{6}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function foreignOwner(uid: number): boolean {
  return typeof process.getuid === 'function' && uid !== process.getuid();
}

function invalidState(message: string): Error {
  return Object.assign(new Error(message), supervisorError('VSUP_INVALID_STATE', message));
}

async function privateDirectory(directory: string, label: string): Promise<boolean> {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || foreignOwner(info.uid)) {
    throw invalidState(`An unsafe ${label} was found at ${directory}; inspect it manually.`);
  }
  if ((await realpath(directory).catch(() => undefined)) !== path.resolve(directory)) {
    throw invalidState(`The ${label} path ${directory} changed or resolves through a link; inspect it manually.`);
  }
  return true;
}

async function sessionHomes(sessions: string): Promise<string[]> {
  if (!(await privateDirectory(sessions, 'session root'))) return [];
  const entries = await readdir(sessions);
  if (entries.length > MAX_SESSION_DIRECTORIES) throw invalidState(SESSION_SCAN_LIMIT_MESSAGE);
  const homes: string[] = [];
  for (const name of entries.filter((entry) => SESSION_NAME.test(entry)).sort()) {
    const home = path.join(sessions, name);
    try {
      if (await privateDirectory(home, 'session directory')) homes.push(home);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Skipped the isolated session ${home}: ${reason}\n`);
    }
  }
  return homes;
}

async function runDirectoriesIn(runs: string): Promise<string[]> {
  if (!(await privateDirectory(runs, 'run directory'))) return [];
  const directories: string[] = [];
  for (const name of (await readdir(runs)).filter((id) => RUN_ID.test(id)).sort()) {
    const directory = path.join(runs, name);
    const info = await lstat(directory).catch(() => undefined);
    if (!info || info.isSymbolicLink() || !info.isDirectory() || foreignOwner(info.uid)) continue;
    directories.push(directory);
  }
  return directories;
}

export async function enumerateRunDirectories(dataDir: string): Promise<string[]> {
  const exists = await lstat(dataDir).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  );
  if (!exists) return [];
  const root = await realpath(dataDir);
  const info = await lstat(root);
  if (!info.isDirectory() || foreignOwner(info.uid)) {
    throw invalidState(`The supervisor data root ${dataDir} is not a directory owned by the current user; inspect it manually.`);
  }
  const directories = [...(await runDirectoriesIn(path.join(root, 'runs')))];
  for (const home of await sessionHomes(path.join(root, 'mcp-sessions'))) {
    try {
      directories.push(...(await runDirectoriesIn(path.join(home, 'runs'))));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Skipped the isolated session ${home}: ${reason}\n`);
    }
  }
  return directories;
}

export async function readRunRecord(metaPathOrDir: string): Promise<RunRecord | null> {
  const file = metaPathOrDir.endsWith('meta.json') ? metaPathOrDir : path.join(metaPathOrDir, 'meta.json');
  try {
    const directory = await lstat(path.dirname(file));
    if (directory.isSymbolicLink() || !directory.isDirectory()) return null;
    const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_META_BYTES) return null;
      const raw = JSON.parse(await handle.readFile('utf8'));
      return runFromWire(raw);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export async function loadAllRunRecords(dataDir: string, maxRuns = MAX_RUNS_SCANNED): Promise<RunRecord[]> {
  const directories = await enumerateRunDirectories(dataDir);
  if (directories.length > maxRuns) {
    const message = `More than ${maxRuns} saved runs; narrow the data directory before scanning usage.`;
    throw invalidState(message);
  }
  const records: RunRecord[] = [];
  for (const directory of directories) {
    const record = await readRunRecord(directory);
    if (record) records.push(record);
  }
  return records;
}

export interface RollingUsageSummary {
  root: string;
  windowHours: number;
  since: string;
  totalCostUsd: number;
  totalTokens: number;
  modelCalls: number;
  runCount: number;
}

export function calculateRollingUsage(options: {
  records: readonly RunRecord[];
  root: string;
  now?: number;
  windowHours?: number;
}): RollingUsageSummary {
  const windowHours = options.windowHours ?? 24;
  const now = options.now ?? Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoffTime = now - windowMs;
  const since = new Date(cutoffTime).toISOString();

  let totalCostUsd = 0;
  let totalTokens = 0;
  let modelCalls = 0;
  let runCount = 0;

  for (const record of options.records) {
    if (record.admittedRoot ? record.admittedRoot !== options.root : !isPathWithinRoot(options.root, record.sourceWorkspace)) {
      continue;
    }
    const createdAtMs = Date.parse(record.createdAt);
    if (Number.isNaN(createdAtMs) || createdAtMs < cutoffTime) {
      continue;
    }
    runCount++;
    if (record.usage?.cost?.amount !== undefined) {
      totalCostUsd += record.usage.cost.amount;
    }
    const tokens = record.usage?.tokensUsed ?? ((record.usage?.promptTokens ?? 0) + (record.usage?.completionTokens ?? 0));
    totalTokens += tokens;
    if (record.usage?.modelCalls) {
      modelCalls += record.usage.modelCalls;
    }
  }

  totalCostUsd = Math.round(totalCostUsd * 10000) / 10000;

  return {
    root: options.root,
    windowHours,
    since,
    totalCostUsd,
    totalTokens,
    modelCalls,
    runCount
  };
}

export async function checkBudgetAdmission(options: {
  dataDir: string;
  admittedRoot: string;
  budget: RootBudget;
  now?: number;
  records?: readonly RunRecord[];
}): Promise<{ allowed: boolean; currentCostUsd: number; limitCostUsd: number }> {
  const limitCostUsd = options.budget.maxCostUsdPerDay;
  if (limitCostUsd === undefined) {
    return { allowed: true, currentCostUsd: 0, limitCostUsd: Infinity };
  }
  const records = options.records ?? (await loadAllRunRecords(options.dataDir));
  const rolling = calculateRollingUsage({
    records,
    root: options.admittedRoot,
    ...(options.now !== undefined ? { now: options.now } : {}),
    windowHours: 24
  });
  return {
    allowed: rolling.totalCostUsd < limitCostUsd,
    currentCostUsd: rolling.totalCostUsd,
    limitCostUsd
  };
}

export interface DailyUsageRow {
  date: string;
  root: string;
  runs: number;
  tokens: number;
  modelCalls: number;
  costUsd: number;
}

export interface DailyUsageSummary {
  since: string | null;
  root: string | null;
  totalRuns: number;
  totalTokens: number;
  totalModelCalls: number;
  totalCostUsd: number;
}

export interface DailyUsageReport {
  rows: DailyUsageRow[];
  summary: DailyUsageSummary;
}

export function aggregateDailyUsage(
  records: readonly RunRecord[],
  options?: { since?: string | null; root?: string | null }
): DailyUsageReport {
  const since = options?.since ?? null;
  const filterRoot = options?.root ?? null;

  const map = new Map<string, { date: string; root: string; runs: number; tokens: number; modelCalls: number; costUsd: number }>();

  for (const record of records) {
    const root = record.admittedRoot ?? record.sourceWorkspace;
    if (filterRoot !== null && (record.admittedRoot ? record.admittedRoot !== filterRoot : !isPathWithinRoot(filterRoot, record.sourceWorkspace))) {
      continue;
    }
    const date = record.createdAt.slice(0, 10);
    if (since !== null && date < since) {
      continue;
    }
    const key = `${date}\0${root}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { date, root, runs: 0, tokens: 0, modelCalls: 0, costUsd: 0 };
      map.set(key, entry);
    }
    entry.runs++;
    const tokens = record.usage?.tokensUsed ?? ((record.usage?.promptTokens ?? 0) + (record.usage?.completionTokens ?? 0));
    entry.tokens += tokens;
    if (record.usage?.modelCalls) {
      entry.modelCalls += record.usage.modelCalls;
    }
    if (record.usage?.cost?.amount !== undefined) {
      entry.costUsd += record.usage.cost.amount;
    }
  }

  const rows: DailyUsageRow[] = Array.from(map.values())
    .map((row) => ({
      ...row,
      costUsd: Math.round(row.costUsd * 10000) / 10000
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.root.localeCompare(b.root));

  let totalRuns = 0;
  let totalTokens = 0;
  let totalModelCalls = 0;
  let totalCostUsd = 0;

  for (const row of rows) {
    totalRuns += row.runs;
    totalTokens += row.tokens;
    totalModelCalls += row.modelCalls;
    totalCostUsd += row.costUsd;
  }

  totalCostUsd = Math.round(totalCostUsd * 10000) / 10000;

  return {
    rows,
    summary: {
      since,
      root: filterRoot,
      totalRuns,
      totalTokens,
      totalModelCalls,
      totalCostUsd
    }
  };
}
