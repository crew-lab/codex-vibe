import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { StartRunInput } from '../../src/contracts.js';

describe('installed-format stdio search service', () => {
  it('serves exactly two read-only tools and exits after its owning connection closes', async () => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-search-mcp-')));
    const root = path.join(directory, 'workspace'); const home = path.join(directory, 'home');
    await Promise.all([mkdir(root), mkdir(home)]);
    await writeFile(path.join(root, 'source.txt'), 'answer marker\n');
    await writeFile(path.join(root, '.env'), 'private marker\n');
    const { createAppServerProfile } = await import('../../dist/backends/app-server/session-config.js');
    const input: StartRunInput = {
      runId: '00000000-0000-4000-8000-000000000001', mode: 'review', task: 'fixture',
      cwd: root, workerWorkspace: root, runDirectory: home,
      limits: { timeoutSeconds: 30, maxTurns: 1, maxEventBytes: 4096, maxTranscriptBytes: 4096, maxArtifactBytes: 4096 },
    };
    const profile = await createAppServerProfile(input, Date.now() + 30_000);
    const transport = new StdioClientTransport({
      command: profile.mcpServer.command as string,
      args: profile.mcpServer.args as string[],
      // This explicit sentinel models an unsafe inheriting MCP implementation;
      // the owned launcher must remove it before the search process starts.
      env: { HOME: home, PATH: '/usr/bin:/bin', MISTRAL_API_KEY: 'fixture-must-not-reach-search' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'supervisor-search-fixture', version: '1' });
    let pid: number | undefined;
    try {
      await client.connect(transport); pid = transport.pid;
      const tools = (await client.listTools()).tools;
      expect(tools.map(tool => tool.name).sort()).toEqual(['grep', 'list_files']);
      expect(tools.every(tool => tool.annotations?.readOnlyHint && tool.annotations.openWorldHint === false)).toBe(true);
      const result = await client.callTool({ name: 'grep', arguments: { pattern: 'marker' } });
      expect(result.isError).not.toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
      expect(JSON.parse(text).matches).toEqual([{ line: 1, column: 8, text: 'answer marker', path: 'source.txt' }]);
      expect(text).not.toContain('private marker');
      const denied = await client.callTool({ name: 'grep', arguments: { pattern: 'marker', path: '.env' } });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain('VSUP_WORKSPACE_INVALID');
      expect(JSON.stringify(denied)).not.toContain(root);
    } finally {
      await client.close();
      if (pid !== undefined) await vi.waitFor(() => expect(() => process.kill(pid as number, 0)).toThrow(), { timeout: 5000 });
      await rm(directory, { recursive: true, force: true });
    }
  });
});
