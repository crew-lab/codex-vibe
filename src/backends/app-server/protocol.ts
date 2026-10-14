import path from 'node:path';
import { z } from 'zod';

export const CLIENT_ENTRYPOINT = 'programmatic';
export const MAX_PAGE_LIMIT = 500;
export const EFFECT_PATH_FIELD = 'filePath';

export const TURN_STATUSES = ['in_progress', 'completed', 'failed', 'interrupted'] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

export const TURN_STOP_REASONS = ['limit', 'length'] as const;
export type TurnStopReason = 'limit' | 'length' | 'unknown';

export const TURN_ERROR_CODES = [
  'invalid_api_key',
  'invalid_model',
  'context_too_long',
  'response_too_long',
  'rate_limit',
  'refusal',
  'backend_error',
  'internal_error',
  'incomplete_stream',
  'compaction_failed'
] as const;
export type TurnErrorCode = (typeof TURN_ERROR_CODES)[number];

export const PROTOCOL_ERROR_CODES = [
  'invalid_request',
  'invalid_params',
  'not_initialized',
  'not_found',
  'conflict',
  'stale_turn',
  'not_steerable',
  'callback_closed',
  'compaction_failed',
  'unauthorized',
  'forbidden',
  'method_not_found',
  'not_implemented',
  'stale_cursor',
  'internal_error'
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export type ApprovalDecisionType = 'approve' | 'deny';

export interface ProtocolIssue {
  path: string;
  message: string;
}

export class ProtocolParseError extends Error {
  constructor(readonly context: string, readonly issues: readonly ProtocolIssue[]) {
    super(`${context}: ${issues.map((issue) => `${issue.path || '(root)'} ${issue.message}`).join('; ').slice(0, 600)}`);
    this.name = 'ProtocolParseError';
  }
}

export type RequestSpec<M extends string, P extends Record<string, unknown>> = { readonly method: M; readonly params: P };

export type ClientInfoInput = { name: string; version: string };

export type InitializeRequest = RequestSpec<'initialize', {
  clientInfo: { name: string; version: string; entrypoint: typeof CLIENT_ENTRYPOINT };
  capabilities: { callbackKinds: ['approval'] };
}>;

export type InitializedNotification = RequestSpec<'initialized', Record<string, never>>;

export type SessionAgentConfigInput = {
  cwd: string;
  agent: string;
  enabledTools: readonly string[];
  disabledTools?: readonly string[];
  maxTurns: number;
};

export type AgentConfigParams = {
  cwd: string;
  agent: string;
  enabledTools: string[];
  disabledTools: string[];
  maxTurns: number;
  headless: true;
  autoApprove: false;
  trustWorkspace: false;
  workspaceRoots: [];
  mcpServers: [];
};

export type SessionStartOptions = {
  historyLimit?: number;
  kind?: 'normal' | 'ephemeral';
  idempotencyKey?: string;
};

export type SessionStartRequest = RequestSpec<'session/start', {
  agentConfig: AgentConfigParams;
  historyLimit: number;
  kind?: 'normal' | 'ephemeral';
  idempotencyKey?: string;
}>;

export type SessionIdParams = { sessionId: string };
export type PageParams = { limit: number; direction?: 'forward' | 'backward'; cursor?: string };

export type ModelWriteInput = { reasoningEffort?: string; modelAlias?: string };

export type ApprovalOutput = { type: 'approval'; decision: { type: ApprovalDecisionType }; feedback: null };

export type CallbackResultRequest = RequestSpec<'callback/result', {
  sessionId: string;
  result: { callbackId: string; output: ApprovalOutput };
}>;

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function requireStrings(value: readonly unknown[], name: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((item, index) => requireText(item, `${name}[${index}]`));
}

function requirePage(page: PageParams, name: string): Record<string, unknown> {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE_LIMIT) throw new RangeError(`${name}.limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`);
  if (page.direction !== undefined && page.direction !== 'forward' && page.direction !== 'backward') throw new TypeError(`${name}.direction is invalid`);
  const out: Record<string, unknown> = { limit: page.limit };
  if (page.direction !== undefined) out.direction = page.direction;
  if (page.cursor !== undefined) out.cursor = requireText(page.cursor, `${name}.cursor`);
  return out;
}

