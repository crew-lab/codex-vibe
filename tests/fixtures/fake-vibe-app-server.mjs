import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_INBOUND_LINE_BYTES = 1024 * 1024;
const MAX_OUTBOUND_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_OUTBOUND_QUEUE_BYTES = 32 * 1024 * 1024;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 1024 * 1024;
const MAX_HISTORY_ENTRIES = 500;
const MAX_STEPS = 1000;
const MAX_SCENARIO_BYTES = 1024 * 1024;
const MAX_PENDING_SERVER_REQUESTS = 64;
const MAX_DELAY_MS = 10000;
const CLOCK_BASE_MS = 1760400000000;
const FUTURE_FIELD = 'futureField';
const STORE_PREFIX = 'vibe-session-logging-disabled-';

const SCENARIO_KEYS = new Set([
  'name', 'serverName', 'serverVersion', 'startup', 'watermark', 'sessionId', 'log', 'errors', 'runtime', 'harness',
  'harnessSelectionSource', 'effectiveConfig', 'effectiveFromEnv', 'thinkingLevels', 'modelWrite', 'readyInitially',
  'baselineStats', 'contextWindow', 'afterStop', 'eof', 'eofDelayMs', 'interrupt', 'extraFields', 'omit', 'steps'
]);
const STEP_OPS = new Set([
  'say', 'reasoning', 'stats', 'call', 'unknownEntry', 'unknownNotification', 'staleEvent', 'delay', 'hold', 'wedge', 'crash',
  'malformedLine', 'oversizedFrame', 'partialFrame', 'end'
]);
const DECISION_TYPES = ['approve', 'approve_for_session', 'approve_permanently', 'deny', 'cancel_turn'];
const APPROVING = new Set(['approve', 'approve_for_session', 'approve_permanently']);
const CALLBACK_KINDS = ['approval', 'user_input', 'connector_auth'];
const CLIENT_TOOLS = ['filesystem/read', 'filesystem/write', 'terminal'];
const ENTRYPOINTS = ['cli', 'acp', 'desktop', 'programmatic', 'unknown'];
const TURN_STATUSES = ['in_progress', 'completed', 'failed', 'interrupted'];
const STOP_REASONS = ['limit', 'length'];

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const stderr = (text) => { try { process.stderr.write(`${text}\n`); } catch { /* stderr closed */ } };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);

function parseScenario() {
  const argIndex = process.argv.indexOf('--scenario');
  const file = argIndex >= 0 ? process.argv[argIndex + 1] : process.env.FAKE_VIBE_SCENARIO;
  if (!file) return {};
  const size = fs.statSync(file).size;
  if (size > MAX_SCENARIO_BYTES) throw new Error(`scenario file exceeds ${MAX_SCENARIO_BYTES} bytes`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isObject(parsed)) throw new Error('scenario must be a JSON object');
  for (const key of Object.keys(parsed)) if (!SCENARIO_KEYS.has(key)) throw new Error(`unknown scenario key: ${key}`);
  const steps = parsed.steps ?? [];
  if (!Array.isArray(steps) || steps.length > MAX_STEPS) throw new Error('scenario steps must be an array within the step limit');
  for (const step of steps) {
    if (!isObject(step) || !STEP_OPS.has(step.op)) throw new Error(`unknown scenario step: ${JSON.stringify(step)}`);
    if (step.op === 'call') {
      if (typeof step.tool !== 'string' || !['approval', 'auto', 'never'].includes(step.mode ?? 'approval')) throw new Error('call step needs tool and a valid mode');
      assertCamelCase(step.input ?? {}, 'call input');
      if (step.output !== undefined) assertCamelCase(step.output, 'call output');
    }
    if (step.op === 'end') {
      if (step.status !== undefined && !TURN_STATUSES.includes(step.status)) throw new Error('end step status invalid');
      if (step.stopReason !== undefined && step.stopReason !== null && !STOP_REASONS.includes(step.stopReason)) throw new Error('end step stopReason invalid');
    }
    if (step.op === 'oversizedFrame' && !(Number.isInteger(step.bytes) && step.bytes > 0 && step.bytes <= MAX_OUTBOUND_FRAME_BYTES)) throw new Error('oversizedFrame bytes out of range');
    if (step.op === 'delay' && !(Number.isInteger(step.ms) && step.ms >= 0 && step.ms <= MAX_DELAY_MS)) throw new Error('delay ms out of range');
  }
  return parsed;
}

function assertCamelCase(value, where) {
  if (Array.isArray(value)) { for (const item of value) assertCamelCase(item, where); return; }
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (key.includes('_')) throw new Error(`${where} key must be camelCase on the wire: ${key}`);
    assertCamelCase(item, where);
  }
}

let scenario;
try {
  scenario = parseScenario();
} catch (error) {
  stderr(`fake-vibe-app-server: invalid scenario: ${error.message}`);
  process.exit(2);
}

const logPath = process.env.FAKE_VIBE_LOG || scenario.log || null;
let logBytes = 0;
let logTruncated = false;
function record(kind, data) {
  if (!logPath || logTruncated) return;
  const line = `${JSON.stringify({ seq: ++recordSeq, kind, ...data })}\n`;
  if (logBytes + line.length > MAX_LOG_BYTES) {
    logTruncated = true;
    fs.appendFileSync(logPath, `${JSON.stringify({ seq: ++recordSeq, kind: 'event', name: 'logTruncated' })}\n`);
    return;
  }
  logBytes += line.length;
  fs.appendFileSync(logPath, line);
}
let recordSeq = 0;

const envNames = Object.keys(process.env).sort();
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;
const recordedEnv = Object.fromEntries(envNames.filter((name) => /^(HOME|VIBE_.*|TMPDIR|LOG_LEVEL)$/.test(name)).map((name) => [name, SECRET_NAME.test(name) ? '<set>' : process.env[name]]));
record('start', {
  pid: process.pid,
  scenario: scenario.name ?? null,
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  envNames,
  env: recordedEnv,
  hasMistralApiKey: typeof process.env.MISTRAL_API_KEY === 'string' && process.env.MISTRAL_API_KEY.length > 0
});

