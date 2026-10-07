import { McpServer } from '@modelcontextprotocol/server';
import { supervisorError, type SupervisorError, type SupervisorErrorCode, type ReviewStartToolInput, type EditStartToolInput, type StatusToolInput, type ContinueToolInput, type RespondToolInput, type ResultToolInput, type CancelToolInput, type CloseToolInput, type McpResultFormat, type WaitOptions } from '../contracts.js';
import { toolSchemas, type ToolName } from './schemas.js';
import { sanitizeForPersistence } from '../persistence/atomic.js';
import { describeFailure } from '../diagnostics/background.js';

/** Narrow adapter expected from the run manager; MCP owns validation and wire shaping. */
export interface RunManagerTools {
  reviewStart(input: ReviewStartToolInput, options?: WaitOptions): Promise<unknown>;
  editStart(input: EditStartToolInput, options?: WaitOptions): Promise<unknown>;
  status(input: StatusToolInput, options?: WaitOptions): Promise<unknown>;
  continue(input: ContinueToolInput): Promise<unknown>;
  respond(input: RespondToolInput): Promise<unknown>;
  result(input: ResultToolInput): Promise<unknown>;
  cancel(input: CancelToolInput): Promise<unknown>;
  close(input: CloseToolInput): Promise<unknown>;
}

export interface ToolRegistrationOptions {
  maxResultChars: number;
  resultFormat: McpResultFormat;
  onError?: (error: SupervisorError) => void;
}

const DEFINITIONS: Record<ToolName, { title: string; description: string; readOnly: boolean; destructive: boolean }> = {
  vibe_review_start: { title: 'Start read-only Vibe review', description: 'Start an independent review run in the selected workspace. Set wait_seconds to wait for the run to need action.', readOnly: false, destructive: false },
  vibe_edit_start: { title: 'Start isolated Vibe edit', description: 'Start an edit run in a detached Git worktree. Review its patch before applying it. Set wait_seconds to wait for the run to need action.', readOnly: false, destructive: true },
  vibe_status: { title: 'Get Vibe run status', description: 'Read run state and recent normalized events; a finished run includes its compact result. Set wait_seconds to block until something changes instead of polling.', readOnly: true, destructive: false },
  vibe_continue: { title: 'Continue Vibe run', description: 'Send a follow-up instruction to an active run.', readOnly: false, destructive: false },
  vibe_respond: { title: 'Respond to Vibe request', description: 'Answer a pending permission or input request.', readOnly: false, destructive: false },
  vibe_result: { title: 'Get Vibe result', description: 'Read the full record with detail=full, or the transcript; a finished run already carries its compact result in vibe_status.', readOnly: true, destructive: false },
  vibe_cancel: { title: 'Cancel Vibe run', description: 'Request cancellation of an active run.', readOnly: false, destructive: false },
  vibe_close: { title: 'Close Vibe run', description: 'Close a run and optionally remove its verified worktree.', readOnly: false, destructive: true },
};

function normalizeError(error: unknown): SupervisorError {
  if (error && typeof error === 'object') {
    const value = error as { supervisor?: unknown; code?: unknown; message?: unknown; retryable?: unknown; details?: unknown };
    if (value.supervisor && typeof value.supervisor === 'object' && 'code' in value.supervisor) return value.supervisor as SupervisorError;
    if (typeof value.code === 'string' && value.code.startsWith('VSUP_')) {
      const message = typeof value.message === 'string' ? value.message : 'The request could not be completed.';
      return supervisorError(value.code as SupervisorErrorCode, message, isRecord(value.details) ? value.details : undefined, value.retryable === true);
    }
  }
  return supervisorError('VSUP_INTERNAL', 'The request could not be completed.');
}

type JsonRecord = Record<string, unknown>;

const SUMMARY_MARKER = '\n… [summary truncated: middle omitted] …\n';

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function capTail(value: string, limit: number): string {
  return value.length <= limit ? value : `… [truncated] ${value.slice(value.length - limit)}`;
}

