import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonRpcClient, JsonRpcServerError, type JsonRpcClientOptions } from '../../src/backends/app-server/jsonrpc.js';
import {
  ProtocolParseError,
  approvalOutput,
  buildCallbackResult,
  buildConfigEffectiveRead,
  buildConfigModelWrite,
  buildConfigRead,
  buildInitialize,
  buildInitialized,
  buildRuntimeRead,
  buildSessionHistoryList,
  buildSessionRead,
  buildSessionReadyWait,
  buildSessionStart,
  buildTurnInterrupt,
  buildTurnStart,
  callbackAcknowledgement,
  effectFilePath,
  isTurnErrorCode,
  messageText,
  parseCallbackCall,
  parseConfigEffectiveReadResult,
  parseConfigModelWriteResult,
  parseConfigReadResult,
  parseHistoryEntry,
  parseHistoryListResult,
  parseInitializeResult,
  parseNotification,
  parseRuntimeReadResult,
  parseSessionReadResult,
  parseSessionReadyWaitResult,
  parseSessionStartResult,
  parseTurnStartResult,
  serverErrorIssues,
  CLIENT_ENTRYPOINT,
  type HistoryEntry,
  type ServerNotification
} from '../../src/backends/app-server/protocol.js';

type Json = Record<string, unknown>;

const root = path.resolve(import.meta.dirname, '..', '..');
const fixture = path.join(root, 'tests', 'fixtures', 'fake-vibe-app-server.mjs');
const scenarioDirectory = path.join(root, 'tests', 'fixtures', 'app-server-scenarios');
const workspace = '/work/space';
const sessionId = 'fake-session-0001';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sessionConfig = { cwd: workspace, agent: 'supervisor-review', enabledTools: ['read_file'], maxTurns: 20 };

describe('request builders', () => {
  it('builds initialize with only the keys the server models allow', () => {
    expect(buildInitialize({ name: 'vibe-supervisor', version: '2.0.0' })).toEqual({
      method: 'initialize',
      params: {
        clientInfo: { name: 'vibe-supervisor', version: '2.0.0', entrypoint: CLIENT_ENTRYPOINT },
        capabilities: { callbackKinds: ['approval'] }
      }
    });
    expect(buildInitialized()).toEqual({ method: 'initialized', params: {} });
    expect(() => buildInitialize({ name: '', version: '1' })).toThrow(TypeError);
  });

  it('builds session/start with the safety fields fixed regardless of input', () => {
    const request = buildSessionStart({ ...sessionConfig, disabledTools: ['bash'], autoApprove: true, trustWorkspace: true, workspaceRoots: ['/x'], mcpServers: [{}] } as never);
    expect(request).toEqual({
      method: 'session/start',
      params: {
        agentConfig: {
          cwd: workspace,
          agent: 'supervisor-review',
          enabledTools: ['read_file'],
          disabledTools: ['bash'],
          maxTurns: 20,
          headless: true,
          autoApprove: false,
          trustWorkspace: false,
          workspaceRoots: [],
          mcpServers: []
        },
        historyLimit: 500
      }
    });
  });

  it('passes optional session/start fields only when given', () => {
    const request = buildSessionStart(sessionConfig, { historyLimit: 10, kind: 'ephemeral', idempotencyKey: 'run-1' });
    expect(request.params).toMatchObject({ historyLimit: 10, kind: 'ephemeral', idempotencyKey: 'run-1' });
    expect(Object.keys(buildSessionStart(sessionConfig).params).sort()).toEqual(['agentConfig', 'historyLimit']);
  });

  it.each([
    ['an empty enabledTools list', { ...sessionConfig, enabledTools: [] }],
    ['a blank tool name', { ...sessionConfig, enabledTools: [''] }],
    ['a relative cwd', { ...sessionConfig, cwd: 'relative/dir' }],
    ['an empty agent', { ...sessionConfig, agent: '' }],
    ['a zero maxTurns', { ...sessionConfig, maxTurns: 0 }],
    ['a fractional maxTurns', { ...sessionConfig, maxTurns: 1.5 }]
  ])('refuses session/start with %s', (_name, config) => {
    expect(() => buildSessionStart(config)).toThrow();
  });

  it('refuses out-of-range history limits and unknown kinds', () => {
    expect(() => buildSessionStart(sessionConfig, { historyLimit: 0 })).toThrow(RangeError);
    expect(() => buildSessionStart(sessionConfig, { historyLimit: 501 })).toThrow(RangeError);
    expect(() => buildSessionStart(sessionConfig, { kind: 'forever' as never })).toThrow(TypeError);
  });

  it('builds the session-scoped reads with params always present', () => {
    expect(buildSessionReadyWait('s')).toEqual({ method: 'session/ready/wait', params: { sessionId: 's' } });
    expect(buildRuntimeRead('s')).toEqual({ method: 'runtime/read', params: { sessionId: 's' } });
    expect(buildConfigEffectiveRead('s')).toEqual({ method: 'config/effective/read', params: { sessionId: 's' } });
    expect(buildConfigRead('s')).toEqual({ method: 'config/read', params: { sessionId: 's' } });
    for (const build of [buildSessionReadyWait, buildRuntimeRead, buildConfigEffectiveRead, buildConfigRead]) expect(() => build('')).toThrow(TypeError);
  });

  it('builds config/model/write and requires something to write', () => {
    expect(buildConfigModelWrite('s', { reasoningEffort: 'off' })).toEqual({ method: 'config/model/write', params: { sessionId: 's', reasoningEffort: 'off' } });
    expect(buildConfigModelWrite('s', { modelAlias: 'm', reasoningEffort: 'off' }).params).toEqual({ sessionId: 's', reasoningEffort: 'off', modelAlias: 'm' });
    expect(() => buildConfigModelWrite('s', {})).toThrow(TypeError);
  });

  it('builds turn/start with the task as one text block and turn/interrupt with the expected turn', () => {
    expect(buildTurnStart('s', 'review it')).toEqual({ method: 'turn/start', params: { sessionId: 's', message: [{ type: 'text', text: 'review it' }] } });
    expect(() => buildTurnStart('s', '')).toThrow(TypeError);
    expect(buildTurnInterrupt('s', 't1')).toEqual({ method: 'turn/interrupt', params: { sessionId: 's', expectedTurnId: 't1' } });
    expect(() => buildTurnInterrupt('s', '')).toThrow(TypeError);
  });

  it('builds paged reads with validated limits', () => {
    expect(buildSessionRead('s')).toEqual({ method: 'session/read', params: { sessionId: 's' } });
    expect(buildSessionRead('s', { history: { limit: 500, direction: 'forward', cursor: '12' } }).params).toEqual({ sessionId: 's', history: { limit: 500, direction: 'forward', cursor: '12' } });
    expect(buildSessionHistoryList('s', { limit: 100 }, 't1')).toEqual({ method: 'session/history/list', params: { sessionId: 's', page: { limit: 100 }, turnId: 't1' } });
    expect(() => buildSessionHistoryList('s', { limit: 0 })).toThrow(RangeError);
    expect(() => buildSessionHistoryList('s', { limit: 501 })).toThrow(RangeError);
    expect(() => buildSessionHistoryList('s', { limit: 5, direction: 'sideways' as never })).toThrow(TypeError);
  });

  it('builds the approval envelope exactly and never anything broader than approve or deny', () => {
    expect(approvalOutput('approve')).toEqual({ type: 'approval', decision: { type: 'approve' }, feedback: null });
    expect(approvalOutput('deny')).toEqual({ type: 'approval', decision: { type: 'deny' }, feedback: null });
    expect(JSON.stringify(approvalOutput('approve'))).not.toContain('pathScope');
    for (const forbidden of ['approve_for_session', 'approve_permanently', 'cancel_turn', '']) expect(() => approvalOutput(forbidden as never)).toThrow(TypeError);
    expect(buildCallbackResult('s', 'cb-1', 'deny')).toEqual({
      method: 'callback/result',
      params: { sessionId: 's', result: { callbackId: 'cb-1', output: { type: 'approval', decision: { type: 'deny' }, feedback: null } } }
    });
    expect(() => buildCallbackResult('s', 'cb-1', 'approve_for_session' as never)).toThrow(TypeError);
    expect(callbackAcknowledgement('cb-1')).toEqual({ callbackId: 'cb-1', accepted: true });
  });
});

