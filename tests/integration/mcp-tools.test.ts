import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Transport, JSONRPCMessage } from '@modelcontextprotocol/server';
import { PassThrough } from 'node:stream';
import { TEST_CONFIG } from '../unit/support/test-config.js';
import { createSupervisorMcpServer } from '../../src/mcp/server.js';
import { createIsolatedRunRouter } from '../../src/core/isolated-run-router.js';
import type { RunManagerTools } from '../../src/mcp/tools.js';
import { parseInputJson } from '../../src/reporting/private-files.js';
import { z } from 'zod';

function errorText(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]!.text;
}

function structured(result: unknown): unknown {
  return JSON.parse((result as { content: { text: string }[] }).content[0]!.text);
}

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
  const startIds = { authorization_id: '123e4567-e89b-42d3-a456-426614174000', attempt_id: '123e4567-e89b-42d3-a456-426614174001' };
  it('serves five strict tools and routes valid calls through the manager', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const manager = {
      reviewStart: vi.fn(async (args) => ({ run_id: '123e4567-e89b-42d3-a456-426614174000', state: 'running', received_task: args.task })),
      editStart: vi.fn(async () => ({ run_id: 'edit-id', state: 'running' })),
      status: vi.fn(async () => ({ state: 'running', events: [] })),
      result: vi.fn(async () => ({ run_id: '123e4567-e89b-42d3-a456-426614174000', artifacts: [{ name: 'diff.patch', path: '/private/runs/diff.patch', sha256: 'abc' }], summary: 'complete', reasoning_content: 'should never cross the MCP boundary' })),
      close: vi.fn(async () => ({ closed: true })),
    } satisfies RunManagerTools;
    const server = createSupervisorMcpServer(manager, { config: { ...TEST_CONFIG, limits: { ...TEST_CONFIG.limits, maxMcpResultChars: 500 } } });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '0.0.1' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'vibe_close', 'vibe_edit_start', 'vibe_result', 'vibe_review_start', 'vibe_status',
    ]);
    expect(tools.find((tool) => tool.name === 'vibe_status')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'vibe_result')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'vibe_edit_start')?.annotations?.destructiveHint).toBe(true);

    const result = await client.callTool({ name: 'vibe_review_start', arguments: { ...startIds, task: 'review', cwd: '/tmp' } });
    expect(result.isError).toBeUndefined();
    expect(structured(result)).toMatchObject({ state: 'running', received_task: 'review' });
    expect(manager.reviewStart).toHaveBeenCalledOnce();
    const got = await client.callTool({ name: 'vibe_result', arguments: { run_id: '123e4567-e89b-42d3-a456-426614174000', detail: 'full' } });
    expect(structured(got)).toMatchObject({ run_id: '123e4567-e89b-42d3-a456-426614174000' });
    expect(JSON.stringify(structured(got))).not.toContain('should never cross');
  });

  it('returns stable errors and rejects unknown arguments', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const manager = {
      reviewStart: vi.fn(async () => { throw Object.assign(new Error('run missing'), { code: 'VSUP_NOT_FOUND' }); }),
      editStart: vi.fn(async () => ({})), status: vi.fn(async () => ({})), result: vi.fn(async () => ({})), close: vi.fn(async () => ({})),
    } satisfies RunManagerTools;
    const server = createSupervisorMcpServer(manager, { config: { ...TEST_CONFIG, limits: { ...TEST_CONFIG.limits } } });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '0.0.1' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const error = await client.callTool({ name: 'vibe_review_start', arguments: { ...startIds, task: 'review', cwd: '/tmp' } });
    expect(error.isError).toBe(true);
    expect(JSON.parse(errorText(error))).toEqual({ error: { code: 'VSUP_NOT_FOUND', message: 'run missing', remediation: expect.stringMatching(/.+/), retryable: false } });
    const malformed = await client.callTool({ name: 'vibe_review_start', arguments: { ...startIds, task: 'review', cwd: '/tmp', extra: true } });
    expect(malformed.isError).toBe(true);
    expect(JSON.stringify(malformed)).toContain('Unrecognized key');
  });

  it('carries code, message, remediation, retryable and details in the JSON error reply', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const manager = {
      reviewStart: vi.fn(async () => { throw Object.assign(new Error('root gone'), { code: 'VSUP_WORKSPACE_INVALID', retryable: true, details: { unavailable_root: '/gone', note: 'api_key=sk-abcdef1234567890xyz' } }); }),
      editStart: vi.fn(async () => ({})), status: vi.fn(async () => ({})), result: vi.fn(async () => ({})), close: vi.fn(async () => ({})),
    } satisfies RunManagerTools;
    const server = createSupervisorMcpServer(manager, { config: { ...TEST_CONFIG, limits: { ...TEST_CONFIG.limits } } });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '0.0.1' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const failed = await client.callTool({ name: 'vibe_review_start', arguments: { ...startIds, task: 'review', cwd: '/tmp' } });
    expect(failed.isError).toBe(true);
    expect((failed.content as unknown[]).length).toBe(1);
    expect(JSON.parse(errorText(failed))).toEqual({ error: {
      code: 'VSUP_WORKSPACE_INVALID', message: 'root gone', remediation: expect.stringContaining('allowed_workspace_roots'), retryable: true,
      details: { unavailable_root: '/gone', note: expect.stringContaining('api_key=') },
    } });
    expect((JSON.parse(errorText(failed)) as { error: { details: { note: string } } }).error.details.note).not.toContain('sk-abcdef');
  });

  it('preserves safe selected input errors across MCP', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const manager = {
      reviewStart: vi.fn(async () => parseInputJson(Buffer.from('{ sensitive-marker'), 'request', z.object({}))),
      editStart: vi.fn(async () => ({})), status: vi.fn(async () => ({})), result: vi.fn(async () => ({})), close: vi.fn(async () => ({})),
    } satisfies RunManagerTools;
    const server = createSupervisorMcpServer(manager, { config: { ...TEST_CONFIG, limits: { ...TEST_CONFIG.limits } } });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '0.0.1' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const result = await client.callTool({ name: 'vibe_review_start', arguments: { ...startIds, task: 'review', cwd: '/tmp' } });
    expect(JSON.parse(errorText(result))).toMatchObject({ error: { code: 'VSUP_INVALID_ARGUMENT', details: { role: 'request', reason: 'invalid_json' } } });
    expect(errorText(result)).not.toContain('sensitive-marker');
  });

  it('returns VSUP_INTERNAL for an unexpected error and writes its redacted cause to the error log', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const manager = {
      reviewStart: vi.fn(async () => ({})), editStart: vi.fn(async () => ({})),
      status: vi.fn(async () => { throw Object.assign(new Error('disk exploded while writing api_key=sk-abcdef1234567890xyz'), { code: 'EBADF' }); }),
      result: vi.fn(async () => ({})), close: vi.fn(async () => ({})),
    } satisfies RunManagerTools;
    const logged: string[] = [];
    const server = createSupervisorMcpServer(manager, { config: { ...TEST_CONFIG, limits: { ...TEST_CONFIG.limits } }, onError: (message) => logged.push(message) });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '0.0.1' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const failed = await client.callTool({ name: 'vibe_status', arguments: { run_id: '123e4567-e89b-42d3-a456-426614174000' } });
    expect(failed.isError).toBe(true);
    expect(JSON.parse(errorText(failed))).toMatchObject({ error: { code: 'VSUP_INTERNAL', message: 'The request could not be completed.' } });
    expect(JSON.stringify(failed)).not.toContain('disk exploded');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('VSUP_INTERNAL');
    expect(logged[0]).toContain('EBADF: disk exploded while writing api_key=[REDACTED]');
    expect(logged[0]).not.toContain('sk-abcdef');
  });

  it('keeps storage error details on the wire without file content', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const storage = Object.assign(new Error('The supervisor could not write to its data directory (ENOSPC).'), { code: 'VSUP_STORAGE_ERROR', details: { code: 'ENOSPC', directory: '/data/runs/abc' } });
    const manager = {
      reviewStart: vi.fn(async () => { throw storage; }), editStart: vi.fn(async () => ({})), status: vi.fn(async () => ({})),
      result: vi.fn(async () => ({})), close: vi.fn(async () => ({})),
    } satisfies RunManagerTools;
    const server = createSupervisorMcpServer(manager, { config: { ...TEST_CONFIG, limits: { ...TEST_CONFIG.limits } } });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '0.0.1' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const failed = await client.callTool({ name: 'vibe_review_start', arguments: { ...startIds, task: 'review', cwd: '/tmp' } });
    expect(errorText(failed)).toContain('VSUP_STORAGE_ERROR');
  });

  async function listTools(config = { ...TEST_CONFIG }) {
    const input = new PassThrough(); const output = new PassThrough();
    const manager = {
      reviewStart: vi.fn(async () => ({})), editStart: vi.fn(async () => ({})), status: vi.fn(async () => ({})),
      result: vi.fn(async () => ({})), close: vi.fn(async () => ({})),
    } satisfies RunManagerTools;
    const server = createSupervisorMcpServer(manager, { config });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-test-client', version: '0.0.1' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    return { client, tools: (await client.listTools()).tools };
  }

  it('always registers exactly the supported five tools', async () => {
    const base = ['vibe_close', 'vibe_edit_start', 'vibe_result', 'vibe_review_start', 'vibe_status'];
    const { tools } = await listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(base);
  });

  it('registers exactly five tools when served through isolated router', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const manager: RunManagerTools & { initialize(): Promise<void>; shutdown(): Promise<{ timedOut: boolean }> } = {
      reviewStart: vi.fn(async () => ({})), editStart: vi.fn(async () => ({})), status: vi.fn(async () => ({})),
      result: vi.fn(async () => ({})), close: vi.fn(async () => ({})),
      initialize: vi.fn(async () => {}), shutdown: vi.fn(async () => ({ timedOut: false })),
    };
    const config = TEST_CONFIG;
    const router = createIsolatedRunRouter(manager, { sessions: '/tmp', currentHome: '/tmp', config });
    const server = createSupervisorMcpServer(router, { config });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'mcp-isolated-test-client', version: '0.0.1' }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual(['vibe_close', 'vibe_edit_start', 'vibe_result', 'vibe_review_start', 'vibe_status']);
  });

  it('rejects the removed inputs and never exposes vibe_cancel', async () => {
    const { client, tools } = await listTools();
    expect(tools.map((tool) => tool.name)).not.toContain('vibe_cancel');
    for (const extra of [{ allow_shell: false }, { backend: 'acp' }]) {
      const rejected = await client.callTool({ name: 'vibe_edit_start', arguments: { ...startIds, task: 'edit', cwd: '/tmp', ...extra } });
      expect(rejected.isError).toBe(true);
    }
    const summary = await client.callTool({ name: 'vibe_result', arguments: { run_id: '123e4567-e89b-42d3-a456-426614174000', detail: 'summary' } });
    expect(summary.isError).toBe(true);
  });

  it('carries the essentials in the tool descriptions', async () => {
    const { tools } = await listTools();
    const descriptionOf = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    for (const name of ['vibe_review_start', 'vibe_edit_start', 'vibe_status']) expect(descriptionOf(name)).toMatch(/120.{1,4}300/);
    for (const name of ['vibe_review_start', 'vibe_edit_start', 'vibe_status', 'vibe_result']) {
      expect(descriptionOf(name)).toContain('stop_reason');
      expect(descriptionOf(name)).toContain('warnings');
    }
    expect(descriptionOf('vibe_edit_start')).toMatch(/never applied/i);
    expect(descriptionOf('vibe_status')).toContain('next_after_seq');
    expect(descriptionOf('vibe_close')).toMatch(/cancel/i);
    expect(descriptionOf('vibe_close')).toMatch(/when done/i);
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeLessThan(700);
  });
});