if (scenario.startup) {
  if (scenario.startup.stderr) stderr(scenario.startup.stderr);
  record('event', { name: 'startupFailure', exitCode: scenario.startup.exitCode ?? 1 });
  process.exit(scenario.startup.exitCode ?? 1);
}

let outboundQueuedBytes = 0;
let stdoutBroken = false;
process.stdout.on('error', () => { stdoutBroken = true; });

function writeRaw(text) {
  if (stdoutBroken) return Promise.resolve();
  const bytes = Buffer.byteLength(text);
  outboundQueuedBytes += bytes;
  if (outboundQueuedBytes > MAX_OUTBOUND_QUEUE_BYTES) fatal('outbound queue limit exceeded', 70);
  return new Promise((resolve) => {
    process.stdout.write(text, () => { outboundQueuedBytes -= bytes; resolve(); });
  });
}

function decorate(value) {
  if (Array.isArray(value)) return value.map(decorate);
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = decorate(item);
  out[FUTURE_FIELD] = 'ignored';
  return out;
}

function deletePath(target, dotted) {
  const parts = dotted.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor)) return;
    cursor = cursor[part];
  }
  if (isObject(cursor)) delete cursor[parts.at(-1)];
}

function send(frame, { allowOversize = false } = {}) {
  const body = scenario.extraFields && frame.result ? { ...frame, result: decorate(frame.result) }
    : scenario.extraFields && frame.params ? { ...frame, params: decorate(frame.params) } : frame;
  const text = `${JSON.stringify(body)}\n`;
  if (!allowOversize && Buffer.byteLength(text) > MAX_OUTBOUND_FRAME_BYTES) fatal('outbound frame exceeds the fixture limit', 70);
  return writeRaw(text);
}

function fatal(message, code = 1) {
  stderr(`fake-vibe-app-server: ${message}`);
  record('event', { name: 'fatal', message });
  void shutdown(code);
}

const state = {
  initialized: false,
  initializedNotificationSeen: false,
  clientCallbackKinds: [],
  session: null,
  nextServerRequestId: 1,
  pendingServerRequests: new Map(),
  pendingCallbacks: new Map(),
  eventId: 0,
  watermark: scenario.watermark ?? 7,
  clock: 0,
  history: [],
  droppedHistory: 0,
  journalBytes: 0,
  storePath: null,
  stats: null,
  turnCounter: 0,
  callbackCounter: 0,
  callCounter: 0,
  entryCounter: 0,
  wedged: false,
  closing: false,
  lastHistoryNotification: null
};

const now = () => CLOCK_BASE_MS + (state.clock += 1);
const sessionId = () => scenario.sessionId ?? 'fake-session-0001';

function emptyStats() {
  return {
    steps: 0, modelCalls: null, sessionPromptTokens: 0, sessionCompletionTokens: 0, sessionCachedTokens: 0,
    inputPricePerMillion: 0, outputPricePerMillion: 0, cachedInputPricePerMillion: null,
    toolCallsAgreed: 0, toolCallsRejected: 0, toolCallsFailed: 0, toolCallsSucceeded: 0,
    contextTokens: 0, lastTurnPromptTokens: 0, lastTurnCompletionTokens: 0, lastTurnCachedTokens: 0,
    lastTurnDuration: 0, tokensPerSecond: 0
  };
}

const V = {
  any: () => () => undefined,
  str: ({ min = 0 } = {}) => (v, p, i) => {
    if (typeof v !== 'string') i.push({ path: p, message: 'Input should be a valid string' });
    else if (v.length < min) i.push({ path: p, message: `String should have at least ${min} character${min === 1 ? '' : 's'}` });
  },
  int: ({ min, max } = {}) => (v, p, i) => {
    if (!Number.isInteger(v)) i.push({ path: p, message: 'Input should be a valid integer' });
    else if (min !== undefined && v < min) i.push({ path: p, message: `Input should be greater than or equal to ${min}` });
    else if (max !== undefined && v > max) i.push({ path: p, message: `Input should be less than or equal to ${max}` });
  },
  num: () => (v, p, i) => { if (typeof v !== 'number') i.push({ path: p, message: 'Input should be a valid number' }); },
  bool: () => (v, p, i) => { if (typeof v !== 'boolean') i.push({ path: p, message: 'Input should be a valid boolean' }); },
  lit: (expected) => (v, p, i) => { if (v !== expected) i.push({ path: p, message: `Input should be '${expected}'` }); },
  oneOf: (list) => (v, p, i) => { if (!list.includes(v)) i.push({ path: p, message: `Input should be one of: ${list.join(', ')}` }); },
  nullable: (inner) => (v, p, i) => { if (v !== null) inner(v, p, i); },
  arr: (inner, { min = 0 } = {}) => (v, p, i) => {
    if (!Array.isArray(v)) { i.push({ path: p, message: 'Input should be a valid list' }); return; }
    if (v.length < min) i.push({ path: p, message: `List should have at least ${min} item${min === 1 ? '' : 's'}` });
    v.forEach((item, index) => inner(item, [...p, index], i));
  },
  obj: (fields, required = []) => (v, p, i) => {
    if (!isObject(v)) { i.push({ path: p, message: 'Input should be a valid dictionary' }); return; }
    for (const key of Object.keys(v)) {
      if (!(key in fields)) i.push({ path: [...p, key], message: 'Extra inputs are not permitted' });
      else fields[key](v[key], [...p, key], i);
    }
    for (const key of required) if (!(key in v)) i.push({ path: [...p, key], message: 'Field required' });
  },
  tagged: (key, variants) => (v, p, i) => {
    if (!isObject(v)) { i.push({ path: p, message: 'Input should be a valid dictionary' }); return; }
    const variant = variants[v[key]];
    if (!variant) { i.push({ path: [...p, key], message: `Input tag must be one of: ${Object.keys(variants).join(', ')}` }); return; }
    variant(v, p, i);
  }
};

