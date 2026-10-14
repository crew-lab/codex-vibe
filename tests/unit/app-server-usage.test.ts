import { describe, expect, it } from 'vitest';
import type { AgentStats } from '../../src/backends/app-server/protocol.js';
import { UsageTracker, checkBudget, tokenCost, toUsageState, turnBackstop, usageFromStats } from '../../src/backends/app-server/usage.js';
import { runScenario } from './support/app-server-driver.js';

const stats = (overrides: Partial<AgentStats> = {}): AgentStats => ({
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  modelCalls: null,
  inputPricePerMillion: 0.4,
  outputPricePerMillion: 2,
  cachedInputPricePerMillion: 0.04,
  contextTokens: null,
  ...overrides
});

describe('tokenCost', () => {
  it('prices uncached prompt, cached prompt and completion tokens per million', () => {
    expect(tokenCost(1000, 200, 400, { inputPerMillion: 0.4, outputPerMillion: 2, cachedInputPerMillion: 0.04 })).toBeCloseTo(0.000656, 12);
  });

  it('clamps cached tokens to the prompt tokens and negative cached counts to zero', () => {
    const prices = { inputPerMillion: 1, outputPerMillion: 0, cachedInputPerMillion: 0.5 };
    expect(tokenCost(100, 0, 500, prices)).toBeCloseTo((100 * 0.5) / 1e6, 12);
    expect(tokenCost(100, 0, -5, prices)).toBeCloseTo(100 / 1e6, 12);
  });

  it('prices cached tokens like input tokens when no cached price is known and reports unknown prices as null', () => {
    expect(tokenCost(100, 100, 50, { inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: null })).toBeCloseTo(300 / 1e6, 12);
    expect(tokenCost(100, 100, null, { inputPerMillion: null, outputPerMillion: 2, cachedInputPerMillion: null })).toBeNull();
    expect(tokenCost(100, 100, null, { inputPerMillion: 1, outputPerMillion: null, cachedInputPerMillion: null })).toBeNull();
    expect(tokenCost(100, 100, null, { inputPerMillion: Number.NaN, outputPerMillion: 1, cachedInputPerMillion: null })).toBeNull();
  });
});

describe('usageFromStats', () => {
  it('reports deltas from the baseline snapshot, not the session totals', () => {
    const summary = usageFromStats(stats({ promptTokens: 300, completionTokens: 100, cachedTokens: 50, modelCalls: 2 }), stats({ promptTokens: 1300, completionTokens: 400, cachedTokens: 450, modelCalls: 5 }), 128000);
    expect(summary).toMatchObject({ promptTokens: 1000, completionTokens: 300, cachedTokens: 400, tokensUsed: 1300, modelCalls: 3, contextSize: 128000 });
    expect(summary.costAmount).toBeCloseTo((600 * 0.4 + 400 * 0.04 + 300 * 2) / 1e6, 12);
  });

  it('never goes negative when a counter drops below its baseline', () => {
    expect(usageFromStats(stats({ promptTokens: 500, modelCalls: 4 }), stats({ promptTokens: 100, modelCalls: 1 }))).toMatchObject({ promptTokens: 0, modelCalls: 0 });
  });

  it('leaves unknowns null and omits them from the usage state', () => {
    const summary = usageFromStats(null, stats({ promptTokens: 10, completionTokens: 5, cachedTokens: null, inputPricePerMillion: null }));
    expect(summary).toMatchObject({ tokensUsed: 15, cachedTokens: null, modelCalls: null, costAmount: null, contextSize: null });
    expect(toUsageState(summary)).toEqual({ tokensUsed: 15 });
  });

  it('builds the usage state with a non-authoritative cost and the context window', () => {
    const state = toUsageState(usageFromStats(stats(), stats({ promptTokens: 1000, completionTokens: 1000 }), 4096));
    expect(state).toEqual({ tokensUsed: 2000, contextSize: 4096, cost: { amount: expect.closeTo(0.0024, 10), currency: 'USD', authoritative: false } });
    expect(toUsageState(usageFromStats(stats(), stats(), 0)).contextSize).toBeUndefined();
  });
});

