import type { RunMode } from '../../contracts.js';
import { redactSecrets } from '../../security/redaction.js';
import { isProfileTool, type ApprovalLedger } from './approvals.js';
import type { JsonObject } from './jsonrpc.js';
import {
  MAX_PAGE_LIMIT,
  ProtocolParseError,
  messageText,
  parseHistoryEntry,
  parseNotification,
  type AgentStats,
  type EffectEntry,
  type HistoryEntry,
  type HistoryPage,
  type MessageEntry,
  type PageParams,
  type PatchOp,
  type ServerNotification,
  type SessionState,
  type Turn
} from './protocol.js';

export const DEFAULT_MAX_RETAINED_EFFECTS = 10_000;
export const DEFAULT_MAX_RETAINED_MESSAGES = 64;
export const DEFAULT_MAX_MESSAGE_CHARS = 200_000;
export const DEFAULT_MAX_PATCH_OPS = 256;
export const DEFAULT_MAX_HISTORY_PAGES = 64;
const MAX_SIGNAL_PATH_CHARS = 512;
const MAX_UNKNOWN_METHODS = 32;
const MAX_POINTER_SEGMENTS = 16;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const PENDING_EFFECT_STATUSES = new Set(['running', 'pending', 'blocked', 'queued', 'in_progress']);

export type FatalCode =
  | 'unapproved_effect'
  | 'unknown_entry_kind'
  | 'unknown_effect_status'
  | 'malformed_notification'
  | 'patch_failed'
  | 'retention_exceeded'
  | 'history_paging_failed';

export interface EventFatal {
  code: FatalCode;
  message: string;
  tool: string | null;
  entryId: string | null;
}

export type ToolOutcome = 'executed' | 'permission_denied_by_handler' | 'permission_denied_by_policy' | 'not_executed';

export type EventSignal =
  | { type: 'fatal'; fatal: EventFatal }
  | { type: 'watermark_gap'; expected: number; received: number }
  | { type: 'tool_effect'; entryId: string; tool: string; outcome: ToolOutcome; path: string | null }
  | { type: 'turn_started'; turn: Turn }
  | { type: 'turn_completed'; turn: Turn }
  | { type: 'stats'; stats: AgentStats; contextWindow: number | null }
  | { type: 'session_handoff'; kind: 'session/compacted' | 'session/contextCleared'; oldSessionId: string; newSessionId: string }
  | { type: 'turn_retrying' }
  | { type: 'warning' | 'server_error'; message: string | null; code: string | null };

export interface EventCounters {
  staleEvents: number;
  unknownNotifications: number;
  unknownMethods: string[];
  foreignSessionNotifications: number;
  reasoningDropped: number;
  callbacksSeen: number;
  skippedPatchOps: number;
  updatesToUnretainedEntries: number;
  ignoredWhileAwaitingResync: number;
}

export interface FinalMessage {
  entryId: string;
  text: string;
  complete: boolean;
  truncated: boolean;
}

export interface EffectRecord {
  entryId: string;
  tool: string;
  outcome: ToolOutcome;
  path: string | null;
}

export type EffectInspection =
  | { status: 'pending' }
  | { status: 'settled'; outcome: ToolOutcome; first: boolean }
  | { status: 'fatal'; fatal: EventFatal };

function fatalOf(code: FatalCode, message: string, tool: string | null = null, entryId: string | null = null): EventFatal {
  return { code, message: message.slice(0, 400), tool, entryId };
}

function printable(value: string, limit = 80): string {
  return value.replace(/[^\x20-\x7e]/g, '?').slice(0, limit);
}

export class EffectValidator {
  private readonly settledKeys = new Map<string, string>();

  constructor(private readonly mode: RunMode, private readonly ledger: ApprovalLedger) {}

