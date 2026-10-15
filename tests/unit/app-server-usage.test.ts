import { describe, expect, it } from 'vitest';
import type { AgentStats } from '../../src/backends/app-server/protocol.js';
import { UsageTracker, checkBudget, describeUsageFault, detectRegression, tokenCost, toUsageState, turnBackstop, usageFromStats } from '../../src/backends/app-server/usage.js';
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

  it('refuses to clamp a counter that dropped below its baseline', () => {
    expect(() => usageFromStats(stats({ promptTokens: 500, modelCalls: 4 }), stats({ promptTokens: 100, modelCalls: 1 }))).toThrow(RangeError);
    expect(() => usageFromStats(stats({ modelCalls: 4 }), stats({ modelCalls: 1 }))).toThrow(/modelCalls/);
  });

  it('leaves unknowns null and omits them from the usage state', () => {
    const summary = usageFromStats(null, stats({ promptTokens: 10, completionTokens: 5, cachedTokens: null, inputPricePerMillion: null }));
    expect(summary).toMatchObject({ tokensUsed: 15, cachedTokens: null, modelCalls: null, costAmount: null, contextSize: null });
    expect(toUsageState(summary)).toEqual({ tokensUsed: 15, promptTokens: 10, completionTokens: 5, cachedTokens: null, modelCalls: null, costSource: "runtime-stats-prices" });
  });

  it('builds the usage state with a non-authoritative cost and the context window', () => {
    const state = toUsageState(usageFromStats(stats(), stats({ promptTokens: 1000, completionTokens: 1000 }), 4096));
    expect(state).toMatchObject({ tokensUsed: 2000, contextSize: 4096, cost: { amount: expect.closeTo(0.0024, 10), currency: 'USD', authoritative: false } });
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
    expect(tracker.state).toMatchObject({ tokensUsed: 0, cost: { amount: 0, currency: 'USD', authoritative: false } });
    const first = tracker.update(stats({ promptTokens: 130, completionTokens: 10 }), 8000);
    expect(first).toMatchObject({ changed: true, breach: null, summary: { tokensUsed: 40, contextSize: 8000 } });
    expect(tracker.update(stats({ promptTokens: 130, completionTokens: 10 })).changed).toBe(false);
    expect(tracker.update(stats({ promptTokens: 200, completionTokens: 10 })).breach).toEqual({ limit: 'tokens', observed: 110, ceiling: 50 });
    expect(tracker.summary.contextSize).toBe(8000);
    expect(tracker.stats?.promptTokens).toBe(200);
  });

  it('works without a baseline', () => {
    const tracker = new UsageTracker(null);
    expect(tracker.state).toMatchObject({ tokensUsed: 0 });
    expect(tracker.update(stats({ promptTokens: 7 })).summary.tokensUsed).toBe(7);
  });
});

describe('usage faults', () => {
  it('latches a counter that goes backwards outside a handoff instead of clamping it', () => {
    const tracker = new UsageTracker(stats(), { maxTokens: 1_000_000 });
    tracker.update(stats({ promptTokens: 500, completionTokens: 100, modelCalls: 3 }));
    const regressed = tracker.update(stats({ promptTokens: 400, completionTokens: 100, modelCalls: 3 }));
    expect(regressed.fault).toEqual({ kind: 'regression', counter: 'promptTokens', previous: 500, observed: 400 });
    expect(regressed.summary.tokensUsed).toBe(600);
    expect(regressed.changed).toBe(false);
    expect(tracker.fault).toEqual(regressed.fault);
    expect(tracker.update(stats({ promptTokens: 900 })).fault).toEqual(regressed.fault);
    expect(tracker.summary.tokensUsed).toBe(600);
  });

  it.each([
    ['completionTokens', { promptTokens: 10, completionTokens: 5 }, { promptTokens: 10, completionTokens: 4 }],
    ['cachedTokens', { cachedTokens: 9 }, { cachedTokens: 8 }],
    ['modelCalls', { modelCalls: 2 }, { modelCalls: 1 }],
    ['modelCalls', { modelCalls: 2 }, { modelCalls: null }]
  ] as const)('detects a backwards %s counter', (counter, before, after) => {
    expect(detectRegression(stats(before), stats(after))).toMatchObject({ kind: 'regression', counter });
  });

  it('does not flag a counter that stays, grows or was never reported', () => {
    expect(detectRegression(stats({ cachedTokens: null, modelCalls: null }), stats({ cachedTokens: 3, modelCalls: 1 }))).toBeNull();
    expect(detectRegression(stats({ promptTokens: 5 }), stats({ promptTokens: 5 }))).toBeNull();
  });

  it('fails closed when a cost ceiling is set and the prices are missing, at once and not never', () => {
    const missing = new UsageTracker(stats({ inputPricePerMillion: null, outputPricePerMillion: null }), { maxCost: 1 });
    expect(missing.fault).toEqual({ kind: 'price_unavailable', ceiling: 1 });
    expect(describeUsageFault(missing.fault!)).toContain('cannot be enforced');
    expect(missing.update(stats({ promptTokens: 10, inputPricePerMillion: null, outputPricePerMillion: null })).fault).toEqual({ kind: 'price_unavailable', ceiling: 1 });
    expect(new UsageTracker(stats({ outputPricePerMillion: null }), { maxCost: 1 }).fault).toMatchObject({ kind: 'price_unavailable' });
    expect(new UsageTracker(stats({ inputPricePerMillion: null }), { maxTokens: 5 }).fault).toBeNull();
    expect(new UsageTracker(stats(), { maxCost: 1 }).fault).toBeNull();
    expect(new UsageTracker(stats({ inputPricePerMillion: 0, outputPricePerMillion: 0 }), { maxCost: 1 }).fault).toBeNull();
  });

  it('flags prices that disappear mid-run', () => {
    const tracker = new UsageTracker(stats(), { maxCost: 1 });
    expect(tracker.update(stats({ promptTokens: 10 })).fault).toBeNull();
    expect(tracker.update(stats({ promptTokens: 20, inputPricePerMillion: null })).fault).toMatchObject({ kind: 'price_unavailable' });
  });
});