describe('budget checks', () => {
  const summary = usageFromStats(stats(), stats({ promptTokens: 1000, completionTokens: 1000, modelCalls: 12 }));

  it('reports the first exceeded ceiling and nothing within limits', () => {
    expect(checkBudget(summary, {})).toBeNull();
    expect(checkBudget(summary, { maxModelCalls: 12, maxTokens: 2000, maxCost: 1 })).toBeNull();
    expect(checkBudget(summary, { maxModelCalls: 11 })).toEqual({ limit: 'turns', observed: 12, ceiling: 11 });
    expect(checkBudget(summary, { maxTokens: 1999 })).toEqual({ limit: 'tokens', observed: 2000, ceiling: 1999 });
    expect(checkBudget(summary, { maxCost: 0.001 })).toMatchObject({ limit: 'price', ceiling: 0.001 });
  });

  it('cannot judge price or turns from unknown values', () => {
    const unknown = usageFromStats(null, stats({ inputPricePerMillion: null, promptTokens: 5 }));
    expect(checkBudget(unknown, { maxCost: 0, maxModelCalls: 0 })).toBeNull();
  });

  it('adds a margin to the turn limit for the model-call backstop', () => {
    expect(turnBackstop(20)).toBe(25);
    expect(turnBackstop(20, 0)).toBe(20);
    expect(() => turnBackstop(0)).toThrow(RangeError);
  });
});

describe('UsageTracker', () => {
  it('starts at zero from the baseline, tracks changes and carries the context window forward', () => {
    const tracker = new UsageTracker(stats({ promptTokens: 100 }), { maxTokens: 50 });
    expect(tracker.state).toEqual({ tokensUsed: 0, cost: { amount: 0, currency: 'USD', authoritative: false } });
    const first = tracker.update(stats({ promptTokens: 130, completionTokens: 10 }), 8000);
    expect(first).toMatchObject({ changed: true, breach: null, summary: { tokensUsed: 40, contextSize: 8000 } });
    expect(tracker.update(stats({ promptTokens: 130, completionTokens: 10 })).changed).toBe(false);
    expect(tracker.update(stats({ promptTokens: 200, completionTokens: 10 })).breach).toEqual({ limit: 'tokens', observed: 110, ceiling: 50 });
    expect(tracker.summary.contextSize).toBe(8000);
    expect(tracker.stats?.promptTokens).toBe(200);
  });

  it('works without a baseline', () => {
    const tracker = new UsageTracker(null);
    expect(tracker.state).toEqual({ tokensUsed: 0 });
    expect(tracker.update(stats({ promptTokens: 7 })).summary.tokensUsed).toBe(7);
  });
});

describe('against the scripted fake vibe-app-server', () => {
  it('rebuilds usage and cost from the stats snapshots of a run', async () => {
    const run = await runScenario({ scenario: 'stats-usage' });
    expect(run.baseline).toMatchObject({ promptTokens: 0, completionTokens: 0, inputPricePerMillion: 0.4, outputPricePerMillion: 2, cachedInputPricePerMillion: 0.04 });
    expect(run.usageUpdates.map((update) => [update.tokensUsed, update.modelCalls])).toEqual([[1200, 1], [5900, 3]]);
    expect(run.usageUpdates[0]?.costAmount).toBeCloseTo((600 * 0.4 + 400 * 0.04 + 200 * 2) / 1e6, 12);
    expect(run.usage.state).toEqual({ tokensUsed: 5900, contextSize: 128000, cost: { amount: expect.closeTo(0.00308, 10), currency: 'USD', authoritative: false } });
    expect(run.finalStats).toMatchObject({ promptTokens: 5000, completionTokens: 900, cachedTokens: 2000, modelCalls: 3 });
    expect(run.outcome.state).toBe('completed');
  });

  it('leaves cost unknown when the snapshot carries no usable price and still counts tokens', async () => {
    const run = await runScenario({
      scenario: {
        name: 'unpriced',
        steps: [{ op: 'stats', stats: { modelCalls: 1, sessionPromptTokens: 10, sessionCompletionTokens: 5, inputPricePerMillion: null, outputPricePerMillion: null } }, { op: 'say', text: 'ok' }]
      }
    });
    expect(run.usage.state).toEqual({ tokensUsed: 15, contextSize: 128000 });
  });

  it('interrupts the turn when a token ceiling is exceeded, and a supervisor budget condition maps to a limit stop', async () => {
    const run = await runScenario({
      scenario: 'stats-usage',
      ceilings: { maxTokens: 1000 },
      conditions: [{ kind: 'budget', limit: 'tokens' }]
    });
    expect(run.interrupts).toBe(1);
    expect(run.outcome).toMatchObject({ state: 'completed', stopReason: 'token_limit' });
  });
});
