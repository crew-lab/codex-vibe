import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Transport, JSONRPCMessage } from '@modelcontextprotocol/server';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { runCli } from '../../src/cli.js';
import { APP_VERSION } from '../../src/version.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { createSupervisorMcpServer } from '../../src/mcp/server.js';
import type { RunManagerTools } from '../../src/mcp/tools.js';

async function manifestVersion(file: string): Promise<string> {
  return (JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8')) as { version: string }).version;
}

class Harness implements Transport {
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
  }
  async send(message: JSONRPCMessage): Promise<void> { this.input.write(`${JSON.stringify(message)}\n`); }
  async close(): Promise<void> { this.input.end(); this.output.end(); this.onclose?.(); }
}

afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });

describe('single version source', () => {
  it('reads the version from package.json', async () => {
    expect(APP_VERSION).toBe(await manifestVersion('../../package.json'));
  });

  it('prints it for --version and -v', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; }) as typeof process.stdout.write);
    await runCli(['--version']); await runCli(['-v']);
    const expected = `${await manifestVersion('../../package.json')}\n`;
    expect(lines).toEqual([expected, expected]);
  });

  it('reports it as the MCP server version', async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const server = createSupervisorMcpServer({} as unknown as RunManagerTools, { config: DEFAULT_CONFIG });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: 'version-test', version: '1.0.0' });
    await client.connect(new Harness(input, output));
    try { expect(client.getServerVersion()?.version).toBe(await manifestVersion('../../package.json')); }
    finally { await client.close(); }
  });

  it('keeps the plugin manifest literal equal to package.json', async () => {
    expect(await manifestVersion('../../.codex-plugin/plugin.json')).toBe(await manifestVersion('../../package.json'));
  });
});