export function buildInitialize(client: ClientInfoInput): InitializeRequest {
  return {
    method: 'initialize',
    params: {
      clientInfo: { name: requireText(client.name, 'clientInfo.name'), version: requireText(client.version, 'clientInfo.version'), entrypoint: CLIENT_ENTRYPOINT },
      capabilities: { callbackKinds: ['approval'] }
    }
  };
}

export function buildInitialized(): InitializedNotification {
  return { method: 'initialized', params: {} };
}

export function buildSessionStart(config: SessionAgentConfigInput, options: SessionStartOptions = {}): SessionStartRequest {
  const enabledTools = requireStrings(config.enabledTools, 'enabledTools');
  if (enabledTools.length === 0) throw new RangeError('enabledTools must not be empty because an empty list disables the filter');
  if (!Number.isInteger(config.maxTurns) || config.maxTurns < 1) throw new RangeError('maxTurns must be a positive integer');
  const historyLimit = options.historyLimit ?? MAX_PAGE_LIMIT;
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_PAGE_LIMIT) throw new RangeError(`historyLimit must be an integer from 1 to ${MAX_PAGE_LIMIT}`);
  if (!path.isAbsolute(requireText(config.cwd, 'cwd'))) throw new TypeError('cwd must be an absolute path');
  const params: SessionStartRequest['params'] = {
    agentConfig: {
      cwd: config.cwd,
      agent: requireText(config.agent, 'agent'),
      enabledTools,
      disabledTools: requireStrings(config.disabledTools ?? [], 'disabledTools'),
      maxTurns: config.maxTurns,
      headless: true,
      autoApprove: false,
      trustWorkspace: false,
      workspaceRoots: [],
      mcpServers: []
    },
    historyLimit
  };
  if (options.kind !== undefined) {
    if (options.kind !== 'normal' && options.kind !== 'ephemeral') throw new TypeError('kind is invalid');
    params.kind = options.kind;
  }
  if (options.idempotencyKey !== undefined) params.idempotencyKey = requireText(options.idempotencyKey, 'idempotencyKey');
  return { method: 'session/start', params };
}

export function buildSessionReadyWait(sessionId: string): RequestSpec<'session/ready/wait', SessionIdParams> {
  return { method: 'session/ready/wait', params: { sessionId: requireText(sessionId, 'sessionId') } };
}

export function buildRuntimeRead(sessionId: string): RequestSpec<'runtime/read', SessionIdParams> {
  return { method: 'runtime/read', params: { sessionId: requireText(sessionId, 'sessionId') } };
}

export function buildConfigEffectiveRead(sessionId: string): RequestSpec<'config/effective/read', SessionIdParams> {
  return { method: 'config/effective/read', params: { sessionId: requireText(sessionId, 'sessionId') } };
}

export function buildConfigRead(sessionId: string): RequestSpec<'config/read', SessionIdParams> {
  return { method: 'config/read', params: { sessionId: requireText(sessionId, 'sessionId') } };
}

export function buildConfigModelWrite(sessionId: string, write: ModelWriteInput): RequestSpec<'config/model/write', { sessionId: string; reasoningEffort?: string; modelAlias?: string }> {
  const params: { sessionId: string; reasoningEffort?: string; modelAlias?: string } = { sessionId: requireText(sessionId, 'sessionId') };
  if (write.reasoningEffort !== undefined) params.reasoningEffort = requireText(write.reasoningEffort, 'reasoningEffort');
  if (write.modelAlias !== undefined) params.modelAlias = requireText(write.modelAlias, 'modelAlias');
  if (params.reasoningEffort === undefined && params.modelAlias === undefined) throw new TypeError('config/model/write needs reasoningEffort or modelAlias');
  return { method: 'config/model/write', params };
}

export function buildTurnStart(sessionId: string, text: string): RequestSpec<'turn/start', { sessionId: string; message: [{ type: 'text'; text: string }] }> {
  if (typeof text !== 'string' || text.length === 0) throw new TypeError('the task text must be a non-empty string');
  return { method: 'turn/start', params: { sessionId: requireText(sessionId, 'sessionId'), message: [{ type: 'text', text }] } };
}

export function buildTurnInterrupt(sessionId: string, expectedTurnId: string): RequestSpec<'turn/interrupt', { sessionId: string; expectedTurnId: string }> {
  return { method: 'turn/interrupt', params: { sessionId: requireText(sessionId, 'sessionId'), expectedTurnId: requireText(expectedTurnId, 'expectedTurnId') } };
}

