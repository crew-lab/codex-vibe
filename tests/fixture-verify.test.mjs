import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(repoRoot, 'scripts/fixture-verify.mjs');

async function withCandidate(t, { source, includeTestFile = true }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fixture-verify-'));
  t.onTestFinished(async () => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'tests'), { recursive: true });
  if (source !== undefined) await writeFile(path.join(root, 'src/at-least.mjs'), source);
  if (includeTestFile) {
    await writeFile(path.join(root, 'tests/at-least.test.mjs'), 'export {};\n');
  }
  return root;
}

function runVerifier(candidateRoot) {
  return spawnSync(process.execPath, [verifier, candidateRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 8_000,
    maxBuffer: 128 * 1024,
  });
}

function readJsonResult(child) {
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null);
  assert.notEqual(child.status, null);
  return JSON.parse(child.stdout);
}

test('accepts the correct exported predicate and reports each independent check', async (t) => {
  const candidate = await withCandidate(t, { source: 'export function atLeast(value, limit) { return value >= limit; }\n' });
  const child = runVerifier(candidate);
  const result = readJsonResult(child);

  assert.equal(child.status, 0);
  assert.equal(result.passed, true);
  assert.deepEqual(result.files, ['src/at-least.mjs', 'tests/at-least.test.mjs']);
  assert.ok(result.checks.some((check) => check.name === 'decimal-below' && check.ok));
  assert.ok(result.checks.some((check) => check.name === 'equal' && check.ok));
  assert.ok(result.checks.some((check) => check.name === 'decimal-above' && check.ok));
  assert.ok(result.checks.some((check) => check.name === 'nonmutation' && check.ok));
});

test('rejects an inverted predicate', async (t) => {
  const candidate = await withCandidate(t, { source: 'export function atLeast(value, limit) { return value <= limit; }\n' });
  const child = runVerifier(candidate);
  const result = readJsonResult(child);

  assert.equal(child.status, 1);
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => check.ok === false));
});

test('rejects a missing function export', async (t) => {
  const candidate = await withCandidate(t, { source: 'export function other(value, limit) { return value >= limit; }\n' });
  const child = runVerifier(candidate);
  const result = readJsonResult(child);

  assert.equal(child.status, 1);
  assert.equal(result.reason, 'atLeast-export-must-be-a-function');
});

test('rejects a missing required file without executing the source', async (t) => {
  const candidate = await withCandidate(t, { source: 'throw new Error("must not execute");\n', includeTestFile: false });
  const child = runVerifier(candidate);
  const result = readJsonResult(child);

  assert.equal(child.status, 1);
  assert.equal(result.reason, 'required-file-missing');
  assert.equal(result.file, 'tests/at-least.test.mjs');
});

test('reports syntax errors without exposing candidate source or stack output', async (t) => {
  const candidate = await withCandidate(t, { source: 'export function atLeast( {\n' });
  const child = runVerifier(candidate);
  const result = readJsonResult(child);

  assert.equal(child.status, 1);
  assert.equal(result.reason, 'candidate-module-failed-to-load');
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.includes('atLeast( {'), false);
});

test('refuses directories inside a Git checkout before loading the candidate', async () => {
  const child = runVerifier(repoRoot);
  const result = readJsonResult(child);

  assert.equal(child.status, 1);
  assert.equal(result.reason, 'candidate-must-be-disposable-export-outside-git-checkout');
});

test('rejects a required file reached through an escaping parent symlink before executing it', async (t) => {
  const candidate = await withCandidate(t, { source: undefined });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'fixture-outside-'));
  t.onTestFinished(async () => rm(outside, { recursive: true, force: true }));
  const marker = path.join(outside, 'executed-marker');
  const outsideSource = path.join(outside, 'at-least.mjs');
  await writeFile(outsideSource,
    `import { writeFile } from 'node:fs/promises';\nawait writeFile(${JSON.stringify(marker)}, 'ran');\nexport function atLeast(value, limit) { return value >= limit; }\n`);
  await rm(path.join(candidate, 'src'), { recursive: true, force: true });
  await symlink(outside, path.join(candidate, 'src'), 'dir');

  const child = runVerifier(candidate);
  const result = readJsonResult(child);

  assert.equal(child.status, 1);
  assert.equal(result.reason, 'required-file-outside-candidate-directory');
  assert.equal(result.file, 'src/at-least.mjs');
  assert.equal(existsSync(marker), false);
});
