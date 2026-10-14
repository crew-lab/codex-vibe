#!/usr/bin/env node

/**
 * Read-only macOS process and run-state observer for an authorized disconnect
 * acceptance case. Launch as an independent nohup process before starting the
 * run. It never signals a process, reads command arguments or environment, or
 * persists the supervisor lock token.
 */

import { execFile } from 'node:child_process';
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

const execFileAsync = promisify(execFile);
const SAMPLE_INTERVAL_MS = 250;
const MAX_SECONDS = 240;
const MAX_LOCK_BYTES = 4096;
const MAX_META_BYTES = 1_048_576;
const MAX_PS_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TRACKED_PROCESSES = 2048;
const MAX_TRACKED_GROUPS = 1024;
const SAFE_STATES = new Set([
  'queued', 'starting', 'negotiating', 'ready', 'running', 'waiting_permission',
  'waiting_input', 'completed', 'failed', 'cancelled', 'closing', 'closed',
  'orphaned', 'recoverable',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseProcessTable(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length < 9) continue;
    const [pidText, ppidText, pgidText, state, ...rest] = fields;
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    const pgid = Number(pgidText);
    if (![pid, ppid, pgid].every((value) => Number.isSafeInteger(value) && value >= 0)) continue;
    // BSD ps lstart is five tokens; taking it from the end permits spaces in comm.
    const lstartTokens = rest.slice(-5);
    if (lstartTokens.length !== 5 || !/^[A-Z][a-z]{2}$/.test(lstartTokens[0])
      || !/^[A-Z][a-z]{2}$/.test(lstartTokens[1]) || !/^\d{1,2}$/.test(lstartTokens[2])
      || !/^\d{2}:\d{2}:\d{2}$/.test(lstartTokens[3]) || !/^\d{4}$/.test(lstartTokens[4])) continue;
    const comm = rest.slice(0, -5).join(' ');
    rows.push({ pid, ppid, pgid, state, comm, lstart: lstartTokens.join(' ') });
  }
  return rows;
}

export function parseSupervisorPid(lockText) {
  if (Buffer.byteLength(lockText, 'utf8') > MAX_LOCK_BYTES) throw new Error('lock-too-large');
  let parsed;
  try { parsed = JSON.parse(lockText); } catch { throw new Error('lock-malformed'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) throw new Error('lock-invalid-pid');
  return parsed.pid;
}

export function descendantsOf(rows, rootPid) {
  const children = new Map();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row);
    children.set(row.ppid, list);
  }
  const found = [];
  const seen = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      found.push(child);
      queue.push(child.pid);
      if (found.length > MAX_TRACKED_PROCESSES) throw new Error('process-limit-exceeded');
    }
  }
  return found;
}

export function observerAncestry(rows, observerPid) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const chain = [];
  const seen = new Set();
  let current = byPid.get(observerPid);
  if (!current) throw new Error('observer-process-not-visible');
  while (current) {
    if (seen.has(current.pid)) throw new Error('observer-ancestry-cycle');
    seen.add(current.pid);
    chain.push(current.pid);
    if (current.ppid === 0 || current.ppid === current.pid) return chain;
    current = byPid.get(current.ppid);
    if (!current) throw new Error('observer-ancestry-incomplete');
  }
  return chain;
}

export function updateHistory(history, currentOwned) {
  for (const row of currentOwned) {
    const key = `${row.pid}:${row.lstart}`;
    if (!history.has(key)) history.set(key, { ...row, firstObservedAt: new Date().toISOString() });
  }
  if (history.size > MAX_TRACKED_PROCESSES) throw new Error('process-limit-exceeded');
}

function identity(row) {
  return { pid: row.pid, ppid: row.ppid, pgid: row.pgid, state: row.state, comm: row.comm, lstart: row.lstart };
}

export function historySnapshot(history, rows) {
  const current = new Map(rows.map((row) => [`${row.pid}:${row.lstart}`, row]));
  return [...history.entries()].map(([key, first]) => {
    const row = current.get(key);
    return {
      first_observed: { ...identity(first), at: first.firstObservedAt },
      alive: Boolean(row && !row.state.toUpperCase().startsWith('Z')),
      ...(row ? { current: identity(row) } : {}),
    };
  });
}

export function sampleGroups(groups, rows) {
  return [...groups].sort((a, b) => a - b).map((pgid) => ({
    pgid,
    members: rows.filter((row) => row.pgid === pgid).map(identity).slice(0, MAX_TRACKED_PROCESSES),
  }));
}

export async function validateDataDirectory(dataDirArg) {
  const requested = path.resolve(dataDirArg);
  const canonical = await realpath(requested);
  if (requested !== canonical) throw new Error('data-directory-must-be-canonical');
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('data-directory-invalid');

  const lockPath = path.join(canonical, 'supervisor.lock');
  const lockInfo = await lstat(lockPath);
  if (!lockInfo.isFile() || lockInfo.isSymbolicLink() || lockInfo.size > MAX_LOCK_BYTES) throw new Error('lock-unsafe');
  const lockText = await readFile(lockPath, 'utf8');
  const pid = parseSupervisorPid(lockText);
  return { canonical, pid };
}

async function readLockPresence(dataDir) {
  try {
    const info = await lstat(path.join(dataDir, 'supervisor.lock'));
    return info.isFile() && !info.isSymbolicLink() ? 'present' : 'unsafe';
  } catch (error) {
    return error?.code === 'ENOENT' ? 'absent' : 'unreadable';
  }
}

