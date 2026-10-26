import { constants as fsConstants } from 'node:fs';
import { mkdir, open, lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { supervisorError, type SupervisorErrorCode } from '../contracts.js';
import { redactSecrets } from '../security/redaction.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_RECORD_BYTES = 8192;

type GrantInput = { requestSha256: string; ownerReference: string; expiresAt: string };
type IssuedGrant = { authorization_id: string; attempt_id: string; request_sha256: string; expires_at: string };
type GrantRecord = { grant_id: string; attempt_id: string; request_sha256: string; owner_reference: string; issued_at: string; expires_at: string };

function fail(code: SupervisorErrorCode, message: string): Error {
  return Object.assign(new Error(message), supervisorError(code, message));
}

function invalid(): Error {
  return fail('VSUP_AUTHORIZATION_INVALID', 'The dispatch authorization is invalid or unavailable.');
}

function storage(): Error {
  return fail('VSUP_STORAGE_ERROR', 'Dispatch authorization storage could not be safely accessed or made durable.');
}

function uuid(): string { return randomUUID(); }
function validTimestamp(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function foreignOwner(uid: number): boolean { return typeof process.getuid === 'function' && uid !== process.getuid(); }

export class DispatchGrants {
  private readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }

  async issue(input: GrantInput): Promise<IssuedGrant> {
    if (!input || !SHA256.test(input.requestSha256) || typeof input.ownerReference !== 'string' || input.ownerReference.length < 1 || input.ownerReference.length > 256 || /[\u0000-\u001f\u007f]/.test(input.ownerReference) || redactSecrets(input.ownerReference) !== input.ownerReference || !validTimestamp(input.expiresAt) || Date.parse(input.expiresAt) <= Date.now()) throw invalid();
    try {
      await this.ensureRoot();
      const authorizationId = uuid();
      const attemptId = uuid();
      const issuedAt = new Date().toISOString();
      const record: GrantRecord = { grant_id: authorizationId, attempt_id: attemptId, request_sha256: input.requestSha256.toLowerCase(), owner_reference: input.ownerReference, issued_at: issuedAt, expires_at: input.expiresAt };
      const file = path.join(this.root, `${authorizationId}.json`);
      await this.writeExclusive(file, `${JSON.stringify(record)}\n`);
      await this.syncDirectory(this.root);
      return { authorization_id: authorizationId, attempt_id: attemptId, request_sha256: record.request_sha256, expires_at: input.expiresAt };
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'VSUP_AUTHORIZATION_INVALID') throw error;
      throw storage();
    }
  }

  async consume(input: { authorizationId: string; attemptId: string; requestSha256: string; runId: string }): Promise<void> {
    if (!input || !UUID_V4.test(input.authorizationId) || !UUID_V4.test(input.attemptId) || !UUID_V4.test(input.runId) || !SHA256.test(input.requestSha256)) throw invalid();
    try {
      await this.ensureRoot();
      const file = path.join(this.root, `${input.authorizationId}.json`);
      const record = await this.readGrant(file);
      if (record.grant_id !== input.authorizationId || record.attempt_id !== input.attemptId || record.request_sha256 !== input.requestSha256.toLowerCase() || Date.parse(record.expires_at) <= Date.now()) throw invalid();
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
      if (code === 'ENOENT') throw invalid();
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
      if (Object.keys(row).sort().join(',') !== 'attempt_id,expires_at,grant_id,issued_at,owner_reference,request_sha256' || typeof row.grant_id !== 'string' || !UUID_V4.test(row.grant_id) || typeof row.attempt_id !== 'string' || !UUID_V4.test(row.attempt_id) || typeof row.request_sha256 !== 'string' || !SHA256.test(row.request_sha256) || typeof row.owner_reference !== 'string' || row.owner_reference.length < 1 || row.owner_reference.length > 256 || /[\u0000-\u001f\u007f]/.test(row.owner_reference) || redactSecrets(row.owner_reference) !== row.owner_reference || !validTimestamp(String(row.issued_at)) || !validTimestamp(String(row.expires_at)) || Date.parse(String(row.expires_at)) <= Date.parse(String(row.issued_at))) throw invalid();
      return row as GrantRecord;
    } finally { await handle.close(); }
  }
}
