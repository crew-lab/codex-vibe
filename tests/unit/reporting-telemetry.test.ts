import { describe, expect, it } from 'vitest';
import { runFromWire, runToWire } from '../../src/core/serialization.js';
import { toUsageState, usageFromStats } from '../../src/backends/app-server/usage.js';
import { publicValue } from '../../src/reporting/export.js';
import { modelObservationSchema, reportUsage, thinkingProvenance, type ModelObservation } from '../../src/reporting/telemetry.js';
import type { AgentStats } from '../../src/backends/app-server/protocol.js';

const stats = (patch: Partial<AgentStats> = {}): AgentStats => ({
  promptTokens: 0, completionTokens: 0, cachedTokens: 0, modelCalls: 0,
  inputPricePerMillion: null, outputPricePerMillion: null, cachedInputPricePerMillion: null, contextTokens: 128_000,
  ...patch
});

const observation = (patch: Partial<ModelObservation> = {}): ModelObservation => modelObservationSchema.parse({
  observed_at: '2026-10-24T10:00:00.000Z', source: 'runtime/read', session_model: 'mistral-large-label', alias: 'large-alias', thinking: 'off',
  requested_thinking: 'off', requested_thinking_source: 'supervisor-session-config', requested_model: null, requested_model_source: 'unavailable',
  reported_name: 'Mistral Large', prices_per_million: { input: null, output: null, cached_input: null }, ...patch
});

function oldRun(): Record<string, unknown> {
  return {
    schema_version: 1, run_id: '3c9e6a51-2f4d-4b8e-9a17-5d6c7b8a9f01', backend: 'app-server', mode: 'review', state: 'closed', execution_state: 'completed',
    source_workspace: '/work/project', worker_workspace: '/work/project', created_at: '2026-10-24T09:00:00.000Z', updated_at: '2026-10-24T09:01:00.000Z',
    task_sha256: 'ab'.repeat(32), limits: { timeout_seconds: 60, max_turns: 1, max_event_bytes: 10_000, max_transcript_bytes: 10_000, max_artifact_bytes: 10_000 },
    usage: { prompt_tokens: 2, completion_tokens: 1, cached_tokens: null, model_calls: null, cost_source: 'runtime-stats-prices', tokens_used: 3 }
  };
}

describe('reported model and price provenance', () => {
  it('distinguishes unavailable prices and unknown cost from genuine configured zero prices', () => {
    const missing = toUsageState(usageFromStats(null, stats(), null));
    expect(missing).toMatchObject({ priceAvailability: 'unavailable', priceSource: 'runtime/read', costAvailability: 'unavailable' });
    expect(missing.cost).toBeUndefined();
    expect(missing.costSource).toBeUndefined();
    expect(reportUsage(missing)).toMatchObject({ priceAvailability: 'unavailable', costAvailability: 'unavailable' });
    expect(reportUsage(missing)?.cost).toBeUndefined();

    const zero = toUsageState(usageFromStats(null, stats({ inputPricePerMillion: 0, outputPricePerMillion: 0, cachedInputPricePerMillion: 0 }), null));
    expect(zero).toMatchObject({ priceAvailability: 'available', priceSource: 'runtime/read', costAvailability: 'available', costSource: 'runtime-stats-prices', cost: { amount: 0, authoritative: false } });
  });

  it('labels thinking as matched, drifted, or unavailable against captured request provenance', () => {
    expect(thinkingProvenance([observation()])).toMatchObject({ requested: { value: 'off' }, status: 'matched', observations: [{ value: 'off' }] });
    expect(thinkingProvenance([observation({ thinking: 'high' })])).toMatchObject({ status: 'drift', observations: [{ value: 'high' }] });
    expect(thinkingProvenance([observation({ thinking: null })])).toMatchObject({ status: 'unavailable', observations: [{ value: null }] });
    expect(thinkingProvenance([])).toMatchObject({ status: 'unavailable', observations: [] });
    expect(thinkingProvenance([observation({ requested_thinking: undefined, requested_thinking_source: undefined })])).toMatchObject({ requested: { value: null, source: 'unavailable' }, status: 'unavailable' });
    expect(thinkingProvenance([observation({ requested_thinking_source: undefined })])).toMatchObject({ requested: { value: null, source: 'unavailable' }, status: 'unavailable' });
  });

  it('keeps model names as labels and sanitizes private values before report output', () => {
    const projected = publicValue({ labels: [{ reported_name: 'Mistral Large', alias: 'workspace-model', path: '/Users/private/model' }] }) as { labels: Array<{ reported_name: string; alias: string; path: string }> };
    expect(projected.labels[0]).toEqual({ reported_name: 'Mistral Large', alias: 'workspace-model', path: '<private-path>' });
    expect(projected.labels[0]?.reported_name).not.toContain('weights');
  });

  it('reads old records without the new provenance fields and round-trips explicit new provenance', () => {
    const old = runFromWire(oldRun());
    expect(old.usage?.priceAvailability).toBeUndefined();
    expect(reportUsage(old.usage)).toMatchObject({ costAvailability: 'unavailable', priceAvailability: 'unavailable', priceSource: 'unavailable' });
    const savedCost = runFromWire({ ...oldRun(), usage: { ...oldRun().usage as object, cost: { amount: 0.25, currency: 'USD' } } });
    expect(reportUsage(savedCost.usage)).toMatchObject({ costAvailability: 'available', priceAvailability: 'unavailable', priceSource: 'unavailable', cost: { amount: 0.25 } });
    const newer = runFromWire({ ...oldRun(), usage: { ...oldRun().usage as object, price_availability: 'unavailable', price_source: 'runtime/read', cost_availability: 'unavailable' }, model_observations: [observation()] });
    const saved = runToWire(newer) as Record<string, unknown>;
    expect(saved.usage).toMatchObject({ price_availability: 'unavailable', price_source: 'runtime/read', cost_availability: 'unavailable' });
    expect(saved.model_observations).toHaveLength(1);
  });

  it('rejects negative and non-finite saved costs while retaining legacy currencies', () => {
    for (const amount of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => runFromWire({ ...oldRun(), usage: { cost: { amount, currency: 'CAD' } } })).toThrow('Invalid persisted cost');
    expect(runFromWire({ ...oldRun(), usage: { cost: { amount: 0.1, currency: 'CAD' } } }).usage?.cost?.currency).toBe('CAD');
    expect(() => runFromWire({ ...oldRun(), usage: { cost: { amount: 0, currency: 'CAD' }, cost_availability: 'available' } })).toThrow('requires USD currency');
  });
});
