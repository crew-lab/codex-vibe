import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nodeVersionAtLeast } from '../dist/runtime/node-version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const checks = [];
function record(name, ok, detail) { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); }
record('private-package', packageJson.private === true && packageJson.license === 'MIT', packageJson.private === true ? 'Package remains unpublished/private while the source is MIT licensed.' : 'Package must remain npm-private and MIT licensed.');
const nodeEngine = packageJson.engines?.node;
const minimumNode = typeof nodeEngine === 'string' ? /^>=(\d+\.\d+(?:\.\d+)?)$/.exec(nodeEngine)?.[1] : undefined;
record('node-engine', Boolean(minimumNode && nodeVersionAtLeast(process.versions.node, minimumNode)), `Node ${process.versions.node}; package engine ${nodeEngine ?? 'missing or invalid'}`);
const launcherAsset = path.join(root, 'dist', 'backends', 'runtime', 'vibe_supervisor_launcher.py');
try { await access(launcherAsset); record('runtime-shim', true, 'Pinned Python launcher exists in the compiled package tree.'); }
catch { record('runtime-shim', false, 'Run npm run build to copy the launcher runtime asset.'); }
const removedArtifacts = [
  'dist/backends/acp.js',
  'dist/backends/worker-deadline.js',
  'dist/core/policy-engine.js',
];
const staleArtifacts = [];
for (const relative of removedArtifacts) {
  try { await access(path.join(root, relative)); staleArtifacts.push(relative); }
  catch { /* absent as expected */ }
}
record('reduced-build-artifacts', staleArtifacts.length === 0, staleArtifacts.length ? `Stale removed artifacts remain: ${staleArtifacts.join(', ')}` : 'Removed ACP, policy-engine, and dynamic-deadline outputs are absent.');
try {
  const packageRoot = JSON.parse(await readFile(path.join(root, 'dist', 'cli.js'), 'utf8').then(() => JSON.stringify({ ok: true })));
  record('cli-build', packageRoot.ok === true, 'Compiled CLI entrypoint exists.');
} catch { record('cli-build', false, 'Compiled CLI entrypoint is missing.'); }
const version = spawnSync(process.execPath, [path.join(root, 'dist', 'cli.js'), '--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
record('cli-version', version.status === 0 && version.stdout.trim() === packageJson.version, version.status === 0 ? version.stdout.trim() : (version.stderr || 'CLI failed').trim());
const expectedTools = ['vibe_review_start', 'vibe_edit_start', 'vibe_status', 'vibe_result', 'vibe_close'];
const smokeRoot = await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-acceptance-mcp-'));
const smokeHome = path.join(smokeRoot, 'home');
const smokeData = path.join(smokeHome, 'VibeSupervisor-oneshot');
await Promise.all([mkdir(smokeHome, { recursive: true, mode: 0o700 }), mkdir(smokeData, { recursive: true, mode: 0o700 })]);
const smokeConfig = path.join(smokeData, 'config.toml');
await writeFile(smokeConfig, 'version = 1\nallowed_workspace_roots = []\n', { mode: 0o600 });
const smokeEnv = { ...process.env, HOME: smokeHome, USERPROFILE: smokeHome };
const { Client } = await import('@modelcontextprotocol/client');
const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist', 'cli.js'), 'serve', '--stdio', '--config', smokeConfig], env: smokeEnv, stderr: 'pipe' });
const client = new Client({ name: 'vibe-supervisor-acceptance', version: packageJson.version });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const actualTools = listed.tools.map((tool) => tool.name).sort();
  const expectedSorted = [...expectedTools].sort();
  record('mcp-five-tool-catalog', JSON.stringify(actualTools) === JSON.stringify(expectedSorted), actualTools.join(', '));
  record('mcp-server-version', client.getServerVersion()?.version === packageJson.version, client.getServerVersion()?.version ?? 'server version unavailable');
} catch (error) {
  record('mcp-five-tool-catalog', false, error instanceof Error ? error.message : String(error));
  record('mcp-server-version', false, 'MCP initialize did not complete.');
} finally {
  await client.close().catch(() => undefined);
  await rm(smokeRoot, { recursive: true, force: true });
}
const unexpectedFixture = path.join(root, 'dist', 'backends', 'runtime', 'test_vibe_supervisor_launcher.py');
try { await access(unexpectedFixture); record('test-fixture-excluded', false, 'Test fixture was incorrectly copied into dist.'); }
catch { record('test-fixture-excluded', true, 'Test-only shim fixture is absent from dist.'); }
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  deterministic_checks: checks,
  unverified_release_gates: [
    { name: 'hosted-vibe-auth', status: 'UNVERIFIED', reason: 'No hosted model request was made.' },
    { name: 'hosted-one-shot-review-and-edit', status: 'UNVERIFIED', reason: 'No hosted review or edit was run against this candidate.' },
    { name: 'native-codex-five-tool-lifecycle', status: 'UNVERIFIED', reason: 'Native desktop discovery, useful work, close and active-run disconnect were not exercised.' },
    { name: 'macos-apple-silicon-install', status: 'UNVERIFIED', reason: 'A clean macOS Apple silicon account install was not exercised.' },
  ],
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (checks.some((check) => check.status === 'FAIL')) process.exitCode = 1;
