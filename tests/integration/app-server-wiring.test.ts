import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppServerBackend, type AppServerBackendOptions } from '../../src/backends/app-server.js';
import { ResolvedCredential, type CredentialResolution } from '../../src/backends/app-server/credentials.js';
import { PinCheckError, generatePinManifest, parsePinManifest, serializePinManifest } from '../../src/backends/app-server/pin.js';
import { PROFILE_TOOLS, TOOL_PERMISSION, workspaceDenylist } from '../../src/backends/app-server/session-config.js';
import { runCli } from '../../src/cli.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend, SupervisorConfig } from '../../src/contracts.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runToWire } from '../../src/core/serialization.js';
import { runDoctor } from '../../src/diagnostics/doctor.js';
import { createSupervisorMcpServer } from '../../src/mcp/server.js';
import { makeFakeVibeEnvironment } from '../unit/support/fake-vibe-environment.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const fixture = path.join(repoRoot, 'tests', 'fixtures', 'fake-vibe-app-server.mjs');
const scenarioDirectory = path.join(repoRoot, 'tests', 'fixtures', 'app-server-scenarios');
const SECRET = 'wiring-credential-abcdefghijklmnop';
const TIMING = { interruptGraceMs: 300, stdinGraceMs: 300, terminateGraceMs: 300, interruptTimeoutMs: 500, statsThrottleMs: 0 };

const scratchDirectories: string[] = [];
const managers: RunManager[] = [];
const clients: Client[] = [];

function scratch(): string {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'vsup-wiring-')));
  scratchDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown().catch(() => undefined)));
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class FakeBackend implements SupervisorBackend {
  starts = 0;
  readonly callbacks = new Map<string, BackendCallbacks>();
  readonly kind = 'app-server' as const;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.starts += 1;
    this.callbacks.set(input.runId, callbacks);
    const handle: BackendRunHandle = { runId: input.runId, backend: this.kind, opaque: {} };
    callbacks.onSpawn?.(handle);
    return { handle, initialState: 'running' };
  }
  async cancel() {}
  async close() {}
}

function appServerConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return { ...DEFAULT_CONFIG, paths: { vibePinManifest: '/unused/vibe-pin-manifest.json' }, ...overrides };
}

function track(manager: RunManager): RunManager {
  managers.push(manager);
  return manager;
}

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

