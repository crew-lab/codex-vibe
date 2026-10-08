import { appendFile, chmod, lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'smol-toml';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = process.env.VIBE_SUPERVISOR_DIST_DIR ? path.resolve(process.env.VIBE_SUPERVISOR_DIST_DIR) : path.join(root, 'dist');
const MAX_RUNS = 500;
const SETTLED_STATES = new Set(['completed', 'failed', 'cancelled', 'closed', 'recoverable']);
const SCENARIO_CYCLE = ['continue', 'close_mid', 'restart_completed'];
const PERMISSION_FAILURE = 'driver:permission_request';
const TRUNCATION_STOP_REASONS = new Set(['max_turn_requests', 'max_tokens']);

const USAGE = `Usage: node scripts/soak.mjs --workspace <repo> [options]

  --workspace <repo>        Git repository to review and edit; must be in the template config allowlist (required)
  --reviews N               Programmatic review runs (default 60)
  --edits N                 Programmatic edit runs (default 30)
  --acp N                   ACP runs spread over continue, mid-turn close and restart scenarios (default 10)
  --seed S                  Seed for the deterministic run order (default "soak")
  --tasks <file.json>       Custom tasks: {"review":[...],"edit":[...],"acp":[...],"long":[...],"followup":[...]}
  --out <dir>               Evidence directory, created owner-only (default ./soak-evidence-<timestamp>)
  --server-command <cmd>    MCP server executable (default vibe-supervisor)
  --server-arg <arg>        Argument for the server command; repeatable (default serve --stdio)
  --wait-seconds N          wait_seconds for vibe_status polls, 1 to 300 (default 180)
  --start-wait N            wait_seconds for the start calls, 0 to 300 (default 5)
  --run-timeout N           Driver limit in seconds (default 900); initial worker deadline is at most N-30 for N >= 60
  --diagnostics             Record bounded private launcher diagnostics for programmatic workers
  --total-timeout N          Overall seconds, at least 61; reserve final 60 seconds for cleanup
  --stop-on-fail            Stop after the first failed run; a truncated run is not a failure
  --max-truncated-percent N Largest share of completed runs allowed to end truncated, 0 to 100 (default 10)
  --yes                     Start the hosted runs; without it only the plan is printed

Built-in tasks are bounded: each names its files, caps the reads and searches, and requires a final answer
in a few lines, so the soak tests supervisor reliability and not whether the model can finish an open-ended
task. The review-long task is the exception: it is meant to run long and only feeds the mid-turn close and
in-progress restart scenarios, which never wait for it to finish.

A run that completes with stop_reason max_turn_requests or max_tokens and carries the supervisor's partial-result
warning is reported as truncated: it is counted per kind and backend in summary.json and checked by the
truncated_within_threshold criterion, not counted as an unexpected failure. Any other stop reason, a missing
warning, a failed state, a timeout, a lost run or a leaked process or worktree is still a failure.

The backend comes from configuration only: the driver copies the template config (VIBE_SUPERVISOR_HOME or the
default config home) into two private homes under --out with the backend overridden. It never approves a
permission request and never changes the template config or the Codex config.
`;

class Fatal extends Error {}
class Usage extends Error {}

function parseCommandLine(argv) {
  const o = {
    workspace: undefined, reviews: 60, edits: 30, acp: 10, seed: 'soak', tasks: undefined, out: undefined,
    serverCommand: undefined, serverArgs: [], waitSeconds: 180, startWait: 5, runTimeout: 900, stopOnFail: false, maxTruncatedPercent: 10, diagnostics: false, totalTimeout: undefined, yes: false, help: false,
  };
  const integer = (name, value, min, max) => {
    if (!/^\d+$/.test(value ?? '')) throw new Usage(`${name} needs a non-negative integer.`);
    const parsed = Number(value);
    if (parsed < min || parsed > max) throw new Usage(`${name} must be between ${min} and ${max}.`);
    return parsed;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const take = () => {
      index += 1;
      if (index >= argv.length) throw new Usage(`${flag} needs a value.`);
      return argv[index];
    };
    if (flag === '--help' || flag === '-h') o.help = true;
    else if (flag === '--yes') o.yes = true;
    else if (flag === '--diagnostics') o.diagnostics = true;
    else if (flag === '--total-timeout') o.totalTimeout = integer(flag, take(), 61, 86_400);
    else if (flag === '--stop-on-fail') o.stopOnFail = true;
    else if (flag === '--max-truncated-percent') o.maxTruncatedPercent = integer(flag, take(), 0, 100);
    else if (flag === '--workspace') o.workspace = take();
    else if (flag === '--reviews') o.reviews = integer(flag, take(), 0, MAX_RUNS);
    else if (flag === '--edits') o.edits = integer(flag, take(), 0, MAX_RUNS);
    else if (flag === '--acp') o.acp = integer(flag, take(), 0, MAX_RUNS);
    else if (flag === '--seed') o.seed = take();
    else if (flag === '--tasks') o.tasks = take();
    else if (flag === '--out') o.out = take();
    else if (flag === '--server-command') o.serverCommand = take();
    else if (flag === '--server-arg') o.serverArgs.push(take());
    else if (flag === '--wait-seconds') o.waitSeconds = integer(flag, take(), 1, 300);
    else if (flag === '--start-wait') o.startWait = integer(flag, take(), 0, 300);
    else if (flag === '--run-timeout') o.runTimeout = integer(flag, take(), 1, 86_400);
    else throw new Usage(`Unknown option: ${flag}`);
  }
  if (o.help) return o;
  if (!o.workspace) throw new Usage('--workspace is required.');
  if (o.serverArgs.length && !o.serverCommand) throw new Usage('--server-arg needs --server-command.');
  if (o.reviews + o.edits + o.acp < 1) throw new Usage('Nothing to run: set at least one of --reviews, --edits, --acp.');
  if (o.reviews + o.edits + o.acp > MAX_RUNS) throw new Usage(`Refusing more than ${MAX_RUNS} runs in one soak.`);
  if (!o.serverCommand) { o.serverCommand = 'vibe-supervisor'; o.serverArgs = ['serve', '--stdio']; }
  return o;
}

async function loadDist() {
  const load = (file) => import(pathToFileURL(path.join(distRoot, file)).href);
  try {
    const [config, validation, paths, redaction] = await Promise.all([load('config/config.js'), load('config/validation.js'), load('security/paths.js'), load('security/redaction.js')]);
    return { ...config, ...validation, ...paths, ...redaction };
  } catch (error) {
    throw new Usage(`Cannot load the compiled supervisor from ${distRoot} (${error.message}). Run npm run build first.`);
  }
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedNumber(text) {
  let hash = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const REVIEW_TASKS = [
  { id: 'review-file', task: 'Read only the file {file} and at most two files it imports. Use at most 3 searches. Do not modify anything and do not use a shell. Then stop reading and answer in at most 5 lines: the most important correctness problems or unclear code in {file}, each with a line reference. If you find none, say so.' },
  { id: 'review-bug-class', task: 'Look for missing error handling, unchecked inputs and resource leaks only in the file {file}. Read only that file and at most one file it imports. Use at most 2 searches. Do not modify anything and do not use a shell. Then stop reading and answer in at most 5 lines: up to three findings with line references, or say that there are none.' },
];

const BUILT_IN_TASKS = {
  review: REVIEW_TASKS,
  edit: [
    { id: 'edit-add-file', task: 'Create exactly one new file named soak-note-{n}.txt in the repository root containing a single sentence describing this repository. Read at most two files to write that sentence and use no searches. Do not change any other file. Then stop and answer in one line with the file name.' },
    { id: 'edit-one-line', task: 'In the file {file}, change exactly one line to fix a typo or improve a name. Read only that file and use no searches. Do not change any other line or file. If nothing needs changing, append one short neutral line to the end of that file instead. Then stop and answer in one line saying which line you changed.' },
  ],
  acp: REVIEW_TASKS,
  long: [
    { id: 'review-long', task: 'Read every source file in this repository one at a time and write a detailed review of each, file by file. Only read files; do not modify anything.' },
  ],
  followup: [
    { id: 'followup-summary', task: 'The previous task is finished; this is a new, separate request. Do not read or search anything further. In two sentences, summarize the most important finding of your previous answer.' },
  ],
};

async function loadTasks(file) {
  const tasks = structuredClone(BUILT_IN_TASKS);
  if (!file) return tasks;
  let parsed;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Usage(`Cannot read the tasks file: ${error.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Usage('The tasks file must be a JSON object.');
  for (const [kind, entries] of Object.entries(parsed)) {
    if (!(kind in tasks)) throw new Usage(`Unknown task kind in the tasks file: ${kind}`);
    if (!Array.isArray(entries) || entries.length === 0) throw new Usage(`Tasks for ${kind} must be a non-empty array.`);
    tasks[kind] = entries.map((entry, index) => {
      const item = typeof entry === 'string' ? { id: `custom-${kind}-${index + 1}`, task: entry } : entry;
      if (!item || typeof item.task !== 'string' || item.task.length < 1 || item.task.length > 100_000) throw new Usage(`Task ${index + 1} of ${kind} must be a string of 1 to 100000 characters.`);
      const id = typeof item.id === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(item.id) ? item.id : `custom-${kind}-${index + 1}`;
      return { id, task: item.task };
    });
  }
  return tasks;
}

async function candidateFiles(workspace) {
  let names = [];
  try { names = (await exec('git', ['-C', workspace, 'ls-files', '-z'], { maxBuffer: 32 * 1024 * 1024 })).stdout.split('\0').filter(Boolean); }
  catch { names = []; }
  const kept = [];
  for (const name of names.sort()) {
    if (/(^|\/)\.env/.test(name) || /\.(pem|key|p12|pfx)$/i.test(name) || /(^|\/)(id_rsa|id_ed25519|secrets?)([./]|$)/i.test(name) || /(^|[/])node_modules[/]/.test(name)) continue;
    try {
      const info = await lstat(path.join(workspace, name));
      if (info.isFile() && info.size > 0 && info.size <= 200_000) kept.push(name);
    } catch {}
    if (kept.length >= 500) break;
  }
  return kept;
}

function buildPlan(o, tasks, files, workspace) {
  const random = mulberry32(seedNumber(o.seed));
  const pick = (list, index) => list[index % list.length];
  const fileFor = () => files.length ? files[Math.floor(random() * files.length)] : 'any source file in the repository';
  const fill = (text, n) => text.replaceAll('{file}', fileFor()).replaceAll('{n}', String(n));
  let counter = 0;
  const programmatic = [];
  for (let index = 0; index < o.reviews; index += 1) { counter += 1; const t = pick(tasks.review, index); programmatic.push({ kind: 'review', backend: 'programmatic', taskId: t.id, task: fill(t.task, counter) }); }
  for (let index = 0; index < o.edits; index += 1) { counter += 1; const t = pick(tasks.edit, index); programmatic.push({ kind: 'edit', backend: 'programmatic', taskId: t.id, task: fill(t.task, counter) }); }
  const acp = [];
  for (let index = 0; index < o.acp; index += 1) {
    counter += 1;
    const scenario = o.acp >= 4 && index === o.acp - 1 ? 'restart_in_progress' : SCENARIO_CYCLE[index % SCENARIO_CYCLE.length];
    const long = scenario === 'close_mid' || scenario === 'restart_in_progress';
    const t = long ? pick(tasks.long, index) : pick(tasks.acp, index);
    const job = { kind: 'acp', backend: 'acp', scenario, taskId: t.id, task: fill(t.task, counter) };
    if (scenario === 'continue') { const f = pick(tasks.followup, index); job.followupId = f.id; job.followup = fill(f.task, counter); }
    if (scenario === 'restart_completed' || scenario === 'restart_in_progress') { const f = pick(tasks.followup, index); job.followupId = f.id; job.followup = fill(f.task, counter); }
    acp.push(job);
  }
  return { programmatic: shuffle(programmatic, random), acp: shuffle(acp, random), workspace };
}

function hostedTurns(plan) {
  return plan.programmatic.length + plan.acp.length + plan.acp.filter((job) => job.scenario !== 'close_mid').length;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]);
}

function latency(values) {
  return { count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withTimeout(promise, milliseconds, message) {
  let timer;
  const limit = new Promise((resolve, reject) => { timer = setTimeout(() => (message ? reject(new Error(message)) : resolve(undefined)), milliseconds); });
  try { return await Promise.race([promise, limit]); }
  finally { clearTimeout(timer); }
}

async function directoryBytes(directory) {
  let total = 0;
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(target);
    else { try { total += (await lstat(target)).size; } catch {} }
  }
  return total;
}

async function parentMap() {
  const parents = new Map();
  try {
    const { stdout } = await exec('ps', ['-axo', 'pid=,ppid='], { maxBuffer: 8 * 1024 * 1024 });
    for (const line of stdout.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (match) parents.set(Number(match[1]), Number(match[2]));
    }
  } catch {}
  return parents;
}

function descendsFromDriver(pid, parents) {
  const seen = new Set();
  for (let current = parents.get(pid); current && !seen.has(current); current = parents.get(current)) {
    if (current === process.pid || spawnedPids.has(current)) return true;
    seen.add(current);
  }
  return false;
}

function attribute(found, baseline, parents) {
  const fresh = [...found].filter(([pid]) => !baseline.has(pid));
  const leaked = fresh.filter(([pid]) => parents.get(pid) === 1 || descendsFromDriver(pid, parents));
  return { leaked, unrelated: fresh.length - leaked.length };
}

async function scanProcesses() {
  const found = new Map();
  for (const pattern of ['vibe', 'vibe_supervisor_launcher']) {
    try {
      const { stdout } = await exec('pgrep', ['-fl', pattern], { maxBuffer: 4 * 1024 * 1024 });
      for (const line of stdout.split('\n')) {
        const match = line.match(/^(\d+)\s*(.*)$/);
        if (match) found.set(Number(match[1]), match[2]);
      }
    } catch {}
  }
  found.delete(process.pid);
  return found;
}

const spawnedPids = new Set();

function killSpawned() {
  for (const pid of spawnedPids) {
    if (isAlive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }
}

function parseReply(result) {
  const text = result?.content?.find((part) => part.type === 'text')?.text ?? '';
  let data = result?.structuredContent;
  if (!data) { try { data = JSON.parse(text); } catch { data = undefined; } }
  if (result?.isError) {
    const code = data?.error?.code ?? text.match(/^(VSUP_[A-Z_]+)/)?.[1] ?? 'driver:tool_error';
    return { ok: false, code, message: String(data?.error?.message ?? text).slice(0, 300), data };
  }
  if (!data || typeof data !== 'object') return { ok: false, code: 'driver:unparseable_reply', message: 'The reply was not a JSON object.' };
  return { ok: true, data };
}

function createHolder(backend, home, o, ui) {
  const holder = {
    backend, home, server: null, serverCount: 0,
    async begin() {
      this.serverCount += 1;
      const label = `${backend}-${this.serverCount}`;
      const transport = new StdioClientTransport({ command: o.serverCommand, args: o.serverArgs, env: { ...process.env, VIBE_SUPERVISOR_HOME: home, VIBE_SUPERVISOR_DIAGNOSTICS: o.diagnostics ? '1' : '0' }, stderr: 'pipe' });
      const client = new Client({ name: 'vibe-supervisor-soak', version: '1.0.0' });
      const stderr = [];
      let stderrBytes = 0;
      transport.stderr?.on('data', (chunk) => { if (stderrBytes < 262_144) { stderr.push(chunk); stderrBytes += chunk.length; } });
      const began = performance.now();
      try {
        await withTimeout(client.connect(transport), 30_000, 'The server did not initialize within 30 seconds.');
      } catch (error) {
        await client.close().catch(() => {});
        throw new Fatal(`Cannot start the ${backend} server (${error.message}). Server command: ${o.serverCommand} ${o.serverArgs.join(' ')}`);
      }
      const pid = transport.pid;
      if (pid) spawnedPids.add(pid);
      this.server = { client, transport, pid, label, stderr, startupMs: Math.round(performance.now() - began) };
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      const expected = backend === 'programmatic' ? 5 : 7;
      if (tools.length !== expected || tools.includes('vibe_cancel')) throw new Fatal(`The ${backend} server registered ${tools.length} tools (${tools.join(', ')}); expected ${expected} and no vibe_cancel.`);
    },
    async stop() {
      const server = this.server;
      if (!server) return;
      this.server = null;
      await withTimeout(server.client.close().catch(() => {}), 20_000);
      if (isAlive(server.pid)) { try { process.kill(server.pid, 'SIGKILL'); } catch {} }
      await ui.writeStderr(server.label, Buffer.concat(server.stderr).toString('utf8'));
    },
    async ensure() {
      if (this.server && isAlive(this.server.pid)) return;
      if (this.server) await this.stop();
      await this.begin();
    },
    async restart() {
      await this.stop();
      await this.begin();
      return this.server.startupMs;
    },
  };
  return holder;
}

function newRecord(job, index, total) {
  return {
    index, of: total, backend: job.backend, kind: job.kind, scenario: job.scenario ?? null, taskId: job.taskId, followupId: job.followupId ?? null,
    runId: null, startedAt: new Date().toISOString(), durationMs: 0, toolCalls: 0, events: 0, eventTypes: {},
    permissionRequests: 0, permissionRejected: 0, requests: [], timeToFirstEventMs: null, timeToSettledMs: null,
    finalState: null, stopReason: null, errorCode: null, warnings: [], integrity: null, usage: null, changedFilesTotal: null,
    turns: [], closeState: null, worktreeRemoved: null, worktreeRetainedReason: null, restart: null, closeMid: null,
    serverLost: false, truncated: false, failures: [], ok: true,
  };
}

function failRun(ctx, code, message) {
  ctx.rec.failures.push({ code, message: String(message ?? '').slice(0, 300) });
}

function beginTurn(ctx, label) {
  ctx.turn = { label, began: performance.now(), firstEventMs: null, firstEventAfterSettle: false, settledMs: null, state: null, stopReason: null, errorCode: null, integrity: null, usage: null, warnings: [], events: 0 };
  ctx.rec.turns.push(ctx.turn);
}

function elapsed(turn) {
  return Math.round(performance.now() - turn.began);
}

async function call(ctx, name, args, waitSeconds = 0, cleanup = false) {
  ctx.rec.toolCalls += 1;
  const server = ctx.holder.server;
  const remaining = (cleanup ? ctx.o.totalDeadline : ctx.o.workDeadline) === undefined ? Infinity : (cleanup ? ctx.o.totalDeadline : ctx.o.workDeadline) - performance.now();
  if (remaining <= 0) { ctx.o.totalExpired = true; return { ok: false, code: 'driver:total_timeout', message: 'Overall hosted time budget exhausted.' }; }
  try {
    const result = await server.client.callTool({ name, arguments: args }, { timeout: Math.max(1, Math.min((waitSeconds + 45) * 1000, cleanup ? 30_000 : Infinity, remaining)) });
    return parseReply(result);
  } catch (error) {
    if (!cleanup && ctx.o.workDeadline !== undefined && performance.now() >= ctx.o.workDeadline) { ctx.o.totalExpired = true; return { ok: false, code: 'driver:total_timeout', message: 'Overall hosted time budget exhausted.' }; }
    return { ok: false, code: 'driver:transport_error', message: String(error?.message ?? error).slice(0, 300) };
  }
}

function ingest(ctx, reply) {
  const turn = ctx.turn;
  ctx.lastPublic = { state: reply.state, last_seq: reply.last_seq, pending_request: Boolean(reply.pending_request) };
  const events = Array.isArray(reply.events) ? reply.events : [];
  let progressed = false;
  for (const event of events) {
    if (typeof event.seq !== 'number') continue;
    if (ctx.seen.has(event.seq)) { failRun(ctx, 'driver:event_duplicate', `seq ${event.seq} delivered twice`); continue; }
    if (event.seq <= ctx.after) failRun(ctx, 'driver:event_order', `seq ${event.seq} at or before after_seq ${ctx.after}`);
    ctx.seen.add(event.seq);
    ctx.rec.events += 1;
    turn.events += 1;
    progressed = true;
    ctx.rec.eventTypes[event.type] = (ctx.rec.eventTypes[event.type] ?? 0) + 1;
    if (turn.firstEventMs === null) { turn.firstEventMs = elapsed(turn); turn.firstEventAfterSettle = turn.settledMs !== null; }
  }
  if (typeof reply.next_after_seq === 'number') {
    if (reply.next_after_seq < ctx.after) failRun(ctx, 'driver:event_order', 'next_after_seq moved backwards');
    else ctx.after = reply.next_after_seq;
  }
  return progressed;
}

const REJECT = /reject|deny|decline/i;
const GRANT = /allow|accept|approve|always|grant/i;

async function answerPending(ctx, pending) {
  const rec = ctx.rec;
  rec.permissionRequests += 1;
  const summary = { kind: pending.kind, tool: pending.tool?.kind ?? null, responded: null };
  rec.requests.push(summary);
  failRun(ctx, PERMISSION_FAILURE, `${pending.kind} request: ${String(pending.title ?? '').slice(0, 120)}`);
  if (ctx.holder.backend === 'programmatic') { summary.responded = 'no_respond_tool'; return false; }
  let answer;
  if (pending.kind === 'permission') {
    const option = (pending.options ?? []).find((candidate) => {
      const text = `${candidate.option_id} ${candidate.kind ?? ''} ${candidate.name ?? ''}`;
      return REJECT.test(text) && !GRANT.test(text);
    });
    if (!option) { summary.responded = 'no_reject_option'; return false; }
    answer = { run_id: ctx.runId, request_id: pending.request_id, kind: 'permission', option_id: option.option_id };
    summary.responded = 'reject';
  } else {
    answer = { run_id: ctx.runId, request_id: pending.request_id, kind: 'elicitation', action: 'decline' };
    summary.responded = 'decline';
  }
  const reply = await call(ctx, 'vibe_respond', answer);
  if (!reply.ok) { summary.responded = `error:${reply.code}`; failRun(ctx, reply.code, reply.message); return false; }
  rec.permissionRejected += 1;
  return true;
}

async function awaitSettled(ctx, first, options = {}) {
  const turn = ctx.turn;
  if (first && SETTLED_STATES.has(first.state) && turn.settledMs === null) turn.settledMs = elapsed(turn);
  if (first?.pending_request && !(await answerPending(ctx, first.pending_request))) return { aborted: true, reply: first };
  let stalled = 0;
  for (;;) {
    const remaining = ctx.deadline - performance.now();
    if (remaining <= 0) {
      if (ctx.o.workDeadline !== undefined && performance.now() >= ctx.o.workDeadline) { ctx.o.totalExpired = true; return { totalTimedOut: true }; }
      return { timedOut: true };
    }
    const wait = Math.max(1, Math.min(ctx.o.waitSeconds, Math.floor(remaining / 1000)));
    const polled = await call(ctx, 'vibe_status', { run_id: ctx.runId, after_seq: ctx.after, max_events: 100, wait_seconds: wait }, wait);
    if (!polled.ok) return { error: polled };
    const reply = polled.data;
    const progressed = ingest(ctx, reply);
    if (reply.pending_request) {
      if (!(await answerPending(ctx, reply.pending_request))) return { aborted: true, reply };
      continue;
    }
    const settled = SETTLED_STATES.has(reply.state);
    if (settled && turn.settledMs === null) turn.settledMs = elapsed(turn);
    if (options.untilFirstEvent && turn.firstEventMs !== null) return { reply, firstEvent: true, settled };
    if (settled) {
      if (typeof reply.last_seq !== 'number' || ctx.after >= reply.last_seq) return { reply, settled };
      stalled = progressed ? 0 : stalled + 1;
      if (stalled >= 3) { failRun(ctx, 'driver:event_paging_stalled', `after_seq ${ctx.after} behind last_seq ${reply.last_seq}`); return { reply, settled }; }
    }
  }
}

function judge(ctx, outcome, expectation = 'completed') {
  const turn = ctx.turn;
  if (outcome.totalTimedOut) { failRun(ctx, 'driver:total_timeout', 'Overall hosted time budget exhausted.'); return false; }
  if (outcome.timedOut) { failRun(ctx, 'driver:run_timeout', `no settled result within ${ctx.o.runTimeout} seconds`); return false; }
  if (outcome.error) { failRun(ctx, outcome.error.code, outcome.error.message); return false; }
  if (outcome.aborted) return false;
  const reply = outcome.reply;
  const result = reply.result ?? reply;
  turn.state = reply.state;
  turn.stopReason = result.stop_reason ?? null;
  turn.errorCode = result.error?.code ?? reply.error?.code ?? null;
  turn.integrity = result.integrity?.status ?? null;
  turn.usage = result.usage ?? null;
  const allWarnings = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
  turn.warnings = allWarnings.map((warning) => warning.slice(0, 200)).slice(0, 5);
  const partialWarning = allWarnings.some((warning) => TRUNCATION_STOP_REASONS.has(turn.stopReason) && warning.includes(`stop reason ${turn.stopReason}`) && /incomplete/i.test(warning));
  if (typeof result.changed_files_total === 'number') ctx.rec.changedFilesTotal = result.changed_files_total;
  else if (Array.isArray(result.changed_files)) ctx.rec.changedFilesTotal = result.changed_files.length;
  if (expectation === 'any') return true;
  if (reply.state !== 'completed') { failRun(ctx, turn.errorCode ?? `driver:state_${reply.state}`, `run ended ${reply.state}`); return false; }
  let good = true;
  if (TRUNCATION_STOP_REASONS.has(turn.stopReason) && partialWarning) turn.truncated = true;
  else if (turn.stopReason !== 'end_turn') { failRun(ctx, `driver:stop_reason_${turn.stopReason ?? 'missing'}`, 'stop_reason is not end_turn'); good = false; }
  if (ctx.job.kind !== 'edit' && turn.integrity !== 'verified') { failRun(ctx, `driver:integrity_${turn.integrity ?? 'missing'}`, 'review integrity is not verified'); good = false; }
  return good;
}

async function closeRun(ctx) {
  if (!ctx.runId || ctx.closed) return;
  ctx.closed = true;
  if (!isAlive(ctx.holder.server?.pid)) return;
  const edit = ctx.job.kind === 'edit';
  const reply = await call(ctx, 'vibe_close', { run_id: ctx.runId, cleanup_worktree: edit }, 0, true);
  if (!reply.ok) { failRun(ctx, reply.code, `close: ${reply.message}`); return; }
  ctx.rec.closeState = reply.data.state ?? null;
  ctx.rec.worktreeRemoved = reply.data.worktree_removed ?? null;
  ctx.rec.worktreeRetainedReason = reply.data.worktree_retained_reason ? String(reply.data.worktree_retained_reason).slice(0, 200) : null;
  if (reply.data.error) failRun(ctx, reply.data.error.code ?? 'driver:close_error', `close: ${reply.data.error.message ?? ''}`);
  if (reply.data.state !== 'closed') failRun(ctx, 'driver:not_closed', `close left the run ${reply.data.state}`);
  if (edit && reply.data.worktree_removed !== true) failRun(ctx, 'driver:worktree_not_removed', ctx.rec.worktreeRetainedReason ?? 'worktree_removed was not true');
}

async function recordUsage(ctx) {
  if (!ctx.runId || ctx.closed || !isAlive(ctx.holder.server?.pid)) return;
  const reply = await call(ctx, 'vibe_result', { run_id: ctx.runId, detail: 'full' });
  if (reply.ok && reply.data.usage && ctx.turn) ctx.turn.usage = reply.data.usage;
}

async function continueTurn(ctx, message) {
  beginTurn(ctx, 'continue');
  const reply = await call(ctx, 'vibe_continue', { run_id: ctx.runId, message });
  if (!reply.ok) return { error: reply };
  return awaitSettled(ctx, reply.data);
}

async function startRun(ctx) {
  const { job, o } = ctx;
  beginTurn(ctx, 'start');
  const configured = job.kind === 'edit' ? o.editTimeout : o.reviewTimeout;
  const timeoutSeconds = o.runTimeout >= 60 ? Math.min(configured, 7200, o.runTimeout - 30) : undefined;
  const started = await call(ctx, job.kind === 'edit' ? 'vibe_edit_start' : 'vibe_review_start', { task: job.task, cwd: o.workspace, wait_seconds: o.startWait, ...(timeoutSeconds === undefined ? {} : { timeout_seconds: timeoutSeconds }) }, o.startWait);
  if (!started.ok) {
    if (started.code === 'VSUP_WORKSPACE_INVALID') throw new Fatal(`The server rejected the workspace ${o.workspace} (VSUP_WORKSPACE_INVALID). Add it to allowed_workspace_roots in the template config (vibe-supervisor allow <dir>) and run again.`);
    failRun(ctx, started.code, started.message);
    return undefined;
  }
  ctx.runId = started.data.run_id;
  ctx.rec.runId = ctx.runId;
  return started.data;
}

async function scenario(ctx) {
  const { job } = ctx;
  const first = await startRun(ctx);
  if (!first) return;
  if (job.scenario === 'close_mid') {
    const outcome = await awaitSettled(ctx, first, { untilFirstEvent: true });
    if (!outcome.firstEvent || outcome.settled) {
      judge(ctx, outcome);
      ctx.rec.closeMid = { exercised: false };
      return;
    }
    ctx.rec.closeMid = { exercised: true, stateBeforeClose: outcome.reply.state };
    const closed = await call(ctx, 'vibe_close', { run_id: ctx.runId, cleanup_worktree: false });
    ctx.closed = true;
    if (!closed.ok) { failRun(ctx, closed.code, `close: ${closed.message}`); return; }
    ctx.rec.closeState = closed.data.state ?? null;
    ctx.turn.settledMs = elapsed(ctx.turn);
    const detail = await call(ctx, 'vibe_result', { run_id: ctx.runId, detail: 'compact' });
    const result = detail.ok ? detail.data : {};
    ctx.turn.state = closed.data.state;
    ctx.turn.stopReason = result.stop_reason ?? null;
    ctx.turn.errorCode = result.error?.code ?? null;
    ctx.rec.closeMid.stopReason = ctx.turn.stopReason;
    if (closed.data.state !== 'closed') failRun(ctx, 'driver:not_closed', `mid-turn close left the run ${closed.data.state}`);
    if (ctx.turn.errorCode && ctx.turn.errorCode !== 'VSUP_CANCELLED') failRun(ctx, ctx.turn.errorCode, 'mid-turn close recorded an error other than VSUP_CANCELLED');
    if (ctx.turn.stopReason && ctx.turn.stopReason !== 'cancelled') failRun(ctx, `driver:stop_reason_${ctx.turn.stopReason}`, 'mid-turn close ended with a stop_reason other than cancelled');
    return;
  }
  if (job.scenario === 'restart_in_progress') return restartScenario(ctx, first, true);
  const good = judge(ctx, await awaitSettled(ctx, first));
  if (!good) return;
  if (job.scenario === 'continue') {
    const second = await continueTurn(ctx, job.followup);
    judge(ctx, second);
    return;
  }
  if (job.scenario === 'restart_completed') return restartScenario(ctx, undefined, false);
}

async function restartScenario(ctx, first, inProgress) {
  const { rec, holder, job } = ctx;
  let lastSeq = null;
  if (inProgress) {
    const outcome = await awaitSettled(ctx, first, { untilFirstEvent: true });
    if (!outcome.firstEvent || outcome.settled) { judge(ctx, outcome); rec.restart = { when: 'in_progress', exercised: false }; return; }
    lastSeq = outcome.reply.last_seq ?? ctx.after;
  } else {
    const latest = await call(ctx, 'vibe_status', { run_id: ctx.runId, after_seq: ctx.after, max_events: 0 });
    lastSeq = latest.ok ? latest.data.last_seq : null;
  }
  const info = { when: inProgress ? 'in_progress' : 'after_completed', exercised: true, lastSeqBefore: lastSeq };
  rec.restart = info;
  try { info.startupMs = await holder.restart(); }
  catch (error) { throw error instanceof Fatal ? error : new Fatal(String(error.message)); }
  const after = await call(ctx, 'vibe_status', { run_id: ctx.runId, after_seq: 0, max_events: 0 });
  if (!after.ok) { info.outcome = `status_error:${after.code}`; failRun(ctx, after.code, `status after restart: ${after.message}`); return; }
  info.stateAfterRestart = after.data.state;
  info.lastSeqAfter = after.data.last_seq;
  const resumable = after.data.state === 'recoverable' || after.data.state === 'completed';
  if (!resumable && ['queued', 'starting', 'running', 'negotiating'].includes(after.data.state)) {
    info.outcome = 'replay_suspected';
    failRun(ctx, 'driver:restart_replay', `run is ${after.data.state} after restart without a continue`);
    return;
  }
  if (!resumable) { info.outcome = `state:${after.data.state}`; return; }
  const second = await continueTurn(ctx, job.followup);
  if (second.error) {
    info.outcome = `error:${second.error.code}`;
    info.errorCode = second.error.code;
    if (second.error.code === 'VSUP_INTERNAL' || second.error.code.startsWith('driver:')) failRun(ctx, second.error.code, second.error.message);
    return;
  }
  const good = judge(ctx, second);
  info.outcome = good ? 'reloaded' : `failed:${ctx.turn.state ?? 'unknown'}`;
}

function finalizeRecord(ctx) {
  const rec = ctx.rec;
  rec.turns = rec.turns.map((turn) => { const copy = { ...turn }; delete copy.began; return copy; });
  const firstTurn = rec.turns[0];
  const lastTurn = rec.turns.at(-1);
  rec.timeToFirstEventMs = firstTurn?.firstEventMs ?? null;
  rec.timeToSettledMs = firstTurn?.settledMs ?? null;
  rec.finalState = lastTurn?.state ?? null;
  rec.stopReason = lastTurn?.stopReason ?? null;
  rec.errorCode = [...rec.turns].reverse().find((turn) => turn.errorCode)?.errorCode ?? null;
  rec.integrity = lastTurn?.integrity ?? null;
  rec.usage = [...rec.turns].reverse().find((turn) => turn.usage)?.usage ?? null;
  rec.truncated = rec.turns.some((turn) => turn.truncated === true);
  rec.warnings = rec.turns.flatMap((turn) => turn.warnings).slice(0, 10);
  rec.ok = rec.failures.length === 0;
  rec.durationMs = Math.round(performance.now() - ctx.began);
}

async function executeJob(holder, job, o, index, total) {
  const rec = newRecord(job, index, total);
  const ctx = { holder, job, o, rec, runId: null, after: 0, turn: null, seen: new Set(), closed: false, began: performance.now(), deadline: Math.min(performance.now() + o.runTimeout * 1000, o.workDeadline ?? Infinity) };
  try {
    await holder.ensure();
    await scenario(ctx);
  } catch (error) {
    if (error instanceof Fatal) { failRun(ctx, 'driver:fatal', error.message); finalizeRecord(ctx); throw Object.assign(error, { record: rec }); }
    failRun(ctx, 'driver:exception', error?.message ?? error);
  }
  if (holder.server && !isAlive(holder.server.pid)) { rec.serverLost = true; failRun(ctx, 'driver:server_exited', 'the server process exited during this run'); }
  if (o.workDeadline !== undefined && performance.now() >= o.workDeadline) o.totalExpired = true;
  try { await preserveDiagnostics(ctx); } catch { rec.diagnostics = { status: 'unavailable' }; }
  try { await recordUsage(ctx); } catch {}
  try { await closeRun(ctx); } catch (error) { failRun(ctx, 'driver:exception', `close: ${error?.message ?? error}`); }
  finalizeRecord(ctx);
  return rec;
}

async function preserveDiagnostics(ctx) {
  if (!ctx.o.diagnostics || !ctx.runId || !/^[a-f0-9-]{36}$/.test(ctx.runId)) return;
  const directory = path.join(ctx.holder.home, 'runs', ctx.runId);
  const file = path.join(directory, 'worker-diagnostics.json');
  const info = await lstat(file).catch(() => null);
  if (!info) { ctx.rec.diagnostics = { status: 'absent', public_status: ctx.lastPublic ?? null, events: ctx.rec.events }; return; }
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid?.() || info.nlink !== 1 || info.size > 65536 || await realpath(directory) !== directory) throw new Error('Unsafe diagnostics');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const opened = await handle.stat();
    if (opened.ino !== info.ino || opened.dev !== info.dev || !opened.isFile() || opened.uid !== info.uid || opened.mode & 0o077 || opened.nlink !== 1 || opened.size > 65536) throw new Error('Changed diagnostics');
    bytes = Buffer.alloc(65537);
    const read = await handle.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead > 65536) throw new Error('Oversized diagnostics');
    bytes = bytes.subarray(0, read.bytesRead);
  } finally { await handle.close(); }
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.schema_version !== 1 || !Array.isArray(data.stages) || !Array.isArray(data.snapshots) || data.stages.length > 6 || data.snapshots.length > 3) throw new Error('Invalid diagnostics');
  const stages = new Set(['launch', 'import', 'prompt_consumption', 'persistence_setup', 'credential_resolution_complete', 'entrypoint_invocation']);
  const elapsed = (value) => Number.isSafeInteger(value) && value >= 0;
  const safe = { schema_version: 1, stages: data.stages.map((item) => {
    if (!stages.has(item.stage) || !elapsed(item.elapsed_ms)) throw new Error('Invalid stage');
    return { stage: item.stage, elapsed_ms: item.elapsed_ms };
  }), snapshots: data.snapshots.map((item) => {
    if (!elapsed(item.elapsed_ms) || !Array.isArray(item.threads) || item.threads.length > 8) throw new Error('Invalid snapshot');
    return { elapsed_ms: item.elapsed_ms, threads: item.threads.map((frames) => {
      if (!Array.isArray(frames) || frames.length > 12) throw new Error('Invalid frames');
      return frames.map((frame) => {
        if (typeof frame.file !== 'string' || !/^[A-Za-z0-9_./<>-]{1,160}$/.test(frame.file) || frame.file.startsWith('/') || frame.file.split('/').includes('..') || typeof frame.function !== 'string' || !/^[A-Za-z0-9_.<>-]{1,96}$/.test(frame.function) || !elapsed(frame.line)) throw new Error('Invalid frame');
        return { file: frame.file, function: frame.function, line: frame.line };
      });
    }) };
  }) };
  const destination = path.join(ctx.o.evidenceDirectory, 'diagnostics');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await writeFile(path.join(destination, `${ctx.runId}.json`), JSON.stringify(safe) + '\n', { mode: 0o600 });
  ctx.rec.diagnostics = { status: 'preserved', path: `diagnostics/${ctx.runId}.json`, stages: safe.stages, snapshots: safe.snapshots.length, public_status: ctx.lastPublic ?? null, events: ctx.rec.events };
}

function redactDeep(value, redact) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]));
  return value;
}

async function homeReport(home, runIds, limits) {
  const runsDirectory = path.join(home, 'runs');
  const worktreesDirectory = path.join(home, 'worktrees');
  let present = [];
  try { present = (await readdir(runsDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); } catch {}
  const sizes = [];
  for (const name of present) sizes.push({ name, bytes: await directoryBytes(path.join(runsDirectory, name)) });
  let worktrees = [];
  try { worktrees = (await readdir(worktreesDirectory, { withFileTypes: true })).map((entry) => entry.name); } catch {}
  const perRunLimit = limits.maxArtifactBytes + limits.maxEventBytes + limits.maxTranscriptBytes;
  const maxRunBytes = sizes.reduce((best, item) => Math.max(best, item.bytes), 0);
  return {
    run_directories: present.length,
    total_bytes: await directoryBytes(home),
    runs_bytes: sizes.reduce((sum, item) => sum + item.bytes, 0),
    max_run_bytes: maxRunBytes,
    per_run_limit_bytes: perRunLimit,
    oversized_runs: sizes.filter((item) => item.bytes > perRunLimit).map((item) => item.name),
    leftover_worktrees: worktrees,
    missing_runs: runIds.filter((id) => !present.includes(id)),
  };
}

async function registeredWorktrees(workspace, homes) {
  try {
    const { stdout } = await exec('git', ['-C', workspace, 'worktree', 'list', '--porcelain', '-z'], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.split('\0').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9)).filter((target) => homes.some((home) => target.startsWith(`${home}${path.sep}`)));
  } catch { return []; }
}

function summarize({ records, o, plan, startedAt, reports, processes, registered, fatal, stoppedEarly, servers, retentionDays }) {
  const bucket = () => ({ runs: 0, ok: 0, failed: 0 });
  const by = (key) => {
    const table = {};
    for (const rec of records) {
      const name = key(rec);
      table[name] ??= bucket();
      table[name].runs += 1;
      table[name][rec.ok ? 'ok' : 'failed'] += 1;
    }
    return table;
  };
  const failuresByCode = {};
  for (const rec of records) for (const failure of rec.failures) failuresByCode[failure.code] = (failuresByCode[failure.code] ?? 0) + 1;
  const timed = records.filter((rec) => rec.ok && rec.scenario !== 'close_mid');
  const permissionRequests = records.reduce((sum, rec) => sum + rec.permissionRequests, 0);
  const unexpected = Object.entries(failuresByCode).filter(([code]) => code !== PERMISSION_FAILURE).reduce((sum, [, count]) => sum + count, 0);
  const costs = records.map((rec) => rec.usage?.cost).filter(Boolean);
  const restart = { reloaded: 0, error: 0, other: 0, not_exercised: 0 };
  for (const rec of records) {
    if (!rec.restart) continue;
    if (rec.restart.exercised === false) restart.not_exercised += 1;
    else if (rec.restart.outcome === 'reloaded') restart.reloaded += 1;
    else if (String(rec.restart.outcome).startsWith('error:')) restart.error += 1;
    else restart.other += 1;
  }
  const leakedProcesses = processes.leaked;
  const leakedWorktrees = Object.values(reports).reduce((sum, report) => sum + report.leftover_worktrees.length, 0) + registered.length;
  const oversized = Object.values(reports).reduce((sum, report) => sum + report.oversized_runs.length, 0);
  const missing = Object.values(reports).reduce((sum, report) => sum + report.missing_runs.length, 0);
  const completedRuns = records.filter((rec) => rec.finalState === 'completed').length;
  const truncatedRuns = records.filter((rec) => rec.truncated);
  const truncatedCount = (key) => truncatedRuns.reduce((table, rec) => { table[key(rec)] = (table[key(rec)] ?? 0) + 1; return table; }, {});
  const truncatedPercent = completedRuns ? (truncatedRuns.length * 100) / completedRuns : 0;
  const verdict = (pass) => (pass ? 'PASS' : 'FAIL');
  const criteria = [
    { id: 'zero_unexpected_failures', status: verdict(unexpected === 0 && !fatal), detail: `${unexpected} unexpected failures${fatal ? `; fatal: ${fatal}` : ''}` },
    { id: 'zero_permission_requests', status: verdict(permissionRequests === 0), detail: `${permissionRequests} permission or input requests` },
    { id: 'no_leaked_processes_or_worktrees', status: verdict(leakedProcesses.length === 0 && leakedWorktrees === 0), detail: `${leakedProcesses.length} orphaned or descendant vibe processes, ${leakedWorktrees} leftover worktrees` },
    { id: 'bounded_artifacts', status: verdict(oversized === 0), detail: `${oversized} run directories above the per-run limit` },
    { id: 'retention_keeps_recent_runs', status: verdict(missing === 0), detail: `${missing} recorded runs missing from disk (retention.days ${retentionDays})` },
    { id: 'truncated_within_threshold', status: verdict(truncatedPercent <= o.maxTruncatedPercent), detail: `${truncatedRuns.length} of ${completedRuns} completed runs ended truncated (${truncatedPercent.toFixed(1)}%, limit ${o.maxTruncatedPercent}%)` },
  ];
  if (o.totalTimeout !== undefined) {
    criteria.push({ id: 'all_planned_runs', status: verdict(records.length === o.reviews + o.edits + o.acp), detail: `${records.length}/${o.reviews + o.edits + o.acp} runs attempted` });
    if (o.acp >= 3) criteria.push({ id: 'acp_scenarios_exercised', status: verdict(restart.reloaded > 0 && records.some((rec) => rec.closeMid?.exercised) && records.some((rec) => rec.scenario === 'continue' && rec.ok && rec.turns.length > 1)), detail: 'Requires successful continuation, reload and exercised mid-turn close.' });
  }
  return {
    schema_version: 1,
    total_timeout_seconds: o.totalTimeout ?? null,
    time_limit_reached: Boolean(o.totalExpired),
    diagnostics_enabled: o.diagnostics,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    seed: o.seed,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    server_command: [o.serverCommand, ...o.serverArgs],
    plan: { reviews: o.reviews, edits: o.edits, acp: o.acp, hosted_turns: hostedTurns(plan) },
    stopped_early: stoppedEarly,
    fatal: fatal ?? null,
    totals: { ...bucket(), runs: records.length, ok: records.filter((rec) => rec.ok).length, failed: records.filter((rec) => !rec.ok).length },
    by_kind: by((rec) => rec.kind),
    by_backend: by((rec) => rec.backend),
    by_scenario: by((rec) => rec.scenario ?? rec.kind),
    truncated: { runs: truncatedRuns.length, by_kind: truncatedCount((rec) => rec.kind), by_backend: truncatedCount((rec) => rec.backend) },
    latency_ms: {
      time_to_first_event: latency(timed.map((rec) => rec.timeToFirstEventMs).filter((value) => value !== null)),
      time_to_settled: latency(timed.map((rec) => rec.timeToSettledMs).filter((value) => value !== null)),
    },
    failures_by_code: failuresByCode,
    permission_requests: permissionRequests,
    restarts: restart,
    close_mid_turn: { exercised: records.filter((rec) => rec.closeMid?.exercised).length, not_exercised: records.filter((rec) => rec.closeMid && !rec.closeMid.exercised).length },
    tool_calls: records.reduce((sum, rec) => sum + rec.toolCalls, 0),
    events: records.reduce((sum, rec) => sum + rec.events, 0),
    cost: { reported: costs.length, amount: Number(costs.reduce((sum, cost) => sum + (cost.amount ?? 0), 0).toFixed(6)), currency: costs[0]?.currency ?? null, authoritative: false },
    leftovers: {
      processes: { baseline: processes.baseline, after: processes.after, new_unrelated: processes.new_unrelated, leaked: leakedProcesses },
      registered_worktrees: registered,
      homes: reports,
    },
    servers,
    criteria,
    result: o.totalExpired ? 'INCOMPLETE' : criteria.every((criterion) => criterion.status === 'PASS') ? 'PASS' : 'FAIL',
  };
}

function printPlan(o, plan, preflight, outDirectory) {
  const lines = [
    'vibe-supervisor hosted soak plan',
    `workspace: ${preflight.workspace}`,
    `runs: ${plan.programmatic.length + plan.acp.length} (reviews ${o.reviews}, edits ${o.edits}, acp ${o.acp}); hosted model turns about ${hostedTurns(plan)}`,
    `backends: programmatic ${plan.programmatic.length} runs, acp ${plan.acp.length} runs (continue, mid-turn close and restart scenarios)`,
    `server command: ${o.serverCommand} ${o.serverArgs.join(' ')}`,
    `evidence directory: ${outDirectory}`,
    'tasks: bounded built-in tasks name their files, cap reads and searches and require a short final answer; review-long is intentionally unbounded and only feeds the mid-turn close and restart scenarios',
    `truncation: a completed run stopped by max_turn_requests or max_tokens with the partial-result warning is counted as truncated, not failed; allowed up to ${o.maxTruncatedPercent}% of completed runs`,
    `seed: ${o.seed}; status wait ${o.waitSeconds}s; run timeout ${o.runTimeout}s; total timeout ${o.totalTimeout ?? "unset"}s; diagnostics ${o.diagnostics ? "on" : "off"}`,
    `preflight: workspace in the template allowlist: ${preflight.allowed ? 'yes' : 'NO'}; git repository: ${preflight.git ? 'yes' : 'NO'}; template config: ${preflight.templatePath}`,
    'COST WARNING: every run sends the repository and the tasks to Mistral and is billed. Earlier hosted edits cost about $0.02 each; the real total depends on the tasks and the account. Run it only with the owner authorization.',
  ];
  if (!o.yes) lines.push('Nothing was started. Re-run with --yes to start the hosted runs.');
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  const o = parseCommandLine(process.argv.slice(2));
  if (o.help) { process.stdout.write(USAGE); return 0; }
  const dist = await loadDist();
  const templateEnv = { ...process.env };
  const templatePath = dist.getConfigPath(templateEnv);
  let templateConfig;
  try { templateConfig = await dist.loadConfig({ env: templateEnv }); }
  catch (error) { throw new Usage(`The template config is invalid: ${error.message}`); }
  let workspace;
  try { workspace = await realpath(path.resolve(o.workspace)); }
  catch { throw new Usage(`The workspace does not exist: ${o.workspace}`); }
  let allowed = true;
  try { await dist.resolveCanonicalRoot(workspace, templateConfig.allowedWorkspaceRoots); } catch { allowed = false; }
  let git = true;
  try { await exec('git', ['-C', workspace, 'rev-parse', '--git-dir']); } catch { git = false; }
  o.reviewTimeout = templateConfig.limits.reviewTimeoutSeconds;
  o.editTimeout = templateConfig.limits.editTimeoutSeconds;
  const preflight = { workspace, allowed, git, templatePath };
  const tasks = await loadTasks(o.tasks);
  const plan = buildPlan({ ...o }, tasks, await candidateFiles(workspace), workspace);
  let outDirectory = path.resolve(o.out ?? `soak-evidence-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  printPlan(o, plan, preflight, outDirectory);
  if (!o.yes) return 0;
  if (!allowed) throw new Usage(`The workspace ${workspace} is not in the allowlist of the template config ${templatePath}. Run "vibe-supervisor allow ${workspace}" first; the driver never edits the template config.`);
  if (o.edits > 0 && !git) throw new Usage(`Edit runs need a Git repository: ${workspace}`);
  const relation = path.relative(workspace, outDirectory);
  if (!relation.startsWith('..') && !path.isAbsolute(relation)) throw new Usage('--out must not be inside the workspace.');
  if (!path.relative(outDirectory, workspace).startsWith('..')) throw new Usage('--out must not contain the workspace.');
  try {
    if ((await readdir(outDirectory)).length) throw new Usage(`--out is not empty: ${outDirectory}`);
  } catch (error) {
    if (error instanceof Usage) throw error;
    if (error?.code !== 'ENOENT') throw new Usage(`Cannot use --out: ${error.message}`);
  }
  await mkdir(outDirectory, { recursive: true, mode: 0o700 });
  await chmod(outDirectory, 0o700);
  outDirectory = await realpath(outDirectory);
  o.workspace = workspace;
  o.evidenceDirectory = outDirectory;

  let rawTemplate;
  try { rawTemplate = parse(await readFile(templatePath, 'utf8')); }
  catch (error) { throw new Usage(`Cannot read the template config ${templatePath}: ${error.message}. Run vibe-supervisor setup first.`); }
  const homes = {};
  for (const backend of ['programmatic', 'acp']) {
    const home = path.join(outDirectory, `home-${backend}`);
    await mkdir(home, { recursive: true, mode: 0o700 });
    await chmod(home, 0o700);
    const copy = structuredClone(rawTemplate);
    copy.backend = backend;
    delete copy.phase1;
    delete copy.security;
    if (copy.paths) { delete copy.paths.data_dir; if (Object.keys(copy.paths).length === 0) delete copy.paths; }
    dist.validateConfig(copy);
    await writeFile(path.join(home, 'config.toml'), stringify(copy), { mode: 0o600 });
    await chmod(path.join(home, 'config.toml'), 0o600);
    homes[backend] = home;
  }

  const secrets = dist.environmentSecrets();
  const redact = (text) => dist.redactSecrets(text, secrets);
  const runsFile = path.join(outDirectory, 'runs.ndjson');
  await writeFile(runsFile, '', { mode: 0o600 });
  const ui = {
    async writeStderr(label, text) {
      const file = path.join(outDirectory, `server-${label}.stderr.log`);
      await writeFile(file, redact(text), { mode: 0o600 });
      await chmod(file, 0o600);
    },
  };
  const onSignal = (signal) => { killSpawned(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  const baseline = await scanProcesses();
  const startedAt = new Date().toISOString();
  o.totalDeadline = o.totalTimeout === undefined ? undefined : performance.now() + o.totalTimeout * 1000;
  o.workDeadline = o.totalDeadline === undefined ? undefined : o.totalDeadline - 60_000;
  const records = [];
  const servers = [];
  const total = plan.programmatic.length + plan.acp.length;
  let fatal;
  let stoppedEarly = false;
  let counter = 0;
  const runGroup = async (backend, jobs) => {
    if (!jobs.length || fatal || stoppedEarly) return;
    const holder = createHolder(backend, homes[backend], o, ui);
    try {
      for (const job of jobs) {
        if (stoppedEarly) break;
        if (o.workDeadline !== undefined && performance.now() >= o.workDeadline) { o.totalExpired = true; stoppedEarly = true; break; }
        counter += 1;
        const record = await executeJob(holder, job, o, counter, total);
        const safe = redactDeep(record, redact);
        records.push(safe);
        await appendFile(runsFile, `${JSON.stringify(safe)}\n`);
        process.stderr.write(`[${counter}/${total}] ${backend} ${job.kind}${job.scenario ? `:${job.scenario}` : ''} ${job.taskId} ${record.ok ? 'ok' : `FAILED ${record.failures.map((failure) => failure.code).join(',')}`} ${Math.round(record.durationMs / 1000)}s\n`);
        if ((!record.ok && o.stopOnFail) || o.totalExpired) stoppedEarly = true;
      }
    } catch (error) {
      if (error instanceof Fatal) {
        fatal = error.message;
        if (error.record) { const safe = redactDeep(error.record, redact); records.push(safe); await appendFile(runsFile, `${JSON.stringify(safe)}\n`); }
      } else { fatal = String(error?.message ?? error); }
    } finally {
      servers.push({ backend, servers_started: holder.serverCount, last_startup_ms: holder.server?.startupMs ?? null });
      await holder.stop();
    }
  };
  await runGroup('programmatic', plan.programmatic);
  await runGroup('acp', plan.acp);

  await sleep(1000);
  let after = await scanProcesses();
  let verdict = attribute(after, baseline, await parentMap());
  if (verdict.leaked.length) { await sleep(3000); after = await scanProcesses(); verdict = attribute(after, baseline, await parentMap()); }
  const processes = { baseline: baseline.size, after: after.size, new_unrelated: verdict.unrelated, leaked: verdict.leaked.map(([pid, command]) => ({ pid, command: redact(command).slice(0, 200) })) };
  const reports = {};
  for (const backend of ['programmatic', 'acp']) reports[`home-${backend}`] = await homeReport(homes[backend], records.filter((rec) => rec.backend === backend && rec.runId).map((rec) => rec.runId), templateConfig.limits);
  const registered = await registeredWorktrees(workspace, Object.values(homes));
  const summary = summarize({ records, o, plan, startedAt, reports, processes, registered, fatal, stoppedEarly, servers, retentionDays: templateConfig.retention.days });
  const summaryFile = path.join(outDirectory, 'summary.json');
  await writeFile(summaryFile, `${JSON.stringify(redactDeep(summary, redact), null, 2)}\n`, { mode: 0o600 });
  await chmod(summaryFile, 0o600);
  await chmod(runsFile, 0o600);
  process.stdout.write(`${JSON.stringify({ result: summary.result, totals: summary.totals, criteria: summary.criteria, evidence: outDirectory }, null, 2)}\n`);
  if (fatal) process.stderr.write(`Soak aborted: ${fatal}\n`);
  return summary.result === 'PASS' ? 0 : fatal ? 2 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  killSpawned();
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exitCode = error instanceof Usage ? 2 : 1;
}