const turn = { id: 't1', status: 'completed', stopReason: null, error: null, inputEntryId: 'e1', startedAt: 1, completedAt: 2, queueItemId: null };
const stats = { sessionPromptTokens: 10, sessionCompletionTokens: 5, sessionCachedTokens: 2, modelCalls: 1, inputPricePerMillion: 0.4, outputPricePerMillion: 2, cachedInputPricePerMillion: null, contextTokens: 15, steps: 1 };
const assistantMessage = { type: 'message', id: 'm1', turnId: 't1', role: 'assistant', generationStatus: 'completed', content: [{ type: 'text', text: 'Hello' }] };
const effectEntry = {
  type: 'effect',
  id: 'c1',
  turnId: 't1',
  title: 'read_file',
  detail: { kind: 'file_read', toolName: 'read_file', display: { summary: 'x' }, input: { filePath: '/work/space/a.ts', offset: null, limit: 2000 } },
  state: { status: 'completed', decision: 'execute', approvalType: 'ask', approvalSource: 'user', output: { content: 'big' } }
};
const sessionState = {
  format: 'vibe.public-session-state/v1',
  eventId: 7,
  session: { id: 's1', harness: 'unified', cwd: '/work/space', model: 'm', reasoningEffort: 'high', status: { type: 'idle' }, tokenUsage: null },
  isQuiescent: true,
  history: [assistantMessage],
  historyBeforeCursor: null,
  turns: [turn]
};
const runtime = {
  config: { activeModel: { name: 'm', alias: 'm', thinking: 'high', thinkingLevels: ['off', 'high'] }, activeModelPinned: false },
  tools: [{ name: 'read_file', isCustom: false }],
  skills: [],
  mcp: { sources: [] },
  connectors: { connected: 0, total: 0 },
  hooksCount: 0,
  issues: [],
  stats,
  bypassToolPermissions: false,
  experimentalHarness: true
};

function expectParseError(run: () => unknown, pathFragment?: string): ProtocolParseError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolParseError);
    if (pathFragment !== undefined) expect((error as ProtocolParseError).issues.map((issue) => issue.path).join('|')).toContain(pathFragment);
    return error as ProtocolParseError;
  }
  throw new Error('expected a ProtocolParseError');
}

function withoutKey<T extends Json>(value: T, key: string): Json {
  const copy: Json = { ...value };
  delete copy[key];
  return copy;
}

