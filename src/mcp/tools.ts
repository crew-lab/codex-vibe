import { McpServer } from '@modelcontextprotocol/server';
import { supervisorError, type SupervisorError, type SupervisorErrorCode, type ReviewStartToolInput, type EditStartToolInput, type StatusToolInput, type ContinueToolInput, type RespondToolInput, type ResultToolInput, type CancelToolInput, type CloseToolInput, type McpResultFormat, type WaitOptions } from '../contracts.js';
import { toolSchemas, type ToolName } from './schemas.js';
import { sanitizeForPersistence } from '../persistence/atomic.js';

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
  vibe_status: { title: 'Get Vibe run status', description: 'Read run state and recent normalized events. Set wait_seconds to block until something changes instead of polling.', readOnly: true, destructive: false },
  vibe_continue: { title: 'Continue Vibe run', description: 'Send a follow-up instruction to an active run.', readOnly: false, destructive: false },
  vibe_respond: { title: 'Respond to Vibe request', description: 'Answer a pending permission or input request.', readOnly: false, destructive: false },
  vibe_result: { title: 'Get Vibe result', description: 'Read the compact run result (default) or the full record with detail=full.', readOnly: true, destructive: false },
  vibe_cancel: { title: 'Cancel Vibe run', description: 'Request cancellation of an active run.', readOnly: false, destructive: false },
  vibe_close: { title: 'Close Vibe run', description: 'Close a run and optionally remove its verified worktree.', readOnly: false, destructive: true },
};

function normalizeError(error: unknown): SupervisorError {
  if (error && typeof error === 'object') {
    const value = error as { supervisor?: unknown; code?: unknown; message?: unknown; retryable?: unknown };
    if (value.supervisor && typeof value.supervisor === 'object' && 'code' in value.supervisor) return value.supervisor as SupervisorError;
    if (typeof value.code === 'string' && value.code.startsWith('VSUP_')) {
      const message = typeof value.message === 'string' ? value.message : 'The request could not be completed.';
      return supervisorError(value.code as SupervisorErrorCode, message, undefined, value.retryable === true);
    }
  }
  return supervisorError('VSUP_INTERNAL', 'The request could not be completed.');
}

function bounded(value: unknown, maxChars: number): { structuredContent: Record<string, unknown>; text: string } {
  const safe = sanitizeForPersistence(value);
  const object = safe && typeof safe === 'object' && !Array.isArray(safe) ? safe as Record<string, unknown> : { result: safe };
  const serialized = JSON.stringify(object);
  if (serialized.length <= maxChars) return { structuredContent: object, text: serialized };
  const reduced: Record<string, unknown> = { ...object, truncated: true };
  // Keep the run and artifact handles intact; shrink verbose text and event/file lists first.
  for (const key of ['transcript', 'summary', 'text', 'output', 'preview']) {
    if (typeof reduced[key] === 'string') reduced[key] = `${(reduced[key] as string).slice(0, Math.max(0, Math.floor(maxChars / 4)))}… [truncated]`;
  }
  for (const key of ['events', 'changedFiles', 'warnings']) {
    if (Array.isArray(reduced[key])) reduced[key] = (reduced[key] as unknown[]).slice(-20);
  }
  let result = JSON.stringify(reduced);
  if (result.length > maxChars) {
    const compact: Record<string, unknown> = { truncated: true };
    for (const key of ['run_id', 'runId', 'state', 'status', 'artifacts', 'patchPath', 'patch_path', 'diffPath', 'diff_path']) {
      if (reduced[key] !== undefined) compact[key] = reduced[key];
    }
    result = JSON.stringify(compact);
    if (result.length > maxChars) {
      const artifacts = Array.isArray(compact.artifacts) ? compact.artifacts as Record<string, unknown>[] : [];
      compact.artifacts = artifacts.slice(0, 1).map((artifact) => ({ name: artifact.name, path: artifact.path, sha256: artifact.sha256 }));
      result = JSON.stringify(compact);
    }
  }
  if (result.length > maxChars) {
    result = JSON.stringify({ truncated: true, run_id: object.run_id ?? object.runId ?? '' });
  }
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
        options.onError?.(safeError);
        const text = `${safeError.code}: ${safeError.message} ${safeError.remediation}`.slice(0, options.maxResultChars);
        return { isError: true, ...shapeResult({ error: safeError }, text, options.resultFormat) };
      }
    });
  }
}