function makeWorkspace(base: string): string {
  const workspace = path.join(base, 'workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(workspace, '.env'), 'TOKEN=not-a-secret\n');
  return workspace;
}

describe('backend selection by configuration', () => {
  it('records the configured backend on the run, its events and its persisted files', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const data = path.join(base, 'data');
    const backend = new FakeBackend();
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), data, [backend]));
    const started = await manager.reviewStart({ task: 'Review.', cwd: source, wait_seconds: 0 });
    expect(started.backend).toBe('app-server');
    await waitFor(() => backend.starts, (value) => value === 1);
    const callbacks = backend.callbacks.get(started.run_id)!;
    await callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: 'hello' } });
    await callbacks.onState('completed', { result: { stopReason: 'end_turn', summary: 'Done.' } });
    const status = await manager.status({ run_id: started.run_id, after_seq: 0, max_events: 10, wait_seconds: 0 });
    expect(status).toMatchObject({ state: 'completed', backend: 'app-server' });
    const directory = path.join(data, 'runs', started.run_id);
    expect(JSON.parse(readFileSync(path.join(directory, 'meta.json'), 'utf8'))).toMatchObject({ backend: 'app-server' });
    const events = readFileSync(path.join(directory, 'events.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { backend: string });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.backend === 'app-server')).toBe(true);
  });

  it('loads a persisted app-server record after a restart instead of discarding it', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const data = path.join(base, 'data');
    const first = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), data, [new FakeBackend()]));
    const started = await first.reviewStart({ task: 'Review.', cwd: source, wait_seconds: 0 });
    await first.shutdown();
    const second = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), data, [new FakeBackend()]));
    await second.initialize();
    const status = await second.status({ run_id: started.run_id, after_seq: 0, max_events: 10, wait_seconds: 0 });
    expect(status).toMatchObject({ state: 'failed', backend: 'app-server', error: { code: 'VSUP_BACKEND_CRASHED' } });
  });

  it('builds the app-server backend from the configuration and reports its runtime in readiness', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const executable = path.join(base, 'bin', 'vibe-app-server');
    mkdirSync(path.dirname(executable));
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source], paths: { appServer: executable, vibePinManifest: path.join(base, 'manifest.json') } }), path.join(base, 'data')));
    const ready = await manager.status({ workspace: source, operation: 'review', wait_seconds: 0 });
    expect(ready).toMatchObject({ workspace_eligible: true, eligible: false, preparation: { status: "missing" }, runtime: { executable_found: true, resolved_executable: executable, pinned_version: '2.26.1', version_verified: false } });

    const absent = scratch();
    const absentSource = makeWorkspace(absent);
    const missing = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [absentSource], paths: { appServer: path.join(absent, 'nowhere', 'vibe-app-server'), vibePinManifest: '/unused.json' } }), path.join(absent, 'data')));
    const blocked = await missing.status({ workspace: absentSource, operation: 'review', wait_seconds: 0 }) as { eligible: boolean; blockers: { code: string }[] };
    expect(blocked.eligible).toBe(false);
    expect(blocked.blockers.map((blocker) => blocker.code)).toContain('VSUP_VIBE_NOT_FOUND');
  });

  it('refuses to start after a reread configuration changes the pin manifest', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const data = path.join(base, 'data');
    mkdirSync(data, { mode: 0o700 });
    const configPath = path.join(data, 'config.toml');
    const write = (manifest: string) => writeFileSync(configPath, `version = 1\nallowed_workspace_roots = [${JSON.stringify(source)}]\n[paths]\nvibe_pin_manifest = ${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    write('/unused/vibe-pin-manifest.json');
    const { selectedConfigPolicy } = await import('../../src/config/policy.js');
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), data, [new FakeBackend()], undefined, { policy: selectedConfigPolicy(configPath) }));
    write('/unused/other-manifest.json');
    await expect(manager.reviewStart({ task: 'Review.', cwd: source, wait_seconds: 0 })).rejects.toMatchObject({ code: 'VSUP_RESTART_REQUIRED' });
  });
});

describe('stop reasons from the app-server backend', () => {
  const cases = [
    ['turn_limit', /turn limit/i],
    ['token_limit', /token limit/i],
    ['price_limit', /cost limit/i],
    ['refusal', /declined/i]
  ] as const;

  it.each(cases)('explains %s when the backend gave no summary and warns that the result may be incomplete', async (stopReason, pattern) => {
    const base = scratch();
    const source = makeWorkspace(base);
    const backend = new FakeBackend();
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), path.join(base, 'data'), [backend]));
    const started = await manager.reviewStart({ task: 'Review.', cwd: source, wait_seconds: 0 });
    await waitFor(() => backend.starts, (value) => value === 1);
    await backend.callbacks.get(started.run_id)!.onState('completed', { result: { stopReason, summary: '', warnings: ['backend warning'] } });
    const result = await manager.result({ run_id: started.run_id, detail: 'full', include_transcript: false }) as { state: string; stop_reason: string; summary: string; warnings: string[] };
    expect(result).toMatchObject({ state: 'completed', stop_reason: stopReason });
    expect(result.summary).toMatch(pattern);
    expect(result.summary).not.toMatch(/instead of a normal final answer/);
    expect(result.warnings).toContain('backend warning');
    expect(result.warnings.some((warning) => warning.includes(stopReason))).toBe(true);
  });

  it('keeps the backend summary when a limit stop still produced a final message', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const backend = new FakeBackend();
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), path.join(base, 'data'), [backend]));
    const started = await manager.reviewStart({ task: 'Review.', cwd: source, wait_seconds: 0 });
    await waitFor(() => backend.starts, (value) => value === 1);
    await backend.callbacks.get(started.run_id)!.onState('completed', { result: { stopReason: 'turn_limit', summary: 'Partial findings.' } });
    expect(await manager.result({ run_id: started.run_id, detail: 'full', include_transcript: false })).toMatchObject({ stop_reason: 'turn_limit', summary: 'Partial findings.' });
  });

  it('shows a denied tool call in status with its tool and reason', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const backend = new FakeBackend();
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), path.join(base, 'data'), [backend]));
    const started = await manager.reviewStart({ task: 'Review.', cwd: source, wait_seconds: 0 });
    await waitFor(() => backend.starts, (value) => value === 1);
    await backend.callbacks.get(started.run_id)!.onEvent({ source: 'vibe', type: 'tool_denied', severity: 'warning', data: { tool: 'file_system.write_file', outcome: 'permission_denied_by_policy', reason: 'permission_denied_by_policy', entry_id: 'e1', path: '/secret/not-shown' } });
    const status = await manager.status({ run_id: started.run_id, after_seq: 0, max_events: 10, wait_seconds: 0 }) as { events: { type: string; text?: string }[] };
    const denied = status.events.find((event) => event.type === 'tool_denied');
    expect(denied?.text).toBe('file_system.write_file: permission_denied_by_policy');
    expect(JSON.stringify(status)).not.toContain('/secret/not-shown');
  });
});

function interruptedRecord(source: string, state: RunRecord['state'] = 'running'): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, runId: randomUUID(), backend: 'app-server', mode: 'review', state,
    sourceWorkspace: source, workerWorkspace: source, createdAt: now, updatedAt: now, launchedAt: now,
    taskSha256: 'a'.repeat(64), limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_048_576, maxTranscriptBytes: 1_048_576, maxArtifactBytes: 8_388_608 }
  };
}

function leaveRunDirectory(data: string, record: RunRecord): string {
  const directory = path.join(data, 'runs', record.runId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(directory, 'meta.json'), JSON.stringify(runToWire(record)), { mode: 0o600 });
  for (const name of ['child-home', 'vibe-home', 'tmp']) {
    mkdirSync(path.join(directory, name, 'nested'), { recursive: true });
    writeFileSync(path.join(directory, name, 'nested', 'checkpoint.json'), '{"reasoning":"private"}');
  }
  return directory;
}

describe('restart recovery of private Vibe state', () => {
  it('deletes the leftover private directories of an interrupted run before accepting work, and nothing else', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const data = path.join(base, 'data');
    const record = interruptedRecord(source);
    const directory = leaveRunDirectory(data, record);
    const outside = path.join(base, 'outside.txt');
    writeFileSync(outside, 'keep');
    symlinkSync(outside, path.join(directory, 'tmp', 'link-out'));
    writeFileSync(path.join(directory, 'events.ndjson'), '');
    writeFileSync(path.join(directory, 'keep.txt'), 'kept');
    const backend = new FakeBackend();
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), data, [backend]));
    await manager.initialize();
    for (const name of ['child-home', 'vibe-home', 'tmp']) expect(existsSync(path.join(directory, name)), name).toBe(false);
    expect(readFileSync(outside, 'utf8')).toBe('keep');
    expect(readFileSync(path.join(directory, 'keep.txt'), 'utf8')).toBe('kept');
    expect(backend.starts).toBe(0);
    const meta = JSON.parse(readFileSync(path.join(directory, 'meta.json'), 'utf8')) as { state: string; error: { code: string } };
    expect(meta).toMatchObject({ state: 'failed', error: { code: 'VSUP_BACKEND_CRASHED' } });
    const result = JSON.parse(readFileSync(path.join(directory, 'result.json'), 'utf8')) as { warnings: string[] };
    expect(result.warnings.join(' ')).not.toContain('could not be deleted');
    const status = await manager.status({ run_id: record.runId, after_seq: 0, max_events: 10, wait_seconds: 0 });
    expect(status).toMatchObject({ state: 'failed', backend: 'app-server' });
  });

  it('does not touch the private directories of a run that already ended', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const data = path.join(base, 'data');
    const record = interruptedRecord(source, 'failed');
    record.finishedAt = record.updatedAt;
    const directory = leaveRunDirectory(data, record);
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), data, [new FakeBackend()]));
    await manager.initialize();
    expect(existsSync(path.join(directory, 'tmp', 'nested', 'checkpoint.json'))).toBe(true);
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)('reports in the result when leftover state cannot be deleted, and still recovers', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const data = path.join(base, 'data');
    const record = interruptedRecord(source);
    const directory = leaveRunDirectory(data, record);
    const locked = path.join(directory, 'vibe-home', 'nested');
    chmodSync(locked, 0o000);
    const backend = new FakeBackend();
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), data, [backend]));
    try {
      await manager.initialize();
      const result = JSON.parse(readFileSync(path.join(directory, 'result.json'), 'utf8')) as { warnings: string[] };
      expect(result.warnings.some((warning) => warning.includes('could not be deleted'))).toBe(true);
      expect(existsSync(path.join(directory, 'child-home'))).toBe(false);
      expect(JSON.parse(readFileSync(path.join(directory, 'meta.json'), 'utf8'))).toMatchObject({ state: 'failed' });
      expect(backend.starts).toBe(0);
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});

interface Stack {
  base: string;
  source: string;
  data: string;
  logFile: string;
  wrapper: string;
  manager: RunManager;
  backend: AppServerBackend;
  client: Client;
}

class StdioClientHarness implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private buffer = '';
  constructor(private readonly input: PassThrough, private readonly output: PassThrough) {}
  async start(): Promise<void> {
    this.output.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line) this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
      }
    });
    this.output.on('error', (error) => this.onerror?.(error));
  }
  async send(message: JSONRPCMessage): Promise<void> { this.input.write(`${JSON.stringify(message)}\n`); }
  async close(): Promise<void> { this.input.end(); this.output.end(); this.onclose?.(); }
}

async function buildStack(scenario: string, options: { config?: Partial<SupervisorConfig>; backend?: AppServerBackendOptions } = {}): Promise<Stack> {
  const base = scratch();
  const source = makeWorkspace(base);
  const data = path.join(base, 'data');
  const logFile = path.join(base, 'fixture-log.jsonl');
  const document = JSON.parse(readFileSync(path.join(scenarioDirectory, `${scenario}.json`), 'utf8')) as Record<string, unknown>;
  const tools = Object.fromEntries(PROFILE_TOOLS.review.map((tool) => [tool, { permission: TOOL_PERMISSION, denylist: workspaceDenylist(source) }]));
  const scenarioFile = path.join(base, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify({ ...document, effectiveConfig: { ...(document.effectiveConfig as object | undefined), tools } }));
  const wrapper = path.join(base, 'vibe-app-server');
  writeFileSync(wrapper, `#!/bin/sh\nexport FAKE_VIBE_LOG='${logFile}'\nexec '${process.execPath}' '${fixture}' --scenario '${scenarioFile}'\n`);
  chmodSync(wrapper, 0o755);
  const config = appServerConfig({ allowedWorkspaceRoots: [source], ...options.config });
  const backend = new AppServerBackend(config, {
    executable: wrapper,
    preparation: { check: async () => ({ status: "passed" as const, candidate_sha256: null, version: "fixture", reason: "Fake ACP fixture evidence only" }) }, pin: { verify: async () => undefined },
    resolveCredential: async (): Promise<CredentialResolution> => ({ status: 'environment', detail: '', credential: new ResolvedCredential(SECRET) }),
    reaper: { pollMs: 50, graceMs: 200 },
    timing: TIMING,
    ...options.backend
  });
  const manager = track(new RunManager(config, data, [backend]));
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createSupervisorMcpServer(manager, { config });
  await server.connect(new StdioServerTransport(input, output));
  const client = new Client({ name: 'wiring-test-client', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StdioClientHarness(input, output));
  return { base, source, data, logFile, wrapper, manager, backend, client };
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0]!.text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text) as Record<string, unknown>;
}

