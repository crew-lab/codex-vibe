import { describe, expect, it } from 'vitest';
import { ApprovalLedger, inputFingerprint } from '../../src/backends/app-server/approvals.js';
import {
  EffectValidator,
  EventProcessor,
  auditHistory,
  auditSessionHistory,
  collectHistory,
  type EventResult,
  type EventSignal
} from '../../src/backends/app-server/events.js';
import { parseHistoryEntry, parseHistoryListResult, type EffectEntry, type HistoryEntry, type HistoryPage, type SessionState } from '../../src/backends/app-server/protocol.js';
import { runScenario } from './support/app-server-driver.js';

type Json = Record<string, unknown>;

const SESSION = 'session-1';
const approved = { decision: 'execute', approvalType: 'ask', approvalSource: 'user' };

function effectWire(id: string, tool: string, state: Json, input: Json = { filePath: 'src/index.ts' }, kind = 'file_read'): Json {
  return { type: 'effect', id, turnId: 't1', detail: { kind, toolName: tool, input }, state };
}

function effect(id: string, tool: string, state: Json, input?: Json): EffectEntry {
  const entry = parseHistoryEntry(effectWire(id, tool, state, input));
  if (entry.kind !== 'effect') throw new Error('not an effect');
  return entry;
}

const completed = (extra: Json = {}): Json => ({ status: 'completed', ...approved, ...extra });
const denied = (extra: Json = {}): Json => ({ status: 'failed', error: { code: 'tool_denied', message: 'denied' }, decision: 'skip', approvalType: 'never', approvalSource: 'never', ...extra });

const defaultInput: Json = { filePath: 'src/index.ts' };

function ledgerWith(...records: Array<[callbackId: string, effectId: string, tool: string, decision: 'approve' | 'deny', input?: Json]>): ApprovalLedger {
  const ledger = new ApprovalLedger();
  for (const [callbackId, relatedEntryId, tool, decision, input] of records) {
    ledger.record({ callbackId, relatedEntryId, sessionId: SESSION, turnId: 't1', tool, path: null, fingerprint: inputFingerprint(tool, input ?? defaultInput), decision, reason: decision === 'deny' ? 'path_secret' : null });
  }
  return ledger;
}

describe('EffectValidator', () => {
  const read = 'file_system.read_file';
  const write = 'file_system.write_file';

  it('treats a running effect as pending and an approved, linked, executed one as executed', () => {
    const validator = new EffectValidator('review', ledgerWith(['cb', 'e1', read, 'approve']));
    expect(validator.inspect(effect('e1', read, { status: 'running' }))).toEqual({ status: 'pending' });
    expect(validator.inspect(effect('e1', read, completed()))).toEqual({ status: 'settled', outcome: 'executed', first: true });
    expect(validator.inspect(effect('e1', read, completed()))).toEqual({ status: 'settled', outcome: 'executed', first: false });
  });

  it('is fatal for an allowed or executed effect without exactly execute/ask/user linked to a handler approval', () => {
    const linked = ledgerWith(['cb', 'e1', read, 'approve']);
    const cases: Array<[string, Json, ApprovalLedger]> = [
      ['config auto-allow', completed({ approvalType: 'always', approvalSource: 'config' }), linked],
      ['bypass allow', completed({ approvalType: 'always', approvalSource: 'bypass' }), linked],
      ['smart allow', completed({ approvalType: 'always', approvalSource: 'smart' }), linked],
      ['null triple', { status: 'completed', decision: null, approvalType: null, approvalSource: null }, linked],
      ['ask but not user', completed({ approvalSource: 'config' }), linked],
      ['no ledger record', completed(), new ApprovalLedger()],
      ['handler denied but it executed', completed(), ledgerWith(['cb', 'e1', read, 'deny'])],
      ['handler decided for another tool', completed(), ledgerWith(['cb', 'e1', 'file_system.search_replace', 'approve'])],
      ['record linked to another entry', completed(), ledgerWith(['cb', 'e2', read, 'approve'])],
      ['entry names another callback', completed({ callbackId: 'other' }), linked],
      ['failed after execute without approval', { status: 'failed', error: { code: 'io_error' }, decision: 'execute', approvalType: 'always', approvalSource: 'config' }, linked]
    ];
    for (const [name, state, ledger] of cases) {
      const inspection = new EffectValidator('review', ledger).inspect(effect('e1', read, state));
      expect(inspection.status, name).toBe('fatal');
      if (inspection.status === 'fatal') expect(inspection.fatal).toMatchObject({ code: 'unapproved_effect', tool: read, entryId: 'e1' });
    }
  });

  it('is fatal when an approved effect is for a tool outside the profile', () => {
    const input = { filePath: 'a.ts', content: '' };
    const inspection = new EffectValidator('review', ledgerWith(['cb', 'e1', write, 'approve', input])).inspect(effect('e1', write, completed(), input));
    expect(inspection).toMatchObject({ status: 'fatal', fatal: { code: 'unapproved_effect', tool: write } });
    expect(new EffectValidator('edit', ledgerWith(['cb', 'e1', write, 'approve', input])).inspect(effect('e1', write, completed(), input))).toMatchObject({ status: 'settled', outcome: 'executed' });
  });

  it('records an off-profile denial as permission_denied_by_policy and keeps going', () => {
    const validator = new EffectValidator('review', new ApprovalLedger());
    expect(validator.inspect(effect('e1', write, denied(), { filePath: 'a.ts', content: '' }))).toEqual({ status: 'settled', outcome: 'permission_denied_by_policy', first: true });
  });

  it('treats a profile-tool denial by Vibe policy before any callback as expected policy, not drift', () => {
    const validator = new EffectValidator('review', new ApprovalLedger());
    expect(validator.inspect(effect('e1', read, denied(), { filePath: '.env' }))).toEqual({ status: 'settled', outcome: 'permission_denied_by_policy', first: true });
  });

  it('records a handler denial separately and accepts a denial without recorded approval metadata', () => {
    const validator = new EffectValidator('review', ledgerWith(['cb', 'e1', read, 'deny']));
    expect(validator.inspect(effect('e1', read, denied({ approvalType: 'ask', approvalSource: 'user' })))).toMatchObject({ outcome: 'permission_denied_by_handler' });
    expect(validator.inspect(effect('e2', read, { status: 'failed', error: { code: 'tool_denied' }, decision: null, approvalType: null, approvalSource: null }))).toMatchObject({ outcome: 'permission_denied_by_policy' });
  });

  it('treats cancelled, skipped and never-gated failed effects as not executed', () => {
    const validator = new EffectValidator('review', new ApprovalLedger());
    expect(validator.inspect(effect('e1', read, { status: 'cancelled', decision: null, approvalType: null, approvalSource: null }))).toMatchObject({ outcome: 'not_executed' });
    expect(validator.inspect(effect('e2', read, { status: 'skipped', decision: 'skip', approvalType: 'never', approvalSource: 'never' }))).toMatchObject({ outcome: 'not_executed' });
    expect(validator.inspect(effect('e3', read, { status: 'failed', error: { code: 'not_found' }, decision: null, approvalType: null, approvalSource: null }))).toMatchObject({ outcome: 'not_executed' });
  });

  it('checks a cancelled or skipped effect that carries an execute decision against the ledger', () => {
    for (const status of ['cancelled', 'skipped']) {
      const state = { status, ...approved };
      const unapproved = new EffectValidator('review', new ApprovalLedger()).inspect(effect('e1', read, state));
      expect(unapproved, status).toMatchObject({ status: 'fatal', fatal: { code: 'unapproved_effect', tool: read, entryId: 'e1' } });
      const offProfile = new EffectValidator('review', ledgerWith(['cb', 'e1', write, 'approve', { filePath: 'a.ts', content: '' }])).inspect(effect('e1', write, state, { filePath: 'a.ts', content: '' }));
      expect(offProfile, status).toMatchObject({ status: 'fatal', fatal: { code: 'unapproved_effect', tool: write } });
      const linked = new EffectValidator('review', ledgerWith(['cb', 'e1', read, 'approve'])).inspect(effect('e1', read, state));
      expect(linked, status).toMatchObject({ status: 'settled', outcome: 'not_executed' });
    }
  });

  it('is fatal for an effect status it does not know', () => {
    expect(new EffectValidator('review', new ApprovalLedger()).inspect(effect('e1', read, { status: 'succeeded' }))).toMatchObject({ status: 'fatal', fatal: { code: 'unknown_effect_status' } });
  });
});

