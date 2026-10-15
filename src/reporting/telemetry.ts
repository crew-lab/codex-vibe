import { z } from 'zod';
export const modelObservationSchema = z.object({ observed_at: z.string().datetime(), source: z.literal('runtime/read'), session_model: z.string().max(500).nullable(), alias: z.string().max(500).nullable(), thinking: z.string().max(100).nullable(), reported_name: z.string().max(500).nullable().optional(), prices_per_million: z.object({ input: z.number().nullable(), output: z.number().nullable(), cached_input: z.number().nullable() }).strict().optional() }).strict();
export const modelObservationsSchema = z.array(modelObservationSchema).max(100);
export type ModelObservation = z.infer<typeof modelObservationSchema>;
export function elapsed(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const delta = Date.parse(end) - Date.parse(start);
  return Number.isFinite(delta) && delta >= 0 ? delta : null;
}
