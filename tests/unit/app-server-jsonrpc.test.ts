import { PassThrough } from 'node:stream';
import { describe, it, expect, vi } from 'vitest';
import { JsonRpcClient, type JsonRpcOptions } from '../../src/backends/app-server/jsonrpc.js';

function fixture(overrides: Partial<JsonRpcOptions> = {}) {
  const input = new PassThrough(); const output = new PassThrough();
  const frames: Record<string, unknown>[] = [];
  output.on('data', data => frames.push(JSON.parse(data.toString())));
  const failure = vi.fn(); const notification = vi.fn();
  const client = new JsonRpcClient(input, output, {
    maxBytes: 4096, remainingMs: () => 1000, onNotification: notification,
    onRequest: async () => ({ accepted: true }), onFailure: failure, ...overrides,
  });
  const send = (value: unknown) => input.write(JSON.stringify(value) + '\n');
  return { input, output, frames, failure, notification, client, send };
}

describe('app-server JSON-RPC transport', () => {
  it('correlates out-of-order replies and accepts split UTF-8 frames', async () => {
    const f = fixture();
    const a = f.client.request('first', {}); const b = f.client.request('second', {});
    const bytes = Buffer.from('{"jsonrpc":"2.0","id":2,"result":{"text":"é"}}\n');
    const split = bytes.indexOf(0xc3) + 1;
    f.input.write(bytes.subarray(0, split)); f.input.write(bytes.subarray(split));
    f.send({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    await expect(b).resolves.toEqual({ text: 'é' }); await expect(a).resolves.toEqual({ ok: true });
    expect(f.failure).not.toHaveBeenCalled(); f.client.close();
  });

  it('answers callbacks without blocking their nested RPC response', async () => {
    const f = fixture({ onRequest: async () => { await f.client.request('callback/result', {}); return { accepted: true }; } });
    f.send({ jsonrpc: '2.0', id: 17, method: 'callback/call', params: {} });
    await vi.waitFor(() => expect(f.frames[0]?.method).toBe('callback/result'));
    f.send({ jsonrpc: '2.0', id: f.frames[0]?.id, result: { accepted: true } });
    await vi.waitFor(() => expect(f.frames[1]).toEqual({ jsonrpc: '2.0', id: 17, result: { accepted: true } }));
    expect(f.failure).not.toHaveBeenCalled(); f.client.close();
  });

  it('fails closed on replayed callback ids', async () => {
    const f = fixture();
    f.send({ jsonrpc: '2.0', id: 1, method: 'callback/call', params: {} });
    await vi.waitFor(() => expect(f.frames).toHaveLength(1));
    f.send({ jsonrpc: '2.0', id: 1, method: 'callback/call', params: {} });
    expect(f.failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'VSUP_BACKEND_ERROR' }));
  });

  it.each(['{bad}\n', '{"jsonrpc":"2.0","id":500,"result":{}}\n', '{"jsonrpc":"2.0","method":"event"}\n'])('rejects malformed or unmatched frames without exposing them', data => {
    const f = fixture(); f.input.write(data);
    expect(f.failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'VSUP_BACKEND_ERROR' }));
    expect(JSON.stringify(f.failure.mock.calls)).not.toContain(data.trim());
  });

  it('rejects invalid UTF-8', () => {
    const f = fixture(); f.input.write(Buffer.from([0xc3, 0x28, 10]));
    expect(f.failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'VSUP_BACKEND_ERROR' }));
  });

  it('bounds frames even without a newline', () => {
    const f = fixture({ maxBytes: 1024 }); f.input.write(Buffer.alloc(1025));
    expect(f.failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'VSUP_OUTPUT_LIMIT' }));
  });

  it('classifies provider authorization without saving its error data', async () => {
    const f = fixture(); const pending = f.client.request('session/start', {});
    f.send({ jsonrpc: '2.0', id: 1, error: { code: 'unauthorized', message: 'secret-token', data: { key: 'secret-token' } } });
    await expect(pending).rejects.toMatchObject({ code: 'VSUP_AUTH_REQUIRED', details: { protocol_code: 'unauthorized' } });
    f.client.close();
  });

  it('bounds concurrent outstanding requests and rejects pending work on close', async () => {
    const f = fixture(); const pending = Array.from({ length: 32 }, () => f.client.request('pending', {}).catch(e => e));
    await expect(f.client.request('overflow', {})).rejects.toMatchObject({ code: 'VSUP_OUTPUT_LIMIT' });
    f.client.close(); expect(await Promise.all(pending)).toHaveLength(32);
  });

  it('expires the whole transport when a request times out', async () => {
    const f = fixture(); await expect(f.client.request('stalled', {}, 5)).rejects.toMatchObject({ code: 'VSUP_TIMEOUT' });
    expect(f.failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'VSUP_TIMEOUT' }));
    f.client.close();
    expect(f.output.writableEnded).toBe(true);
  });
  it('writes the callback acknowledgement before sending its separate result request', async () => {
    const f = fixture({
      onRequest: async () => ({ callbackId: 'callback', accepted: true }),
      afterResponse: async () => { await f.client.request('callback/result', { sessionId: 'session', result: { callbackId: 'callback', output: { type: 'approval', decision: { type: 'deny' } } } }); },
    });
    f.send({ jsonrpc: '2.0', id: 91, method: 'callback/call', params: {} });
    await vi.waitFor(() => expect(f.frames).toHaveLength(2));
    expect(f.frames[0]).toEqual({ jsonrpc: '2.0', id: 91, result: { callbackId: 'callback', accepted: true } });
    expect(f.frames[1]?.method).toBe('callback/result');
    f.send({ jsonrpc: '2.0', id: f.frames[1]?.id, result: { accepted: true } });
    f.client.close();
  });
});