describe('UsageTracker across a session handoff', () => {
  it('carries the old session totals when its counters reset, so tokens, cost and calls keep counting', () => {
    const tracker = new UsageTracker(stats(), { maxTokens: 10_000 });
    tracker.update(stats({ promptTokens: 1000, completionTokens: 200, cachedTokens: 400, modelCalls: 3 }));
    const reset = tracker.handoff(stats({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, modelCalls: 0 }), 4096);
    expect(reset.fault).toBeNull();
    expect(reset.summary).toMatchObject({ promptTokens: 1000, completionTokens: 200, cachedTokens: 400, tokensUsed: 1200, modelCalls: 3, contextSize: 4096 });
    expect(reset.summary.costAmount).toBeCloseTo((600 * 0.4 + 400 * 0.04 + 200 * 2) / 1e6, 12);
    const later = tracker.update(stats({ promptTokens: 300, completionTokens: 100, cachedTokens: 100, modelCalls: 1 }));
    expect(later.summary).toMatchObject({ promptTokens: 1300, completionTokens: 300, tokensUsed: 1600, modelCalls: 4 });
    expect(later.summary.costAmount).toBeCloseTo((600 * 0.4 + 400 * 0.04 + 200 * 2 + 200 * 0.4 + 100 * 0.04 + 100 * 2) / 1e6, 12);
    expect(tracker.stats?.promptTokens).toBe(300);
  });

  it('counts a reset that already holds usage in full and keeps what was carried', () => {
    const tracker = new UsageTracker(stats(), {});
    tracker.update(stats({ promptTokens: 1000, completionTokens: 200 }));
    expect(tracker.handoff(stats({ promptTokens: 50, completionTokens: 10 })).summary.tokensUsed).toBe(1260);
    expect(tracker.update(stats({ promptTokens: 80, completionTokens: 10 })).summary.tokensUsed).toBe(1290);
  });

  it('treats counters that kept growing as one continuing session', () => {
    const tracker = new UsageTracker(stats({ promptTokens: 100 }), {});
    tracker.update(stats({ promptTokens: 600, completionTokens: 50 }));
    const kept = tracker.handoff(stats({ promptTokens: 650, completionTokens: 60 }));
    expect(kept.summary.tokensUsed).toBe(610);
    expect(tracker.update(stats({ promptTokens: 700, completionTokens: 60 })).summary.tokensUsed).toBe(660);
  });

  it('survives several handoffs and still enforces every ceiling on the totals', () => {
    const tracker = new UsageTracker(stats(), { maxTokens: 2500, maxModelCalls: 20 });
    tracker.update(stats({ promptTokens: 1000, completionTokens: 0, modelCalls: 2 }));
    tracker.handoff(stats());
    tracker.update(stats({ promptTokens: 900, completionTokens: 0, modelCalls: 2 }));
    expect(tracker.update(stats({ promptTokens: 900, modelCalls: 2 })).breach).toBeNull();
    tracker.handoff(stats());
    const third = tracker.update(stats({ promptTokens: 700, modelCalls: 1 }));
    expect(third.summary).toMatchObject({ tokensUsed: 2600, modelCalls: 5 });
    expect(third.breach).toEqual({ limit: 'tokens', observed: 2600, ceiling: 2500 });
  });

  it('adds cost across segments priced separately and drops it when a segment had usage without prices', () => {
    const tracker = new UsageTracker(stats(), {});
    tracker.update(stats({ promptTokens: 1000, inputPricePerMillion: 1, outputPricePerMillion: 1 }));
    tracker.handoff(stats({ inputPricePerMillion: 2, outputPricePerMillion: 2 }));
    const second = tracker.update(stats({ promptTokens: 1000, inputPricePerMillion: 2, outputPricePerMillion: 2 }));
    expect(second.summary.costAmount).toBeCloseTo(0.003, 12);
    tracker.handoff(stats({ inputPricePerMillion: null, outputPricePerMillion: null }));
    expect(tracker.update(stats({ promptTokens: 10, inputPricePerMillion: null, outputPricePerMillion: null })).summary.costAmount).toBeNull();
  });

  it('still treats a counter going backwards after a handoff as fatal', () => {
    const tracker = new UsageTracker(stats(), {});
    tracker.update(stats({ promptTokens: 1000 }));
    tracker.handoff(stats({ promptTokens: 100 }));
    expect(tracker.update(stats({ promptTokens: 90 })).fault).toMatchObject({ kind: 'regression', counter: 'promptTokens', previous: 100, observed: 90 });
  });

  it('lets the first stats after a marked handoff decide whether the counters reset or kept growing', () => {
    const reset = new UsageTracker(stats(), {});
    reset.update(stats({ promptTokens: 1000, completionTokens: 200 }));
    reset.markHandoff();
    expect(reset.update(stats()).summary.tokensUsed).toBe(1200);
    expect(reset.update(stats({ promptTokens: 300, completionTokens: 100 })).summary.tokensUsed).toBe(1600);
    expect(reset.update(stats({ promptTokens: 250 })).fault).toMatchObject({ kind: 'regression' });

    const kept = new UsageTracker(stats(), {});
    kept.update(stats({ promptTokens: 1000, completionTokens: 200 }));
    kept.markHandoff();
    expect(kept.update(stats({ promptTokens: 1000, completionTokens: 200 })).summary.tokensUsed).toBe(1200);
    expect(kept.update(stats({ promptTokens: 1400, completionTokens: 200 })).summary.tokensUsed).toBe(1600);
  });

  it('flags a cost ceiling that cannot be enforced after the handoff', () => {
    const tracker = new UsageTracker(stats(), { maxCost: 1 });
    tracker.update(stats({ promptTokens: 10 }));
    expect(tracker.handoff(stats({ inputPricePerMillion: null, outputPricePerMillion: null })).fault).toMatchObject({ kind: 'price_unavailable' });
  });
});

