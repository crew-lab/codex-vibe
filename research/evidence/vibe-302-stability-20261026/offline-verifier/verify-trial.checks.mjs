import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, outputs, semanticResult, tapResult, auditTrees, treeDigest, verifyTrial, sha256 } from './verify-trial.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const semantic = () => ({ passed: true, files: [...outputs], checks: cases.map(name => ({ name, ok: true })) });
const tap = counts => `TAP version 13\n# tests ${counts.tests ?? 9}\n# pass ${counts.pass ?? 9}\n# fail ${counts.fail ?? 0}\n# cancelled ${counts.cancelled ?? 0}\n# skipped ${counts.skipped ?? 0}\n# todo ${counts.todo ?? 0}\n`;

test('accepts verifier passed rather than nonexistent ok field', () => {
  assert.deepEqual(semanticResult(semantic()), { passed: true, cases: 9 });
  assert.throws(() => semanticResult({ ...semantic(), passed: undefined, ok: true }));
  assert.throws(() => semanticResult({ ...semantic(), passed: false }));
});

test('rejects missing, repeated, failed and wrong-scope semantic evidence', () => {
  assert.throws(() => semanticResult({ ...semantic(), checks: [] }));
  assert.throws(() => semanticResult({ ...semantic(), checks: cases.map(() => ({ name: cases[0], ok: true })) }));
  const failed = semantic(); failed.checks[3].ok = false;
  assert.throws(() => semanticResult(failed));
  assert.throws(() => semanticResult({ ...semantic(), files: [...outputs, 'outside.txt'] }));
});

test('parses explicit TAP counts independently of a terminal spec reporter', () => {
  assert.equal(tapResult(tap({}), 0).pass, 9);
  assert.equal(tapResult(tap({ tests: 10, pass: 10 }), 0).pass, 10);
  assert.throws(() => tapResult('ℹ tests 9\nℹ pass 9\nℹ fail 0\n', 0));
  assert.throws(() => tapResult(tap({}), 1));
  assert.throws(() => tapResult(tap({}) + '# pass 9\n', 0));
});

test('rejects zero, failed, skipped, cancelled or incomplete worker suites', () => {
  for (const counts of [{ tests: 0, pass: 0 }, { tests: 8, pass: 8 }, { pass: 8, fail: 1 }, { pass: 8, skipped: 1 }, { cancelled: 1 }, { todo: 1 }]) assert.throws(() => tapResult(tap(counts), 0));
});

test('audits all base bytes, extra root files and executable modes', () => {
  const before = { 'CONTRACT.md': { sha256: 'a', executable: false }, 'src/limit.mjs': { sha256: 'b', executable: false } };
  const after = { ...before, [outputs[0]]: { sha256: 'c', executable: false }, [outputs[1]]: { sha256: 'd', executable: false } };
  assert.deepEqual(auditTrees(before, after), outputs);
  assert.throws(() => auditTrees(before, { ...after, 'CONTRACT.md': { sha256: 'changed', executable: false } }));
  assert.throws(() => auditTrees(before, { ...after, 'src/limit.mjs': { sha256: 'b', executable: true } }));
  assert.throws(() => auditTrees(before, { ...after, 'extra.txt': { sha256: 'x', executable: false } }));
});

test('refuses symlinks in the reconstructed tree', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vsup-trial-tree-'));
  try {
    await symlink('missing', path.join(root, 'alias'));
    await assert.rejects(treeDigest(root), /Linked or special/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('archived runner refuses before accessing files, creating grants or spawning workers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vsup-trial-disabled-'));
  try {
    const runner = path.join(root, 'execute-trial.mjs');
    await writeFile(runner, await readFile(path.join(here, 'execute-trial.mjs')));
    const result = spawnSync(process.execPath, [runner, '--force', '--authorize'], { cwd: root, env: {}, encoding: 'utf8', timeout: 2000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Archived hosted trial runner is disabled/);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects a changed patch before invoking external verification', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vsup-trial-artifact-'));
  try {
    const patch = path.join(root, 'diff.patch'); const verifier = path.join(root, 'verifier.mjs');
    await writeFile(patch, 'tampered'); await writeFile(verifier, 'throw new Error("must not run");');
    await assert.rejects(verifyTrial({ baseCommit: 'a'.repeat(40), patch, verifier, patchSha256: '0'.repeat(64), verifierSha256: '0'.repeat(64) }), /hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('reconstructs the committed base even when live fixture bytes differ', async () => {
  const patch = path.join(here, 'fixture.patch');
  const verifier = path.join(here, 'fixture-verify.mjs');
  const options = { patch, verifier, patchSha256: sha256(await readFile(patch)), verifierSha256: sha256(await readFile(verifier)), node: process.execPath };
  const root = await mkdtemp(path.join(tmpdir(), 'vsup-trial-base-'));
  const git = args => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'CONTRACT.md'), 'below(value, limit) must be true exactly when value is strictly less than limit.\nFixture marker: below-correct-20261010\n');
    await writeFile(path.join(root, 'src/limit.mjs'), 'export function below(value, limit) { return value < limit; }\n');
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=Offline Test', '-c', 'user.email=offline@example.test', 'commit', '-qm', 'fixture base']);
    const baseCommit = git(['rev-parse', 'HEAD']);
    await writeFile(path.join(root, 'CONTRACT.md'), 'modified live bytes must not be copied');
    const result = await verifyTrial({ ...options, fixture: root, baseCommit });
    assert.equal(result.verification, 'passed');
    assert.equal(result.worker_tests.tests, 9);
    assert.equal(result.base_files_unchanged, true);
    assert.equal(await readFile(path.join(root, 'CONTRACT.md'), 'utf8'), 'modified live bytes must not be copied');
  } finally { await rm(root, { recursive: true, force: true }); }
});