export async function readRunStates(dataDir) {
  const runsPath = path.join(dataDir, 'runs');
  let entries;
  try { entries = await readdir(runsPath, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    const metaPath = path.join(runsPath, entry.name, 'meta.json');
    try {
      const info = await lstat(metaPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_META_BYTES) continue;
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      if (!meta || typeof meta !== 'object' || meta.run_id !== entry.name || !SAFE_STATES.has(meta.state)) continue;
      result.push({
        run_id: entry.name,
        state: meta.state,
        ...(meta.backend === 'acp' || meta.backend === 'programmatic' ? { backend: meta.backend } : {}),
        ...(meta.mode === 'review' || meta.mode === 'edit' ? { mode: meta.mode } : {}),
        ...(typeof meta.updated_at === 'string' ? { updated_at: meta.updated_at } : {}),
        ...(typeof meta.started_at === 'string' ? { started_at: meta.started_at } : {}),
        ...(typeof meta.finished_at === 'string' ? { finished_at: meta.finished_at } : {}),
      });
    } catch { /* A changing or malformed run record is omitted without its contents. */ }
    if (result.length >= 512) break;
  }
  return result;
}

async function processTable() {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,state=,comm=,lstart='], {
    encoding: 'utf8', timeout: 2_000, maxBuffer: MAX_PS_BYTES, windowsHide: true,
  });
  return parseProcessTable(stdout);
}

function usage() {
  return 'Usage: node scripts/v1-disconnect-observer.mjs --data-dir <canonical-session-dir> --output <new-jsonl-file> --seconds <1..240>\n'
    + 'Launch this process independently with nohup before the run. It observes only; it never signals or restarts processes.';
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!['--data-dir', '--output', '--seconds'].includes(key) || value === undefined || values.has(key)) throw new Error('invalid-arguments');
    values.set(key, value);
  }
  if (values.size !== 3) throw new Error('invalid-arguments');
  const seconds = Number(values.get('--seconds'));
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) throw new Error('invalid-seconds');
  return { dataDir: values.get('--data-dir'), output: values.get('--output'), seconds };
}

async function runObserver({ dataDir, output, seconds }) {
  if (process.platform !== 'darwin') throw new Error('macOS-only');
  const { canonical, pid: supervisorPid } = await validateDataDirectory(dataDir);
  const outputPath = path.resolve(output);
  const outputParent = await realpath(path.dirname(outputPath));
  const outputRelative = path.relative(canonical, outputParent);
  const outputIsWithinData = outputRelative === '' || (outputRelative !== '..'
    && !outputRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(outputRelative));
  if (outputIsWithinData) throw new Error('output-must-be-outside-data-directory');

  const handle = await open(outputPath, 'wx', 0o600);
  let outputBytes = 0;
  const write = async (record) => {
    const line = `${JSON.stringify(record)}\n`;
    outputBytes += Buffer.byteLength(line, 'utf8');
    if (outputBytes > MAX_OUTPUT_BYTES) throw new Error('output-limit-exceeded');
    await handle.write(line, null, 'utf8');
    await handle.sync();
  };

  const startedAt = new Date().toISOString();
  const deadline = performance.now() + seconds * 1000;
  const history = new Map();
  const groups = new Map();
  let sequence = 0;
  try {
    const initialRows = await processTable();
    const observer = initialRows.find((row) => row.pid === process.pid);
    const supervisor = initialRows.find((row) => row.pid === supervisorPid);
    if (!supervisor) throw new Error('supervisor-process-not-visible');
    const ancestry = observerAncestry(initialRows, process.pid);
    if (ancestry.includes(supervisorPid)) throw new Error('observer-is-supervisor-descendant');
    const observerIdentity = observer ? identity(observer) : null;
    if (!observerIdentity) throw new Error('observer-process-not-visible');
    await write({
      type: 'observer_started', schema_version: 1, started_at: startedAt,
      observer: observerIdentity, observer_ancestry: ancestry,
      supervisor_pid: supervisorPid, supervisor_start_identity: supervisor.lstart,
      interval_ms: SAMPLE_INTERVAL_MS, max_seconds: seconds,
    });

    while (performance.now() < deadline) {
      const sampleStarted = performance.now();
      const rows = await processTable();
      const supervisorNow = rows.find((row) => row.pid === supervisorPid && row.lstart === supervisor.lstart);
      const ownedNow = supervisorNow ? descendantsOf(rows, supervisorPid) : [];
      updateHistory(history, ownedNow);
      if (!groups.has(supervisor.pgid)) groups.set(supervisor.pgid, startedAt);
      for (const row of ownedNow) {
        if (!groups.has(row.pgid)) groups.set(row.pgid, new Date().toISOString());
      }
      if (groups.size > MAX_TRACKED_GROUPS) throw new Error('process-group-limit-exceeded');
      const descendants = historySnapshot(history, rows);
      const groupRows = sampleGroups(groups.keys(), rows);
      for (const group of groupRows) {
        group.first_observed_at = groups.get(group.pgid);
        group.present = group.members.length > 0;
      }
      sequence += 1;
      await write({
        type: 'sample', sequence, timestamp: new Date().toISOString(),
        supervisor: {
          pid: supervisorPid, start_identity: supervisor.lstart,
          alive: Boolean(supervisorNow && !supervisorNow.state.toUpperCase().startsWith('Z')),
          ...(supervisorNow ? identity(supervisorNow) : {}),
        },
        owned_descendants: descendants,
        process_groups: groupRows,
        lock: await readLockPresence(canonical),
        runs: await readRunStates(canonical),
      });
      if (performance.now() >= deadline) break;
      await sleep(Math.max(0, SAMPLE_INTERVAL_MS - (performance.now() - sampleStarted)));
    }
    await write({ type: 'observer_finished', timestamp: new Date().toISOString(), samples: sequence, output_bytes: outputBytes });
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    await runObserver(parseArgs(args));
    process.exit(0);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'observer-failed';
    process.stderr.write(`v1-disconnect-observer: ${code}\n`);
    process.exit(1);
  }
}
