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
  'baselineStats', 'contextWindow', 'afterStop', 'eof', 'eofDelayMs', 'interrupt', 'extraFields', 'omit', 'effectWhileBlocked',
  'badCursor', 'afterHandoff', 'notifyBeforeTurnResponse', 'historyListDelayMs', 'steps'
]);
const STEP_OPS = new Set([
  'say', 'reasoning', 'stats', 'call', 'unknownEntry', 'unknownNotification', 'staleEvent', 'delay', 'hold', 'wedge', 'crash',
  'malformedLine', 'oversizedFrame', 'partialFrame', 'handoff', 'end'
]);
const HANDOFF_KINDS = ['compacted', 'contextCleared'];
const DECISION_TYPES = ['approve', 'approve_for_session', 'approve_permanently', 'deny', 'cancel_turn'];
const APPROVING = new Set(['approve', 'approve_for_session', 'approve_permanently']);
const CALLBACK_KINDS = ['approval', 'user_input', 'connector_auth'];
const CLIENT_TOOLS = ['filesystem/read', 'filesystem/write', 'terminal'];
const TURN_STATUSES = ['in_progress', 'completed', 'failed', 'interrupted'];
const STOP_REASONS = ['limit', 'length'];
const APPROVAL_SOURCES = ['config', 'smart', 'user', 'bypass', 'never'];
const WIRE_TOOLS = {
  'file_system.read_file': 'file_read',
  'file_system.write_file': 'file_write',
  'file_system.search_replace': 'file_edit',
  'file_system.bash': 'shell'
};
const SHORT_TOOL_NAMES = ['read_file', 'write_file', 'edit', 'search_replace', 'bash'];

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
  if (parsed.historyListDelayMs !== undefined && !(Number.isInteger(parsed.historyListDelayMs) && parsed.historyListDelayMs >= 0 && parsed.historyListDelayMs <= MAX_DELAY_MS)) throw new Error('historyListDelayMs out of range');
  for (const step of steps) {
    if (!isObject(step) || !STEP_OPS.has(step.op)) throw new Error(`unknown scenario step: ${JSON.stringify(step)}`);
    if (step.op === 'call') checkCallStep(step);
    if (step.op === 'handoff') checkHandoffStep(step);
    if (step.op === 'end') {
      if (step.status !== undefined && !TURN_STATUSES.includes(step.status)) throw new Error('end step status invalid');
      if (step.stopReason !== undefined && step.stopReason !== null && !STOP_REASONS.includes(step.stopReason)) throw new Error('end step stopReason invalid');
    }
    if (step.op === 'oversizedFrame' && !(Number.isInteger(step.bytes) && step.bytes > 0 && step.bytes <= MAX_OUTBOUND_FRAME_BYTES)) throw new Error('oversizedFrame bytes out of range');
    if (step.op === 'delay' && !(Number.isInteger(step.ms) && step.ms >= 0 && step.ms <= MAX_DELAY_MS)) throw new Error('delay ms out of range');
  }
  return parsed;
}

function checkHandoffStep(step) {
  if (!HANDOFF_KINDS.includes(step.kind ?? 'compacted')) throw new Error('handoff step kind invalid');
  if (step.newSessionId !== undefined && (typeof step.newSessionId !== 'string' || step.newSessionId.length === 0)) throw new Error('handoff step newSessionId invalid');
  if (step.eventId !== undefined && !(Number.isInteger(step.eventId) && step.eventId > 0)) throw new Error('handoff step eventId invalid');
  if (step.history !== undefined && !['keep', 'clear'].includes(step.history)) throw new Error('handoff step history invalid');
}