const contentBlock = V.tagged('type', {
  text: V.obj({ type: V.lit('text'), text: V.str() }, ['text']),
  image: V.obj({ type: V.lit('image'), attachment: V.any() }, ['attachment']),
  resource: V.obj({ type: V.lit('resource'), resource: V.any() }, ['resource'])
});
const page = V.obj({ cursor: V.nullable(V.str()), limit: V.int({ min: 1, max: 500 }), direction: V.oneOf(['forward', 'backward']) });
const agentConfig = V.obj({
  completion: V.nullable(V.any()),
  sandbox: V.nullable(V.any()),
  instructions: V.str(),
  workdir: V.nullable(V.str({ min: 1 })),
  tools: V.arr(V.any()),
  hooks: V.arr(V.any()),
  cwd: V.nullable(V.str({ min: 1 })),
  workspaceRoots: V.arr(V.str()),
  worktree: V.nullable(V.tagged('kind', {
    existing: V.obj({ kind: V.lit('existing'), cwd: V.str({ min: 1 }) }, ['cwd']),
    create: V.obj({ kind: V.lit('create'), branch: V.str({ min: 1 }), name: V.str({ min: 1 }) }, ['branch', 'name']),
    auto: V.obj({ kind: V.lit('auto'), prompt: V.nullable(V.str()) })
  })),
  agent: V.nullable(V.str()),
  autoApprove: V.bool(),
  enabledTools: V.nullable(V.arr(V.str())),
  disabledTools: V.arr(V.str()),
  maxTurns: V.nullable(V.int()),
  maxPrice: V.nullable(V.num()),
  maxSessionTokens: V.nullable(V.int()),
  headless: V.bool(),
  trustWorkspace: V.bool(),
  mcpServers: V.arr(V.any())
});
const sessionIdOnly = V.obj({ sessionId: V.str() }, ['sessionId']);

const schemas = {
  initialize: V.obj({
    clientInfo: V.obj({
      name: V.str(), version: V.str(), title: V.nullable(V.str()), entrypoint: V.oneOf(ENTRYPOINTS), terminalEmulator: V.str()
    }, ['name', 'version']),
    capabilities: V.obj({
      callbackKinds: V.arr(V.oneOf(CALLBACK_KINDS)), clientTools: V.arr(V.oneOf(CLIENT_TOOLS)), disabledNotifications: V.arr(V.str())
    })
  }, ['clientInfo']),
  'session/start': V.obj({
    agentConfig, historyLimit: V.int({ min: 1, max: 500 }), idempotencyKey: V.nullable(V.str()), kind: V.oneOf(['normal', 'ephemeral'])
  }),
  'session/ready/wait': sessionIdOnly,
  'runtime/read': sessionIdOnly,
  'config/effective/read': sessionIdOnly,
  'config/read': V.obj({ sessionId: V.nullable(V.str()), cwd: V.nullable(V.str()) }),
  'config/model/write': V.obj({ sessionId: V.str(), modelAlias: V.nullable(V.str()), reasoningEffort: V.nullable(V.str()) }, ['sessionId']),
  'session/read': V.obj({ sessionId: V.str(), history: V.nullable(page), turns: V.nullable(page) }, ['sessionId']),
  'session/history/list': V.obj({ sessionId: V.str(), turnId: V.nullable(V.str()), page }, ['sessionId']),
  'session/stop': V.obj({ sessionId: V.str(), reason: V.nullable(V.str()) }, ['sessionId']),
  'turn/start': V.obj({
    idempotencyKey: V.nullable(V.str()), sessionId: V.str(), message: V.arr(contentBlock), injected: V.bool(),
    clientUserMessageId: V.nullable(V.str()), autoTitle: V.nullable(V.str()), userDisplayContent: V.nullable(V.any()), mentionStats: V.nullable(V.any())
  }, ['sessionId', 'message']),
  'turn/interrupt': V.obj({ sessionId: V.str(), expectedTurnId: V.str() }, ['sessionId', 'expectedTurnId']),
  'callback/result': V.obj({
    sessionId: V.str(),
    result: V.obj({
      callbackId: V.str(), output: V.any(),
      error: V.nullable(V.obj({ message: V.str(), code: V.nullable(V.str()), details: V.any() }, ['message']))
    }, ['callbackId'])
  }, ['sessionId', 'result'])
};

const approvalOutput = V.obj({
  type: V.lit('approval'),
  decision: V.obj({ type: V.oneOf(DECISION_TYPES), pathScope: V.nullable(V.any()) }, ['type']),
  feedback: V.nullable(V.str())
}, ['type', 'decision']);

function validate(schema, params) {
  const issues = [];
  schema(params, [], issues);
  if (issues.length > 0) throw new RpcError('invalid_params', 'Invalid params', { errorCount: issues.length, issues });
}

function nextEventId() { return ++state.eventId; }

function notification(method, eventId, extra) {
  return { jsonrpc: '2.0', method, params: { eventId, sessionId: sessionId(), emittedAt: now(), ...extra } };
}

function journal(entry) {
  if (!state.storePath) return;
  const line = `${JSON.stringify(entry)}\n`;
  if (state.journalBytes + line.length > MAX_JOURNAL_BYTES) return;
  state.journalBytes += line.length;
  fs.appendFileSync(path.join(state.storePath, 'journal.jsonl'), line);
}

function baseEntry(turn, extra) {
  const stamp = now();
  return {
    id: `entry-${String(++state.entryCounter).padStart(4, '0')}`,
    sessionId: sessionId(),
    turnId: turn?.id ?? null,
    inputEntryId: turn?.inputEntryId ?? null,
    createdAt: stamp,
    updatedAt: stamp,
    generationStatus: 'completed',
    relatedEntryId: null,
    ...extra
  };
}

function addEntry(entry, { silent = false } = {}) {
  state.history.push(entry);
  if (state.history.length > MAX_HISTORY_ENTRIES) { state.history.shift(); state.droppedHistory += 1; }
  journal(entry);
  const eventId = nextEventId();
  if (silent) return Promise.resolve();
  const frame = notification('history/entryAdded', eventId, { turnId: entry.turnId, entry: clone(entry) });
  state.lastHistoryNotification = clone(frame);
  return send(frame);
}

function applyPatch(target, ops) {
  for (const op of ops) {
    const parts = op.path.split('/').slice(1);
    let cursor = target;
    for (const part of parts.slice(0, -1)) cursor = cursor[part];
    const last = parts.at(-1);
    if (op.op === 'append') cursor[last] = `${cursor[last] ?? ''}${op.value}`;
    else if (op.op === 'remove') delete cursor[last];
    else if (op.op !== 'test') cursor[last] = op.value;
  }
}

