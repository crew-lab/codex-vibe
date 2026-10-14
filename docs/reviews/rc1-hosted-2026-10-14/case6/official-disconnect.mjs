#!/usr/bin/env node

// Case 6 runner. It is deliberately inert unless --execute is present.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const APP_VERSION = '1.0.1-rc.1';
const POLICY_REVISION = '1b44e421b46ad2443563e8b5625f1ad4859870bfe02397fcb86acbeb41db3966';
const EXPECTED_TOOLS = ['vibe_close', 'vibe_edit_start', 'vibe_result', 'vibe_review_start', 'vibe_status'];
const OPTIONS = ['--execute', '--cli', '--config', '--workspace', '--base-ref', '--task-file', '--output', '--observer-output'];
const REQUIRED = ['--cli', '--config', '--workspace', '--base-ref', '--task-file', '--output', '--observer-output'];
const POLL_MS = 200;
const MAX_RUN_MS = 190_000;
const CALL_TIMEOUT_MS = 20_000;
const SERVER_EXIT_MS = 15_000;
const OBSERVER_SECONDS = 220;
const observerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'v1-disconnect-observer.mjs');

function parseArgs(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === '--execute') { if (values.has(key)) throw new Error('invalid-arguments'); values.set(key, true); continue; }
    const value = args[++i];
    if (!OPTIONS.includes(key) || key === '--execute' || value === undefined || values.has(key)) throw new Error('invalid-arguments');
    values.set(key, value);
  }
  if (!REQUIRED.every((key) => values.has(key))) throw new Error('invalid-arguments');
  for (const key of REQUIRED) if (key !== '--base-ref' && !path.isAbsolute(values.get(key))) throw new Error(`${key.slice(2)}-must-be-absolute`);
  if (!/^[0-9a-f]{40}$/.test(values.get('--base-ref'))) throw new Error('invalid-base-ref');
  return {
    execute: values.has('--execute'), cli: values.get('--cli'), config: values.get('--config'),
    workspace: values.get('--workspace'), baseRef: values.get('--base-ref'), taskFile: values.get('--task-file'),
    output: values.get('--output'), observerOutput: values.get('--observer-output'),
  };
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function until(condition, timeoutMs) {
  const untilAt = Date.now() + timeoutMs;
  while (Date.now() < untilAt) { if (await condition()) return true; await sleep(POLL_MS); }
  return condition();
}

async function connect(options, name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.cli, 'serve', '--stdio', '--config', options.config, '--isolated'],
    stderr: 'pipe',
    env: { ...process.env, VIBE_SUPERVISOR_DIAGNOSTICS: '1' },
  });
  transport.stderr?.on('data', () => {}); // Protocol-safe: never persist stderr, which may contain sensitive diagnostics.
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(transport);
  const call = async (tool, args) => {
    const result = await client.callTool({ name: tool, arguments: args }, { timeout: CALL_TIMEOUT_MS });
    if (result.isError) throw new Error(`tool-error:${tool}`);
    const text = result.content?.find((part) => part.type === 'text')?.text ?? '{}';
    return result.structuredContent ?? JSON.parse(text);
  };
  return { client, call, pid: transport.pid };
}

export function exactToolCatalog(tools) {
  if (!Array.isArray(tools)) return false;
  const names = tools.map((tool) => tool?.name);
  return names.length === EXPECTED_TOOLS.length
    && names.every((name) => typeof name === 'string')
    && [...names].sort().every((name, index) => name === EXPECTED_TOOLS[index]);
}

async function startObserver(sessionDir, output) {
  const child = spawn(process.execPath, [observerScript, '--data-dir', sessionDir, '--output', output, '--seconds', String(OBSERVER_SECONDS)], { detached: true, stdio: 'ignore' });
  child.unref();
  const started = await until(async () => { try { return (await readFile(output, 'utf8')).includes('"type":"observer_started"'); } catch { return false; } }, 10_000);
  return { pid: child.pid, started };
}

