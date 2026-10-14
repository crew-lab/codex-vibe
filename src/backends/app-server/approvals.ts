import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RunMode } from '../../contracts.js';
import { isPathWithinRoot } from '../../security/paths.js';
import type { JsonObject } from './jsonrpc.js';
import { callbackAcknowledgement, effectFilePath, parseCallbackCall, type ApprovalDecisionType, type ApprovalRequest } from './protocol.js';

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
  | 'path_symlink'
  | 'decision_deadline'
  | 'duplicate_callback'
  | 'ledger_full'
  | 'policy_error';

export interface ApprovalVerdict {
  decision: ApprovalDecisionType;
  reason: DenyReason | null;
}

export interface ApprovalRecord {
  callbackId: string;
  relatedEntryId: string | null;
  tool: string | null;
  path: string | null;
  decision: ApprovalDecisionType;
  reason: DenyReason | null;
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

function patternToExpression(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`, 'i');
}

const SENSITIVE_EXPRESSIONS = SENSITIVE_FILE_PATTERNS.map(patternToExpression);
const RESERVED_NAMES = new Set([...RESERVED_DIRECTORIES, ...RESERVED_FILES].map((name) => name.toLowerCase()));

function restrictedSegment(segments: readonly string[]): 'path_reserved' | 'path_secret' | null {
  for (const segment of segments) if (RESERVED_NAMES.has(segment.toLowerCase())) return 'path_reserved';
  for (const segment of segments) if (SENSITIVE_EXPRESSIONS.some((expression) => expression.test(segment))) return 'path_secret';
  return null;
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
  | { allowed: false; reason: 'path_invalid' | 'path_unresolvable' | 'path_outside_workspace' | 'path_reserved' | 'path_secret' | 'path_symlink' };

export async function judgeWorkspacePath(workspace: string, rawPath: string): Promise<PathJudgement> {
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
  return { allowed: true, resolved: located.resolved, relative };
}

export async function evaluateApproval(options: { mode: RunMode; workspace: string }, request: ApprovalRequest): Promise<ApprovalVerdict> {
  const deny = (reason: DenyReason): ApprovalVerdict => ({ decision: 'deny', reason });
  if (request.detailKind !== 'approval') return deny('unsupported_callback');
  const effect = request.effect;
  if (!effect) return deny('missing_effect');
  if (!isProfileTool(options.mode, effect.toolName)) return deny('tool_not_in_profile');
  if (effect.kind !== EFFECT_KIND_BY_TOOL[effect.toolName]) return deny('effect_kind_mismatch');
  const filePath = effectFilePath(effect.input);
  if (filePath === null) return deny('missing_file_path');
  const judgement = await judgeWorkspacePath(options.workspace, filePath);
  return judgement.allowed ? { decision: 'approve', reason: null } : deny(judgement.reason);
}

export class ApprovalLedger {
  private readonly byCallback = new Map<string, ApprovalRecord>();
  private readonly byEffect = new Map<string, ApprovalRecord>();

  constructor(private readonly maxRecords = DEFAULT_MAX_LEDGER_RECORDS) {}

  get size(): number {
    return this.byCallback.size;
  }

  has(callbackId: string): boolean {
    return this.byCallback.has(callbackId);
  }

  isFull(): boolean {
    return this.byCallback.size >= this.maxRecords;
  }

  record(record: ApprovalRecord): boolean {
    if (this.isFull() || this.byCallback.has(record.callbackId)) return false;
    this.byCallback.set(record.callbackId, record);
    if (record.relatedEntryId !== null) this.byEffect.set(record.relatedEntryId, record);
    return true;
  }

  forCallback(callbackId: string): ApprovalRecord | undefined {
    return this.byCallback.get(callbackId);
  }

  forEffect(entryId: string): ApprovalRecord | undefined {
    return this.byEffect.get(entryId);
  }

  all(): ApprovalRecord[] {
    return [...this.byCallback.values()];
  }
}

export interface ApprovalHandlerOptions {
  mode: RunMode;
  workspace: string;
  deadlineMs?: number;
  ledger?: ApprovalLedger;
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

export class ApprovalHandler {
  readonly ledger: ApprovalLedger;
  private readonly deadlineMs: number;
  private readonly evaluate: (request: ApprovalRequest) => Promise<ApprovalVerdict>;

  constructor(options: ApprovalHandlerOptions) {
    const deadlineMs = options.deadlineMs ?? DEFAULT_DECISION_DEADLINE_MS;
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new RangeError('deadlineMs must be a positive number');
    this.deadlineMs = deadlineMs;
    this.ledger = options.ledger ?? new ApprovalLedger();
    this.evaluate = options.evaluate ?? ((request) => evaluateApproval(options, request));
  }

  async decide(request: ApprovalRequest): Promise<ApprovalVerdict> {
    if (this.ledger.has(request.callbackId)) return { decision: 'deny', reason: 'duplicate_callback' };
    if (this.ledger.isFull()) return { decision: 'deny', reason: 'ledger_full' };
    const verdict = await withDeadline(this.evaluate(request), this.deadlineMs);
    const filePath = request.effect ? effectFilePath(request.effect.input) : null;
    const recorded = this.ledger.record({
      callbackId: request.callbackId,
      relatedEntryId: request.relatedEntryId,
      tool: request.effect?.toolName ?? null,
      path: filePath === null ? null : filePath.slice(0, MAX_RECORDED_PATH_CHARS),
      decision: verdict.decision,
      reason: verdict.reason
    });
    if (recorded) return verdict;
    return { decision: 'deny', reason: 'duplicate_callback' };
  }

  begin(params: JsonObject): PendingApproval {
    const request = parseCallbackCall(params);
    return {
      callbackId: request.callbackId,
      acknowledgement: callbackAcknowledgement(request.callbackId),
      verdict: this.decide(request)
    };
  }
}
