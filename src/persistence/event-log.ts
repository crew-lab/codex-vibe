import { open, lstat } from 'node:fs/promises';
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

export class EventLog {
  private readonly file: string;
  private readonly maxBytes: number;
  private readonly windowMs: number;
  private readonly onFailure: ((error: unknown) => void) | undefined;
  private readonly onFlushed: (() => void) | undefined;
  private buffer: string[] = [];
  private persistedBytes: number;
  private bufferedBytes = 0;
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();
  private verified = false;
  private disposed = false;

  constructor(file: string, options: EventLogOptions) {
    this.file = path.resolve(file);
    this.maxBytes = options.maxBytes;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.persistedBytes = options.initialBytes ?? 0;
    this.onFailure = options.onFailure;
    this.onFlushed = options.onFlushed;
  }

  append(record: unknown): void {
    const payload = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(payload);
    if (size > this.maxBytes) throw new RangeError('NDJSON record exceeds configured byte limit');
    if (this.persistedBytes + this.bufferedBytes + size > this.maxBytes) throw new RangeError('NDJSON store exceeds configured byte limit');
    this.buffer.push(payload);
    this.bufferedBytes += size;
    this.arm(this.windowMs);
  }

  flush(): Promise<void> {
    this.clearTimer();
    const run = this.chain.then(() => this.drain());
    this.chain = run.then(() => undefined, () => undefined);
    run.catch(() => { if (this.buffer.length > 0) this.arm(RETRY_WINDOW_MS); });
    return run;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  protected async write(payload: string): Promise<void> {
    if (!this.verified) {
      await createPrivateDir(path.dirname(this.file));
      try { const info = await lstat(this.file); if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe NDJSON target'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const handle = await open(this.file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Refusing unsafe NDJSON target');
      if (!this.verified) await handle.chmod(0o600);
      try { await handle.writeFile(payload, 'utf8'); await handle.sync(); }
      catch (error) { await handle.truncate(this.persistedBytes).catch(() => undefined); throw error; }
      this.verified = true;
    } finally { await handle.close(); }
  }

  private async drain(): Promise<void> {
    const count = this.buffer.length;
    if (count === 0) return;
    const batch = this.buffer.slice(0, count);
    const payload = batch.join('');
    await this.write(payload);
    const bytes = Buffer.byteLength(payload);
    this.buffer.splice(0, count);
    this.persistedBytes += bytes;
    this.bufferedBytes -= bytes;
    this.onFlushed?.();
  }

  private arm(delay: number): void {
    if (this.timer || this.disposed) return;
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