function projectReadiness(value) {
  const allowed = ['server_version', 'server_instance_id', 'session_id', 'policy_revision', 'eligible', 'blockers', 'active_slot', 'operation', 'base_commit'];
  return Object.fromEntries(allowed.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
}

export function projectWorkerDiagnostics(data) {
  if (!data || data.schema_version !== 1 || !Array.isArray(data.stages)
    || !Array.isArray(data.tool_inventory) || !Array.isArray(data.tool_calls)) return null;
  const calls = data.tool_calls.filter((call) => call && ['read_file', 'grep', 'write_file', 'edit'].includes(call.tool)
    && ['attempt', 'completed', 'failed'].includes(call.outcome));
  return {
    schema_version: 1,
    stages: data.stages.filter((stage) => stage && typeof stage.stage === 'string').map((stage) => stage.stage),
    tool_inventory: data.tool_inventory.filter((name) => ['read_file', 'grep', 'write_file', 'edit', '<other>'].includes(name)),
    tool_calls: calls.map((call) => ({ tool: call.tool, outcome: call.outcome })),
    tool_inventory_truncated: data.tool_inventory_truncated === true,
    tool_calls_truncated: data.tool_calls_truncated === true,
  };
}

async function readWorkerDiagnostics(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65_536) return null;
    return projectWorkerDiagnostics(JSON.parse(await readFile(file, 'utf8')));
  } catch { return null; }
}

function parseObserverLines(raw) {
  const records = [];
  for (const line of raw.split('\n').filter(Boolean)) { try { records.push(JSON.parse(line)); } catch { /* Ignore the current partial line while the observer writes it. */ } }
  return records;
}

export function observerGateFromRecords(records, serverPid, runId, { now = Date.now(), runStartedAt } = {}) {
  const start = records.find((line) => line.type === 'observer_started');
  const sameRun = records.filter((item) => item.type === 'sample' && item.runs?.some((run) => run.run_id === runId));
  const latest = sameRun.at(-1);
  const liveDescendant = latest?.owned_descendants?.some((item) => item.alive);
  const sampleAt = Date.parse(latest?.timestamp ?? '');
  const startedAt = runStartedAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(runStartedAt);
  const fresh = Number.isFinite(sampleAt) && sampleAt >= startedAt && sampleAt <= now && now - sampleAt <= 1000;
  const serverSample = latest?.supervisor?.pid === serverPid && latest?.supervisor?.alive === true
    && latest?.supervisor?.start_identity === start?.supervisor_start_identity;
  const supervisorGroup = latest?.supervisor?.pgid;
  const detachedObserver = Number.isSafeInteger(start?.observer?.pgid) && Number.isSafeInteger(supervisorGroup)
    && start.observer.pgid !== supervisorGroup;
  const independentFromServer = start?.supervisor_pid === serverPid
    && start?.observer?.pid !== serverPid && !start?.observer_ancestry?.includes(serverPid) && detachedObserver;
  return {
    confirmed: Boolean(independentFromServer && serverSample && fresh && liveDescendant && latest?.runs?.some((run) => run.run_id === runId && run.state === 'running')),
    sequence: latest?.sequence,
    timestamp: latest?.timestamp,
    fresh,
    observer_detached_process_group: detachedObserver,
    independent_from_server: independentFromServer,
  };
}

