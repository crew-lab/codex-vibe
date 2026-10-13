import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  descendantsOf, historySnapshot, observerAncestry, parseProcessTable,
  parseSupervisorPid, readRunStates, sampleGroups, updateHistory, validateDataDirectory,
} from '../scripts/v1-disconnect-observer.mjs';

function processRow(pid, ppid, pgid, state, comm, lstart) {
  return `${pid} ${ppid} ${pgid} ${state} ${comm} ${lstart}`;
}

test('parses only selected ps columns and preserves start identity with spaced command names', () => {
  const rows = parseProcessTable([
    processRow(100, 1, 90, 'S', '/Applications/Vibe App/bin/node', 'Mon Oct 13 10:23:03 2026'),
    processRow(101, 100, 90, 'R', '/opt/vibe/worker', 'Mon Oct 13 10:24:04 2026'),
  ].join('\n'));

  assert.deepEqual(rows, [
    { pid: 100, ppid: 1, pgid: 90, state: 'S', comm: '/Applications/Vibe App/bin/node', lstart: 'Mon Oct 13 10:23:03 2026' },
    { pid: 101, ppid: 100, pgid: 90, state: 'R', comm: '/opt/vibe/worker', lstart: 'Mon Oct 13 10:24:04 2026' },
  ]);
});

test('retains owned process identities and group IDs after a child is reparented', () => {
  const initial = parseProcessTable([
    processRow(1, 0, 1, 'S', '/sbin/launchd', 'Mon Oct 13 08:00:00 2026'),
    processRow(10, 1, 10, 'S', '/opt/supervisor/node', 'Mon Oct 13 10:00:00 2026'),
    processRow(11, 10, 10, 'S', '/opt/vibe/worker', 'Mon Oct 13 10:01:00 2026'),
  ].join('\n'));
  const owned = descendantsOf(initial, 10);
  assert.deepEqual(owned.map((row) => row.pid), [11]);
  const history = new Map();
  updateHistory(history, owned);

  const reparented = parseProcessTable([
    processRow(1, 0, 1, 'S', '/sbin/launchd', 'Mon Oct 13 08:00:00 2026'),
    processRow(11, 1, 10, 'S', '/opt/vibe/worker', 'Mon Oct 13 10:01:00 2026'),
  ].join('\n'));
  assert.deepEqual(descendantsOf(reparented, 10), []);
  assert.equal(historySnapshot(history, reparented)[0].alive, true);
  assert.deepEqual(sampleGroups(new Set([10]), reparented)[0].members.map((row) => row.pid), [11]);

  const exited = reparented.filter((row) => row.pid !== 11);
  assert.equal(historySnapshot(history, exited)[0].alive, false);
  assert.equal(sampleGroups(new Set([10]), exited)[0].members.length, 0);
});

test('validates observer ancestry independently of the supervisor tree', () => {
  const rows = parseProcessTable([
    processRow(1, 0, 1, 'S', '/sbin/launchd', 'Mon Oct 13 08:00:00 2026'),
    processRow(20, 1, 20, 'S', '/opt/supervisor/node', 'Mon Oct 13 10:00:00 2026'),
    processRow(21, 20, 20, 'S', '/opt/vibe/worker', 'Mon Oct 13 10:01:00 2026'),
    processRow(30, 1, 30, 'S', '/opt/observer/node', 'Mon Oct 13 10:02:00 2026'),
  ].join('\n'));

  assert.deepEqual(observerAncestry(rows, 30), [30, 1]);
  assert.equal(observerAncestry(rows, 30).includes(20), false);
  assert.deepEqual(observerAncestry(rows, 21), [21, 20, 1]);
});

test('reads only the numeric pid from the supervisor lock and rejects malformed input', () => {
  assert.equal(parseSupervisorPid('{"pid":42,"token":"secret-token","started_at":"now"}'), 42);
  assert.throws(() => parseSupervisorPid('{not-json'), /lock-malformed/);
  assert.throws(() => parseSupervisorPid('{"pid":"42","token":"secret-token"}'), /lock-invalid-pid/);
});

test('requires a canonical data directory and a regular non-symlink owner lock', async (t) => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'v1-observer-data-')));
  t.onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'supervisor.lock'), '{"pid":42,"token":"must-not-leak"}');
  const validated = await validateDataDirectory(dir);
  assert.equal(validated.pid, 42);
  assert.equal(Object.hasOwn(validated, 'token'), false);
  assert.equal(JSON.stringify(validated).includes('must-not-leak'), false);

  const lockPath = path.join(dir, 'supervisor.lock');
  const lockTarget = path.join(dir, 'lock-target');
  await writeFile(lockTarget, '{"pid":42}');
  await rm(lockPath);
  await symlink(lockTarget, lockPath);
  await assert.rejects(validateDataDirectory(dir), /lock-unsafe/);
});

test('extracts only safe run state fields from the rc28 meta.json format', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'v1-observer-run-'));
  t.onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const runId = '123e4567-e89b-42d3-a456-426614174000';
  const runDir = path.join(dir, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'meta.json'), JSON.stringify({
    run_id: runId, state: 'running', backend: 'programmatic', mode: 'edit',
    updated_at: '2026-10-13T10:00:00.000Z', started_at: '2026-10-13T09:59:00.000Z',
    task: 'private task text', task_sha256: 'a'.repeat(64),
    error: { message: 'private diagnostic' }, acp: { session_id: 'private-session' },
  }));

  const runs = await readRunStates(dir);
  assert.deepEqual(runs, [{
    run_id: runId, state: 'running', backend: 'programmatic', mode: 'edit',
    updated_at: '2026-10-13T10:00:00.000Z', started_at: '2026-10-13T09:59:00.000Z',
  }]);
  assert.equal(JSON.stringify(runs).includes('private task text'), false);
  assert.equal(JSON.stringify(runs).includes('private-session'), false);
});