function processor(overrides: Partial<ConstructorParameters<typeof EventProcessor>[0]> = {}, ledger = new ApprovalLedger()): EventProcessor {
  return new EventProcessor({ sessionId: SESSION, watermark: 7, mode: 'review', ledger, ...overrides });
}

const envelope = (eventId: number | null, extra: Json = {}): Json => ({ eventId, sessionId: SESSION, ...extra });
const added = (eventId: number, entry: Json): [string, Json] => ['history/entryAdded', envelope(eventId, { turnId: 't1', entry })];
const updated = (eventId: number, entryId: string, patch: Json[]): [string, Json] => ['history/entryUpdated', envelope(eventId, { turnId: 't1', entryId, patch })];
const send = (target: EventProcessor, [method, params]: [string, Json]): EventResult => target.handle(method, params);
const types = (result: EventResult): string[] => result.signals.map((signal) => signal.type);
const assistant = (id: string, text: string, status = 'completed'): Json => ({ type: 'message', id, turnId: 't1', role: 'assistant', generationStatus: status, content: [{ type: 'text', text }] });
const turn = { id: 't1', status: 'completed', stopReason: null, error: null };

describe('EventProcessor watermark', () => {
  it('ignores events at or below the watermark and accepts the next one', () => {
    const target = processor();
    expect(types(send(target, added(7, assistant('m0', 'old'))))).toEqual([]);
    expect(target.counters.staleEvents).toBe(1);
    expect(target.watermark).toBe(7);
    expect(types(send(target, ['turn/started', envelope(8, { turn: { ...turn, status: 'in_progress' } })]))).toEqual(['turn_started']);
    expect(target.watermark).toBe(8);
    expect(types(send(target, ['turn/started', envelope(8, { turn: { ...turn, status: 'in_progress' } })]))).toEqual([]);
    expect(target.counters.staleEvents).toBe(2);
    expect(target.finalMessage()).toBeNull();
  });

  it('signals a gap, stops applying entries and needs a resync, while turn lifecycle events still arrive', () => {
    const target = processor();
    const gap = send(target, added(9, effectWire('e1', 'file_system.write_file', completed({ approvalType: 'always', approvalSource: 'bypass' }), { filePath: 'a.ts' }, 'file_write')));
    expect(gap.signals).toEqual([{ type: 'watermark_gap', expected: 8, received: 9 }]);
    expect(target.awaitingResync).toBe(true);
    expect(target.fatal).toBeNull();
    expect(types(send(target, added(10, assistant('m1', 'later'))))).toEqual([]);
    expect(target.counters.ignoredWhileAwaitingResync).toBe(1);
    expect(types(send(target, ['turn/completed', envelope(11, { turn })]))).toEqual(['turn_completed']);
  });

  it('replaces state from a session/read snapshot, audits its history and resumes at its watermark', () => {
    const target = processor();
    send(target, added(9, assistant('m1', 'x')));
    const hidden = parseHistoryEntry(effectWire('e1', 'file_system.write_file', completed({ approvalType: 'always', approvalSource: 'bypass' }), { filePath: 'a.ts' }, 'file_write'));
    const state: SessionState = {
      eventId: 12,
      session: { id: SESSION, harness: 'unified', cwd: '/w', model: null, reasoningEffort: null, statusType: 'running' },
      history: [hidden],
      historyBeforeCursor: null,
      turns: [],
      isQuiescent: false
    };
    const result = target.resync(state);
    expect(result.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'unapproved_effect', tool: 'file_system.write_file' } }]);
    expect(target.awaitingResync).toBe(false);
    expect(target.watermark).toBe(12);
    expect(types(send(target, ['turn/completed', envelope(12, { turn })]))).toEqual([]);
    expect(types(send(target, ['turn/completed', envelope(13, { turn })]))).toEqual(['turn_completed']);
  });

  it('lets unnumbered notifications through without moving the watermark', () => {
    const target = processor();
    expect(types(send(target, ['turn/retrying', envelope(null)]))).toEqual(['turn_retrying']);
    expect(send(target, ['warning', envelope(null, { warning: { message: 'sk-abcdefghijklmnop1234 careful', code: 'x' } })]).signals).toMatchObject([{ type: 'warning', code: 'x' }]);
    expect(target.watermark).toBe(7);
  });

  it('advances the watermark only upwards', () => {
    const target = processor();
    target.advanceWatermark(5);
    expect(target.watermark).toBe(7);
    target.advanceWatermark(9);
    expect(target.watermark).toBe(9);
  });
});

