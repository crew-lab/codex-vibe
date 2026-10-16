import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RunRecord } from '../../src/contracts.js';
import { acceptanceContractSchema, contractDigest } from '../../src/acceptance/schema.js';
import type { Assessment } from '../../src/acceptance/schema.js';
import { runToWire } from '../../src/core/serialization.js';
import { runsUsefulness } from '../../src/cli/runs/usefulness.js';

const HASH = 'ab'.repeat(32);
const PATCH = 'cd'.repeat(32);
const contract = acceptanceContractSchema.parse({ schema_version: 1, allowed_changed_paths: ['page.txt'], checks: [{ id: 'exists', kind: 'file_exists', path: 'page.txt' }] });

const ids = {
  accepted: '11111111-1111-4111-8111-111111111111',
  rejected: '22222222-2222-4222-8222-222222222222',
  open: '33333333-3333-4333-8333-333333333333',
  stale: '44444444-4444-4444-8444-444444444444',
  review: '55555555-5555-4555-8555-555555555555',
  deferred: '66666666-6666-4666-8666-666666666666',
  older: '77777777-7777-4777-8777-777777777777',
  running: '88888888-8888-4888-8888-888888888888',
  broken: '99999999-9999-4999-8999-999999999999'
};

function assessment(decision: Assessment['decision'], reason: string, overrides: Partial<Assessment> = {}): Assessment {
  return { decision, reason, patch_sha256: PATCH, contract_sha256: contractDigest(contract), validations: [], assessed_at: '2026-11-03T10:12:44.120Z', ...overrides };
}

function record(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schemaVersion: 1, supervisorVersion: '2.1.0', runId, backend: 'app-server', mode: 'edit', state: 'completed', executionState: 'completed',
    sourceWorkspace: '/work/project', workerWorkspace: '/work/project', createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:02:00.000Z',
    startedAt: '2026-11-03T10:00:02.000Z', finishedAt: '2026-11-03T10:01:06.000Z', taskSha256: HASH,
    acceptanceContract: contract,
    limits: { timeoutSeconds: 180, maxTurns: 12, maxEventBytes: 52428800, maxTranscriptBytes: 10485760, maxArtifactBytes: 104857600 },
    usage: { tokensUsed: 41200, modelCalls: 9, cost: { amount: 0.031, currency: 'USD', authoritative: false } },
    result: { stopReason: 'end_turn', changedFiles: ['page.txt'], artifacts: [{ name: 'diff.patch', path: '/data/diff.patch', sha256: PATCH, bytes: 10, mediaType: 'text/x-diff' }] },
    ...overrides
  };
}

