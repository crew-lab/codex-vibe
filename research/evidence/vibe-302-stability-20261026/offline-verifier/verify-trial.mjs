import { execFile } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
export const cases = ['negative-below', 'negative-equal', 'negative-above', 'decimal-below', 'equal', 'decimal-above', 'positive-above-zero', 'zero-below-positive', 'nonmutation'];
export const outputs = ['src/at-least.mjs', 'tests/at-least.test.mjs'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function semanticResult(value) {
  if (!value || value.passed !== true || !Array.isArray(value.checks) || value.checks.length !== cases.length || new Set(value.checks.map(item => item.name)).size !== cases.length || cases.some(name => !value.checks.some(item => item.name === name && item.ok === true))) throw new Error('Semantic verifier did not pass all required cases');
  if (!Array.isArray(value.files) || JSON.stringify([...value.files].sort()) !== JSON.stringify(outputs)) throw new Error('Semantic verifier file scope mismatch');
  return { passed: true, cases: value.checks.length };
}

export function tapResult(stdout, exitCode) {
  if (exitCode !== 0 || !stdout.startsWith('TAP version 13\n')) throw new Error('Worker tests failed or did not use explicit TAP output');
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...stdout.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous TAP ${key} count`);
    counts[key] = Number(matches[0][1]);
  }
  if (counts.tests < cases.length || counts.pass !== counts.tests || ['fail', 'cancelled', 'skipped', 'todo'].some(key => counts[key] !== 0)) throw new Error('Worker suite must execute at least nine passing tests without skips or failures');
  return counts;
}

function safeRelative(file) {
  if (!file || file.includes('\\') || path.posix.isAbsolute(file) || file.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) throw new Error('Unsafe tree path');
  return file;
}

export async function treeDigest(root) {
  const files = {};
  const walk = async relative => {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const file = relative ? `${relative}/${name}` : name;
      safeRelative(file);
      const metadata = await lstat(path.join(root, file));
      if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory()) || (metadata.isFile() && metadata.nlink !== 1)) throw new Error('Linked or special verification file');
      if (metadata.isDirectory()) await walk(file);
      else {
        if (Object.keys(files).length >= 100 || metadata.size > 1024 * 1024) throw new Error('Verification tree exceeds bounds');
        files[file] = { sha256: sha256(await readFile(path.join(root, file))), executable: (metadata.mode & 0o111) !== 0 };
      }
    }
  };
  await walk('');
  return files;
}

export function auditTrees(before, after) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => JSON.stringify(before[file]) !== JSON.stringify(after[file])).sort();
  if (JSON.stringify(changed) !== JSON.stringify(outputs) || outputs.some(file => before[file] !== undefined || after[file] === undefined) || Object.keys(before).some(file => JSON.stringify(before[file]) !== JSON.stringify(after[file]))) throw new Error('Patch changed base content or exceeded exact output scope');
  return changed;
}

async function boundedFile(file) {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 1024 * 1024) throw new Error('Unsafe verification artifact');
  const bytes = await readFile(file);
  if (bytes.length > 1024 * 1024) throw new Error('Oversized verification artifact');
  return bytes;
}

export async function verifyTrial(options) {
  if (!/^[a-f0-9]{40}$/.test(options.baseCommit)) throw new Error('Expected exact base commit');
  const patch = await boundedFile(options.patch);
  const verifier = await boundedFile(options.verifier);
  if (sha256(patch) !== options.patchSha256 || sha256(verifier) !== options.verifierSha256) throw new Error('Verification artifact hash mismatch');
  const env = { PATH: process.env.PATH, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
  const git = async (args, cwd) => (await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env, timeout: 10000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' })).stdout;
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-trial-offline-'));
  try {
    const listed = (await git(['ls-tree', '-rz', options.baseCommit], options.fixture)).split('\0').filter(Boolean);
    if (listed.length > 100) throw new Error('Base exceeds file bound');
    for (const row of listed) {
      const match = /^(100644|100755) blob [a-f0-9]{40}\t(.+)$/.exec(row);
      if (!match) throw new Error('Unsupported base tree entry');
      const file = safeRelative(match[2]);
      const content = await git(['show', `${options.baseCommit}:${file}`], options.fixture);
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { mode: match[1] === '100755' ? 0o700 : 0o600, flag: 'wx' });
    }
    const before = await treeDigest(root);
    const stagedPatch = path.join(await realpath(path.dirname(root)), `${path.basename(root)}.patch`);
    try {
      await writeFile(stagedPatch, patch, { mode: 0o600, flag: 'wx' });
      const numstat = (await git(['apply', '--numstat', '-z', stagedPatch], root)).split('\0').filter(Boolean);
      if (numstat.length !== outputs.length || numstat.some(row => !/^\d+\t0\t/.test(row) || !outputs.includes(row.split('\t')[2]))) throw new Error('Patch headers exceed addition-only scope');
      await git(['apply', '--check', stagedPatch], root);
      await git(['apply', stagedPatch], root);
    } finally { await rm(stagedPatch, { force: true }); }
    const after = await treeDigest(root);
    const changed = auditTrees(before, after);
    const semantic = await exec(options.node, [options.verifier, root], { cwd: root, env, timeout: 10000, maxBuffer: 128 * 1024 });
    const checkedSemantic = semanticResult(JSON.parse(semantic.stdout));
    const tests = await exec(options.node, ['--test', '--test-reporter=tap', 'tests/at-least.test.mjs'], { cwd: root, env, timeout: 10000, maxBuffer: 128 * 1024 });
    const checkedTests = tapResult(tests.stdout, 0);
    const afterExecution = await treeDigest(root);
    if (JSON.stringify(afterExecution) !== JSON.stringify(after)) throw new Error('Verification execution modified the reconstructed tree');
    return { patch_sha256: options.patchSha256, base_commit: options.baseCommit, verifier_sha256: options.verifierSha256, changed_files: changed, base_files_unchanged: true, semantics: checkedSemantic, worker_tests: checkedTests, verification: 'passed', hosted_starts: 0, worker_test_output: tests.stdout };
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: verify-trial.mjs <private-offline-options.json>');
  const options = JSON.parse((await boundedFile(process.argv[2])).toString('utf8'));
  const result = await verifyTrial(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
