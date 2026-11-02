import { constants as fsConstants } from 'node:fs';
import { mkdir, open, lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { supervisorError, type SupervisorErrorCode } from '../contracts.js';
import { redactSecrets } from '../security/redaction.js';
import { bindingMismatchError } from './dispatch-binding.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_RECORD_BYTES = 8192;
export const MAX_GRANT_LIFETIME_MS = 24 * 60 * 60 * 1000;

type Binding = Readonly<Record<string, string>>;
type GrantInput = { requestSha256: string; binding: Binding; ownerReference: string; expiresAt: string };
type IssuedGrant = { authorization_id: string; attempt_id: string; request_sha256: string; expires_at: string };
type GrantRecord = { grant_id: string; attempt_id: string; request_sha256: string; binding?: Binding; owner_reference: string; issued_at: string; expires_at: string };
const BINDING_FIELD = /^[a-z_]{1,40}$/;
const MAX_BINDING_FIELDS = 32;

function fail(code: SupervisorErrorCode, message: string): Error {
  return Object.assign(new Error(message), supervisorError(code, message));
}

function invalid(): Error {
  return fail('VSUP_AUTHORIZATION_INVALID', 'The dispatch authorization is invalid or unavailable.');
}

function unregistered(): Error {
  return fail('VSUP_AUTHORIZATION_INVALID', 'No dispatch authorization is registered under this data directory; register the task with task authorize using the same configuration as the server.');
}

function validBinding(value: unknown): value is Binding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= MAX_BINDING_FIELDS && entries.every(([field, hash]) => BINDING_FIELD.test(field) && typeof hash === 'string' && SHA256.test(hash));
}

function storage(): Error {
  return fail('VSUP_STORAGE_ERROR', 'Dispatch authorization storage could not be safely accessed or made durable.');
}

export function registrationStorageError(error: unknown, operation: 'prepare_directory' | 'write_grant'): Error {
  const raw = error as { code?: unknown; details?: { code?: unknown } } | null;
  const candidate = raw?.details?.code ?? raw?.code;
  const code = typeof candidate === 'string' && ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT', 'EIO', 'EMFILE'].includes(candidate) ? candidate : 'UNAVAILABLE';
  const permission = code === 'EACCES' || code === 'EPERM';
  const message = permission ? `Administrative grant registration failed during ${operation}: cannot write Supervisor-private state (${code}). Use the host-supported scoped command permission for the selected installed CLI, Node runtime and configuration; no worker was started.` : `Administrative grant storage is unavailable or unsafe during ${operation}; no worker was started.`;
  const mapped = { ...supervisorError('VSUP_STORAGE_ERROR', message, { phase: 'grant_registration', operation, code }), ...(permission ? { remediation: 'Preserve the selected private state and ownership checks. Request scoped administrative command permission; do not relocate storage or automatically retry dispatch.' } : {}) };
  return Object.assign(new Error(message), mapped, { supervisor: mapped });
}

function uuid(): string { return randomUUID(); }
function validTimestamp(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function normalizeExpiry(value: unknown): string {
  const message = '--expires-at must be an ISO 8601 timestamp with seconds and a timezone (Z or ±HH:MM); fractional seconds are optional.';
  if (typeof value !== 'string') throw fail('VSUP_AUTHORIZATION_INVALID', message);
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?(Z|[+-]\d\d:\d\d)$/.exec(value.trim());
  if (!match) throw fail('VSUP_AUTHORIZATION_INVALID', message);
  const local = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  if (!validTimestamp(local)) throw fail('VSUP_AUTHORIZATION_INVALID', message);
  const zone = match[3]!;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59 || zone === '-00:00')) throw fail('VSUP_AUTHORIZATION_INVALID', message);
  const milliseconds = Date.parse(`${match[1]}.${(match[2] ?? '').padEnd(3, '0')}${zone}`);
  if (!Number.isFinite(milliseconds)) throw fail('VSUP_AUTHORIZATION_INVALID', message);
  return new Date(milliseconds).toISOString();
}
function foreignOwner(uid: number): boolean { return typeof process.getuid === 'function' && uid !== process.getuid(); }

