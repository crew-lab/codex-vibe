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

export interface TokenPrices {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachedInputPerMillion: number | null;
}

function delta(current: number, baseline: number): number {
  return Math.max(current - baseline, 0);
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

export function usageFromStats(baseline: AgentStats | null, current: AgentStats, contextWindow: number | null = null): UsageSummary {
  const promptTokens = delta(current.promptTokens, baseline?.promptTokens ?? 0);
  const completionTokens = delta(current.completionTokens, baseline?.completionTokens ?? 0);
  const cachedTokens = current.cachedTokens === null ? null : delta(current.cachedTokens, baseline?.cachedTokens ?? 0);
  const modelCalls = current.modelCalls === null ? null : delta(current.modelCalls, baseline?.modelCalls ?? 0);
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

export class UsageTracker {
  private latest: UsageSummary;
  private latestStats: AgentStats | null = null;

  constructor(private readonly baseline: AgentStats | null, private readonly ceilings: BudgetCeilings = {}) {
    this.latest = usageFromStats(baseline, baseline ?? { promptTokens: 0, completionTokens: 0, cachedTokens: null, modelCalls: null, inputPricePerMillion: null, outputPricePerMillion: null, cachedInputPricePerMillion: null, contextTokens: null });
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

  update(stats: AgentStats, contextWindow: number | null = null): { summary: UsageSummary; changed: boolean; breach: BudgetBreach | null } {
    const next = usageFromStats(this.baseline, stats, contextWindow ?? this.latest.contextSize);
    const changed = JSON.stringify(next) !== JSON.stringify(this.latest);
    this.latest = next;
    this.latestStats = stats;
    return { summary: next, changed, breach: checkBudget(next, this.ceilings) };
  }
}
