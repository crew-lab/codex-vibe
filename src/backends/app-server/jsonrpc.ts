import type { Readable, Writable } from 'node:stream';

export type JsonRpcId = number | string;
export type JsonObject = Record<string, unknown>;

export type JsonRpcFatalCode =
  | 'line_too_long'
  | 'inbound_budget_exceeded'
  | 'malformed_frame'
  | 'pending_limit_exceeded'
  | 'notification_limit_exceeded'
  | 'outbound_limit_exceeded'
  | 'unexpected_response'
  | 'handler_failed'
  | 'write_failed';

export type JsonRpcFatalKind = 'output_limit' | 'protocol' | 'io' | 'internal';

const FATAL_KIND: Record<JsonRpcFatalCode, JsonRpcFatalKind> = {
  line_too_long: 'output_limit',
  inbound_budget_exceeded: 'output_limit',
  pending_limit_exceeded: 'output_limit',
  notification_limit_exceeded: 'output_limit',
  outbound_limit_exceeded: 'output_limit',
  malformed_frame: 'protocol',
  unexpected_response: 'protocol',
  write_failed: 'io',
  handler_failed: 'internal'
};

export class JsonRpcFatalError extends Error {
  readonly kind: JsonRpcFatalKind;
  constructor(readonly code: JsonRpcFatalCode, message: string, readonly details: JsonObject = {}) {
    super(message);
    this.name = 'JsonRpcFatalError';
    this.kind = FATAL_KIND[code];
  }
}

export class JsonRpcServerError extends Error {
  constructor(readonly code: string, message: string, readonly data: unknown, readonly method: string) {
    super(message);
    this.name = 'JsonRpcServerError';
  }
}

export class JsonRpcTimeoutError extends Error {
  constructor(readonly method: string, readonly timeoutMs: number) {
    super(`JSON-RPC request ${method} timed out after ${timeoutMs} ms`);
    this.name = 'JsonRpcTimeoutError';
  }
}

export class JsonRpcClosedError extends Error {
  constructor(message = 'JSON-RPC connection is closed') {
    super(message);
    this.name = 'JsonRpcClosedError';
  }
}

export class JsonRpcReplyError extends Error {
  constructor(readonly code: string, message: string, readonly data?: unknown) {
    super(message);
    this.name = 'JsonRpcReplyError';
  }
}

export type NotificationHandler = (method: string, params: JsonObject) => void | Promise<void>;
export type ServerRequestHandler = (params: JsonObject, context: { id: JsonRpcId; method: string }) => unknown | Promise<unknown>;

export interface JsonRpcEndInfo {
  reason: 'eof' | 'fatal' | 'disposed';
  partialBytes: number;
  error?: JsonRpcFatalError;
}

export interface JsonRpcClientOptions {
  input: Readable;
  output: Writable;
  maxLineBytes?: number;
  maxInboundBytes?: number;
  maxPendingRequests?: number;
  maxQueuedNotifications?: number;
  maxOutboundBytes?: number;
  defaultTimeoutMs?: number;
  onNotification?: NotificationHandler;
  onActivity?: () => void;
  onDiagnostic?: (message: string) => void;
  onFatal?: (error: JsonRpcFatalError) => void;
  onEnd?: (info: JsonRpcEndInfo) => void;
}

export interface JsonRpcRequestOptions {
  timeoutMs?: number;
}

export interface JsonRpcStats {
  pendingRequests: number;
  queuedInbound: number;
  inboundBytes: number;
  framesReceived: number;
}

export const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_INBOUND_BYTES = 128 * 1024 * 1024;
export const DEFAULT_MAX_PENDING_REQUESTS = 32;
export const DEFAULT_MAX_QUEUED_NOTIFICATIONS = 4096;
export const DEFAULT_MAX_OUTBOUND_BYTES = 4 * 1024 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const TIMED_OUT_MEMORY = 1024;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

