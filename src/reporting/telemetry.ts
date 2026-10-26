import { z } from 'zod';
import type { UsageState } from '../contracts.js';
const priceSchema = z.number().finite().min(0).nullable();
export const modelObservationSchema = z.object({
  observed_at: z.string().datetime(),
  source: z.literal('runtime/read'),
  session_model: z.string().max(500).nullable(),
  alias: z.string().max(500).nullable(),
  thinking: z.string().max(100).nullable(),
  requested_thinking: z.string().max(100).nullable().optional(),
  requested_thinking_source: z.literal('supervisor-session-config').optional(),
  requested_model: z.string().max(500).nullable().optional(),
  requested_model_source: z.enum(['explicit-selection', 'unavailable']).optional(),
  reported_name: z.string().max(500).nullable().optional(),
  prices_per_million: z.object({ input: priceSchema, output: priceSchema, cached_input: priceSchema }).strict().optional()
}).strict();
export const modelObservationsSchema = z.array(modelObservationSchema).max(100);
export type ModelObservation = z.infer<typeof modelObservationSchema>;

export interface ThinkingProvenance {
  requested: { value: string | null; source: 'supervisor-session-config' | 'unavailable' };
  status: 'matched' | 'drift' | 'unavailable';
  observations: Array<{ observed_at: string; value: string | null; source: 'runtime/read' }>;
}

export function thinkingProvenance(observations: readonly ModelObservation[]): ThinkingProvenance {
  const values = observations.map((observation) => ({ observed_at: observation.observed_at, value: observation.thinking, source: observation.source as 'runtime/read' }));
  const captured = observations.map((observation) => observation.requested_thinking);
  const requestIsProven = observations.length > 0 && observations.every((observation) => typeof observation.requested_thinking === 'string' && observation.requested_thinking_source === 'supervisor-session-config');
  const requested = requestIsProven && captured.every((value) => value === captured[0]) ? captured[0]! : null;
  const requestSource: ThinkingProvenance['requested']['source'] = requested === null ? 'unavailable' : 'supervisor-session-config';
  const drift = requested !== null && values.some((observation) => observation.value !== null && observation.value !== requested);
  const unavailable = requested === null || values.length === 0 || values.some((observation) => observation.value === null);
  return {
    requested: { value: requested, source: requestSource },
    status: drift ? 'drift' : unavailable ? 'unavailable' : 'matched',
    observations: values
  };
}

export function reportUsage(usage: UsageState | null | undefined): (UsageState & {
  priceAvailability: 'available' | 'unavailable';
  priceSource: 'runtime/read' | 'unavailable';
  costAvailability: 'available' | 'unavailable';
}) | null {
  if (!usage) return null;
  const hasCost = usage.cost !== undefined;
  const priceAvailability = usage.priceAvailability ?? 'unavailable';
  const priceSource = usage.priceSource ?? 'unavailable';
  const costAvailability = usage.costAvailability ?? (hasCost ? 'available' : 'unavailable');
  const { cost, costSource, ...details } = usage;
  return {
    ...details,
    ...(costAvailability === 'available' && cost ? { cost } : {}),
    ...(costAvailability === 'available' && costSource ? { costSource } : {}),
    priceAvailability,
    priceSource,
    costAvailability
  };
}

export function elapsed(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const delta = Date.parse(end) - Date.parse(start);
  return Number.isFinite(delta) && delta >= 0 ? delta : null;
}
