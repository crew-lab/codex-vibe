import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RunMode } from '../../contracts.js';
import { compileSegment, createExcludedMatcher, relativeSegments, type ExclusionSpec } from '../../security/globs.js';
import { isPathWithinRoot } from '../../security/paths.js';
import type { JsonObject } from './jsonrpc.js';
import { EFFECT_PATH_FIELD, callbackAcknowledgement, effectFilePath, parseCallbackCall, type ApprovalDecisionType, type ApprovalRequest } from './protocol.js';

export { anchorsOf, createExcludedMatcher, excludedRelativePath, type ExcludedMatcher, type ExclusionAnchor, type ExclusionSpec } from '../../security/globs.js';

export const REVIEW_TOOLS: readonly string[] = ['file_system.read_file'];
export const EDIT_TOOLS: readonly string[] = ['file_system.read_file', 'file_system.write_file', 'file_system.search_replace'];
export const WRITE_TOOLS: readonly string[] = ['file_system.write_file', 'file_system.search_replace'];

export const RESERVED_DIRECTORIES: readonly string[] = ['.git', '.vibe', '.agents'];
export const RESERVED_FILES: readonly string[] = ['.vibeignore'];
export const SENSITIVE_FILE_PATTERNS: readonly string[] = ['.env', '.env.*', '.envrc', '.envrc.*', '*.pem', '*.key', '*.p12', '*.pfx'];

export const DEFAULT_DECISION_DEADLINE_MS = 5000;
export const DEFAULT_MAX_LEDGER_RECORDS = 4096;
const MAX_PATH_CHARS = 4096;
const MAX_RECORDED_PATH_CHARS = 512;

const EFFECT_KIND_BY_TOOL: Readonly<Record<string, string>> = {
  'file_system.read_file': 'file_read',
  'file_system.write_file': 'file_write',
  'file_system.search_replace': 'file_edit'
};

export type DenyReason =
  | 'unsupported_callback'
  | 'missing_effect'
  | 'tool_not_in_profile'
  | 'effect_kind_mismatch'
  | 'missing_file_path'
  | 'path_invalid'
  | 'path_unresolvable'
  | 'path_outside_workspace'
  | 'path_reserved'
  | 'path_secret'
  | 'path_excluded'
  | 'path_symlink'
  | 'decision_deadline'
  | 'duplicate_callback'
  | 'ledger_full'
  | 'foreign_session'
  | 'unlinked_callback'
  | 'handler_revoked'
  | 'policy_error';

export interface ApprovalVerdict {
  decision: ApprovalDecisionType;
  reason: DenyReason | null;
}

export interface ApprovalRecord {
  callbackId: string;
  relatedEntryId: string | null;
  sessionId: string | null;
  turnId: string | null;
  tool: string | null;
  path: string | null;
  fingerprint: string | null;
  decision: ApprovalDecisionType;
  reason: DenyReason | null;
}

export interface ApprovalContext {
  sessionId: string | null;
  turnId: string | null;
}

const MAX_CANONICAL_DEPTH = 32;

function canonicalize(value: unknown, depth: number): unknown {
  if (depth > MAX_CANONICAL_DEPTH) throw new RangeError('input is nested too deeply to fingerprint');
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize((value as Record<string, unknown>)[key], depth + 1);
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, 0)) ?? 'null';
}

function normalizedChanges(input: Record<string, unknown>): unknown {
  const normalize = (change: unknown): unknown => {
    if (change === null || typeof change !== 'object' || Array.isArray(change)) return change;
    const record = change as Record<string, unknown>;
    return { oldString: record.oldString, newString: record.newString, replaceAll: record.replaceAll === true };
  };
  if (Array.isArray(input.changes)) return input.changes.map(normalize);
  return [normalize(input)];
}

export function inputFingerprint(tool: string, input: Record<string, unknown>): string | null {
  let material: unknown;
  switch (tool) {
    case 'file_system.read_file':
      material = { tool, filePath: input[EFFECT_PATH_FIELD] };
      break;
    case 'file_system.write_file':
      material = { tool, filePath: input[EFFECT_PATH_FIELD], content: input.content };
      break;
    case 'file_system.search_replace':
      material = { tool, filePath: input[EFFECT_PATH_FIELD], changes: normalizedChanges(input) };
      break;
    default:
      material = { tool, input };
  }
  try {
    return createHash('sha256').update(canonicalJson(material)).digest('hex');
  } catch {
    return null;
  }
}

