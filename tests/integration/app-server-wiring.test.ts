import { authorizedReviewStart } from "../support/authorized-start.js";
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
import { exportReport } from '../../src/reporting/export.js';
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
    const started = await authorizedReviewStart(manager, { task: 'Review.', cwd: source, wait_seconds: 0 });
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
    const started = await authorizedReviewStart(first, { task: 'Review.', cwd: source, wait_seconds: 0 });
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
    expect(ready).toMatchObject({ workspace_eligible: true, eligible: false, preparation: { status: "missing" }, runtime: { executable_found: true, resolved_executable: executable, pinned_version: null, minimum_version: '3.1.2', version_verified: false } });

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
    await expect(authorizedReviewStart(manager, { task: 'Review.', cwd: source, wait_seconds: 0 })).rejects.toMatchObject({ code: 'VSUP_RESTART_REQUIRED' });
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
    const started = await authorizedReviewStart(manager, { task: 'Review.', cwd: source, wait_seconds: 0 });
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
    const started = await authorizedReviewStart(manager, { task: 'Review.', cwd: source, wait_seconds: 0 });
    await waitFor(() => backend.starts, (value) => value === 1);
    await backend.callbacks.get(started.run_id)!.onState('completed', { result: { stopReason: 'turn_limit', summary: 'Partial findings.' } });
    expect(await manager.result({ run_id: started.run_id, detail: 'full', include_transcript: false })).toMatchObject({ stop_reason: 'turn_limit', summary: 'Partial findings.' });
  });

  it('shows a denied tool call in status with its tool and reason', async () => {
    const base = scratch();
    const source = makeWorkspace(base);
    const backend = new FakeBackend();
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source] }), path.join(base, 'data'), [backend]));
    const started = await authorizedReviewStart(manager, { task: 'Review.', cwd: source, wait_seconds: 0 });
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

async function buildStack(scenario: string | Record<string, unknown>, options: { config?: Partial<SupervisorConfig>; backend?: AppServerBackendOptions } = {}): Promise<Stack> {
  const base = scratch();
  const source = makeWorkspace(base);
  const data = path.join(base, 'data');
  const logFile = path.join(base, 'fixture-log.jsonl');
  const document = typeof scenario === 'string' ? JSON.parse(readFileSync(path.join(scenarioDirectory, `${scenario}.json`), 'utf8')) as Record<string, unknown> : scenario;
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
    credentialEnvironment: { environment: { MISTRAL_API_KEY: 'readiness-placeholder' }, platform: process.platform },
    reaper: { pollMs: 50, graceMs: 200 },
    timing: TIMING,
    ...options.backend
  });
  const manager = track(new RunManager(config, data, [backend]));
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createSupervisorMcpServer(manager, { config });
  await server.connect(new StdioServerTransport(input, output));
  const client = new Client({ name: 'wiring-test-client', version: '0.0.1' });
  clients.push(client);
  await client.connect(new StdioClientHarness(input, output));
  return { base, source, data, logFile, wrapper, manager, backend, client };
}

async function call(client: Client, name: string, args: Record<string, unknown>, manager?: RunManager): Promise<Record<string, unknown>> {
  const start = name === 'vibe_review_start' || name === 'vibe_edit_start';
  const operation = name === 'vibe_edit_start' ? 'edit' : 'review';
  const grant = start && manager ? await manager.authorizeDispatch(operation, args as never, 'wiring-test-owner', new Date(Date.now() + 60 * 60 * 1000).toISOString()) : undefined;
  const result = await client.callTool({ name, arguments: grant ? { ...args, authorization_id: grant.authorization_id, attempt_id: grant.attempt_id } : args });
  const text = (result.content as { text: string }[])[0]!.text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text) as Record<string, unknown>;
}