  inspect(entry: EffectEntry): EffectInspection {
    const { state } = entry;
    const tool = entry.detail.toolName;
    if (PENDING_EFFECT_STATUSES.has(state.status)) return { status: 'pending' };
    const key = [state.status, state.decision, state.approvalType, state.approvalSource, state.errorCode].join('|');
    const first = this.settledKeys.get(entry.id) !== key;
    const settle = (outcome: ToolOutcome): EffectInspection => {
      this.settledKeys.set(entry.id, key);
      return { status: 'settled', outcome, first };
    };
    if (state.status === 'cancelled' || state.status === 'skipped') return settle('not_executed');
    if (state.status !== 'completed' && state.status !== 'failed') {
      return { status: 'fatal', fatal: fatalOf('unknown_effect_status', `effect ${printable(entry.id)} for ${printable(tool)} has unknown status ${printable(state.status)}`, tool, entry.id) };
    }
    if (state.status === 'failed' && state.errorCode === 'tool_denied' && state.decision !== 'execute') {
      return settle(this.ledger.forEffect(entry.id) ? 'permission_denied_by_handler' : 'permission_denied_by_policy');
    }
    if (state.status === 'failed' && state.decision !== 'execute') return settle('not_executed');
    const problems = this.approvalProblems(entry);
    if (problems.length > 0) {
      return { status: 'fatal', fatal: fatalOf('unapproved_effect', `${printable(tool)} was allowed or executed without a handler approval (${problems.join(', ')})`, tool, entry.id) };
    }
    return settle('executed');
  }

  private approvalProblems(entry: EffectEntry): string[] {
    const { state } = entry;
    const tool = entry.detail.toolName;
    const problems: string[] = [];
    if (!(state.decision === 'execute' && state.approvalType === 'ask' && state.approvalSource === 'user')) problems.push('approval metadata is not execute/ask/user');
    if (!isProfileTool(this.mode, tool)) problems.push('tool is outside the profile');
    const record = this.ledger.forEffect(entry.id);
    if (!record) problems.push('no handler decision is linked to the entry');
    else {
      if (record.decision !== 'approve') problems.push('the handler denied it');
      if (record.tool !== tool) problems.push('the handler decided for a different tool');
      if (state.callbackId !== null && state.callbackId !== record.callbackId) problems.push('the entry names a different callback');
    }
    return problems;
  }
}

function redactedPath(filePath: string | null, secrets: readonly string[]): string | null {
  return filePath === null ? null : redactSecrets(filePath.slice(0, MAX_SIGNAL_PATH_CHARS), secrets);
}

function pathOf(entry: EffectEntry): string | null {
  const value = entry.detail.input.filePath;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function finalMessageOf(messages: readonly MessageEntry[], turnId: string | null, secrets: readonly string[], maxChars: number): FinalMessage | null {
  const assistant = messages.filter((message) => message.role === 'assistant' && (turnId === null || message.turnId === turnId) && messageText(message).trim().length > 0);
  const chosen = [...assistant].reverse().find((message) => message.generationStatus === 'completed') ?? assistant.at(-1);
  if (!chosen) return null;
  const raw = messageText(chosen);
  const truncated = raw.length > maxChars;
  return { entryId: chosen.id, text: redactSecrets(truncated ? raw.slice(0, maxChars) : raw, secrets), complete: chosen.generationStatus === 'completed', truncated };
}

export interface HistoryAuditOptions {
  mode: RunMode;
  ledger: ApprovalLedger;
  turnId?: string;
  secrets?: readonly string[];
  maxMessageChars?: number;
}

export interface HistoryAudit {
  fatal: EventFatal | null;
  entries: number;
  reasoningDropped: number;
  effects: EffectRecord[];
  pendingEffects: string[];
  finalMessage: FinalMessage | null;
}

export function auditHistory(entries: readonly HistoryEntry[], options: HistoryAuditOptions): HistoryAudit {
  const validator = new EffectValidator(options.mode, options.ledger);
  const secrets = options.secrets ?? [];
  const audit: HistoryAudit = { fatal: null, entries: entries.length, reasoningDropped: 0, effects: [], pendingEffects: [], finalMessage: null };
  const messages: MessageEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'reasoning') { audit.reasoningDropped += 1; continue; }
    if (entry.kind === 'unknown') {
      audit.fatal = fatalOf('unknown_entry_kind', `history contains an entry of unknown kind ${printable(entry.type)}`, null, entry.id);
      return audit;
    }
    if (entry.kind === 'message') { messages.push(entry); continue; }
    if (entry.kind !== 'effect') continue;
    const inspection = validator.inspect(entry);
    if (inspection.status === 'fatal') { audit.fatal = inspection.fatal; return audit; }
    if (inspection.status === 'pending') audit.pendingEffects.push(entry.id);
    else audit.effects.push({ entryId: entry.id, tool: entry.detail.toolName, outcome: inspection.outcome, path: redactedPath(pathOf(entry), secrets) });
  }
  audit.finalMessage = finalMessageOf(messages, options.turnId ?? null, secrets, options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS);
  return audit;
}