describe('EventProcessor notifications and entries', () => {
  it('ignores and counts unknown notification methods, still consuming their event id', () => {
    const target = processor();
    expect(types(send(target, ['session/futureThing', envelope(8, { detail: 1 })]))).toEqual([]);
    expect(types(send(target, ['runtime/updated', envelope(9)]))).toEqual([]);
    expect(types(send(target, ['session/futureThing', { eventId: 'nope' }]))).toEqual([]);
    expect(target.counters).toMatchObject({ unknownNotifications: 3, unknownMethods: ['session/futureThing', 'runtime/updated'] });
    expect(target.watermark).toBe(9);
    expect(types(send(target, ['turn/started', envelope(10, { turn: { ...turn, status: 'in_progress' } })]))).toEqual(['turn_started']);
  });

  it('is fatal for a known notification that does not match its schema', () => {
    const target = processor();
    expect(send(target, ['history/entryAdded', envelope(8, { entry: 7 })]).signals).toMatchObject([{ type: 'fatal', fatal: { code: 'malformed_notification' } }]);
    expect(target.fatal?.code).toBe('malformed_notification');
  });

  it('is fatal for an unknown history entry kind and then ignores later entries', () => {
    const target = processor();
    const result = send(target, added(8, { type: 'hologram', id: 'x1', turnId: 't1' }));
    expect(result.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'unknown_entry_kind', entryId: 'x1' } }]);
    expect(types(send(target, added(9, assistant('m1', 'later'))))).toEqual([]);
    expect(target.finalMessage()).toBeNull();
    expect(target.counters.ignoredWhileAwaitingResync).toBe(1);
  });

  it('drops reasoning entries and keeps no text from them', () => {
    const target = processor();
    send(target, added(8, { type: 'reasoning', id: 'r1', turnId: 't1', text: 'secret thoughts', summary: [] }));
    expect(target.counters.reasoningDropped).toBe(1);
    expect(JSON.stringify(target.finalMessage())).not.toContain('thoughts');
  });

  it('counts callback entries and tracks only whether they are still open', () => {
    const target = processor();
    send(target, added(8, { type: 'callback', id: 'cb1', turnId: 't1', callbackId: 'cb1', relatedEntryId: 'e1', detail: { kind: 'approval', effect: null }, state: { status: 'open' } }));
    expect(target.counters.callbacksSeen).toBe(1);
    expect(target.fatal).toBeNull();
  });

  it('adopts the new session id on compaction and ignores other sessions', () => {
    const target = processor();
    const handoff = target.handle('session/compacted', { eventId: 8, sessionId: 'session-2', oldSessionId: SESSION });
    expect(handoff.signals).toEqual([{ type: 'session_handoff', kind: 'session/compacted', oldSessionId: SESSION, newSessionId: 'session-2', eventId: 8, historicalEffects: 0 }]);
    expect(target.sessionId).toBe('session-2');
    expect(types(target.handle('turn/started', { eventId: 9, sessionId: SESSION, turn: { ...turn, status: 'in_progress' } }))).toEqual([]);
    expect(target.counters.foreignSessionNotifications).toBe(1);
    expect(types(target.handle('turn/started', { eventId: 9, sessionId: 'session-2', turn: { ...turn, status: 'in_progress' } }))).toEqual(['turn_started']);
    expect(target.handle('session/contextCleared', { eventId: 10, sessionId: 'session-3', oldSessionId: 'session-2' }).signals).toMatchObject([{ type: 'session_handoff', kind: 'session/contextCleared', newSessionId: 'session-3' }]);
  });

  it('emits stats, retrying and server error signals', () => {
    const target = processor();
    const stats = { sessionPromptTokens: 5, sessionCompletionTokens: 2 };
    expect(send(target, ['session/statsUpdated', envelope(8, { stats, contextWindow: 1000 })]).signals).toMatchObject([{ type: 'stats', contextWindow: 1000, stats: { promptTokens: 5, completionTokens: 2 } }]);
    expect(send(target, ['error', envelope(null, { error: { message: 'bad', code: 'internal_error' } })]).signals).toEqual([{ type: 'server_error', message: 'bad', code: 'internal_error' }]);
  });
});