describe('response parsers', () => {
  it('parses initialize and requires the server version', () => {
    expect(parseInitializeResult({ serverInfo: { name: 'vibe-app-server', version: '2.26.1', extra: 1 }, processId: 42, future: true })).toEqual({ serverName: 'vibe-app-server', serverVersion: '2.26.1', processId: 42 });
    expect(parseInitializeResult({ serverInfo: { name: 'n', version: '1' } }).processId).toBeNull();
    expectParseError(() => parseInitializeResult({ serverInfo: { name: 'n' } }), 'serverInfo.version');
    expectParseError(() => parseInitializeResult({}), 'serverInfo');
    expectParseError(() => parseInitializeResult('x'));
  });

  it('parses session/start and session/read, ignoring unknown fields at every depth', () => {
    const decorated = { lastEventId: 7, futureField: { a: 1 }, state: { ...sessionState, futureField: [1], session: { ...sessionState.session, futureField: 'x' }, turns: [{ ...turn, futureField: 'y' }] } };
    const parsed = parseSessionStartResult(decorated);
    expect(parsed.lastEventId).toBe(7);
    expect(parsed.state).toMatchObject({ eventId: 7, historyBeforeCursor: null, isQuiescent: true });
    expect(parsed.state.session).toEqual({ id: 's1', harness: 'unified', cwd: '/work/space', model: 'm', reasoningEffort: 'high', statusType: 'idle' });
    expect(parsed.state.history[0]).toMatchObject({ kind: 'message', role: 'assistant' });
    expect(parsed.state.turns[0]).toMatchObject({ id: 't1', status: 'completed', stopReason: null, error: null });
    expect(parseSessionReadResult(decorated).state.eventId).toBe(7);
  });

  it('fails session state parsing when a depended-on field is missing', () => {
    expectParseError(() => parseSessionStartResult({ state: sessionState }), 'lastEventId');
    expectParseError(() => parseSessionStartResult({ lastEventId: 1, state: withoutKey(sessionState, 'eventId') }), 'state.eventId');
    expectParseError(() => parseSessionStartResult({ lastEventId: 1, state: { ...sessionState, session: withoutKey(sessionState.session, 'harness') } }), 'harness');
    expectParseError(() => parseSessionStartResult({ lastEventId: 1, state: { ...sessionState, session: withoutKey(sessionState.session, 'id') } }), 'session.id');
    expectParseError(() => parseSessionStartResult({ lastEventId: 1, state: withoutKey(sessionState, 'history') }), 'history');
    expectParseError(() => parseSessionStartResult({ lastEventId: 1, state: withoutKey(sessionState, 'turns') }), 'turns');
  });

  it('surfaces the session callback, child and background lists, and null when absent', () => {
    const withLists = { ...sessionState, activeCallbacks: [{ id: 'cb' }], childSessions: [], backgroundProcesses: [{ processId: 'p' }] };
    expect(parseSessionStartResult({ lastEventId: 1, state: withLists }).state).toMatchObject({ activeCallbacks: [{ id: 'cb' }], childSessions: [], backgroundProcesses: [{ processId: 'p' }] });
    expect(parseSessionReadResult({ lastEventId: 1, state: withLists }).state.activeCallbacks).toEqual([{ id: 'cb' }]);
    expect(parseSessionStartResult({ lastEventId: 1, state: sessionState }).state).toMatchObject({ activeCallbacks: null, childSessions: null, backgroundProcesses: null });
    expectParseError(() => parseSessionStartResult({ lastEventId: 1, state: { ...sessionState, activeCallbacks: 'none' } }), 'activeCallbacks');
  });

  it('surfaces unknown history entry kinds distinctly inside session state', () => {
    const parsed = parseSessionStartResult({ lastEventId: 1, state: { ...sessionState, history: [assistantMessage, { type: 'hologram', id: 'h1', payload: {} }] } });
    expect(parsed.state.history.map((entry) => entry.kind)).toEqual(['message', 'unknown']);
    expect(parsed.state.history[1]).toEqual({ kind: 'unknown', type: 'hologram', id: 'h1', turnId: null });
  });

  it('keeps the entry index in the error path when a history entry is malformed', () => {
    const error = expectParseError(() => parseSessionStartResult({ lastEventId: 1, state: { ...sessionState, history: [assistantMessage, { type: 'effect', id: 'x' }] } }));
    expect(error.context).toContain('history[1]');
  });

  it('parses runtime/read with only the depended-on fields required', () => {
    const parsed = parseRuntimeReadResult({ runtime: { ...runtime, futureField: 1, tools: [{ name: 'read_file', future: true }] }, sessionLog: {}, ready: true });
    expect(parsed.ready).toBe(true);
    expect(parsed.runtime).toMatchObject({
      tools: [{ name: 'read_file' }],
      skills: [],
      mcp: { sources: [] },
      connectors: { connected: 0, total: 0 },
      hooksCount: 0,
      issues: [],
      bypassToolPermissions: false,
      activeModel: { alias: 'm', thinking: 'high' }
    });
    expect(parsed.runtime.stats).toMatchObject({ promptTokens: 10, completionTokens: 5, cachedTokens: 2, modelCalls: 1, inputPricePerMillion: 0.4, outputPricePerMillion: 2, cachedInputPricePerMillion: null });
    for (const key of ['tools', 'skills', 'mcp', 'connectors', 'hooksCount', 'issues', 'stats', 'bypassToolPermissions']) {
      expectParseError(() => parseRuntimeReadResult({ runtime: withoutKey(runtime, key) }), key);
    }
    expect(parseRuntimeReadResult({ runtime: withoutKey(runtime, 'config') }).runtime.activeModel).toBeNull();
  });

  it('surfaces the active agent name and tolerates its absence', () => {
    expect(parseRuntimeReadResult({ runtime: { ...runtime, activeAgent: { name: 'supervisor-review', displayName: 'x', future: 1 } } }).runtime.activeAgent).toEqual({ name: 'supervisor-review' });
    expect(parseRuntimeReadResult({ runtime }).runtime.activeAgent).toBeNull();
    expect(parseRuntimeReadResult({ runtime: { ...runtime, activeAgent: {} } }).runtime.activeAgent).toEqual({ name: null });
    expect(parseRuntimeReadResult({ runtime: { ...runtime, mcp: { sources: [], discoveryErrors: { s: 'bad' } } } }).runtime.mcp).toEqual({ sources: [], discoveryErrors: { s: 'bad' } });
  });

  it('requires token totals in stats and tolerates missing optional counters', () => {
    const minimal = parseRuntimeReadResult({ runtime: { ...runtime, stats: { sessionPromptTokens: 1, sessionCompletionTokens: 2 } } });
    expect(minimal.runtime.stats).toEqual({ promptTokens: 1, completionTokens: 2, cachedTokens: null, modelCalls: null, inputPricePerMillion: null, outputPricePerMillion: null, cachedInputPricePerMillion: null, contextTokens: null });
    expectParseError(() => parseRuntimeReadResult({ runtime: { ...runtime, stats: { sessionPromptTokens: 1 } } }), 'sessionCompletionTokens');
    expectParseError(() => parseRuntimeReadResult({ runtime: { ...runtime, stats: { sessionPromptTokens: -1, sessionCompletionTokens: 2 } } }), 'sessionPromptTokens');
  });

  it('parses the small config and readiness results', () => {
    expect(parseConfigEffectiveReadResult({ config: { enable_subagents: false, tools: {} }, future: 1 })).toEqual({ config: { enable_subagents: false, tools: {} } });
    expectParseError(() => parseConfigEffectiveReadResult({}), 'config');
    expect(parseConfigReadResult({ config: {}, harnessSelectionSource: 'default', hooksCount: 0, skillsCount: 0 })).toEqual({ harnessSelectionSource: 'default', hooksCount: 0, skillsCount: 0 });
    expect(parseConfigReadResult({ harnessSelectionSource: 'env' })).toEqual({ harnessSelectionSource: 'env', hooksCount: null, skillsCount: null });
    expect(parseConfigReadResult({ harnessSelectionSource: null, hooksCount: 0, skillsCount: 0 })).toEqual({ harnessSelectionSource: null, hooksCount: 0, skillsCount: 0 });
    expectParseError(() => parseConfigReadResult({ harnessSelectionSource: 1 }), 'harnessSelectionSource');
    expectParseError(() => parseConfigReadResult({}), 'harnessSelectionSource');
    expect(parseConfigModelWriteResult({ runtime: {}, status: 'applied' })).toEqual({ status: 'applied' });
    expect(parseConfigModelWriteResult({})).toEqual({ status: null });
    expect(parseSessionReadyWaitResult({ ready: true, initDurationMs: 5 })).toEqual({ ready: true });
    expectParseError(() => parseSessionReadyWaitResult({ initDurationMs: 5 }), 'ready');
  });

  it('parses turn/start and rejects a missing turn id or unknown status', () => {
    expect(parseTurnStartResult({ turn: { ...turn, status: 'in_progress' }, lastEventId: 9 })).toMatchObject({ lastEventId: 9, turn: { id: 't1', status: 'in_progress' } });
    expectParseError(() => parseTurnStartResult({ turn: withoutKey(turn, 'id'), lastEventId: 9 }), 'turn.id');
    expectParseError(() => parseTurnStartResult({ turn: { ...turn, status: 'paused' }, lastEventId: 9 }), 'turn.status');
    expectParseError(() => parseTurnStartResult({ turn }), 'lastEventId');
  });

  it('maps turn stop reasons and error codes', () => {
    const parse = (extra: Json) => parseTurnStartResult({ turn: { ...turn, ...extra }, lastEventId: 1 }).turn;
    expect(parse({ stopReason: 'limit' })).toMatchObject({ stopReason: 'limit', rawStopReason: 'limit' });
    expect(parse({ stopReason: 'length' }).stopReason).toBe('length');
    expect(parse({}).stopReason).toBeNull();
    expect(parse({ stopReason: 'something_new' })).toMatchObject({ stopReason: 'unknown', rawStopReason: 'something_new' });
    for (const code of ['invalid_api_key', 'invalid_model', 'context_too_long', 'response_too_long', 'rate_limit', 'refusal', 'backend_error', 'internal_error', 'incomplete_stream', 'compaction_failed']) {
      expect(parse({ status: 'failed', error: { code, message: 'm', details: null } }).error).toEqual({ code, rawCode: code, message: 'm' });
      expect(isTurnErrorCode(code)).toBe(true);
    }
    expect(parse({ status: 'failed', error: { code: 'brand_new', message: 'm' } }).error).toEqual({ code: 'unknown', rawCode: 'brand_new', message: 'm' });
    expect(parse({ status: 'failed', error: { message: 'no code' } }).error).toEqual({ code: 'unknown', rawCode: null, message: 'no code' });
    expect(parse({ status: 'failed', error: 'bare string' }).error).toEqual({ code: 'unknown', rawCode: null, message: null });
    expect(isTurnErrorCode('brand_new')).toBe(false);
    for (const status of ['in_progress', 'completed', 'failed', 'interrupted']) expect(parse({ status }).status).toBe(status);
  });

  it('parses history pages and requires both cursors to be present', () => {
    const page = parseHistoryListResult({ items: [assistantMessage, effectEntry], nextCursor: '5', previousCursor: null, future: 1 });
    expect(page.items.map((entry) => entry.kind)).toEqual(['message', 'effect']);
    expect(page).toMatchObject({ nextCursor: '5', previousCursor: null });
    expectParseError(() => parseHistoryListResult({ items: [], nextCursor: null }), 'previousCursor');
    expectParseError(() => parseHistoryListResult({ items: [], previousCursor: null }), 'nextCursor');
    expectParseError(() => parseHistoryListResult({ nextCursor: null, previousCursor: null }), 'items');
  });
});

