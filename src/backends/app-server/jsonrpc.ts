import type { Readable, Writable } from 'node:stream';
import { supervisorError, type SupervisorError } from '../../contracts.js';
import { object, type JsonObject } from './protocol.js';

interface Pending {
  resolve(value: JsonObject): void;
  reject(error: SupervisorError): void;
  timer: NodeJS.Timeout;
}

export interface JsonRpcOptions {
  maxBytes: number;
  remainingMs(): number;
  onNotification(method: string, params: JsonObject): void | Promise<void>;
  onRequest(method: string, params: JsonObject): Promise<JsonObject>;
  afterResponse?(method: string, params: JsonObject, result: JsonObject): void | Promise<void>;
  onFailure(error: SupervisorError): void;
  onActivity?(): void;
}

/** Bounded wire transport. Raw frames stay in memory and never reach persistence. */
export class JsonRpcClient {
  private readonly pending = new Map<number, Pending>();
  private readonly serverRequests = new Set<number>();
  private readonly seenServerRequests = new Set<number>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private received = 0;
  private queuedBytes = 0;
  private incoming = 0;
  private outbound = Promise.resolve();
  private inbound = Promise.resolve();
  private closed = false;
  private readonly frameLimit: number;

  constructor(private readonly input: Readable, private readonly output: Writable, private readonly options: JsonRpcOptions) {
    this.frameLimit = Math.min(1_048_576, options.maxBytes);
    input.on('data', (chunk: Buffer) => this.receive(Buffer.from(chunk)));
    input.on('end', () => this.fail(supervisorError('VSUP_BACKEND_CRASHED', 'App-server stdout ended before transport close.')));
    input.on('error', () => this.fail(supervisorError('VSUP_BACKEND_CRASHED', 'App-server stdout failed.')));
    output.on('error', () => this.fail(supervisorError('VSUP_BACKEND_CRASHED', 'App-server stdin failed.')));
  }

