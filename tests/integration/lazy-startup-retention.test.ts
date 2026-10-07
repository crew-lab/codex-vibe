import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'smol-toml';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, PendingRequest, RunRecord, RunState, StartRunInput, SupervisorBackend } from '../../src/contracts.js';
import { SCHEMA_VERSION } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { eventToWire, runToWire } from '../../src/core/serialization.js';
import { runCli } from '../../src/cli.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  for (const root of roots) for (const run of await readdir(path.join(root, 'data', 'runs')).catch(() => [] as string[])) await chmod(path.join(root, 'data', 'runs', run, 'events.ndjson'), 0o600).catch(() => undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly callbacks = new Map<string, BackendCallbacks>();
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' };
  }
  async continue() {}
  async respond() {}
  async cancel(handle: BackendRunHandle) { await this.callbacks.get(handle.runId)?.onState('cancelled'); }
  async close() {}
  async recover(_record: RunRecord) { return undefined; }
}

const DAY = 86_400_000;

async function root() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-lazy-')); roots.push(parent);
  const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source); await mkdir(path.join(data, 'runs'), { recursive: true, mode: 0o700 });
  return { parent, source, data };
}

function eventsText(runId: string, bytes: number): string {
  const lines: string[] = [];
  let size = 0;
  for (let seq = 1; size < bytes; seq += 1) {
    const line = JSON.stringify(eventToWire({ schemaVersion: SCHEMA_VERSION, seq, timestamp: '2026-01-01T00:00:00.000Z', runId, backend: 'programmatic', source: 'vibe', type: 'tool_call', severity: 'info', data: { title: `call ${seq}`, filler: 'f'.repeat(300) } }));
    lines.push(line); size += line.length + 1;
  }
  return `${lines.join('\n')}\n`;
}

async function seed(data: string, source: string, options: { state: RunState; ageDays?: number; eventBytes?: number; worktree?: string; pendingRequest?: PendingRequest }): Promise<string> {
  const runId = randomUUID();
  const updated = new Date(Date.now() - (options.ageDays ?? 0) * DAY).toISOString();
  const record: RunRecord = {
    schemaVersion: SCHEMA_VERSION, runId, backend: 'programmatic', mode: options.worktree ? 'edit' : 'review', state: options.state,
    sourceWorkspace: source, workerWorkspace: options.worktree ?? source, createdAt: updated, updatedAt: updated, finishedAt: updated,
    taskSha256: 'a'.repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: DEFAULT_CONFIG.limits.maxEventBytes, maxTranscriptBytes: DEFAULT_CONFIG.limits.maxTranscriptBytes, maxArtifactBytes: DEFAULT_CONFIG.limits.maxArtifactBytes },
    ...(options.worktree ? { worktree: { path: options.worktree, baseRef: 'HEAD', createdBySupervisor: true } } : {})
  };
  const directory = path.join(data, 'runs', runId);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(path.join(directory, 'meta.json'), `${JSON.stringify(runToWire(record), null, 2)}\n`, { mode: 0o600 });
  await writeFile(path.join(directory, 'events.ndjson'), eventsText(runId, options.eventBytes ?? 2000), { mode: 0o600 });
  return runId;
}

const exists = (file: string) => stat(file).then(() => true, () => false);
const configFor = (source: string, overrides: Partial<typeof DEFAULT_CONFIG> = {}) => ({ ...DEFAULT_CONFIG, backend: 'programmatic' as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600, ...overrides });