describe('history entries', () => {
  it('parses an assistant message and joins its text blocks', () => {
    const entry = parseHistoryEntry({ ...assistantMessage, content: [{ type: 'text', text: 'a' }, { type: 'image', attachment: {} }, { type: 'text', text: 'b' }], future: 1 });
    expect(entry).toMatchObject({ kind: 'message', id: 'm1', turnId: 't1', role: 'assistant', generationStatus: 'completed' });
    expect(entry.kind === 'message' && messageText(entry)).toBe('a\nb');
    expect(entry.kind === 'message' && entry.content[1]).toEqual({ type: 'other' });
  });

  it('drops reasoning content on receipt', () => {
    const entry = parseHistoryEntry({ type: 'reasoning', id: 'r1', turnId: 't1', text: 'private chain of thought', summary: ['also private'] });
    expect(entry).toEqual({ kind: 'reasoning', id: 'r1', turnId: 't1' });
    expect(JSON.stringify(entry)).not.toContain('private');
  });

  it('parses an effect entry with its path field and approval state, ignoring bulky output', () => {
    const entry = parseHistoryEntry(effectEntry);
    expect(entry).toEqual({
      kind: 'effect',
      id: 'c1',
      turnId: 't1',
      detail: { kind: 'file_read', toolName: 'read_file', input: { filePath: '/work/space/a.ts', offset: null, limit: 2000 } },
      state: { status: 'completed', decision: 'execute', approvalType: 'ask', approvalSource: 'user', callbackId: null, errorCode: null }
    });
    expect(JSON.stringify(entry)).not.toContain('big');
    if (entry.kind !== 'effect') throw new Error('expected an effect');
    expect(effectFilePath(entry.detail.input)).toBe('/work/space/a.ts');
  });

  it('reads the error code of a denied effect and tolerates an absent input', () => {
    const entry = parseHistoryEntry({ ...effectEntry, detail: { kind: 'tool', toolName: 'x' }, state: { status: 'failed', decision: 'skip', error: { code: 'tool_denied', message: 'no' } } });
    expect(entry).toMatchObject({ detail: { input: {} }, state: { status: 'failed', decision: 'skip', errorCode: 'tool_denied' } });
  });

  it('exposes only a string filePath', () => {
    expect(effectFilePath({ filePath: '/a' })).toBe('/a');
    expect(effectFilePath({ file_path: '/a' })).toBeNull();
    expect(effectFilePath({ path: '/a' })).toBeNull();
    expect(effectFilePath({ filePath: 7 })).toBeNull();
    expect(effectFilePath({ filePath: '' })).toBeNull();
    expect(effectFilePath({})).toBeNull();
  });

  it('requires the fields a security decision depends on', () => {
    expectParseError(() => parseHistoryEntry(withoutKey(effectEntry, 'detail')), 'detail');
    expectParseError(() => parseHistoryEntry(withoutKey(effectEntry, 'state')), 'state');
    expectParseError(() => parseHistoryEntry({ ...effectEntry, detail: { kind: 'file_read' } }), 'toolName');
    expectParseError(() => parseHistoryEntry({ ...effectEntry, state: {} }), 'status');
    expectParseError(() => parseHistoryEntry(withoutKey(effectEntry, 'id')), 'id');
    expectParseError(() => parseHistoryEntry({ type: 'message', id: 'm', content: [] }), 'role');
    expectParseError(() => parseHistoryEntry({ type: 'message', id: 'm', role: 'assistant' }), 'content');
  });

  it('surfaces unknown kinds, and rejects entries that cannot even be classified', () => {
    expect(parseHistoryEntry({ type: 'hologram', id: 'h', turnId: 't', payload: { note: 'x' } })).toEqual({ kind: 'unknown', type: 'hologram', id: 'h', turnId: 't' });
    expect(parseHistoryEntry({ type: 'hologram' })).toEqual({ kind: 'unknown', type: 'hologram', id: null, turnId: null });
    expectParseError(() => parseHistoryEntry({ id: 'x' }), 'type');
    expectParseError(() => parseHistoryEntry({ type: '' }), 'type');
    expectParseError(() => parseHistoryEntry(null));
    expectParseError(() => parseHistoryEntry([]));
    expectParseError(() => parseHistoryEntry('message'));
  });

  it('parses a callback entry and its approval effect', () => {
    const callback = {
      type: 'callback',
      id: 'cbe-1',
      turnId: 't1',
      relatedEntryId: 'c1',
      callbackId: 'cb-1',
      detail: { kind: 'approval', effect: effectEntry.detail, requiredPermissions: [], choices: ['approve', 'deny'] },
      state: { status: 'open' }
    };
    expect(parseHistoryEntry(callback)).toEqual({
      kind: 'callback',
      id: 'cbe-1',
      turnId: 't1',
      callbackId: 'cb-1',
      relatedEntryId: 'c1',
      detailKind: 'approval',
      effect: { kind: 'file_read', toolName: 'read_file', input: { filePath: '/work/space/a.ts', offset: null, limit: 2000 } },
      status: 'open'
    });
    expectParseError(() => parseHistoryEntry(withoutKey(callback, 'callbackId')), 'callbackId');
  });

  it('leaves the effect null for a generic or malformed approval detail', () => {
    const base = { type: 'callback', id: 'cbe', callbackId: 'cb', detail: { kind: 'approval', effect: { kind: 'tool' } } };
    expect(parseHistoryEntry(base)).toMatchObject({ kind: 'callback', detailKind: 'approval', effect: null });
    expect(parseHistoryEntry({ ...base, detail: { kind: 'user_input' } })).toMatchObject({ detailKind: 'user_input', effect: null });
    expect(parseHistoryEntry({ type: 'callback', id: 'cbe', callbackId: 'cb' })).toMatchObject({ detailKind: null, effect: null, status: null });
  });

  it('parses callback/call params and refuses a non-callback entry', () => {
    const request = parseCallbackCall({ callback: { type: 'callback', id: 'cbe-1', callbackId: 'cb-1', relatedEntryId: 'c1', detail: { kind: 'approval', effect: effectEntry.detail } } });
    expect(request).toMatchObject({ callbackId: 'cb-1', entryId: 'cbe-1', relatedEntryId: 'c1', detailKind: 'approval', effect: { toolName: 'read_file' } });
    expectParseError(() => parseCallbackCall({ callback: assistantMessage }), 'callback.type');
    expectParseError(() => parseCallbackCall({}), 'callback');
  });
});

