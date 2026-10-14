import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exactToolCatalog,
  observerClosureFromRecords,
  observerGateFromRecords,
  projectWorkerDiagnostics,
} from './official-disconnect.mjs';

const runId = '8e9d6a96-4ba1-4f9e-a35f-09b3b1322df3';
const serverPid = 200;
const runStartedAt = '2026-10-14T10:00:00.000Z';
const catalog = ['vibe_review_start', 'vibe_edit_start', 'vibe_status', 'vibe_result', 'vibe_close'];

function observerStart() {
  return {
    type: 'observer_started', schema_version: 1, started_at: '2026-10-14T09:59:59.000Z',
    observer: { pid: 300, ppid: 100, pgid: 300, state: 'Ss', comm: 'node', lstart: 'Wed Oct 14 12:00:00 2026' },
    observer_ancestry: [300, 100, 1], supervisor_pid: serverPid,
    supervisor_start_identity: 'Wed Oct 14 12:00:00 2026', interval_ms: 250, max_seconds: 220,
  };
}

function runningSample(sequence, { alive = true, runState = 'running', timestamp = '2026-10-14T10:00:01.000Z' } = {}) {
  return {
    type: 'sample', sequence, timestamp,
    supervisor: { pid: serverPid, start_identity: 'Wed Oct 14 12:00:00 2026', alive, pgid: serverPid, state: 'S', comm: 'node' },
    owned_descendants: [{ first_observed: { pid: 210, pgid: 210 }, alive }],
    process_groups: [{ pgid: serverPid, members: [{ pid: serverPid }], first_observed_at: runStartedAt, present: true }],
    lock: 'present', runs: [{ run_id: runId, state: runState, backend: 'programmatic', mode: 'edit' }],
  };
}

function closedSample(sequence, { lock = 'absent', groupPresent = false, runState = 'failed', alive = false } = {}) {
  return {
    type: 'sample', sequence, timestamp: '2026-10-14T10:00:04.000Z',
    supervisor: { pid: serverPid, start_identity: 'Wed Oct 14 12:00:00 2026', alive },
    owned_descendants: [{ first_observed: { pid: 210, pgid: 210 }, alive }],
    process_groups: [
      { pgid: serverPid, members: groupPresent ? [{ pid: serverPid }] : [], first_observed_at: runStartedAt, present: groupPresent },
      { pgid: 210, members: [], first_observed_at: runStartedAt, present: false },
    ],
    lock, runs: [{ run_id: runId, state: runState, backend: 'programmatic', mode: 'edit' }],
  };
}

test('projects the candidate worker-diagnostics stage field and metadata-only calls', () => {
  const projected = projectWorkerDiagnostics({
    schema_version: 1,
    stages: [{ stage: 'launch', elapsed_ms: 0 }, { stage: 'entrypoint_invocation', elapsed_ms: 51 }, { name: 'misleading-name' }],
    tool_inventory: ['read_file', 'grep'],
    tool_calls: [{ tool: 'read_file', outcome: 'completed' }, { tool: 'write_file', outcome: 'attempt', path: '/must/not/escape' }],
    tool_inventory_truncated: false,
    tool_calls_truncated: false,
  });
  assert.deepEqual(projected.stages, ['launch', 'entrypoint_invocation']);
  assert.deepEqual(projected.tool_calls, [{ tool: 'read_file', outcome: 'completed' }, { tool: 'write_file', outcome: 'attempt' }]);
  assert.equal(projected.stages.includes('misleading-name'), false);
  assert.equal(projectWorkerDiagnostics({ schema_version: 1, stages: [], tool_inventory: [], tool_calls: [] }).stages.includes('entrypoint_invocation'), false);
});

test('requires the exact five-tool candidate catalog', () => {
  assert.equal(exactToolCatalog(catalog.map((name) => ({ name })).reverse()), true);
  assert.equal(exactToolCatalog(catalog.slice(0, 4).map((name) => ({ name }))), false);
  assert.equal(exactToolCatalog([...catalog, 'vibe_cancel'].map((name) => ({ name }))), false);
  assert.equal(exactToolCatalog([...catalog.slice(1), catalog[1]].map((name) => ({ name }))), false);
});

test('uses the latest same-run observer sample and recognizes a detached sibling observer', () => {
  const records = [observerStart(), runningSample(1, { timestamp: '2026-10-14T10:00:01.000Z' }),
    runningSample(2, { alive: false, timestamp: '2026-10-14T10:00:01.100Z' })];
  const now = Date.parse('2026-10-14T10:00:01.200Z');
  assert.equal(observerGateFromRecords(records, serverPid, runId, { now, runStartedAt }).confirmed, false, 'must not accept an earlier live sample when the latest is dead');

  records.push(runningSample(3, { timestamp: '2026-10-14T10:00:01.150Z' }));
  const gate = observerGateFromRecords(records, serverPid, runId, { now, runStartedAt });
  assert.equal(gate.confirmed, true);
  assert.equal(gate.sequence, 3);
  assert.equal(gate.fresh, true);
  assert.equal(gate.observer_detached_process_group, true);
  assert.equal(gate.independent_from_server, true);
});

test('requires one coherent final observer sample for exit, lock, groups and failed run', () => {
  const records = [observerStart(), runningSample(1), closedSample(2, { lock: 'present' }), closedSample(3, { groupPresent: true }), closedSample(4, { runState: 'running' })];
  const closeAt = '2026-10-14T10:00:02.000Z';
  const partial = observerClosureFromRecords(records, serverPid, runId, runStartedAt, closeAt);
  assert.equal(partial.supervisor_gone, false, 'must not combine separate partial samples');

  records.push(closedSample(5));
  const closure = observerClosureFromRecords(records, serverPid, runId, runStartedAt, closeAt);
  assert.equal(closure.observer_started_before_run, true);
  assert.equal(closure.independent_observer, true);
  assert.equal(closure.observer_controller_pid, 100, 'controller parentage is reported transparently');
  assert.equal(closure.owned_worker_seen_alive, true);
  assert.equal(closure.pre_disconnect_sample_sequence, 1);
  assert.equal(closure.supervisor_gone, true);
  assert.equal(closure.lock_released, true);
  assert.equal(closure.owned_process_groups_gone, true);
  assert.equal(closure.observed_run_state, 'failed');
  assert.equal(closure.coherent_sample_sequence, 5);
});
