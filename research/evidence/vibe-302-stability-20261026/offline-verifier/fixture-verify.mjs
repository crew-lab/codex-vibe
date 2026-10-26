#!/usr/bin/env node



import { spawnSync } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_FILES = ['src/at-least.mjs', 'tests/at-least.test.mjs'];
const CHILD_TIMEOUT_MS = 4_000;
const CHILD_MAX_BUFFER = 64 * 1024;

const CHILD_CHECK = String.raw`
const [moduleUrl] = process.argv.slice(1);
const checks = [];
try {
  const namespace = await import(moduleUrl);
  const atLeast = namespace.atLeast;
  if (typeof atLeast !== 'function') {
    process.stdout.write(JSON.stringify({ ok: false, reason: 'invalid-export' }));
    process.exit(0);
  }

  const cases = [
    [-3, -2, false, 'negative-below'],
    [-2, -2, true, 'negative-equal'],
    [-1, -2, true, 'negative-above'],
    [699.99, 700, false, 'decimal-below'],
    [700, 700, true, 'equal'],
    [700.01, 700, true, 'decimal-above'],
    [1, 0, true, 'positive-above-zero'],
    [0, 1, false, 'zero-below-positive'],
  ];
  for (const [value, limit, expected, name] of cases) {
    let actual;
    try { actual = atLeast(value, limit); }
    catch { checks.push({ name, ok: false }); continue; }
    checks.push({ name, ok: actual === expected });
  }

  const value = Object.freeze({ valueOf() { return 8; } });
  const limit = Object.freeze({ valueOf() { return 7; } });
  const before = [Reflect.ownKeys(value), Reflect.ownKeys(limit)];
  let nonmutation = false;
  try {
    const result = atLeast(value, limit);
    nonmutation = result === true
      && JSON.stringify([Reflect.ownKeys(value), Reflect.ownKeys(limit)]) === JSON.stringify(before);
  } catch {}
  checks.push({ name: 'nonmutation', ok: nonmutation });

  process.stdout.write(JSON.stringify({ ok: checks.every((check) => check.ok), checks }));
} catch {
  process.stdout.write(JSON.stringify({ ok: false, reason: 'module-load-failed' }));
}
`;

function usage() {
  return 'Usage: node scripts/fixture-verify.mjs <disposable-export-directory>\n'
    + 'The directory must be a disposable candidate export, outside any Git checkout. '
    + 'This command executes src/at-least.mjs; it never copies or applies changes.';
}

function reportFailure(reason, details = {}) {
  return { passed: false, reason, files: EXPECTED_FILES, ...details };
}

async function isInsideGitCheckout(candidateRoot) {
  let current = candidateRoot;
  for (;;) {
    try {
      await lstat(path.join(current, '.git'));
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') return true;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function verify(candidateArg) {
  let candidateRoot;
  try {
    candidateRoot = await realpath(path.resolve(candidateArg));
  } catch {
    return reportFailure('candidate-directory-unavailable');
  }

  let candidateStat;
  try {
    candidateStat = await lstat(candidateRoot);
  } catch {
    return reportFailure('candidate-directory-unavailable');
  }
  if (!candidateStat.isDirectory()) return reportFailure('candidate-is-not-directory');
  if (await isInsideGitCheckout(candidateRoot)) {
    return reportFailure('candidate-must-be-disposable-export-outside-git-checkout');
  }

  for (const relativeFile of EXPECTED_FILES) {
    try {
      const filePath = path.join(candidateRoot, relativeFile);
      const fileStat = await lstat(filePath);
      if (!fileStat.isFile()) return reportFailure('required-file-not-regular', { file: relativeFile });
      const canonicalFile = await realpath(filePath);
      const relativeCanonicalFile = path.relative(candidateRoot, canonicalFile);
      if (relativeCanonicalFile === '..'
        || relativeCanonicalFile.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeCanonicalFile)) {
        return reportFailure('required-file-outside-candidate-directory', { file: relativeFile });
      }
    } catch {
      return reportFailure('required-file-missing', { file: relativeFile });
    }
  }

  const modulePath = path.join(candidateRoot, EXPECTED_FILES[0]);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD_CHECK, pathToFileURL(modulePath).href], {
    cwd: candidateRoot,
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    maxBuffer: CHILD_MAX_BUFFER,
    windowsHide: true,
    env: { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' },
  });

  if (child.error?.code === 'ETIMEDOUT' || child.signal === 'SIGTERM' || child.signal === 'SIGKILL') {
    return reportFailure('candidate-execution-timeout');
  }
  if (child.error || child.status !== 0 || typeof child.stdout !== 'string') {
    return reportFailure('candidate-execution-failed');
  }

  let result;
  try {
    result = JSON.parse(child.stdout);
  } catch {
    return reportFailure('candidate-returned-invalid-result');
  }

  if (result.reason === 'invalid-export') return reportFailure('atLeast-export-must-be-a-function');
  if (result.reason === 'module-load-failed') return reportFailure('candidate-module-failed-to-load');
  if (!Array.isArray(result.checks)) return reportFailure('candidate-returned-invalid-result');
  return {
    passed: result.ok === true,
    files: EXPECTED_FILES,
    checks: result.checks,
  };
}

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}
if (args.length !== 1) {
  process.stdout.write(`${JSON.stringify(reportFailure('invalid-arguments', { usage: usage().split('\n')[0] }))}\n`);
  process.exit(2);
}

const result = await verify(args[0]);
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.passed ? 0 : 1);