describe('notification parser', () => {
  const envelope = { eventId: 8, sessionId: 's1', emittedAt: 1760400000001 };

  it('parses history/entryAdded with its entry and the event id', () => {
    const parsed = parseNotification('history/entryAdded', { ...envelope, turnId: 't1', entry: assistantMessage, future: 1 });
    expect(parsed).toMatchObject({ kind: 'history/entryAdded', eventId: 8, sessionId: 's1', turnId: 't1' });
    expect(parsed.kind === 'history/entryAdded' && parsed.entry.kind).toBe('message');
  });

  it('parses history/entryUpdated patches and rejects an unknown operation', () => {
    const patch = [{ op: 'append', path: '/content/0/text', value: 'x' }, { op: 'remove', path: '/a' }, { op: 'test', path: '/b', value: null }];
    expect(parseNotification('history/entryUpdated', { ...envelope, turnId: 't1', entryId: 'm1', patch })).toMatchObject({
      kind: 'history/entryUpdated',
      entryId: 'm1',
      patch: [{ op: 'append', path: '/content/0/text', value: 'x' }, { op: 'remove', path: '/a' }, { op: 'test', path: '/b', value: null }]
    });
    expectParseError(() => parseNotification('history/entryUpdated', { ...envelope, entryId: 'm1', patch: [{ op: 'move', path: '/a' }] }), 'patch');
    expectParseError(() => parseNotification('history/entryUpdated', { ...envelope, patch: [] }), 'entryId');
  });

  it('parses turn lifecycle and stats notifications', () => {
    expect(parseNotification('turn/started', { ...envelope, turn: { ...turn, status: 'in_progress' } })).toMatchObject({ kind: 'turn/started', turn: { status: 'in_progress' } });
    expect(parseNotification('turn/completed', { ...envelope, turn: { ...turn, status: 'completed', stopReason: 'limit' } })).toMatchObject({ kind: 'turn/completed', turn: { stopReason: 'limit' } });
    expectParseError(() => parseNotification('turn/completed', envelope), 'turn');
    expect(parseNotification('session/statsUpdated', { ...envelope, stats, contextWindow: 128000 })).toMatchObject({ kind: 'session/statsUpdated', contextWindow: 128000, stats: { promptTokens: 10 } });
    expect(parseNotification('session/statsUpdated', { ...envelope, stats })).toMatchObject({ contextWindow: null });
    expectParseError(() => parseNotification('session/statsUpdated', { ...envelope, stats: {} }), 'stats');
  });

  it('surfaces handoff notifications with the new session id when present', () => {
    expect(parseNotification('session/compacted', { ...envelope, sessionId: 's2', oldSessionId: 's1' })).toMatchObject({ kind: 'session/compacted', newSessionId: 's2', oldSessionId: 's1' });
    expect(() => parseNotification('session/contextCleared', envelope)).toThrow();
  });

  it('parses unnumbered diagnostics', () => {
    expect(parseNotification('warning', { warning: { message: 'careful', code: 'w1', details: null } })).toEqual({ kind: 'warning', eventId: null, sessionId: null, message: 'careful', code: 'w1' });
    expect(parseNotification('error', { error: { message: 'bad' } })).toMatchObject({ kind: 'error', message: 'bad', code: null });
    expect(parseNotification('warning', {})).toMatchObject({ kind: 'warning', message: null, code: null });
    expect(parseNotification('turn/retrying', { attempt: 2 })).toEqual({ kind: 'turn/retrying', eventId: null, sessionId: null });
  });

  it('surfaces unknown methods as unknown, keeping the event id for the watermark', () => {
    expect(parseNotification('session/futureThing', { ...envelope, detail: 1 })).toEqual({ kind: 'unknown', method: 'session/futureThing', eventId: 8, sessionId: 's1' });
    expect(parseNotification('session/snapshot', { eventId: 9 })).toEqual({ kind: 'unknown', method: 'session/snapshot', eventId: 9, sessionId: null });
    expect(parseNotification('turn/queueUpdated', {})).toMatchObject({ kind: 'unknown', eventId: null });
  });

  it.each([[0], [-1], [1.5], ['7'], [null]])('rejects an invalid event id %s only when it is not null', (eventId) => {
    if (eventId === null) {
      expect(parseNotification('session/futureThing', { eventId }).eventId).toBeNull();
      return;
    }
    expectParseError(() => parseNotification('session/futureThing', { eventId }), 'eventId');
  });

  it('never keeps reasoning text from a streamed reasoning entry', () => {
    const parsed: ServerNotification = parseNotification('history/entryAdded', { ...envelope, turnId: 't1', entry: { type: 'reasoning', id: 'r', text: 'secret thought' } });
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });
});