export interface HistoryPagingOptions {
  pageLimit?: number;
  maxPages?: number;
}

export type HistoryCollection = { ok: true; entries: HistoryEntry[] } | { ok: false; fatal: EventFatal };

export async function collectHistory(fetchPage: (page: PageParams) => Promise<HistoryPage>, options: HistoryPagingOptions = {}): Promise<HistoryCollection> {
  const limit = options.pageLimit ?? MAX_PAGE_LIMIT;
  const maxPages = options.maxPages ?? DEFAULT_MAX_HISTORY_PAGES;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) throw new RangeError(`pageLimit must be an integer from 1 to ${MAX_PAGE_LIMIT}`);
  const pages: HistoryEntry[][] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let count = 0; count < maxPages; count += 1) {
    const page = await fetchPage({ limit, direction: 'backward', ...(cursor === undefined ? {} : { cursor }) });
    pages.push(page.items);
    if (page.nextCursor === null) return { ok: true, entries: pages.reverse().flat() };
    if (page.items.length === 0 || cursors.has(page.nextCursor)) {
      return { ok: false, fatal: fatalOf('history_paging_failed', 'session/history/list did not make progress') };
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { ok: false, fatal: fatalOf('history_paging_failed', `session history exceeded ${maxPages} pages`) };
}

export async function auditSessionHistory(fetchPage: (page: PageParams) => Promise<HistoryPage>, options: HistoryAuditOptions & HistoryPagingOptions): Promise<HistoryAudit> {
  const collected = await collectHistory(fetchPage, options);
  if (!collected.ok) return { fatal: collected.fatal, entries: 0, reasoningDropped: 0, effects: [], pendingEffects: [], finalMessage: null };
  return auditHistory(collected.entries, options);
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);

function decodePointer(pointer: string): string[] | null {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return null;
  const segments = pointer.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (segments.length > MAX_POINTER_SEGMENTS || segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) return null;
  return segments;
}

const EFFECT_ROOT_KEYS = new Set(['type', 'id', 'turnId', 'detail', 'state']);
const EFFECT_STATE_KEYS = new Set(['status', 'decision', 'approvalType', 'approvalSource', 'callbackId', 'error']);
const EFFECT_DETAIL_KEYS = new Set(['kind', 'toolName', 'input']);
const MESSAGE_ROOT_KEYS = new Set(['type', 'id', 'turnId', 'role', 'content', 'generationStatus']);

function isRetainedPath(kind: 'effect' | 'message', segments: readonly string[]): boolean {
  const [first, second, third] = segments;
  if (first === undefined) return true;
  if (kind === 'message') return MESSAGE_ROOT_KEYS.has(first);
  if (!EFFECT_ROOT_KEYS.has(first)) return false;
  if (first === 'state') return second === undefined || EFFECT_STATE_KEYS.has(second);
  if (first === 'detail') {
    if (second === undefined) return true;
    if (!EFFECT_DETAIL_KEYS.has(second)) return false;
    return second !== 'input' || third === undefined || third === 'filePath';
  }
  return true;
}

function toWire(entry: EffectEntry | MessageEntry): Json {
  if (entry.kind === 'message') {
    return { type: 'message', id: entry.id, turnId: entry.turnId, role: entry.role, generationStatus: entry.generationStatus, content: entry.content.map((block) => (block.type === 'text' ? { type: 'text', text: block.text } : { type: 'other' })) };
  }
  const filePath = pathOf(entry);
  return {
    type: 'effect',
    id: entry.id,
    turnId: entry.turnId,
    detail: { kind: entry.detail.kind, toolName: entry.detail.toolName, input: filePath === null ? {} : { filePath } },
    state: {
      status: entry.state.status,
      decision: entry.state.decision,
      approvalType: entry.state.approvalType,
      approvalSource: entry.state.approvalSource,
      callbackId: entry.state.callbackId,
      ...(entry.state.errorCode === null ? {} : { error: { code: entry.state.errorCode } })
    }
  };
}

function slimWire(raw: Json, maxChars: number): Json {
  if (raw.type === 'message') {
    const content = Array.isArray(raw.content) ? raw.content : [];
    let budget = maxChars;
    const slimContent = content.slice(0, 64).map((block) => {
      if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
        const text = block.text.slice(0, Math.max(budget, 0));
        budget -= text.length;
        return { type: 'text', text };
      }
      return { type: 'other' };
    });
    return { type: 'message', id: raw.id, turnId: raw.turnId ?? null, role: raw.role, generationStatus: raw.generationStatus ?? null, content: slimContent };
  }
  const detail = isRecord(raw.detail) ? raw.detail : {};
  const input = isRecord(detail.input) ? detail.input : {};
  const state = isRecord(raw.state) ? raw.state : {};
  const error = isRecord(state.error) && typeof state.error.code === 'string' ? { code: state.error.code.slice(0, 80) } : undefined;
  return {
    type: 'effect',
    id: raw.id,
    turnId: raw.turnId ?? null,
    detail: { kind: detail.kind, toolName: detail.toolName, input: typeof input.filePath === 'string' ? { filePath: input.filePath.slice(0, 4096) } : {} },
    state: {
      status: state.status,
      decision: state.decision ?? null,
      approvalType: state.approvalType ?? null,
      approvalSource: state.approvalSource ?? null,
      callbackId: state.callbackId ?? null,
      ...(error ? { error } : {})
    }
  };
}