describe('end to end through the MCP surface with the fake app-server', () => {
  it('runs a review to completion, reports usage and events, and closes without private state', async () => {
    const stack = await buildStack('allowed-call');
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review the repository.', cwd: stack.source, wait_seconds: 30 });
    expect(finished).toMatchObject({ state: 'completed', backend: 'app-server', mode: 'review', result: { summary: 'The review found no issues.', stop_reason: 'end_turn' } });
    const runId = finished.run_id as string;
    const runDirectory = path.join(stack.data, 'runs', runId);

    const status = await call(stack.client, 'vibe_status', { run_id: runId, after_seq: 0, max_events: 50, wait_seconds: 0 }) as { backend: string; events: { type: string; title?: string }[] };
    expect(status.backend).toBe('app-server');
    expect(status.events.map((event) => event.type)).toContain('tool_call');
    expect(status.events.map((event) => event.type)).toContain('message');

    const result = await call(stack.client, 'vibe_result', { run_id: runId, detail: 'full', include_transcript: true }) as { usage: { tokens_used: number; cost: { authoritative: boolean } }; backend: string; integrity: { status: string; writeToolObserved: boolean } };
    expect(result.backend).toBe('app-server');
    expect(result.usage.tokens_used).toBe(1500);
    expect(result.usage.cost.authoritative).toBe(false);
    expect(result.integrity).toMatchObject({ status: 'verified', write_tool_observed: false });

    const closed = await call(stack.client, 'vibe_close', { run_id: runId });
    expect(closed).toMatchObject({ state: 'closed' });

    for (const name of ['child-home', 'vibe-home', 'tmp']) expect(existsSync(path.join(runDirectory, name)), name).toBe(false);
    const persisted = readdirSync(runDirectory);
    expect(persisted).toContain('meta.json');
    const everything = persisted.filter((name) => name.endsWith('.json') || name.endsWith('.ndjson') || name.endsWith('.md')).map((name) => readFileSync(path.join(runDirectory, name), 'utf8')).join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('private reasoning');
    expect(JSON.parse(readFileSync(path.join(runDirectory, 'meta.json'), 'utf8'))).toMatchObject({ backend: 'app-server', state: 'closed' });
    expect(readFileSync(stack.logFile, 'utf8')).toContain('"method":"turn/start"');
  }, 60_000);

  it('surfaces a refused write as a tool_denied event and still completes the review', async () => {
    const stack = await buildStack('off-profile-denied');
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review.', cwd: stack.source, wait_seconds: 30 });
    expect(finished).toMatchObject({ state: 'completed', backend: 'app-server', result: { summary: 'The write was refused.' } });
    const status = await call(stack.client, 'vibe_status', { run_id: finished.run_id, after_seq: 0, max_events: 50, wait_seconds: 0 }) as { events: { type: string; text?: string }[] };
    const denied = status.events.find((event) => event.type === 'tool_denied');
    expect(denied?.text).toContain('file_system.write_file');
    expect(existsSync(path.join(stack.source, 'src', 'leak.ts'))).toBe(false);
    expect(readFileSync(path.join(stack.source, 'src', 'index.ts'), 'utf8')).toBe('export const a = 1;\n');
  }, 60_000);

  it('maps a server-side limit stop to turn_limit with the incomplete-result warning', async () => {
    const stack = await buildStack('limit');
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review.', cwd: stack.source, wait_seconds: 30 });
    expect(finished).toMatchObject({ state: 'completed', backend: 'app-server' });
    const result = await call(stack.client, 'vibe_result', { run_id: finished.run_id, detail: 'full', include_transcript: false }) as { stop_reason: string; warnings: string[] };
    expect(result.stop_reason).toBe('turn_limit');
    expect(result.warnings.join(' ')).toMatch(/limit/);
  }, 60_000);

  it('refuses to start when the pin check fails, before any server is launched', async () => {
    const stack = await buildStack('allowed-call', { backend: { preparation: { check: async () => ({ status: "passed" as const, candidate_sha256: null, version: "fixture", reason: "Fake ACP fixture evidence only" }) }, pin: { verify: async () => { throw new PinCheckError('file-mismatch', 'Installed files differ from the pinned digests.'); } } } });
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review.', cwd: stack.source, wait_seconds: 30 });
    expect(finished).toMatchObject({ state: 'failed', error: { code: 'VSUP_VIBE_VERSION_UNSUPPORTED' } });
    expect(existsSync(stack.logFile)).toBe(false);
  }, 60_000);
});