export class DispatchGrants {
  private readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }

  async issue(input: GrantInput, beforeIssue?: () => Promise<void>): Promise<IssuedGrant> {
    if (!input || !SHA256.test(input.requestSha256) || !validBinding(input.binding) || typeof input.ownerReference !== 'string' || input.ownerReference.length < 1 || input.ownerReference.length > 256 || /[\u0000-\u001f\u007f]/.test(input.ownerReference) || redactSecrets(input.ownerReference) !== input.ownerReference) throw invalid();
    const expiresAt = normalizeExpiry(input.expiresAt);
    const now = Date.now();
    if (Date.parse(expiresAt) <= now) throw fail('VSUP_AUTHORIZATION_INVALID', '--expires-at must be in the future.');
    if (Date.parse(expiresAt) - now > MAX_GRANT_LIFETIME_MS) throw fail('VSUP_AUTHORIZATION_INVALID', 'A dispatch authorization must expire within 24 hours of registration.');
    try {
      await this.ensureRoot();
      await beforeIssue?.();
      const authorizationId = uuid();
      const attemptId = uuid();
      const issuedAt = new Date().toISOString();
      const record: GrantRecord = { grant_id: authorizationId, attempt_id: attemptId, request_sha256: input.requestSha256.toLowerCase(), binding: input.binding, owner_reference: input.ownerReference, issued_at: issuedAt, expires_at: expiresAt };
      const file = path.join(this.root, `${authorizationId}.json`);
      await this.writeExclusive(file, `${JSON.stringify(record)}\n`);
      await this.syncDirectory(this.root);
      return { authorization_id: authorizationId, attempt_id: attemptId, request_sha256: record.request_sha256, expires_at: expiresAt };
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'VSUP_AUTHORIZATION_INVALID') throw error;
      throw registrationStorageError(error, 'write_grant');
    }
  }

  async consume(input: { authorizationId: string; attemptId: string; requestSha256: string; binding: Binding; runId: string }): Promise<void> {
    if (!input || !UUID_V4.test(input.authorizationId) || !UUID_V4.test(input.attemptId) || !UUID_V4.test(input.runId) || !SHA256.test(input.requestSha256) || !validBinding(input.binding)) throw fail('VSUP_AUTHORIZATION_INVALID', 'authorization_id and attempt_id must be the UUIDs that task authorize printed.');
    try {
      await lstat(this.root).catch((error: NodeJS.ErrnoException) => { throw error.code === 'ENOENT' ? unregistered() : error; });
      await this.ensureRoot();
      const file = path.join(this.root, `${input.authorizationId}.json`);
      const record = await this.readGrant(file).catch((error: NodeJS.ErrnoException) => { throw error.code === 'ENOENT' ? fail('VSUP_AUTHORIZATION_INVALID', 'No authorization with this authorization_id is registered under this data directory.') : error; });
      if (record.grant_id !== input.authorizationId) throw invalid();
      if (record.attempt_id !== input.attemptId) throw fail('VSUP_AUTHORIZATION_INVALID', 'This attempt_id does not belong to the authorization_id; pass the pair task authorize printed together.');
      if (Date.parse(record.expires_at) <= Date.now()) throw fail('VSUP_AUTHORIZATION_INVALID', `This authorization expired at ${record.expires_at}; register the task again.`);
      if (record.request_sha256 !== input.requestSha256.toLowerCase()) throw record.binding ? bindingMismatchError(record.binding, input.binding, 'The start differs from its registered authorization') : invalid();
      const attempts = path.join(this.root, 'consumed');
      await mkdir(attempts, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      await this.verifyDirectory(attempts);
      await this.syncDirectory(this.root);
      const reservation = path.join(attempts, `${input.attemptId}.json`);
      try {
        const handle = await open(reservation, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ grant_id: input.authorizationId, attempt_id: input.attemptId, request_sha256: record.request_sha256, run_id: input.runId, reserved_at: new Date().toISOString() })}\n`, 'utf8');
          await handle.sync();
        } finally { await handle.close(); }
        await this.syncDirectory(attempts);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw fail('VSUP_ATTEMPT_CONSUMED', 'This dispatch attempt has already been consumed.');
        throw error;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'VSUP_AUTHORIZATION_INVALID' || code === 'VSUP_ATTEMPT_CONSUMED') throw error;
      throw storage();
    }
  }

  private async ensureRoot(): Promise<void> {
    const parent = path.dirname(this.root);
    await this.verifyDirectory(parent);
    await mkdir(this.root, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    await this.syncDirectory(parent);
    await this.verifyDirectory(this.root);
    if (await realpath(this.root) !== this.root) throw storage();
  }

  private async verifyDirectory(directory: string): Promise<void> {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || foreignOwner(info.uid) || await realpath(directory) !== path.resolve(directory)) throw storage();
  }

  private async writeExclusive(file: string, text: string): Promise<void> {
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try { await handle.sync(); } finally { await handle.close(); }
  }

  private async readGrant(file: string): Promise<GrantRecord> {
    const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || foreignOwner(info.uid) || (info.mode & 0o077) !== 0 || info.size > MAX_RECORD_BYTES) throw storage();
      const bounded = Buffer.alloc(MAX_RECORD_BYTES + 1);
      const { bytesRead } = await handle.read(bounded, 0, bounded.length, 0);
      if (bytesRead > MAX_RECORD_BYTES) throw storage();
      const raw: unknown = JSON.parse(bounded.subarray(0, bytesRead).toString('utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
      const row = raw as Record<string, unknown>;
      const keys = Object.keys(row).filter((key) => key !== 'binding').sort().join(',');
      if (keys !== 'attempt_id,expires_at,grant_id,issued_at,owner_reference,request_sha256' || (row.binding !== undefined && !validBinding(row.binding)) || typeof row.grant_id !== 'string' || !UUID_V4.test(row.grant_id) || typeof row.attempt_id !== 'string' || !UUID_V4.test(row.attempt_id) || typeof row.request_sha256 !== 'string' || !SHA256.test(row.request_sha256) || typeof row.owner_reference !== 'string' || row.owner_reference.length < 1 || row.owner_reference.length > 256 || /[\u0000-\u001f\u007f]/.test(row.owner_reference) || redactSecrets(row.owner_reference) !== row.owner_reference || !validTimestamp(String(row.issued_at)) || !validTimestamp(String(row.expires_at)) || Date.parse(String(row.expires_at)) <= Date.parse(String(row.issued_at)) || Date.parse(String(row.expires_at)) - Date.parse(String(row.issued_at)) > MAX_GRANT_LIFETIME_MS) throw invalid();
      return row as GrantRecord;
    } finally { await handle.close(); }
  }
}