describe('server error helpers', () => {
  it('extracts bounded issues from invalid_params data and ignores anything else', () => {
    expect(serverErrorIssues({ errorCount: 2, issues: [{ path: ['agentConfig', 'cwd'], message: 'Field required' }, { path: [], message: 'x'.repeat(500) }, 'junk'] })).toEqual([
      { path: 'agentConfig.cwd', message: 'Field required' },
      { path: '', message: 'x'.repeat(200) }
    ]);
    expect(serverErrorIssues(null)).toEqual([]);
    expect(serverErrorIssues({ issues: 'no' })).toEqual([]);
    expect(serverErrorIssues({ issues: Array.from({ length: 80 }, () => ({ path: ['a'], message: 'm' })) })).toHaveLength(50);
  });
});

let workDirectory = '';
const children: ChildProcessWithoutNullStreams[] = [];
const clients: JsonRpcClient[] = [];

beforeEach(() => { workDirectory = mkdtempSync(path.join(tmpdir(), 'app-server-protocol-test-')); });
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  for (const child of children.splice(0)) child.kill('SIGKILL');
  rmSync(workDirectory, { recursive: true, force: true });
});

interface Session {
  client: JsonRpcClient;
  child: ChildProcessWithoutNullStreams;
  notifications: ServerNotification[];
  diagnostics: string[];
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  completion: Promise<ServerNotification & { kind: 'turn/completed' }>;
  approvals: string[];
  call(spec: { method: string; params: Json }): Promise<unknown>;
}