function checkCallStep(step) {
  if (step.handoffWhileOpen !== undefined) checkHandoffStep(step.handoffWhileOpen);
  if (typeof step.tool !== 'string' || !['approval', 'auto', 'never', 'pending'].includes(step.mode ?? 'approval')) throw new Error('call step needs tool and a valid mode');
  if (SHORT_TOOL_NAMES.includes(step.tool)) throw new Error(`call tool must be the Unified wire name, not the short name: ${step.tool}`);
  if (step.source !== undefined && !APPROVAL_SOURCES.includes(step.source)) throw new Error('call step source invalid');
  if (step.output !== undefined) assertCamelCase(step.output, 'call output');
  if (step.generic === true || !(step.tool in WIRE_TOOLS)) return;
  assertCamelCase(step.input ?? {}, 'call input');
  checkInputShape(WIRE_TOOLS[step.tool], step.input ?? {});
}

function checkInputShape(kind, input) {
  const keys = (allowed) => { for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`${kind} input has an unknown key: ${key}`); };
  const text = (value, name, min = 0) => { if (typeof value !== 'string' || value.length < min) throw new Error(`${kind} input ${name} must be a string`); };
  const optionalInt = (value, name) => { if (value !== undefined && value !== null && !Number.isInteger(value)) throw new Error(`${kind} input ${name} must be an integer or null`); };
  if (kind === 'file_read') { keys(['filePath', 'offset', 'limit']); text(input.filePath, 'filePath', 1); optionalInt(input.offset, 'offset'); optionalInt(input.limit, 'limit'); return; }
  if (kind === 'file_write') { keys(['filePath', 'content']); text(input.filePath, 'filePath', 1); text(input.content, 'content'); return; }
  if (kind === 'shell') { keys(['command']); text(input.command, 'command'); return; }
  text(input.filePath, 'filePath', 1);
  if (input.changes !== undefined) {
    keys(['filePath', 'changes']);
    if (!Array.isArray(input.changes) || input.changes.length < 1) throw new Error('file_edit input changes must be a non-empty list');
    for (const change of input.changes) {
      if (!isObject(change)) throw new Error('file_edit change must be an object');
      for (const key of Object.keys(change)) if (!['oldString', 'newString', 'replaceAll'].includes(key)) throw new Error(`file_edit change has an unknown key: ${key}`);
      text(change.oldString, 'oldString', 1); text(change.newString, 'newString');
    }
    return;
  }
  keys(['filePath', 'oldString', 'newString', 'replaceAll']);
  text(input.oldString, 'oldString', 1); text(input.newString, 'newString');
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
  for (const [key, item] of Object.entries(value)) out[key] = key === 'discoveryErrors' ? item : decorate(item);
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
  callCounter: 0,
  entryCounter: 0,
  wedged: false,
  closing: false,
  lastHistoryNotification: null
};

const now = () => CLOCK_BASE_MS + (state.clock += 1);
const sessionId = () => state.currentSessionId ?? scenario.sessionId ?? 'fake-session-0001';

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
      name: V.str(), version: V.str(), title: V.nullable(V.str()), entrypoint: V.str(), terminalEmulator: V.str()
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

function effectKind(step) {
  return step.generic === true ? 'tool' : (WIRE_TOOLS[step.tool] ?? 'tool');
}

const displayPath = (filePath, cwd) => (cwd && typeof filePath === 'string' && filePath.startsWith(`${cwd}/`) ? filePath.slice(cwd.length + 1) : filePath);

function normalizedInput(kind, input) {
  if (kind === 'file_read') return { filePath: input.filePath, offset: input.offset ?? null, limit: input.limit === undefined ? 2000 : input.limit };
  if (kind === 'file_edit' && input.changes !== undefined) {
    return { filePath: input.filePath, changes: input.changes.map((change) => ({ oldString: change.oldString, newString: change.newString, replaceAll: change.replaceAll ?? false })) };
  }
  if (kind === 'file_edit') return { filePath: input.filePath, oldString: input.oldString, newString: input.newString, replaceAll: input.replaceAll ?? false };
  return input;
}