export function profileTools(mode: RunMode): readonly string[] {
  return mode === 'edit' ? EDIT_TOOLS : REVIEW_TOOLS;
}

export function isProfileTool(mode: RunMode, tool: string): boolean {
  return profileTools(mode).includes(tool);
}

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOLS.includes(tool);
}

const SENSITIVE_MATCHERS = SENSITIVE_FILE_PATTERNS.map(compileSegment);
const RESERVED_NAMES = new Set([...RESERVED_DIRECTORIES, ...RESERVED_FILES].map((name) => name.toLowerCase()));

export function restrictedSegment(segments: readonly string[]): 'path_reserved' | 'path_secret' | null {
  const lowered = segments.map((segment) => segment.toLowerCase());
  for (const segment of lowered) if (RESERVED_NAMES.has(segment)) return 'path_reserved';
  for (const segment of lowered) if (SENSITIVE_MATCHERS.some((matches) => matches(segment))) return 'path_secret';
  return null;
}

export function restrictedRelativePath(relative: string): 'path_reserved' | 'path_secret' | null {
  return restrictedSegment(relativeSegments(relative));
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

type Located = { resolved: string } | { reason: 'path_unresolvable' | 'path_symlink' };

async function locate(absolute: string): Promise<Located> {
  try {
    return { resolved: await realpath(absolute) };
  } catch (error) {
    if (!isMissing(error)) return { reason: 'path_unresolvable' };
  }
  const { root } = path.parse(absolute);
  const parts = absolute.slice(root.length).split(/[\\/]+/).filter((part) => part !== '' && part !== '.');
  for (let keep = parts.length - 1; keep >= 0; keep -= 1) {
    let real: string;
    try {
      real = await realpath(`${root}${parts.slice(0, keep).join(path.sep)}`);
    } catch (error) {
      if (isMissing(error)) continue;
      return { reason: 'path_unresolvable' };
    }
    const remainder = parts.slice(keep);
    if (remainder.includes('..')) return { reason: 'path_unresolvable' };
    try {
      await lstat(path.join(real, remainder[0] ?? ''));
      return { reason: 'path_symlink' };
    } catch (error) {
      if (!isMissing(error)) return { reason: 'path_unresolvable' };
    }
    return { resolved: path.join(real, ...remainder) };
  }
  return { reason: 'path_unresolvable' };
}

export type PathJudgement =
  | { allowed: true; resolved: string; relative: string }
  | { allowed: false; reason: 'path_invalid' | 'path_unresolvable' | 'path_outside_workspace' | 'path_reserved' | 'path_secret' | 'path_excluded' | 'path_symlink' };

export async function judgeWorkspacePath(workspace: string, rawPath: string, excluded: readonly ExclusionSpec[] = []): Promise<PathJudgement> {
  if (!path.isAbsolute(workspace)) return { allowed: false, reason: 'path_invalid' };
  if (rawPath.length === 0 || rawPath.length > MAX_PATH_CHARS || rawPath.includes('\0') || rawPath.startsWith('~')) return { allowed: false, reason: 'path_invalid' };
  let root: string;
  try {
    root = await realpath(workspace);
  } catch {
    return { allowed: false, reason: 'path_unresolvable' };
  }
  const absolute = path.isAbsolute(rawPath) ? rawPath : `${workspace}${path.sep}${rawPath}`;
  const located = await locate(absolute);
  if ('reason' in located) return { allowed: false, reason: located.reason };
  if (!isPathWithinRoot(root, located.resolved)) return { allowed: false, reason: 'path_outside_workspace' };
  const relative = path.relative(root, located.resolved);
  if (relative === '') return { allowed: false, reason: 'path_invalid' };
  const lexical = path.relative(workspace, path.resolve(absolute));
  const lexicalSegments = lexical === '' || lexical.startsWith('..') || path.isAbsolute(lexical) ? [] : lexical.split(path.sep);
  const restricted = restrictedSegment([...relative.split(path.sep), ...lexicalSegments]);
  if (restricted) return { allowed: false, reason: restricted };
  const isExcluded = createExcludedMatcher(excluded);
  if (isExcluded(relative.split(path.sep)) || (lexicalSegments.length > 0 && isExcluded(lexicalSegments))) return { allowed: false, reason: 'path_excluded' };
  return { allowed: true, resolved: located.resolved, relative };
}

export async function evaluateApproval(options: { mode: RunMode; workspace: string; excludedGlobs?: readonly ExclusionSpec[] }, request: ApprovalRequest): Promise<ApprovalVerdict> {
  const deny = (reason: DenyReason): ApprovalVerdict => ({ decision: 'deny', reason });
  if (request.detailKind !== 'approval') return deny('unsupported_callback');
  const effect = request.effect;
  if (!effect) return deny('missing_effect');
  if (!isProfileTool(options.mode, effect.toolName)) return deny('tool_not_in_profile');
  if (effect.kind !== EFFECT_KIND_BY_TOOL[effect.toolName]) return deny('effect_kind_mismatch');
  const filePath = effectFilePath(effect.input);
  if (filePath === null) return deny('missing_file_path');
  const judgement = await judgeWorkspacePath(options.workspace, filePath, options.excludedGlobs ?? []);
  return judgement.allowed ? { decision: 'approve', reason: null } : deny(judgement.reason);
}

export type LedgerOutcome = 'recorded' | 'duplicate' | 'full';

export class ApprovalLedger {
  private readonly entries: ApprovalRecord[] = [];
  private readonly byCallback = new Map<string, ApprovalRecord>();
  private readonly byEffect = new Map<string, ApprovalRecord>();
  private readonly pending = new Set<string>();
  private overflowed = false;

  constructor(private readonly maxRecords = DEFAULT_MAX_LEDGER_RECORDS) {}

  get size(): number {
    return this.entries.length;
  }

  get pendingCallbacks(): number {
    return this.pending.size;
  }

  get truncated(): boolean {
    return this.overflowed;
  }

  has(callbackId: string): boolean {
    return this.byCallback.has(callbackId);
  }

  isFull(): boolean {
    return this.entries.length >= this.maxRecords;
  }

  noteOverflow(): void {
    this.overflowed = true;
  }

  open(callbackId: string): void {
    this.pending.add(callbackId);
  }

  close(callbackId: string): void {
    this.pending.delete(callbackId);
  }

  admit(record: ApprovalRecord): LedgerOutcome {
    if (this.byCallback.has(record.callbackId)) return 'duplicate';
    if (record.relatedEntryId !== null && this.byEffect.has(record.relatedEntryId)) return 'duplicate';
    if (this.isFull()) {
      this.overflowed = true;
      return 'full';
    }
    this.entries.push(record);
    this.byCallback.set(record.callbackId, record);
    if (record.relatedEntryId !== null) this.byEffect.set(record.relatedEntryId, record);
    return 'recorded';
  }

  record(record: ApprovalRecord): boolean {
    return this.admit(record) === 'recorded';
  }

  recordDuplicate(record: ApprovalRecord): void {
    if (this.isFull()) {
      this.overflowed = true;
      return;
    }
    this.entries.push({ ...record, decision: 'deny', reason: 'duplicate_callback' });
  }

  forCallback(callbackId: string): ApprovalRecord | undefined {
    return this.byCallback.get(callbackId);
  }

  forEffect(entryId: string): ApprovalRecord | undefined {
    return this.byEffect.get(entryId);
  }

  all(): ApprovalRecord[] {
    return [...this.entries];
  }
}

export interface ApprovalHandlerOptions {
  mode: RunMode;
  workspace: string;
  excludedGlobs?: readonly ExclusionSpec[];
  deadlineMs?: number;
  ledger?: ApprovalLedger;
  currentSessionId?: () => string;
  evaluate?: (request: ApprovalRequest) => Promise<ApprovalVerdict>;
}

export interface PendingApproval {
  callbackId: string;
  acknowledgement: { callbackId: string; accepted: true };
  verdict: Promise<ApprovalVerdict>;
}

function withDeadline(work: Promise<ApprovalVerdict>, deadlineMs: number): Promise<ApprovalVerdict> {
  return new Promise<ApprovalVerdict>((resolve) => {
    const timer = setTimeout(() => resolve({ decision: 'deny', reason: 'decision_deadline' }), deadlineMs);
    work.then(
      (verdict) => { clearTimeout(timer); resolve(verdict); },
      () => { clearTimeout(timer); resolve({ decision: 'deny', reason: 'policy_error' }); }
    );
  });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function callbackContext(params: JsonObject): ApprovalContext {
  const callback = params.callback;
  if (callback === null || typeof callback !== 'object' || Array.isArray(callback)) return { sessionId: null, turnId: null };
  const record = callback as Record<string, unknown>;
  return { sessionId: nonEmptyString(record.sessionId), turnId: nonEmptyString(record.turnId) };
}

export class ApprovalHandler {
  readonly ledger: ApprovalLedger;
  private readonly deadlineMs: number;
  private readonly currentSessionId: (() => string) | undefined;
  private readonly evaluate: (request: ApprovalRequest) => Promise<ApprovalVerdict>;
  private revoked = false;

  constructor(options: ApprovalHandlerOptions) {
    const deadlineMs = options.deadlineMs ?? DEFAULT_DECISION_DEADLINE_MS;
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new RangeError('deadlineMs must be a positive number');
    this.deadlineMs = deadlineMs;
    this.ledger = options.ledger ?? new ApprovalLedger();
    this.currentSessionId = options.currentSessionId;
    this.evaluate = options.evaluate ?? ((request) => evaluateApproval(options, request));
  }

  get isRevoked(): boolean {
    return this.revoked;
  }

  revoke(): void {
    this.revoked = true;
  }

  settle(callbackId: string): void {
    this.ledger.close(callbackId);
  }

  private async judge(request: ApprovalRequest, context: ApprovalContext, expectedSession: string | null): Promise<ApprovalVerdict> {
    if (this.revoked) return { decision: 'deny', reason: 'handler_revoked' };
    if (expectedSession !== null && context.sessionId !== null && context.sessionId !== expectedSession) return { decision: 'deny', reason: 'foreign_session' };
    const verdict = await withDeadline(this.evaluate(request), this.deadlineMs);
    if (this.revoked) return { decision: 'deny', reason: 'handler_revoked' };
    if (verdict.decision === 'approve' && request.relatedEntryId === null) return { decision: 'deny', reason: 'unlinked_callback' };
    return verdict;
  }

  private entryFor(request: ApprovalRequest, context: ApprovalContext, expectedSession: string | null, verdict: ApprovalVerdict): ApprovalRecord {
    const filePath = request.effect ? effectFilePath(request.effect.input) : null;
    return {
      callbackId: request.callbackId,
      relatedEntryId: request.relatedEntryId,
      sessionId: context.sessionId ?? expectedSession,
      turnId: context.turnId,
      tool: request.effect?.toolName ?? null,
      path: filePath === null ? null : filePath.slice(0, MAX_RECORDED_PATH_CHARS),
      fingerprint: request.effect ? inputFingerprint(request.effect.toolName, request.effect.input) : null,
      decision: verdict.decision,
      reason: verdict.reason
    };
  }

  async decide(request: ApprovalRequest, context: ApprovalContext = { sessionId: null, turnId: null }): Promise<ApprovalVerdict> {
    const duplicate: ApprovalVerdict = { decision: 'deny', reason: 'duplicate_callback' };
    if (this.ledger.has(request.callbackId)) {
      this.ledger.recordDuplicate(this.entryFor(request, context, this.currentSessionId?.() ?? null, duplicate));
      return duplicate;
    }
    if (this.ledger.isFull()) {
      this.ledger.noteOverflow();
      return { decision: 'deny', reason: 'ledger_full' };
    }
    const expectedSession = this.currentSessionId?.() ?? null;
    const verdict = await this.judge(request, context, expectedSession);
    const entry = this.entryFor(request, context, expectedSession, verdict);
    const outcome = this.ledger.admit(entry);
    if (outcome === 'recorded') return verdict;
    if (outcome === 'full') return { decision: 'deny', reason: 'ledger_full' };
    this.ledger.recordDuplicate(entry);
    return duplicate;
  }

  begin(params: JsonObject): PendingApproval {
    const request = parseCallbackCall(params);
    this.ledger.open(request.callbackId);
    return {
      callbackId: request.callbackId,
      acknowledgement: callbackAcknowledgement(request.callbackId),
      verdict: this.decide(request, callbackContext(params))
    };
  }
}