describe('EventProcessor effects and patches', () => {
  const read = 'file_system.read_file';

  it('settles an approved effect when its terminal state arrives by patch and links it to the ledger', () => {
    const target = processor({}, ledgerWith(['cb', 'e1', read, 'approve']));
    expect(types(send(target, added(8, effectWire('e1', read, { status: 'running', outputText: '' }))))).toEqual([]);
    const result = send(target, updated(9, 'e1', [{ op: 'replace', path: '/generationStatus', value: 'completed' }, { op: 'replace', path: '/state', value: { ...completed(), output: { content: 'x'.repeat(10000) }, outputText: 'y'.repeat(10000), durationMs: 3 } }]));
    expect(result.signals).toEqual([{ type: 'tool_effect', entryId: 'e1', tool: read, outcome: 'executed', path: 'src/index.ts' }]);
    expect(target.fatal).toBeNull();
    expect(target.counters.skippedPatchOps).toBe(1);
    expect(target.effectRecords()).toEqual([{ entryId: 'e1', tool: read, outcome: 'executed', path: 'src/index.ts' }]);
  });

  it('is fatal when a terminal patch allows the call without a handler approval', () => {
    const target = processor();
    send(target, added(8, effectWire('e1', read, { status: 'running' })));
    const result = send(target, updated(9, 'e1', [{ op: 'replace', path: '/state', value: completed({ approvalType: 'always', approvalSource: 'config' }) }]));
    expect(result.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'unapproved_effect', tool: read, entryId: 'e1' } }]);
  });

  it('is fatal for an auto-allowed effect added already completed, such as a scratchpad path', () => {
    const result = send(processor(), added(8, effectWire('e1', 'file_system.write_file', completed({ approvalType: 'always', approvalSource: 'config' }), { filePath: '/scratch/a.txt', content: '' }, 'file_write')));
    expect(result.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'unapproved_effect' } }]);
  });

  it('records a policy denial of an off-profile call and does not stop', () => {
    const target = processor();
    const result = send(target, added(8, effectWire('e1', 'file_system.write_file', denied(), { filePath: 'a.ts', content: 'oops' }, 'file_write')));
    expect(result.signals).toEqual([{ type: 'tool_effect', entryId: 'e1', tool: 'file_system.write_file', outcome: 'permission_denied_by_policy', path: 'a.ts' }]);
    expect(target.fatal).toBeNull();
  });

  it('applies add, append, replace, remove and test operations to a retained message', () => {
    const target = processor();
    send(target, added(8, assistant('m1', 'Hel', 'in_progress')));
    expect(target.finalMessage()).toMatchObject({ text: 'Hel', complete: false });
    send(target, updated(9, 'm1', [{ op: 'append', path: '/content/0/text', value: 'lo' }, { op: 'test', path: '/content/0/text', value: 'Hello' }]));
    send(target, updated(10, 'm1', [{ op: 'add', path: '/content/-', value: { type: 'text', text: ' world' } }, { op: 'replace', path: '/generationStatus', value: 'completed' }, { op: 'replace', path: '/updatedAt', value: 99 }]));
    expect(target.finalMessage()).toEqual({ entryId: 'm1', text: 'Hello\n world', complete: true, truncated: false });
    send(target, updated(11, 'm1', [{ op: 'remove', path: '/content/1' }]));
    expect(target.finalMessage()?.text).toBe('Hello');
    expect(target.fatal).toBeNull();
  });

  it('is fatal for an invalid, unsafe, oversized or failing patch', () => {
    const cases: Array<[string, Json[]]> = [
      ['pointer without slash', [{ op: 'replace', path: 'state', value: 1 }]],
      ['prototype pollution', [{ op: 'replace', path: '/state/__proto__/polluted', value: 1 }]],
      ['missing parent', [{ op: 'replace', path: '/content/5/text', value: 'x' }]],
      ['failing test', [{ op: 'test', path: '/content/0/text', value: 'nope' }]],
      ['array index out of range', [{ op: 'remove', path: '/content/9' }]],
      ['append to a non-string', [{ op: 'append', path: '/content/0', value: 'x' }]],
      ['kind change', [{ op: 'replace', path: '/type', value: 'reasoning' }]],
      ['too deep', [{ op: 'replace', path: `/content${'/0'.repeat(20)}`, value: 'x' }]]
    ];
    for (const [name, patch] of cases) {
      const target = processor();
      send(target, added(8, assistant('m1', 'Hi')));
      const result = send(target, updated(9, 'm1', patch));
      expect(result.signals, name).toMatchObject([{ type: 'fatal', fatal: { code: 'patch_failed', entryId: 'm1' } }]);
    }
    const bounded = processor({ maxPatchOps: 2 });
    send(bounded, added(8, assistant('m1', 'Hi')));
    expect(send(bounded, updated(9, 'm1', Array.from({ length: 3 }, () => ({ op: 'test', path: '/role', value: 'assistant' })))).signals).toMatchObject([{ type: 'fatal', fatal: { code: 'patch_failed' } }]);
    expect((Object.prototype as Json).polluted).toBeUndefined();
  });

  it('counts updates for entries it never retained, such as user messages and reasoning', () => {
    const target = processor();
    send(target, added(8, { type: 'message', id: 'u1', turnId: 't1', role: 'user', generationStatus: 'completed', content: [{ type: 'text', text: 'task' }] }));
    send(target, updated(9, 'u1', [{ op: 'replace', path: '/generationStatus', value: 'completed' }]));
    expect(target.counters.updatesToUnretainedEntries).toBe(1);
    expect(target.fatal).toBeNull();
  });

  it('bounds retained assistant messages and truncates long text', () => {
    const target = processor({ maxRetainedMessages: 2, maxMessageChars: 10 });
    send(target, added(8, assistant('m1', 'one')));
    send(target, added(9, assistant('m2', 'two')));
    send(target, added(10, assistant('m3', 'x'.repeat(50))));
    expect(target.finalMessage()).toMatchObject({ entryId: 'm3', truncated: false });
    expect(target.finalMessage()?.text).toHaveLength(10);
  });

  it('is fatal when too many effect entries would be retained', () => {
    const target = processor({ maxRetainedEffects: 1 }, ledgerWith(['c1', 'e1', read, 'approve']));
    send(target, added(8, effectWire('e1', read, { status: 'running' })));
    expect(send(target, added(9, effectWire('e2', read, { status: 'running' }))).signals).toMatchObject([{ type: 'fatal', fatal: { code: 'retention_exceeded' } }]);
  });

  it('redacts secrets in signal paths and the final message', () => {
    const secret = 'sk-live-0123456789abcdef';
    const secretInput = { filePath: `src/${secret}.ts` };
    const target = processor({ secrets: [secret] }, ledgerWith(['cb', 'e1', read, 'approve', secretInput]));
    send(target, added(8, effectWire('e1', read, completed(), secretInput)));
    send(target, added(9, assistant('m1', `key is ${secret}`)));
    expect(JSON.stringify(target.effectRecords())).not.toContain(secret);
    expect(target.finalMessage()?.text).not.toContain(secret);
  });

  it('seeds retained entries from the initial history', () => {
    const target = processor();
    const initial: HistoryEntry[] = [parseHistoryEntry(assistant('m0', 'earlier')), parseHistoryEntry({ type: 'reasoning', id: 'r0', turnId: null })];
    expect(target.seed(initial).signals).toEqual([]);
    expect(target.finalMessage()?.text).toBe('earlier');
    expect(target.counters.reasoningDropped).toBe(1);
  });
});

describe('history audit', () => {
  const read = 'file_system.read_file';
  const entries = (...wires: Json[]): HistoryEntry[] => wires.map((wire) => parseHistoryEntry(wire));

  it('runs the same validator and returns the effects, pending effects and the final assistant message', () => {
    const audit = auditHistory(entries(
      { type: 'reasoning', id: 'r1', turnId: 't1' },
      assistant('m1', 'first'),
      effectWire('e1', read, completed()),
      effectWire('e2', 'file_system.write_file', denied(), { filePath: 'a.ts' }, 'file_write'),
      effectWire('e3', read, { status: 'running' }),
      assistant('m2', 'final answer'),
      assistant('m3', 'partial', 'in_progress')
    ), { mode: 'review', ledger: ledgerWith(['cb', 'e1', read, 'approve']), turnId: 't1' });
    expect(audit.fatal).toBeNull();
    expect(audit.reasoningDropped).toBe(1);
    expect(audit.effects).toEqual([
      { entryId: 'e1', tool: read, outcome: 'executed', path: 'src/index.ts' },
      { entryId: 'e2', tool: 'file_system.write_file', outcome: 'permission_denied_by_policy', path: 'a.ts' }
    ]);
    expect(audit.pendingEffects).toEqual(['e3']);
    expect(audit.finalMessage).toEqual({ entryId: 'm2', text: 'final answer', complete: true, truncated: false });
  });

  it('is fatal for a hidden effect or an unknown kind anywhere in the history', () => {
    const hidden = auditHistory(entries(assistant('m1', 'x'), effectWire('e9', read, completed({ approvalType: 'always', approvalSource: 'config' }))), { mode: 'review', ledger: new ApprovalLedger() });
    expect(hidden.fatal).toMatchObject({ code: 'unapproved_effect', entryId: 'e9' });
    const unknown = auditHistory(entries({ type: 'hologram', id: 'h1' }), { mode: 'review', ledger: new ApprovalLedger() });
    expect(unknown.fatal).toMatchObject({ code: 'unknown_entry_kind', entryId: 'h1' });
  });

  it('falls back to the last non-empty assistant message when none is complete and ignores other turns', () => {
    const audit = auditHistory(entries(assistant('m1', 'other turn'), { ...assistant('m2', 'partial', 'in_progress'), turnId: 't2' }), { mode: 'review', ledger: new ApprovalLedger(), turnId: 't2' });
    expect(audit.finalMessage).toMatchObject({ entryId: 'm2', complete: false });
    expect(auditHistory(entries(assistant('m1', '   ')), { mode: 'review', ledger: new ApprovalLedger() }).finalMessage).toBeNull();
  });
});