describe('end to end through the MCP surface with the fake app-server', () => {
  it('delivers the ordered review context and exact evidence to the app-server', async () => {
    const stack = await buildStack('allowed-call');
    execFileSync('git', ['init', '-q'], { cwd: stack.source });
    const contextFiles = ['README.md', 'src/index.ts', 'src/rules.ts'];
    writeFileSync(path.join(stack.source, 'README.md'), 'Fixture rule: 5000 cents ships free.\n');
    writeFileSync(path.join(stack.source, 'src/rules.ts'), 'export const threshold = 5000;\n');
    const task = [
      'Trace the reported discrepancies to the source.',
      'Case 1 — expected 1579, observed 1599.',
      'Case 2 — expected 6000, observed 6499.',
      'Case 3 — expected 3600, observed 4200.'
    ].join('\n');
    const readiness = await call(stack.client, 'vibe_status', { workspace: stack.source, operation: 'review' });
    expect(readiness).toMatchObject({ eligible: true, readiness_receipt: expect.any(String) });
    const finished = await call(stack.client, 'vibe_review_start', {
      cwd: stack.source, task, context_files: contextFiles, readiness_receipt: readiness.readiness_receipt, wait_seconds: 30
    }, stack.manager);
    expect(finished).toMatchObject({ state: 'completed' });

    const frames = readFileSync(stack.logFile, 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line) as { kind: string; frame?: { method?: string; params?: unknown } })
      .filter((entry) => entry.kind === 'frame' && entry.frame?.method === 'turn/start');
    const prompt = [
      ...contextFiles.map((file) => `Approved context path: ${path.join(stack.source, file)}`),
      '',
      'Task:',
      task
    ].join('\n');
    expect(frames.map((entry) => entry.frame?.params)).toEqual([
      { sessionId: expect.any(String), message: [{ type: 'text', text: prompt }] }
    ]);
    expect(await call(stack.client, 'vibe_close', { run_id: finished.run_id })).toMatchObject({ state: 'closed' });
  }, 60_000);

  it('runs a review to completion, reports usage and events, and closes without private state', async () => {
    const stack = await buildStack('allowed-call');
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review the repository.', cwd: stack.source, wait_seconds: 30 }, stack.manager);
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

  it('leaves no reasoning in the supervisor data directory when a review thinks high by default with the wire trace on (Vibe private store not covered)', async () => {
    const sentinel = 'REASONING-SENTINEL-7f3a9c';
    vi.stubEnv('VSUP_TRACE_VIBE_WIRE', '1');
    const stack = await buildStack('reasoning-sentinel');
    const filesUnder = (directory: string): string[] => readdirSync(directory, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
    const leaks = () => filesUnder(stack.data).filter((file) => readFileSync(file).includes(sentinel));

    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review the repository.', cwd: stack.source, wait_seconds: 30 }, stack.manager);
    expect(finished).toMatchObject({ state: 'completed', result: { summary: 'The review found no issues.' } });
    const runId = finished.run_id as string;
    const runDirectory = path.join(stack.data, 'runs', runId);

    const log = readFileSync(stack.logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { kind: string; frame?: { method?: string; params?: { reasoningEffort?: string } } });
    expect(log.filter((entry) => entry.kind === 'frame' && entry.frame?.method === 'config/model/write').map((entry) => entry.frame?.params?.reasoningEffort)).toEqual(['high']);
    const status = await call(stack.client, 'vibe_status', { run_id: runId, after_seq: 0, max_events: 100, wait_seconds: 0 });
    expect(JSON.stringify(status)).not.toContain(sentinel);
    const result = await call(stack.client, 'vibe_result', { run_id: runId, detail: 'full', include_transcript: true });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    mkdirSync(path.join(stack.data, 'reports'), { mode: 0o700 });
    await exportReport({ directory: runDirectory, output: path.join(stack.data, 'reports', runId), include: ['events'] });

    const events = readFileSync(path.join(runDirectory, 'events.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
    const diagnostics = events.filter((event) => event.type === 'diagnostic').map((event) => event.data);
    expect(diagnostics.find((data) => data.reason === 'app_server_wire_trace')).toMatchObject({ terminal_state: 'completed', entries: expect.arrayContaining([expect.objectContaining({ kind: 'notification', method: 'history/entryUpdated' })]) });
    expect(diagnostics.find((data) => data.reason === 'reasoning_observation')).toMatchObject({ streamed_entries: 3, history_entries: 3, history_audited: true });
    expect(filesUnder(path.join(stack.data, 'reports', runId)).length).toBeGreaterThan(0);
    expect(filesUnder(runDirectory).map((file) => path.relative(runDirectory, file))).toEqual(expect.arrayContaining(['meta.json', 'events.ndjson']));
    expect(leaks()).toEqual([]);

    await call(stack.client, 'vibe_close', { run_id: runId });
    expect(leaks()).toEqual([]);
    const canary = path.join(runDirectory, 'canary.txt');
    writeFileSync(canary, `${sentinel}\n`);
    expect(leaks()).toEqual([canary]);
  }, 60_000);

  it('surfaces a refused write as a tool_denied event and still completes the review', async () => {
    const stack = await buildStack('off-profile-denied');
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review.', cwd: stack.source, wait_seconds: 30 }, stack.manager);
    expect(finished).toMatchObject({ state: 'completed', backend: 'app-server', result: { summary: 'The write was refused.' } });
    const status = await call(stack.client, 'vibe_status', { run_id: finished.run_id, after_seq: 0, max_events: 50, wait_seconds: 0 }) as { events: { type: string; text?: string }[] };
    const denied = status.events.find((event) => event.type === 'tool_denied');
    expect(denied?.text).toContain('file_system.write_file');
    expect(existsSync(path.join(stack.source, 'src', 'leak.ts'))).toBe(false);
    expect(readFileSync(path.join(stack.source, 'src', 'index.ts'), 'utf8')).toBe('export const a = 1;\n');
  }, 60_000);

  it('maps a server-side limit stop to turn_limit with the incomplete-result warning', async () => {
    const stack = await buildStack('limit');
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review.', cwd: stack.source, wait_seconds: 30 }, stack.manager);
    expect(finished).toMatchObject({ state: 'completed', backend: 'app-server' });
    const result = await call(stack.client, 'vibe_result', { run_id: finished.run_id, detail: 'full', include_transcript: false }) as { stop_reason: string; warnings: string[] };
    expect(result.stop_reason).toBe('turn_limit');
    expect(result.warnings.join(' ')).toMatch(/limit/);
  }, 60_000);

  it('refuses a start whose pin check fails without spending the grant, and the same grant starts once the pin verifies', async () => {
    let pinBroken = true;
    const stack = await buildStack('allowed-call', { backend: { pin: { verify: async () => { if (pinBroken) throw new PinCheckError('file-mismatch', 'Installed files differ from the pinned digests.'); } } } });
    const ready = await call(stack.client, 'vibe_status', { workspace: stack.source, operation: 'review' });
    expect(ready).toMatchObject({ eligible: false, admission: { pin: 'failed', credential: { status: 'present' } } });
    expect((ready.blockers as { code: string }[]).map((blocker) => blocker.code)).toContain('VSUP_VIBE_VERSION_UNSUPPORTED');
    const start = await sameGrantStarts(stack, { task: 'Review.', cwd: stack.source, wait_seconds: 30 });
    const refused = await start();
    expect(refused).toMatchObject({ isError: true, body: { error: { code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { reason: 'file-mismatch', attempt_consumed: false } } } });
    expect(existsSync(stack.logFile)).toBe(false);
    pinBroken = false;
    expect(await start()).toMatchObject({ isError: false, body: { state: 'completed' } });
  }, 60_000);

  it('refuses a start without spending the grant when the supervisor begins shutting down during the admission check', async () => {
    let armed = false;
    let shutdown: Promise<unknown> | undefined;
    const stack = await buildStack('allowed-call', { backend: { pin: { verify: async () => { if (armed && !shutdown) shutdown = stack.manager.shutdown(); } } } });
    const start = await sameGrantStarts(stack, { task: 'Review.', cwd: stack.source, wait_seconds: 30 });
    armed = true;
    expect(await start()).toMatchObject({ isError: true, body: { error: { code: 'VSUP_INVALID_STATE', details: { attempt_consumed: false } } } });
    expect(existsSync(stack.logFile)).toBe(false);
    await shutdown;
  }, 60_000);

  it('refuses a start without a Mistral credential without spending the grant, keeps the secret out of every reply, and the same grant starts once it is set', async () => {
    const stored: { credential?: ResolvedCredential } = {};
    let lookups = 0;
    const environment: NodeJS.ProcessEnv = {};
    const stack = await buildStack('allowed-call', { backend: {
      credentialEnvironment: { environment, platform: 'linux' },
      resolveCredential: async (): Promise<CredentialResolution> => { lookups += 1; return stored.credential ? { status: 'environment', detail: '', credential: stored.credential } : { status: 'not-found', detail: 'ai.mistral.vibe=not-found,vibe=not-found', credential: undefined }; }
    } });
    const ready = await call(stack.client, 'vibe_status', { workspace: stack.source, operation: 'review' });
    expect(ready).toMatchObject({ eligible: false, admission: { pin: 'verified', credential: { status: 'absent', source: 'skipped-platform' } } });
    expect(ready.blockers).toContainEqual(expect.objectContaining({ code: 'VSUP_AUTH_REQUIRED' }));
    expect(lookups).toBe(0);
    const start = await sameGrantStarts(stack, { task: 'Review.', cwd: stack.source, wait_seconds: 30 });
    expect(await start()).toMatchObject({ isError: true, body: { error: { code: 'VSUP_AUTH_REQUIRED', details: { credential_status: 'not-found', attempt_consumed: false } } } });
    expect(existsSync(stack.logFile)).toBe(false);
    stored.credential = new ResolvedCredential(SECRET);
    environment.MISTRAL_API_KEY = SECRET;
    const present = await call(stack.client, 'vibe_status', { workspace: stack.source, operation: 'review' });
    expect(present).toMatchObject({ eligible: true, admission: { credential: { status: 'present', source: 'environment' } } });
    const started = await start();
    expect(started).toMatchObject({ isError: false, body: { state: 'completed' } });
    expect(lookups).toBe(2);
    const runId = String(started.body.run_id);
    const result = await call(stack.client, 'vibe_result', { run_id: runId, detail: 'full' });
    const events = readFileSync(path.join(stack.data, 'runs', runId, 'events.ndjson'), 'utf8');
    for (const text of [JSON.stringify(ready), JSON.stringify(present), JSON.stringify(started), JSON.stringify(result), events, readFileSync(path.join(stack.data, 'runs', runId, 'meta.json'), 'utf8')]) expect(text).not.toContain(SECRET);
  }, 60_000);

  it('does not look in the keychain at readiness on macOS and leaves an unchecked credential unknown, not blocking', async () => {
    let lookups = 0;
    const stack = await buildStack('allowed-call', { backend: {
      credentialEnvironment: { environment: {}, platform: 'darwin' },
      resolveCredential: async (): Promise<CredentialResolution> => { lookups += 1; return { status: 'environment', detail: '', credential: new ResolvedCredential(SECRET) }; }
    } });
    const ready = await call(stack.client, 'vibe_status', { workspace: stack.source, operation: 'review' });
    expect(ready).toMatchObject({ eligible: true, admission: { credential: { status: 'unknown', source: 'keychain-not-checked' } } });
    expect(lookups).toBe(0);
  }, 60_000);

  it('refuses a start whose preparation went stale after readiness without spending the grant, and the same grant starts once it is current again', async () => {
    let status: 'passed' | 'stale' = 'passed';
    const stack = await buildStack('allowed-call', { backend: { preparation: { check: async () => ({ status, candidate_sha256: null, version: 'fixture', reason: 'Fake ACP fixture evidence only' }) } } });
    const ready = await call(stack.client, 'vibe_status', { workspace: stack.source, operation: 'review' });
    expect(ready).toMatchObject({ eligible: true });
    status = 'stale';
    const start = await sameGrantStarts(stack, { task: 'Review.', cwd: stack.source, readiness_receipt: ready.readiness_receipt, wait_seconds: 30 });
    expect(await start()).toMatchObject({ isError: true, body: { error: { code: 'VSUP_INVALID_STATE', details: { preparation: { status: 'stale' }, attempt_consumed: false } } } });
    expect(existsSync(stack.logFile)).toBe(false);
    status = 'passed';
    expect(await start()).toMatchObject({ isError: false, body: { state: 'completed' } });
  }, 60_000);

  it('marks a launch that fails after the grant is spent as never started', async () => {
    const stack = await buildStack('startup-failure');
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review.', cwd: stack.source, wait_seconds: 30 }, stack.manager);
    expect(finished).toMatchObject({ state: 'failed', error: { details: { launch_failed: true } }, result: { execution_state: 'not_started', answer_present: false, summary: expect.stringContaining('never reached inference') } });
    expect((finished.error as { details: Record<string, unknown> }).details).not.toHaveProperty('cause_reason');
    expect((finished.error as { details: Record<string, unknown> }).details.reason).not.toBe('launch_failed');
    expect(String((finished.error as { message: string }).message)).toContain('never reached inference');
    const result = await call(stack.client, 'vibe_result', { run_id: String(finished.run_id), detail: 'full' });
    expect(result).toMatchObject({ execution_state: 'not_started', answer_present: false, error: { details: { launch_failed: true } } });
    const meta = JSON.parse(readFileSync(path.join(stack.data, 'runs', String(finished.run_id), 'meta.json'), 'utf8')) as Record<string, unknown>;
    expect(meta).toMatchObject({ execution_state: 'not_started' });
    await stack.manager.shutdown();
    const restarted = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [stack.source] }), stack.data, [new FakeBackend()]));
    await restarted.initialize();
    expect(await restarted.result({ run_id: String(finished.run_id) })).toMatchObject({ execution_state: 'not_started' });
  }, 60_000);

  it('records a failure after turn/start was sent as an ordinary failed run, not as never started', async () => {
    const stack = await buildStack({ name: 'turn-start-rejected', errors: { 'turn/start': { code: 'internal_error', message: 'turn rejected after receipt' } }, steps: [] });
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review.', cwd: stack.source, wait_seconds: 30 }, stack.manager);
    expect(finished).toMatchObject({ state: 'failed', result: { execution_state: 'failed', answer_present: false } });
    const error = finished.error as { message: string; details?: Record<string, unknown> };
    expect(error.details ?? {}).not.toHaveProperty('launch_failed');
    expect(error.message).not.toContain('never reached inference');
    const frames = readFileSync(stack.logFile, 'utf8');
    expect(frames).toContain('turn/start');
  }, 60_000);
});

