import { describe, expect, it } from 'vitest';
import type { EventFatal } from '../../src/backends/app-server/events.js';
import {
  INCOMPLETE_RESULT_WARNING,
  NO_FINAL_MESSAGE_WARNING,
  REFUSAL_WARNING,
  mapOutcome,
  type SupervisorCondition
} from '../../src/backends/app-server/outcome.js';
import { parseTurnStartResult, type Turn } from '../../src/backends/app-server/protocol.js';
import { runScenario } from './support/app-server-driver.js';

function turn(overrides: Record<string, unknown> = {}): Turn {
  return parseTurnStartResult({ turn: { id: 't1', status: 'completed', stopReason: null, error: null, ...overrides }, lastEventId: 1 }).turn;
}

const failedWith = (code: string | null) => turn({ status: 'failed', error: code === null ? null : { code, message: `m-${code}` } });
const fatal: EventFatal = { code: 'unapproved_effect', message: 'file_system.write_file was allowed', tool: 'file_system.write_file', entryId: 'effect-1' };

describe('turn outcome mapping', () => {
  it('maps a normal completion, warning when there is no final message', () => {
    expect(mapOutcome({ turn: turn(), hasFinalMessage: true })).toEqual({ state: 'completed', stopReason: 'end_turn', warnings: [] });
    expect(mapOutcome({ turn: turn(), hasFinalMessage: false })).toEqual({ state: 'completed', stopReason: 'end_turn', warnings: [NO_FINAL_MESSAGE_WARNING] });
  });

  it('maps the limit stop reason to a completed run with the incomplete-result warning', () => {
    expect(mapOutcome({ turn: turn({ stopReason: 'limit' }), hasFinalMessage: true })).toEqual({ state: 'completed', stopReason: 'turn_limit', warnings: [INCOMPLETE_RESULT_WARNING] });
  });

  it('fails the length stop reason as an output limit', () => {
    expect(mapOutcome({ turn: turn({ stopReason: 'length' }), hasFinalMessage: true })).toMatchObject({ state: 'failed', error: { code: 'VSUP_OUTPUT_LIMIT', details: { classification: 'length' } } });
  });

  it('keeps an unrecognized stop reason visible instead of calling it a normal end', () => {
    expect(mapOutcome({ turn: turn({ stopReason: 'something_new' }), hasFinalMessage: true })).toEqual({ state: 'completed', stopReason: 'something_new', warnings: [INCOMPLETE_RESULT_WARNING] });
  });

  it('fails an interrupt the supervisor did not request, whatever the stop reason says', () => {
    expect(mapOutcome({ turn: turn({ status: 'interrupted', stopReason: 'limit' }), hasFinalMessage: true })).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR', details: { classification: 'unrequested_interrupt' } } });
  });

  it('maps turn error codes', () => {
    expect(mapOutcome({ turn: failedWith('invalid_api_key'), hasFinalMessage: false })).toMatchObject({ state: 'failed', error: { code: 'VSUP_AUTH_REQUIRED' } });
    expect(mapOutcome({ turn: failedWith('invalid_model'), hasFinalMessage: false })).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR', details: { classification: 'configuration', error_code: 'invalid_model' } } });
    for (const code of ['context_too_long', 'response_too_long']) {
      expect(mapOutcome({ turn: failedWith(code), hasFinalMessage: false })).toMatchObject({ error: { code: 'VSUP_OUTPUT_LIMIT', details: { classification: 'length' } } });
    }
    expect(mapOutcome({ turn: failedWith('rate_limit'), hasFinalMessage: false })).toMatchObject({ state: 'failed', error: { code: 'VSUP_RATE_LIMITED', retryable: true } });
    expect(mapOutcome({ turn: failedWith('refusal'), hasFinalMessage: true })).toEqual({ state: 'completed', stopReason: 'refusal', warnings: [REFUSAL_WARNING] });
    for (const code of ['backend_error', 'internal_error', 'incomplete_stream', 'compaction_failed', 'brand_new_code']) {
      expect(mapOutcome({ turn: failedWith(code), hasFinalMessage: false }), code).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR', details: { error_code: code } } });
    }
  });

  it('applies the error mapping even when the status says completed, and fails a failed turn without a code', () => {
    expect(mapOutcome({ turn: turn({ error: { code: 'rate_limit' } }), hasFinalMessage: true })).toMatchObject({ error: { code: 'VSUP_RATE_LIMITED' } });
    expect(mapOutcome({ turn: failedWith(null), hasFinalMessage: false })).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR' } });
  });

  it('fails a missing or still-running turn', () => {
    expect(mapOutcome({ turn: null, hasFinalMessage: false })).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR' } });
    expect(mapOutcome({ turn: turn({ status: 'in_progress' }), hasFinalMessage: false })).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR' } });
  });
});