export function observerClosureFromRecords(records, serverPid, runId, runStartedAt, closeAt) {
  const start = records.find((line) => line.type === 'observer_started');
  const samples = records.filter((line) => line.type === 'sample');
  const preClose = samples.filter((sample) => Date.parse(sample.timestamp) >= Date.parse(runStartedAt)
    && Date.parse(sample.timestamp) < Date.parse(closeAt)
    && sample.supervisor?.pid === serverPid && sample.supervisor?.alive === true
    && sample.runs?.some((run) => run.run_id === runId && run.state === 'running')
    && sample.owned_descendants?.some((item) => item.alive));
  const coherent = samples.filter((sample) => sample.supervisor?.pid === serverPid
    && sample.supervisor?.start_identity === start?.supervisor_start_identity
    && Date.parse(sample.timestamp) >= Date.parse(closeAt)
    && sample.supervisor?.alive === false && sample.lock === 'absent'
    && Array.isArray(sample.process_groups) && sample.process_groups.length > 0
    && sample.process_groups.every((group) => group.present === false && Array.isArray(group.members) && group.members.length === 0)
    && sample.owned_descendants?.every((item) => item.alive === false)
    && sample.runs?.some((run) => run.run_id === runId && run.state === 'failed'));
  const latest = coherent.at(-1);
  const independent = start?.supervisor_pid === serverPid && start?.observer?.pid !== serverPid
    && !start?.observer_ancestry?.includes(serverPid)
    && samples.some((sample) => Number.isSafeInteger(start?.observer?.pgid)
      && Number.isSafeInteger(sample.supervisor?.pgid) && start.observer.pgid !== sample.supervisor.pgid);
  return {
    observer_started_before_run: Boolean(start && Date.parse(start.started_at) <= Date.parse(runStartedAt)),
    independent_observer: independent,
    observer_controller_pid: start?.observer?.ppid,
    owned_worker_seen_alive: preClose.length > 0,
    pre_disconnect_sample_sequence: preClose.at(-1)?.sequence ?? null,
    supervisor_gone: Boolean(latest),
    lock_released: latest?.lock === 'absent',
    owned_process_groups_gone: Boolean(latest),
    observed_run_state: latest?.runs?.find((run) => run.run_id === runId)?.state ?? null,
    coherent_sample_sequence: latest?.sequence ?? null,
    coherent_sample_timestamp: latest?.timestamp ?? null,
  };
}

async function readObserverGate(file, serverPid, runId, runStartedAt) {
  try { return observerGateFromRecords(parseObserverLines(await readFile(file, 'utf8')), serverPid, runId, { runStartedAt }); }
  catch { return { confirmed: false }; }
}

async function waitForObserverClosure(file, serverPid, runId, runStartedAt, closeAt) {
  const deadline = Date.now() + 20_000;
  let evidence = {};
  while (Date.now() < deadline) {
    try { evidence = observerClosureFromRecords(parseObserverLines(await readFile(file, 'utf8')), serverPid, runId, runStartedAt, closeAt); }
    catch { evidence = {}; }
    if (evidence.supervisor_gone && evidence.lock_released && evidence.owned_process_groups_gone && evidence.observed_run_state === 'failed') return evidence;
    await sleep(POLL_MS);
  }
  return evidence;
}

async function retainedWorktree(dataDir, workspace, runId) {
  try {
    const runDir = path.join(dataDir, 'runs', runId);
    const metaPath = path.join(runDir, 'meta.json');
    const info = await lstat(metaPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576) return { verified: false };
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const expected = path.join(dataDir, 'worktrees', runId);
    const worktree = meta.worktree;
    if (meta.run_id !== runId || meta.mode !== 'edit' || !worktree || worktree.created_by_supervisor !== true
      || worktree.path !== expected) return { verified: false };
    const dirInfo = await lstat(expected);
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink() || await realpath(expected) !== expected) return { verified: false };
    const { stdout } = await import('node:child_process').then(({ execFile }) => new Promise((resolve, reject) => execFile('/usr/bin/git', ['-C', workspace, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 5000, maxBuffer: 1_000_000 }, (error, stdout) => error ? reject(error) : resolve({ stdout }))));
    return { verified: stdout.split(/\r?\n/).includes(`worktree ${expected}`), path: expected, state: meta.state };
  } catch { return { verified: false }; }
}

