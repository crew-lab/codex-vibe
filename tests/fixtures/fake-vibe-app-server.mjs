// Independent public-protocol fixture. No production backend types are imported.
import readline from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'smol-toml';

const scenario = process.argv[2] ?? 'normal';
const receipt = process.argv[3];
const methods = [];
let initialized = false; let agent; let definitions; let root; let eventId = 0;
let model = 'mistral-medium-3.5'; let reasoning = 'high'; let finished = false;
let callback; let effect;
const history = [];
const sessionId = 'fixture-session'; const turnId = 'fixture-turn';
const baseline = { sessionPromptTokens: 0, sessionCompletionTokens: 0, sessionCachedTokens: 0, inputPricePerMillion: 2, outputPricePerMillion: 8, cachedInputPricePerMillion: 0.2 };
let stats = { ...baseline };
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const reply = (id, result) => emit({ jsonrpc: '2.0', id, result });
const reject = (id, code) => emit({ jsonrpc: '2.0', id, error: { code, message: 'Fixture refusal' } });
const notification = (method, params) => emit({ jsonrpc: '2.0', method, params: { sessionId, eventId: ++eventId, emittedAt: Date.now(), ...params } });
const turn = status => ({ id: turnId, sessionId, status, startedAt: Date.now(), completedAt: status === 'in_progress' ? null : Date.now(), error: null, stopReason: null });
const snapshot = () => ({ format: 'vibe.public-session-state/v1', eventId, session: { id: sessionId, cwd: root, workspaceRoots: [], harness: 'unified' }, activeCallbacks: callback ? [callback] : [], backgroundProcesses: [], childSessions: [] });
const runtime = () => ({ ready: true, sessionLog: { enabled: false, persisted: false }, runtime: {
  activeAgent: { name: agent.agent }, tools: agent.enabledTools.map(name => ({ name })), skills: [], hooksCount: 0, issues: [], bypassToolPermissions: false,
  config: { activeModel: { alias: model, thinking: scenario === 'wrong-model' ? 'off' : reasoning } }, stats,
  connectors: { connected: 0 }, mcp: { sources: [{ name: 'supervisor_search', kind: 'server', transport: 'stdio', status: 'connected', error: null, pluginName: null, tools: [{ name: 'grep', enabled: true }, { name: 'list_files', enabled: true }] }], discoveryErrors: {}, connectorError: null },
} });
const effective = () => ({ config: {
  enable_subagents: false, enable_background_processes: false, managed_shell_tools_enabled: false, enable_connectors: false, enable_telemetry: false, enable_update_checks: false, experimental_enable_model_catalog: false,
  default_agent: agent.agent, max_turns: agent.maxTurns, enabled_tools: agent.enabledTools, disabled_tools: agent.disabledTools,
  enabled_skills: [], disabled_skills: ['*'], session_logging: { enabled: false }, tools: definitions, mcp_servers: agent.mcpServers,
} });

function keys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !(key in value))) throw new Error('Strict params');
}
function entry(id, type, values) {
  return { id, type, sessionId, turnId, inputEntryId: null, createdAt: Date.now(), updatedAt: Date.now(), generationStatus: 'completed', relatedEntryId: null, ...values };
}
function complete(status = 'completed') {
  if (finished) return; finished = true;
  const message = entry('answer', 'message', { role: 'assistant', content: [{ type: 'text', text: 'Fixture completed.' }] });
  history.push(message); notification('history/entryAdded', { entry: message });
  stats = { ...baseline, sessionPromptTokens: 100, sessionCompletionTokens: 20, sessionCachedTokens: 10 };
  notification('session/statsUpdated', { stats, contextWindow: 262144 });
  notification('turn/completed', { turn: turn(status) });
}
function beginApproval() {
  const secret = scenario === 'secret'; const shell = scenario === 'shell-denied' || scenario === 'offprofile-execute';
  const detail = shell ? { kind: 'shell', toolName: 'file_system.bash', input: { command: 'must-not-execute' } } : { kind: 'file_read', toolName: 'file_system.read_file', input: { filePath: secret ? '.env' : 'file.txt', offset: null, limit: 2000 } };
  effect = entry('effect', 'effect', { title: 'fixture tool', detail, state: { status: 'running' } });
  if (scenario === 'offprofile-execute') { effect.state = { status: 'completed', decision: 'execute' }; history.push(effect); notification('history/entryAdded', { entry: effect }); return; }
  history.push(effect); notification('history/entryAdded', { entry: effect });
  callback = entry('callback-entry', 'callback', { callbackId: 'fixture-callback', title: 'fixture approval', state: { status: 'open' }, detail: { kind: 'approval', effect: detail, requiredPermissions: [], choices: ['approve', 'approve_for_session', 'approve_permanently', 'deny', 'cancel_turn'], relatedEntryId: 'effect', pathScopeChoices: [] } });
  emit({ jsonrpc: '2.0', id: 1001, method: 'callback/call', params: { callback } });
}