function openFixture(scenario: string, options: Partial<JsonRpcClientOptions> = {}, decide: (path: string | null) => 'approve' | 'deny' = () => 'approve'): Session {
  const base = JSON.parse(readFileSync(path.join(scenarioDirectory, `${scenario}.json`), 'utf8')) as Json;
  const file = path.join(workDirectory, `${scenario}.json`);
  writeFileSync(file, JSON.stringify(base));
  const child = spawn(process.execPath, [fixture, '--scenario', file], {
    env: { PATH: process.env.PATH ?? '', HOME: workDirectory, TMPDIR: workDirectory },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  children.push(child);
  child.stdin.on('error', () => undefined);
  child.stderr.resume();
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { child.once('exit', (code, signal) => resolve({ code, signal })); });
  const notifications: ServerNotification[] = [];
  const diagnostics: string[] = [];
  const approvals: string[] = [];
  let resolveCompletion: (value: ServerNotification & { kind: 'turn/completed' }) => void = () => undefined;
  let rejectCompletion: (error: Error) => void = () => undefined;
  const completion = new Promise<ServerNotification & { kind: 'turn/completed' }>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  completion.catch(() => undefined);
  const client = new JsonRpcClient({
    input: child.stdout,
    output: child.stdin,
    onDiagnostic: (message) => { diagnostics.push(message); },
    onNotification: (method, params) => {
      const parsed = parseNotification(method, params);
      notifications.push(parsed);
      if (parsed.kind === 'turn/completed') resolveCompletion(parsed);
    },
    ...options
  });
  clients.push(client);
  void client.done.then((info) => { if (info.reason === 'fatal') rejectCompletion(info.error ?? new Error('fatal')); });
  client.setRequestHandler('callback/call', (params) => {
    const request = parseCallbackCall(params);
    const target = request.effect ? effectFilePath(request.effect.input) : null;
    approvals.push(`${request.effect?.toolName ?? 'none'}:${target ?? 'none'}`);
    setImmediate(() => {
      const spec = buildCallbackResult(sessionId, request.callbackId, decide(target));
      void client.request(spec.method, spec.params).catch(() => undefined);
    });
    return callbackAcknowledgement(request.callbackId);
  });
  return { client, child, notifications, diagnostics, exited, completion, approvals, call: (spec) => client.request(spec.method, spec.params) };
}

async function handshakeAndStart(session: Session) {
  const init = parseInitializeResult(await session.call(buildInitialize({ name: 'vibe-supervisor', version: '2.0.0' })));
  const initialized = buildInitialized();
  session.client.notify(initialized.method, initialized.params);
  const started = parseSessionStartResult(await session.call(buildSessionStart(sessionConfig)));
  return { init, started };
}

async function readbackAndTurn(session: Session) {
  expect(parseSessionReadyWaitResult(await session.call(buildSessionReadyWait(sessionId))).ready).toBe(true);
  const runtimeBefore = parseRuntimeReadResult(await session.call(buildRuntimeRead(sessionId)));
  parseConfigEffectiveReadResult(await session.call(buildConfigEffectiveRead(sessionId)));
  const configRead = parseConfigReadResult(await session.call(buildConfigRead(sessionId)));
  parseConfigModelWriteResult(await session.call(buildConfigModelWrite(sessionId, { reasoningEffort: 'off' })));
  const runtimeAfter = parseRuntimeReadResult(await session.call(buildRuntimeRead(sessionId)));
  const started = parseTurnStartResult(await session.call(buildTurnStart(sessionId, 'Review the repository.')));
  return { runtimeBefore, runtimeAfter, configRead, turn: started.turn };
}

async function finalAssistantText(session: Session, turnId: string): Promise<string[]> {
  const texts: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = parseHistoryListResult(await session.call(buildSessionHistoryList(sessionId, { limit: 500, direction: 'forward', ...(cursor === undefined ? {} : { cursor }) }, turnId)));
    for (const entry of page.items) if (entry.kind === 'message' && entry.role === 'assistant' && entry.generationStatus === 'completed') texts.push(messageText(entry));
    if (page.nextCursor === null) return texts;
    cursor = page.nextCursor;
  }
}

