import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, RunState, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { SCHEMA_VERSION } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { eventToWire, runToWire } from '../../src/core/serialization.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) for (const run of await readdir(path.join(root, 'data', 'runs')).catch(() => [] as string[])) await chmod(path.join(root, 'data', 'runs', run, 'events.ndjson'), 0o600).catch(() => undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, _callbacks: BackendCallbacks): Promise<BackendStartResult> { return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' }; }
  async cancel(_handle: BackendRunHandle) {}
  async close(_handle: BackendRunHandle) {}
}

const DAY = 86_400_000;
type Cause = 'malformed' | 'unreadable' | 'oversized';
const causes: Cause[] = ['malformed', 'unreadable', 'oversized'];

function validLine(runId: string, seq: number): string {
  return JSON.stringify(eventToWire({ schemaVersion: SCHEMA_VERSION, seq, timestamp: '2026-01-01T00:00:00.000Z', runId, backend: 'programmatic', source: 'vibe', type: 'tool_call', severity: 'info', data: { title: `call ${seq}` } }));
}

async function seedBroken(cause: Cause, state: RunState, ageDays = 0) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-unreadable-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source); await mkdir(path.join(data, 'runs'), { recursive: true, mode: 0o700 });
  const runId = randomUUID();
  const updated = new Date(Date.now() - ageDays * DAY).toISOString();
  const maxEventBytes = cause === 'oversized' ? 1000 : DEFAULT_CONFIG.limits.maxEventBytes;
  const record: RunRecord = {
    schemaVersion: SCHEMA_VERSION, runId, backend: 'programmatic', mode: 'review', state, sourceWorkspace: source, workerWorkspace: source,
    createdAt: updated, updatedAt: updated, finishedAt: updated, taskSha256: 'a'.repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes, maxTranscriptBytes: DEFAULT_CONFIG.limits.maxTranscriptBytes, maxArtifactBytes: DEFAULT_CONFIG.limits.maxArtifactBytes }
  };
  const directory = path.join(data, 'runs', runId);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(path.join(directory, 'meta.json'), `${JSON.stringify(runToWire(record), null, 2)}\n`, { mode: 0o600 });
  const body = cause === 'malformed' ? `${validLine(runId, 1)}\n{"not valid json\n${validLine(runId, 2)}\n` : `${Array.from({ length: 30 }, (_, index) => validLine(runId, index + 1)).join('\n')}\n`;
  const events = path.join(directory, 'events.ndjson');
  await writeFile(events, body, { mode: 0o600 });
  if (cause === 'unreadable') await chmod(events, 0o000);
  const before = cause === 'unreadable' ? undefined : await readFile(events);
  return { source, data, runId, directory, events, before, config: { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] } };
}

const exists = (file: string) => stat(file).then(() => true, () => false);

describe.each(causes)('a run whose event log is %s', (cause) => {
  it('gives status and result a coded error', async () => {
    const { config, data, runId } = await seedBroken(cause, 'completed');
    const manager = new RunManager(config, data, [new FakeBackend()]);
    try {
      await manager.initialize();
      const expected = cause === 'unreadable' ? 'VSUP_STORAGE_ERROR' : 'VSUP_ARTIFACT_ERROR';
      await expect(manager.status({ run_id: runId })).rejects.toMatchObject({ code: expected, message: expect.stringMatching(/event log/i) });
      await expect(manager.result({ run_id: runId })).rejects.toMatchObject({ code: expected });
    } finally { await manager.shutdown(); }
  });

  it('can still be closed without touching the unreadable file', async () => {
    const { config, data, runId, events, before } = await seedBroken(cause, 'completed');
    const manager = new RunManager(config, data, [new FakeBackend()]);
    try {
      await manager.initialize();
      await expect(manager.close({ run_id: runId })).resolves.toMatchObject({ state: 'closed' });
      if (before) expect(Buffer.compare(await readFile(events).catch(() => Buffer.alloc(0)), before)).toBe(0);
      else expect((await stat(events)).mode & 0o777).toBe(0);
    } finally { await manager.shutdown(); }
  });

  it('can still be closed while recoverable', async () => {
    const { config, data, runId, events, before } = await seedBroken(cause, 'running');
    const manager = new RunManager(config, data, [new FakeBackend()]);
    try {
      await manager.initialize();
      await expect(manager.close({ run_id: runId })).resolves.toMatchObject({ state: 'closed' });
      if (before) expect(Buffer.compare(await readFile(events), before)).toBe(0);
    } finally { await manager.shutdown(); }
  });

  it('is removed by the automatic sweep once past retention', async () => {
    const { config, data, runId, directory } = await seedBroken(cause, 'completed', 30);
    const manager = new RunManager(config, data, [new FakeBackend()]);
    try {
      await manager.initialize();
      manager.startAutomaticRetention({ firstDelayMs: 10, intervalMs: 60_000 });
      for (let attempt = 0; attempt < 300 && await exists(directory); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await exists(directory)).toBe(false);
      await expect(manager.status({ run_id: runId })).rejects.toMatchObject({ code: 'VSUP_NOT_FOUND' });
    } finally { await manager.shutdown(); }
  });
});
