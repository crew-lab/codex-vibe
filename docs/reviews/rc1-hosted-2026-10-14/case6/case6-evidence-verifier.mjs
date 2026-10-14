#!/usr/bin/env node

// Offline-only verifier for an already completed case 6. It never launches a
// supervisor, MCP client, or hosted task; it reads only the saved report and
// independent observer JSONL.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isoMs = (value) => {
  if (typeof value !== 'string') return Number.NaN;
  return Date.parse(value);
};
const identityKey = (item) => Number.isSafeInteger(item?.pid) && typeof item?.lstart === 'string' && item.lstart
  ? `${item.pid}:${item.lstart}` : null;
const runEntry = (sample, runId) => sample?.runs?.find((run) => run.run_id === runId);

function parseObserver(raw) {
  return raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`invalid observer JSON at line ${index + 1}`); }
  });
}

export function verifyCase6Evidence(record, observerRecords) {
  const failures = [];
  const require = (condition, reason) => { if (!condition) failures.push(reason); };
  const runId = record?.run_id;
  const serverPid = record?.server_pid;
  const timestamps = record?.timestamps ?? {};
  const closeMs = isoMs(timestamps.client_close);
  const startMs = isoMs(timestamps.start);
  const observerStart = observerRecords.find((item) => item?.type === 'observer_started');
  const expectedServerStart = observerStart?.supervisor_start_identity;
  const samples = observerRecords.filter((item) => item?.type === 'sample');

  require(record?.case === 6 && record?.operation === 'edit', 'wrong-case-or-operation');
  require(typeof runId === 'string' && runId.length > 0, 'missing-run-id');
  require(Number.isSafeInteger(serverPid) && serverPid > 0, 'missing-server-pid');
  require(Number.isFinite(startMs) && Number.isFinite(closeMs) && closeMs >= startMs, 'invalid-run-or-close-timestamps');
  require(typeof expectedServerStart === 'string' && expectedServerStart.length > 0, 'missing-observer-server-start-identity');
  require(observerStart?.supervisor_pid === serverPid, 'observer-server-pid-mismatch');
  require(record?.observer?.started === true, 'observer-not-reported-started');
  require(typeof record?.observer?.pid === 'number' && observerStart?.observer?.pid === record.observer.pid, 'observer-pid-mismatch');

  const completedReads = record?.worker_diagnostics?.tool_calls?.filter((call) => call?.tool === 'read_file' && call?.outcome === 'completed').length ?? 0;
  require(record?.active_worker_confirmed === true && record?.state_before_disconnect === 'running', 'client-did-not-confirm-active-worker-before-close');
  require(Number.isSafeInteger(record?.completed_read_count_before_disconnect) && record.completed_read_count_before_disconnect > 0
    && completedReads >= record.completed_read_count_before_disconnect, 'completed-read-evidence-missing');
  require(record?.worker_diagnostics?.stages?.includes('entrypoint_invocation') === true, 'worker-entrypoint-evidence-missing');
  require(record?.no_replay_confirmed === true && record?.state_after_reconnect === 'failed'
    && record?.error_code_after_reconnect === 'VSUP_BACKEND_CRASHED' && record?.retryable_after_reconnect === false,
  'no-replay-reconnect-evidence-missing');
  require(record?.server_exited === true, 'client-did-not-observe-server-exit');

  const precloseCandidates = samples.filter((sample) => {
    const at = isoMs(sample.timestamp);
    return Number.isFinite(at) && at >= startMs && at < closeMs
      && sample.supervisor?.pid === serverPid && sample.supervisor?.start_identity === expectedServerStart
      && sample.supervisor?.alive === true
      && sample.owned_descendants?.some((child) => child?.alive === true)
      && runEntry(sample, runId)?.state === 'running';
  });
  const reportedPreclose = record?.pre_disconnect_observer_confirmation;
  require(precloseCandidates.length > 0, 'observer-did-not-confirm-active-worker-before-close');
  require(reportedPreclose?.confirmed === true
    && precloseCandidates.some((sample) => sample.sequence === reportedPreclose.sequence
      && sample.timestamp === reportedPreclose.timestamp), 'client-active-sample-not-correlated-to-observer');

  // Require all group IDs and owned process identities seen during this run to
  // be accounted for in one post-close sample. The controller's inherited
  // group is intentionally required to empty after the controller exits.
  const knownGroupIds = new Set();
  const knownChildIdentities = new Set();
  for (const sample of samples) {
    const at = isoMs(sample.timestamp);
    if (!Number.isFinite(at) || at < startMs) continue;
    for (const group of sample.process_groups ?? []) if (Number.isSafeInteger(group?.pgid)) knownGroupIds.add(group.pgid);
    for (const child of sample.owned_descendants ?? []) {
      const key = identityKey(child?.first_observed);
      if (key) knownChildIdentities.add(key);
    }
  }
  require(knownGroupIds.size > 0, 'no-owned-process-groups-observed');
  require(knownChildIdentities.size > 0, 'no-owned-descendant-identity-observed');

  const closureCandidates = samples.filter((sample) => {
    const at = isoMs(sample.timestamp);
    return Number.isFinite(at) && at >= closeMs
      && sample.supervisor?.pid === serverPid
      && sample.supervisor?.start_identity === expectedServerStart
      && sample.supervisor?.alive === false
      && sample.lock === 'absent'
      && runEntry(sample, runId)?.state === 'failed';
  });
  const coherent = closureCandidates.find((sample) => {
    const groups = sample.process_groups;
    if (!Array.isArray(groups) || groups.length !== knownGroupIds.size) return false;
    const groupById = new Map(groups.map((group) => [group?.pgid, group]));
    if (groupById.size !== groups.length) return false;
    for (const pgid of knownGroupIds) {
      const group = groupById.get(pgid);
      if (!group || group.present !== false || !Array.isArray(group.members) || group.members.length !== 0) return false;
    }
    const children = sample.owned_descendants;
    if (!Array.isArray(children)) return false;
    const childByIdentity = new Map(children.map((child) => [identityKey(child?.first_observed), child]));
    if (childByIdentity.size !== children.length) return false;
    for (const key of knownChildIdentities) {
      const child = childByIdentity.get(key);
      if (!child || child.alive !== false) return false;
    }
    return true;
  });

  require(Boolean(coherent), 'no-coherent-post-close-closure-sample');
  const result = {
    schema_version: 1,
    verifier: 'offline_case6_post_helper_exit_evidence',
    run_id: runId ?? null,
    raw_runner_verdict: record?.verdict ?? null,
    raw_runner_record_preserved: true,
    hosted_inference_started: false,
    accepted: failures.length === 0,
    classification: failures.length === 0 ? 'POST_EXIT_EVIDENCE_ACCEPTED; raw runner verdict remains unchanged' : 'EVIDENCE_INSUFFICIENT',
    active_before_close: precloseCandidates.length > 0,
    no_replay_confirmed: record?.no_replay_confirmed === true,
    expected_supervisor_start_identity: expectedServerStart ?? null,
    known_owned_process_identity_count: knownChildIdentities.size,
    known_process_group_count: knownGroupIds.size,
    coherent_closure: coherent ? {
      sequence: coherent.sequence,
      timestamp: coherent.timestamp,
      supervisor_pid: coherent.supervisor.pid,
      supervisor_start_identity: coherent.supervisor.start_identity,
      lock: coherent.lock,
      run_state: runEntry(coherent, runId)?.state,
      group_ids: [...knownGroupIds].sort((a, b) => a - b),
      group_member_counts: coherent.process_groups.map((group) => ({ pgid: group.pgid, count: group.members.length })),
    } : null,
    failures,
  };
  return result;
}

async function main(args) {
  if (args.length !== 4 || args[0] !== '--record' || !args[1] || args[2] !== '--observer' || !args[3]) {
    throw new Error('usage: node case6-evidence-verifier.mjs --record <case6-json> --observer <observer-jsonl>');
  }
  const [recordPath, observerPath] = [args[1], args[3]].map((value) => path.resolve(value));
  const [recordBytes, observerBytes] = await Promise.all([readFile(recordPath, 'utf8'), readFile(observerPath, 'utf8')]);
  const assessment = verifyCase6Evidence(JSON.parse(recordBytes), parseObserver(observerBytes));
  assessment.evidence = {
    runner_record: path.basename(recordPath),
    runner_record_sha256: createHash('sha256').update(recordBytes).digest('hex'),
    observer_log: path.basename(observerPath),
    observer_log_sha256: createHash('sha256').update(observerBytes).digest('hex'),
  };
  process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
  if (!assessment.accepted) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`case6-evidence-verifier: ${error instanceof Error ? error.message : 'invalid evidence'}\n`);
    process.exitCode = 1;
  }
}