describe('supervisor conditions', () => {
  const interrupted = turn({ status: 'interrupted' });
  const resolve = (...conditions: SupervisorCondition[]) => mapOutcome({ turn: interrupted, conditions, hasFinalMessage: true });

  it('maps each supervisor-detected condition over the turn status', () => {
    expect(resolve({ kind: 'deadline' })).toMatchObject({ state: 'failed', error: { code: 'VSUP_TIMEOUT' } });
    expect(resolve({ kind: 'no_progress', seconds: 30 })).toMatchObject({ state: 'failed', error: { code: 'VSUP_NO_PROGRESS', message: expect.stringContaining('30') } });
    expect(resolve({ kind: 'cancelled' })).toEqual({ state: 'cancelled', stopReason: 'cancelled', warnings: [] });
    expect(resolve({ kind: 'backend_crashed', detail: 'exit 139' })).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED', details: { detail: 'exit 139' } } });
    expect(resolve({ kind: 'output_limit' })).toMatchObject({ state: 'failed', error: { code: 'VSUP_OUTPUT_LIMIT' } });
    expect(resolve({ kind: 'budget', limit: 'turns' })).toEqual({ state: 'completed', stopReason: 'turn_limit', warnings: [INCOMPLETE_RESULT_WARNING] });
    expect(resolve({ kind: 'budget', limit: 'tokens' })).toMatchObject({ stopReason: 'token_limit' });
    expect(resolve({ kind: 'budget', limit: 'price' })).toMatchObject({ stopReason: 'price_limit' });
  });

  it('reports an unsafe event as a backend error naming the tool, with details', () => {
    expect(resolve({ kind: 'unsafe_event', fatal })).toMatchObject({
      state: 'failed',
      error: { code: 'VSUP_BACKEND_ERROR', details: { reason: 'unapproved_effect', tool: 'file_system.write_file', entry_id: 'effect-1' }, message: expect.stringContaining('file_system.write_file') }
    });
  });

  it('ranks conditions: process failures, then unsafe events, then timeouts, cancels and budgets, then the turn', () => {
    const all: SupervisorCondition[] = [{ kind: 'budget', limit: 'tokens' }, { kind: 'cancelled' }, { kind: 'no_progress' }, { kind: 'deadline' }, { kind: 'unsafe_event', fatal }, { kind: 'output_limit' }, { kind: 'backend_crashed' }];
    const order: string[] = [];
    for (let remaining = all.length; remaining >= 0; remaining -= 1) {
      const outcome = remaining === 0 ? mapOutcome({ turn: turn(), conditions: [], hasFinalMessage: true }) : resolve(...all.slice(0, remaining));
      order.push(outcome.error?.code ?? outcome.state);
    }
    expect(order).toEqual(['VSUP_BACKEND_CRASHED', 'VSUP_OUTPUT_LIMIT', 'VSUP_BACKEND_ERROR', 'VSUP_TIMEOUT', 'VSUP_NO_PROGRESS', 'cancelled', 'completed', 'completed']);
  });

  it('beats a clean completed turn: a limit detected by the supervisor wins over a normal end', () => {
    expect(mapOutcome({ turn: turn(), conditions: [{ kind: 'deadline' }], hasFinalMessage: true })).toMatchObject({ error: { code: 'VSUP_TIMEOUT' } });
  });
});

describe('against the scripted fake vibe-app-server', () => {
  it('completes a limit stop with the limit stop reason and warning', async () => {
    const run = await runScenario({ scenario: 'limit' });
    expect(run.turn).toMatchObject({ status: 'completed', stopReason: 'limit' });
    expect(run.outcome).toEqual({ state: 'completed', stopReason: 'turn_limit', warnings: [INCOMPLETE_RESULT_WARNING] });
    expect(run.audit.finalMessage?.text).toBe('Partial answer.');
  });

  it('fails a length stop', async () => {
    const run = await runScenario({ scenario: 'length' });
    expect(run.outcome).toMatchObject({ state: 'failed', error: { code: 'VSUP_OUTPUT_LIMIT' } });
  });

  it('fails an interrupt nobody asked for and maps it to a cancel only when the supervisor did ask', async () => {
    const unrequested = await runScenario({ scenario: 'interrupted' });
    expect(unrequested.outcome).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR', details: { classification: 'unrequested_interrupt' } } });
    const requested = await runScenario({ scenario: 'interrupted', conditions: [{ kind: 'cancelled' }] });
    expect(requested.outcome.state).toBe('cancelled');
  });

  it('fails a backend error turn with its error code in the details', async () => {
    const run = await runScenario({ scenario: 'failed' });
    expect(run.outcome).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_ERROR', retryable: true, details: { error_code: 'backend_error', message: 'The backend failed.' } } });
  });

  it('maps rate limit, refusal and key errors from the wire', async () => {
    const end = (code: string) => ({ name: code, steps: [{ op: 'end', status: 'failed', error: { message: `wire ${code}`, code, details: null } }] });
    expect((await runScenario({ scenario: end('rate_limit') })).outcome).toMatchObject({ error: { code: 'VSUP_RATE_LIMITED' } });
    expect((await runScenario({ scenario: end('invalid_api_key') })).outcome).toMatchObject({ error: { code: 'VSUP_AUTH_REQUIRED' } });
    expect((await runScenario({ scenario: end('refusal') })).outcome).toMatchObject({ state: 'completed', stopReason: 'refusal', warnings: [REFUSAL_WARNING] });
  });

  it('warns when a normal completion carries no final message', async () => {
    const run = await runScenario({ scenario: { name: 'silent', steps: [] } });
    expect(run.outcome).toEqual({ state: 'completed', stopReason: 'end_turn', warnings: [NO_FINAL_MESSAGE_WARNING] });
  });
});
