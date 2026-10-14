import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JsonRpcClient,
  JsonRpcClosedError,
  JsonRpcFatalError,
  JsonRpcReplyError,
  JsonRpcServerError,
  JsonRpcTimeoutError,
  type JsonRpcClientOptions,
  type JsonRpcEndInfo
} from '../../src/backends/app-server/jsonrpc.js';

type Json = Record<string, unknown>;

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await sleep(5);
  }
}

interface Harness {
  client: JsonRpcClient;
  server: PassThrough;
  sent: Json[];
  notifications: Array<{ method: string; params: Json }>;
  diagnostics: string[];
  fatals: JsonRpcFatalError[];
  ends: JsonRpcEndInfo[];
  frame(value: Json): void;
  raw(text: string | Buffer): void;
}

const harnesses: Harness[] = [];

function harness(options: Partial<JsonRpcClientOptions> = {}): Harness {
  const server = new PassThrough();
  const wire = new PassThrough();
  const sent: Json[] = [];
  let buffered = '';
  wire.setEncoding('utf8');
  wire.on('data', (chunk: string) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) return;
      sent.push(JSON.parse(buffered.slice(0, newline)) as Json);
      buffered = buffered.slice(newline + 1);
    }
  });
  const notifications: Harness['notifications'] = [];
  const diagnostics: string[] = [];
  const fatals: JsonRpcFatalError[] = [];
  const ends: JsonRpcEndInfo[] = [];
  const client = new JsonRpcClient({
    input: server,
    output: wire,
    onNotification: (method, params) => { notifications.push({ method, params }); },
    onDiagnostic: (message) => { diagnostics.push(message); },
    onFatal: (error) => { fatals.push(error); },
    onEnd: (info) => { ends.push(info); },
    ...options
  });
  const created: Harness = {
    client,
    server,
    sent,
    notifications,
    diagnostics,
    fatals,
    ends,
    frame: (value) => { server.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`); },
    raw: (text) => { server.write(text); }
  };
  harnesses.push(created);
  return created;
}

afterEach(() => {
  for (const item of harnesses.splice(0)) item.client.dispose();
});

describe('JSON-RPC client requests', () => {
  it('writes compact newline-delimited frames with ids and always-present params', async () => {
    const h = harness();
    const first = h.client.request('runtime/read', { sessionId: 's1' });
    const second = h.client.request('turn/start');
    h.client.notify('initialized');
    await until(() => h.sent.length === 3);
    expect(h.sent[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'runtime/read', params: { sessionId: 's1' } });
    expect(h.sent[1]).toEqual({ jsonrpc: '2.0', id: 2, method: 'turn/start', params: {} });
    expect(h.sent[2]).toEqual({ jsonrpc: '2.0', method: 'initialized', params: {} });
    h.frame({ id: 2, result: { two: true } });
    h.frame({ id: 1, result: { one: true } });
    expect(await first).toEqual({ one: true });
    expect(await second).toEqual({ two: true });
    expect(h.client.stats.pendingRequests).toBe(0);
  });

  it('rejects an error response with the string code, message and data', async () => {
    const h = harness();
    const pending = h.client.request('session/start', {});
    h.frame({ id: 1, error: { code: 'unauthorized', message: 'Missing API key', data: { provider: 'mistral' } } });
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JsonRpcServerError);
    expect(error).toMatchObject({ code: 'unauthorized', message: 'Missing API key', data: { provider: 'mistral' }, method: 'session/start' });
  });

  it('keeps numeric server error codes as strings and tolerates a missing message', async () => {
    const h = harness();
    const pending = h.client.request('x');
    h.frame({ id: 1, error: { code: -32601 } });
    expect(await pending.catch((caught: unknown) => caught)).toMatchObject({ code: '-32601', message: '' });
  });

  it('times out a request, then ignores its late response once', async () => {
    const h = harness();
    const pending = h.client.request('slow', {}, { timeoutMs: 20 });
    await expect(pending).rejects.toBeInstanceOf(JsonRpcTimeoutError);
    expect(h.client.stats.pendingRequests).toBe(0);
    h.frame({ id: 1, result: {} });
    await until(() => h.diagnostics.length === 1);
    expect(h.diagnostics[0]).toContain('late response');
    expect(h.fatals).toEqual([]);
    h.frame({ id: 1, result: {} });
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]?.code).toBe('unexpected_response');
  });

  it('uses the configured default timeout', async () => {
    const h = harness({ defaultTimeoutMs: 15 });
    await expect(h.client.request('slow')).rejects.toMatchObject({ method: 'slow', timeoutMs: 15 });
  });

  it('treats a response to an id it never issued as fatal', async () => {
    const h = harness();
    h.frame({ id: 99, result: {} });
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]).toMatchObject({ code: 'unexpected_response', kind: 'protocol' });
  });

  it('treats an error response with a null id as fatal without echoing long messages', async () => {
    const h = harness();
    h.frame({ id: null, error: { code: 'invalid_request', message: 'x'.repeat(2000) } });
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]?.code).toBe('unexpected_response');
    expect(String(h.fatals[0]?.details.message)).toHaveLength(500);
  });

  it('rejects argument misuse before anything is written', async () => {
    const h = harness();
    await expect(h.client.request('')).rejects.toBeInstanceOf(TypeError);
    await expect(h.client.request('x', [] as unknown as Json)).rejects.toBeInstanceOf(TypeError);
    await expect(h.client.request('x', {}, { timeoutMs: 0 })).rejects.toBeInstanceOf(RangeError);
    expect(() => h.client.notify('x', null as unknown as Json)).toThrow(TypeError);
    await tick();
    expect(h.sent).toEqual([]);
  });

  it('rejects invalid bounds in the constructor', () => {
    const server = new PassThrough();
    expect(() => new JsonRpcClient({ input: server, output: new PassThrough(), maxLineBytes: 0 })).toThrow(RangeError);
    expect(() => new JsonRpcClient({ input: server, output: new PassThrough(), maxPendingRequests: 1.5 })).toThrow(RangeError);
  });
});

describe('JSON-RPC client bounds', () => {
  it('fails fatally when more requests are pending than allowed and rejects every pending one', async () => {
    const h = harness({ maxPendingRequests: 2 });
    const first = h.client.request('a');
    const second = h.client.request('b');
    const third = h.client.request('c');
    const error = await third.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JsonRpcFatalError);
    expect(error).toMatchObject({ code: 'pending_limit_exceeded', kind: 'output_limit' });
    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);
    expect(h.fatals).toHaveLength(1);
    await expect(h.client.request('d')).rejects.toBe(error);
  });

  it('fails fatally on an over-long line even before its newline arrives', async () => {
    const h = harness({ maxLineBytes: 64 });
    h.raw('{"jsonrpc":"2.0","method":"warning","params":{"message":"');
    await tick();
    expect(h.fatals).toEqual([]);
    h.raw('x'.repeat(80));
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]).toMatchObject({ code: 'line_too_long', kind: 'output_limit' });
  });

  it('accepts a line of exactly the maximum size', async () => {
    const frame = `${JSON.stringify({ jsonrpc: '2.0', method: 'note', params: { pad: '' } })}`;
    const padding = 'y'.repeat(200 - Buffer.byteLength(frame));
    const line = JSON.stringify({ jsonrpc: '2.0', method: 'note', params: { pad: padding } });
    expect(Buffer.byteLength(line)).toBe(200);
    const h = harness({ maxLineBytes: 200 });
    h.raw(`${line}\n`);
    await until(() => h.notifications.length === 1);
    expect(h.fatals).toEqual([]);
  });

  it('fails fatally when the total inbound budget is exhausted', async () => {
    const h = harness({ maxInboundBytes: 300 });
    for (let index = 0; index < 20; index += 1) h.frame({ method: 'note', params: { index } });
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]).toMatchObject({ code: 'inbound_budget_exceeded', kind: 'output_limit' });
  });

  it('fails fatally when queued inbound messages exceed the limit and stops delivering', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const delivered: number[] = [];
    const h = harness({
      maxQueuedNotifications: 3,
      onNotification: async (_method, params) => { await gate; delivered.push(params.index as number); }
    });
    for (let index = 0; index < 6; index += 1) h.frame({ method: 'note', params: { index } });
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]).toMatchObject({ code: 'notification_limit_exceeded', kind: 'output_limit' });
    release();
    await tick();
    expect(delivered.length).toBeLessThanOrEqual(1);
  });

  it('fails fatally when the outbound queue is over its limit', async () => {
    const wire = new PassThrough({ highWaterMark: 16 });
    const h = harness({ output: wire, maxOutboundBytes: 128 });
    const attempts = Array.from({ length: 8 }, () => h.client.request('big', { text: 'z'.repeat(60) }).catch((caught: unknown) => caught));
    const results = await Promise.all(attempts);
    expect(results.some((result) => result instanceof JsonRpcFatalError && result.code === 'outbound_limit_exceeded')).toBe(true);
    expect(h.fatals[0]?.code).toBe('outbound_limit_exceeded');
  });
});

describe('JSON-RPC client framing', () => {
  it('reassembles frames split across chunks, including multi-byte characters', async () => {
    const h = harness();
    const line = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method: 'note', params: { text: 'héllo wörld ✓' } })}\n`);
    const cut = line.indexOf(Buffer.from('é')) + 1;
    h.raw(line.subarray(0, cut));
    await tick();
    h.raw(line.subarray(cut, line.length - 3));
    await tick();
    h.raw(line.subarray(line.length - 3));
    await until(() => h.notifications.length === 1);
    expect(h.notifications[0]?.params.text).toBe('héllo wörld ✓');
  });

  it('delivers several frames from one chunk in order and skips blank lines', async () => {
    const h = harness();
    const lines = [1, 2, 3].map((index) => JSON.stringify({ jsonrpc: '2.0', method: 'note', params: { index } }));
    h.raw(`${lines[0]}\n\n${lines[1]}\n${lines[2]}\n`);
    await until(() => h.notifications.length === 3);
    expect(h.notifications.map((item) => item.params.index)).toEqual([1, 2, 3]);
    expect(h.client.stats.framesReceived).toBe(3);
  });

  it('defaults absent notification params to an empty object', async () => {
    const h = harness();
    h.raw(`${JSON.stringify({ jsonrpc: '2.0', method: 'note' })}\n`);
    await until(() => h.notifications.length === 1);
    expect(h.notifications[0]).toEqual({ method: 'note', params: {} });
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['a JSON scalar', '42'],
    ['a batch array', '[{"jsonrpc":"2.0","method":"x","params":{}}]'],
    ['a missing version', '{"method":"x","params":{}}'],
    ['a wrong version', '{"jsonrpc":"1.0","method":"x","params":{}}'],
    ['array params', '{"jsonrpc":"2.0","method":"x","params":[]}'],
    ['a frame with no method or result', '{"jsonrpc":"2.0","id":1}'],
    ['a response with both result and error', '{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":"a","message":"b"}}'],
    ['a boolean request id', '{"jsonrpc":"2.0","id":true,"method":"x","params":{}}']
  ])('treats %s as a fatal malformed frame', async (_name, line) => {
    const h = harness();
    const pending = h.client.request('a');
    h.raw(`${line}\n`);
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]).toMatchObject({ code: 'malformed_frame', kind: 'protocol' });
    await expect(pending).rejects.toBeInstanceOf(JsonRpcFatalError);
    expect((await h.client.done).reason).toBe('fatal');
  });

  it('treats invalid UTF-8 as a fatal malformed frame', async () => {
    const h = harness();
    h.raw(Buffer.concat([Buffer.from('{"jsonrpc":"2.0","method":"x","params":{"t":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}}\n')]));
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]?.code).toBe('malformed_frame');
  });

  it('does not leak the offending line into the fatal error', async () => {
    const h = harness();
    h.raw('{"secret":"sk-live-should-not-appear"\n');
    await until(() => h.fatals.length === 1);
    expect(JSON.stringify([h.fatals[0]?.message, h.fatals[0]?.details])).not.toContain('sk-live');
    expect(h.diagnostics.join('')).not.toContain('sk-live');
  });

  it('stops processing after a fatal error', async () => {
    const h = harness();
    h.raw(`{bad\n${JSON.stringify({ jsonrpc: '2.0', method: 'note', params: {} })}\n`);
    await until(() => h.fatals.length === 1);
    await tick();
    expect(h.notifications).toEqual([]);
    expect(h.fatals).toHaveLength(1);
  });

  it('reports activity once per complete frame', async () => {
    const onActivity = vi.fn();
    const h = harness({ onActivity });
    h.frame({ method: 'note', params: {} });
    h.frame({ method: 'note', params: {} });
    await until(() => h.notifications.length === 2);
    expect(onActivity).toHaveBeenCalledTimes(2);
  });
});

