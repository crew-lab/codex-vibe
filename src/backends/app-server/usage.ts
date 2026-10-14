import type { UsageState } from '../../contracts.js';
import type { AgentStats } from './protocol.js';

export const USAGE_CURRENCY = 'USD';
export const DEFAULT_TURN_BACKSTOP_MARGIN = 5;
const TOKENS_PER_PRICE_UNIT = 1_000_000;

export interface UsageSummary {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number | null;
  tokensUsed: number;
  modelCalls: number | null;
  costAmount: number | null;
  contextSize: number | null;
}

export interface BudgetCeilings {
  maxTokens?: number;
  maxCost?: number;
  maxModelCalls?: number;
}

export type BudgetBreach = { limit: 'tokens' | 'price' | 'turns'; observed: number; ceiling: number };

export type UsageFault =
  | { kind: 'regression'; counter: string; previous: number; observed: number }
  | { kind: 'price_unavailable'; ceiling: number };

export interface TokenPrices {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachedInputPerMillion: number | null;
}

function finiteNonNegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

export function tokenCost(promptTokens: number, completionTokens: number, cachedTokens: number | null, prices: TokenPrices): number | null {
  const input = finiteNonNegative(prices.inputPerMillion);
  const output = finiteNonNegative(prices.outputPerMillion);
  if (input === null || output === null) return null;
  const cachedPrice = finiteNonNegative(prices.cachedInputPerMillion) ?? input;
  const cached = Math.min(Math.max(cachedTokens ?? 0, 0), promptTokens);
  return ((promptTokens - cached) * input + cached * cachedPrice + completionTokens * output) / TOKENS_PER_PRICE_UNIT;
}

export function turnBackstop(maxTurns: number, margin = DEFAULT_TURN_BACKSTOP_MARGIN): number {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new RangeError('maxTurns must be a positive integer');
  return maxTurns + margin;
}

function delta(counter: string, current: number, baseline: number): number {
  if (current < baseline) throw new RangeError(`the ${counter} counter is below its baseline`);
  return current - baseline;
}

export function usageFromStats(baseline: AgentStats | null, current: AgentStats, contextWindow: number | null = null): UsageSummary {
  const promptTokens = delta('promptTokens', current.promptTokens, baseline?.promptTokens ?? 0);
  const completionTokens = delta('completionTokens', current.completionTokens, baseline?.completionTokens ?? 0);
  const cachedTokens = current.cachedTokens === null ? null : delta('cachedTokens', current.cachedTokens, baseline?.cachedTokens ?? 0);
  const modelCalls = current.modelCalls === null ? null : delta('modelCalls', current.modelCalls, baseline?.modelCalls ?? 0);
  const costAmount = tokenCost(promptTokens, completionTokens, cachedTokens, {
    inputPerMillion: current.inputPricePerMillion,
    outputPerMillion: current.outputPricePerMillion,
    cachedInputPerMillion: current.cachedInputPricePerMillion
  });
  const contextSize = contextWindow !== null && Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null;
  return { promptTokens, completionTokens, cachedTokens, tokensUsed: promptTokens + completionTokens, modelCalls, costAmount, contextSize };
}

export function toUsageState(summary: UsageSummary): UsageState {
  return {
    tokensUsed: summary.tokensUsed,
    ...(summary.contextSize === null ? {} : { contextSize: summary.contextSize }),
    ...(summary.costAmount === null ? {} : { cost: { amount: summary.costAmount, currency: USAGE_CURRENCY, authoritative: false as const } })
  };
}

export function checkBudget(summary: UsageSummary, ceilings: BudgetCeilings): BudgetBreach | null {
  if (ceilings.maxModelCalls !== undefined && summary.modelCalls !== null && summary.modelCalls > ceilings.maxModelCalls) {
    return { limit: 'turns', observed: summary.modelCalls, ceiling: ceilings.maxModelCalls };
  }
  if (ceilings.maxTokens !== undefined && summary.tokensUsed > ceilings.maxTokens) {
    return { limit: 'tokens', observed: summary.tokensUsed, ceiling: ceilings.maxTokens };
  }
  if (ceilings.maxCost !== undefined && summary.costAmount !== null && summary.costAmount > ceilings.maxCost) {
    return { limit: 'price', observed: summary.costAmount, ceiling: ceilings.maxCost };
  }
  return null;
}

export function detectRegression(previous: AgentStats, current: AgentStats): UsageFault | null {
  const counters: Array<[string, number | null, number | null]> = [
    ['promptTokens', previous.promptTokens, current.promptTokens],
    ['completionTokens', previous.completionTokens, current.completionTokens],
    ['cachedTokens', previous.cachedTokens, current.cachedTokens],
    ['modelCalls', previous.modelCalls, current.modelCalls]
  ];
  for (const [counter, before, after] of counters) {
    if (before === null) continue;
    if (after === null) return { kind: 'regression', counter, previous: before, observed: Number.NaN };
    if (after < before) return { kind: 'regression', counter, previous: before, observed: after };
  }
  return null;
}

export function describeUsageFault(fault: UsageFault): string {
  if (fault.kind === 'price_unavailable') {
    return `A cost ceiling of ${fault.ceiling} USD is configured, but Vibe reports no input and output price for the active model, so the ceiling cannot be enforced.`;
  }
  const observed = Number.isNaN(fault.observed) ? 'missing' : String(fault.observed);
  return `Vibe reported the ${fault.counter} counter going backwards outside a session handoff (${fault.previous} then ${observed}), so usage and budgets can no longer be trusted.`;
}

