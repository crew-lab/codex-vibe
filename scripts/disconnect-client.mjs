#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const OPTIONS = ['--cli', '--config', '--workspace', '--operation', '--base-ref', '--task-file', '--max-turns', '--timeout-seconds', '--authorization-id', '--attempt-id', '--output', '--observer-output'];
const REQUIRED = ['--cli', '--config', '--workspace', '--operation', '--task-file', '--max-turns', '--timeout-seconds', '--authorization-id', '--attempt-id', '--output'];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'closing', 'closed', 'orphaned', 'recoverable']);
const POLL_INTERVAL_MS = 100;
const RUNNING_DEADLINE_MS = 60_000;
const DWELL_AFTER_RUNNING_MS = 2_000;
const PAUSE_BEFORE_RECONNECT_MS = 1_500;
const SERVER_EXIT_DEADLINE_MS = 15_000;
const OBSERVER_START_DEADLINE_MS = 10_000;
const OBSERVER_SECONDS = 120;
const CALL_TIMEOUT_MS = 30_000;
const observerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'disconnect-observer.mjs');

export function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!OPTIONS.includes(key) || value === undefined || values.has(key)) throw new Error('invalid-arguments');
    values.set(key, value);
  }
  if (!REQUIRED.every((key) => values.has(key))) throw new Error('invalid-arguments');
  const operation = values.get('--operation');
  if (operation !== 'review' && operation !== 'edit') throw new Error('invalid-operation');
  if ((operation === 'edit') !== values.has('--base-ref')) throw new Error('base-ref-required-for-edit-only');
  const maxTurns = Number(values.get('--max-turns'));
  const timeoutSeconds = Number(values.get('--timeout-seconds'));
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 50) throw new Error('invalid-max-turns');
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 7200) throw new Error('invalid-timeout-seconds');
  if (!UUID_V4.test(values.get('--authorization-id')) || !UUID_V4.test(values.get('--attempt-id'))) throw new Error('invalid-dispatch-identifiers');
  for (const key of ['--cli', '--config', '--workspace', '--task-file', '--output', '--observer-output']) {
    if (values.has(key) && !path.isAbsolute(values.get(key))) throw new Error(`${key.slice(2)}-must-be-absolute`);
  }
  return {
    cli: values.get('--cli'),
    config: values.get('--config'),
    workspace: values.get('--workspace'),
    operation,
    baseRef: values.get('--base-ref'),
    taskFile: values.get('--task-file'),
    maxTurns,
    timeoutSeconds,
    authorizationId: values.get('--authorization-id'),
    attemptId: values.get('--attempt-id'),
    output: values.get('--output'),
    observerOutput: values.get('--observer-output'),
  };
}

export function classify({ observedRunning, settledBeforeDisconnect, serverExited, stateAfterReconnect }) {
  if (settledBeforeDisconnect || !observedRunning) return 'INCONCLUSIVE';
  if (serverExited && stateAfterReconnect === 'failed') return 'PASS';
  return 'FAIL';
}

export function redactReadiness(reply) {
  return Object.fromEntries(Object.entries(reply ?? {}).filter(([key]) => key !== 'readiness_receipt'));
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function until(condition, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await condition()) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return condition();
}

async function connect(options, name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.cli, 'serve', '--stdio', '--config', options.config, '--isolated'],
    stderr: 'pipe',
    env: { ...process.env },
  });
  const stderr = [];
  transport.stderr?.on('data', (chunk) => { stderr.push(chunk.toString()); });
  const client = new Client({ name, version: '2.0.1' });
  await client.connect(transport);
  const call = async (tool, args) => {
    const result = await client.callTool({ name: tool, arguments: args }, { timeout: CALL_TIMEOUT_MS });
    const text = result.content?.find((part) => part.type === 'text')?.text ?? '{}';
    return result.structuredContent ?? JSON.parse(text);
  };
  return { client, call, pid: transport.pid, stderr };
}

async function startObserver(sessionDir, observerOutput) {
  const child = spawn(process.execPath, [observerScript, '--data-dir', sessionDir, '--output', observerOutput, '--seconds', String(OBSERVER_SECONDS)], {
    detached: true, stdio: 'ignore',
  });
  child.unref();
  const started = await until(async () => {
    try { return (await readFile(observerOutput, 'utf8')).includes('"type":"observer_started"'); } catch { return false; }
  }, OBSERVER_START_DEADLINE_MS);
  return { pid: child.pid, started };
}