export function buildSessionRead(sessionId: string, pages: { history?: PageParams; turns?: PageParams } = {}): RequestSpec<'session/read', { sessionId: string; history?: Record<string, unknown>; turns?: Record<string, unknown> }> {
  const params: { sessionId: string; history?: Record<string, unknown>; turns?: Record<string, unknown> } = { sessionId: requireText(sessionId, 'sessionId') };
  if (pages.history !== undefined) params.history = requirePage(pages.history, 'history');
  if (pages.turns !== undefined) params.turns = requirePage(pages.turns, 'turns');
  return { method: 'session/read', params };
}

export function buildSessionHistoryList(sessionId: string, page: PageParams, turnId?: string): RequestSpec<'session/history/list', { sessionId: string; page: Record<string, unknown>; turnId?: string }> {
  const params: { sessionId: string; page: Record<string, unknown>; turnId?: string } = { sessionId: requireText(sessionId, 'sessionId'), page: requirePage(page, 'page') };
  if (turnId !== undefined) params.turnId = requireText(turnId, 'turnId');
  return { method: 'session/history/list', params };
}

export function approvalOutput(decision: ApprovalDecisionType): ApprovalOutput {
  if (decision !== 'approve' && decision !== 'deny') throw new TypeError('only approve and deny may be sent');
  return { type: 'approval', decision: { type: decision }, feedback: null };
}

export function buildCallbackResult(sessionId: string, callbackId: string, decision: ApprovalDecisionType): CallbackResultRequest {
  return {
    method: 'callback/result',
    params: { sessionId: requireText(sessionId, 'sessionId'), result: { callbackId: requireText(callbackId, 'callbackId'), output: approvalOutput(decision) } }
  };
}

export function callbackAcknowledgement(callbackId: string): { callbackId: string; accepted: true } {
  return { callbackId: requireText(callbackId, 'callbackId'), accepted: true };
}

function parseWith<S extends z.ZodType>(schema: S, value: unknown, context: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ProtocolParseError(context, parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message.slice(0, 200) })));
}

const nullableString = z.string().nullish().transform((value) => value ?? null);
const nonNegativeInt = z.number().int().nonnegative();
const requiredPresent = z.unknown().refine((value) => value !== undefined, 'Required');
const plainRecord = z.record(z.string(), z.unknown());

export interface TurnError {
  code: TurnErrorCode | 'unknown';
  rawCode: string | null;
  message: string | null;
}

export interface Turn {
  id: string;
  status: TurnStatus;
  stopReason: TurnStopReason | null;
  rawStopReason: string | null;
  error: TurnError | null;
}

export function isTurnErrorCode(value: unknown): value is TurnErrorCode {
  return typeof value === 'string' && (TURN_ERROR_CODES as readonly string[]).includes(value);
}

function parseTurnError(raw: unknown): TurnError | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { code: 'unknown', rawCode: null, message: null };
  const body = raw as Record<string, unknown>;
  const rawCode = typeof body.code === 'string' ? body.code : null;
  return { code: isTurnErrorCode(rawCode) ? rawCode : 'unknown', rawCode, message: typeof body.message === 'string' ? body.message : null };
}

const turnSchema = z.object({
  id: z.string().min(1),
  status: z.enum(TURN_STATUSES),
  stopReason: z.string().nullish(),
  error: z.unknown().optional()
}).transform((raw): Turn => {
  const rawStopReason = raw.stopReason ?? null;
  const stopReason: TurnStopReason | null = rawStopReason === null ? null : (TURN_STOP_REASONS as readonly string[]).includes(rawStopReason) ? (rawStopReason as TurnStopReason) : 'unknown';
  return { id: raw.id, status: raw.status, stopReason, rawStopReason, error: parseTurnError(raw.error) };
});

export interface AgentStats {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number | null;
  modelCalls: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  cachedInputPricePerMillion: number | null;
  contextTokens: number | null;
}

const nullableNumber = z.number().nullish().transform((value) => value ?? null);

