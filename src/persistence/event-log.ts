import { open, lstat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createPrivateDir } from '../security/paths.js';

export interface EventLogOptions {
  maxBytes: number;
  windowMs?: number;
  initialBytes?: number;
  onFailure?: (error: unknown) => void;
  onFlushed?: () => void;
}

const DEFAULT_WINDOW_MS = 100;
const RETRY_WINDOW_MS = 1000;
const MAX_RETRY_WINDOW_MS = 30_000;
const MAX_TIMED_RETRIES = 8;
const STRUCTURAL_CODES: ReadonlySet<string> = new Set(['ENOENT', 'EISDIR', 'ELOOP', 'ENOTDIR', 'ENXIO', 'ENOTSUP']);

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function unsafeTarget(code: 'EISDIR' | 'ELOOP' | 'ENOTSUP', file: string): Error {
  return Object.assign(new Error('Refusing unsafe NDJSON target'), { code, path: file });
}

export class EventLog {
  private readonly file: string;
  private readonly maxBytes: number;
  private readonly windowMs: number;
  private readonly onFailure: ((error: unknown) => void) | undefined;
  private readonly onFlushed: (() => void) | undefined;
  private buffer: string[] = [];
  private persistedBytes: number;
  private bufferedBytes = 0;
  private droppedBytes = 0;
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();
  private verified = false;
  private disposed = false;
  private unavailable = false;
  private timedRetries = 0;

  constructor(file: string, options: EventLogOptions) {
    this.file = path.resolve(file);
    this.maxBytes = options.maxBytes;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.persistedBytes = options.initialBytes ?? 0;
    this.onFailure = options.onFailure;
    this.onFlushed = options.onFlushed;
  }

  get failed(): boolean { return this.unavailable; }

  append(record: unknown): boolean {
    const payload = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(payload);
    if (this.unavailable) {
      if (this.persistedBytes + this.droppedBytes + size > this.maxBytes) return false;
      this.droppedBytes += size;
      return true;
    }
    if (size > this.maxBytes) throw new RangeError('NDJSON record exceeds configured byte limit');
    if (this.persistedBytes + this.bufferedBytes + size > this.maxBytes) throw new RangeError('NDJSON store exceeds configured byte limit');
    this.buffer.push(payload);
    this.bufferedBytes += size;
    this.arm(this.windowMs);
    return true;
  }

  flush(): Promise<void> {
    this.clearTimer();
    const run = this.chain.then(() => this.drain());
    this.chain = run.then(() => undefined, () => undefined);
    run.catch(() => { if (this.buffer.length > 0 && !this.unavailable) this.arm(this.retryDelay(), true); });
    return run;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  protected async openHandle(flags: number, mode: number): Promise<FileHandle> {
    return await open(this.file, flags, mode);
  }

  protected async write(payload: string): Promise<unknown> {
    try { return await this.writeOnce(payload); }
    catch (error) {
      if (codeOf(error) !== 'ENOENT') throw error;
      this.verified = false;
      return await this.writeOnce(payload);
    }
  }

  private async verifyTarget(): Promise<void> {
    try { await createPrivateDir(path.dirname(this.file)); }
    catch (error) { throw codeOf(error) === 'VSUP_WORKSPACE_INVALID' ? Object.assign(new Error('The run directory is not a real directory.'), { code: 'ENOTDIR', path: this.file }) : error; }
    try {
      const info = await lstat(this.file);
      if (info.isSymbolicLink()) throw unsafeTarget('ELOOP', this.file);
      if (info.isDirectory()) throw unsafeTarget('EISDIR', this.file);
      if (!info.isFile()) throw unsafeTarget('ENOTSUP', this.file);
    } catch (error) { if (codeOf(error) !== 'ENOENT') throw error; }
  }

  private async writeOnce(payload: string): Promise<unknown> {
    if (!this.verified) await this.verifyTarget();
    const handle = await this.openHandle(constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0), 0o600);
    let closeError: unknown;
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw unsafeTarget(info.isDirectory() ? 'EISDIR' : 'ENOTSUP', this.file);
      if (!this.verified) await handle.chmod(0o600);
      try { await handle.writeFile(payload, 'utf8'); await handle.sync(); }
      catch (error) { await handle.truncate(info.size).catch(() => undefined); throw error; }
      this.verified = true;
    } finally {
      try { await handle.close(); } catch (error) { closeError = error; }
    }
    return closeError;
  }

  private async drain(): Promise<void> {
    if (this.unavailable) return;
    const count = this.buffer.length;
    if (count === 0) return;
    const batch = this.buffer.slice(0, count);
    const payload = batch.join('');
    let closeError: unknown;
    try { closeError = await this.write(payload); }
    catch (error) {
      const code = codeOf(error);
      if (code && STRUCTURAL_CODES.has(code)) this.giveUp();
      throw error;
    }
    const bytes = Buffer.byteLength(payload);
    this.buffer.splice(0, count);
    this.persistedBytes += bytes;
    this.bufferedBytes -= bytes;
    this.timedRetries = 0;
    this.onFlushed?.();
    if (closeError !== undefined) { try { this.onFailure?.(closeError); } catch {} }
  }

  private giveUp(): void {
    this.unavailable = true;
    this.buffer = [];
    this.bufferedBytes = 0;
    this.clearTimer();
  }

  private retryDelay(): number {
    return Math.min(RETRY_WINDOW_MS * 2 ** this.timedRetries, MAX_RETRY_WINDOW_MS);
  }

  private arm(delay: number, retry = false): void {
    if (this.timer || this.disposed) return;
    if (retry) { if (this.timedRetries >= MAX_TIMED_RETRIES) return; this.timedRetries += 1; }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush().catch((error: unknown) => { try { this.onFailure?.(error); } catch {} });
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