function patchEntry(entry, ops, { silent = false } = {}) {
  applyPatch(entry, ops);
  entry.updatedAt = now();
  journal({ patch: ops, entryId: entry.id });
  const eventId = nextEventId();
  if (silent) return Promise.resolve();
  return send(notification('history/entryUpdated', eventId, { turnId: entry.turnId, entryId: entry.id, patch: clone(ops) }));
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function effectKind(tool) {
  if (/(^|\.)read_file$/.test(tool)) return 'file_read';
  if (/(^|\.)write_file$/.test(tool)) return 'file_write';
  if (/(^|\.)(edit|search_replace)$/.test(tool)) return 'file_edit';
  if (/(^|\.)(bash|shell)$/.test(tool)) return 'shell';
  return 'tool';
}

function effectDetail(step) {
  const kind = effectKind(step.tool);
  const input = step.input ?? {};
  const target = input.filePath ?? input.command ?? '';
  const verbs = { file_read: ['Reading', 'Read'], file_write: ['Writing', 'Wrote'], file_edit: ['Editing', 'Edited'], shell: ['Running', 'Ran'], tool: ['Calling', 'Called'] }[kind];
  return {
    kind,
    toolName: step.tool,
    display: { summary: `${verbs[0]} ${target}`.trim(), content: null, suffix: '', verb: verbs[0], message: null, settledVerb: verbs[1], settledMessage: null, statusText: verbs[0] },
    input
  };
}

function defaultOutput(detail) {
  const input = detail.input;
  if (detail.kind === 'file_read') return { filePath: input.filePath, content: 'fixture content\n', numLines: 1, startLine: 1, requestedOffset: input.offset ?? null, requestedLimit: input.limit ?? 2000, wasTruncated: false };
  if (detail.kind === 'file_write') return { filePath: input.filePath, content: input.content ?? '', fileExisted: false, previousContent: null };
  if (detail.kind === 'file_edit') return { file: input.filePath, oldString: null, newString: null, occurrences: [{ startLine: 1, oldText: 'old', newText: 'new' }] };
  if (detail.kind === 'shell') return { stdout: '', stderr: '', output: '', truncated: false };
  return null;
}

const resultDisplay = (detail, success, message) => ({ success, verb: detail.display.settledVerb, message, warnings: [], approvalNote: null, suffix: '' });

function completedState(detail, step, approvalType, approvalSource) {
  return {
    status: 'completed',
    output: step.output ?? defaultOutput(detail),
    outputText: '',
    durationMs: 1,
    display: resultDisplay(detail, true, detail.display.summary),
    decision: 'execute',
    approvalType,
    approvalSource
  };
}

function deniedState(detail, approvalType, approvalSource) {
  return {
    status: 'failed',
    error: { message: 'Tool execution denied by approval callback', code: 'tool_denied', details: null },
    output: null,
    outputText: '',
    durationMs: 0,
    display: resultDisplay(detail, false, 'denied'),
    decision: 'skip',
    approvalType,
    approvalSource
  };
}

function skippedState(detail, reason, approvalSource) {
  return { status: 'skipped', reason, display: resultDisplay(detail, false, reason), decision: 'skip', approvalType: 'never', approvalSource };
}

function substitute(value, cwd) {
  if (typeof value === 'string') return value.replaceAll('${cwd}', cwd ?? '');
  if (Array.isArray(value)) return value.map((item) => substitute(item, cwd));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, cwd)]));
  return value;
}

const INTERRUPTED = Symbol('interrupted');

async function runTurn(turn) {
  const ctx = state.session.turnContext;
  const cwd = state.session.cwd;
  const raceInterrupt = async (promise) => Promise.race([promise, ctx.interrupted.promise.then(() => INTERRUPTED)]);
  let outcome = { status: 'completed', stopReason: null, error: null };
  try {
    for (const rawStep of scenario.steps ?? []) {
      const step = substitute(rawStep, cwd);
      await tick();
      if (ctx.interruptHonored) break;
      if (step.op === 'end') {
        outcome = { status: step.status ?? 'completed', stopReason: step.stopReason ?? null, error: step.error ?? null };
        break;
      }
      const result = await runStep(step, turn, raceInterrupt);
      if (result === INTERRUPTED) break;
    }
  } catch (error) {
    fatal(`turn runner failed: ${error?.stack ?? error}`, 70);
    return;
  }
  if (ctx.interruptHonored) outcome = { status: 'interrupted', stopReason: null, error: null };
  await finishTurn(turn, outcome);
}

async function finishTurn(turn, outcome) {
  turn.status = outcome.status;
  turn.stopReason = outcome.stopReason;
  turn.error = outcome.error;
  turn.completedAt = now();
  state.session.status = { type: 'idle' };
  state.session.activeTurn = null;
  state.session.turnContext = null;
  await send(notification('turn/completed', nextEventId(), { turn: publicTurn(turn) }));
  record('event', { name: 'turnCompleted', status: turn.status, stopReason: turn.stopReason });
}

function publicTurn(turn) {
  return {
    id: turn.id, sessionId: sessionId(), status: turn.status, inputEntryId: turn.inputEntryId, startedAt: turn.startedAt,
    completedAt: turn.completedAt ?? null, error: turn.error ?? null, stopReason: turn.stopReason ?? null, queueItemId: null
  };
}