const statsSchema = z.object({
  sessionPromptTokens: z.number().nonnegative(),
  sessionCompletionTokens: z.number().nonnegative(),
  sessionCachedTokens: nullableNumber,
  modelCalls: nullableNumber,
  inputPricePerMillion: nullableNumber,
  outputPricePerMillion: nullableNumber,
  cachedInputPricePerMillion: nullableNumber,
  contextTokens: nullableNumber
}).transform((raw): AgentStats => ({
  promptTokens: raw.sessionPromptTokens,
  completionTokens: raw.sessionCompletionTokens,
  cachedTokens: raw.sessionCachedTokens,
  modelCalls: raw.modelCalls,
  inputPricePerMillion: raw.inputPricePerMillion,
  outputPricePerMillion: raw.outputPricePerMillion,
  cachedInputPricePerMillion: raw.cachedInputPricePerMillion,
  contextTokens: raw.contextTokens
}));

export type ContentBlock = { type: 'text'; text: string } | { type: 'other' };

export interface MessageEntry {
  kind: 'message';
  id: string;
  turnId: string | null;
  role: string;
  generationStatus: string | null;
  content: ContentBlock[];
}

export interface ReasoningEntry {
  kind: 'reasoning';
  id: string | null;
  turnId: string | null;
}

export interface EffectState {
  status: string;
  decision: string | null;
  approvalType: string | null;
  approvalSource: string | null;
  callbackId: string | null;
  errorCode: string | null;
}

export interface EffectDetail {
  kind: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface EffectEntry {
  kind: 'effect';
  id: string;
  turnId: string | null;
  detail: EffectDetail;
  state: EffectState;
}

export interface CallbackEntry {
  kind: 'callback';
  id: string;
  turnId: string | null;
  callbackId: string;
  relatedEntryId: string | null;
  detailKind: string | null;
  effect: EffectDetail | null;
  status: string | null;
}

export interface UnknownEntry {
  kind: 'unknown';
  type: string;
  id: string | null;
  turnId: string | null;
}

export type HistoryEntry = MessageEntry | ReasoningEntry | EffectEntry | CallbackEntry | UnknownEntry;

const effectDetailSchema = z.object({
  kind: z.string(),
  toolName: z.string().min(1),
  input: plainRecord.nullish()
}).transform((raw): EffectDetail => ({ kind: raw.kind, toolName: raw.toolName, input: raw.input ?? {} }));

const effectStateSchema = z.object({
  status: z.string(),
  decision: nullableString,
  approvalType: nullableString,
  approvalSource: nullableString,
  callbackId: nullableString,
  error: z.unknown().optional()
}).transform((raw): EffectState => {
  const error = raw.error;
  const code = error !== null && typeof error === 'object' && !Array.isArray(error) ? (error as Record<string, unknown>).code : undefined;
  return { status: raw.status, decision: raw.decision, approvalType: raw.approvalType, approvalSource: raw.approvalSource, callbackId: raw.callbackId, errorCode: typeof code === 'string' ? code : null };
});

const messageSchema = z.object({ id: z.string(), turnId: nullableString, role: z.string(), generationStatus: nullableString, content: z.array(z.unknown()) });
const reasoningSchema = z.object({ id: nullableString, turnId: nullableString });
const effectSchema = z.object({ id: z.string(), turnId: nullableString, detail: effectDetailSchema, state: effectStateSchema });
const callbackSchema = z.object({
  id: z.string(),
  turnId: nullableString,
  callbackId: z.string().min(1),
  relatedEntryId: nullableString,
  detail: z.object({ kind: z.string(), effect: z.unknown().optional() }).nullish(),
  state: z.object({ status: z.string() }).nullish()
});

function parseContentBlock(raw: unknown): ContentBlock {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const block = raw as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text };
  }
  return { type: 'other' };
}

