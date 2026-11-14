#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkOrderTotalCases } from './quality-pack/checks/review-total.mjs';

const PACK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'quality-pack');
const PROJECT = path.join(PACK, 'project');
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TEST_TIMEOUT_MS = 30_000;
const FIXTURE_IDENTITY = {
  GIT_AUTHOR_NAME: 'Quality Pack', GIT_AUTHOR_EMAIL: 'quality-pack@example.invalid', GIT_AUTHOR_DATE: '2026-11-04T00:00:00Z',
  GIT_COMMITTER_NAME: 'Quality Pack', GIT_COMMITTER_EMAIL: 'quality-pack@example.invalid', GIT_COMMITTER_DATE: '2026-11-04T00:00:00Z'
};

function usage() {
  return [
    'node scripts/quality-pack.mjs list',
    'node scripts/quality-pack.mjs create <new-directory>',
    'node scripts/quality-pack.mjs request <task-id> --cwd <fixture-directory>',
    'node scripts/quality-pack.mjs check <task-id> --patch <exported-patch> | --answer <review-answer-file> [--findings-only]',
    'node scripts/quality-pack.mjs record <task-id> --export <export-directory> [--out <file>]',
    'node scripts/quality-pack.mjs prompt <task-id> [--worker vibe|agy]'
  ].join('\n');
}

function fail(message) {
  process.stderr.write(`${message}\n\n${usage()}\n`);
  process.exit(2);
}

function git(cwd, args, env = {}) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...env } });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function tasks() {
  const names = (await readdir(path.join(PACK, 'tasks'))).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(PACK, 'tasks', name), 'utf8'))));
}

async function task(id) {
  const found = (await tasks()).find((candidate) => candidate.id === id);
  if (!found) fail(`Unknown task ${id}.`);
  return found;
}

async function exists(file) {
  return stat(file).then(() => true, () => false);
}

async function create(directory) {
  const target = path.resolve(directory);
  if (await exists(target)) fail(`${target} already exists; choose a new directory.`);
  await cp(PROJECT, target, { recursive: true });
  git(target, ['init', '-q', '-b', 'main']);
  git(target, ['add', '-A']);
  git(target, ['commit', '-q', '-m', 'orders fixture'], FIXTURE_IDENTITY);
  return { directory: await realpath(target), base_commit: git(target, ['rev-parse', 'HEAD']) };
}

async function request(id, cwd) {
  if (!cwd) fail('request needs --cwd <fixture-directory>.');
  const root = await realpath(path.resolve(cwd));
  const definition = await task(id);
  const common = { cwd: root, task: definition.task, max_turns: definition.max_turns, timeout_seconds: definition.timeout_seconds };
  if (definition.operation === 'review') return { operation: 'review', request: { ...common, context_files: definition.context_files } };
  return { operation: 'edit', request: { ...common, base_ref: git(root, ['rev-parse', 'HEAD']), acceptance_contract: definition.acceptance_contract, allowed_write_paths: definition.allowed_write_paths } };
}

async function testFiles(root, directories) {
  const found = [];
  for (const directory of directories) {
    const names = await readdir(path.join(root, directory)).catch(() => []);
    found.push(...names.filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `${directory}/${name}`));
  }
  return found;
}

function countFromTap(output, label) {
  const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output);
  return match ? Number(match[1]) : null;
}