class PatchError extends Error {}

function walk(doc: Json, segments: readonly string[], create: boolean): { parent: Json | unknown[]; key: string } {
  let cursor: unknown = doc;
  for (const segment of segments.slice(0, -1)) {
    const next: unknown = Array.isArray(cursor) ? cursor[Number(segment)] : isRecord(cursor) && Object.hasOwn(cursor, segment) ? cursor[segment] : undefined;
    if (next === undefined && create && isRecord(cursor)) {
      cursor[segment] = {};
      cursor = cursor[segment];
      continue;
    }
    if (!isRecord(next) && !Array.isArray(next)) throw new PatchError(`patch path does not exist: /${segments.join('/')}`);
    cursor = next;
  }
  if (!isRecord(cursor) && !Array.isArray(cursor)) throw new PatchError('patch parent is not a container');
  return { parent: cursor, key: segments.at(-1) ?? '' };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyOperation(doc: Json, operation: PatchOp, segments: readonly string[]): void {
  if (segments.length === 0) throw new PatchError('patch targets the document root');
  const { parent, key } = walk(doc, segments, operation.op === 'add' || operation.op === 'replace');
  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new PatchError('patch array index is out of range');
    if (operation.op === 'add') parent.splice(index, 0, operation.value);
    else if (operation.op === 'replace') { if (index >= parent.length) throw new PatchError('patch replaces a missing array element'); parent[index] = operation.value; }
    else if (operation.op === 'remove') { if (index >= parent.length) throw new PatchError('patch removes a missing array element'); parent.splice(index, 1); }
    else if (operation.op === 'append') {
      const current = parent[index];
      if (typeof current === 'string') parent[index] = `${current}${String(operation.value ?? '')}`;
      else throw new PatchError('patch appends to a non-string element');
    } else if (!sameJson(parent[index], operation.value)) throw new PatchError('patch test failed');
    return;
  }
  const present = Object.hasOwn(parent, key);
  switch (operation.op) {
    case 'add':
    case 'replace':
      parent[key] = operation.value;
      return;
    case 'append': {
      const current = parent[key];
      if (!present) parent[key] = operation.value;
      else if (typeof current === 'string') parent[key] = `${current}${String(operation.value ?? '')}`;
      else if (Array.isArray(current)) current.push(operation.value);
      else throw new PatchError('patch appends to a non-appendable value');
      return;
    }
    case 'remove':
      delete parent[key];
      return;
    case 'test':
      if (!sameJson(parent[key], operation.value)) throw new PatchError('patch test failed');
      return;
  }
}