async function sameGrantStarts(stack: Stack, args: Record<string, unknown>): Promise<() => Promise<{ isError: boolean; body: Record<string, unknown> }>> {
  const grant = await stack.manager.authorizeDispatch('review', args as never, 'wiring-test-owner', new Date(Date.now() + 60 * 60 * 1000).toISOString());
  return async () => {
    const result = await stack.client.callTool({ name: 'vibe_review_start', arguments: { ...args, authorization_id: grant.authorization_id, attempt_id: grant.attempt_id } });
    const text = (result.content as { text: string }[])[0]!.text;
    return { isError: result.isError === true, body: JSON.parse(text) as Record<string, unknown> };
  };
}

describe('what a review read', () => {
  const read = (filePath: string) => ({ op: 'call', tool: 'file_system.read_file', mode: 'approval', input: { filePath, offset: null, limit: 2000 } });
  const say = (text: string) => ({ op: 'say', text, stream: true });

  async function review(steps: Record<string, unknown>[], args: Record<string, unknown> = {}) {
    const stack = await buildStack({ name: 'context-reads', steps });
    writeFileSync(path.join(stack.source, 'README.md'), 'Fixture rule.\n');
    writeFileSync(path.join(stack.source, 'src', 'rules.ts'), 'export const threshold = 5000;\n');
    const finished = await call(stack.client, 'vibe_review_start', { task: 'Review.', cwd: stack.source, wait_seconds: 30, ...args }, stack.manager);
    expect(finished).toMatchObject({ state: 'completed' });
    const runId = String(finished.run_id);
    const compact = await call(stack.client, 'vibe_result', { run_id: runId });
    const meta = JSON.parse(readFileSync(path.join(stack.data, 'runs', runId, 'meta.json'), 'utf8')) as { result: Record<string, unknown> };
    const saved = JSON.parse(readFileSync(path.join(stack.data, 'runs', runId, 'result.json'), 'utf8')) as Record<string, unknown>;
    return { finished, compact, meta, saved, warnings: compact.warnings as string[] };
  }

  it('records every named file as read whether the worker used an absolute, relative or ./ path, and lists other files and no directories as extra', async () => {
    const { finished, compact, meta, saved, warnings } = await review([read('${cwd}/README.md'), read('src/rules.ts'), read('./src/index.ts'), read('src'), say('No issues.')], { context_files: ['./README.md', 'src/rules.ts'] });
    const expected = { named: 2, read: ['README.md', 'src/rules.ts'], unread: [], extra: ['src/index.ts'] };
    expect(finished.result).toMatchObject({ context_reads: expected, usage: { tool_calls: { executed: 4, denied_by_handler: 0, denied_by_policy: 0 } } });
    expect(compact).toMatchObject({ context_reads: expected, usage: { tool_calls: { executed: 4 } } });
    expect(meta.result.context_reads).toEqual(expected);
    expect(saved.context_reads).toEqual(expected);
    expect(compact.answer_present).toBe(true);
    expect(meta.result.answer_present).toBe(true);
    expect(saved.answer_present).toBe(true);
    expect(warnings.filter((warning) => warning.includes('named context files'))).toEqual([]);
  }, 60_000);

  it('warns when a review read none of its named files', async () => {
    const { compact, warnings } = await review([say('No issues.')], { context_files: ['README.md', 'src/rules.ts'] });
    expect(compact.context_reads).toEqual({ named: 2, read: [], unread: ['README.md', 'src/rules.ts'], extra: [] });
    expect(warnings).toContain('The review read none of the 2 named context files; its answer is not grounded in them.');
  }, 60_000);

  it('names the unread files when a review read a different file instead', async () => {
    const { compact, warnings } = await review([read('${cwd}/src/rules.ts'), read('${cwd}/src/index.ts'), say('No issues.')], { context_files: ['README.md', 'src/rules.ts'] });
    expect(compact.context_reads).toEqual({ named: 2, read: ['src/rules.ts'], unread: ['README.md'], extra: ['src/index.ts'] });
    expect(warnings).toContain('The review did not read 1 of the 2 named context files: README.md.');
  }, 60_000);

  it('says so in the summary and a warning when a review ends without a final answer', async () => {
    const { compact, warnings } = await review([read('${cwd}/src/index.ts')]);
    expect(compact.summary).toMatch(/^The review ended without a final answer/);
    expect(warnings).toContain('The review returned no final answer text, so there is no review to use.');
    expect(warnings).not.toContain('The turn finished without a final assistant message.');
    expect(compact.answer_present).toBe(false);
  }, 60_000);

  it('warns when findings output was requested and the answer has no findings block', async () => {
    const { compact, warnings } = await review([say('The code looks fine to me.')], { output: 'findings' });
    expect(compact.summary).toBe('The code looks fine to me.');
    expect(warnings).toContain('Findings output was requested, but the answer has no findings JSON block, so findings.json lists no findings.');
  }, 60_000);
});