async function checkEdit(definition, patchFile) {
  const scratch = await mkdtemp(path.join(await realpath(os.tmpdir()), `quality-${definition.id}-`));
  try {
    const copy = path.join(scratch, 'project');
    await cp(PROJECT, copy, { recursive: true });
    const patch = path.resolve(patchFile);
    const changed = git(copy, ['apply', '--numstat', patch]).split('\n').filter(Boolean).map((line) => line.split('\t')[2]);
    const outside = changed.filter((file) => !definition.allowed_write_paths.includes(file));
    const missing = definition.acceptance_contract.required_changed_paths.filter((file) => !changed.includes(file));
    git(copy, ['apply', patch]);
    await mkdir(path.join(copy, 'quality-check'));
    await cp(path.join(PACK, 'checks', `${definition.id}.test.mjs`), path.join(copy, 'quality-check', `${definition.id}.test.mjs`));
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...await testFiles(copy, ['tests', 'quality-check'])], { cwd: copy, encoding: 'utf8', timeout: TEST_TIMEOUT_MS, env: { PATH: process.env.PATH ?? '', HOME: scratch, TMPDIR: scratch } });
    const output = `${run.stdout}\n${run.stderr}`;
    const passedTests = countFromTap(output, 'pass');
    const failedTests = countFromTap(output, 'fail');
    const failures = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]);
    const checks = [
      { id: 'only-allowed-paths', passed: outside.length === 0, detail: outside.length ? `changed outside the task: ${outside.join(', ')}` : changed.join(', ') },
      { id: 'required-paths-changed', passed: missing.length === 0, detail: missing.length ? `not changed: ${missing.join(', ')}` : 'all changed' },
      { id: 'all-tests-pass', passed: run.status === 0 && failedTests === 0 && (passedTests ?? 0) > 0, detail: run.error ? `test run failed: ${run.error.message}` : `${passedTests ?? '?'} passed, ${failedTests ?? '?'} failed${failures.length ? `: ${failures.join('; ')}` : ''}` }
    ];
    return { task: definition.id, passed: checks.every((check) => check.passed), checks };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function checkReview(definition, answerFile, findingsOnly) {
  const answer = await readFile(path.resolve(answerFile), 'utf8');
  const checks = definition.expected.map((expected) => {
    const match = new RegExp(expected.pattern, 'i').exec(answer);
    return { id: expected.id, passed: Boolean(match), detail: match ? `found: ${match[0].slice(0, 120)}` : `missing: ${expected.explain}` };
  });
  const cited = answer.includes(definition.file);
  checks.push({ id: 'cites-file', passed: cited, detail: cited ? `cited: ${definition.file}` : `${definition.file} was not found in the answer` });
  if (definition.id === 'review-total' && !findingsOnly) {
    checks.push(...await checkOrderTotalCases(PROJECT, answer));
  }
  return { task: definition.id, passed: checks.every((check) => check.passed), checks, note: 'Pattern checks are a first pass; read the answer before accepting it.' };
}

async function check(id, args) {
  const definition = await task(id);
  if (definition.operation === 'edit') {
    const patch = option(args, '--patch');
    if (!patch) fail('An edit check needs --patch <exported-patch>.');
    return checkEdit(definition, patch);
  }
  const answer = option(args, '--answer');
  if (!answer) fail('A review check needs --answer <review-answer-file>.');
  return checkReview(definition, answer, args.includes('--findings-only'));
}