export interface EventProcessorOptions {
  sessionId: string;
  watermark: number;
  mode: RunMode;
  ledger: ApprovalLedger;
  secrets?: readonly string[];
  maxRetainedEffects?: number;
  maxRetainedMessages?: number;
  maxMessageChars?: number;
  maxPatchOps?: number;
}

export interface EventResult {
  signals: EventSignal[];
}

export class EventProcessor {
  private currentSessionId: string;
  private lastEventId: number;
  private gap: { expected: number; received: number } | null = null;
  private latchedFatal: EventFatal | null = null;
  private readonly effects = new Map<string, EffectEntry>();
  private readonly messages = new Map<string, MessageEntry>();
  private validator: EffectValidator;
  private readonly unknownMethods = new Set<string>();
  private readonly secrets: readonly string[];
  private readonly maxEffects: number;
  private readonly maxMessages: number;
  private readonly maxMessageChars: number;
  private readonly maxPatchOps: number;
  readonly counters: EventCounters = {
    staleEvents: 0,
    unknownNotifications: 0,
    unknownMethods: [],
    foreignSessionNotifications: 0,
    reasoningDropped: 0,
    callbacksSeen: 0,
    skippedPatchOps: 0,
    updatesToUnretainedEntries: 0,
    ignoredWhileAwaitingResync: 0
  };

  constructor(private readonly options: EventProcessorOptions) {
    this.currentSessionId = options.sessionId;
    this.lastEventId = options.watermark;
    this.secrets = options.secrets ?? [];
    this.maxEffects = options.maxRetainedEffects ?? DEFAULT_MAX_RETAINED_EFFECTS;
    this.maxMessages = options.maxRetainedMessages ?? DEFAULT_MAX_RETAINED_MESSAGES;
    this.maxMessageChars = options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
    this.maxPatchOps = options.maxPatchOps ?? DEFAULT_MAX_PATCH_OPS;
    this.validator = new EffectValidator(options.mode, options.ledger);
  }

  get sessionId(): string {
    return this.currentSessionId;
  }

  get watermark(): number {
    return this.lastEventId;
  }

  get fatal(): EventFatal | null {
    return this.latchedFatal;
  }

  get awaitingResync(): boolean {
    return this.gap !== null;
  }

  advanceWatermark(eventId: number): void {
    if (eventId > this.lastEventId) this.lastEventId = eventId;
  }

  seed(entries: readonly HistoryEntry[]): EventResult {
    const result: EventResult = { signals: [] };
    for (const entry of entries) {
      this.ingest(entry, undefined, result);
      if (this.latchedFatal) break;
    }
    return result;
  }

  resync(state: SessionState): EventResult {
    this.currentSessionId = state.session.id;
    this.lastEventId = state.eventId;
    this.gap = null;
    this.effects.clear();
    this.messages.clear();
    this.validator = new EffectValidator(this.options.mode, this.options.ledger);
    return this.seed(state.history);
  }

  finalMessage(turnId: string | null = null): FinalMessage | null {
    return finalMessageOf([...this.messages.values()], turnId, this.secrets, this.maxMessageChars);
  }

  effectRecords(): EffectRecord[] {
    const records: EffectRecord[] = [];
    for (const entry of this.effects.values()) {
      const inspection = this.validator.inspect(entry);
      if (inspection.status === 'settled') records.push({ entryId: entry.id, tool: entry.detail.toolName, outcome: inspection.outcome, path: redactedPath(pathOf(entry), this.secrets) });
    }
    return records;
  }