describe('context reads the supervisor cannot know or must bound', () => {
  const readEvent = (filePath: string) => ({ source: 'vibe' as const, type: 'tool_call', severity: 'info' as const, data: { name: 'read_file', tool: 'file_system.read_file', kind: 'read', outcome: 'executed', path: filePath } });
  const UNDETERMINED = /could not be determined/;

  async function fakeReview(config: Partial<SupervisorConfig>, contextFiles: string[], prepare?: (source: string) => void) {
    const base = scratch();
    const source = makeWorkspace(base);
    writeFileSync(path.join(source, 'README.md'), 'Fixture rule.\n');
    prepare?.(source);
    const backend = new FakeBackend();
    const manager = track(new RunManager(appServerConfig({ allowedWorkspaceRoots: [source], ...config }), path.join(base, 'data'), [backend]));
    const started = await authorizedReviewStart(manager, { task: 'Review.', cwd: source, context_files: contextFiles, wait_seconds: 0 });
    await waitFor(() => backend.starts, (value) => value === 1);
    await waitFor(async () => (await manager.status({ run_id: started.run_id })).state, (state) => state === 'running');
    return { source, manager, callbacks: backend.callbacks.get(started.run_id)!, runId: started.run_id, data: path.join(base, 'data') };
  }

  it('leaves context_reads out with one warning when a named file no longer resolves at settle', async () => {
    const run = await fakeReview({}, ['README.md']);
    rmSync(path.join(run.source, 'README.md'));
    await run.callbacks.onState('completed', { result: { stopReason: 'end_turn', summary: 'Done.' } });
    const full = await run.manager.result({ run_id: run.runId, detail: 'full' });
    expect(full).not.toHaveProperty('context_reads');
    expect((full.warnings as string[]).filter((warning) => UNDETERMINED.test(warning))).toHaveLength(1);
    expect((full.warnings as string[]).some((warning) => warning.includes('named context files'))).toBe(false);
  });

  it('leaves context_reads out with one warning when the event log refused an event', async () => {
    const run = await fakeReview({ limits: { ...DEFAULT_CONFIG.limits, maxEventBytes: 4096 } }, ['README.md']);
    for (let index = 0; index < 40; index += 1) await run.callbacks.onEvent(readEvent(`src/missing-${index}-${'x'.repeat(100)}.ts`));
    await waitFor(async () => (await run.manager.status({ run_id: run.runId })).state, (state) => state === 'failed');
    const full = await run.manager.result({ run_id: run.runId, detail: 'full' });
    expect(full).toMatchObject({ error: { code: 'VSUP_OUTPUT_LIMIT' } });
    expect(full).not.toHaveProperty('context_reads');
    expect((full.warnings as string[]).filter((warning) => UNDETERMINED.test(warning))).toHaveLength(1);
  });

  it('bounds the stored lists and the compact lists and says they were cut', async () => {
    const run = await fakeReview({}, [], (source) => { for (let index = 0; index < 230; index += 1) writeFileSync(path.join(source, 'src', `file-${String(index).padStart(3, '0')}.ts`), 'x\n'); });
    for (let index = 0; index < 230; index += 1) await run.callbacks.onEvent(readEvent(`src/file-${String(index).padStart(3, '0')}.ts`));
    await run.callbacks.onState('completed', { result: { stopReason: 'end_turn', summary: 'Done.' } });
    const meta = JSON.parse(readFileSync(path.join(run.data, 'runs', run.runId, 'meta.json'), 'utf8')) as { result: { context_reads: { extra: string[]; truncated?: boolean } } };
    expect(meta.result.context_reads.extra).toHaveLength(200);
    expect(meta.result.context_reads.truncated).toBe(true);
    const compact = await run.manager.result({ run_id: run.runId });
    expect(compact.context_reads).toMatchObject({ named: 0, truncated: true });
    expect((compact.context_reads as { extra: string[] }).extra).toHaveLength(50);
  });
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
    expect(vibe).toMatchObject({ ok: true, status: 'ok', version: '3.1.2', message: expect.stringContaining('matches the pinned manifest') });
    expect(verified).toEqual([path.join(base, 'vibe-app-server')]);
    expect(launched()).toBe(false);
    expect(report.provenance).toMatchObject({ backend: 'app-server', vibe_version: '3.1.2' });
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
    expect(output.out()).toContain('Wrote the pin manifest for Vibe 3.1.2');
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
    expect(report.checks.find((check) => check.name === 'vibe')).toMatchObject({ ok: true, status: 'ok', version: '3.1.2' });

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
    expect(parsePinManifest(readFileSync(env.manifest, 'utf8')).version).toBe('3.1.2');
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