async function runStep(step, turn, raceInterrupt) {
  const silent = step.silent === true;
  switch (step.op) {
    case 'say': return say(step, turn, silent);
    case 'reasoning':
      await addEntry(baseEntry(turn, { type: 'reasoning', text: step.text ?? '', summary: [] }), { silent });
      return undefined;
    case 'stats': {
      Object.assign(state.stats, step.stats ?? {});
      await send(notification('session/statsUpdated', nextEventId(), { stats: clone(state.stats), contextWindow: scenario.contextWindow ?? 128000 }));
      return undefined;
    }
    case 'call': return runCall(step, turn, raceInterrupt, silent);
    case 'unknownEntry':
      await addEntry(baseEntry(turn, { type: step.kind ?? 'hologram', ...(step.entry ?? {}) }), { silent });
      return undefined;
    case 'unknownNotification':
      await send(notification(step.method ?? 'session/futureThing', nextEventId(), step.params ?? {}));
      return undefined;
    case 'staleEvent': {
      const frame = state.lastHistoryNotification ? clone(state.lastHistoryNotification) : notification('history/entryAdded', 0, {});
      frame.params.eventId = state.watermark;
      await send(frame);
      return undefined;
    }
    case 'delay': return raceInterrupt(sleep(step.ms));
    case 'hold': return raceInterrupt(new Promise(() => undefined));
    case 'wedge': wedge(step); return raceInterrupt(new Promise(() => undefined));
    case 'crash': await crash(step); return undefined;
    case 'malformedLine': await writeRaw(`${step.text ?? 'this is not json'}\n`); return undefined;
    case 'oversizedFrame':
      await send({ jsonrpc: '2.0', method: 'warning', params: { warning: { message: 'x'.repeat(step.bytes), code: null, details: null } } }, { allowOversize: true });
      return undefined;
    case 'partialFrame': await writeRaw('{"jsonrpc":"2.0","method":"history/entryAdded","params":{"eventId":'); return undefined;
    default: throw new Error(`unhandled step ${step.op}`);
  }
}

async function say(step, turn, silent) {
  if (!step.stream) {
    await addEntry(baseEntry(turn, { type: 'message', role: 'assistant', content: [{ type: 'text', text: step.text ?? '' }], source: null, userDisplayContent: null }), { silent });
    return undefined;
  }
  const entry = baseEntry(turn, { type: 'message', role: 'assistant', content: [{ type: 'text', text: '' }], source: null, userDisplayContent: null, generationStatus: 'in_progress' });
  await addEntry(entry, { silent });
  const text = step.text ?? '';
  for (const piece of [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))]) {
    if (piece) await patchEntry(entry, [{ op: 'append', path: '/content/0/text', value: piece }], { silent });
  }
  await patchEntry(entry, [{ op: 'replace', path: '/generationStatus', value: 'completed' }], { silent });
  return undefined;
}

async function runCall(step, turn, raceInterrupt, silent) {
  const detail = effectDetail(step);
  const mode = step.mode ?? 'approval';
  const callId = step.id ?? `call-${String(++state.callCounter).padStart(4, '0')}`;
  const effect = baseEntry(turn, { id: callId, type: 'effect', title: step.tool, detail, state: { status: 'pending' } });
  if (mode === 'auto') {
    effect.state = completedState(detail, step, step.approvalType ?? 'always', step.source ?? 'config');
    await addEntry(effect, { silent });
    return undefined;
  }
  if (mode === 'never') {
    effect.state = skippedState(detail, 'Tool permission is never', 'never');
    await addEntry(effect, { silent });
    return undefined;
  }
  return runApproval(step, turn, effect, detail, raceInterrupt);
}

async function runApproval(step, turn, effect, detail, raceInterrupt) {
  if (!state.clientCallbackKinds.includes('approval')) {
    stderr('fake-vibe-app-server: client did not declare the approval callback kind; cancelling the serve task');
    fatal('approval callback undeliverable: client capability missing', 1);
    return INTERRUPTED;
  }
  if (state.pendingServerRequests.size >= MAX_PENDING_SERVER_REQUESTS) fatal('too many pending server requests', 70);
  const callbackId = `cb-${String(++state.callbackCounter).padStart(4, '0')}`;
  effect.state = { status: 'blocked', callbackId, outputText: '' };
  await addEntry(effect);
  const callbackEntry = baseEntry(turn, {
    type: 'callback',
    relatedEntryId: effect.id,
    callbackId,
    title: `Allow ${step.tool}?`,
    detail: { kind: 'approval', effect: clone(detail), requiredPermissions: [], choices: [...DECISION_TYPES], pathScopeChoices: [], relatedEntryId: effect.id, reason: null },
    state: { status: 'open' }
  });
  await addEntry(callbackEntry);
  state.session.status = { type: 'blocked', activeTurnId: turn.id, callbackId, reason: 'approval' };
  const answer = deferred();
  state.pendingCallbacks.set(callbackId, answer);
  const requestId = state.nextServerRequestId++;
  const ack = deferred();
  state.pendingServerRequests.set(requestId, { resolve: ack.resolve, callbackId });
  await send({ jsonrpc: '2.0', id: requestId, method: 'callback/call', params: { callback: clone(callbackEntry) } });
  record('event', { name: 'callbackCall', callbackId, requestId, tool: step.tool });
  const ackResult = await raceInterrupt(ack.promise);
  if (ackResult === INTERRUPTED) return cancelCallback(effect, callbackEntry, callbackId);
  const acknowledged = isObject(ackResult?.result) && ackResult.result.callbackId === callbackId && ackResult.result.accepted === true;
  if (ackResult?.error) record('event', { name: 'callbackAckError', callbackId, error: ackResult.error });
  else if (!acknowledged) { fatal(`callback acknowledgement does not match request ${requestId}`, 1); return INTERRUPTED; }
  const decided = ackResult?.error ? { decision: 'deny', feedback: null } : await raceInterrupt(answer.promise);
  if (decided === INTERRUPTED) return cancelCallback(effect, callbackEntry, callbackId);
  state.pendingCallbacks.delete(callbackId);
  state.session.status = { type: 'running', activeTurnId: turn.id };
  const approved = APPROVING.has(decided.decision);
  await patchEntry(callbackEntry, [{ op: 'replace', path: '/state', value: { status: 'answered', output: decided.output ?? { type: 'approval', decision: { type: 'deny', pathScope: null }, feedback: null } } }]);
  const finalState = approved ? completedState(detail, step, 'ask', 'user') : deniedState(detail, 'ask', 'user');
  await patchEntry(effect, [{ op: 'replace', path: '/state', value: finalState }]);
  if (decided.decision === 'cancel_turn') requestInterrupt();
  return undefined;
}

async function cancelCallback(effect, callbackEntry, callbackId) {
  state.pendingCallbacks.delete(callbackId);
  await patchEntry(callbackEntry, [{ op: 'replace', path: '/state', value: { status: 'cancelled', reason: 'turn interrupted' } }]);
  await patchEntry(effect, [{ op: 'replace', path: '/state', value: { status: 'cancelled', reason: 'turn interrupted', outputText: '', durationMs: 0, display: null, decision: null, approvalType: 'ask', approvalSource: null } }]);
  return INTERRUPTED;
}

