import { supervisorError } from '../../contracts.js';

export type JsonObject = Record<string, unknown>;

export function object(value: unknown, field = 'object'): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw supervisorError('VSUP_BACKEND_ERROR', `Invalid app-server ${field}.`);
  return value as JsonObject;
}

export function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw supervisorError('VSUP_BACKEND_ERROR', `Missing app-server ${field}.`);
  return value;
}

export function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw supervisorError('VSUP_BACKEND_ERROR', `Invalid app-server ${field}.`);
  return value;
}

export function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw supervisorError('VSUP_BACKEND_ERROR', `Missing app-server ${field}.`);
  return value;
}

export interface SessionIdentity {
  sessionId: string;
  turnId?: string;
}