describe('JSON-RPC client notifications', () => {
  it('delivers notifications serially in arrival order even with an async handler', async () => {
    const order: string[] = [];
    const h = harness({
      onNotification: async (_method, params) => {
        order.push(`start-${params.index as number}`);
        await sleep(params.index === 1 ? 20 : 1);
        order.push(`end-${params.index as number}`);
      }
    });
    for (const index of [1, 2, 3]) h.frame({ method: 'note', params: { index } });
    await until(() => order.length === 6);
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });

  it('holds notifications until a handler is registered', async () => {
    const h = harness();
    h.client.setNotificationHandler(undefined);
    h.frame({ method: 'note', params: { index: 1 } });
    await tick();
    expect(h.client.stats.queuedInbound).toBe(1);
    const seen: string[] = [];
    h.client.setNotificationHandler((method) => { seen.push(method); });
    await until(() => seen.length === 1);
    expect(h.client.stats.queuedInbound).toBe(0);
  });

  it('treats a throwing notification handler as fatal', async () => {
    const h = harness({ onNotification: () => { throw new Error('boom'); } });
    const pending = h.client.request('a');
    h.frame({ method: 'note', params: {} });
    await until(() => h.fatals.length === 1);
    expect(h.fatals[0]).toMatchObject({ code: 'handler_failed', kind: 'internal' });
    await expect(pending).rejects.toBeInstanceOf(JsonRpcFatalError);
  });

  it('resolves responses without waiting behind a slow notification handler', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ onNotification: async () => { await gate; } });
    const pending = h.client.request('a');
    h.frame({ method: 'note', params: {} });
    h.frame({ id: 1, result: { ok: true } });
    expect(await pending).toEqual({ ok: true });
    release();
  });
});

