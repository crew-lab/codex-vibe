import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const checks = [];
function record(name, ok, detail) { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); }
record('private-package', packageJson.private === true && packageJson.license === 'MIT', packageJson.private === true ? 'Package remains unpublished/private while the source is MIT licensed.' : 'Package must remain npm-private and MIT licensed.');
record('node-engine', Number(process.versions.node.split('.')[0]) >= 20, `Node ${process.versions.node}`);
const launcherAsset = path.join(root, 'dist', 'backends', 'runtime', 'vibe_supervisor_launcher.py');
try { await access(launcherAsset); record('runtime-shim', true, 'Pinned Python launcher exists in the compiled package tree.'); }
catch { record('runtime-shim', false, 'Run npm run build to copy the launcher runtime asset.'); }
try {
  const packageRoot = JSON.parse(await readFile(path.join(root, 'dist', 'cli.js'), 'utf8').then(() => JSON.stringify({ ok: true })));
  record('cli-build', packageRoot.ok === true, 'Compiled CLI entrypoint exists.');
} catch { record('cli-build', false, 'Compiled CLI entrypoint is missing.'); }
const version = spawnSync(process.execPath, [path.join(root, 'dist', 'cli.js'), '--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
record('cli-version', version.status === 0 && version.stdout.trim() === packageJson.version, version.status === 0 ? version.stdout.trim() : (version.stderr || 'CLI failed').trim());
const unexpectedFixture = path.join(root, 'dist', 'backends', 'runtime', 'test_vibe_supervisor_launcher.py');
try { await access(unexpectedFixture); record('test-fixture-excluded', false, 'Test fixture was incorrectly copied into dist.'); }
catch { record('test-fixture-excluded', true, 'Test-only shim fixture is absent from dist.'); }
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  deterministic_checks: checks,
  unverified_release_gates: [
    { name: 'hosted-vibe-auth', status: 'UNVERIFIED', reason: 'No hosted model request was made.' },
    { name: 'codex-desktop-registration', status: 'UNVERIFIED', reason: 'No user Codex config was changed during packaging.' },
    { name: 'macos-intel', status: 'UNVERIFIED', reason: 'Only this host architecture can be tested here.' },
    { name: 'clean-account-install', status: 'UNVERIFIED', reason: 'A fresh OS account is not available in this workspace.' },
    { name: 'real-vibe-hosted-acp-soak', status: 'UNVERIFIED', reason: 'Fake-peer lifecycle coverage passed; a 100-run soak against hosted Vibe has not been performed.' },
  ],
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (checks.some((check) => check.status === 'FAIL')) process.exitCode = 1;