describe('history paging', () => {
  const ids = Array.from({ length: 7 }, (_, index) => `m${index + 1}`);
  const all = ids.map((id) => parseHistoryEntry(assistant(id, id)));

  function backendPager(items: HistoryEntry[], calls: Array<Json>): (page: { limit: number; direction?: 'forward' | 'backward'; cursor?: string }) => Promise<HistoryPage> {
    return async (page) => {
      calls.push({ ...page });
      const cursorIndex = page.cursor === undefined ? items.length : items.findIndex((entry) => 'id' in entry && entry.id === page.cursor);
      const slice = items.slice(Math.max(0, cursorIndex - page.limit), cursorIndex);
      const first = slice[0];
      return parseHistoryListResult({
        items: slice.map((entry) => ({ ...assistant((entry as { id: string }).id, 'x') })),
        nextCursor: first !== undefined && items.indexOf(first) > 0 ? (first as { id: string }).id : null,
        previousCursor: null
      });
    };
  }

  it('pages backward by entry id cursor and returns the entries oldest first', async () => {
    const calls: Json[] = [];
    const result = await collectHistory(backendPager(all, calls), { pageLimit: 3 });
    expect(result.ok && result.entries.map((entry) => (entry as { id: string }).id)).toEqual(ids);
    expect(calls).toEqual([{ limit: 3, direction: 'backward' }, { limit: 3, direction: 'backward', cursor: 'm5' }, { limit: 3, direction: 'backward', cursor: 'm2' }]);
  });

  it('defaults to a 500 entry page and rejects out-of-range limits', async () => {
    const calls: Json[] = [];
    await collectHistory(backendPager(all, calls));
    expect(calls).toEqual([{ limit: 500, direction: 'backward' }]);
    await expect(collectHistory(backendPager(all, []), { pageLimit: 501 })).rejects.toThrow(RangeError);
  });

  it('is fatal when paging stalls, loops or never ends', async () => {
    const page = (items: Json[], nextCursor: string | null): HistoryPage => parseHistoryListResult({ items, nextCursor, previousCursor: null });
    expect(await collectHistory(async () => page([], 'c1'))).toMatchObject({ ok: false, fatal: { code: 'history_paging_failed' } });
    expect(await collectHistory(async () => page([assistant('m1', 'x')], 'c1'))).toMatchObject({ ok: false, fatal: { code: 'history_paging_failed' } });
    let counter = 0;
    expect(await collectHistory(async () => page([assistant('m1', 'x')], `c${(counter += 1)}`), { maxPages: 3 })).toMatchObject({ ok: false, fatal: { code: 'history_paging_failed' } });
  });

  it('audits a whole paged history and reports a paging failure as fatal', async () => {
    const hidden = parseHistoryListResult({ items: [effectWire('e1', 'file_system.read_file', completed({ approvalType: 'always', approvalSource: 'config' }))], nextCursor: null, previousCursor: null });
    expect((await auditSessionHistory(async () => hidden, { mode: 'review', ledger: new ApprovalLedger() })).fatal).toMatchObject({ code: 'unapproved_effect' });
    const failed = await auditSessionHistory(async () => parseHistoryListResult({ items: [], nextCursor: 'c', previousCursor: null }), { mode: 'review', ledger: new ApprovalLedger() });
    expect(failed.fatal).toMatchObject({ code: 'history_paging_failed' });
  });
});

describe('against the scripted fake vibe-app-server', () => {
  const effects = (signals: EventSignal[]) => signals.flatMap((signal) => (signal.type === 'tool_effect' ? [`${signal.tool}:${signal.outcome}`] : []));

  it('records an auto-allowed in-profile call as an unapproved effect and interrupts', async () => {
    const run = await runScenario({ scenario: 'auto-allowed-in-profile' });
    expect(run.processor.fatal).toMatchObject({ code: 'unapproved_effect', tool: 'file_system.read_file' });
    expect(run.interrupts).toBe(1);
    expect(run.outcome).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR', details: { reason: 'unapproved_effect', tool: 'file_system.read_file' } } });
  });

  it('sends turn/interrupt when the turn is still running and ends the turn as interrupted', async () => {
    const run = await runScenario({
      scenario: { name: 'auto-allowed-then-hold', steps: [{ op: 'call', tool: 'file_system.read_file', mode: 'auto', source: 'config', input: { filePath: '${cwd}/src/index.ts', offset: null, limit: 2000 } }, { op: 'hold' }] }
    });
    expect(run.fixtureLog.filter((line) => line.name === 'interrupt')).toHaveLength(1);
    expect(run.turn).toMatchObject({ status: 'interrupted' });
    expect(run.outcome).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR' } });
  });

  it('fails an off-profile write that executed under bypass, and the history audit agrees', async () => {
    const run = await runScenario({ scenario: 'off-profile-executed' });
    expect(run.processor.fatal).toMatchObject({ code: 'unapproved_effect', tool: 'file_system.write_file' });
    expect(run.audit.fatal).toMatchObject({ code: 'unapproved_effect' });
    expect(run.interrupts).toBe(1);
    expect(run.outcome.error?.code).toBe('VSUP_BACKEND_ERROR');
  });

  it('records an off-profile write denied by policy and lets the run complete', async () => {
    const run = await runScenario({ scenario: 'off-profile-denied' });
    expect(effects(run.signals)).toEqual(['file_system.write_file:permission_denied_by_policy']);
    expect(run.processor.fatal).toBeNull();
    expect(run.audit.fatal).toBeNull();
    expect(run.interrupts).toBe(0);
    expect(run.outcome).toMatchObject({ state: 'completed', stopReason: 'end_turn' });
    expect(run.audit.finalMessage?.text).toBe('The write was refused.');
  });

  it('fails a write whose result carried no approval metadata', async () => {
    const run = await runScenario({ scenario: 'unrecorded-approval-meta' });
    expect(run.processor.fatal).toMatchObject({ code: 'unapproved_effect', tool: 'file_system.write_file' });
    expect(run.outcome.state).toBe('failed');
  });

  it('detects a hidden entry as a watermark gap, interrupts, and finds the write by re-reading the session', async () => {
    const run = await runScenario({ scenario: 'watermark-gap' });
    expect(run.signals.some((signal) => signal.type === 'watermark_gap')).toBe(true);
    expect(run.resynced).toBe(true);
    expect(run.interrupts).toBe(1);
    expect(run.processor.fatal).toMatchObject({ code: 'unapproved_effect', tool: 'file_system.write_file' });
    expect(run.outcome).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR' } });
  });

  it('ignores a stale event re-sent at the watermark', async () => {
    const run = await runScenario({ scenario: 'stale-event' });
    expect(run.processor.counters.staleEvents).toBe(1);
    expect(run.processor.fatal).toBeNull();
    expect(run.outcome.state).toBe('completed');
    expect(run.audit.finalMessage?.text).toBe('Second.');
  });

  it('fails closed on an unknown history entry kind', async () => {
    const run = await runScenario({ scenario: 'unknown-entry-kind' });
    expect(run.processor.fatal).toMatchObject({ code: 'unknown_entry_kind' });
    expect(run.interrupts).toBe(1);
    expect(run.outcome).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR', details: { reason: 'unknown_entry_kind' } } });
  });

  it('ignores and counts an unknown notification method without a gap', async () => {
    const run = await runScenario({ scenario: 'unknown-notification' });
    expect(run.processor.counters).toMatchObject({ unknownNotifications: 1, unknownMethods: ['session/futureThing'] });
    expect(run.signals.some((signal) => signal.type === 'watermark_gap')).toBe(false);
    expect(run.processor.fatal).toBeNull();
    expect(run.outcome.state).toBe('completed');
  });

  it('applies streamed message patches and keeps the final answer', async () => {
    const run = await runScenario({ scenario: 'allowed-call' });
    expect(run.processor.finalMessage()).toMatchObject({ text: 'The review found no issues.', complete: true });
    expect(run.audit.finalMessage?.text).toBe('The review found no issues.');
    expect(run.processor.counters.skippedPatchOps).toBeGreaterThan(0);
  });
});