function capHead(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)} … [truncated]`;
}

function capSummary(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const budget = Math.max(0, limit - SUMMARY_MARKER.length);
  const head = Math.ceil(budget * 0.6);
  return `${value.slice(0, head)}${SUMMARY_MARKER}${value.slice(value.length - (budget - head))}`;
}

function trimList(scope: JsonRecord, key: string, totalKey: string, keep: number): boolean {
  const list = scope[key];
  if (!Array.isArray(list) || list.length <= keep) return false;
  if (typeof scope[totalKey] !== 'number') scope[totalKey] = list.length;
  scope[key] = key === 'events' ? list.slice(-keep) : list.slice(0, keep);
  return true;
}

function reduceOnce(scope: JsonRecord, step: number, maxChars: number, excess: number): string[] {
  const done: string[] = [];
  if (step === 0 && typeof scope.patch === 'string') {
    const artifacts = Array.isArray(scope.artifacts) ? scope.artifacts.filter(isRecord) : [];
    const patchPath = artifacts.find((artifact) => artifact.name === 'diff.patch')?.path;
    if (scope.patch_path === undefined && typeof patchPath === 'string') scope.patch_path = patchPath;
    if (scope.patch_bytes === undefined) scope.patch_bytes = Buffer.byteLength(scope.patch);
    delete scope.patch;
    done.push('patch');
  } else if (step === 1 && typeof scope.transcript === 'string' && scope.transcript.length > Math.floor(maxChars / 8)) {
    scope.transcript = capTail(scope.transcript, Math.floor(maxChars / 8)); scope.transcript_truncated = true;
    done.push('transcript');
  } else if (step === 2 && typeof scope.diff_stat === 'string' && scope.diff_stat.length > Math.floor(maxChars / 16)) {
    scope.diff_stat = capHead(scope.diff_stat, Math.floor(maxChars / 16));
    done.push('diff_stat');
  } else if (step === 3) {
    if (trimList(scope, 'changed_files', 'changed_files_total', 10)) done.push('changed_files');
    if (trimList(scope, 'changedFiles', 'changedFilesTotal', 10)) done.push('changedFiles');
    if (trimList(scope, 'events', 'events_total', 10)) done.push('events');
    for (const key of ['text', 'output', 'preview']) if (typeof scope[key] === 'string' && (scope[key] as string).length > Math.floor(maxChars / 4)) { scope[key] = capHead(scope[key] as string, Math.floor(maxChars / 4)); done.push(key); }
  } else if (step === 4 && typeof scope.summary === 'string' && scope.summary.length > SUMMARY_MARKER.length + 200) {
    scope.summary = capSummary(scope.summary, Math.max(SUMMARY_MARKER.length + 200, scope.summary.length - excess - 64));
    done.push('summary');
  }
  return done;
}

function emergency(object: JsonRecord, reduced: JsonRecord, fields: string[], maxChars: number): string {
  const nested = isRecord(reduced.result) ? reduced.result : {};
  const compact: JsonRecord = { truncated: true, run_id: object.run_id ?? object.runId ?? '', ...(object.state === undefined ? {} : { state: object.state }) };
  const tryAdd = (key: string, value: unknown): void => {
    if (value === undefined) return;
    compact[key] = value;
    if (JSON.stringify(compact).length > maxChars) delete compact[key];
  };
  for (const key of ['error', 'warnings', 'integrity', 'patch_path', 'pending_request', 'next_action']) tryAdd(key, reduced[key] ?? nested[key]);
  const artifacts = Array.isArray(reduced.artifacts) ? reduced.artifacts : Array.isArray(nested.artifacts) ? nested.artifacts : [];
  if (artifacts.length) tryAdd('artifacts', artifacts.slice(0, 1).filter(isRecord).map((artifact) => ({ name: artifact.name, path: artifact.path, sha256: artifact.sha256 })));
  tryAdd('truncated_fields', fields.slice(0, 20));
  const result = JSON.stringify(compact);
  return result.length > maxChars ? JSON.stringify({ truncated: true, run_id: object.run_id ?? object.runId ?? '' }) : result;
}

export function bounded(value: unknown, maxChars: number): { structuredContent: Record<string, unknown>; text: string } {
  const safe = sanitizeForPersistence(value);
  const object = isRecord(safe) ? safe : { result: safe };
  const serialized = JSON.stringify(object);
  if (serialized.length <= maxChars) return { structuredContent: object, text: serialized };
  const fields: string[] = [];
  const reduced: JsonRecord = { ...object };
  if (isRecord(reduced.result)) reduced.result = { ...reduced.result };
  reduced.truncated = true; reduced.truncated_fields = fields;
  const scopes: [string, JsonRecord][] = [['', reduced]];
  if (isRecord(reduced.result)) scopes.push(['result.', reduced.result]);
  const measure = () => JSON.stringify(reduced).length;
  search: for (let step = 0; step <= 4; step += 1) {
    for (const [prefix, scope] of scopes) {
      const excess = measure() - maxChars;
      if (excess <= 0) break search;
      for (const field of reduceOnce(scope, step, maxChars, excess)) fields.push(`${prefix}${field}`);
    }
  }
  let result = JSON.stringify(reduced);
  if (result.length > maxChars) result = emergency(object, reduced, fields, maxChars);
  return { structuredContent: JSON.parse(result) as Record<string, unknown>, text: result };
}

function pointerText(structured: Record<string, unknown>): string {
  const pointer: Record<string, unknown> = {};
  for (const key of ['run_id', 'state']) if (typeof structured[key] === 'string') pointer[key] = structured[key];
  const error = structured.error;
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') pointer.error = (error as { code: string }).code;
  pointer.see = 'structuredContent';
  return JSON.stringify(pointer);
}

function shapeResult(structured: Record<string, unknown>, text: string, format: McpResultFormat): { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown> } {
  if (format === 'text') return { content: [{ type: 'text', text }] };
  if (format === 'structured') return { content: [{ type: 'text', text: pointerText(structured) }], structuredContent: structured };
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

interface ToolContext { mcpReq?: { signal?: AbortSignal } }

export function registerSupervisorTools(server: McpServer, manager: RunManagerTools, options: ToolRegistrationOptions): void {
  const handlers: Record<ToolName, (input: Record<string, unknown>, wait: WaitOptions) => Promise<unknown>> = {
    vibe_review_start: (input, wait) => manager.reviewStart(input as unknown as ReviewStartToolInput, wait),
    vibe_edit_start: (input, wait) => manager.editStart(input as unknown as EditStartToolInput, wait),
    vibe_status: (input, wait) => manager.status(input as unknown as StatusToolInput, wait),
    vibe_continue: (input) => manager.continue(input as unknown as ContinueToolInput),
    vibe_respond: (input) => manager.respond(input as unknown as RespondToolInput),
    vibe_result: (input) => manager.result(input as unknown as ResultToolInput),
    vibe_cancel: (input) => manager.cancel(input as unknown as CancelToolInput),
    vibe_close: (input) => manager.close(input as unknown as CloseToolInput),
  };
  for (const name of Object.keys(toolSchemas) as ToolName[]) {
    const definition = DEFINITIONS[name];
    server.registerTool(name, {
      title: definition.title,
      description: definition.description,
      inputSchema: toolSchemas[name],
      annotations: {
        readOnlyHint: definition.readOnly,
        destructiveHint: definition.destructive,
        idempotentHint: name === 'vibe_status' || name === 'vibe_result',
        openWorldHint: name === 'vibe_review_start' || name === 'vibe_edit_start' || name === 'vibe_continue' || name === 'vibe_respond',
      },
    }, async (input: unknown, context: ToolContext) => {
      try {
        // The SDK validates registered schemas as well; parse here for strict, stable errors before dispatch.
        const parsed = toolSchemas[name].parse(input) as Record<string, unknown>;
        const signal = context?.mcpReq?.signal;
        const result = await handlers[name](parsed, signal ? { signal } : {});
        const output = bounded(result, options.maxResultChars);
        return shapeResult(output.structuredContent, output.text, options.resultFormat);
      } catch (cause) {
        const error = cause && typeof cause === 'object' && 'issues' in cause
          ? supervisorError('VSUP_INVALID_ARGUMENT', 'Tool arguments failed schema validation.')
          : normalizeError(cause);
        const safeError = sanitizeForPersistence(error) as SupervisorError;
        if (JSON.stringify({ error: safeError }).length > options.maxResultChars) {
          safeError.message = `${safeError.message.slice(0, Math.max(0, Math.floor(options.maxResultChars / 4)))}… [truncated]`;
          delete safeError.details;
        }
        if (JSON.stringify({ error: safeError }).length > options.maxResultChars) safeError.message = 'The request failed; inspect the stable code and remediation.';
        options.onError?.(safeError.code === 'VSUP_INTERNAL' ? { ...safeError, message: `${safeError.message} Cause: ${describeFailure(cause)}` } : safeError);
        const text = `${safeError.code}: ${safeError.message} ${safeError.remediation}`.slice(0, options.maxResultChars);
        return { isError: true, ...shapeResult({ error: safeError }, text, options.resultFormat) };
      }
    });
  }
}
