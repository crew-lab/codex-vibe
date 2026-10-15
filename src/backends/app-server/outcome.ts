import { supervisorError, type RunState, type SupervisorError } from '../../contracts.js';
import type { EventFatal } from './events.js';
import type { Turn } from './protocol.js';

export const STOP_REASON_END_TURN = 'end_turn';
export const STOP_REASON_TURN_LIMIT = 'turn_limit';
export const STOP_REASON_TOKEN_LIMIT = 'token_limit';
export const STOP_REASON_PRICE_LIMIT = 'price_limit';
export const STOP_REASON_REFUSAL = 'refusal';
export const STOP_REASON_CANCELLED = 'cancelled';

export type SupervisorCondition =
  | { kind: 'backend_crashed'; detail?: string }
  | { kind: 'output_limit'; detail?: string }
  | { kind: 'unsafe_event'; fatal: EventFatal }
  | { kind: 'deadline' }
  | { kind: 'no_progress'; seconds?: number }
  | { kind: 'cancelled' }
  | { kind: 'budget'; limit: 'turns' | 'tokens' | 'price' };

export interface OutcomeInput {
  turn: Turn | null;
  conditions?: readonly SupervisorCondition[];
  hasFinalMessage: boolean;
}

export interface RunOutcome {
  state: Extract<RunState, 'completed' | 'failed' | 'cancelled'>;
  stopReason?: string;
  error?: SupervisorError;
  warnings: string[];
}

const BUDGET_STOP_REASONS = {
  turns: STOP_REASON_TURN_LIMIT,
  tokens: STOP_REASON_TOKEN_LIMIT,
  price: STOP_REASON_PRICE_LIMIT
} as const;

export const NO_FINAL_MESSAGE_WARNING = 'The turn finished without a final assistant message.';
export const INCOMPLETE_RESULT_WARNING = 'The run stopped at a limit before a final answer; the result may be incomplete.';
export const REFUSAL_WARNING = 'The model declined the request (error code refusal); the result is not a review or an edit.';

function failure(code: Parameters<typeof supervisorError>[0], message: string, details?: Record<string, unknown>, retryable = false): RunOutcome {
  return { state: 'failed', error: supervisorError(code, message, details, retryable), warnings: [] };
}

function conditionOutcome(conditions: readonly SupervisorCondition[]): RunOutcome | null {
  const find = <K extends SupervisorCondition['kind']>(kind: K) => conditions.find((condition): condition is Extract<SupervisorCondition, { kind: K }> => condition.kind === kind);
  const crashed = find('backend_crashed');
  if (crashed) return failure('VSUP_BACKEND_CRASHED', 'The Vibe app-server process ended before the turn completed.', crashed.detail ? { detail: crashed.detail } : undefined);
  const overflow = find('output_limit');
  if (overflow) return failure('VSUP_OUTPUT_LIMIT', 'The Vibe app-server produced more output than the configured limit allows.', overflow.detail ? { detail: overflow.detail } : undefined);
  const unsafe = find('unsafe_event');
  if (unsafe) {
    return failure('VSUP_BACKEND_ERROR', `The run was stopped because of an unsafe or unrecognized backend event: ${unsafe.fatal.message}`, {
      reason: unsafe.fatal.code,
      ...(unsafe.fatal.tool === null ? {} : { tool: unsafe.fatal.tool }),
      ...(unsafe.fatal.entryId === null ? {} : { entry_id: unsafe.fatal.entryId })
    });
  }
  if (find('deadline')) return failure('VSUP_TIMEOUT', 'The run exceeded its configured timeout.');
  const stalled = find('no_progress');
  if (stalled) return failure('VSUP_NO_PROGRESS', stalled.seconds === undefined ? 'The worker produced no output within the configured limit.' : `The worker produced no output for ${stalled.seconds} seconds.`);
  if (find('cancelled')) return { state: 'cancelled', stopReason: STOP_REASON_CANCELLED, warnings: [] };
  const budget = find('budget');
  if (budget) return { state: 'completed', stopReason: BUDGET_STOP_REASONS[budget.limit], warnings: [INCOMPLETE_RESULT_WARNING] };
  return null;
}

function errorOutcome(turn: Turn): RunOutcome | null {
  const error = turn.error;
  if (error === null) return null;
  const details = { error_code: error.rawCode ?? 'unknown', ...(error.message === null ? {} : { message: error.message.slice(0, 300) }) };
  switch (error.code) {
    case 'invalid_api_key':
      return failure('VSUP_AUTH_REQUIRED', 'The Vibe provider rejected the API key.', details);
    case 'invalid_model':
      return failure('VSUP_BACKEND_ERROR', 'The Vibe provider rejected the configured model; this is a configuration failure.', { ...details, classification: 'configuration' });
    case 'context_too_long':
    case 'response_too_long':
      return failure('VSUP_OUTPUT_LIMIT', 'The model hit its context or response length limit.', { ...details, classification: 'length' });
    case 'rate_limit':
      return failure('VSUP_RATE_LIMITED', 'The model provider rate-limited the run.', details, true);
    case 'refusal':
      return { state: 'completed', stopReason: STOP_REASON_REFUSAL, warnings: [REFUSAL_WARNING] };
    default:
      return failure('VSUP_BACKEND_ERROR', `The Vibe backend reported a turn error (${error.rawCode ?? 'unknown'}).`, details, error.code === 'backend_error' || error.code === 'incomplete_stream');
  }
}

function turnOutcome(turn: Turn | null, hasFinalMessage: boolean): RunOutcome {
  if (turn === null) return failure('VSUP_BACKEND_ERROR', 'The Vibe backend never reported a completed turn.');
  if (turn.status === 'in_progress') return failure('VSUP_BACKEND_ERROR', 'The Vibe backend reported the turn as still in progress at the end of the run.');
  if (turn.status === 'interrupted') return failure('VSUP_BACKEND_ERROR', 'The turn was interrupted by something other than the supervisor.', { classification: 'unrequested_interrupt' });
  const fromError = errorOutcome(turn);
  if (fromError) return fromError;
  if (turn.status === 'failed') return failure('VSUP_BACKEND_ERROR', 'The Vibe backend failed the turn without an error code.');
  switch (turn.stopReason) {
    case null: return { state: 'completed', stopReason: STOP_REASON_END_TURN, warnings: hasFinalMessage ? [] : [NO_FINAL_MESSAGE_WARNING] };
    case 'limit': return { state: 'completed', stopReason: STOP_REASON_TURN_LIMIT, warnings: [INCOMPLETE_RESULT_WARNING] };
    case 'length': return failure('VSUP_OUTPUT_LIMIT', 'The model stopped because the response reached its length limit.', { classification: 'length' });
    default: {
      const raw = (turn.rawStopReason ?? 'unknown').replace(/[^\x20-\x7e]/g, '?').slice(0, 64);
      return { state: 'completed', stopReason: raw, warnings: [INCOMPLETE_RESULT_WARNING] };
    }
  }
}

export function mapOutcome(input: OutcomeInput): RunOutcome {
  return conditionOutcome(input.conditions ?? []) ?? turnOutcome(input.turn, input.hasFinalMessage);
}