describe('effect to callback fingerprint linking', () => {
  const read = 'file_system.read_file';
  const write = 'file_system.write_file';
  const edit = 'file_system.search_replace';
  const editInput = (newString: string, extra: Json = {}): Json => ({ filePath: 'src/a.ts', changes: [{ oldString: 'a', newString, replaceAll: false }], ...extra });
  const inspect = (ledger: ApprovalLedger, tool: string, input: Json, state: Json = completed(), id = 'e1', mode: 'review' | 'edit' = 'edit') => new EffectValidator(mode, ledger).inspect(effect(id, tool, state, input));
  const unapproved = (inspection: ReturnType<typeof inspect>): string => (inspection.status === 'fatal' ? inspection.fatal.message : inspection.status);

  it('accepts an effect whose input equals the approved input', () => {
    expect(inspect(ledgerWith(['cb', 'e1', edit, 'approve', editInput('b')]), edit, editInput('b'))).toMatchObject({ status: 'settled', outcome: 'executed' });
  });

  it('is fatal when the path, the written content or an edit change differs from what was approved', () => {
    const cases: Array<[string, string, Json, Json]> = [
      ['read path', read, { filePath: 'src/index.ts' }, { filePath: 'src/other.ts' }],
      ['write path', write, { filePath: 'a.ts', content: 'x' }, { filePath: 'b.ts', content: 'x' }],
      ['write content', write, { filePath: 'a.ts', content: 'x' }, { filePath: 'a.ts', content: 'y' }],
      ['edit replacement', edit, editInput('b'), editInput('c')],
      ['edit replaceAll', edit, editInput('b'), { filePath: 'src/a.ts', changes: [{ oldString: 'a', newString: 'b', replaceAll: true }] }],
      ['edit extra change', edit, editInput('b'), { filePath: 'src/a.ts', changes: [{ oldString: 'a', newString: 'b' }, { oldString: 'c', newString: 'd' }] }]
    ];
    for (const [name, tool, approvedInput, executedInput] of cases) {
      const inspection = inspect(ledgerWith(['cb', 'e1', tool, 'approve', approvedInput]), tool, executedInput);
      expect(inspection.status, name).toBe('fatal');
      expect(unapproved(inspection), name).toContain('the executed input differs from the approved input');
      expect(inspection, name).toMatchObject({ fatal: { code: 'unapproved_effect', entryId: 'e1' } });
    }
  });

  it('treats the single-change edit form like a one element change list and ignores read ranges', () => {
    const approved = { filePath: 'src/a.ts', oldString: 'a', newString: 'b', replaceAll: false };
    expect(inspect(ledgerWith(['cb', 'e1', edit, 'approve', approved]), edit, editInput('b'))).toMatchObject({ status: 'settled' });
    expect(inspect(ledgerWith(['cb', 'e1', read, 'approve', { filePath: 'src/index.ts', offset: null, limit: 2000 }]), read, { filePath: 'src/index.ts', offset: 5, limit: 10 })).toMatchObject({ status: 'settled' });
  });

  it('is fatal when the approval was given for a different turn or in a session outside the run', () => {
    const ledger = new ApprovalLedger();
    ledger.record({ callbackId: 'cb', relatedEntryId: 'e1', sessionId: 'session-9', turnId: 't9', tool: read, path: null, fingerprint: inputFingerprint(read, defaultInput), decision: 'approve', reason: null });
    const inspection = new EffectValidator('review', ledger).inspect(effect('e1', read, completed()), { fingerprint: inputFingerprint(read, defaultInput), sessionIds: new Set([SESSION]) });
    expect(unapproved(inspection)).toContain('the approval belongs to a different turn');
    expect(unapproved(inspection)).toContain('the approval belongs to a different session');
  });

  it('is fatal when an approval whose record has no fingerprint is used, or the effect input cannot be fingerprinted', () => {
    const ledger = new ApprovalLedger();
    ledger.record({ callbackId: 'cb', relatedEntryId: 'e1', sessionId: SESSION, turnId: 't1', tool: read, path: null, fingerprint: null, decision: 'approve', reason: null });
    expect(unapproved(new EffectValidator('review', ledger).inspect(effect('e1', read, completed())))).toContain('differs');
    expect(unapproved(new EffectValidator('review', ledgerWith(['cb', 'e1', read, 'approve'])).inspect(effect('e1', read, completed()), { fingerprint: null }))).toContain('differs');
  });

  it('is fatal when a second effect names the callback that was approved for the first', () => {
    const ledger = ledgerWith(['cb', 'e1', read, 'approve']);
    const validator = new EffectValidator('review', ledger);
    expect(validator.inspect(effect('e1', read, completed()))).toMatchObject({ status: 'settled', outcome: 'executed' });
    const second = validator.inspect(effect('e2', read, completed({ callbackId: 'cb' })));
    expect(second).toMatchObject({ status: 'fatal', fatal: { code: 'unapproved_effect', entryId: 'e2' } });
    expect(unapproved(second)).toContain('reuses an approval that belongs to another effect');
  });

  it('is fatal when the input of a retained effect is patched after approval, and tolerates display-only patches', () => {
    const approvedInput = editInput('b');
    const target = processor({ mode: 'edit' }, ledgerWith(['cb', 'e1', edit, 'approve', approvedInput]));
    send(target, added(8, effectWire('e1', edit, { status: 'running' }, approvedInput, 'file_edit')));
    expect(types(send(target, updated(9, 'e1', [{ op: 'replace', path: '/detail/display/summary', value: 'Editing' }])))).toEqual([]);
    const result = send(target, updated(10, 'e1', [{ op: 'replace', path: '/detail/input/changes/0/newString', value: 'evil' }, { op: 'replace', path: '/state', value: completed() }]));
    expect(result.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'unapproved_effect', entryId: 'e1' } }]);
  });

  it('is fatal when an effect is re-added with a different input after it was approved', () => {
    const target = processor({ mode: 'edit' }, ledgerWith(['cb', 'e1', edit, 'approve', editInput('b')]));
    send(target, added(8, effectWire('e1', edit, { status: 'running' }, editInput('b'), 'file_edit')));
    const result = send(target, added(9, effectWire('e1', edit, completed(), editInput('c'), 'file_edit')));
    expect(result.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'unapproved_effect' } }]);
  });

  it('settles an approved edit whose input arrives complete in the terminal entry', () => {
    const target = processor({ mode: 'edit' }, ledgerWith(['cb', 'e1', edit, 'approve', editInput('b')]));
    send(target, added(8, effectWire('e1', edit, { status: 'running' }, editInput('b'), 'file_edit')));
    const result = send(target, updated(9, 'e1', [{ op: 'replace', path: '/state', value: completed() }]));
    expect(result.signals).toMatchObject([{ type: 'tool_effect', outcome: 'executed', tool: edit }]);
  });
});

