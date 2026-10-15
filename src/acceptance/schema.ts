import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sanitizeForPersistence } from '../persistence/atomic.js';

export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const safeRelativePath = z.string().min(1).max(1024).refine((value) => !/[\\:\x00-\x1f\x7f]/.test(value) && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.startsWith('-') && !['.git', '.vibe', '.agents', '.aws', '.ssh'].includes(part.toLowerCase()) && !/^(?:\.env(?:\.|$)|\.envrc)|\.(?:pem|key|p12|pfx)$/i.test(part)), 'Unsafe or sensitive repository-relative path');
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/);
const basic = { id, path: safeRelativePath };
export const checkSchema = z.discriminatedUnion('kind', [
  z.object({ ...basic, kind: z.literal('file_exists') }).strict(),
  z.object({ ...basic, kind: z.literal('file_absent') }).strict(),
  z.object({ ...basic, kind: z.literal('text_contains'), value: z.string().min(1).max(100_000) }).strict(),
  z.object({ ...basic, kind: z.literal('text_not_contains'), value: z.string().min(1).max(100_000) }).strict(),
  z.object({ ...basic, kind: z.literal('file_sha256'), value: sha256 }).strict()
]);
export const acceptanceContractSchema = z.object({
  schema_version: z.literal(1), allowed_changed_paths: z.array(safeRelativePath).min(1).max(1000),
  required_changed_paths: z.array(safeRelativePath).max(1000).default([]),
  checks: z.array(checkSchema).min(1).max(100), required_validations: z.array(id).max(100).default([])
}).strict().superRefine((value, ctx) => {
  for (const list of [value.allowed_changed_paths, value.required_changed_paths, value.required_validations, value.checks.map((check) => check.id)]) {
    if (new Set(list).size !== list.length) ctx.addIssue({ code: 'custom', message: 'Duplicate contract entry' });
  }
  if (value.required_changed_paths.some((file) => !value.allowed_changed_paths.includes(file))) ctx.addIssue({ code: 'custom', message: 'Required changes must be allowed' });
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 256 * 1024 || JSON.stringify(sanitizeForPersistence(value)) !== text) ctx.addIssue({ code: 'custom', message: 'Oversized contract or content requiring redaction' });
});
export type AcceptanceContract = z.infer<typeof acceptanceContractSchema>;
export const validationSchema = z.object({ id, status: z.enum(['passed', 'failed', 'incomplete']), evidence_sha256: sha256.optional(), reference: z.string().max(1000).optional() }).strict();
export const assessmentSchema = z.object({ decision: z.enum(['accepted', 'rejected', 'deferred']), reason: z.string().min(1).max(2000), patch_sha256: sha256, contract_sha256: sha256, validations: z.array(validationSchema).max(100).default([]) }).strict().refine((value) => new Set(value.validations.map((item) => item.id)).size === value.validations.length, 'Duplicate validation ID');
export type AssessmentInput = z.infer<typeof assessmentSchema>;
export interface Assessment extends AssessmentInput { assessed_at: string }
export interface CheckResult { id: string; status: 'passed' | 'failed' | 'incomplete'; reason: string; path?: string | undefined }
export interface Verification {
  status: 'not_requested' | 'pending' | 'passed' | 'failed' | 'incomplete';
  contract_sha256?: string | undefined; patch_sha256?: string | undefined; base_commit?: string | undefined; checked_at?: string | undefined;
  execution_state?: string | undefined; checks: CheckResult[];
}
export const verificationSchema = z.object({
  status: z.enum(['not_requested', 'pending', 'passed', 'failed', 'incomplete']), contract_sha256: sha256.optional(), patch_sha256: sha256.optional(),
  base_commit: z.string().regex(/^[a-f0-9]{40,64}$/).optional(), checked_at: z.string().datetime().optional(), execution_state: z.string().max(30).optional(),
  checks: z.array(z.object({ id: z.string().max(120), status: z.enum(['passed', 'failed', 'incomplete']), reason: z.string().max(200), path: safeRelativePath.optional() }).strict()).max(102)
}).strict();
export function parseAssessments(value: unknown): Assessment[] {
  return z.array(z.unknown()).max(100).parse(value).map((entry) => {
    const { assessed_at, ...input } = z.record(z.string(), z.unknown()).parse(entry);
    return { ...assessmentSchema.parse(input), assessed_at: z.string().datetime().parse(assessed_at) };
  });
}
export function verificationSummary(value: Verification | undefined): Record<string, unknown> {
  if (!value) return { status: 'not_requested', check_count: 0 };
  const { checks, ...binding } = value;
  return { ...binding, check_count: checks.length, failed_checks: checks.filter((check) => check.status !== 'passed').slice(0, 10).map((check) => check.id) };
}
export function digest(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function contractDigest(value: AcceptanceContract): string { return digest(canonical(value)); }