describe('JSON-RPC client server requests', () => {
  it('answers a registered handler with the server integer id echoed', async () => {
    const h = harness();
    const received: Json[] = [];
    h.client.setRequestHandler('callback/call', (params, context) => {
      received.push({ params, context });
      return { callbackId: params.callbackId, accepted: true };
    });
    h.frame({ id: 17, method: 'callback/call', params: { callbackId: 'cb-1' } });
    await until(() => h.sent.length === 1);
    expect(h.sent[0]).toEqual({ jsonrpc: '2.0', id: 17, result: { callbackId: 'cb-1', accepted: true } });
    expect(received[0]?.context).toEqual({ id: 17, method: 'callback/call' });
  });

  it('echoes a string id and answers undefined with null', async () => {
    const h = harness();
    h.client.setRequestHandler('ping', () => undefined);
    h.frame({ id: 'abc', method: 'ping', params: {} });
    await until(() => h.sent.length === 1);
    expect(h.sent[0]).toEqual({ jsonrpc: '2.0', id: 'abc', result: null });
  });

  it('answers an unregistered server request with a method_not_found error', async () => {
    const h = harness();
    h.frame({ id: 5, method: 'clientTool/call', params: {} });
    await until(() => h.sent.length === 1);
    expect(h.sent[0]).toMatchObject({ jsonrpc: '2.0', id: 5, error: { code: 'method_not_found' } });
    expect(h.fatals).toEqual([]);
  });

  it('answers a throwing handler with internal_error and a diagnostic, without the message', async () => {
    const h = harness();
    h.client.setRequestHandler('callback/call', () => { throw new Error('internal secret detail'); });
    h.frame({ id: 6, method: 'callback/call', params: {} });
    await until(() => h.sent.length === 1);
    expect(h.sent[0]).toMatchObject({ id: 6, error: { code: 'internal_error' } });
    expect(JSON.stringify(h.sent[0])).not.toContain('secret');
    expect(h.diagnostics.some((message) => message.includes('callback/call'))).toBe(true);
    expect(h.fatals).toEqual([]);
  });

  it('lets a handler choose the error reply code', async () => {
    const h = harness();
    h.client.setRequestHandler('callback/call', () => { throw new JsonRpcReplyError('invalid_params', 'bad', { issues: [] }); });
    h.frame({ id: 7, method: 'callback/call', params: {} });
    await until(() => h.sent.length === 1);
    expect(h.sent[0]).toEqual({ jsonrpc: '2.0', id: 7, error: { code: 'invalid_params', message: 'bad', data: { issues: [] } } });
  });

  it('runs a server request after the notifications that preceded it', async () => {
    const order: string[] = [];
    const h = harness({ onNotification: async (method) => { await sleep(10); order.push(method); } });
    h.client.setRequestHandler('callback/call', () => { order.push('request'); return {}; });
    h.frame({ method: 'history/entryAdded', params: {} });
    h.frame({ id: 1, method: 'callback/call', params: {} });
    await until(() => h.sent.length === 1);
    expect(order).toEqual(['history/entryAdded', 'request']);
  });

  it('can send a request from inside a server-request handler', async () => {
    const h = harness();
    h.client.setRequestHandler('callback/call', (params) => {
      void h.client.request('callback/result', { callbackId: params.callbackId }).catch(() => undefined);
      return { accepted: true };
    });
    h.frame({ id: 41, method: 'callback/call', params: { callbackId: 'cb-1' } });
    await until(() => h.sent.length === 2);
    expect(h.sent.find((frame) => frame.id === 41)).toMatchObject({ result: { accepted: true } });
    expect(h.sent.find((frame) => frame.method === 'callback/result')).toMatchObject({ params: { callbackId: 'cb-1' } });
  });
});