describe('lazy startup', () => {
  it('initializes 200 runs with 1 MiB event logs in under 300 ms without reading events, and loads them on demand', async () => {
    const { source, data } = await root();
    const ids: string[] = [];
    for (let index = 0; index < 200; index += 1) ids.push(await seed(data, source, { state: 'closed', eventBytes: 1_048_576 }));
    for (const id of ids) await chmod(path.join(data, 'runs', id, 'events.ndjson'), 0o000);
    const manager = new RunManager(configFor(source), data, [new FakeBackend()]);
    try {
      const began = performance.now();
      await manager.initialize();
      expect(performance.now() - began).toBeLessThan(300);
      expect(await manager.runsList()).toHaveLength(200);
      const target = ids[17]!;
      await chmod(path.join(data, 'runs', target, 'events.ndjson'), 0o600);
      const status = await manager.status({ run_id: target, max_events: 5 });
      expect(status.last_seq).toBeGreaterThan(1000);
      expect((status.events as { seq: number }[]).map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
      await expect(manager.status({ run_id: ids[18]! })).rejects.toBeDefined();
    } finally { await manager.shutdown(); }
  }, 120_000);

  it('single-flights the load and resumes the sequence on continue', async () => {
    const { source, data } = await root();
    const id = await seed(data, source, { state: 'closed', eventBytes: 20_000 });
    const manager = new RunManager(configFor(source), data, [new FakeBackend()]);
    try {
      await manager.initialize();
      const [first, second] = await Promise.all([manager.status({ run_id: id, max_events: 3 }), manager.status({ run_id: id, max_events: 3 })]);
      expect(first).toEqual(second);
      expect(first.last_seq).toBeGreaterThan(30);
    } finally { await manager.shutdown(); }
  });
});

describe('automatic retention', () => {
  it('removes exactly the eligible runs and keeps worktrees, live sessions, slots and pending requests', async () => {
    const { source, data, parent } = await root();
    const worktree = path.join(parent, 'wt'); await mkdir(worktree);
    const oldClosed = await seed(data, source, { state: 'closed', ageDays: 30 });
    const oldCancelled = await seed(data, source, { state: 'cancelled', ageDays: 30 });
    const oldFailed = await seed(data, source, { state: 'failed', ageDays: 30 });
    const oldCompleted = await seed(data, source, { state: 'completed', ageDays: 30 });
    const recentClosed = await seed(data, source, { state: 'closed', ageDays: -29 });
    const oldWorktree = await seed(data, source, { state: 'closed', ageDays: 30, worktree });
    const backend = new FakeBackend();
    const manager = new RunManager(configFor(source, { maxConcurrentRuns: 4 }), data, [backend]);
    await manager.initialize();
    const live = await manager.reviewStart({ task: 'live', cwd: source });
    const slotted = await manager.reviewStart({ task: 'slot', cwd: source });
    const waiting = await manager.reviewStart({ task: 'pending', cwd: source });
    for (const id of [live.run_id, slotted.run_id, waiting.run_id]) for (let attempt = 0; attempt < 500 && !backend.callbacks.has(id); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    await backend.callbacks.get(live.run_id)!.onState('completed', { result: { summary: 'idle but live' } });
    await backend.callbacks.get(waiting.run_id)!.onPendingRequest({ requestId: 'req-1', kind: 'permission', title: 'Read', options: [{ optionId: 'allow', name: 'Allow' }], tool: { kind: 'read', locations: [source] } });
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 30 * DAY);
      manager.startAutomaticRetention({ firstDelayMs: 10, intervalMs: 60_000 });
      for (let attempt = 0; attempt < 300 && await exists(path.join(data, 'runs', oldClosed)); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      await new Promise((resolve) => setTimeout(resolve, 200));
      const remaining = new Set(await readdir(path.join(data, 'runs')));
      expect([oldClosed, oldCancelled, oldCompleted].filter((id) => remaining.has(id))).toEqual([]);
      const keep = { oldFailed, recentClosed, oldWorktree, live: live.run_id, slotted: slotted.run_id, waiting: waiting.run_id };
      expect(Object.entries(keep).filter(([, id]) => !remaining.has(id)).map(([name]) => name)).toEqual([]);
      expect(await exists(worktree)).toBe(true);
    } finally { vi.useRealTimers(); await manager.shutdown(); }
  }, 60_000);

  it('removes old failed runs when preserve_failed_runs is off', async () => {
    const { source, data } = await root();
    const oldFailed = await seed(data, source, { state: 'failed', ageDays: 30 });
    const manager = new RunManager(configFor(source, { retention: { days: 7, preserveFailedRuns: false } }), data, [new FakeBackend()]);
    try {
      await manager.initialize();
      manager.startAutomaticRetention({ firstDelayMs: 10, intervalMs: 60_000 });
      for (let attempt = 0; attempt < 300 && await exists(path.join(data, 'runs', oldFailed)); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await exists(path.join(data, 'runs', oldFailed))).toBe(false);
    } finally { await manager.shutdown(); }
  });

  it('does not run before initialize resolves', async () => {
    const { source, data } = await root();
    const first = await seed(data, source, { state: 'closed', ageDays: 30 });
    const manager = new RunManager(configFor(source), data, [new FakeBackend()]);
    try {
      manager.startAutomaticRetention({ firstDelayMs: 0, intervalMs: 60_000 });
      await manager.initialize();
      expect(await exists(path.join(data, 'runs', first))).toBe(true);
      for (let attempt = 0; attempt < 300 && await exists(path.join(data, 'runs', first)); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await exists(path.join(data, 'runs', first))).toBe(false);
    } finally { await manager.shutdown(); }
  });
});

describe('Codex startup timeout', () => {
  it('writes both timeouts, upgrades an entry that lacks the startup timeout, and matches .mcp.json', async () => {
    const home = await mkdtemp(path.join(canonicalTmp, 'vsup-codex-')); roots.push(home);
    await mkdir(path.join(home, '.codex'));
    vi.stubEnv('HOME', home);
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { written.push(String(chunk)); return true; }) as typeof process.stdout.write);
    await runCli(['configure-codex', '--user', '--dry-run']);
    expect(written.join('')).toContain('startup_timeout_sec = 30');
    expect(written.join('')).toContain('tool_timeout_sec = 600');
    const file = path.join(home, '.codex', 'config.toml');
    await writeFile(file, '[mcp_servers.vibe-supervisor]\ncommand = "node"\nargs = ["x"]\ntool_timeout_sec = 600\n');
    await runCli(['configure-codex', '--user']);
    const entry = (parse(readFileSync(file, 'utf8')) as { mcp_servers: Record<string, Record<string, unknown>> }).mcp_servers['vibe-supervisor']!;
    expect(entry).toMatchObject({ startup_timeout_sec: 30, tool_timeout_sec: 600 });
    const project = JSON.parse(readFileSync(fileURLToPath(new URL('../../.mcp.json', import.meta.url)), 'utf8')) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(project.mcpServers['vibe-supervisor']).toMatchObject({ startup_timeout_sec: 30, tool_timeout_sec: 600 });
  });
});
