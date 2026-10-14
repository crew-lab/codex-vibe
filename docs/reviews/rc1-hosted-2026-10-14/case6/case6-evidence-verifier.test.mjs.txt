import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyCase6Evidence } from './case6-evidence-verifier.mjs';

const runId = '20627eaf-caeb-4612-a879-2232ddcc4ee5';
const serverPid = 49266;
const serverStart = 'Wed Oct 14 08:54:37 2026';
const workerStart = 'Wed Oct 14 08:54:38 2026';
const runAt = '2026-10-14T06:54:38.223Z';
const closeAt = '2026-10-14T06:54:42.578Z';

function sample(sequence, timestamp, { supervisorAlive, lock, state, sharedMembers, workerMembers, wrongRun = false, supervisorIdentity = serverStart, workerAlive = supervisorAlive } = {}) {
  const targetRunId = wrongRun ? `${runId}-other` : runId;
  return {
    type: 'sample', sequence, timestamp,
    supervisor: { pid: serverPid, start_identity: supervisorIdentity, alive: supervisorAlive, pgid: 49265 },
    owned_descendants: [{ first_observed: { pid: 49367, lstart: workerStart, pgid: 49367 }, alive: workerAlive }],
    process_groups: [
      { pgid: 49265, present: sharedMembers.length > 0, members: sharedMembers, first_observed_at: runAt },
      { pgid: 49367, present: workerMembers.length > 0, members: workerMembers, first_observed_at: runAt },
    ],
    lock,
    runs: [{ run_id: targetRunId, state, backend: 'programmatic', mode: 'edit' }],
  };
}

function evidence() {
  const observerStart = {
    type: 'observer_started', schema_version: 1, started_at: '2026-10-14T06:54:38.053Z',
    observer: { pid: 49291, ppid: 49265, pgid: 49291 }, observer_ancestry: [49291, 49265, 20352, 1],
    supervisor_pid: serverPid, supervisor_start_identity: serverStart,
  };
  const active = sample(18, '2026-10-14T06:54:42.412Z', {
    supervisorAlive: true, lock: 'present', state: 'running', sharedMembers: [{ pid: 49266, lstart: serverStart }],
    workerMembers: [{ pid: 49367, lstart: workerStart }], workerAlive: true,
  });
  const closed = sample(107, '2026-10-14T06:55:04.780Z', {
    supervisorAlive: false, lock: 'absent', state: 'failed', sharedMembers: [], workerMembers: [], workerAlive: false,
  });
  const record = {
    schema_version: 1, case: 6, operation: 'edit', run_id: runId, server_pid: serverPid, verdict: 'FAIL',
    timestamps: { start: runAt, active_worker_confirmed: '2026-10-14T06:54:42.578Z', client_close: closeAt },
    observer: { pid: 49291, started: true }, active_worker_confirmed: true, state_before_disconnect: 'running',
    completed_read_count_before_disconnect: 5,
    worker_diagnostics: {
      stages: ['entrypoint_invocation'],
      tool_calls: Array.from({ length: 5 }, () => ({ tool: 'read_file', outcome: 'completed' })),
    },
    pre_disconnect_observer_confirmation: { confirmed: true, sequence: 18, timestamp: active.timestamp },
    no_replay_confirmed: true, state_after_reconnect: 'failed', error_code_after_reconnect: 'VSUP_BACKEND_CRASHED', retryable_after_reconnect: false,
    server_exited: true,
  };
  return { record, observerRecords: [observerStart, active, closed] };
}

test('accepts coherent post-helper-exit evidence while preserving the original raw FAIL', () => {
  const { record, observerRecords } = evidence();
  const result = verifyCase6Evidence(record, observerRecords);
  assert.equal(result.accepted, true, result.failures.join(', '));
  assert.equal(result.raw_runner_verdict, 'FAIL');
  assert.equal(result.coherent_closure.sequence, 107);
  assert.equal(result.coherent_closure.supervisor_start_identity, serverStart);
});

test('rejects closure while the controller is still present in the shared supervisor group', () => {
  const { record, observerRecords } = evidence();
  observerRecords[2].process_groups[0] = {
    pgid: 49265, present: true, members: [{ pid: 49265, lstart: serverStart }], first_observed_at: runAt,
  };
  const result = verifyCase6Evidence(record, observerRecords);
  assert.equal(result.accepted, false);
  assert.ok(result.failures.includes('no-coherent-post-close-closure-sample'));
});

test('rejects a reused supervisor PID with a different start identity', () => {
  const { record, observerRecords } = evidence();
  observerRecords[2].supervisor.start_identity = 'Wed Oct 14 09:01:00 2026';
  const result = verifyCase6Evidence(record, observerRecords);
  assert.equal(result.accepted, false);
  assert.ok(result.failures.includes('no-coherent-post-close-closure-sample'));
});

test('rejects an unknown live member in any tracked process group', () => {
  const { record, observerRecords } = evidence();
  observerRecords[2].process_groups[1] = {
    pgid: 49367, present: true, members: [{ pid: 99999, lstart: 'Wed Oct 14 09:01:00 2026' }], first_observed_at: runAt,
  };
  const result = verifyCase6Evidence(record, observerRecords);
  assert.equal(result.accepted, false);
  assert.ok(result.failures.includes('no-coherent-post-close-closure-sample'));
});

test('rejects a coherent-looking sample while the owner lock remains present', () => {
  const { record, observerRecords } = evidence();
  observerRecords[2].lock = 'present';
  const result = verifyCase6Evidence(record, observerRecords);
  assert.equal(result.accepted, false);
  assert.ok(result.failures.includes('no-coherent-post-close-closure-sample'));
});

test('rejects closure records correlated to a different run ID', () => {
  const { record, observerRecords } = evidence();
  observerRecords[2].runs[0].run_id = `${runId}-other`;
  const result = verifyCase6Evidence(record, observerRecords);
  assert.equal(result.accepted, false);
  assert.ok(result.failures.includes('no-coherent-post-close-closure-sample'));
});

test('rejects a supervisor sample that has the right PID but the wrong server start identity', () => {
  const { record, observerRecords } = evidence();
  observerRecords[2].supervisor.start_identity = 'Wed Oct 14 09:01:00 2026';
  const result = verifyCase6Evidence(record, observerRecords);
  assert.equal(result.accepted, false);
  assert.equal(result.coherent_closure, null);
});