describe('JSON-RPC client shutdown', () => {
  it('rejects pending requests at end of input, drains queued notifications, then reports eof', async () => {
    const h = harness();
    const pending = h.client.request('a');
    h.frame({ method: 'turn/completed', params: {} });
    h.server.end();
    await expect(pending).rejects.toBeInstanceOf(JsonRpcClosedError);
    const info = await h.client.done;
    expect(info).toMatchObject({ reason: 'eof', partialBytes: 0 });
    expect(h.notifications.map((item) => item.method)).toEqual(['turn/completed']);
    expect(h.ends).toHaveLength(1);
    await expect(h.client.request('b')).rejects.toBeInstanceOf(JsonRpcClosedError);
  });

  it('reports the bytes of a truncated final line at end of input', async () => {
    const h = harness();
    h.raw('{"jsonrpc":"2.0","method":"history/entryAdded","params":{"eventId":');
    h.server.end();
    const info = await h.client.done;
    expect(info.reason).toBe('eof');
    expect(info.partialBytes).toBeGreaterThan(10);
    expect(h.fatals).toEqual([]);
  });

  it('drops a server request still queued behind a slow notification when the input ends', async () => {
    const h = harness({ onNotification: async () => { await sleep(30); } });
    h.client.setRequestHandler('callback/call', () => ({ accepted: true }));
    h.frame({ method: 'history/entryAdded', params: {} });
    h.frame({ id: 1, method: 'callback/call', params: {} });
    await tick();
    h.server.end();
    await h.client.done;
    expect(h.sent).toEqual([]);
    expect(h.diagnostics.some((message) => message.includes('callback/call'))).toBe(true);
  });

  it('closes the output stream on closeInput and refuses further requests', async () => {
    const wire = new PassThrough();
    const h = harness({ output: wire });
    const finished = new Promise<void>((resolve) => wire.once('finish', () => resolve()));
    await h.client.closeInput();
    await finished;
    expect(wire.writableEnded).toBe(true);
    await expect(h.client.request('a')).rejects.toBeInstanceOf(JsonRpcClosedError);
    expect(() => h.client.notify('a')).toThrow(JsonRpcClosedError);
    await h.client.closeInput();
  });

  it('still resolves in-flight responses after closeInput', async () => {
    const h = harness();
    const pending = h.client.request('session/stop');
    await tick();
    await h.client.closeInput();
    h.frame({ id: 1, result: { closed: true } });
    expect(await pending).toEqual({ closed: true });
  });

  it('survives an output stream error without throwing', async () => {
    const wire = new PassThrough();
    const h = harness({ output: wire });
    const pending = h.client.request('a');
    wire.destroy(new Error('EPIPE'));
    await expect(pending).rejects.toMatchObject({ code: 'write_failed', kind: 'io' });
    expect(h.fatals[0]?.code).toBe('write_failed');
  });

  it('dispose rejects pending requests and ignores later input', async () => {
    const h = harness();
    const pending = h.client.request('a');
    h.client.dispose();
    await expect(pending).rejects.toBeInstanceOf(JsonRpcClosedError);
    h.frame({ method: 'note', params: {} });
    await tick();
    expect(h.notifications).toEqual([]);
    expect((await h.client.done).reason).toBe('disposed');
  });
});

describe('JSON-RPC client stdout discipline', () => {
  it('never writes to the supervisor stdout or stderr', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const h = harness({ maxLineBytes: 128 });
      h.client.setRequestHandler('boom', () => { throw new Error('x'); });
      h.frame({ id: 1, method: 'boom', params: {} });
      h.frame({ id: 2, method: 'unknown', params: {} });
      await until(() => h.sent.length === 2);
      h.raw('{bad\n');
      await until(() => h.fatals.length === 1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      log.mockRestore();
    }
  });
});
