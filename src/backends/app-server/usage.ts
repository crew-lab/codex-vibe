import type { RunLimits, UsageState } from '../../contracts.js';
import { supervisorError } from '../../contracts.js';
import { object, number, type JsonObject } from './protocol.js';

interface Stats {
  prompt: number;
  completion: number;
  cached: number;
  prices?: { input: number; output: number; cached: number };
}

function count(value: unknown, field: string): number {
  const result = number(value, field);
  if (!Number.isSafeInteger(result)) throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid app-server token counter.');
  return result;
}

function stats(value: unknown, requireCost: boolean): Stats {
  const data: JsonObject = object(value, 'usage');
  const prompt = count(data.sessionPromptTokens, 'sessionPromptTokens');
  const completion = count(data.sessionCompletionTokens, 'sessionCompletionTokens');
  const cached = count(data.sessionCachedTokens, 'sessionCachedTokens');
  if (!Number.isSafeInteger(prompt + completion)) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server total token counter overflowed.');
  const hasPrices = data.inputPricePerMillion !== undefined && data.outputPricePerMillion !== undefined && data.cachedInputPricePerMillion !== undefined;
  if (!hasPrices && requireCost) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server pricing is missing while an estimated-cost ceiling is enabled.');
  if (!hasPrices) return { prompt, completion, cached };
  const input = number(data.inputPricePerMillion, 'inputPricePerMillion');
  const output = number(data.outputPricePerMillion, 'outputPricePerMillion');
  const cachedPrice = data.cachedInputPricePerMillion === null ? input : number(data.cachedInputPricePerMillion, 'cachedInputPricePerMillion');
  return { prompt, completion, cached, prices: { input, output, cached: cachedPrice } };
}

function cost(data: Stats): number | undefined {
  if (!data.prices) return undefined;
  const cached = Math.min(data.prompt, data.cached);
  const result = ((data.prompt - cached) * data.prices.input + cached * data.prices.cached + data.completion * data.prices.output) / 1_000_000;
  if (!Number.isFinite(result)) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server estimated cost overflowed.');
  return result;
}

export type AccountingStop = 'max_session_tokens' | 'max_estimated_cost_usd';

/** Fresh-session accounting: usage is sampled, never advertised as a provider hard cap. */
export class UsageAccounting {
  private previous: Stats;
  private previousCost = 0;
  private stop: AccountingStop | undefined;
  private tokensOffset = 0;
  private costOffset = 0;
  constructor(baseline: unknown, private readonly limits: Pick<RunLimits, 'maxSessionTokens' | 'maxEstimatedCostUsd'>) {
    this.previous = stats(baseline, limits.maxEstimatedCostUsd !== undefined);
    if (this.previous.prompt !== 0 || this.previous.completion !== 0 || this.previous.cached !== 0) throw supervisorError('VSUP_BACKEND_ERROR', 'New app-server session already has usage; refusing to reuse it.');
  }

  update(value: unknown): { usage: UsageState; stop?: AccountingStop } {
    const next = stats(value, this.limits.maxEstimatedCostUsd !== undefined);
    if (next.prompt < this.previous.prompt || next.completion < this.previous.completion || next.cached < this.previous.cached) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server usage counters moved backwards.');
    const amount = cost(next);
    if (amount !== undefined && amount < this.previousCost) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server estimated cost moved backwards.');
    this.previous = next;
    if (amount !== undefined) this.previousCost = amount;
    const tokensUsed = this.tokensOffset + next.prompt + next.completion;
    const totalCost = amount === undefined ? undefined : this.costOffset + amount;
    if (this.limits.maxSessionTokens !== undefined && tokensUsed >= this.limits.maxSessionTokens) this.stop ??= 'max_session_tokens';
    if (this.limits.maxEstimatedCostUsd !== undefined && totalCost !== undefined && totalCost >= this.limits.maxEstimatedCostUsd) this.stop ??= 'max_estimated_cost_usd';
    return {
      usage: { tokensUsed, ...(totalCost === undefined ? {} : { cost: { amount: totalCost, currency: 'USD', authoritative: false } }) },
      ...(this.stop === undefined ? {} : { stop: this.stop }),
    };
  }

  handoff(value: unknown): { usage: UsageState; stop?: AccountingStop } {
    const next = stats(value, this.limits.maxEstimatedCostUsd !== undefined);
    if (next.prompt === 0 && next.completion === 0 && next.cached === 0) {
      this.tokensOffset += this.previous.prompt + this.previous.completion;
      this.costOffset += this.previousCost;
      this.previous = next; this.previousCost = 0;
      if (!Number.isSafeInteger(this.tokensOffset) || !Number.isFinite(this.costOffset)) throw supervisorError('VSUP_BACKEND_ERROR', 'Session handoff accounting overflowed.');
    }
    // A cumulative snapshot is handled unchanged. A partial reset is ambiguous
    // and update() refuses it instead of silently undercounting spending.
    return this.update(value);
  }
}