export function parseHistoryEntry(raw: unknown, context = 'history entry'): HistoryEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ProtocolParseError(context, [{ path: '', message: 'entry is not an object' }]);
  const record = raw as Record<string, unknown>;
  if (typeof record.type !== 'string' || record.type.length === 0) throw new ProtocolParseError(context, [{ path: 'type', message: 'entry type is missing' }]);
  switch (record.type) {
    case 'message': {
      const entry = parseWith(messageSchema, raw, context);
      return { kind: 'message', id: entry.id, turnId: entry.turnId, role: entry.role, generationStatus: entry.generationStatus, content: entry.content.map(parseContentBlock) };
    }
    case 'reasoning': {
      const entry = parseWith(reasoningSchema, raw, context);
      return { kind: 'reasoning', id: entry.id, turnId: entry.turnId };
    }
    case 'effect': {
      const entry = parseWith(effectSchema, raw, context);
      return { kind: 'effect', id: entry.id, turnId: entry.turnId, detail: entry.detail, state: entry.state };
    }
    case 'callback': {
      const entry = parseWith(callbackSchema, raw, context);
      const detailKind = entry.detail?.kind ?? null;
      const effect = detailKind === 'approval' ? effectDetailSchema.safeParse(entry.detail?.effect) : undefined;
      return {
        kind: 'callback',
        id: entry.id,
        turnId: entry.turnId,
        callbackId: entry.callbackId,
        relatedEntryId: entry.relatedEntryId,
        detailKind,
        effect: effect?.success ? effect.data : null,
        status: entry.state?.status ?? null
      };
    }
    default:
      return { kind: 'unknown', type: record.type, id: typeof record.id === 'string' ? record.id : null, turnId: typeof record.turnId === 'string' ? record.turnId : null };
  }
}

