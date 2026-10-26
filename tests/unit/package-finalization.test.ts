import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { candidateIdentity } from '../../src/preparation/evidence.js';

const exec = promisify(execFile);
const { finalizePackage, reportAfterValidation, validateKitForTest } = await import('../../scripts/finalize-package.mjs');
const script = Buffer.from('export const conformance = true;\n');
const procedure = Buffer.from('# Preparation procedure\n');
const version = '2.0.1';

async function fixture(parent: string, retainSbom: boolean, missingDependency = false) {
  const root = path.join(parent, 'candidate');
  await Promise.all(['dist', 'schemas', 'scripts'].map((directory) => mkdir(path.join(root, directory), { recursive: true })));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'vibe-supervisor', version, private: true, files: ['dist', 'schemas', 'scripts/v2-conformance-check.mjs'],
    ...(missingDependency ? { dependencies: { 'is-number': '7.0.0' } } : {}),
    scripts: { prepare: 'node prepare.mjs' }
  }, null, 2));
  await writeFile(path.join(root, 'dist', 'cli.js'), 'candidate-cli-v1');
  await writeFile(path.join(root, 'schemas', 'config.json'), '{}');
  await writeFile(path.join(root, 'scripts', 'v2-conformance-check.mjs'), script);
  await writeFile(path.join(root, 'prepare.mjs'), `import { rm, writeFile } from 'node:fs/promises';
await writeFile(new URL('./dist/cli.js', import.meta.url), 'rebuilt-cli');
${retainSbom ? "process.stdout.write('prepare retained the SBOM\\n');" : "await rm(new URL('./dist/sbom.spdx.json', import.meta.url), { force: true });"}
`);
  await writeFile(path.join(root, 'dist', 'sbom.spdx.json'), 'initial-sbom');
  const cache = path.join(parent, 'npm-cache');
  await mkdir(path.join(cache, '_cacache'), { recursive: true, mode: 0o700 });
  return { root, cache };
}

async function pack(root: string, releaseDir: string, cache: string) {
  await mkdir(releaseDir, { recursive: true, mode: 0o700 });
  await exec('npm', ['--cache', cache, '--offline', 'pack', '--pack-destination', releaseDir], {
    cwd: root, env: { ...process.env, npm_config_cache: cache, npm_config_offline: 'true' }, maxBuffer: 2_000_000
  });
  return path.join(releaseDir, 'vibe-supervisor-2.0.1.tgz');
}

async function packedFixture(retainSbom: boolean) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'vibe-package-finalize-test-'));
  const { root, cache } = await fixture(tmp, retainSbom);
  const releaseDir = path.join(tmp, 'release');
  const tarball = await pack(root, releaseDir, cache);
  await access(tarball);
  const packedSbom = path.join(root, 'dist', 'sbom.spdx.json');
  expect(await readFile(path.join(root, 'dist', 'cli.js'), 'utf8')).toBe('rebuilt-cli');
  if (retainSbom) expect(await readFile(packedSbom, 'utf8')).toBe('initial-sbom');
  else await expect(access(packedSbom)).rejects.toThrow();
  const candidateSha256 = await candidateIdentity(root);
  await writeFile(packedSbom, 'externally-regenerated-sbom');
  return { tmp, root, cache, releaseDir, tarball, candidateSha256 };
}

it.each([false, true])('matches the actual npm pack artifact when SBOM is externally regenerated afterward (SBOM retained by prepare=%s)', async (retainSbom) => {
  const packed = await packedFixture(retainSbom);
  const finalized = await finalizePackage({ releaseDir: packed.releaseDir, tarball: packed.tarball, version,
    candidateSha256: packed.candidateSha256, scriptBytes: script, procedureBytes: procedure, cache: packed.cache, candidateIdentity });
  const manifest = JSON.parse(await readFile(path.join(finalized.kit, 'manifest.json'), 'utf8'));
  expect(manifest.candidate_sha256).toBe(packed.candidateSha256);
  expect(finalized.kitFiles.map((file) => path.basename(file)).sort()).toEqual(['PROCEDURE.md', 'SHA256SUMS', 'manifest.json', 'v2-conformance-check.mjs'].sort());
  await rm(packed.tmp, { recursive: true, force: true });
}, 120_000);

it('rejects a repacked archive with changed package content and tampered or unsafe kit checksums', async () => {
  const packed = await packedFixture(true);
  await writeFile(path.join(packed.root, 'dist', 'cli.js'), 'modified-after-first-pack');
  const modifiedTarball = await pack(packed.root, path.join(packed.tmp, 'modified-release'), packed.cache);
  await expect(finalizePackage({ releaseDir: path.join(packed.tmp, 'modified-kit'), tarball: modifiedTarball, version,
    candidateSha256: packed.candidateSha256, scriptBytes: script, procedureBytes: procedure, cache: packed.cache, candidateIdentity })).rejects.toThrow(/identity differs/);

  const valid = await packedFixture(true);
  const finalized = await finalizePackage({ releaseDir: valid.releaseDir, tarball: valid.tarball, version,
    candidateSha256: valid.candidateSha256, scriptBytes: script, procedureBytes: procedure, cache: valid.cache, candidateIdentity });
  const manifest = JSON.parse(await readFile(path.join(finalized.kit, 'manifest.json'), 'utf8'));
  await writeFile(path.join(finalized.kit, 'PROCEDURE.md'), 'tampered');
  await expect(validateKitForTest(finalized.kit, manifest)).rejects.toThrow(/checksum mismatch/);
  const sumsPath = path.join(finalized.kit, 'SHA256SUMS');
  const originalSums = await readFile(sumsPath, 'utf8');
  await writeFile(sumsPath, `${'a'.repeat(64)}  ../escape\n`);
  await expect(validateKitForTest(finalized.kit, manifest)).rejects.toThrow(/checksum entry is malformed/);
  await writeFile(sumsPath, `${originalSums}${originalSums.split('\n')[0]}\n`);
  await expect(validateKitForTest(finalized.kit, manifest)).rejects.toThrow(/unsafe, unexpected, or duplicate filename/);
  await rm(valid.tmp, { recursive: true, force: true });
  await rm(packed.tmp, { recursive: true, force: true });
}, 120_000);

it('fails closed on an actual offline dependency-cache miss, removes the verification prefix, and prints no success notice', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'vibe-package-offline-test-'));
  const { root, cache } = await fixture(tmp, false, true);
  const releaseDir = path.join(tmp, 'release');
  const tarball = await pack(root, releaseDir, cache);
  const candidateSha256 = await candidateIdentity(root);
  let prefix = '';
  let offlineDiagnostic = '';
  const output: string[] = [];
  const install = async (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
    expect(args).toContain('--offline');
    prefix = args[args.indexOf('--prefix') + 1]!;
    try { await exec('npm', args, options); }
    catch (error) {
      offlineDiagnostic = `${(error as NodeJS.ErrnoException & { stderr?: string }).stderr ?? ''}`;
      throw error;
    }
  };
  await expect(reportAfterValidation(() => finalizePackage({ releaseDir, tarball, version,
    candidateSha256, scriptBytes: script, procedureBytes: procedure, cache,
    candidateIdentity, install }), (message) => output.push(String(message)))).rejects.toThrow(/offline npm install failed/);
  expect(offlineDiagnostic).toMatch(/ENOTCACHED|ENOFFLINE/);
  expect(output).toEqual([]);
  await expect(access(path.dirname(prefix))).rejects.toThrow();
  await rm(tmp, { recursive: true, force: true });
}, 120_000);
