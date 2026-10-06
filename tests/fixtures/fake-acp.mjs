import { createInterface } from 'node:readline';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.env.FAKE_ACP_CASE ?? 'normal';
let sessionId = 'fake-session-1';
let promptCount = 0;
let exited = false;
const pending = new Map();

if (process.env.FAKE_PID_DIR) writeFileSync(path.join(process.env.FAKE_PID_DIR, String(process.pid)), '');

function chunk(text) { notification('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } }); }

function permissionOptions() {
  if (process.env.FAKE_PERMISSION_OPTIONS) return JSON.parse(process.env.FAKE_PERMISSION_OPTIONS);
  return [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' }];
}

function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function notification(method, params) { send({ jsonrpc: '2.0', method, params }); }

async function handle(message) {
  if (message.method === 'initialize') {
    if (mode === 'early-exit') { process.exit(17); return; }
    if (mode === 'init-401') { send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Unauthorized (401): missing api key' } }); return; }
    if (mode === 'init-stderr') { process.stderr.write('fatal: cannot start sk-abcdef1234567890xyz during init\n', () => process.exit(17)); return; }
    if (mode === 'broken-json') { process.stdout.write('{broken-json\n', () => process.exit(23)); return; }
    reply(message.id, { protocolVersion: mode === 'wrong-protocol' ? 999 : 1, agentInfo: { name: 'fake-vibe', version: mode === 'wrong-version' ? '2.26.0' : '2.25.8' }, agentCapabilities: { loadSession: mode !== 'exit-idle-noload' } });
    return;
  }
  if (message.method === 'session/new') {
    if (mode === 'wrong-mode') { reply(message.id, { sessionId, modes: { currentModeId: 'accept-edits' }, _meta: { workspace_trust: { status: 'untrusted' } } }); return; }
    reply(message.id, { sessionId, modes: { currentModeId: 'plan' }, _meta: { workspace_trust: { status: 'untrusted' } } });
    return;
  }
  if (message.method === 'session/load') {
    if (mode === 'load-hang') return;
    reply(message.id, { modes: { currentModeId: 'plan' }, _meta: { workspace_trust: { status: 'untrusted' } } });
    return;
  }
  if (message.method === 'session/set_config_option') { reply(message.id, {}); return; }
  if (message.method === 'session/close') { reply(message.id, {}); return; }
  if (message.method === 'session/cancel') { return; }
  if (message.method === 'session/prompt') {
    promptCount += 1;
    if (mode === 'mid-turn-error') { send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'upstream exploded' } }); return; }
    if (mode === 'mid-turn-401') { send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Unauthorized (401): session expired' } }); return; }
    if (mode === 'exit-zero-mid-turn') {
      chunk('partial answer');
      process.stdout.write('', () => process.exit(0));
      await new Promise(() => {});
    }
    if (mode === 'permission' && promptCount === 1) {
      const filePath = process.env.FAKE_FILE_PATH ?? '/tmp/source.txt';
      notification('session/update', { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'tool-17', title: 'Read source', kind: 'read', rawInput: { path: filePath }, locations: [{ path: filePath }] } });
      const answerPromise = new Promise((resolve) => pending.set('permission-request-1', resolve));
      send({ jsonrpc: '2.0', id: 'permission-request-1', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'tool-17' }, options: permissionOptions() } });
      const answer = await answerPromise;
      const outcome = answer?.outcome;
      if (!outcome || outcome.outcome === 'cancelled') { reply(message.id, { stopReason: 'cancelled' }); return; }
      if (outcome.outcome === 'selected' && String(outcome.optionId).startsWith('reject')) chunk('permission rejected, continuing');
    }
    if (mode === 'uncorrelated' && promptCount === 1) {
      const answerPromise = new Promise((resolve) => pending.set('permission-request-1', resolve));
      send({ jsonrpc: '2.0', id: 'permission-request-1', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'tool-never-announced' }, options: permissionOptions() } });
      const outcome = (await answerPromise)?.outcome;
      if (!outcome || outcome.outcome === 'cancelled') { reply(message.id, { stopReason: 'cancelled' }); return; }
      chunk('permission rejected, continuing');
    }
    if (mode === 'duplicate' && promptCount === 1) {
      const filePath = process.env.FAKE_FILE_PATH ?? '/tmp/source.txt';
      notification('session/update', { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'tool-17', title: 'Read source', kind: 'read', rawInput: { path: filePath }, locations: [{ path: filePath }] } });
      notification('session/update', { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'tool-18', title: 'Read source', kind: 'read', rawInput: { path: filePath }, locations: [{ path: filePath }] } });
      const first = new Promise((resolve) => pending.set('permission-request-1', resolve));
      const second = new Promise((resolve) => pending.set('permission-request-2', resolve));
      send({ jsonrpc: '2.0', id: 'permission-request-1', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'tool-17' }, options: permissionOptions() } });
      send({ jsonrpc: '2.0', id: 'permission-request-2', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'tool-18' }, options: permissionOptions() } });
      const outcomes = (await Promise.all([first, second])).map((answer) => answer?.outcome);
      if (outcomes.some((outcome) => !outcome || outcome.outcome === 'cancelled')) { reply(message.id, { stopReason: 'cancelled' }); return; }
      chunk('permission rejected, continuing');
    }
    if (mode === 'elicitation' && promptCount === 1) {
      const answerPromise = new Promise((resolve) => pending.set('elicitation-request-1', resolve));
      send({ jsonrpc: '2.0', id: 'elicitation-request-1', method: 'elicitation/create', params: { sessionId, mode: 'form', message: 'Confirm the safe operation', requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] } } });
      const answer = await answerPromise;
      if (answer?.action !== 'accept' || answer.content?.confirm !== true) { reply(message.id, { stopReason: 'cancelled' }); return; }
    }
    if (mode === 'normal' || mode === 'soak' || mode === 'permission' || mode === 'load' || mode === 'elicitation' || mode === 'cap-on-second' || mode === 'exit-idle' || mode === 'exit-idle-noload') {
      notification('session/update', { sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'PRIVATE_THOUGHT_MUST_NOT_ESCAPE' } } });
      notification('vibe/unknown_test_notification', { arbitrary: 'unknown notification is ignored' });
      notification('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `reply-${promptCount}` } } });
    }
    if (mode === 'partial-wait') {
      chunk('first complete line\n');
      chunk('partial line without newline');
      await new Promise(() => {});
    }
    if (mode === 'partial-crash') {
      chunk('first complete line\n');
      chunk('partial line without newline');
      process.stdout.write('', () => process.exit(3));
      await new Promise(() => {});
    }
    if (mode === 'marker') chunk('continued-turn-marker');
    if (mode === 'chunked') { chunk('Hel'); chunk('lo '); chunk('world'); }
    if (mode === 'split-secret') { chunk('token sk-abcdef'); chunk('1234567890xyz done'); }
    reply(message.id, { stopReason: mode === 'cap-on-second' && promptCount === 2 ? 'max_turn_requests' : 'end_turn' });
    if (mode === 'exit-idle' || mode === 'exit-idle-noload') setTimeout(() => process.exit(0), 150);
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unknown method ${message.method}` } });
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); }
  catch { process.exit(23); return; }
  const resolvePending = pending.get(message.id);
  if (resolvePending && message.id !== undefined) {
    if (process.env.FAKE_OUTCOME_FILE) appendFileSync(process.env.FAKE_OUTCOME_FILE, `${JSON.stringify(message.result)}\n`);
    resolvePending(message.result); pending.delete(message.id); return;
  }
  void handle(message).catch(() => { if (!exited) { exited = true; process.exit(24); } });
});
