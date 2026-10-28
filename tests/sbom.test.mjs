import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockfile = (version) => `${JSON.stringify({ name: 'vibe-supervisor', lockfileVersion: 3, packages: { '': { name: 'vibe-supervisor' }, 'node_modules/is-number': { version, license: 'MIT' } } }, null, 2)}\n`;

async function withCandidate(t, lock) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sbom-'));
  t.onTestFinished(async () => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'dist'));
  for (const script of ['sbom.mjs', 'source-date.mjs']) await copyFile(path.join(repoRoot, 'scripts', script), path.join(root, 'scripts', script));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'vibe-supervisor', version: '9.8.7' }));
  await writeFile(path.join(root, 'package-lock.json'), lock);
  return root;
}

function generate(root, env) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'sbom.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 8_000, maxBuffer: 128 * 1024,
    env: { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: path.dirname(root), ...env },
  });
  return result;
}

async function generatedBytes(root, env) {
  const result = generate(root, env);
  assert.equal(result.status, 0, result.stderr);
  return readFile(path.join(root, 'dist', 'sbom.spdx.json'));
}

test('the SBOM is byte-identical across runs with the same source date', async (t) => {
  const root = await withCandidate(t, lockfile('7.0.0'));
  const first = await generatedBytes(root, { SOURCE_DATE_EPOCH: '1761523200' });
  const second = await generatedBytes(root, { SOURCE_DATE_EPOCH: '1761523200' });
  assert.deepEqual(first, second);
  const sbom = JSON.parse(first.toString('utf8'));
  assert.equal(sbom.creationInfo.created, '2025-10-27T00:00:00.000Z');
  assert.equal(sbom.annotations[0].annotationDate, '2025-10-27T00:00:00.000Z');
  assert.match(sbom.documentNamespace, /^https:\/\/spdx\.org\/spdxdocs\/vibe-supervisor-9\.8\.7-[a-f0-9]{64}$/);
});

test('the SBOM namespace follows the lockfile bytes', async (t) => {
  const env = { SOURCE_DATE_EPOCH: '1761523200' };
  const namespace = async (lock) => JSON.parse((await generatedBytes(await withCandidate(t, lock), env)).toString('utf8')).documentNamespace;
  assert.notEqual(await namespace(lockfile('7.0.0')), await namespace(lockfile('7.0.1')));
});

test('the SBOM takes the HEAD commit time when SOURCE_DATE_EPOCH is unset', async (t) => {
  const root = await withCandidate(t, lockfile('7.0.0'));
  const git = (...args) => assert.equal(spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_COMMITTER_DATE: '1761523200 +0000', GIT_AUTHOR_DATE: '1761523200 +0000', HOME: root } }).status, 0);
  git('init', '-q');
  git('-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-q', '--allow-empty', '-m', 'fixture');
  const sbom = JSON.parse((await generatedBytes(root, { HOME: root })).toString('utf8'));
  assert.equal(sbom.creationInfo.created, '2025-10-27T00:00:00.000Z');
});

test('the SBOM refuses to guess a date outside Git without SOURCE_DATE_EPOCH', async (t) => {
  const root = await withCandidate(t, lockfile('7.0.0'));
  const result = generate(root, { HOME: root });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SOURCE_DATE_EPOCH/);
});

test('the SBOM rejects a malformed SOURCE_DATE_EPOCH', async (t) => {
  const root = await withCandidate(t, lockfile('7.0.0'));
  const result = generate(root, { SOURCE_DATE_EPOCH: '2025-10-27' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SOURCE_DATE_EPOCH/);
});