export function messageText(entry: MessageEntry): string {
  return entry.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

export function effectFilePath(input: Record<string, unknown>): string | null {
  const value = input[EFFECT_PATH_FIELD];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface PublicSessionSummary {
  id: string;
  harness: string;
  cwd: string | null;
  model: string | null;
  reasoningEffort: string | null;
  statusType: string | null;
}

export interface SessionState {
  eventId: number;
  session: PublicSessionSummary;
  history: HistoryEntry[];
  historyBeforeCursor: string | null;
  turns: Turn[];
  isQuiescent: boolean | null;
}

const sessionStateSchema = z.object({
  eventId: nonNegativeInt,
  session: z.object({
    id: z.string().min(1),
    harness: z.string(),
    cwd: nullableString,
    model: nullableString,
    reasoningEffort: nullableString,
    status: z.object({ type: z.string() }).nullish()
  }),
  history: z.array(z.unknown()),
  historyBeforeCursor: nullableString,
  turns: z.array(turnSchema),
  isQuiescent: z.boolean().nullish()
});

function toSessionState(raw: z.output<typeof sessionStateSchema>, context: string): SessionState {
  return {
    eventId: raw.eventId,
    session: { id: raw.session.id, harness: raw.session.harness, cwd: raw.session.cwd, model: raw.session.model, reasoningEffort: raw.session.reasoningEffort, statusType: raw.session.status?.type ?? null },
    history: raw.history.map((entry, index) => parseHistoryEntry(entry, `${context}.history[${index}]`)),
    historyBeforeCursor: raw.historyBeforeCursor,
    turns: raw.turns,
    isQuiescent: raw.isQuiescent ?? null
  };
}

export interface InitializeResult {
  serverName: string;
  serverVersion: string;
  processId: number | null;
}

export function parseInitializeResult(value: unknown): InitializeResult {
  const raw = parseWith(z.object({ serverInfo: z.object({ name: z.string(), version: z.string().min(1) }), processId: z.number().int().nullish() }), value, 'initialize result');
  return { serverName: raw.serverInfo.name, serverVersion: raw.serverInfo.version, processId: raw.processId ?? null };
}

export interface SessionStartResult {
  lastEventId: number;
  state: SessionState;
}

export function parseSessionStartResult(value: unknown): SessionStartResult {
  const raw = parseWith(z.object({ lastEventId: nonNegativeInt, state: sessionStateSchema }), value, 'session/start result');
  return { lastEventId: raw.lastEventId, state: toSessionState(raw.state, 'session/start result.state') };
}

export function parseSessionReadResult(value: unknown): SessionStartResult {
  const raw = parseWith(z.object({ lastEventId: nonNegativeInt, state: sessionStateSchema }), value, 'session/read result');
  return { lastEventId: raw.lastEventId, state: toSessionState(raw.state, 'session/read result.state') };
}

export function parseSessionReadyWaitResult(value: unknown): { ready: boolean } {
  return parseWith(z.object({ ready: z.boolean() }), value, 'session/ready/wait result');
}

export interface ToolRef {
  name: string;
}

export interface RuntimeSnapshot {
  tools: ToolRef[];
  skills: unknown[];
  mcp: unknown;
  connectors: unknown;
  hooksCount: number;
  issues: unknown[];
  bypassToolPermissions: boolean;
  stats: AgentStats;
  activeModel: { alias: string | null; thinking: string | null } | null;
}

export interface RuntimeReadResult {
  runtime: RuntimeSnapshot;
  ready: boolean | null;
}

const runtimeSchema = z.object({
  tools: z.array(z.object({ name: z.string().min(1) })),
  skills: z.array(z.unknown()),
  mcp: requiredPresent,
  connectors: requiredPresent,
  hooksCount: nonNegativeInt,
  issues: z.array(z.unknown()),
  stats: statsSchema,
  bypassToolPermissions: z.boolean(),
  config: z.object({
    activeModel: z.object({ alias: nullableString, thinking: nullableString }).nullish()
  }).nullish()
});

function toRuntimeSnapshot(raw: z.output<typeof runtimeSchema>): RuntimeSnapshot {
  return {
    tools: raw.tools.map((tool) => ({ name: tool.name })),
    skills: raw.skills,
    mcp: raw.mcp,
    connectors: raw.connectors,
    hooksCount: raw.hooksCount,
    issues: raw.issues,
    bypassToolPermissions: raw.bypassToolPermissions,
    stats: raw.stats,
    activeModel: raw.config?.activeModel ? { alias: raw.config.activeModel.alias, thinking: raw.config.activeModel.thinking } : null
  };
}

export function parseRuntimeReadResult(value: unknown): RuntimeReadResult {
  const raw = parseWith(z.object({ runtime: runtimeSchema, ready: z.boolean().nullish() }), value, 'runtime/read result');
  return { runtime: toRuntimeSnapshot(raw.runtime), ready: raw.ready ?? null };
}

export function parseConfigEffectiveReadResult(value: unknown): { config: Record<string, unknown> } {
  return parseWith(z.object({ config: plainRecord }), value, 'config/effective/read result');
}

export interface ConfigReadResult {
  harnessSelectionSource: string;
  hooksCount: number | null;
  skillsCount: number | null;
}

export function parseConfigReadResult(value: unknown): ConfigReadResult {
  const raw = parseWith(z.object({ harnessSelectionSource: z.string(), hooksCount: nonNegativeInt.nullish(), skillsCount: nonNegativeInt.nullish() }), value, 'config/read result');
  return { harnessSelectionSource: raw.harnessSelectionSource, hooksCount: raw.hooksCount ?? null, skillsCount: raw.skillsCount ?? null };
}

export function parseConfigModelWriteResult(value: unknown): { status: string | null } {
  const raw = parseWith(z.object({ status: nullableString }), value, 'config/model/write result');
  return { status: raw.status };
}

export function parseTurnStartResult(value: unknown): { turn: Turn; lastEventId: number } {
  return parseWith(z.object({ turn: turnSchema, lastEventId: nonNegativeInt }), value, 'turn/start result');
}

export function parseAcceptedResult(value: unknown, context: string): { accepted: boolean } {
  return parseWith(z.object({ accepted: z.boolean() }), value, context);
}

export interface HistoryPage {
  items: HistoryEntry[];
  nextCursor: string | null;
  previousCursor: string | null;
}

export function parseHistoryListResult(value: unknown): HistoryPage {
  const raw = parseWith(z.object({ items: z.array(z.unknown()), nextCursor: z.string().nullable(), previousCursor: z.string().nullable() }), value, 'session/history/list result');
  return {
    items: raw.items.map((entry, index) => parseHistoryEntry(entry, `session/history/list result.items[${index}]`)),
    nextCursor: raw.nextCursor,
    previousCursor: raw.previousCursor
  };
}

export const PATCH_OPS = ['add', 'append', 'replace', 'remove', 'test'] as const;
export type PatchOpName = (typeof PATCH_OPS)[number];
export interface PatchOp {
  op: PatchOpName;
  path: string;
  value?: unknown;
}

const patchOpSchema = z.object({ op: z.enum(PATCH_OPS), path: z.string(), value: z.unknown().optional() }).transform((raw): PatchOp => (
  raw.value === undefined ? { op: raw.op, path: raw.path } : { op: raw.op, path: raw.path, value: raw.value }
));

interface NotificationBase {
  eventId: number | null;
  sessionId: string | null;
}

export type ServerNotification =
  | (NotificationBase & { kind: 'history/entryAdded'; turnId: string | null; entry: HistoryEntry })
  | (NotificationBase & { kind: 'history/entryUpdated'; turnId: string | null; entryId: string; patch: PatchOp[] })
  | (NotificationBase & { kind: 'turn/started'; turn: Turn })
  | (NotificationBase & { kind: 'turn/completed'; turn: Turn })
  | (NotificationBase & { kind: 'session/statsUpdated'; stats: AgentStats; contextWindow: number | null })
  | (NotificationBase & { kind: 'session/compacted' | 'session/contextCleared'; newSessionId: string; oldSessionId: string })
  | (NotificationBase & { kind: 'turn/retrying' })
  | (NotificationBase & { kind: 'warning' | 'error'; message: string | null; code: string | null })
  | (NotificationBase & { kind: 'unknown'; method: string });

const envelopeSchema = z.object({ eventId: z.number().int().positive().nullish(), sessionId: nullableString });

function diagnosticBody(params: Record<string, unknown>, key: string): { message: string | null; code: string | null } {
  const nested = params[key];
  const source = nested !== null && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : params;
  return { message: typeof source.message === 'string' ? source.message : null, code: typeof source.code === 'string' ? source.code : null };
}

export function parseNotification(method: string, params: Record<string, unknown>): ServerNotification {
  const context = `notification ${method}`;
  const envelope = parseWith(envelopeSchema, params, context);
  const base: NotificationBase = { eventId: envelope.eventId ?? null, sessionId: envelope.sessionId };
  switch (method) {
    case 'history/entryAdded': {
      const raw = parseWith(z.object({ turnId: nullableString, entry: z.unknown() }), params, context);
      return { ...base, kind: 'history/entryAdded', turnId: raw.turnId, entry: parseHistoryEntry(raw.entry, `${context}.entry`) };
    }
    case 'history/entryUpdated': {
      const raw = parseWith(z.object({ turnId: nullableString, entryId: z.string().min(1), patch: z.array(patchOpSchema) }), params, context);
      return { ...base, kind: 'history/entryUpdated', turnId: raw.turnId, entryId: raw.entryId, patch: raw.patch };
    }
    case 'turn/started':
    case 'turn/completed': {
      const raw = parseWith(z.object({ turn: turnSchema }), params, context);
      return { ...base, kind: method, turn: raw.turn };
    }
    case 'session/statsUpdated': {
      const raw = parseWith(z.object({ stats: statsSchema, contextWindow: nullableNumber }), params, context);
      return { ...base, kind: 'session/statsUpdated', stats: raw.stats, contextWindow: raw.contextWindow };
    }
    case 'session/compacted':
    case 'session/contextCleared': {
      const raw = parseWith(z.object({ sessionId: z.string().min(1), oldSessionId: z.string().min(1) }), params, context);
      return { ...base, kind: method, newSessionId: raw.sessionId, oldSessionId: raw.oldSessionId };
    }
    case 'turn/retrying':
      return { ...base, kind: 'turn/retrying' };
    case 'warning':
    case 'error':
      return { ...base, kind: method, ...diagnosticBody(params, method) };
    default:
      return { ...base, kind: 'unknown', method };
  }
}

export interface ApprovalRequest {
  callbackId: string;
  entryId: string;
  relatedEntryId: string | null;
  detailKind: string | null;
  effect: EffectDetail | null;
}

export function parseCallbackCall(params: Record<string, unknown>): ApprovalRequest {
  const raw = parseWith(z.object({ callback: z.unknown() }), params, 'callback/call params');
  const entry = parseHistoryEntry(raw.callback, 'callback/call params.callback');
  if (entry.kind !== 'callback') throw new ProtocolParseError('callback/call params', [{ path: 'callback.type', message: 'entry is not a callback' }]);
  return { callbackId: entry.callbackId, entryId: entry.id, relatedEntryId: entry.relatedEntryId, detailKind: entry.detailKind, effect: entry.effect };
}

export function serverErrorIssues(data: unknown): ProtocolIssue[] {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return [];
  const issues = (data as Record<string, unknown>).issues;
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 50).flatMap((issue): ProtocolIssue[] => {
    if (issue === null || typeof issue !== 'object') return [];
    const record = issue as Record<string, unknown>;
    const path = Array.isArray(record.path) ? record.path.map(String).join('.') : '';
    return [{ path, message: typeof record.message === 'string' ? record.message.slice(0, 200) : '' }];
  });
}

export function isProtocolErrorCode(value: string): value is ProtocolErrorCode {
  return (PROTOCOL_ERROR_CODES as readonly string[]).includes(value);
}
