import { mkdtemp, mkdir, realpath, rm, access, readFile } from 'node:fs/promises';
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
const env = { ...process.env, HOME: path.join(tmpRoot, 'home'), USERPROFILE: path.join(tmpRoot, 'home'), VIBE_SUPERVISOR_HOME: path.join(tmpRoot, 'home', 'VibeSupervisor'), npm_config_cache: cache };
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
  const manifest = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
  const version = run(process.execPath, [cli, '--version']).trim();
  if (version !== manifest.version) throw new Error('Installed CLI version check failed.');
  await access(path.join(installedRoot, 'dist', 'backends', 'runtime', 'vibe_supervisor_launcher.py'));
  if (!run(process.execPath, [cli, '--help']).includes('serve --stdio')) throw new Error('Installed CLI help check failed.');

  // Exercise the installed stdio process and official client without starting a backend run.
  run(process.execPath, [cli, 'init']);
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'serve', '--stdio'], env, stderr: 'pipe' });
  const client = new Client({ name: 'vibe-supervisor-release-smoke', version: manifest.version });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    if (listed.tools.length !== 8) throw new Error(`Expected eight MCP tools; received ${listed.tools.length}.`);
    const status = await client.callTool({ name: 'vibe_status', arguments: { run_id: '00000000-0000-4000-8000-000000000001' } });
    if (!status.isError) throw new Error('Expected status on an unknown run to return a normalized error.');
  } finally {
    await client.close();
  }
  process.stdout.write(JSON.stringify({ status: 'PASS', package: manifest.name, version: manifest.version, isolatedHome: true, runtimeShim: 'present', installedMcpInitializeAndListTools: 'PASS', eofShutdown: 'PASS' }) + '\n');
} finally { await rm(tmpRoot, { recursive: true, force: true }); }