describe('doctor with the app-server backend', () => {
  function doctorConfig(base: string, overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
    const root = path.join(base, 'root');
    mkdirSync(root, { recursive: true });
    return appServerConfig({ allowedWorkspaceRoots: [root], ...overrides });
  }

  function wrapperBackend(base: string, config: SupervisorConfig, verify: (executable: string) => Promise<unknown>): { backend: AppServerBackend; launched: () => boolean } {
    const logFile = path.join(base, 'launched.log');
    const wrapper = path.join(base, 'vibe-app-server');
    writeFileSync(wrapper, `#!/bin/sh\necho launched >> '${logFile}'\nexit 0\n`);
    chmodSync(wrapper, 0o755);
    return { backend: new AppServerBackend(config, { executable: wrapper, preparation: { check: async () => ({ status: "passed" as const, candidate_sha256: null, version: "fixture", reason: "Fake ACP fixture evidence only" }) }, pin: { verify } }), launched: () => existsSync(logFile) };
  }

  it('reports the vibe check from the pin verifier without launching the server', async () => {
    const base = scratch();
    vi.stubEnv('VIBE_SUPERVISOR_HOME', path.join(base, 'data'));
    const config = doctorConfig(base);
    const verified: string[] = [];
    const { backend, launched } = wrapperBackend(base, config, async (executable) => { verified.push(executable); });
    const report = await runDoctor(config, undefined, { backend });
    const vibe = report.checks.find((check) => check.name === 'vibe');
    expect(vibe).toMatchObject({ ok: true, status: 'ok', version: '2.26.1', message: expect.stringContaining('matches the pinned manifest') });
    expect(verified).toEqual([path.join(base, 'vibe-app-server')]);
    expect(launched()).toBe(false);
    expect(report.provenance).toMatchObject({ backend: 'app-server', vibe_version: '2.26.1' });
    expect(report.ok).toBe(true);
  });

  it('fails the vibe check with the pin failure and its error code, and marks the report not ok', async () => {
    const base = scratch();
    vi.stubEnv('VIBE_SUPERVISOR_HOME', path.join(base, 'data'));
    const config = doctorConfig(base);
    const { backend, launched } = wrapperBackend(base, config, async () => { throw new PinCheckError('file-mismatch', 'Installed files differ from the pinned digests.'); });
    const report = await runDoctor(config, undefined, { backend });
    const vibe = report.checks.find((check) => check.name === 'vibe');
    expect(vibe).toMatchObject({ ok: false, message: expect.stringContaining('differ from the pinned digests') });
    expect(vibe?.message).toContain('VSUP_VIBE_VERSION_UNSUPPORTED');
    expect(vibe?.message).toContain(path.join(base, 'vibe-app-server'));
    expect(report.ok).toBe(false);
    expect(launched()).toBe(false);
  });

  it('builds the backend from the configuration when none is injected', async () => {
    const base = scratch();
    vi.stubEnv('VIBE_SUPERVISOR_HOME', path.join(base, 'data'));
    const fake = await makeFakeVibeEnvironment(base);
    const report = await runDoctor(doctorConfig(base, { paths: { appServer: fake.shim, vibePinManifest: path.join(base, 'missing-manifest.json') } }));
    const vibe = report.checks.find((check) => check.name === 'vibe');
    expect(vibe?.ok).toBe(false);
    expect(vibe?.message).toMatch(/pin manifest cannot be read/i);
  });
});