  handle(method: string, params: JsonObject): EventResult {
    const result: EventResult = { signals: [] };
    let notification: ServerNotification;
    try {
      notification = parseNotification(method, params);
    } catch (error) {
      if (error instanceof ProtocolParseError) {
        this.countUnknownIfUnrecognized(method, result);
        return result;
      }
      throw error;
    }
    if (notification.kind === 'unknown') {
      this.handleUnknown(notification, result);
      return result;
    }
    if (notification.kind === 'session/compacted' || notification.kind === 'session/contextCleared') {
      this.currentSessionId = notification.newSessionId;
      result.signals.push({ type: 'session_handoff', kind: notification.kind, oldSessionId: notification.oldSessionId, newSessionId: notification.newSessionId });
      this.observeSequence(notification.eventId, result);
      return result;
    }
    if (notification.sessionId !== null && notification.sessionId !== this.currentSessionId) {
      this.counters.foreignSessionNotifications += 1;
      return result;
    }
    if (this.gap === null && !this.observeSequence(notification.eventId, result)) return result;
    this.dispatch(notification, params, result);
    return result;
  }

  private countUnknownIfUnrecognized(method: string, result: EventResult): void {
    const known = ['history/entryAdded', 'history/entryUpdated', 'turn/started', 'turn/completed', 'session/statsUpdated', 'session/compacted', 'session/contextCleared', 'turn/retrying', 'warning', 'error'];
    if (known.includes(method)) this.latch(fatalOf('malformed_notification', `notification ${printable(method)} does not match its schema`), result);
    else this.recordUnknownMethod(method);
  }

  private recordUnknownMethod(method: string): void {
    this.counters.unknownNotifications += 1;
    if (this.unknownMethods.size < MAX_UNKNOWN_METHODS && !this.unknownMethods.has(method)) {
      this.unknownMethods.add(method);
      this.counters.unknownMethods = [...this.unknownMethods];
    }
  }

  private handleUnknown(notification: ServerNotification & { kind: 'unknown' }, result: EventResult): void {
    if (notification.sessionId !== null && notification.sessionId !== this.currentSessionId) {
      this.counters.foreignSessionNotifications += 1;
      return;
    }
    if (this.gap === null && !this.observeSequence(notification.eventId, result)) return;
    this.recordUnknownMethod(notification.method);
  }

  private observeSequence(eventId: number | null, result: EventResult): boolean {
    if (eventId === null) return true;
    if (this.gap !== null) return true;
    if (eventId <= this.lastEventId) {
      this.counters.staleEvents += 1;
      return false;
    }
    if (eventId > this.lastEventId + 1) {
      this.gap = { expected: this.lastEventId + 1, received: eventId };
      result.signals.push({ type: 'watermark_gap', expected: this.gap.expected, received: eventId });
      return false;
    }
    this.lastEventId = eventId;
    return true;
  }

  private dispatch(notification: ServerNotification, params: JsonObject, result: EventResult): void {
    switch (notification.kind) {
      case 'turn/started':
        result.signals.push({ type: 'turn_started', turn: notification.turn });
        return;
      case 'turn/completed':
        result.signals.push({ type: 'turn_completed', turn: notification.turn });
        return;
      case 'session/statsUpdated':
        result.signals.push({ type: 'stats', stats: notification.stats, contextWindow: notification.contextWindow });
        return;
      case 'turn/retrying':
        result.signals.push({ type: 'turn_retrying' });
        return;
      case 'warning':
        result.signals.push({ type: 'warning', message: this.safeText(notification.message), code: notification.code });
        return;
      case 'error':
        result.signals.push({ type: 'server_error', message: this.safeText(notification.message), code: notification.code });
        return;
      case 'history/entryAdded':
        if (this.gap !== null || this.latchedFatal) { this.counters.ignoredWhileAwaitingResync += 1; return; }
        this.ingest(notification.entry, isRecord(params.entry) ? params.entry : undefined, result);
        return;
      case 'history/entryUpdated':
        if (this.gap !== null || this.latchedFatal) { this.counters.ignoredWhileAwaitingResync += 1; return; }
        this.update(notification.entryId, notification.patch, result);
        return;
      case 'unknown':
      case 'session/compacted':
      case 'session/contextCleared':
        return;
    }
  }

  private safeText(message: string | null): string | null {
    return message === null ? null : redactSecrets(message.slice(0, 500), this.secrets);
  }