async function runCase(options, write) {
  const record = { schema_version: 1, operation: options.operation, max_turns: options.maxTurns, timeout_seconds: options.timeoutSeconds, timestamps: {} };
  const stamp = (name) => { record.timestamps[name] = new Date().toISOString(); };
  const task = await readFile(options.taskFile, 'utf8');
  record.task_sha256 = createHash('sha256').update(task).digest('hex');

  stamp('connect');
  const first = await connect(options, 'disconnect-client');
  record.server_pid = first.pid;
  let firstClosed = false;
  try {
    const readiness = await first.call('vibe_status', { workspace: options.workspace, operation: options.operation, ...(options.baseRef ? { base_ref: options.baseRef } : {}) });
    record.readiness = redactReadiness(readiness);
    if (readiness.eligible !== true || typeof readiness.readiness_receipt !== 'string') {
      record.verdict = 'NOT_STARTED';
      record.reason = 'readiness-not-eligible';
      return record;
    }
    const sessionDir = path.join(path.dirname(await realpath(options.config)), 'mcp-sessions', String(readiness.session_id));
    if (options.observerOutput) {
      const observer = await startObserver(sessionDir, options.observerOutput);
      record.observer = { pid: observer.pid, output: options.observerOutput, started: observer.started };
      if (!observer.started) {
        record.verdict = 'NOT_STARTED';
        record.reason = 'observer-did-not-start';
        return record;
      }
    }

    stamp('start');
    const startTool = options.operation === 'edit' ? 'vibe_edit_start' : 'vibe_review_start';
    const begun = await first.call(startTool, {
      authorization_id: options.authorizationId, attempt_id: options.attemptId,
      task, cwd: options.workspace, ...(options.baseRef ? { base_ref: options.baseRef } : {}),
      max_turns: options.maxTurns, timeout_seconds: options.timeoutSeconds, wait_seconds: 0,
      readiness_receipt: readiness.readiness_receipt,
    });
    if (typeof begun.run_id !== 'string') {
      record.verdict = 'NOT_STARTED';
      record.reason = 'start-refused';
      record.start_reply = begun;
      return record;
    }
    record.run_id = begun.run_id;

    let status = {};
    const reached = await until(async () => {
      status = await first.call('vibe_status', { run_id: record.run_id, after_seq: 0, max_events: 0, wait_seconds: 0 });
      return status.state === 'running' || TERMINAL_STATES.has(status.state);
    }, RUNNING_DEADLINE_MS);
    if (reached && status.state === 'running') {
      stamp('running_first_seen');
      await sleep(DWELL_AFTER_RUNNING_MS);
      status = await first.call('vibe_status', { run_id: record.run_id, after_seq: 0, max_events: 0, wait_seconds: 0 });
    }
    record.state_before_disconnect = status.state ?? null;
    record.last_seq_before_disconnect = status.last_seq ?? null;
    record.observed_running = reached && status.state === 'running';
    record.settled_before_disconnect = TERMINAL_STATES.has(status.state);
    stamp(record.observed_running ? 'running_observed' : 'running_not_observed');

    stamp('client_close');
    await first.client.close();
    firstClosed = true;
    stamp('client_close_returned');
    record.server_exited = await until(() => !alive(first.pid), SERVER_EXIT_DEADLINE_MS);
    stamp(record.server_exited ? 'server_exit_observed' : 'server_exit_not_observed');
    await sleep(PAUSE_BEFORE_RECONNECT_MS);

    const second = await connect(options, 'disconnect-client-reconnect');
    try {
      stamp('reconnect');
      const after = await second.call('vibe_status', { run_id: record.run_id, after_seq: 0, max_events: 100, wait_seconds: 0 });
      record.state_after_reconnect = after.state ?? null;
      record.error_after_reconnect = after.error ?? null;
      record.events_after_reconnect = after.last_seq ?? null;
    } finally {
      await second.client.close().catch(() => undefined);
      await until(() => !alive(second.pid), SERVER_EXIT_DEADLINE_MS);
    }
    record.verdict = classify({
      observedRunning: record.observed_running,
      settledBeforeDisconnect: record.settled_before_disconnect,
      serverExited: record.server_exited,
      stateAfterReconnect: record.state_after_reconnect,
    });
    return record;
  } finally {
    if (!firstClosed) await first.client.close().catch(() => undefined);
    await write(record);
  }
}

function usage() {
  return 'Usage: node scripts/disconnect-client.mjs --cli <installed dist/cli.js> --config <config.toml> --workspace <repo> '
    + '--operation review|edit [--base-ref <ref>] --task-file <file> --max-turns <n> --timeout-seconds <s> --authorization-id <uuid-v4> --attempt-id <uuid-v4> --output <new-json-file> [--observer-output <new-jsonl-file>]\n'
    + 'One official-client active disconnect: readiness, one start, client.close() two seconds after the run is first seen running, then a reconnect that reads the saved run. '
    + 'It never retries, never signals a process and never calls vibe_close.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const options = parseArgs(args);
    const handle = await open(options.output, 'wx', 0o600);
    const record = await runCase(options, async (result) => { await handle.writeFile(`${JSON.stringify(result, null, 2)}\n`, 'utf8'); await handle.close(); });
    process.stdout.write(`${record.verdict}${record.run_id ? ` ${record.run_id}` : ''}\n`);
    process.exit(record.verdict === 'PASS' ? 0 : 2);
  } catch (error) {
    process.stderr.write(`disconnect-client: ${error instanceof Error ? error.message : 'failed'}\n`);
    process.exit(1);
  }
}