function requestInterrupt() {
  const ctx = state.session?.turnContext;
  if (!ctx) return;
  if (scenario.interrupt === 'ignore') { record('event', { name: 'interruptIgnored' }); return; }
  ctx.interruptHonored = true;
  ctx.interrupted.resolve();
}

async function crash(step) {
  stderr(step.message ?? 'fake-vibe-app-server: simulated crash');
  record('event', { name: 'crash', exitCode: step.exitCode ?? 139, signal: step.signal ?? null });
  await writeRaw('');
  if (step.signal) { process.kill(process.pid, step.signal); await sleep(5000); }
  process.exit(step.exitCode ?? 139);
}

function wedge(step) {
  state.wedged = true;
  record('event', { name: 'wedged', pid: process.pid, ignoreSigterm: step.ignoreSigterm === true });
  process.stdin.pause();
  process.stdin.removeAllListeners('data');
  process.stdin.removeAllListeners('end');
  process.stdin.on('error', () => undefined);
  if (step.ignoreSigterm) for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => record('event', { name: 'signalIgnored', signal }));
  setInterval(() => undefined, 1000);
}

function mergeDeep(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isObject(value) && value.$delete === true) delete target[key];
    else if (isObject(value) && isObject(target[key])) mergeDeep(target[key], value);
    else target[key] = clone(value);
  }
  return target;
}

function envOverrides() {
  const out = {};
  for (const [name, raw] of Object.entries(process.env)) {
    if (!name.startsWith('VIBE_') || name === 'VIBE_HOME' || raw === undefined) continue;
    const keys = name.slice(5).toLowerCase().split('__');
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    let cursor = out;
    for (const key of keys.slice(0, -1)) { cursor[key] ??= {}; cursor = cursor[key]; }
    cursor[keys.at(-1)] = value;
  }
  return out;
}

function effectiveConfig() {
  const session = state.session;
  const base = {
    active_model: session.modelAlias,
    models: { [session.modelAlias]: { thinking: session.reasoningEffort } },
    enable_subagents: true,
    enable_background_processes: true,
    managed_shell_tools_enabled: true,
    enable_connectors: true,
    disabled_skills: [],
    mcp_servers: [],
    enable_telemetry: true,
    enable_update_checks: true,
    session_logging: { enabled: true },
    tools: {},
    auto_approve: session.agentConfig.autoApprove ?? false,
    api_key: '<redacted>'
  };
  if (scenario.effectiveFromEnv !== false) mergeDeep(base, envOverrides());
  if (session.thinkingWritten) base.models[session.modelAlias] = { thinking: session.reasoningEffort };
  if (scenario.effectiveConfig) mergeDeep(base, scenario.effectiveConfig);
  return base;
}

function toolNames() {
  const spec = scenario.runtime?.tools ?? 'enabledTools';
  if (Array.isArray(spec)) return spec;
  const { enabledTools, disabledTools = [] } = state.session.agentConfig;
  const defaults = scenario.runtime?.defaultTools ?? ['read_file', 'write_file', 'edit', 'run_typescript'];
  return (enabledTools && enabledTools.length > 0 ? enabledTools : defaults).filter((name) => !disabledTools.includes(name));
}

function runtimeSnapshot() {
  const session = state.session;
  const runtime = scenario.runtime ?? {};
  return {
    config: {
      activeModel: {
        name: session.modelAlias, alias: session.modelAlias, thinking: session.reasoningEffort, supportsImages: false,
        displayName: session.modelAlias, maxContextLength: scenario.contextWindow ?? 128000, thinkingLevels: scenario.thinkingLevels ?? ['off', 'high'], imageDelivery: null
      },
      activeModelPinned: false,
      defaultModelAlias: session.modelAlias
    },
    activeAgent: { name: session.agentConfig.agent ?? 'default', displayName: session.agentConfig.agent ?? 'default', description: '', safety: 'neutral', agentType: 'agent' },
    agents: [],
    skills: runtime.skills ?? [],
    tools: toolNames().map((name) => ({ name, isCustom: false })),
    stats: clone(state.stats),
    contextWindow: scenario.contextWindow ?? 128000,
    issues: runtime.issues ?? [],
    hooksCount: runtime.hooksCount ?? 0,
    connectors: runtime.connectors ?? { connected: 0, total: 0 },
    mcp: { sources: runtime.mcpSources ?? [], discoveryErrors: {}, connectorError: null, manageConnectorsUrl: null },
    bypassToolPermissions: runtime.bypassToolPermissions ?? (session.agentConfig.autoApprove ?? false),
    experimentalHarness: runtime.experimentalHarness ?? true
  };
}

function sessionLog() {
  return { enabled: false, sessionId: sessionId(), persisted: false, path: null, title: null, needsInitialAutoTitle: false };
}

function publicSession() {
  const session = state.session;
  return {
    id: sessionId(), rootSessionId: null, parentSessionId: null, title: null, preview: '', status: session.status,
    createdAt: session.createdAt, updatedAt: now(), bumpedAt: null, pinnedAt: null, archivedAt: null, isUnseen: false,
    cwd: session.cwd ?? null, workspaceRoots: session.agentConfig.workspaceRoots ?? [], worktree: null,
    model: session.modelAlias, reasoningEffort: session.reasoningEffort, agent: null, tokenUsage: null, contextUsage: null,
    harness: scenario.harness ?? 'unified'
  };
}

function sessionState({ historyLimit = 200 } = {}) {
  return {
    format: 'vibe.public-session-state/v1',
    eventId: state.eventId,
    session: publicSession(),
    isQuiescent: state.session.activeTurn === null,
    history: clone(state.history.slice(-historyLimit)),
    historyBeforeCursor: null,
    turns: state.session.turns.map(publicTurn),
    activeCallbacks: [],
    childSessions: [],
    backgroundProcesses: [],
    turnQueue: { items: [], paused: false, maxItems: 32 },
    retrying: null
  };
}

function requireSession(params) {
  if (!state.session || params.sessionId !== sessionId()) throw new RpcError('not_found', `Session not found: ${params.sessionId}`);
}