  private latch(fatal: EventFatal, result: EventResult): void {
    if (this.latchedFatal) return;
    this.latchedFatal = fatal;
    result.signals.push({ type: 'fatal', fatal });
  }

  private ingest(entry: HistoryEntry, raw: Json | undefined, result: EventResult): void {
    switch (entry.kind) {
      case 'reasoning':
        this.counters.reasoningDropped += 1;
        return;
      case 'callback':
        this.counters.callbacksSeen += 1;
        return;
      case 'unknown':
        this.latch(fatalOf('unknown_entry_kind', `history entry of unknown kind ${printable(entry.type)}`, null, entry.id), result);
        return;
      case 'message':
        if (entry.role === 'assistant') this.retain(raw ?? toWire(entry), result);
        return;
      case 'effect':
        this.retain(raw ?? toWire(entry), result);
    }
  }

  private retain(wire: Json, result: EventResult): void {
    let entry: HistoryEntry;
    try {
      entry = parseHistoryEntry(slimWire(wire, this.maxMessageChars), 'retained entry');
    } catch (error) {
      if (!(error instanceof ProtocolParseError)) throw error;
      this.latch(fatalOf('malformed_notification', `a history entry does not match its schema: ${error.message}`), result);
      return;
    }
    if (entry.kind === 'message') this.retainMessage(entry);
    else if (entry.kind === 'effect') this.retainEffect(entry, result);
  }

  private retainMessage(entry: MessageEntry): void {
    this.messages.delete(entry.id);
    this.messages.set(entry.id, entry);
    while (this.messages.size > this.maxMessages) {
      const oldest = this.messages.keys().next().value;
      if (oldest === undefined) break;
      this.messages.delete(oldest);
    }
  }

  private retainEffect(entry: EffectEntry, result: EventResult): void {
    if (!this.effects.has(entry.id) && this.effects.size >= this.maxEffects) {
      this.latch(fatalOf('retention_exceeded', `more than ${this.maxEffects} effect entries in one run`, entry.detail.toolName, entry.id), result);
      return;
    }
    this.effects.set(entry.id, entry);
    this.inspect(entry, result);
  }

  private inspect(entry: EffectEntry, result: EventResult): void {
    const inspection = this.validator.inspect(entry);
    if (inspection.status === 'fatal') this.latch(inspection.fatal, result);
    else if (inspection.status === 'settled' && inspection.first) {
      result.signals.push({ type: 'tool_effect', entryId: entry.id, tool: entry.detail.toolName, outcome: inspection.outcome, path: redactedPath(pathOf(entry), this.secrets) });
    }
  }

  private update(entryId: string, patch: readonly PatchOp[], result: EventResult): void {
    const effect = this.effects.get(entryId);
    const message = this.messages.get(entryId);
    const target = effect ?? message;
    if (!target) {
      this.counters.updatesToUnretainedEntries += 1;
      return;
    }
    if (patch.length > this.maxPatchOps) {
      this.latch(fatalOf('patch_failed', `an entry update carried ${patch.length} operations`, null, entryId), result);
      return;
    }
    const kind = target.kind;
    const wire = toWire(target);
    try {
      for (const operation of patch) {
        const segments = decodePointer(operation.path);
        if (segments === null) throw new PatchError('patch path is invalid');
        if (!isRetainedPath(kind, segments)) { this.counters.skippedPatchOps += 1; continue; }
        applyOperation(wire, operation, segments);
      }
      const next = parseHistoryEntry(slimWire(wire, this.maxMessageChars), 'retained entry');
      if (next.kind !== kind) throw new PatchError('patch changed the entry kind');
      if (next.kind === 'effect') {
        this.effects.set(entryId, next);
        this.inspect(next, result);
      } else if (next.kind === 'message') {
        this.messages.set(entryId, next);
      }
    } catch (error) {
      if (error instanceof PatchError || error instanceof ProtocolParseError) {
        this.latch(fatalOf('patch_failed', `could not apply an update to entry ${printable(entryId)}: ${error.message}`, target.kind === 'effect' ? target.detail.toolName : null, entryId), result);
        return;
      }
      throw error;
    }
  }
}