describe('against the scripted fake vibe-app-server', () => {
  it('rebuilds usage and cost from the stats snapshots of a run', async () => {
    const run = await runScenario({ scenario: 'stats-usage' });
    expect(run.baseline).toMatchObject({ promptTokens: 0, completionTokens: 0, inputPricePerMillion: 0.4, outputPricePerMillion: 2, cachedInputPricePerMillion: 0.04 });
    expect(run.usageUpdates.map((update) => [update.tokensUsed, update.modelCalls])).toEqual([[1200, 1], [5900, 3]]);
    expect(run.usageUpdates[0]?.costAmount).toBeCloseTo((600 * 0.4 + 400 * 0.04 + 200 * 2) / 1e6, 12);
    expect(run.usage.state).toMatchObject({ tokensUsed: 5900, contextSize: 128000, cost: { amount: expect.closeTo(0.00308, 10), currency: 'USD', authoritative: false } });
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
    expect(run.usage.state).toMatchObject({ tokensUsed: 15, contextSize: 128000 });
  });

  it('latches a counter that moved backwards in a scripted run', async () => {
    const run = await runScenario({
      scenario: {
        name: 'counters-backwards',
        baselineStats: { inputPricePerMillion: 0.4, outputPricePerMillion: 2 },
        steps: [
          { op: 'stats', stats: { modelCalls: 2, sessionPromptTokens: 5000, sessionCompletionTokens: 900 } },
          { op: 'stats', stats: { modelCalls: 3, sessionPromptTokens: 100, sessionCompletionTokens: 50 } },
          { op: 'say', text: 'unreachable' }
        ]
      }
    });
    expect(run.usage.fault).toMatchObject({ kind: 'regression', counter: 'promptTokens', previous: 5000, observed: 100 });
    expect(run.interrupts).toBe(1);
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