describe('session handoff', () => {
  const read = 'file_system.read_file';
  const NEXT = 'session-2';
  const handoffParams = (eventId: number | null, overrides: Json = {}): Json => ({ eventId, sessionId: NEXT, oldSessionId: SESSION, ...overrides });
  const nextEnvelope = (eventId: number, extra: Json = {}): Json => ({ eventId, sessionId: NEXT, ...extra });
  const callbackWire = (id: string, status: string, relatedEntryId = 'e1'): Json => ({ type: 'callback', id, turnId: 't1', callbackId: id, relatedEntryId, detail: { kind: 'approval', effect: null }, state: { status } });
  const settledRead = (target: EventProcessor): void => {
    send(target, added(8, effectWire('e1', read, { status: 'running' })));
    send(target, updated(9, 'e1', [{ op: 'replace', path: '/state', value: completed() }]));
  };
  const asHistory = (...wires: Json[]): HistoryPage => parseHistoryListResult({ items: wires, nextCursor: null, previousCursor: null });

  it('adopts the new session and its watermark, and remembers what was settled before it', () => {
    const target = processor({}, ledgerWith(['cb', 'e1', read, 'approve']));
    settledRead(target);
    const result = target.handle('session/compacted', handoffParams(3));
    expect(result.signals).toEqual([{ type: 'session_handoff', kind: 'session/compacted', oldSessionId: SESSION, newSessionId: NEXT, eventId: 3, historicalEffects: 1 }]);
    expect(target.sessionId).toBe(NEXT);
    expect(target.sessionIds).toEqual([SESSION, NEXT]);
    expect(target.watermark).toBe(3);
    expect(target.counters.handoffs).toBe(1);
    expect(target.historicalEffects.get('e1')?.record).toEqual({ entryId: 'e1', tool: read, outcome: 'executed', path: 'src/index.ts' });
    expect(target.effectRecords()).toEqual([{ entryId: 'e1', tool: read, outcome: 'executed', path: 'src/index.ts' }]);
    expect(types(send(target, ['turn/started', nextEnvelope(4, { turn: { ...turn, status: 'in_progress' } })]))).toEqual(['turn_started']);
  });

  it('refuses a handoff while an effect has not finished', () => {
    const target = processor({}, ledgerWith(['cb', 'e1', read, 'approve']));
    send(target, added(8, effectWire('e1', read, { status: 'running' })));
    const result = target.handle('session/contextCleared', handoffParams(3));
    expect(result.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'session_handoff_unsafe' } }]);
    expect(target.fatal?.message).toContain('1 effect(s) have not finished');
    expect(target.sessionId).toBe(SESSION);
  });

  it('refuses a handoff while a callback entry is open and accepts it once the entry was answered', () => {
    const target = processor();
    send(target, added(8, callbackWire('cb1', 'open')));
    const refused = processor();
    send(refused, added(8, callbackWire('cb1', 'open')));
    expect(refused.handle('session/compacted', handoffParams(3)).signals).toMatchObject([{ type: 'fatal', fatal: { code: 'session_handoff_unsafe' } }]);
    expect(refused.fatal?.message).toContain('a callback is still open');
    send(target, updated(9, 'cb1', [{ op: 'replace', path: '/generationStatus', value: 'completed' }, { op: 'replace', path: '/state', value: { status: 'answered', output: {} } }]));
    expect(target.handle('session/compacted', handoffParams(3)).signals).toMatchObject([{ type: 'session_handoff' }]);
  });

  it('closes a callback entry on a status patch and keeps it open for an unrelated patch', () => {
    const target = processor();
    send(target, added(8, callbackWire('cb1', 'open')));
    send(target, updated(9, 'cb1', [{ op: 'replace', path: '/updatedAt', value: 5 }]));
    expect(target.handle('session/compacted', handoffParams(3)).signals).toMatchObject([{ type: 'fatal' }]);
    const closed = processor();
    send(closed, added(8, callbackWire('cb1', 'open')));
    send(closed, updated(9, 'cb1', [{ op: 'replace', path: '/state/status', value: 'cancelled' }]));
    expect(closed.handle('session/compacted', handoffParams(3)).signals).toMatchObject([{ type: 'session_handoff' }]);
  });

  it('refuses a handoff while the handler still has a callback it has not answered', () => {
    const ledger = new ApprovalLedger();
    ledger.open('cb-open');
    const target = processor({}, ledger);
    expect(target.handle('session/compacted', handoffParams(3)).signals).toMatchObject([{ type: 'fatal', fatal: { code: 'session_handoff_unsafe' } }]);
    ledger.close('cb-open');
    expect(processor({}, ledger).handle('session/compacted', handoffParams(3)).signals).toMatchObject([{ type: 'session_handoff' }]);
  });

  it('refuses a handoff that does not replace the active session, has no watermark or arrives during a gap', () => {
    const cases: Array<[string, Json]> = [
      ['foreign old session', handoffParams(3, { oldSessionId: 'session-9' })],
      ['same session id', handoffParams(3, { sessionId: SESSION })],
      ['no watermark', handoffParams(null)]
    ];
    for (const [name, params] of cases) {
      const target = processor();
      expect(target.handle('session/compacted', params).signals, name).toMatchObject([{ type: 'fatal', fatal: { code: 'session_handoff_unsafe' } }]);
      expect(target.sessionId, name).toBe(SESSION);
    }
    const gapped = processor();
    send(gapped, added(12, assistant('m1', 'x')));
    expect(gapped.awaitingResync).toBe(true);
    expect(gapped.handle('session/compacted', handoffParams(3)).signals).toMatchObject([{ type: 'fatal', fatal: { code: 'session_handoff_unsafe' } }]);
  });

  it('accepts the replayed history of the new session without re-emitting or re-validating effects it already settled', async () => {
    const target = processor({}, ledgerWith(['cb', 'e1', read, 'approve']));
    settledRead(target);
    target.handle('session/compacted', handoffParams(3));
    const adopted = await target.adoptHistory(async () => asHistory(effectWire('e1', read, completed()), assistant('m1', 'summary')));
    expect(adopted.signals).toEqual([]);
    expect(target.fatal).toBeNull();
    expect(target.finalMessage()?.text).toBe('summary');
  });

  it('is fatal when a historical effect comes back changed, and when a settled effect appears that was never approved', async () => {
    const changed = processor({}, ledgerWith(['cb', 'e1', read, 'approve']));
    settledRead(changed);
    changed.handle('session/compacted', handoffParams(3));
    const adoptedChanged = await changed.adoptHistory(async () => asHistory(effectWire('e1', read, completed({ approvalSource: 'bypass', approvalType: 'always' }))));
    expect(adoptedChanged.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'historical_effect_changed', entryId: 'e1' } }]);
    const alteredInput = processor({}, ledgerWith(['cb', 'e1', read, 'approve']));
    settledRead(alteredInput);
    alteredInput.handle('session/compacted', handoffParams(3));
    expect((await alteredInput.adoptHistory(async () => asHistory(effectWire('e1', read, completed(), { filePath: 'src/other.ts' })))).signals).toMatchObject([{ type: 'fatal', fatal: { code: 'historical_effect_changed' } }]);

    const hidden = processor();
    hidden.handle('session/contextCleared', handoffParams(3));
    const adoptedHidden = await hidden.adoptHistory(async () => asHistory(effectWire('e5', read, completed({ approvalType: 'always', approvalSource: 'config' }))));
    expect(adoptedHidden.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'unapproved_effect', entryId: 'e5' } }]);
  });

  it('is fatal when the replayed history cannot be paged', async () => {
    const target = processor();
    target.handle('session/compacted', handoffParams(3));
    const adopted = await target.adoptHistory(async () => parseHistoryListResult({ items: [], nextCursor: 'c', previousCursor: null }));
    expect(adopted.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'history_paging_failed' } }]);
  });

  it('keeps historical effects after the handoff and fails when an update changes one', () => {
    const target = processor({}, ledgerWith(['cb', 'e1', read, 'approve']));
    settledRead(target);
    target.handle('session/compacted', handoffParams(3));
    const result = send(target, ['history/entryUpdated', nextEnvelope(4, { turnId: 't1', entryId: 'e1', patch: [{ op: 'replace', path: '/detail/input/filePath', value: 'src/other.ts' }] })]);
    expect(result.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'historical_effect_changed', entryId: 'e1' } }]);
  });

  it('validates an effect first seen after the handoff against the new session only', () => {
    const ledger = ledgerWith(['cb', 'e1', read, 'approve']);
    const target = processor({}, ledger);
    target.handle('session/compacted', handoffParams(3));
    ledger.record({ callbackId: 'cb2', relatedEntryId: 'e2', sessionId: NEXT, turnId: 't1', tool: read, path: null, fingerprint: inputFingerprint(read, defaultInput), decision: 'approve', reason: null });
    expect(send(target, ['history/entryAdded', nextEnvelope(4, { turnId: 't1', entry: effectWire('e2', read, completed()) })]).signals).toMatchObject([{ type: 'tool_effect', entryId: 'e2', outcome: 'executed' }]);
    const stale = send(target, ['history/entryAdded', nextEnvelope(5, { turnId: 't1', entry: effectWire('e1', read, completed()) })]);
    expect(stale.signals).toMatchObject([{ type: 'fatal', fatal: { code: 'unapproved_effect', entryId: 'e1' } }]);
    expect(target.fatal?.message).toContain('the approval belongs to a different session');
  });

  it('refuses a resync that returns another session', () => {
    const target = processor();
    const state: SessionState = { eventId: 12, session: { id: 'session-9', harness: 'unified', cwd: '/w', model: null, reasoningEffort: null, statusType: 'running' }, history: [], historyBeforeCursor: null, turns: [], isQuiescent: false };
    expect(target.resync(state).signals).toMatchObject([{ type: 'fatal', fatal: { code: 'session_handoff_unsafe' } }]);
  });

  it('audits a post-handoff history against what was observed before it and the sessions of the run', () => {
    const target = processor({}, ledgerWith(['cb', 'e1', read, 'approve']));
    settledRead(target);
    target.handle('session/compacted', handoffParams(3));
    const options = { mode: 'review' as const, ledger: ledgerWith(['cb', 'e1', read, 'approve']), sessionIds: target.sessionIds, historical: target.historicalEffects };
    const same = auditHistory([parseHistoryEntry(effectWire('e1', read, completed()))], options);
    expect(same.fatal).toBeNull();
    expect(same.effects).toEqual([{ entryId: 'e1', tool: read, outcome: 'executed', path: 'src/index.ts' }]);
    const altered = auditHistory([parseHistoryEntry(effectWire('e1', read, completed(), { filePath: 'src/other.ts' }))], options);
    expect(altered.fatal).toMatchObject({ code: 'historical_effect_changed', entryId: 'e1' });
    const foreign = auditHistory([parseHistoryEntry(effectWire('e1', read, completed()))], { mode: 'review', ledger: ledgerWith(['cb', 'e1', read, 'approve']), sessionIds: ['session-9'] });
    expect(foreign.fatal).toMatchObject({ code: 'unapproved_effect' });
  });
});