describe('runs usefulness', () => {
  const roots: string[] = [];
  const written: string[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { written.push(String(chunk)); return true; }) as typeof process.stdout.write);
  });
  afterEach(async () => {
    writeSpy.mockRestore(); written.length = 0; process.exitCode = undefined;
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function dataRoot(): Promise<{ data: string; config: string }> {
    const data = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-useful-'))); roots.push(data);
    const config = path.join(data, 'config.toml');
    await writeFile(config, 'version = 1\nallowed_workspace_roots = []\n', { mode: 0o600 });
    return { data, config };
  }

  async function save(home: string, wire: unknown, runId: string): Promise<void> {
    const directory = path.join(home, 'runs', runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, 'meta.json'), typeof wire === 'string' ? wire : JSON.stringify(wire), { mode: 0o600 });
  }

  async function fixture(): Promise<string> {
    const { data, config } = await dataRoot();
    const session = path.join(data, 'mcp-sessions', 'session-Ab12Cd');
    await mkdir(session, { recursive: true, mode: 0o700 });
    await save(data, runToWire(record(ids.accepted, { assessments: [assessment('accepted', 'parser cases checked | independently')] })), ids.accepted);
    await save(session, runToWire(record(ids.rejected, { createdAt: '2026-11-04T09:00:00.000Z', assessments: [assessment('accepted', 'first look'), assessment('rejected', 'missed the edge case')] })), ids.rejected);
    await save(data, runToWire(record(ids.open, { createdAt: '2026-11-05T09:00:00.000Z' })), ids.open);
    await save(data, runToWire(record(ids.stale, { createdAt: '2026-11-06T09:00:00.000Z', assessments: [assessment('accepted', 'bound to an older patch', { patch_sha256: HASH })] })), ids.stale);
    await save(session, runToWire(record(ids.review, { mode: 'review', createdAt: '2026-11-07T09:00:00.000Z', state: 'closed' })), ids.review);
    await save(data, runToWire(record(ids.deferred, { createdAt: '2026-11-08T09:00:00.000Z', assessments: [assessment('deferred', 'waiting for the owner')] })), ids.deferred);
    await save(data, runToWire(record(ids.older, { createdAt: '2026-10-01T09:00:00.000Z', assessments: [assessment('accepted', 'before the window')] })), ids.older);
    await save(data, runToWire(record(ids.running, { state: 'running', createdAt: '2026-11-09T09:00:00.000Z' })), ids.running);
    await save(data, '{ not json', ids.broken);
    return config;
  }

  function invocation(configPath: string, ...flags: string[]) {
    return { subcommand: 'usefulness', positional: ['usefulness', ...flags], configPath, services: { cleanup: async () => undefined } };
  }

  it('prints the log rows and a summary over recorded assessments, including isolated sessions', async () => {
    const config = await fixture();
    await runsUsefulness(invocation(config));
    expect(written.join('')).toBe([
      '| 2026-10-01 | 2.1.0 | `77777777` | edit, 1 contract check, 1 changed file | max_turns 12, end_turn, 64 s, 41,200 tokens, 9 model calls, about 0.03 USD | Yes | before the window |',
      '| 2026-11-03 | 2.1.0 | `11111111` | edit, 1 contract check, 1 changed file | max_turns 12, end_turn, 64 s, 41,200 tokens, 9 model calls, about 0.03 USD | Yes | parser cases checked \\| independently |',
      '| 2026-11-04 | 2.1.0 | `22222222` | edit, 1 contract check, 1 changed file | max_turns 12, end_turn, 64 s, 41,200 tokens, 9 model calls, about 0.03 USD | No | missed the edge case |',
      'Accepted 2 of 3 edit runs with a decision (67%), rejected 1; 2 settled edit runs without a decision; 1 deferred; 1 assessment ignored for not matching the saved contract and patch; 1 review not assessable (review); 1 run record unreadable.',
      ''
    ].join('\n'));
  });

  it('filters by creation date with --since and states the window', async () => {
    const config = await fixture();
    await runsUsefulness(invocation(config, '--since', '2026-11-01'));
    const text = written.join('');
    expect(text).not.toContain('77777777');
    expect(text).toContain('Accepted 1 of 2 edit runs with a decision since 2026-11-01 (50%), rejected 1;');
  });

  it('prints one JSON object per line with --json', async () => {
    const config = await fixture();
    await runsUsefulness(invocation(config, '--json'));
    const lines = written.join('').trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line.kind)).toEqual(['row', 'row', 'row', 'summary']);
    expect(lines[2]).toMatchObject({ run_id: ids.rejected, accepted: false, reason: 'missed the edge case', supervisor_version: '2.1.0' });
    expect(lines[3]).toEqual({
      kind: 'summary', since: null, accepted: 2, rejected: 1, deferred: 1, unassessed: 2, not_assessable_review: 1, unbound_assessments: 1, unreadable: 1, acceptance_rate: 2 / 3
    });
  });

  it('reports a null rate when no run has a decision', async () => {
    const { data, config } = await dataRoot();
    await save(data, runToWire(record(ids.open)), ids.open);
    await runsUsefulness(invocation(config, '--json'));
    expect(JSON.parse(written.join('').trim())).toMatchObject({ kind: 'summary', accepted: 0, rejected: 0, unassessed: 1, acceptance_rate: null });
    written.length = 0;
    await runsUsefulness(invocation(config));
    expect(written.join('')).toBe('No edit runs with a decision; 1 settled edit run without a decision; 0 reviews not assessable (review).\n');
  });

  it('rejects bad options with the usage exit code', async () => {
    const { config } = await dataRoot();
    for (const flags of [['--since'], ['--since', '2026-02-30'], ['--json', '--json'], ['--bogus']]) {
      process.exitCode = undefined;
      await expect(runsUsefulness(invocation(config, ...flags))).rejects.toThrow();
      expect(process.exitCode).toBe(2);
    }
  });
});