async function run(options, saveRecord) {
  const record = { schema_version: 1, case: 6, operation: 'edit', max_turns: 12, timeout_seconds: 180, timestamps: {} };
  const stamp = (key) => { record.timestamps[key] = new Date().toISOString(); };
  const task = await readFile(options.taskFile, 'utf8');
  record.task_sha256 = createHash('sha256').update(task).digest('hex');
  let first;
  let firstClosed = false;
  try {
    stamp('connect');
    first = await connect(options, 'rc1-case6-official-client');
    record.server_pid = first.pid;
    const handshakeVersion = first.client.getServerVersion();
    record.protocol_server_version = handshakeVersion?.version ?? null;
    if (handshakeVersion?.version !== APP_VERSION) { record.verdict = 'NOT_STARTED'; record.reason = 'protocol-server-version-mismatch'; return record; }
    const catalog = await first.client.listTools();
    const catalogNames = (catalog.tools ?? []).map((tool) => tool.name).sort();
    record.tool_catalog = catalogNames;
    record.tool_catalog_verified = exactToolCatalog(catalog.tools);
    if (!record.tool_catalog_verified) { record.verdict = 'NOT_STARTED'; record.reason = 'tool-catalog-mismatch'; return record; }
    const readiness = await first.call('vibe_status', { workspace: options.workspace, operation: 'edit', base_ref: options.baseRef });
    record.readiness = projectReadiness(readiness);
    if (readiness.server_version !== APP_VERSION || readiness.policy_revision !== POLICY_REVISION || readiness.eligible !== true
      || !Array.isArray(readiness.blockers) || readiness.blockers.length !== 0 || readiness.active_slot?.busy !== false
      || typeof readiness.session_id !== 'string' || typeof readiness.readiness_receipt !== 'string') {
      record.verdict = 'NOT_STARTED'; record.reason = 'readiness-mismatch'; return record;
    }
    const dataDir = await realpath(path.dirname(await realpath(options.config)));
    const sessionDir = path.join(dataDir, 'mcp-sessions', readiness.session_id);
    const observer = await startObserver(sessionDir, options.observerOutput);
    record.observer = { pid: observer.pid, output: options.observerOutput, started: observer.started };
    if (!observer.started) { record.verdict = 'NOT_STARTED'; record.reason = 'observer-not-armed'; return record; }

    stamp('start');
    const begun = await first.call('vibe_edit_start', {
      task, cwd: options.workspace, base_ref: options.baseRef, max_turns: 12, timeout_seconds: 180, wait_seconds: 0,
      readiness_receipt: readiness.readiness_receipt,
    });
    if (typeof begun.run_id !== 'string') { record.verdict = 'NOT_STARTED'; record.reason = 'start-refused'; return record; }
    record.run_id = begun.run_id;
    await saveRecord(record);
    const diagnosticsPath = path.join(sessionDir, 'runs', record.run_id, 'worker-diagnostics.json');
    const end = Date.now() + MAX_RUN_MS;
    let status = {};
    let workerDiagnostics = null;
    let activeWorkerConfirmed = false;
    let observerConfirmation = { confirmed: false };
    while (Date.now() < end) {
      status = await first.call('vibe_status', { run_id: record.run_id, after_seq: 0, max_events: 0, wait_seconds: 0 });
      workerDiagnostics = await readWorkerDiagnostics(diagnosticsPath);
      const completedReadCount = workerDiagnostics?.tool_calls?.filter((call) => call.tool === 'read_file' && call.outcome === 'completed').length ?? 0;
      const enteredVibe = workerDiagnostics?.stages?.includes('entrypoint_invocation');
      observerConfirmation = await readObserverGate(options.observerOutput, first.pid, record.run_id, record.timestamps.start);
      if (status.state === 'running' && enteredVibe && completedReadCount > 0 && observerConfirmation.confirmed) {
        activeWorkerConfirmed = true; record.completed_read_count_before_disconnect = completedReadCount; break;
      }
      if (['completed', 'failed', 'cancelled', 'closing', 'closed', 'orphaned', 'recoverable'].includes(status.state)) break;
      await sleep(POLL_MS);
    }
    record.active_worker_confirmed = activeWorkerConfirmed;
    record.pre_disconnect_observer_confirmation = observerConfirmation;
    record.worker_diagnostics = workerDiagnostics ? {
      stages: workerDiagnostics.stages, tool_inventory: workerDiagnostics.tool_inventory,
      tool_calls: workerDiagnostics.tool_calls, tool_inventory_truncated: workerDiagnostics.tool_inventory_truncated,
      tool_calls_truncated: workerDiagnostics.tool_calls_truncated,
    } : null;
    record.state_before_disconnect = status.state ?? null;
    if (!activeWorkerConfirmed) {
      record.verdict = 'INCONCLUSIVE'; record.reason = 'active-hosted-worker-not-proven-before-settlement';
      stamp('settled_without_disconnect');
      return record;
    }

    stamp('active_worker_confirmed');
    stamp('client_close');
    await saveRecord(record);
    await first.client.close();
    firstClosed = true;
    stamp('client_close_returned');
    await saveRecord(record);
    record.server_exited = await until(() => !alive(first.pid), SERVER_EXIT_MS);
    stamp(record.server_exited ? 'server_exit_observed' : 'server_exit_not_observed');
    await sleep(1500);
    const second = await connect(options, 'rc1-case6-official-client-reconnect');
    try {
      stamp('reconnect');
      const after = await second.call('vibe_status', { run_id: record.run_id, after_seq: 0, max_events: 0, wait_seconds: 0 });
      record.state_after_reconnect = after.state ?? null;
      record.error_code_after_reconnect = after.error?.code ?? null;
      record.retryable_after_reconnect = after.error?.retryable ?? null;
      record.last_seq_after_reconnect = after.last_seq ?? null;
      record.no_replay_confirmed = record.state_after_reconnect === 'failed'
        && record.error_code_after_reconnect === 'VSUP_BACKEND_CRASHED' && record.retryable_after_reconnect === false;
      await saveRecord(record);
    } finally {
      await second.client.close().catch(() => undefined);
      await until(() => !alive(second.pid), SERVER_EXIT_MS);
    }
    record.process_observation = await waitForObserverClosure(options.observerOutput, first.pid, record.run_id, record.timestamps.start, record.timestamps.client_close);
    record.retained_owned_worktree = await retainedWorktree(sessionDir, options.workspace, record.run_id);
    record.verdict = record.server_exited && record.state_after_reconnect === 'failed' && record.no_replay_confirmed
      && record.process_observation.owned_worker_seen_alive && record.process_observation.lock_released
      && record.process_observation.owned_process_groups_gone && record.process_observation.observed_run_state === 'failed'
      && record.process_observation.observer_started_before_run && record.process_observation.independent_observer
      && record.retained_owned_worktree.verified ? 'PASS' : 'FAIL';
    return record;
  } finally {
    if (first && !firstClosed) await first.client.close().catch(() => undefined);
  }
}

const usage = 'Usage (inert unless --execute is supplied): node official-disconnect.mjs --execute --cli <installed dist/cli.js> --config <config.toml> --workspace <fixture> --base-ref <40-char-commit> --task-file <case6-task.txt> --output <new-json> --observer-output <new-jsonl>';
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let handle;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.execute) { process.stdout.write(`${usage}\nPREPARED_ONLY; no server or hosted run started.\n`); process.exit(0); }
    handle = await open(options.output, 'wx', 0o600);
    const saveRecord = async (record) => {
      const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.truncate(0);
      await handle.write(bytes, 0, bytes.length, 0);
      await handle.truncate(bytes.length);
      await handle.sync();
    };
    const record = await run(options, saveRecord);
    await saveRecord(record);
    await handle.close(); handle = null;
    process.stdout.write(`${record.verdict}${record.run_id ? ` ${record.run_id}` : ''}\n`);
    process.exit(record.verdict === 'PASS' ? 0 : 2);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    process.stderr.write(`official-disconnect: ${error instanceof Error ? error.message : 'failed'}\n`);
    process.exit(1);
  }
}
