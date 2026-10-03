import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Transport, JSONRPCMessage } from '@modelcontextprotocol/server';
import { PassThrough } from 'node:stream';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { createSupervisorMcpServer } from '../../src/mcp/server.js';
import type { RunManagerTools } from '../../src/mcp/tools.js';

class StdioClientHarness implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private buffer = '';
  constructor(private readonly input: PassThrough, private readonly output: PassThrough) {}
  async start(): Promise<void> {
    this.output.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        if (line) this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
      }
    });
    this.output.on('error', (error) => this.onerror?.(error));
  }
  async send(message: JSONRPCMessage): Promise<void> { this.input.write(`${JSON.stringify(message)}\n`); }
  async close(): Promise<void> { this.input.end(); this.output.end(); this.onclose?.(); }
}

const clients: Client[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close().catch(() => {}))); });

describe('MCP stdio tool surface', () => {
  it('serves eight strict tools and routes valid calls through the manager', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const manager = {
      reviewStart: vi.fn(async (args) => ({ run_id: '123e4567-e89b-42d3-a456-426614174000', state: 'queued', received_task: args.task })),
      editStart: vi.fn(async () => ({ run_id: 'edit-id', state: 'queued' })),
      status: vi.fn(async () => ({ state: 'running', events: [] })),
      continue: vi.fn(async () => ({ accepted: true })),
      respond: vi.fn(async () => ({ accepted: true })),
      result: vi.fn(async () => ({ run_id: '123e4567-e89b-42d3-a456-426614174000', artifacts: [{ name: 'diff.patch', path: '/private/runs/diff.patch', sha256: 'abc' }], summary: 'complete', reasoning_content: 'should never cross the MCP boundary' })),
      cancel: vi.fn(async () => ({ cancelled: true })),
      close: vi.fn(async () => ({ closed: true })),
    } satisfies RunManagerTools;
    const server = createSupervisorMcpServer(manager, { config: { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits, maxMcpResultChars: 500 } } });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '1.0.0' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(8);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'vibe_cancel', 'vibe_close', 'vibe_continue', 'vibe_edit_start', 'vibe_respond', 'vibe_result', 'vibe_review_start', 'vibe_status',
    ]);
    expect(tools.find((tool) => tool.name === 'vibe_status')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'vibe_result')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'vibe_edit_start')?.annotations?.destructiveHint).toBe(true);

    const result = await client.callTool({ name: 'vibe_review_start', arguments: { task: 'review', cwd: '/tmp' } });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ state: 'queued', received_task: 'review' });
    expect(manager.reviewStart).toHaveBeenCalledOnce();
    const got = await client.callTool({ name: 'vibe_result', arguments: { run_id: '123e4567-e89b-42d3-a456-426614174000', detail: 'full' } });
    expect(got.structuredContent).toMatchObject({ run_id: '123e4567-e89b-42d3-a456-426614174000' });
    expect(JSON.stringify(got.structuredContent)).not.toContain('should never cross');
  });

  it('returns stable errors and rejects unknown arguments', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const manager = {
      reviewStart: vi.fn(async () => { throw Object.assign(new Error('run missing'), { code: 'VSUP_NOT_FOUND' }); }),
      editStart: vi.fn(async () => ({})), status: vi.fn(async () => ({})), continue: vi.fn(async () => ({})),
      respond: vi.fn(async () => ({})), result: vi.fn(async () => ({})), cancel: vi.fn(async () => ({})), close: vi.fn(async () => ({})),
    } satisfies RunManagerTools;
    const server = createSupervisorMcpServer(manager, { config: DEFAULT_CONFIG });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '1.0.0' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const error = await client.callTool({ name: 'vibe_review_start', arguments: { task: 'review', cwd: '/tmp' } });
    expect(error.isError).toBe(true);
    expect(error.structuredContent).toMatchObject({ error: { code: 'VSUP_NOT_FOUND', remediation: expect.any(String) } });
    const malformed = await client.callTool({ name: 'vibe_review_start', arguments: { task: 'review', cwd: '/tmp', extra: true } });
    expect(malformed.isError).toBe(true);
    expect(JSON.stringify(malformed)).toContain('Unrecognized key');
  });
});
