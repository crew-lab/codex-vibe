import { createHash } from 'node:crypto';
import type { RunMode } from '../../contracts.js';
import { supervisorError } from '../../contracts.js';
import { checkedPath } from './path-policy.js';
import { object, string, array, type JsonObject } from './protocol.js';
import { grepSchema, listFilesSchema } from './search.js';

const NAMES: Readonly<Record<string, string>> = {
  read_file: 'read_file', 'file_system.read_file': 'read_file',
  write_file: 'write_file', 'file_system.write_file': 'write_file',
  edit: 'edit', 'file_system.search_replace': 'edit',
  supervisor_search_grep: 'grep', 'mcp_supervisor_search.grep': 'grep',
  supervisor_search_list_files: 'list_files', 'mcp_supervisor_search.list_files': 'list_files',
};

export function toolName(value: unknown): string | undefined {
  return typeof value === 'string' && Object.hasOwn(NAMES, value) ? NAMES[value] : undefined;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

function fingerprint(detail: JsonObject): string {
  return createHash('sha256').update(JSON.stringify(canonical({ tool: detail.toolName, kind: detail.kind, input: detail.input }))).digest('hex');
}
export function historicalEffectFingerprint(entry: JsonObject): string {
  return createHash('sha256').update(JSON.stringify(canonical({ id: entry.id, turnId: entry.turnId, createdAt: entry.createdAt, updatedAt: entry.updatedAt, detail: entry.detail, state: entry.state }))).digest('hex');
}

export interface ApprovalAnswer { callbackId: string; sessionId: string; output?: JsonObject; error?: { message: string }; approved: boolean }

/** Grants are tied to an explicitly linked live effect, one turn, and one offered decision. */
export class ApprovalPolicy {
  private readonly effects = new Map<string, JsonObject>();
  private readonly answered = new Set<string>();
  private readonly grants = new Map<string, string>();
  private readonly callbackGrants = new Map<string, string>();
  private stopped = false;
  constructor(private readonly root: string, private readonly mode: RunMode, private sessionId: string, private turnId: string) {}

  stop(): void { this.stopped = true; }
  revoke(callbackId: string): void {
    const effect = this.callbackGrants.get(callbackId);
    if (effect) this.grants.delete(effect);
    this.callbackGrants.delete(callbackId);
  }

  record(entry: unknown): void {
    const value = object(entry, 'effect entry');
    if (value.type !== 'effect' || value.sessionId !== this.sessionId || value.turnId !== this.turnId) throw supervisorError('VSUP_BACKEND_ERROR', 'Effect is outside the active session and turn.');
    const id = string(value.id, 'effect id');
    const detail = object(value.detail, 'effect detail');
    const state = object(value.state, 'effect state');
    if (!['pending', 'running', 'blocked', 'completed', 'failed', 'cancelled', 'skipped'].includes(state.status as string)) throw supervisorError('VSUP_BACKEND_ERROR', 'Unknown tool effect state.');
    const granted = this.grants.get(id);
    if (granted && granted !== fingerprint(detail)) throw supervisorError('VSUP_BACKEND_ERROR', 'Effect changed after invocation approval.');
    const name = toolName(detail.toolName);
    const permitted = name !== undefined && (this.mode === 'edit' || !['write_file', 'edit'].includes(name));
    const executed = (state.status === 'completed' && state.decision !== 'skip') || state.decision === 'execute';
    if (!permitted && executed) throw supervisorError('VSUP_BACKEND_ERROR', 'A prohibited tool was executed.');
    if (permitted && executed && !granted) throw supervisorError('VSUP_BACKEND_ERROR', 'A tool executed without a correlated invocation approval.');
    if (!this.effects.has(id) && this.effects.size >= 4096) throw supervisorError('VSUP_OUTPUT_LIMIT', 'Effect correlation limit exceeded.');
    this.effects.set(id, structuredClone(value));
  }

  async decide(callback: unknown, timeoutMs = 5000): Promise<ApprovalAnswer> {
    const value = object(callback, 'callback');
    const callbackId = string(value.callbackId, 'callback id');
    const sessionId = string(value.sessionId, 'callback session');
    const deny: ApprovalAnswer = { callbackId, sessionId, approved: false, output: { type: 'approval', decision: { type: 'deny' }, feedback: null } };
    if (this.answered.has(callbackId)) return deny;
    if (this.answered.size >= 4096) throw supervisorError('VSUP_OUTPUT_LIMIT', 'Callback correlation limit exceeded.');
    this.answered.add(callbackId);
    const detail = object(value.detail, 'callback detail');
    if (value.type !== 'callback' || sessionId !== this.sessionId || value.turnId !== this.turnId || object(value.state, 'callback state').status !== 'open' || detail.kind !== 'approval') {
      return { callbackId, sessionId, approved: false, error: { message: 'Unsupported or stale callback refused.' } };
    }
    const choices = array(detail.choices, 'approval choices');
    if (!choices.includes('deny')) return { callbackId, sessionId, approved: false, error: { message: 'No supported denial choice offered.' } };
    if (this.stopped || !choices.includes('approve')) return deny;
    const effect = object(detail.effect, 'callback effect');
    const digest = fingerprint(effect);
    const related = detail.relatedEntryId ?? value.relatedEntryId;
    if (typeof related !== 'string' || related.length === 0) return deny;
    const matches = [...this.effects.entries()].filter(([id, entry]) => {
      const state = object(entry.state);
      const live = state.status === 'running' || (state.status === 'blocked' && state.callbackId === callbackId);
      return live && related === id && state.decision !== 'execute' && fingerprint(object(entry.detail)) === digest;
    });
    if (matches.length !== 1) return deny;
    const name = toolName(effect.toolName);
    if (name === undefined || (this.mode === 'review' && ['write_file', 'edit'].includes(name))) return deny;
    let timer: NodeJS.Timeout | undefined;
    const permitted = await Promise.race([
      this.validateInput(name, effect).catch(() => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), Math.min(5000, Math.max(0, timeoutMs))); }),
    ]);
    if (timer) clearTimeout(timer);
    if (!permitted || this.stopped) return deny;
    const id = matches[0]![0];
    if (this.grants.has(id)) return deny;
    // Recheck against updates that arrived while filesystem validation awaited.
    const current = this.effects.get(id);
    if (!current) return deny;
    const state = object(current.state);
    if (!(state.status === 'running' || (state.status === 'blocked' && state.callbackId === callbackId)) || state.decision === 'execute' || fingerprint(object(current.detail)) !== digest) return deny;
    this.grants.set(id, digest);
    this.callbackGrants.set(callbackId, id);
    return { callbackId, sessionId, approved: true, output: { type: 'approval', decision: { type: 'approve' }, feedback: null } };
  }

  private async validateInput(name: string, detail: JsonObject): Promise<boolean> {
    const input = object(detail.input, 'tool input');
    if (name === 'grep' || name === 'list_files') {
      if (detail.kind !== 'tool') return false;
      const parsed = name === 'grep' ? grepSchema.parse(input) : listFilesSchema.parse(input);
      await checkedPath(this.root, parsed.path);
      return true;
    }
    const kind = name === 'read_file' ? 'file_read' : name === 'write_file' ? 'file_write' : 'file_edit';
    if (detail.kind !== kind || typeof input.filePath !== 'string') return false;
    if (name === 'write_file' && typeof input.content !== 'string') return false;
    if (name === 'edit') {
      const changes = Array.isArray(input.changes) ? input.changes : [input];
      if (changes.length === 0 || changes.some(change => {
        const value = object(change); return typeof value.oldString !== 'string' || typeof value.newString !== 'string' || (value.replaceAll !== undefined && typeof value.replaceAll !== 'boolean');
      })) return false;
    }
    await checkedPath(this.root, input.filePath, name === 'write_file');
    return true;
  }
}