type InboundItem =
  | { kind: 'notification'; method: string; params: JsonObject }
  | { kind: 'request'; id: JsonRpcId; method: string; params: JsonObject };

const isPlainObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive integer`);
  return resolved;
}

export class JsonRpcClient {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly maxLineBytes: number;
  private readonly maxInboundBytes: number;
  private readonly maxPendingRequests: number;
  private readonly maxQueuedNotifications: number;
  private readonly maxOutboundBytes: number;
  private readonly defaultTimeoutMs: number;
  private readonly options: JsonRpcClientOptions;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly pending = new Map<number, PendingRequest>();
  private readonly timedOut = new Set<number>();
  private readonly handlers = new Map<string, ServerRequestHandler>();
  private readonly queue: InboundItem[] = [];
  private drainWaiters: Array<() => void> = [];
  private notificationHandler: NotificationHandler | undefined;
  private chunks: Buffer[] = [];
  private chunkBytes = 0;
  private inboundBytes = 0;
  private framesReceived = 0;
  private nextId = 1;
  private pumping = false;
  private eof = false;
  private stopped = false;
  private inputClosed = false;
  private fatalError: JsonRpcFatalError | undefined;
  private finished = false;
  private resolveDone!: (info: JsonRpcEndInfo) => void;
  readonly done: Promise<JsonRpcEndInfo>;

  constructor(options: JsonRpcClientOptions) {
    this.options = options;
    this.input = options.input;
    this.output = options.output;
    this.maxLineBytes = positiveInteger(options.maxLineBytes, DEFAULT_MAX_LINE_BYTES, 'maxLineBytes');
    this.maxInboundBytes = positiveInteger(options.maxInboundBytes, DEFAULT_MAX_INBOUND_BYTES, 'maxInboundBytes');
    this.maxPendingRequests = positiveInteger(options.maxPendingRequests, DEFAULT_MAX_PENDING_REQUESTS, 'maxPendingRequests');
    this.maxQueuedNotifications = positiveInteger(options.maxQueuedNotifications, DEFAULT_MAX_QUEUED_NOTIFICATIONS, 'maxQueuedNotifications');
    this.maxOutboundBytes = positiveInteger(options.maxOutboundBytes, DEFAULT_MAX_OUTBOUND_BYTES, 'maxOutboundBytes');
    this.defaultTimeoutMs = positiveInteger(options.defaultTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'defaultTimeoutMs');
    this.notificationHandler = options.onNotification;
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
    this.input.on('data', this.onData);
    this.input.on('end', this.onEnd);
    this.input.on('close', this.onEnd);
    this.input.on('error', this.onInputError);
    this.output.on('error', this.onOutputError);
  }

  get stats(): JsonRpcStats {
    return { pendingRequests: this.pending.size, queuedInbound: this.queue.length, inboundBytes: this.inboundBytes, framesReceived: this.framesReceived };
  }

  get fatal(): JsonRpcFatalError | undefined {
    return this.fatalError;
  }

  setNotificationHandler(handler: NotificationHandler | undefined): void {
    this.notificationHandler = handler;
    void this.pump();
  }

  setRequestHandler(method: string, handler: ServerRequestHandler | undefined): void {
    if (handler) this.handlers.set(method, handler);
    else this.handlers.delete(method);
  }

  request(method: string, params: JsonObject = {}, options: JsonRpcRequestOptions = {}): Promise<unknown> {
    if (this.fatalError) return Promise.reject(this.fatalError);
    if (this.stopped || this.eof || this.inputClosed) return Promise.reject(new JsonRpcClosedError());
    if (!method) return Promise.reject(new TypeError('method must be a non-empty string'));
    if (!isPlainObject(params)) return Promise.reject(new TypeError('params must be an object'));
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new RangeError('timeoutMs must be a positive number'));
    if (this.pending.size >= this.maxPendingRequests) {
      const error = new JsonRpcFatalError('pending_limit_exceeded', `more than ${this.maxPendingRequests} requests are pending`, { limit: this.maxPendingRequests });
      this.fail(error);
      return Promise.reject(error);
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.rememberTimedOut(id);
        reject(new JsonRpcTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: JsonObject = {}): void {
    if (this.fatalError) throw this.fatalError;
    if (this.stopped || this.eof || this.inputClosed) throw new JsonRpcClosedError();
    if (!method) throw new TypeError('method must be a non-empty string');
    if (!isPlainObject(params)) throw new TypeError('params must be an object');
    this.write({ jsonrpc: '2.0', method, params });
  }

  drained(): Promise<void> {
    if (this.stopped || (this.queue.length === 0 && !this.pumping)) return Promise.resolve();
    return new Promise<void>((resolve) => { this.drainWaiters.push(resolve); });
  }

  closeInput(): Promise<void> {
    if (this.inputClosed) return Promise.resolve();
    this.inputClosed = true;
    if (this.output.writableEnded || this.output.destroyed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const settle = () => resolve();
      this.output.once('finish', settle);
      this.output.once('close', settle);
      this.output.once('error', settle);
      try {
        this.output.end();
      } catch {
        settle();
      }
    });
  }

  dispose(): void {
    if (this.finished) return;
    this.stopped = true;
    this.queue.length = 0;
    this.rejectAll(new JsonRpcClosedError('JSON-RPC client disposed'));
    this.detach();
    this.releaseDrained();
    this.finish({ reason: 'disposed', partialBytes: this.chunkBytes });
  }

  private readonly onData = (data: Buffer | string): void => {
    if (this.stopped || this.eof) return;
    let buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    this.inboundBytes += buffer.length;
    if (this.inboundBytes > this.maxInboundBytes) {
      this.fail(new JsonRpcFatalError('inbound_budget_exceeded', `inbound bytes exceeded ${this.maxInboundBytes}`, { limit: this.maxInboundBytes }));
      return;
    }
    while (buffer.length > 0 && !this.stopped) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) {
        this.append(buffer);
        return;
      }
      this.append(buffer.subarray(0, newline));
      if (this.stopped) return;
      const line = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.chunkBytes);
      this.chunks = [];
      this.chunkBytes = 0;
      this.handleLine(line);
      buffer = buffer.subarray(newline + 1);
    }
  };

  private readonly onEnd = (): void => {
    if (this.eof || this.stopped) return;
    this.eof = true;
    this.rejectAll(new JsonRpcClosedError('JSON-RPC input stream ended'));
    void this.pump();
  };

  private readonly onInputError = (error: Error): void => {
    this.fail(new JsonRpcFatalError('write_failed', `input stream failed: ${error.message}`, { stream: 'input' }));
  };

  private readonly onOutputError = (error: Error): void => {
    this.fail(new JsonRpcFatalError('write_failed', `output stream failed: ${error.message}`, { stream: 'output' }));
  };

  private append(piece: Buffer): void {
    if (piece.length === 0) return;
    this.chunkBytes += piece.length;
    if (this.chunkBytes > this.maxLineBytes) {
      this.fail(new JsonRpcFatalError('line_too_long', `inbound line exceeded ${this.maxLineBytes} bytes`, { limit: this.maxLineBytes }));
      return;
    }
    this.chunks.push(piece);
  }

  private handleLine(line: Buffer): void {
    if (line.length === 0) return;
    this.framesReceived += 1;
    let frame: unknown;
    try {
      frame = JSON.parse(this.decoder.decode(line));
    } catch {
      this.fail(new JsonRpcFatalError('malformed_frame', 'inbound line is not valid UTF-8 JSON', { bytes: line.length }));
      return;
    }
    try {
      this.options.onActivity?.();
    } catch (error) {
      this.diagnostic(`activity callback failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    this.dispatch(frame, line.length);
  }

  private dispatch(frame: unknown, bytes: number): void {
    if (!isPlainObject(frame) || frame.jsonrpc !== '2.0') {
      this.fail(new JsonRpcFatalError('malformed_frame', 'inbound frame is not a JSON-RPC 2.0 object', { bytes }));
      return;
    }
    if (typeof frame.method === 'string') {
      const params = frame.params === undefined ? {} : frame.params;
      if (!isPlainObject(params)) {
        this.fail(new JsonRpcFatalError('malformed_frame', 'inbound params must be an object', { method: frame.method }));
        return;
      }
      if ('id' in frame) {
        const id = frame.id;
        if (typeof id !== 'string' && !(typeof id === 'number' && Number.isFinite(id))) {
          this.fail(new JsonRpcFatalError('malformed_frame', 'server request id must be a string or a number', { method: frame.method }));
          return;
        }
        this.enqueue({ kind: 'request', id, method: frame.method, params });
      } else {
        this.enqueue({ kind: 'notification', method: frame.method, params });
      }
      return;
    }
    const hasResult = 'result' in frame;
    const hasError = 'error' in frame;
    if (hasResult === hasError || !('id' in frame)) {
      this.fail(new JsonRpcFatalError('malformed_frame', 'inbound frame is neither a request, a notification nor a response', { bytes }));
      return;
    }
    this.handleResponse(frame, hasError);
  }

  private handleResponse(frame: JsonObject, hasError: boolean): void {
    const id = frame.id;
    if (hasError && id === null) {
      const { code, message } = this.errorParts(frame.error);
      this.fail(new JsonRpcFatalError('unexpected_response', 'server answered an unidentifiable request with an error', { code, message: message.slice(0, 500) }));
      return;
    }
    if (typeof id !== 'number') {
      this.fail(new JsonRpcFatalError('unexpected_response', 'response id is not one this client issued', {}));
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      if (this.timedOut.delete(id)) {
        this.diagnostic(`ignored late response for request ${id}`);
        return;
      }
      this.fail(new JsonRpcFatalError('unexpected_response', 'response id is not one this client issued', { id }));
      return;
    }
    if (hasError && !isPlainObject(frame.error)) {
      this.fail(new JsonRpcFatalError('malformed_frame', 'error response carries no error object', { id }));
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (hasError) {
      const { code, message, data } = this.errorParts(frame.error);
      pending.reject(new JsonRpcServerError(code, message, data, pending.method));
    } else {
      pending.resolve(frame.result);
    }
  }

  private errorParts(error: unknown): { code: string; message: string; data: unknown } {
    if (!isPlainObject(error)) return { code: 'unknown', message: '', data: undefined };
    const code = typeof error.code === 'string' ? error.code : typeof error.code === 'number' ? String(error.code) : 'unknown';
    return { code, message: typeof error.message === 'string' ? error.message : '', data: error.data };
  }

  private enqueue(item: InboundItem): void {
    if (this.queue.length >= this.maxQueuedNotifications) {
      this.fail(new JsonRpcFatalError('notification_limit_exceeded', `more than ${this.maxQueuedNotifications} inbound messages are queued`, { limit: this.maxQueuedNotifications }));
      return;
    }
    this.queue.push(item);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const item = this.queue[0]!;
        if (item.kind === 'notification') {
          const handler = this.notificationHandler;
          if (!handler) break;
          try {
            await handler(item.method, item.params);
          } catch (error) {
            this.fail(new JsonRpcFatalError('handler_failed', `notification handler failed: ${error instanceof Error ? error.message : 'unknown error'}`, { method: item.method }));
            return;
          }
        } else if (this.eof) {
          this.diagnostic(`dropped server request ${item.method} received before the stream ended`);
        } else {
          await this.serve(item);
        }
        if (this.stopped) return;
        this.queue.shift();
      }
    } finally {
      this.pumping = false;
      this.releaseDrained();
    }
    if (this.eof && !this.stopped && this.queue.length === 0) {
      this.detach();
      this.finish({ reason: 'eof', partialBytes: this.chunkBytes });
    }
  }

  private releaseDrained(): void {
    if (!this.stopped && (this.queue.length > 0 || this.pumping)) return;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const release of waiters) release();
  }

  private async serve(item: Extract<InboundItem, { kind: 'request' }>): Promise<void> {
    const handler = this.handlers.get(item.method);
    if (!handler) {
      this.reply({ jsonrpc: '2.0', id: item.id, error: { code: 'method_not_found', message: `Method not found: ${item.method}` } });
      return;
    }
    try {
      const result = await handler(item.params, { id: item.id, method: item.method });
      if (this.stopped) return;
      this.reply({ jsonrpc: '2.0', id: item.id, result: result ?? null });
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof JsonRpcReplyError) {
        this.reply({ jsonrpc: '2.0', id: item.id, error: { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) } });
        return;
      }
      this.diagnostic(`server request handler for ${item.method} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      this.reply({ jsonrpc: '2.0', id: item.id, error: { code: 'internal_error', message: 'The client could not handle the request' } });
    }
  }

  private reply(frame: JsonObject): void {
    try {
      this.write(frame);
    } catch (error) {
      if (!(error instanceof JsonRpcFatalError) && !(error instanceof JsonRpcClosedError)) this.fail(new JsonRpcFatalError('write_failed', 'could not write a reply', {}));
    }
  }

  private write(frame: JsonObject): void {
    if (this.output.writableEnded || this.output.destroyed) throw new JsonRpcClosedError('JSON-RPC output stream is closed');
    const line = `${JSON.stringify(frame)}\n`;
    if (this.output.writableLength + Buffer.byteLength(line) > this.maxOutboundBytes) {
      const error = new JsonRpcFatalError('outbound_limit_exceeded', `outbound queue exceeded ${this.maxOutboundBytes} bytes`, { limit: this.maxOutboundBytes });
      this.fail(error);
      throw error;
    }
    this.output.write(line, (error) => {
      if (error) this.fail(new JsonRpcFatalError('write_failed', `write failed: ${error.message}`, { stream: 'output' }));
    });
  }

  private fail(error: JsonRpcFatalError): void {
    if (this.fatalError || this.finished) return;
    this.fatalError = error;
    this.stopped = true;
    this.queue.length = 0;
    this.chunks = [];
    this.rejectAll(error);
    this.detach();
    this.releaseDrained();
    try {
      this.options.onFatal?.(error);
    } catch (callbackError) {
      this.diagnostic(`fatal callback failed: ${callbackError instanceof Error ? callbackError.message : 'unknown error'}`);
    }
    this.finish({ reason: 'fatal', partialBytes: 0, error });
  }

  private finish(info: JsonRpcEndInfo): void {
    if (this.finished) return;
    this.finished = true;
    try {
      this.options.onEnd?.(info);
    } catch (callbackError) {
      this.diagnostic(`end callback failed: ${callbackError instanceof Error ? callbackError.message : 'unknown error'}`);
    }
    this.resolveDone(info);
  }

  private rejectAll(error: Error): void {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      this.pending.delete(id);
      request.reject(error);
    }
  }

  private rememberTimedOut(id: number): void {
    this.timedOut.add(id);
    if (this.timedOut.size > TIMED_OUT_MEMORY) {
      const oldest = this.timedOut.values().next().value;
      if (oldest !== undefined) this.timedOut.delete(oldest);
    }
  }

  private detach(): void {
    this.input.off('data', this.onData);
    this.input.off('end', this.onEnd);
    this.input.off('close', this.onEnd);
  }

  private diagnostic(message: string): void {
    try {
      this.options.onDiagnostic?.(message);
    } catch {
      return;
    }
  }
}