function ensureStore() {
  state.storePath = fs.mkdtempSync(path.join(os.tmpdir(), STORE_PREFIX));
  fs.writeFileSync(path.join(state.storePath, 'checkpoint.json'), JSON.stringify({ sessionId: sessionId() }));
  record('event', { name: 'store', path: state.storePath });
}

function removeStore() {
  if (!state.storePath) return;
  try { fs.rmSync(state.storePath, { recursive: true, force: true }); } catch { /* best effort */ }
  record('event', { name: 'storeRemoved', path: state.storePath });
  state.storePath = null;
}

function paginate(items, pageRequest = {}) {
  const limit = pageRequest.limit ?? 200;
  const direction = pageRequest.direction ?? 'backward';
  const cursorIndex = pageRequest.cursor === undefined || pageRequest.cursor === null ? null : Number.parseInt(pageRequest.cursor, 10);
  if (cursorIndex !== null && !(cursorIndex >= 0 && cursorIndex <= items.length)) throw new RpcError('invalid_params', 'Invalid cursor', { errorCount: 1, issues: [{ path: ['page', 'cursor'], message: 'Invalid cursor' }] });
  if (direction === 'forward') {
    const start = cursorIndex ?? 0;
    const end = Math.min(items.length, start + limit);
    return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null, previousCursor: start > 0 ? String(start) : null };
  }
  const end = cursorIndex ?? items.length;
  const start = Math.max(0, end - limit);
  return { items: items.slice(start, end), nextCursor: null, previousCursor: start > 0 ? String(start) : null };
}

const handlers = {
  initialize(params) {
    state.initialized = true;
    state.clientCallbackKinds = params.capabilities?.callbackKinds ?? [];
    record('event', { name: 'initialize', callbackKinds: state.clientCallbackKinds });
    return { serverInfo: { name: scenario.serverName ?? 'vibe-app-server', version: scenario.serverVersion ?? '2.26.1' }, processId: process.pid };
  },
  'session/start'(params) {
    if (state.session) throw new RpcError('conflict', 'A session is already open on this connection');
    const config = params.agentConfig ?? {};
    state.stats = { ...emptyStats(), ...(scenario.baselineStats ?? {}) };
    state.eventId = state.watermark;
    state.session = {
      createdAt: now(), agentConfig: config, cwd: config.cwd ?? config.workdir ?? null, status: { type: 'idle' }, activeTurn: null,
      turnContext: null, turns: [], ready: scenario.readyInitially === true, stopped: false,
      modelAlias: 'mistral-medium-3.5', reasoningEffort: 'high', thinkingWritten: false
    };
    ensureStore();
    record('event', { name: 'sessionStart', agentConfig: config, initializedNotificationSeen: state.initializedNotificationSeen });
    return { result: { lastEventId: state.eventId, state: sessionState({ historyLimit: params.historyLimit }) } };
  },
  'session/ready/wait'(params) {
    requireSession(params);
    state.session.ready = true;
    return { ready: true, initDurationMs: 5 };
  },
  'runtime/read'(params) {
    requireSession(params);
    return { runtime: runtimeSnapshot(), sessionLog: sessionLog(), ready: state.session.ready };
  },
  'config/effective/read'(params) {
    requireSession(params);
    return { config: effectiveConfig() };
  },
  'config/read'(params) {
    if (params.sessionId) requireSession(params);
    if (!state.session) throw new RpcError('invalid_params', 'config/read needs a session in this fixture', { errorCount: 1, issues: [{ path: ['sessionId'], message: 'Field required' }] });
    const runtime = scenario.runtime ?? {};
    return {
      config: runtimeSnapshot().config,
      startupIssue: null,
      strippedHistoryImages: 0,
      skillsCount: (runtime.skills ?? []).length,
      hooksCount: runtime.hooksCount ?? 0,
      mcpServersTotal: (runtime.mcpSources ?? []).length,
      mcpServersEnabled: (runtime.mcpSources ?? []).length,
      harnessSelectionSource: scenario.harnessSelectionSource ?? 'default'
    };
  },
  'config/model/write'(params) {
    requireSession(params);
    const levels = scenario.thinkingLevels ?? ['off', 'high'];
    if (params.reasoningEffort && !levels.includes(params.reasoningEffort)) throw new RpcError('invalid_params', 'Invalid reasoning effort', { errorCount: 1, issues: [{ path: ['reasoningEffort'], message: `Input should be one of: ${levels.join(', ')}` }] });
    const write = scenario.modelWrite ?? {};
    if (!write.ignore) {
      if (params.modelAlias) state.session.modelAlias = params.modelAlias;
      if (params.reasoningEffort) { state.session.reasoningEffort = params.reasoningEffort; state.session.thinkingWritten = true; }
    }
    record('event', { name: 'modelWrite', modelAlias: params.modelAlias ?? null, reasoningEffort: params.reasoningEffort ?? null, ignored: write.ignore === true });
    return { runtime: runtimeSnapshot(), status: write.status ?? 'applied', strippedHistoryImages: 0 };
  },
  'session/read'(params) {
    requireSession(params);
    return { lastEventId: state.eventId, state: sessionState({ historyLimit: params.history?.limit }), leaseHolder: { processId: process.pid } };
  },
  'session/history/list'(params) {
    requireSession(params);
    const items = params.turnId ? state.history.filter((entry) => entry.turnId === params.turnId) : state.history;
    const result = paginate(items, params.page);
    return { items: clone(result.items), nextCursor: result.nextCursor, previousCursor: result.previousCursor };
  },
  'turn/start'(params) {
    requireSession(params);
    if (state.session.activeTurn) throw new RpcError('conflict', 'The session already has an active turn');
    const turn = { id: `turn-${String(++state.turnCounter).padStart(4, '0')}`, status: 'in_progress', inputEntryId: null, startedAt: now(), completedAt: null, error: null, stopReason: null };
    const userEntry = baseEntry(turn, { type: 'message', role: 'user', content: clone(params.message), source: 'turn_start', userDisplayContent: null });
    turn.inputEntryId = userEntry.id;
    userEntry.inputEntryId = userEntry.id;
    state.session.turns.push(turn);
    state.session.activeTurn = turn;
    state.session.status = { type: 'running', activeTurnId: turn.id };
    state.session.turnContext = { interrupted: deferred(), interruptHonored: false };
    const lastEventId = state.eventId;
    return {
      result: { turn: publicTurn(turn), lastEventId },
      after: async () => {
        await addEntry(userEntry);
        await send(notification('turn/started', nextEventId(), { turn: publicTurn(turn) }));
        void runTurn(turn);
      }
    };
  },
  'turn/interrupt'(params) {
    requireSession(params);
    const active = state.session.activeTurn;
    if (!active) throw new RpcError('conflict', 'No active turn to interrupt');
    if (active.id !== params.expectedTurnId) throw new RpcError('stale_turn', `Turn ${params.expectedTurnId} is not the active turn`);
    record('event', { name: 'interrupt', turnId: active.id });
    return { result: { accepted: true, lastEventId: state.eventId }, after: () => requestInterrupt() };
  },
  'callback/result'(params) {
    requireSession(params);
    const { callbackId, output, error } = params.result;
    const pending = state.pendingCallbacks.get(callbackId);
    if (!pending) throw new RpcError('not_found', `Callback not found: ${callbackId}`);
    let decision = 'deny';
    let normalized = null;
    let malformed = false;
    if (error) malformed = true;
    else {
      const issues = [];
      approvalOutput(output, [], issues);
      if (issues.length > 0) malformed = true;
      else { decision = output.decision.type; normalized = output; }
    }
    record('event', { name: 'approvalAnswer', callbackId, decision, malformed, errorResult: Boolean(error), hasPathScope: Boolean(normalized?.decision?.pathScope), feedback: normalized?.feedback ?? null });
    pending.resolve({ decision, output: normalized, feedback: normalized?.feedback ?? null });
    return { accepted: true, lastEventId: state.eventId };
  },
  'session/stop'(params) {
    requireSession(params);
    state.session.stopped = true;
    return {
      result: { closed: true },
      after: async () => {
        const mode = scenario.afterStop ?? 'exit';
        record('event', { name: 'sessionStop', mode });
        if (mode === 'hang') return;
        if (mode === 'cancelled') stderr('Traceback (most recent call last):\nasyncio.exceptions.CancelledError');
        await shutdown(mode === 'cancelled' ? 1 : 0);
      }
    };
  }
};