async function dispatch(frame) {
  if (frame.jsonrpc !== '2.0') throw new Error('Wire version');
  if (!frame.method) {
    if (frame.id !== 1001 || frame.result?.callbackId !== 'fixture-callback' || frame.result.accepted !== true) throw new Error('Bad callback acknowledgement');
    methods.push('callback-ack'); return;
  }
  const p = frame.params; const id = frame.id;
  methods.push(frame.method);
  switch (frame.method) {
    case 'initialize':
      keys(p, ['clientInfo', 'capabilities']);
      keys(p.clientInfo, ['name', 'version', 'entrypoint']);
      keys(p.capabilities, ['callbackKinds']);
      if (p.clientInfo.entrypoint !== 'programmatic' || JSON.stringify(p.capabilities.callbackKinds) !== '["approval"]') throw new Error('Required approval capability');
      if (scenario === 'slow-init') await new Promise(resolve => setTimeout(resolve, 500));
      initialized = true; reply(id, { serverInfo: { name: 'mistral-vibe', version: scenario === 'version-drift' ? '2.26.2' : '2.26.1' }, processId: process.pid }); break;
    case 'initialized': keys(p, []); if (!initialized) throw new Error('Not initialized'); break;
    case 'session/start':
      keys(p, ['agentConfig']); agent = p.agentConfig;
      keys(agent, ['cwd', 'agent', 'enabledTools', 'disabledTools', 'maxTurns', 'headless', 'autoApprove', 'trustWorkspace', 'workspaceRoots', 'mcpServers']);
      if (agent.autoApprove !== false || agent.trustWorkspace !== false || agent.headless !== true || agent.workspaceRoots.length !== 0 || agent.mcpServers.length !== 1) throw new Error('Unsafe session');
      root = agent.cwd;
      definitions = parse(await readFile(path.join(process.env.VIBE_HOME, 'agents', agent.agent + '.toml'), 'utf8')).tools;
      reply(id, { state: snapshot(), lastEventId: eventId }); break;
    case 'runtime/read': keys(p, ['sessionId']); reply(id, runtime()); break;
    case 'config/effective/read': keys(p, ['sessionId']); reply(id, effective()); break;
    case 'session/ready/wait': keys(p, ['sessionId']); reply(id, { ready: true, initDurationMs: 1 }); break;
    case 'config/model/write': keys(p, ['sessionId', 'modelAlias', 'reasoningEffort']); model = p.modelAlias; reasoning = p.reasoningEffort; reply(id, runtime()); break;
    case 'session/read': keys(p, ['sessionId', 'history', 'turns']); reply(id, { state: snapshot(), lastEventId: eventId }); break;
    case 'session/history/list':
      keys(p, ['sessionId', 'turnId', 'page'], ['sessionId', 'page']); keys(p.page, ['direction', 'limit', 'cursor'], ['direction', 'limit']);
      if (p.page.direction !== 'backward') throw new Error('History must page backward from latest');
      if (scenario === 'older-unsafe-effect') {
        const unsafe = entry('older-effect', 'effect', { title: 'unapproved older effect', detail: { kind: 'shell', toolName: 'file_system.bash', input: { command: 'must-not-execute' } }, state: { status: 'completed', decision: 'execute' } });
        reply(id, p.page.cursor ? { items: [unsafe], nextCursor: null, previousCursor: 'answer' } : { items: history, nextCursor: history[0].id, previousCursor: null });
        break;
      }
      reply(id, { items: history, nextCursor: scenario === 'repeated-cursor' ? 'repeat' : null, previousCursor: null }); break;
    case 'turn/start':
      keys(p, ['sessionId', 'message']);
      if (methods.filter(method => method === 'turn/start').length !== 1) throw new Error('Task replay');
      reply(id, { turn: turn('in_progress'), lastEventId: eventId }); notification('turn/started', { turn: turn('in_progress') });
      if (scenario === 'malformed') process.stdout.write('{malformed}\n');
      else if (['approval', 'secret', 'shell-denied', 'offprofile-execute'].includes(scenario)) beginApproval();
      else if (scenario !== 'stalled') {
        const privateEntry = entry('reasoning', 'reasoning', { text: 'private-reasoning-canary', summary: ['secret-summary'] });
        history.push(privateEntry); notification('history/entryAdded', { entry: privateEntry }); complete();
      }
      break;
    case 'callback/result': {
      keys(p, ['sessionId', 'result']); keys(p.result, ['callbackId', 'output', 'error'], ['callbackId']);
      if (!methods.includes('callback-ack')) throw new Error('Result arrived before ack');
      const decision = p.result.output?.decision?.type;
      if (!['approve', 'deny'].includes(decision)) throw new Error('Persistent or invalid grant');
      const expected = scenario === 'approval' ? 'approve' : 'deny';
      if (decision !== expected) throw new Error('Incorrect policy decision');
      callback = undefined;
      effect.state = decision === 'approve' ? { status: 'completed', decision: 'execute', approvalType: 'ask', approvalSource: 'user' } : { status: 'failed', decision: 'skip', error: { code: 'tool_denied', message: 'fixture denied' } };
      reply(id, { accepted: true, lastEventId: eventId });
      notification('history/entryUpdated', { entryId: 'effect', patch: [{ op: 'replace', path: '/state', value: effect.state }] }); complete();
      break;
    }
    case 'turn/interrupt':
      keys(p, ['sessionId', 'expectedTurnId']);
      if (finished) reject(id, 'stale_turn'); else { reply(id, { accepted: true, lastEventId: eventId }); complete('interrupted'); }
      break;
    default: reject(id, 'method_not_found');
  }
}

const input = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
input.on('line', line => {
  chain = chain.then(() => dispatch(JSON.parse(line))).catch(() => { process.stderr.write('Independent fixture protocol assertion failed.\n'); process.exit(1); });
});
input.once('close', () => {
  chain.finally(async () => { if (receipt) await writeFile(receipt, JSON.stringify({ methods }), { mode: 0o600 }); process.exit(0); });
});