  request(method: string, params: JsonObject, timeoutMs = 30_000): Promise<JsonObject> {
    if (this.closed) return Promise.reject(supervisorError('VSUP_BACKEND_CRASHED', 'App-server transport is closed.'));
    if (this.pending.size >= 32) return Promise.reject(supervisorError('VSUP_OUTPUT_LIMIT', 'App-server pending request limit exceeded.'));
    const duration = Math.min(timeoutMs, this.options.remainingMs());
    if (duration <= 0) return Promise.reject(supervisorError('VSUP_TIMEOUT', 'App-server request deadline expired.'));
    const id = this.nextId++;
    return new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = supervisorError('VSUP_TIMEOUT', 'App-server request timed out.');
        reject(error);
        this.fail(error);
      }, duration);
      this.pending.set(id, { resolve, reject, timer });
      void this.send({ jsonrpc: '2.0', id, method, params }).catch((error: SupervisorError) => this.fail(error));
    });
  }

  notify(method: string, params: JsonObject): Promise<void> {
    return this.send({ jsonrpc: '2.0', method, params });
  }

  close(): void {
    if (this.closed) {
      if (!this.output.destroyed && !this.output.writableEnded) this.output.end();
      return;
    }
    this.closed = true;
    this.rejectPending(supervisorError('VSUP_BACKEND_CRASHED', 'App-server transport closed.'));
    this.buffer = Buffer.alloc(0);
    if (!this.output.destroyed && !this.output.writableEnded) this.output.end();
  }

  private async send(message: JsonObject): Promise<void> {
    if (this.closed) throw supervisorError('VSUP_BACKEND_CRASHED', 'App-server transport is closed.');
    const frame = Buffer.from(JSON.stringify(message) + '\n');
    if (frame.length > this.frameLimit || this.queuedBytes + frame.length > 1_048_576) {
      const error = supervisorError('VSUP_OUTPUT_LIMIT', 'App-server outbound frame or queue limit exceeded.');
      this.fail(error);
      throw error;
    }
    this.queuedBytes += frame.length;
    const written = this.outbound.then(async () => {
      if (this.closed) throw supervisorError('VSUP_BACKEND_CRASHED', 'App-server transport is closed.');
      await new Promise<void>((resolve, reject) => this.output.write(frame, error => error ? reject(supervisorError('VSUP_BACKEND_CRASHED', 'App-server write failed.')) : resolve()));
    });
    this.outbound = written.catch(() => undefined);
    try { await written; } finally { this.queuedBytes -= frame.length; }
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    this.received += chunk.length;
    if (this.received > this.options.maxBytes) return this.fail(supervisorError('VSUP_OUTPUT_LIMIT', 'App-server inbound byte budget exceeded.'));
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (!this.closed) {
      const end = this.buffer.indexOf(10);
      if (end < 0) {
        if (this.buffer.length > this.frameLimit) this.fail(supervisorError('VSUP_OUTPUT_LIMIT', 'App-server frame limit exceeded.'));
        return;
      }
      if (end + 1 > this.frameLimit) return this.fail(supervisorError('VSUP_OUTPUT_LIMIT', 'App-server frame limit exceeded.'));
      const line = this.buffer.subarray(0, end);
      this.buffer = this.buffer.subarray(end + 1);
      try {
        const frame = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)), 'frame');
        this.dispatch(frame);
      } catch {
        this.fail(supervisorError('VSUP_BACKEND_ERROR', 'Malformed app-server protocol frame.'));
      }
    }
  }

  private dispatch(frame: JsonObject): void {
    if (frame.jsonrpc !== '2.0') throw new Error('Wrong protocol');
    this.options.onActivity?.();
    if (typeof frame.method === 'string') {
      const params = object(frame.params, 'params');
      if ('result' in frame || 'error' in frame) throw new Error('Mixed request and response');
      const hasId = 'id' in frame;
      if (hasId && (!Number.isSafeInteger(frame.id) || typeof frame.id !== 'number')) throw new Error('Invalid server id');
      const id = hasId ? frame.id as number : undefined;
      if (id !== undefined) {
        if (this.seenServerRequests.has(id)) throw new Error('Replayed server request');
        if (this.seenServerRequests.size >= 10_000) return this.fail(supervisorError('VSUP_OUTPUT_LIMIT', 'App-server request history limit exceeded.'));
        this.serverRequests.add(id);
        this.seenServerRequests.add(id);
      }
      if (++this.incoming > 32) return this.fail(supervisorError('VSUP_OUTPUT_LIMIT', 'App-server inbound work queue exceeded.'));
      // Responses are handled synchronously below, so handlers can safely await RPCs.
      this.inbound = this.inbound.then(async () => {
        if (this.closed) return;
        if (id === undefined) await this.options.onNotification(frame.method as string, params);
        else {
          const result = await this.options.onRequest(frame.method as string, params);
          await this.send({ jsonrpc: '2.0', id, result });
          this.serverRequests.delete(id);
          await this.options.afterResponse?.(frame.method as string, params, result);
        }
      }).catch(() => this.fail(supervisorError('VSUP_BACKEND_ERROR', 'App-server event or callback validation failed.'))).finally(() => { this.incoming--; });
      return;
    }
    if (typeof frame.id !== 'number' || !Number.isSafeInteger(frame.id) || ('result' in frame) === ('error' in frame)) throw new Error('Invalid response');
    const pending = this.pending.get(frame.id);
    if (!pending) throw new Error('Unmatched response');
    if ('error' in frame) {
      const error = object(frame.error, 'error');
      if (typeof error.code !== 'string') throw new Error('Invalid error code');
      const known = new Set(['invalid_request', 'invalid_params', 'not_initialized', 'not_found', 'conflict', 'stale_turn', 'not_steerable', 'callback_closed', 'compaction_failed', 'unauthorized', 'forbidden', 'method_not_found', 'not_implemented', 'stale_cursor', 'internal_error']);
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      pending.reject(supervisorError(error.code === 'unauthorized' ? 'VSUP_AUTH_REQUIRED' : 'VSUP_BACKEND_ERROR', 'App-server rejected a request.', { protocol_code: known.has(error.code) ? error.code : '<unknown>' }));
    } else {
      const result = object(frame.result, 'result');
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      pending.resolve(result);
    }
  }

  private rejectPending(error: SupervisorError): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private fail(error: SupervisorError): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(error);
    this.buffer = Buffer.alloc(0);
    this.options.onFailure(error);
  }
}