describe('against the scripted fake vibe-app-server', () => {
  it('drives the whole one-shot sequence with strict builders and tolerant parsers', async () => {
    const session = openFixture('allowed-call');
    const { init, started } = await handshakeAndStart(session);
    expect(init).toMatchObject({ serverName: 'vibe-app-server', serverVersion: '2.26.1' });
    expect(started.state.session).toMatchObject({ id: sessionId, harness: 'unified', cwd: workspace });
    expect(started.state.eventId).toBe(7);
    const { runtimeBefore, runtimeAfter, configRead, turn: startedTurn } = await readbackAndTurn(session);
    expect(runtimeBefore.runtime.tools).toEqual([{ name: 'read_file' }]);
    expect(runtimeBefore.runtime.activeModel?.thinking).toBe('high');
    expect(runtimeAfter.runtime.activeModel?.thinking).toBe('off');
    expect(configRead.harnessSelectionSource).toBe('default');
    expect(startedTurn.status).toBe('in_progress');
    const completed = await session.completion;
    expect(completed.turn).toMatchObject({ id: startedTurn.id, status: 'completed', stopReason: null, error: null });
    expect(session.approvals).toEqual([`file_system.read_file:${workspace}/src/index.ts`]);
    const kinds = session.notifications.map((note) => note.kind);
    expect(kinds).toContain('history/entryUpdated');
    expect(kinds).toContain('session/statsUpdated');
    const eventIds = session.notifications.map((note) => note.eventId).filter((id): id is number => id !== null);
    expect(eventIds[0]).toBe(8);
    expect(eventIds).toEqual([...eventIds].sort((a, b) => a - b));
    expect(await finalAssistantText(session, startedTurn.id)).toEqual(['The review found no issues.']);
    const finalRuntime = parseRuntimeReadResult(await session.call(buildRuntimeRead(sessionId)));
    expect(finalRuntime.runtime.stats).toMatchObject({ promptTokens: 1200, completionTokens: 300, cachedTokens: 200, modelCalls: 2, inputPricePerMillion: 0.4, outputPricePerMillion: 2 });
    const effects = parseHistoryListResult(await session.call(buildSessionHistoryList(sessionId, { limit: 500, direction: 'forward' }))).items.filter((entry): entry is Extract<HistoryEntry, { kind: 'effect' }> => entry.kind === 'effect');
    expect(effects[0]).toMatchObject({ detail: { toolName: 'file_system.read_file' }, state: { decision: 'execute', approvalType: 'ask', approvalSource: 'user' } });
    expect(JSON.stringify(parseHistoryListResult(await session.call(buildSessionHistoryList(sessionId, { limit: 500, direction: 'forward' }))))).not.toContain('private reasoning');
    await session.client.closeInput();
    expect((await session.exited).code).toBe(0);
    expect(readdirSync(workDirectory).filter((entry) => entry.startsWith('vibe-session-logging-disabled-'))).toEqual([]);
  });

  it('sends a denial that the server records as a denied tool result', async () => {
    const session = openFixture('allowed-call', {}, () => 'deny');
    await handshakeAndStart(session);
    await readbackAndTurn(session);
    await session.completion;
    const entries = parseHistoryListResult(await session.call(buildSessionHistoryList(sessionId, { limit: 500, direction: 'forward' }))).items;
    const effect = entries.find((entry) => entry.kind === 'effect');
    expect(effect).toMatchObject({ state: { status: 'failed', decision: 'skip', errorCode: 'tool_denied' } });
  });

  it('interrupts a running turn through turn/interrupt and sees the interrupted status', async () => {
    const session = openFixture('hold');
    await handshakeAndStart(session);
    const { turn } = await readbackAndTurn(session);
    const interrupt = buildTurnInterrupt(sessionId, turn.id);
    expect(await session.call(interrupt)).toMatchObject({ accepted: true });
    expect((await session.completion).turn.status).toBe('interrupted');
  });

  it('reports a stale turn id as a server error with a string code', async () => {
    const session = openFixture('hold');
    await handshakeAndStart(session);
    await readbackAndTurn(session);
    const error = await session.call(buildTurnInterrupt(sessionId, 'turn-9999')).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JsonRpcServerError);
    expect(error).toMatchObject({ code: 'stale_turn' });
  });

  it('parses every extra field the server adds without failing', async () => {
    const session = openFixture('extra-fields');
    const { started } = await handshakeAndStart(session);
    expect(started.state.session.id).toBe(sessionId);
    await readbackAndTurn(session);
    const completed = await session.completion;
    expect(completed.turn.status).toBe('completed');
    expect(await finalAssistantText(session, completed.turn.id)).toEqual(['Done with extras.']);
  });

  it('surfaces an unknown notification as unknown and keeps going', async () => {
    const session = openFixture('unknown-notification');
    await handshakeAndStart(session);
    await readbackAndTurn(session);
    await session.completion;
    const unknown = session.notifications.filter((note) => note.kind === 'unknown');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ method: 'session/futureThing', eventId: expect.any(Number) });
  });

  it('surfaces an unknown history entry kind distinctly, in notifications and in history', async () => {
    const session = openFixture('unknown-entry-kind');
    await handshakeAndStart(session);
    const { turn } = await readbackAndTurn(session);
    await session.completion;
    const added = session.notifications.flatMap((note) => (note.kind === 'history/entryAdded' ? [note.entry] : []));
    expect(added.filter((entry) => entry.kind === 'unknown')).toEqual([{ kind: 'unknown', type: 'hologram', id: expect.any(String), turnId: turn.id }]);
    const page = parseHistoryListResult(await session.call(buildSessionHistoryList(sessionId, { limit: 500, direction: 'forward' }, turn.id)));
    expect(page.items.some((entry) => entry.kind === 'unknown')).toBe(true);
  });

  it('keeps stats usable across several statsUpdated notifications', async () => {
    const session = openFixture('stats-usage');
    await handshakeAndStart(session);
    await readbackAndTurn(session);
    await session.completion;
    const updates = session.notifications.flatMap((note) => (note.kind === 'session/statsUpdated' ? [note.stats] : []));
    expect(updates.map((stat) => stat.promptTokens)).toEqual([1000, 5000]);
    expect(updates[1]).toMatchObject({ completionTokens: 900, cachedTokens: 2000, modelCalls: 3, contextTokens: 5900, cachedInputPricePerMillion: 0.04 });
  });

  it('maps failed, limit, length and interrupted turn outcomes from the wire', async () => {
    const expected: Array<[string, Json]> = [
      ['failed', { status: 'failed', stopReason: null, error: { code: 'backend_error', rawCode: 'backend_error', message: 'The backend failed.' } }],
      ['limit', { status: 'completed', stopReason: 'limit', error: null }],
      ['length', { status: 'completed', stopReason: 'length', error: null }],
      ['interrupted', { status: 'interrupted', stopReason: 'limit', error: null }]
    ];
    for (const [scenario, outcome] of expected) {
      const session = openFixture(scenario);
      await handshakeAndStart(session);
      await readbackAndTurn(session);
      expect((await session.completion).turn).toMatchObject(outcome);
      session.client.dispose();
      session.child.kill('SIGKILL');
    }
  });

  it('turns an unauthorized session/start into a server error carrying its data', async () => {
    const session = openFixture('session-start-unauthorized');
    await session.call(buildInitialize({ name: 'vibe-supervisor', version: '2.0.0' }));
    session.client.notify('initialized', {});
    const error = await session.call(buildSessionStart(sessionConfig)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JsonRpcServerError);
    expect(error).toMatchObject({ code: 'unauthorized', data: { provider: 'mistral', env_key: 'MISTRAL_API_KEY' } });
  });

  it('carries the server invalid_params issues, so the builders cannot drift past the strict models silently', async () => {
    const session = openFixture('allowed-call');
    await session.call(buildInitialize({ name: 'vibe-supervisor', version: '2.0.0' }));
    session.client.notify('initialized', {});
    const error = await session.call({ method: 'session/start', params: { agentConfig: { surprise: true } } }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'invalid_params' });
    expect(serverErrorIssues((error as JsonRpcServerError).data)).toEqual([{ path: 'agentConfig.surprise', message: 'Extra inputs are not permitted' }]);
  });

  it('fails fatally on an oversized frame, on a malformed line, and reports a truncated tail on a crash', async () => {
    const oversized = openFixture('oversized-frame', { maxLineBytes: 1024 * 1024 });
    await handshakeAndStart(oversized);
    await readbackAndTurn(oversized);
    expect((await oversized.client.done)).toMatchObject({ reason: 'fatal', error: { code: 'line_too_long', kind: 'output_limit' } });

    const malformed = openFixture('malformed-line');
    await handshakeAndStart(malformed);
    await readbackAndTurn(malformed);
    expect((await malformed.client.done)).toMatchObject({ reason: 'fatal', error: { code: 'malformed_frame', kind: 'protocol' } });

    const crashed = openFixture('partial-frame-crash');
    await handshakeAndStart(crashed);
    await readbackAndTurn(crashed);
    const info = await crashed.client.done;
    expect(info.reason).toBe('eof');
    expect(info.partialBytes).toBeGreaterThan(0);
    expect((await crashed.exited).code).toBe(1);
  });

  it('stops the server by closing stdin and then sees end of input', async () => {
    const session = openFixture('allowed-call');
    await handshakeAndStart(session);
    await session.client.closeInput();
    const info = await session.client.done;
    expect(info.reason).toBe('eof');
    expect((await session.exited).code).toBe(0);
    await sleep(10);
  });
});
