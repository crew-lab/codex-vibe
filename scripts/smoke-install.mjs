import { mkdtemp, mkdir, realpath, rm, access, readFile, writeFile, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = process.env.VIBE_SUPERVISOR_TEST_NPM_CACHE;
if (!cache || !path.isAbsolute(cache)) throw new Error('Set VIBE_SUPERVISOR_TEST_NPM_CACHE to an absolute path of a populated offline npm cache.');
try { await access(path.join(cache, '_cacache')); }
catch { throw new Error('Offline smoke test needs a populated npm cache. Set VIBE_SUPERVISOR_TEST_NPM_CACHE to an existing cache; no network fallback is used.'); }
const tmpRoot = await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-package-smoke-'));
const env = { ...process.env, HOME: path.join(tmpRoot, 'home'), USERPROFILE: path.join(tmpRoot, 'home'), VIBE_SUPERVISOR_HOME: path.join(tmpRoot, 'home', 'VibeSupervisor-oneshot'), npm_config_cache: cache };
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
  return result.stdout;
}
try {
  const home = path.join(tmpRoot, 'home'); const prefix = path.join(tmpRoot, 'prefix'); const packDir = path.join(tmpRoot, 'pack');
  await Promise.all([mkdir(home, { recursive: true, mode: 0o700 }), mkdir(prefix, { recursive: true, mode: 0o700 }), mkdir(packDir, { recursive: true, mode: 0o700 })]);
  const packed = run('npm', ['--cache', cache, 'pack', '--ignore-scripts', '--pack-destination', packDir], { cwd: root });
  const tarball = path.join(packDir, packed.trim().split(/\r?\n/).at(-1) ?? '');
  await access(tarball);
  run('npm', ['--cache', cache, 'install', '--ignore-scripts', '--offline', '--prefix', prefix, tarball], { cwd: prefix });
  const installedRoot = path.join(prefix, 'node_modules', 'vibe-supervisor');
  const cli = path.join(installedRoot, 'dist', 'cli.js');
  const executable = path.join(prefix, 'node_modules', '.bin', 'vibe-supervisor');
  const manifest = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
  const version = run(executable, ['--version']).trim();
  if (version !== manifest.version) throw new Error('Installed CLI version check failed.');
  if (!run(executable, ['--help']).includes('serve --stdio')) throw new Error('Installed CLI help check failed.');

  run(executable, ['allow', packDir]);
  const expectedTools = 5;
  const expectedToolNames = ['vibe_review_start', 'vibe_edit_start', 'vibe_status', 'vibe_result', 'vibe_close'];
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const transport = new StdioClientTransport({ command: executable, args: ['serve', '--stdio'], env, stderr: 'pipe' });
  const client = new Client({ name: 'vibe-supervisor-release-smoke', version: manifest.version });
  try {
    await client.connect(transport);
    if (client.getServerVersion()?.version !== manifest.version) throw new Error("MCP server version mismatch.");
    const listed = await client.listTools();
    if (listed.tools.length !== expectedTools) throw new Error(`Expected exactly ${expectedTools} MCP tools; received ${listed.tools.length}.`);
    if (JSON.stringify(listed.tools.map(tool => tool.name).sort()) !== JSON.stringify([...expectedToolNames].sort())) throw new Error(`Installed MCP tool catalog differs from the one-shot contract: ${listed.tools.map(tool => tool.name).join(', ')}.`);
    if (listed.tools.some((tool) => tool.name === 'vibe_cancel')) throw new Error('vibe_cancel must not be registered.');
    const status = await client.callTool({ name: 'vibe_status', arguments: { run_id: '00000000-0000-4000-8000-000000000001' } });
    if (!status.isError) throw new Error('Expected status on an unknown run to return a normalized error.');
    const isolated = [0, 1].map(index => {
      const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'serve', '--stdio', '--isolated'], env, stderr: 'pipe' });
      return { transport, client: new Client({ name: `isolated-smoke-${index}`, version: manifest.version }) };
    });
    try {
      await Promise.all(isolated.map(async ({ client, transport }) => {
        await client.connect(transport);
        const isolatedTools = (await client.listTools()).tools.map(tool => tool.name).sort();
        if (JSON.stringify(isolatedTools) !== JSON.stringify([...expectedToolNames].sort())) throw new Error('Isolated tool inventory mismatch.');
        const response = await client.callTool({ name: 'vibe_status', arguments: { run_id: '00000000-0000-4000-8000-000000000001' } });
        if (!response.isError || !JSON.stringify(response).includes('VSUP_NOT_FOUND')) throw new Error('Isolated backend did not respond.');
      }));
    } finally { await Promise.all(isolated.map(({ client }) => client.close())); }


    // Reconnect can adopt a different free session. UUID routing must still find
    // the original record through the actual installed CLI, without inference.
    const sessions = path.join(env.VIBE_SUPERVISOR_HOME, 'mcp-sessions');
    const savedHome = path.join(sessions, 'session-saved1');
    const newerHome = path.join(sessions, 'session-newer1');
    const savedId = '00000000-0000-4000-8000-000000000002';
    const savedRun = path.join(savedHome, 'runs', savedId);
    await mkdir(savedRun, { recursive: true, mode: 0o700 });
    await mkdir(newerHome, { mode: 0o700 });
    const now = new Date().toISOString();
    const savedMeta = {
      schema_version: 1, supervisor_version: manifest.version, run_id: savedId,
      backend: 'app-server', mode: 'review', state: 'completed',
      source_workspace: packDir, worker_workspace: packDir,
      created_at: now, updated_at: now, task_sha256: 'a'.repeat(64),
      limits: { timeout_seconds: 120, max_turns: 6, max_event_bytes: 1048576,
        max_transcript_bytes: 1048576, max_artifact_bytes: 8388608 }
    };
    await writeFile(path.join(savedRun, 'meta.json'), JSON.stringify(savedMeta), { mode: 0o600 });
    await utimes(newerHome, new Date('2030-01-01'), new Date('2030-01-01'));
    const reconnect = new Client({ name: 'saved-run-reconnect-smoke', version: manifest.version });
    const reconnectTransport = new StdioClientTransport({ command: executable,
      args: ['serve', '--stdio', '--isolated'], env, stderr: 'pipe' });
    try {
      await reconnect.connect(reconnectTransport);
      for (const name of ['vibe_status', 'vibe_result', 'vibe_close', 'vibe_status']) {
        const response = await reconnect.callTool({ name, arguments: { run_id: savedId } });
        if (response.isError) throw new Error(`Saved-run reconnect ${name} failed: ${JSON.stringify(response)}`);
        const body = JSON.parse(response.content.find(item => item.type === 'text').text);
        if (body.run_id !== savedId) throw new Error('Reconnect returned a different run.');
        if (name === 'vibe_status' && !['completed', 'closed'].includes(body.state)) throw new Error('Reconnect replayed or failed a completed run.');
      }
      const after = JSON.parse(await readFile(path.join(savedRun, 'meta.json'), 'utf8'));
      if (after.state !== 'closed') throw new Error('Reconnect close was not persisted in the original session.');
      if (after.process) throw new Error('Reconnect unexpectedly launched a worker.');
    } finally { await reconnect.close(); }

  } finally {
    await client.close();
  }
  process.stdout.write(JSON.stringify({ status: 'PASS', package: manifest.name, version: manifest.version, isolatedHome: true, installedCliExecutable: 'PASS', installedMcpInitializeAndListTools: 'PASS', eofShutdown: 'PASS', concurrentIsolatedMcp: 'PASS', savedRunReconnectMcp: 'PASS' }) + '\n');
} finally { await rm(tmpRoot, { recursive: true, force: true }); }
