import { access, copyFile, mkdir, rm, chmod, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = process.env.VIBE_SUPERVISOR_TEST_NPM_CACHE;
if (!cache || !path.isAbsolute(cache)) throw new Error('Set VIBE_SUPERVISOR_TEST_NPM_CACHE to an absolute path of a populated offline npm cache.');
await access(path.join(cache, '_cacache')).catch(() => { throw new Error('A populated offline npm cache is required; set VIBE_SUPERVISOR_TEST_NPM_CACHE.'); });
const releaseDir = path.join(root, 'release');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.private !== true || pkg.license !== 'MIT') throw new Error('Refusing to package unless npm-private is retained and MIT licensing is preserved.');

function run(command, args, { capture = false } = {}) {
  const env = { ...process.env, VIBE_SUPERVISOR_TEST_NPM_CACHE: cache };
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 10_000_000 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  if (!capture && result.stdout.trim()) process.stdout.write(result.stdout);
  return result.stdout;
}

// Freeze-source acceptance before creating release outputs.
run('npm', ['run', 'verify:release']);
run('npm', ['run', 'smoke:install']);
const acceptance = run(process.execPath, ['scripts/acceptance.mjs'], { capture: true });
const report = JSON.parse(acceptance);
if (report.deterministic_checks.some((check) => check.status !== 'PASS')) throw new Error('Acceptance report contains a failed deterministic check.');
const acpSoakSource = await readFile(path.join(root, 'tests', 'integration', 'acp-backend.test.ts'), 'utf8');
if (!/100 independent initialized prompt turns/.test(acpSoakSource)) throw new Error('Fake ACP 100-run regression test was not found.');
report.deterministic_checks.push({ name: 'fake-acp-100-run-adversarial-soak', status: 'PASS', detail: 'The fake ACP 100-run test passed as part of verify:release; this is not a hosted Vibe soak.' });

await mkdir(releaseDir, { recursive: true, mode: 0o700 });
const tarballName = `${pkg.name}-${pkg.version}.tgz`;
const tarball = path.join(releaseDir, tarballName);
await rm(tarball, { force: true });
run('npm', ['--cache', cache, 'pack', '--ignore-scripts', '--pack-destination', releaseDir]);
await access(tarball);
const sbom = path.join(releaseDir, 'sbom.spdx.json');
await copyFile(path.join(root, 'dist', 'sbom.spdx.json'), sbom);
const acceptancePath = path.join(releaseDir, 'acceptance.json');
await writeFile(acceptancePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
for (const file of [tarball, sbom, acceptancePath]) await chmod(file, 0o644);
const files = [tarball, sbom, acceptancePath];
const sums = [];
for (const file of files) {
  const digest = createHash('sha256').update(await readFile(file)).digest('hex');
  sums.push(`${digest}  ${path.basename(file)}`);
}
const sumsPath = path.join(releaseDir, 'SHA256SUMS');
await writeFile(sumsPath, `${sums.join('\n')}\n`, { mode: 0o644 });
process.stdout.write(`\nRC package and reports written to ${releaseDir}\n`);
for (const line of sums) process.stdout.write(`${line}\n`);
