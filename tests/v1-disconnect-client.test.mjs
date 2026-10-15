import { writeFakePreparation } from "./unit/support/fake-preparation.js";
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, test } from 'vitest';
import { classify, parseArgs, redactReadiness } from '../scripts/v1-disconnect-client.mjs';
import { makeLaunchableFakeVibe } from './unit/support/launchable-fake-vibe.js';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..');
const script = path.join(repo, 'scripts', 'v1-disconnect-client.mjs');
const cli = path.join(process.env.VIBE_SUPERVISOR_TEST_DIST ?? path.join(repo, 'dist'), 'cli.js');
const scratch = [];
process.env.MISTRAL_API_KEY = 'disconnect-client-credential-abcdefghijklmnop';
const strays = new Set();

afterEach(async () => {
  for (const pid of strays) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  strays.clear();
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = async (cwd, args) => (await exec('git', args, { cwd })).stdout;

async function sandbox() {
  const parent = await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-disconnect-client-'));
  scratch.push(parent);
  const workspace = path.join(parent, 'workspace');
  const data = path.join(parent, 'data');
  const fake = path.join(parent, 'fake');
  await mkdir(workspace);
  await mkdir(data, { mode: 0o700 });
  await mkdir(fake);
  await writeFile(path.join(workspace, 'a.js'), 'console.log(1);\n');
  await git(workspace, ['init', '-q']);
  await git(workspace, ['add', 'a.js']);
  await git(workspace, ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init']);
  const launchable = await makeLaunchableFakeVibe(fake, { scenario: { name: 'hold', steps: [{ op: 'say', text: 'Working.' }, { op: 'hold' }] } });
  const workerRecord = launchable.workerRecord;
  const config = path.join(data, 'config.toml');
  await writeFile(config, `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[paths]\nvibe = ${JSON.stringify(launchable.vibe)}\nvibe_pin_manifest = ${JSON.stringify(launchable.manifest)}\n`, { mode: 0o600 });
  await writeFakePreparation(config);
  const taskFile = path.join(parent, 'task.txt');
  await writeFile(taskFile, 'hold until the client goes away\n');
  return { parent, workspace, config, taskFile, workerRecord };
}

const baseArgs = ['--cli', '/a/cli.js', '--config', '/a/config.toml', '--workspace', '/a/repo', '--task-file', '/a/task.txt', '--max-turns', '12', '--timeout-seconds', '180', '--output', '/a/out.json'];

test('parses one edit case and requires a base ref only for edits', () => {
  const options = parseArgs([...baseArgs, '--operation', 'edit', '--base-ref', 'abc']);
  assert.equal(options.operation, 'edit');
  assert.equal(options.baseRef, 'abc');
  assert.equal(options.maxTurns, 12);
  assert.throws(() => parseArgs([...baseArgs, '--operation', 'edit']), /base-ref-required-for-edit-only/);
  assert.throws(() => parseArgs([...baseArgs, '--operation', 'review', '--base-ref', 'abc']), /base-ref-required-for-edit-only/);
  assert.throws(() => parseArgs([...baseArgs, '--operation', 'review', '--retries', '1']), /invalid-arguments/);
  assert.throws(() => parseArgs([...baseArgs.slice(0, -1), 'out.json', '--operation', 'review']), /output-must-be-absolute/);
});

test('counts a run that settled before the disconnect as inconclusive, never as a pass', () => {
  assert.equal(classify({ observedRunning: true, settledBeforeDisconnect: false, serverExited: true, stateAfterReconnect: 'failed' }), 'PASS');
  assert.equal(classify({ observedRunning: false, settledBeforeDisconnect: true, serverExited: true, stateAfterReconnect: 'completed' }), 'INCONCLUSIVE');
  assert.equal(classify({ observedRunning: true, settledBeforeDisconnect: false, serverExited: false, stateAfterReconnect: 'failed' }), 'FAIL');
  assert.equal(classify({ observedRunning: true, settledBeforeDisconnect: false, serverExited: true, stateAfterReconnect: 'running' }), 'FAIL');
});

test('never records the readiness receipt', () => {
  assert.deepEqual(redactReadiness({ eligible: true, readiness_receipt: 'secret-receipt', session_id: 's' }), { eligible: true, session_id: 's' });
});

test('disconnects an active edit through the official client and finds it failed and retained after reconnect', async () => {
  const box = await sandbox();
  const base = (await git(box.workspace, ['rev-parse', 'HEAD'])).trim();
  const output = path.join(box.parent, 'case-7.json');
  const run = exec(process.execPath, [script, '--cli', cli, '--config', box.config, '--workspace', box.workspace, '--operation', 'edit', '--base-ref', base,
    '--task-file', box.taskFile, '--max-turns', '12', '--timeout-seconds', '180', '--output', output], { timeout: 60_000 });
  const finished = await run.catch((error) => error);
  try { strays.add(JSON.parse(await readFile(box.workerRecord, 'utf8')).pid); } catch {}
  const record = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(record.verdict, 'PASS', JSON.stringify({ record, stderr: finished.stderr }));
  assert.equal(finished.stdout.trim(), `PASS ${record.run_id}`);
  assert.equal(record.observed_running, true);
  assert.equal(record.server_exited, true);
  assert.equal(record.state_after_reconnect, 'failed');
  assert.match(JSON.stringify(record.error_after_reconnect), /will not be resumed or replayed/);
  assert.equal('readiness_receipt' in record.readiness, false);
  assert.equal(alive(JSON.parse(await readFile(box.workerRecord, 'utf8')).pid), false);
  const worktrees = (await git(box.workspace, ['worktree', 'list', '--porcelain'])).split('\n').filter((line) => line.startsWith('worktree '));
  assert.equal(worktrees.length, 2, 'the interrupted edit worktree is kept for vibe_close');
}, 90_000);

test.skipIf(process.platform !== 'darwin')('starts the independent observer on the session directory before the run', async () => {
  const box = await sandbox();
  const base = (await git(box.workspace, ['rev-parse', 'HEAD'])).trim();
  const output = path.join(box.parent, 'case-7.json');
  const observerOutput = path.join(box.parent, 'case-7-observer.jsonl');
  const finished = await exec(process.execPath, [script, '--cli', cli, '--config', box.config, '--workspace', box.workspace, '--operation', 'edit', '--base-ref', base,
    '--task-file', box.taskFile, '--max-turns', '12', '--timeout-seconds', '180', '--output', output, '--observer-output', observerOutput], { timeout: 60_000 }).catch((error) => error);
  const record = JSON.parse(await readFile(output, 'utf8'));
  if (record.observer?.pid) strays.add(record.observer.pid);
  try { strays.add(JSON.parse(await readFile(box.workerRecord, 'utf8')).pid); } catch {}
  assert.equal(record.verdict, 'PASS', JSON.stringify({ record, stderr: finished.stderr }));
  assert.equal(record.observer.started, true);
  const lines = (await readFile(observerOutput, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines[0].type, 'observer_started');
  assert.equal(lines[0].supervisor_pid, record.server_pid);
  const samples = lines.filter((line) => line.type === 'sample');
  assert.ok(samples.some((sample) => sample.owned_descendants.some((entry) => entry.alive)), 'the worker was seen alive before the disconnect');
  const released = samples.find((sample) => !sample.supervisor.alive);
  assert.ok(released, 'the observer saw the supervisor exit');
  assert.equal(released.lock, 'absent');
  assert.equal(released.owned_descendants.some((entry) => entry.alive), false);
  const clientGroup = samples[0].supervisor.pgid;
  assert.equal(released.process_groups.some((group) => group.pgid !== clientGroup && group.present), false);
}, 90_000);