describe('pin-manifest command', () => {
  async function environment(): Promise<{ base: string; data: string; configPath: string; manifest: string; shim: string; script: string; site: string }> {
    const base = scratch();
    const fake = await makeFakeVibeEnvironment(base);
    const data = path.join(base, 'data');
    mkdirSync(data, { mode: 0o700 });
    const manifest = path.join(data, 'vibe-pin-manifest.json');
    const configPath = path.join(data, 'config.toml');
    writeFileSync(configPath, `version = 1\nallowed_workspace_roots = []\n[paths]\nvibe = ${JSON.stringify(fake.vibeShim)}\nvibe_pin_manifest = ${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    return { base, data, configPath, manifest, shim: fake.shim, script: fake.script, site: fake.site };
  }

  function capture(): { out: () => string; err: () => string } {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { out.push(String(chunk)); return true; }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { err.push(String(chunk)); return true; }) as typeof process.stderr.write);
    return { out: () => out.join(''), err: () => err.join('') };
  }

  it('writes a private manifest for the executable derived from paths.vibe and the doctor then verifies it for real', async () => {
    const env = await environment();
    const output = capture();
    await runCli(['pin-manifest', '--config', env.configPath]);
    expect(output.err()).toBe('');
    expect(process.exitCode).toBeUndefined();
    expect(output.out()).toContain('Wrote the pin manifest for Vibe 2.26.1');
    expect(output.out()).toContain(env.manifest);
    expect((await stat(env.manifest)).mode & 0o777).toBe(0o600);
    const written = await readFile(env.manifest, 'utf8');
    const manifest = parsePinManifest(written);
    expect(serializePinManifest(manifest)).toBe(written);
    expect(manifest).toEqual(await generatePinManifest({ executable: env.shim }));
    expect(Object.keys(manifest.files)).toContain('vibe/app_server/__init__.py');

    vi.stubEnv('VIBE_SUPERVISOR_HOME', env.data);
    const { loadConfig } = await import('../../src/config/config.js');
    const config = await loadConfig({ configPath: env.configPath });
    const report = await runDoctor(config, { configPath: env.configPath, dataDir: env.data });
    expect(report.checks.find((check) => check.name === 'vibe')).toMatchObject({ ok: true, status: 'ok', version: '2.26.1' });

    await writeFile(path.join(env.site, 'vibe', 'app_server', '__init__.py'), 'def main():\n    return 1\n');
    const tampered = await runDoctor(config, { configPath: env.configPath, dataDir: env.data });
    expect(tampered.checks.find((check) => check.name === 'vibe')).toMatchObject({ ok: false, message: expect.stringContaining('differ') });
    expect(tampered.ok).toBe(false);
  });

  it('refuses to overwrite an existing manifest unless --force is given', async () => {
    const env = await environment();
    writeFileSync(env.manifest, 'previous');
    const output = capture();
    await runCli(['pin-manifest', '--config', env.configPath]);
    expect(output.err()).toContain('already exists');
    expect(process.exitCode).toBe(2);
    expect(readFileSync(env.manifest, 'utf8')).toBe('previous');
    process.exitCode = undefined;
    await runCli(['pin-manifest', '--config', env.configPath, '--force']);
    expect(parsePinManifest(readFileSync(env.manifest, 'utf8')).version).toBe('2.26.1');
  });

  it('takes an explicit executable and output path', async () => {
    const env = await environment();
    const other = path.join(env.base, 'other-manifest.json');
    const output = capture();
    await runCli(['pin-manifest', '--config', env.configPath, '--executable', env.script, '--output', other]);
    expect(output.err()).toBe('');
    expect(existsSync(other)).toBe(true);
    expect(existsSync(env.manifest)).toBe(false);
  });

  it('fails without writing when the installed version is not the pinned one', async () => {
    const env = await environment();
    const wrong = scratch();
    const fake = await makeFakeVibeEnvironment(wrong, '2.26.0');
    const output = capture();
    await runCli(['pin-manifest', '--config', env.configPath, '--executable', fake.shim]);
    expect(output.err()).toContain('VSUP_VIBE_VERSION_UNSUPPORTED');
    expect(output.err()).toContain('version-mismatch');
    expect(process.exitCode).toBe(1);
    expect(existsSync(env.manifest)).toBe(false);
  });

  it('fails when the executable cannot be found', async () => {
    const env = await environment();
    const output = capture();
    await runCli(['pin-manifest', '--config', env.configPath, '--executable', path.join(env.base, 'absent', 'vibe-app-server')]);
    expect(output.err()).toContain('VSUP_VIBE_NOT_FOUND');
    expect(existsSync(env.manifest)).toBe(false);
  });

  it('rejects unknown, repeated and valueless arguments', async () => {
    const env = await environment();
    for (const args of [['--nope'], ['--config'], ['--force', '--force'], ['--output', 'relative.json']]) {
      process.exitCode = undefined;
      const output = capture();
      await runCli(['pin-manifest', '--config', env.configPath, ...args]);
      expect(output.err(), args.join(' ')).toContain('VSUP_INVALID_ARGUMENT');
      expect(process.exitCode).toBe(2);
      vi.restoreAllMocks();
    }
    expect(existsSync(env.manifest)).toBe(false);
  });

  it('is listed in the usage text', async () => {
    const output = capture();
    await runCli(['help']);
    expect(output.out()).toContain('pin-manifest');
  });
});

describe('setup defaults for the app-server backend', () => {
  it('writes the manifest path next to a newly created config so the config validates', async () => {
    const base = scratch();
    const data = path.join(base, 'data');
    const workspace = path.join(base, 'ws');
    mkdirSync(workspace);
    vi.stubEnv('VIBE_SUPERVISOR_HOME', data);
    vi.stubEnv('HOME', base);
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    await runCli(['allow', workspace]);
    const text = readFileSync(path.join(data, 'config.toml'), 'utf8');
    expect(text).toContain(`vibe_pin_manifest = ${JSON.stringify(path.join(data, 'vibe-pin-manifest.json'))}`);
    const { loadConfig } = await import('../../src/config/config.js');
    expect((await loadConfig({ configPath: path.join(data, 'config.toml') })).paths?.vibePinManifest).toBe(path.join(data, 'vibe-pin-manifest.json'));
  });
});