function respond(id, method, result) {
  const body = clone(result);
  for (const dotted of scenario.omit?.[method] ?? []) deletePath(body, dotted);
  return send({ jsonrpc: '2.0', id, result: body });
}

async function handleRequest(message) {
  const { id, method } = message;
  try {
    if (!state.initialized && method !== 'initialize') throw new RpcError('not_initialized', 'The connection is not initialized');
    if (state.initialized && method === 'initialize') throw new RpcError('invalid_request', 'The connection is already initialized');
    const injected = scenario.errors?.[method];
    if (injected) throw new RpcError(injected.code, injected.message ?? injected.code, injected.data);
    const handler = handlers[method];
    if (!handler) throw new RpcError('method_not_found', `Method not found: ${method}`);
    validate(schemas[method], message.params);
    const outcome = await handler(message.params);
    const result = outcome && 'result' in outcome ? outcome.result : outcome;
    await respond(id, method, result);
    if (outcome?.after) await outcome.after();
  } catch (error) {
    if (!(error instanceof RpcError)) { fatal(`handler failed: ${error?.stack ?? error}`, 70); return; }
    await send({ jsonrpc: '2.0', id, error: { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) } });
  }
}

function handleMessage(message) {
  if (!isObject(message) || message.jsonrpc !== '2.0') { fatal('frame is not a JSON-RPC 2.0 object'); return; }
  const isResponse = 'result' in message || 'error' in message;
  if (isResponse) {
    const pending = state.pendingServerRequests.get(message.id);
    if (!pending) { fatal(`response to unknown server request id ${String(message.id)}`); return; }
    state.pendingServerRequests.delete(message.id);
    pending.resolve(message);
    return;
  }
  if (typeof message.method !== 'string') { fatal('frame has no method'); return; }
  if (!isObject(message.params)) {
    if ('id' in message) {
      void send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: 'invalid_request', message: 'params is required and must be an object' } });
    } else fatal('notification without params');
    return;
  }
  if (!('id' in message)) {
    if (message.method === 'initialized') { state.initializedNotificationSeen = true; record('event', { name: 'initialized' }); return; }
    fatal(`unknown client notification: ${message.method}`);
    return;
  }
  if (!(typeof message.id === 'number' && Number.isInteger(message.id)) && typeof message.id !== 'string') {
    void send({ jsonrpc: '2.0', id: null, error: { code: 'invalid_request', message: 'id must be an integer or a string' } });
    return;
  }
  void handleRequest(message);
}

let buffered = Buffer.alloc(0);
function onData(chunk) {
  buffered = Buffer.concat([buffered, chunk]);
  for (;;) {
    const newline = buffered.indexOf(0x0a);
    if (newline < 0) break;
    const line = buffered.subarray(0, newline);
    buffered = buffered.subarray(newline + 1);
    if (line.length > MAX_INBOUND_LINE_BYTES) { fatal('inbound line exceeds the fixture limit', 1); return; }
    if (line.length === 0) continue;
    let message;
    try { message = JSON.parse(line.toString('utf8')); } catch {
      record('invalidLine', { length: line.length, head: line.subarray(0, 80).toString('utf8') });
      fatal('invalid JSON on stdin', 1);
      return;
    }
    record('frame', { frame: message });
    handleMessage(message);
    if (state.closing) return;
  }
  if (buffered.length > MAX_INBOUND_LINE_BYTES) fatal('inbound line exceeds the fixture limit', 1);
}

async function onEof() {
  record('event', { name: 'eof' });
  const mode = scenario.eof ?? 'exit';
  if (mode === 'ignore') { setInterval(() => undefined, 1000); return; }
  if (mode === 'delay') await sleep(Math.min(scenario.eofDelayMs ?? 500, MAX_DELAY_MS));
  await shutdown(0);
}

async function shutdown(code) {
  if (state.closing) return;
  state.closing = true;
  removeStore();
  record('exit', { code });
  await writeRaw('');
  process.exit(code);
}

process.stdin.on('data', onData);
process.stdin.on('end', () => { void onEof(); });
process.stdin.on('error', () => { void onEof(); });