const ZERO_STATS: AgentStats = {
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: null,
  modelCalls: null,
  inputPricePerMillion: null,
  outputPricePerMillion: null,
  cachedInputPricePerMillion: null,
  contextTokens: null
};

const EMPTY_SUMMARY: UsageSummary = { promptTokens: 0, completionTokens: 0, cachedTokens: null, tokensUsed: 0, modelCalls: null, costAmount: null, contextSize: null };

interface Carried {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number | null;
  modelCalls: number | null;
  costAmount: number | null;
}

const NOTHING_CARRIED: Carried = { promptTokens: 0, completionTokens: 0, cachedTokens: null, modelCalls: null, costAmount: 0 };

function addNullable(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

export interface UsageUpdate {
  summary: UsageSummary;
  changed: boolean;
  breach: BudgetBreach | null;
  fault: UsageFault | null;
}

export class UsageTracker {
  private carried: Carried = NOTHING_CARRIED;
  private segmentBaseline: AgentStats | null;
  private lastStats: AgentStats | null;
  private latestStats: AgentStats | null = null;
  private latest: UsageSummary = EMPTY_SUMMARY;
  private latched: UsageFault | null = null;
  private handoffPending = false;

  constructor(baseline: AgentStats | null, private readonly ceilings: BudgetCeilings = {}) {
    this.segmentBaseline = baseline;
    this.lastStats = baseline;
    this.latest = this.totals(baseline ?? ZERO_STATS, null);
    this.latched = this.priceFault(this.latest);
  }

  get summary(): UsageSummary {
    return this.latest;
  }

  get state(): UsageState {
    return toUsageState(this.latest);
  }

  get stats(): AgentStats | null {
    return this.latestStats;
  }

  get fault(): UsageFault | null {
    return this.latched;
  }

  private priceFault(summary: UsageSummary): UsageFault | null {
    if (this.ceilings.maxCost !== undefined && summary.costAmount === null) return { kind: 'price_unavailable', ceiling: this.ceilings.maxCost };
    return null;
  }

  private totals(stats: AgentStats, contextWindow: number | null): UsageSummary {
    const segment = usageFromStats(this.segmentBaseline, stats, contextWindow ?? this.latest.contextSize);
    const cost = segment.costAmount === null || this.carried.costAmount === null ? null : this.carried.costAmount + segment.costAmount;
    return {
      promptTokens: this.carried.promptTokens + segment.promptTokens,
      completionTokens: this.carried.completionTokens + segment.completionTokens,
      cachedTokens: addNullable(this.carried.cachedTokens, segment.cachedTokens),
      tokensUsed: this.carried.promptTokens + this.carried.completionTokens + segment.tokensUsed,
      modelCalls: addNullable(this.carried.modelCalls, segment.modelCalls),
      costAmount: cost,
      contextSize: segment.contextSize
    };
  }

  private closeSegment(): void {
    const last = this.lastStats;
    if (last === null && this.segmentBaseline === null) return;
    const segment = usageFromStats(this.segmentBaseline, last ?? this.segmentBaseline ?? ZERO_STATS);
    const segmentCost = segment.costAmount ?? (segment.tokensUsed === 0 ? 0 : null);
    this.carried = {
      promptTokens: this.carried.promptTokens + segment.promptTokens,
      completionTokens: this.carried.completionTokens + segment.completionTokens,
      cachedTokens: addNullable(this.carried.cachedTokens, segment.cachedTokens),
      modelCalls: addNullable(this.carried.modelCalls, segment.modelCalls),
      costAmount: this.carried.costAmount === null || segmentCost === null ? null : this.carried.costAmount + segmentCost
    };
  }

  private publish(stats: AgentStats, contextWindow: number | null): UsageUpdate {
    const next = this.totals(stats, contextWindow);
    const changed = JSON.stringify(next) !== JSON.stringify(this.latest);
    this.latest = next;
    this.latestStats = stats;
    this.lastStats = stats;
    this.latched ??= this.priceFault(next);
    return { summary: next, changed, breach: checkBudget(next, this.ceilings), fault: this.latched };
  }

  private frozen(): UsageUpdate {
    return { summary: this.latest, changed: false, breach: checkBudget(this.latest, this.ceilings), fault: this.latched };
  }

  markHandoff(): void {
    this.handoffPending = true;
  }

  update(stats: AgentStats, contextWindow: number | null = null): UsageUpdate {
    if (this.latched?.kind === 'regression') return this.frozen();
    if (this.handoffPending) {
      this.handoffPending = false;
      return this.handoff(stats, contextWindow);
    }
    const previous = this.lastStats;
    const regression = previous === null ? null : detectRegression(previous, stats);
    if (regression) {
      this.latched = regression;
      return this.frozen();
    }
    return this.publish(stats, contextWindow);
  }

  handoff(stats: AgentStats, contextWindow: number | null = null): UsageUpdate {
    if (this.latched?.kind === 'regression') return this.frozen();
    const previous = this.lastStats;
    const reset = previous !== null && detectRegression(previous, stats) !== null;
    if (reset) {
      this.closeSegment();
      this.segmentBaseline = null;
      this.lastStats = null;
    }
    return this.publish(stats, contextWindow);
  }
}
