import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { realpath, lstat } from 'node:fs/promises';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_VERSION } from '../../version.js';
import { WorkspaceSearch, grepSchema, listFilesSchema } from './search.js';
import { resolveCanonicalWorkspaceRoot } from '../../security/paths.js';

export function createSearchServer(search: WorkspaceSearch): McpServer {
  const server = new McpServer({ name: 'supervisor_search', version: APP_VERSION }, { capabilities: { tools: {} } });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  const failure = (error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^VSUP_[A-Z_]+$/.test(error.code) ? error.code : 'VSUP_INVALID_ARGUMENT';
    return { isError: true, ...result({ error: { code, message: 'Search request refused or incomplete; use a narrower safe scope and inspect the code.' } }) };
  };
  server.registerTool('list_files', {
    description: 'List workspace text-source paths with a bounded, run-specific cursor. Check complete, reason and next_cursor; a partial list is not the whole scope.',
    inputSchema: listFilesSchema, annotations,
  }, async input => {
    try { return result(await search.listFiles(input)); } catch (error) { return failure(error); }
  });
  server.registerTool('grep', {
    description: 'Search approved local files using a line-oriented JavaScript regular expression. No shell or network. Results include path, line, column and bounded text excerpts. Check complete and reason; narrow the path when incomplete.',
    inputSchema: grepSchema, annotations,
  }, async input => {
    try { return result(await search.grep(input)); } catch (error) { return failure(error); }
  });
  return server;
}

async function main(): Promise<void> {
  const root = process.env.VIBE_SUPERVISOR_SEARCH_ROOT;
  const runId = process.env.VIBE_SUPERVISOR_SEARCH_RUN_ID;
  const deadline = Number(process.env.VIBE_SUPERVISOR_SEARCH_DEADLINE);
  const registry = process.env.VIBE_SUPERVISOR_SEARCH_REGISTRY;
  const nonce = process.env.VIBE_SUPERVISOR_SEARCH_NONCE;
  if (!root || !runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId) || !Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 48 * 3600_000) throw new Error('Invalid search service launch policy');
  if (process.env.MISTRAL_API_KEY !== undefined) throw new Error('Provider credentials must not reach the search service');
  if (!registry || !nonce || !/^[0-9a-f-]{36}$/i.test(nonce)) throw new Error('Missing search ownership policy');
  const registryInfo = await lstat(registry);
  if (!registryInfo.isDirectory() || registryInfo.isSymbolicLink() || await realpath(registry) !== registry || (registryInfo.mode & 0o077) !== 0) throw new Error('Unsafe search registry');
  const canonical = await resolveCanonicalWorkspaceRoot(root);
  if (canonical !== root || await realpath(root) !== root) throw new Error('Search root is not canonical');
  const parentPid = process.ppid;
  const marker = path.join(registry, `${process.pid}.json`);
  writeFileSync(marker, JSON.stringify({ pid: process.pid, parentPid, runId, nonce, startedAt: Date.now() - process.uptime() * 1000 }), { flag: 'wx', mode: 0o600 });
  process.once('exit', () => { try { unlinkSync(marker); } catch { /* Owner verifies stale records read-only. */ } });
  const handle = serveStdio(() => createSearchServer(new WorkspaceSearch(root, runId)), {
    maxSubscriptions: 0,
    onerror: () => process.stderr.write('Supervisor search transport failed.\n'),
  });
  const monitor = setInterval(() => {
    if (process.ppid !== parentPid || Date.now() >= deadline) process.exit(1);
  }, 250);
  const stop = () => { clearInterval(monitor); void handle.close().finally(() => process.exit(0)); };
  process.stdin.once('end', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('Supervisor search launch refused.\n'); process.exitCode = 1; });
}