function callDisplay(kind, tool, input, cwd) {
  const shown = displayPath(input.filePath, cwd);
  const file = (activeVerb, verb, settledVerb, statusText, content = null) => ({ summary: `${activeVerb} ${shown}`, content, suffix: '', verb, message: shown, settledVerb, settledMessage: shown, statusText });
  if (kind === 'file_read') return file('Reading', 'Reading', 'Read', 'Reading file');
  if (kind === 'file_write') return file('Writing', 'Creating', 'Created', 'Writing file', input.content);
  if (kind === 'file_edit') return file('Editing', 'Editing', 'Edited', 'Editing file');
  if (kind === 'shell') return { summary: `bash: ${input.command}`, content: null, suffix: '', verb: 'Running', message: input.command, settledVerb: 'Ran', settledMessage: input.command, statusText: 'Running command' };
  return { summary: tool, content: null, suffix: '', verb: 'Running', message: tool, settledVerb: 'Ran', settledMessage: tool, statusText: `Running ${tool}` };
}

function effectDetail(step, cwd) {
  const kind = effectKind(step);
  const input = normalizedInput(kind, step.input ?? {});
  return { kind, toolName: step.tool, display: callDisplay(kind, step.tool, input, cwd), input };
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

const NO_APPROVAL_META = { decision: null, approvalType: null, approvalSource: null };

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

function deniedState(detail, message, approvalType, approvalSource) {
  return {
    status: 'failed',
    error: { message, code: 'tool_denied', details: null },
    output: null,
    outputText: '',
    durationMs: 0,
    display: resultDisplay(detail, false, 'denied'),
    decision: 'skip',
    approvalType,
    approvalSource
  };
}

const CALLBACK_DENIED = 'Tool execution denied by approval callback';
const POLICY_DENIED = 'Tool execution denied by approval policy';

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
    case 'handoff': await handoff(step); return undefined;
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

async function handoff(step) {
  const previous = sessionId();
  const next = step.newSessionId ?? `${previous}-next`;
  state.currentSessionId = next;
  const eventId = step.eventId ?? nextEventId();
  state.eventId = eventId;
  if (step.resetStats) Object.assign(state.stats, { sessionPromptTokens: 0, sessionCompletionTokens: 0, sessionCachedTokens: 0, modelCalls: state.stats.modelCalls === null ? null : 0 }, step.resetStats === true ? {} : step.resetStats);
  if (step.history === 'clear') state.history = [];
  else for (const entry of state.history) entry.sessionId = next;
  const kind = step.kind ?? 'compacted';
  const body = { oldSessionId: previous, state: sessionState(), sessionLog: sessionLog(), ...(kind === 'compacted' ? { summaryLength: 120 } : { planFilePath: null }) };
  record('event', { name: 'handoff', handoffKind: kind, previous, next, eventId });
  await send(notification(kind === 'compacted' ? 'session/compacted' : 'session/contextCleared', eventId, body));
  await send(notification('session/statsUpdated', nextEventId(), { stats: clone(state.stats), contextWindow: scenario.contextWindow ?? 128000 }));
}

async function runCall(step, turn, raceInterrupt, silent) {
  const detail = effectDetail(step, state.session.cwd);
  const mode = step.mode ?? 'approval';
  const sequence = String(++state.callCounter).padStart(4, '0');
  const actionId = step.id ?? `action-${sequence}`;
  const callId = `call-${sequence}`;
  const effect = baseEntry(turn, { id: `effect-${actionId}`, type: 'effect', title: step.tool, detail, state: { status: 'running', outputText: '' } });
  if (mode === 'auto') {
    effect.state = { ...completedState(detail, step, step.approvalType ?? 'always', step.source ?? 'config'), ...(step.approvalMeta === false ? NO_APPROVAL_META : {}), ...(step.callbackId === undefined ? {} : { callbackId: step.callbackId }) };
    await addEntry(effect, { silent });
    return undefined;
  }
  if (mode === 'pending') {
    effect.generationStatus = 'in_progress';
    effect.state = { status: step.status ?? 'running', outputText: '' };
    await addEntry(effect, { silent });
    return undefined;
  }
  if (mode === 'never') {
    effect.state = { ...deniedState(detail, POLICY_DENIED, 'never', step.source ?? 'never'), ...(step.approvalMeta === false ? NO_APPROVAL_META : {}) };
    await addEntry(effect, { silent });
    return undefined;
  }
  return runApproval(step, turn, effect, detail, callId, raceInterrupt);
}

async function runApproval(step, turn, effect, detail, callId, raceInterrupt) {
  if (!state.clientCallbackKinds.includes('approval')) {
    stderr('fake-vibe-app-server: client did not declare the approval callback kind; cancelling the serve task');
    fatal('approval callback undeliverable: client capability missing', 1);
    return INTERRUPTED;
  }
  if (state.pendingServerRequests.size >= MAX_PENDING_SERVER_REQUESTS) fatal('too many pending server requests', 70);
  const callbackId = `approval-${callId}`;
  effect.generationStatus = 'in_progress';
  effect.state = scenario.effectWhileBlocked === 'blocked' ? { status: 'blocked', callbackId, outputText: '' } : { status: 'running', outputText: '' };
  await addEntry(effect);
  const callbackEntry = baseEntry(turn, {
    id: callbackId,
    type: 'callback',
    generationStatus: 'in_progress',
    relatedEntryId: effect.id,
    callbackId,
    title: `Approve ${step.tool}`,
    detail: { kind: 'approval', effect: step.callbackInput === undefined ? clone(detail) : { ...clone(detail), input: normalizedInput(detail.kind, step.callbackInput) }, requiredPermissions: [], choices: [...DECISION_TYPES], pathScopeChoices: [], relatedEntryId: effect.id, reason: null },
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
  if (step.handoffWhileOpen) await handoff(step.handoffWhileOpen);
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
  const answered = { status: 'answered', output: decided.output ?? { type: 'approval', decision: { type: 'deny', pathScope: null }, feedback: null } };
  await patchEntry(callbackEntry, [{ op: 'replace', path: '/generationStatus', value: 'completed' }, { op: 'replace', path: '/state', value: answered }]);
  const finalState = approved ? completedState(detail, step, 'ask', 'user') : deniedState(detail, CALLBACK_DENIED, 'ask', 'user');
  const alteration = step.alterAfterApproval === undefined ? [] : [{ op: 'replace', path: '/detail/input', value: normalizedInput(detail.kind, step.alterAfterApproval) }];
  await patchEntry(effect, [...alteration, { op: 'replace', path: '/generationStatus', value: 'completed' }, { op: 'replace', path: '/state', value: finalState }]);
  if (decided.decision === 'cancel_turn') requestInterrupt();
  return undefined;
}

async function cancelCallback(effect, callbackEntry, callbackId) {
  state.pendingCallbacks.delete(callbackId);
  await patchEntry(callbackEntry, [{ op: 'replace', path: '/generationStatus', value: 'completed' }, { op: 'replace', path: '/state', value: { status: 'cancelled', reason: 'turn interrupted' } }]);
  await patchEntry(effect, [{ op: 'replace', path: '/generationStatus', value: 'completed' }, { op: 'replace', path: '/state', value: { status: 'cancelled', reason: 'turn interrupted', outputText: '', durationMs: 0, display: null, ...NO_APPROVAL_META } }]);
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
  if (step.ignoreSigterm) for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => record('event', { name: 'signalIgnored', signal }));
  process.stdin.pause();
  process.stdin.removeAllListeners('data');
  process.stdin.removeAllListeners('end');
  process.stdin.on('error', () => undefined);
  setInterval(() => undefined, 1000);
  record('event', { name: 'wedged', pid: process.pid, ignoreSigterm: step.ignoreSigterm === true });
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
  const options = session.agentConfig;
  const base = {
    active_model: session.modelPinned ? session.modelAlias : '',
    models: { [session.modelAlias]: { thinking: session.reasoningEffort } },
    enabled_tools: options.enabledTools ?? [],
    disabled_tools: options.disabledTools ?? [],
    mcp_servers: options.mcpServers ?? [],
    enable_subagents: true,
    enable_background_processes: true,
    managed_shell_tools_enabled: false,
    enable_connectors: true,
    enabled_skills: [],
    disabled_skills: [],
    skill_paths: [],
    tool_paths: [],
    enable_telemetry: true,
    enable_update_checks: true,
    session_logging: { save_dir: '/fixture/vibe-home/logs/session', session_prefix: 'session', enabled: true, generate_titles: true },
    tools: {},
    bypass_tool_permissions: scenario.runtime?.bypassToolPermissions ?? options.autoApprove ?? false
  };
  if (scenario.effectiveFromEnv !== false) mergeDeep(base, envOverrides());
  if (session.thinkingWritten) base.models[session.modelAlias] = { thinking: session.reasoningEffort };
  if (scenario.effectiveConfig) mergeDeep(base, scenario.effectiveConfig);
  if (state.currentSessionId && scenario.afterHandoff?.effectiveConfig) mergeDeep(base, scenario.afterHandoff.effectiveConfig);
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
    activeAgent: { name: runtime.activeAgentName ?? session.agentConfig.agent ?? 'default', displayName: session.agentConfig.agent ?? 'default', description: '', safety: 'neutral', agentType: 'agent' },
    agents: [],
    skills: runtime.skills ?? [],
    tools: toolNames().map((name) => ({ name, isCustom: false })),
    stats: clone(state.stats),
    contextWindow: scenario.contextWindow ?? 128000,
    issues: runtime.issues ?? [],
    hooksCount: runtime.hooksCount ?? 0,
    connectors: runtime.connectors ?? { connected: 0, total: null },
    mcp: { sources: runtime.mcpSources ?? [], discoveryErrors: runtime.discoveryErrors ?? {}, connectorError: null, manageConnectorsUrl: null },
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
    activeCallbacks: scenario.runtime?.activeCallbacks ?? [],
    childSessions: scenario.runtime?.childSessions ?? [],
    backgroundProcesses: scenario.runtime?.backgroundProcesses ?? [],
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

function paginate(items, request = {}) {
  const limit = request.limit ?? 200;
  const direction = request.direction ?? 'backward';
  const cursor = request.cursor ?? null;
  const index = cursor === null ? -1 : items.findIndex((entry) => entry.id === cursor);
  if (cursor !== null && index < 0 && scenario.badCursor === 'invalid_params') throw new RpcError('invalid_params', 'Invalid cursor', { errorCount: 1, issues: [{ path: ['page', 'cursor'], message: 'Invalid cursor' }] });
  let page;
  if (cursor === null) page = items.slice(-limit);
  else if (index < 0) page = [];
  else if (direction === 'forward') page = items.slice(index + 1, index + 1 + limit);
  else page = items.slice(Math.max(0, index - limit), index);
  const first = page.length > 0 ? items.indexOf(page[0]) : -1;
  const last = page.length > 0 ? items.indexOf(page.at(-1)) : -1;
  const older = first > 0 ? page[0].id : null;
  const newer = last >= 0 && last < items.length - 1 ? page.at(-1).id : null;
  return direction === 'forward' ? { items: page, nextCursor: newer, previousCursor: older } : { items: page, nextCursor: older, previousCursor: newer };
}

const handlers = {
  initialize(params) {
    state.initialized = true;
    state.clientCallbackKinds = params.capabilities?.callbackKinds ?? [];
    record('event', { name: 'initialize', callbackKinds: state.clientCallbackKinds });
    return { serverInfo: { name: scenario.serverName ?? 'vibe-app-server', version: scenario.serverVersion ?? '3.0.2' }, processId: process.pid };
  },
  'session/start'(params) {
    if (state.session) throw new RpcError('conflict', 'A session is already open on this connection');
    const config = params.agentConfig ?? {};
    state.stats = { ...emptyStats(), ...(scenario.baselineStats ?? {}) };
    state.eventId = state.watermark;
    state.session = {
      createdAt: now(), agentConfig: config, cwd: config.cwd ?? config.workdir ?? null, status: { type: 'idle' }, activeTurn: null,
      turnContext: null, turns: [], ready: scenario.readyInitially === true, stopped: false,
      modelAlias: 'mistral-medium-3.5', modelPinned: false, reasoningEffort: 'high', thinkingWritten: false
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
    const serverVersion = scenario.serverVersion ?? '3.0.2';
    const result = {
      config: runtimeSnapshot().config,
      strippedHistoryImages: 0,
      skillsCount: (runtime.skills ?? []).filter((skill) => skill.scope !== 'builtin').length,
      hooksCount: runtime.hooksCount ?? 0,
      mcpServersTotal: (runtime.mcpSources ?? []).length,
      mcpServersEnabled: (runtime.mcpSources ?? []).length
    };
    if (serverVersion !== '3.0.2') {
      result.startupIssue = null;
      result.harnessSelectionSource = Object.hasOwn(scenario, 'harnessSelectionSource') ? scenario.harnessSelectionSource : 'default';
    } else if (Object.hasOwn(scenario, 'harnessSelectionSource')) {
      result.harnessSelectionSource = scenario.harnessSelectionSource;
    }
    return result;
  },
  'config/model/write'(params) {
    requireSession(params);
    const levels = scenario.thinkingLevels ?? ['off', 'high'];
    if (params.reasoningEffort && !levels.includes(params.reasoningEffort)) throw new RpcError('invalid_params', 'Invalid reasoning effort', { errorCount: 1, issues: [{ path: ['reasoningEffort'], message: `Input should be one of: ${levels.join(', ')}` }] });
    const write = scenario.modelWrite ?? {};
    if (!write.ignore) {
      if (params.modelAlias) { state.session.modelAlias = params.modelAlias; state.session.modelPinned = true; }
      if (params.reasoningEffort) { state.session.reasoningEffort = params.reasoningEffort; state.session.thinkingWritten = true; }
    }
    record('event', { name: 'modelWrite', modelAlias: params.modelAlias ?? null, reasoningEffort: params.reasoningEffort ?? null, ignored: write.ignore === true });
    return { runtime: runtimeSnapshot(), status: write.status ?? 'applied', strippedHistoryImages: 0 };
  },
  'session/read'(params) {
    requireSession(params);
    return { lastEventId: state.eventId, state: sessionState({ historyLimit: params.history?.limit }), leaseHolder: { processId: process.pid } };
  },
  async 'session/history/list'(params) {
    requireSession(params);
    if (scenario.historyListDelayMs) await sleep(scenario.historyListDelayMs);
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
    const early = scenario.notifyBeforeTurnResponse;
    const ahead = Number.isInteger(early) && early > 0;
    const before = [];
    if (ahead) {
      addEntry(userEntry, { silent: true });
      before.push(notification('history/entryAdded', state.eventId, { turnId: userEntry.turnId, entry: clone(userEntry) }));
      before.push(notification('turn/started', nextEventId(), { turn: publicTurn(turn) }));
      for (let index = 0; index < early; index += 1) {
        before.push(notification('session/statsUpdated', nextEventId(), { stats: clone(state.stats), contextWindow: scenario.contextWindow ?? 128000 }));
      }
    }
    const lastEventId = state.eventId;
    return {
      result: { turn: publicTurn(turn), lastEventId },
      ...(ahead ? { before } : {}),
      after: async () => {
        if (!ahead) {
          await addEntry(userEntry);
          await send(notification('turn/started', nextEventId(), { turn: publicTurn(turn) }));
        }
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

function respondWithPrefix(id, method, result, frames) {
  const body = clone(result);
  for (const dotted of scenario.omit?.[method] ?? []) deletePath(body, dotted);
  const lines = [...frames, { jsonrpc: '2.0', id, result: body }].map((frame) => `${JSON.stringify(frame)}\n`);
  return writeRaw(lines.join(''));
}

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
    if (outcome?.before) await respondWithPrefix(id, method, result, outcome.before);
    else await respond(id, method, result);
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