function taskSha256(definition) {
  return createHash('sha256').update(definition.task).digest('hex');
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function verifyAgainstSums(root, name) {
  const sumsFile = path.join(root, 'SHA256SUMS');
  if (!await exists(sumsFile)) fail(`${sumsFile} not found; the export is incomplete.`);
  const line = (await readFile(sumsFile, 'utf8')).split('\n').find((item) => item.endsWith(`  ${name}`));
  if (!line) fail(`${name} is not listed in SHA256SUMS; it was not exported with this report.`);
  const actual = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  if (line.slice(0, 64) !== actual) fail(`${name} does not match its hash in SHA256SUMS; it is not the file exported with this report.`);
}

async function record(id, args) {
  const exportDirectory = option(args, '--export');
  if (!exportDirectory) fail('record needs --export <export-directory>.');
  const out = option(args, '--out');
  const definition = await task(id);
  const root = path.resolve(exportDirectory);
  const reportFile = path.join(root, 'report.json');
  if (!await exists(reportFile)) fail(`${reportFile} not found; export the run first.`);
  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  const exportedHash = report?.provenance?.task_sha256;
  const expectedHash = taskSha256(definition);
  if (exportedHash !== expectedHash) {
    fail(`The export's task hash ${String(exportedHash).slice(0, 12)} does not match task ${id} (${expectedHash.slice(0, 12)}). A record is only made for the quality pack's own fixture task, never for another project's.`);
  }
  const answerFile = path.join(root, 'answer.txt');
  const patchFile = path.join(root, 'changes.patch');
  let answer;
  let verdict;
  if (definition.operation === 'edit') {
    if (!await exists(patchFile)) fail(`${patchFile} not found; export the run with --include patch.`);
    await verifyAgainstSums(root, 'changes.patch');
    verdict = await checkEdit(definition, patchFile);
  } else {
    if (!await exists(answerFile)) fail(`${answerFile} not found; export the run with --include answer.`);
    await verifyAgainstSums(root, 'answer.txt');
    answer = await readFile(answerFile, 'utf8');
    verdict = await checkReview(definition, answerFile, false);
  }
  const usage = isObject(report.usage) ? report.usage : {};
  const thinking = report.models?.thinking;
  const result = {
    task: id,
    task_hash_matched: true,
    passed: verdict.passed,
    checks: verdict.checks,
    ...(answer === undefined ? {} : { answer }),
    stop_reason: report.execution?.stop_reason ?? null,
    execution_state: report.execution?.state ?? null,
    answer_present: typeof report.answer_present === 'boolean' ? report.answer_present : null,
    usage: {
      prompt_tokens: usage.promptTokens ?? null,
      completion_tokens: usage.completionTokens ?? null,
      model_calls: usage.modelCalls ?? null,
      tool_calls: usage.toolCalls ?? null
    },
    thinking: isObject(thinking) ? { requested: thinking.requested?.value ?? null, status: thinking.status ?? null, observed: (thinking.observations ?? []).map((item) => item.value) } : null,
    supervisor_version: report.supervisor_version ?? null,
    worker: { backend: report.backend ?? null, version: report.pin?.vibe_version ?? null },
    ...(isObject(report.context_reads) ? { context_reads: report.context_reads } : {})
  };
  if (out) {
    const target = path.resolve(out);
    if (await exists(target)) fail(`${target} already exists; choose a new file.`);
    await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  }
  return result;
}

async function promptText(id, worker) {
  if (!['vibe', 'agy'].includes(worker)) fail('--worker must be vibe or agy.');
  const definition = await task(id);
  const modules = [path.join(DIST, 'core', 'worker-context.js'), path.join(DIST, 'core', 'task-prompt.js')];
  if (!(await Promise.all(modules.map(exists))).every(Boolean)) fail('dist is missing; run npm run build first.');
  const { workerRules } = await import(pathToFileURL(modules[0]).href);
  const { buildTaskPrompt } = await import(pathToFileURL(modules[1]).href);
  const input = definition.operation === 'review'
    ? { mode: 'review', task: definition.task, contextFiles: definition.context_files }
    : { mode: 'edit', task: definition.task, allowedWritePaths: definition.allowed_write_paths, acceptanceContract: definition.acceptance_contract };
  return [
    `=== Worker rules (${worker}, ${definition.operation}) ===`,
    workerRules(worker, definition.operation),
    '',
    '=== Task prompt ===',
    buildTaskPrompt(input, null)
  ].join('\n');
}

const [command, id, ...rest] = process.argv.slice(2);
let result;
if (command === 'list') result = (await tasks()).map(({ id: taskId, operation, what }) => ({ id: taskId, operation, what }));
else if (command === 'create' && id) result = await create(id);
else if (command === 'request' && id) result = await request(id, option(rest, '--cwd'));
else if (command === 'check' && id) result = await check(id, rest);
else if (command === 'record' && id) result = await record(id, rest);
else if (command === 'prompt' && id) result = await promptText(id, option(rest, '--worker') ?? 'vibe');
else fail('Unknown or incomplete command.');
process.stdout.write(typeof result === 'string' ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`);
if (command === 'check' && !result.passed) process.exitCode = 1;
