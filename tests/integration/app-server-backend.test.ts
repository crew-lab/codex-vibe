import { BUNDLED_SKILL_NAMES } from '../../src/backends/app-server/bundled-skills.js';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServerBackend, type AppServerBackendOptions, type AppServerTiming } from '../../src/backends/app-server.js';
import { ResolvedCredential, type CredentialResolution } from '../../src/backends/app-server/credentials.js';
import { PinCheckError } from '../../src/backends/app-server/pin.js';
import { CLIENT_ENTRYPOINT } from '../../src/backends/app-server/protocol.js';
import { PROFILE_TOOLS, TOOL_PERMISSION, workspaceDenylist } from '../../src/backends/app-server/session-config.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunLimits, RunMode, RunState, StartRunInput, SupervisorError } from '../../src/contracts.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const fixture = path.join(root, 'tests', 'fixtures', 'fake-vibe-app-server.mjs');
const scenarioDirectory = path.join(root, 'tests', 'fixtures', 'app-server-scenarios');
const SECRET = 'fake-credential-for-tests-abcdefgh';
const TERMINAL: readonly RunState[] = ['completed', 'failed', 'cancelled'];

type Json = Record<string, unknown>;
type Captured = Parameters<BackendCallbacks['onEvent']>[0];
type StateUpdate = Parameters<BackendCallbacks['onState']>[1];
interface CapturedState { state: RunState; update: StateUpdate }

const FAST_TIMING: Partial<AppServerTiming> = {
  interruptGraceMs: 300,
  stdinGraceMs: 300,
  terminateGraceMs: 300,
  interruptTimeoutMs: 500,
  statsThrottleMs: 0
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = read();
  while (!done(value) && Date.now() < until) {
    await sleep(20);
    value = read();
  }
  return value;
}

function pidGone(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}

interface HarnessOptions {
  mode?: RunMode;
  limits?: Partial<RunLimits>;
  options?: AppServerBackendOptions;
  task?: string;
  contextFiles?: string[];
  workspaceFiles?: Record<string, string>;
  gitRepository?: boolean;
}

class Harness {
  readonly base: string;
  readonly workspace: string;
  readonly runDirectory: string;
  readonly logFile: string;
  readonly backend: AppServerBackend;
  readonly input: StartRunInput;
  readonly events: Captured[] = [];
  readonly states: CapturedState[] = [];
  readonly activities: string[] = [];
  readonly order: string[] = [];
  handle: BackendRunHandle | undefined;
  private terminalResolve!: (value: CapturedState) => void;
  readonly terminal = new Promise<CapturedState>((resolve) => { this.terminalResolve = resolve; });

  constructor(scenario: string | Json, harness: HarnessOptions = {}) {
    this.base = realpathSync(mkdtempSync(path.join(tmpdir(), 'vsup-app-server-backend-')));
    this.workspace = path.join(this.base, 'workspace');
    this.runDirectory = path.join(this.base, 'run');
    this.logFile = path.join(this.base, 'fixture-log.jsonl');
    mkdirSync(path.join(this.workspace, 'src'), { recursive: true });
    mkdirSync(this.runDirectory, { recursive: true });
    writeFileSync(path.join(this.workspace, 'src', 'index.ts'), 'export const a = 1;\n');
    writeFileSync(path.join(this.workspace, '.env'), 'TOKEN=not-a-secret\n');
    for (const [name, content] of Object.entries(harness.workspaceFiles ?? {})) {
      mkdirSync(path.dirname(path.join(this.workspace, name)), { recursive: true });
      writeFileSync(path.join(this.workspace, name), content);
    }
    if (harness.gitRepository) execFileSync('git', ['init', '-q'], { cwd: this.workspace, stdio: 'ignore' });
    const scenarioFile = path.join(this.base, 'scenario.json');
    const document = typeof scenario === 'string' ? JSON.parse(readFileSync(path.join(scenarioDirectory, `${scenario}.json`), 'utf8')) as Json : scenario;
    const profileTools = Object.fromEntries(PROFILE_TOOLS[harness.mode ?? 'review'].map((tool) => [tool, { permission: TOOL_PERMISSION, denylist: workspaceDenylist(this.workspace) }]));
    const effective = { ...(document.effectiveConfig as Json | undefined) };
    writeFileSync(scenarioFile, JSON.stringify({ ...document, effectiveConfig: { ...effective, tools: { ...profileTools, ...(effective.tools as Json | undefined) } } }));
    const wrapper = path.join(this.base, 'vibe-app-server');
    writeFileSync(wrapper, `#!/bin/sh\nexport FAKE_VIBE_LOG='${this.logFile}'\nexec '${process.execPath}' '${fixture}' --scenario '${scenarioFile}'\n`);
    chmodSync(wrapper, 0o755);
    const supplied = harness.options ?? {};
    const options: AppServerBackendOptions = {
      executable: wrapper,
      preparation: { check: async () => ({ status: "passed" as const, candidate_sha256: null, version: "fixture", reason: "Fake ACP fixture evidence only" }) }, pin: { verify: async () => { this.order.push('pin'); } },
      resolveCredential: async (): Promise<CredentialResolution> => {
        this.order.push('credential');
        return { status: 'environment', detail: '', credential: new ResolvedCredential(SECRET) };
      },
      reaper: { pollMs: 50, graceMs: 200 },
      ...supplied,
      timing: { ...FAST_TIMING, ...supplied.timing }
    };
    this.backend = new AppServerBackend(DEFAULT_CONFIG, options);
    this.input = {
      runId: `run-${path.basename(this.base)}`,
      mode: harness.mode ?? 'review',
      task: harness.task ?? 'Review the repository.',
      cwd: this.workspace,
      workerWorkspace: this.workspace,
      runDirectory: this.runDirectory,
      ...(harness.contextFiles ? { contextFiles: harness.contextFiles } : {}),
      limits: { timeoutSeconds: 20, maxTurns: 20, maxEventBytes: 50_000_000, maxTranscriptBytes: 10_000_000, maxArtifactBytes: 10_000_000, ...harness.limits }
    };
    harnesses.push(this);
  }

  callbacks(): BackendCallbacks {
    return {
      onEvent: (event) => { this.events.push(event); },
      onActivity: (kind) => { this.activities.push(kind); },
      onSpawn: (handle) => { this.handle = handle; },
      onState: (state, update) => {
        this.states.push({ state, update });
        if (TERMINAL.includes(state)) this.terminalResolve({ state, update });
      }
    };
  }

  start(): Promise<BackendStartResult> {
    return this.backend.start(this.input, this.callbacks());
  }

  async run(): Promise<CapturedState> {
    const started = await this.start();
    this.handle = started.handle;
    return this.terminal;
  }

  log(): Json[] {
    if (!existsSync(this.logFile)) return [];
    return readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Json);
  }

  frames(method?: string): Json[] {
    return this.log().filter((entry) => entry.kind === 'frame').map((entry) => entry.frame as Json).filter((frame) => method === undefined || frame.method === method);
  }

  fixtureEvents(name: string): Json[] {
    return this.log().filter((entry) => entry.kind === 'event' && entry.name === name);
  }

  get pid(): number | undefined {
    const start = this.log().find((entry) => entry.kind === 'start');
    return typeof start?.pid === 'number' ? start.pid : undefined;
  }

  eventsOfType(type: string): Captured[] {
    return this.events.filter((event) => event.type === type);
  }

  terminalStates(): CapturedState[] {
    return this.states.filter((item) => TERMINAL.includes(item.state));
  }

  privateDirectories(): string[] {
    return ['child-home', 'vibe-home', 'tmp'].map((name) => path.join(this.runDirectory, name));
  }

  expectCleanedUp(): void {
    for (const directory of this.privateDirectories()) expect(existsSync(directory), directory).toBe(false);
    const pid = this.pid;
    if (pid !== undefined) expect(pidGone(pid)).toBe(true);
  }

  everythingEmitted(): string {
    return JSON.stringify({ events: this.events, states: this.states });
  }
}

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    if (harness.handle) await harness.backend.close(harness.handle).catch(() => undefined);
    const pid = harness.pid;
    if (pid !== undefined && !pidGone(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } }
    rmSync(harness.base, { recursive: true, force: true });
  }
});

function errorOf(state: CapturedState): SupervisorError {
  if (!state.update?.error) throw new Error(`state ${state.state} carries no error`);
  return state.update.error;
}

async function rejection(promise: Promise<unknown>): Promise<SupervisorError> {
  try { await promise; }
  catch (error) { return error as SupervisorError; }
  throw new Error('expected the promise to reject');
}

describe('app-server backend: clean runs', () => {
  it('completes a review through the whole protocol sequence and cleans up', async () => {
    const harness = new Harness('allowed-call');
    process.env.UNRELATED_SECRET_TOKEN = 'must-not-reach-the-child';
    let terminal: CapturedState;
    try { terminal = await harness.run(); } finally { delete process.env.UNRELATED_SECRET_TOKEN; }

    expect(harness.order).toEqual(['pin', 'credential']);
    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.stopReason).toBe('end_turn');
    expect(terminal.update?.result?.summary).toBe('The review found no issues.');
    expect(terminal.update?.result?.warnings).toBeUndefined();
    expect(harness.states[0]?.state).toBe('running');
    expect(harness.terminalStates()).toHaveLength(1);
    expect(harness.activities).toContain('stdout');

    const message = harness.eventsOfType('message');
    expect(message).toHaveLength(1);
    expect(message[0]?.data.text).toBe('The review found no issues.');
    const toolCall = harness.eventsOfType('tool_call');
    expect(toolCall).toHaveLength(1);
    expect(toolCall[0]?.data).toMatchObject({ name: 'read_file', tool: 'file_system.read_file', kind: 'read', outcome: 'executed' });

    expect(harness.states.flatMap(item => item.update?.modelObservations ?? [])).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'runtime/read', thinking: 'off' })]));
    expect(terminal.update?.usage?.tokensUsed).toBe(1500);
    expect(terminal.update?.usage?.cost?.authoritative).toBe(false);
    expect(terminal.update?.usage?.cost?.amount).toBeCloseTo(0.00108, 8);
    expect(terminal.update?.usage?.contextSize).toBe(128000);

    const methods = harness.frames().map((frame) => frame.method);
    const ordered = methods.filter((method): method is string => typeof method === 'string' && method !== 'callback/result');
    expect(ordered).toEqual([
      'initialize', 'initialized', 'session/start', 'session/ready/wait', 'runtime/read', 'config/effective/read', 'config/read',
      'config/model/write', 'runtime/read', 'config/effective/read', 'turn/start', 'runtime/read', 'session/history/list'
    ]);
    expect(harness.frames('initialize')[0]?.params).toMatchObject({ clientInfo: { name: 'vibe-supervisor', entrypoint: CLIENT_ENTRYPOINT }, capabilities: { callbackKinds: ['approval'] } });
    expect(harness.frames('config/model/write')[0]?.params).toEqual({ sessionId: 'fake-session-0001', reasoningEffort: 'off' });
    const turn = harness.frames('turn/start')[0]?.params as Json;
    expect(turn.message).toEqual([{ type: 'text', text: 'Review the repository.' }]);

    const answer = harness.fixtureEvents('approvalAnswer')[0];
    expect(answer).toMatchObject({ decision: 'approve', malformed: false, hasPathScope: false, feedback: null });

    expect(JSON.stringify(harness.events)).not.toContain('private reasoning');
    expect(harness.everythingEmitted()).not.toContain(SECRET);
    harness.expectCleanedUp();
  });

  it('starts the server with the exact session configuration, a private environment and no argv', async () => {
    const harness = new Harness('allowed-call');
    process.env.UNRELATED_SECRET_TOKEN = 'must-not-reach-the-child';
    try { await harness.run(); } finally { delete process.env.UNRELATED_SECRET_TOKEN; }

    const start = harness.log().find((entry) => entry.kind === 'start') as Json;
    expect(start.cwd).toBe(harness.runDirectory);
    expect(start.argv).toEqual(['--scenario', path.join(harness.base, 'scenario.json')]);
    expect(start.hasMistralApiKey).toBe(true);
    const environment = start.env as Json;
    expect(environment).toMatchObject({
      HOME: path.join(harness.runDirectory, 'child-home'),
      VIBE_HOME: path.join(harness.runDirectory, 'vibe-home'),
      TMPDIR: path.join(harness.runDirectory, 'tmp'),
      LOG_LEVEL: 'ERROR',
      VIBE_ENABLE_SUBAGENTS: 'false',
      VIBE_ENABLE_CONNECTORS: 'false',
      VIBE_SESSION_LOGGING__ENABLED: 'false',
      VIBE_ENABLE_TELEMETRY: 'false',
      VIBE_DISABLED_SKILLS: '["*"]'
    });
    expect(start.envNames).not.toContain('UNRELATED_SECRET_TOKEN');
    expect(start.envNames).toContain('VIBE_SUPERVISOR_CHILD');

    const session = harness.fixtureEvents('sessionStart')[0] as Json;
    expect(session.agentConfig).toEqual({
      cwd: harness.workspace,
      agent: 'supervisor-review',
      enabledTools: ['read_file'],
      disabledTools: ['ask_user_question', 'exit_plan_mode', 'cron'],
      maxTurns: 20,
      headless: true,
      autoApprove: false,
      trustWorkspace: false,
      workspaceRoots: [],
      mcpServers: []
    });
    expect(session.initializedNotificationSeen).toBe(true);
  });

  it('completes an edit with an approved search_replace and reports it as a write', async () => {
    const harness = new Harness('edit-call', { mode: 'edit' });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.summary).toBe('The edit was applied.');
    expect(harness.eventsOfType('tool_call')[0]?.data).toMatchObject({ name: 'edit', tool: 'file_system.search_replace', kind: 'edit', outcome: 'executed' });
    expect((harness.fixtureEvents('sessionStart')[0]?.agentConfig as Json).enabledTools).toEqual(['read_file', 'write_file', 'edit']);
    expect(harness.fixtureEvents('approvalAnswer')[0]).toMatchObject({ decision: 'approve' });
    harness.expectCleanedUp();
  });

  it.each([['review', ['read_file']], ['edit', ['read_file', 'write_file', 'edit']]] as const)('writes a private %s agent profile that asks for every profile tool and denies reserved paths', async (mode, tools) => {
    const harness = new Harness('hold', { mode });
    const started = await harness.start();
    const agent = mode === 'review' ? 'supervisor-review' : 'supervisor-edit';
    const profile = path.join(harness.runDirectory, 'vibe-home', 'agents', `${agent}.toml`);
    const document = parse(readFileSync(profile, 'utf8')) as Json;
    const denylist = workspaceDenylist(harness.workspace);

    expect(Object.keys(document.tools as Json).sort()).toEqual([...tools].sort());
    for (const tool of tools) expect((document.tools as Json)[tool]).toEqual({ permission: 'ask', denylist });
    expect(denylist).toContain(`${harness.workspace}/.git/**`);
    expect(denylist).toContain(`${harness.workspace}/**/.env`);
    for (const name of ['child-home', 'vibe-home', 'tmp']) expect(statSync(path.join(harness.runDirectory, name)).mode & 0o777).toBe(0o700);
    expect(statSync(profile).mode & 0o777).toBe(0o600);
    await harness.backend.close(started.handle);
    harness.expectCleanedUp();
  });

  it('owns the managed-config listener for the worker lifetime and closes it with the run', async () => {
    const harness = new Harness('hold');
    const started = await harness.start();
    const start = harness.log().find((entry) => entry.kind === 'start');
    const endpoint = (start?.env as Json).VIBE_VIBE_BASE_URL as string;
    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const url = `${endpoint}/api/v1/code/managed-config`;
    expect(await (await fetch(url)).json()).toEqual({ state: 'disabled' });
    await harness.backend.close(started.handle);
    await expect(fetch(url)).rejects.toThrow();
    harness.expectCleanedUp();
  });

  it('prefixes approved context paths to the task', async () => {
    const harness = new Harness('allowed-call', { contextFiles: ['/ws/a.ts', '/ws/b.ts'], task: 'Check them.' });
    await harness.run();
    const turn = harness.frames('turn/start')[0]?.params as Json;
    expect(turn.message).toEqual([{ type: 'text', text: 'Approved context path: /ws/a.ts\nApproved context path: /ws/b.ts\n\nTask:\nCheck them.' }]);
  });

  it('reads every server frame tolerantly: unknown fields, stale events and unknown notifications', async () => {
    for (const scenario of ['extra-fields', 'stale-event', 'unknown-notification']) {
      const harness = new Harness(scenario);
      const terminal = await harness.run();
      expect(terminal.state, scenario).toBe('completed');
    }
    const harness = new Harness('unknown-notification');
    await harness.run();
    const diagnostic = harness.eventsOfType('diagnostic').find((event) => event.data.reason === 'ignored_notifications');
    expect(diagnostic?.data).toMatchObject({ unknown_notifications: 1, unknown_methods: ['session/futureThing'] });
  });
});

describe('app-server backend: approvals and the event audit', () => {
  it('denies out-of-workspace, secret and off-profile calls and keeps running', async () => {
    const harness = new Harness('forbidden-call-approval');
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(harness.fixtureEvents('approvalAnswer').map((answer) => answer.decision)).toEqual(['deny', 'deny', 'deny']);
    expect(harness.eventsOfType('tool_denied').map((event) => event.data.reason)).toEqual(['path_outside_workspace', 'path_secret', 'tool_not_in_profile']);
    expect(harness.eventsOfType('tool_call')).toHaveLength(0);
    expect(terminal.update?.result?.summary).toBe('Some reads were refused.');
    harness.expectCleanedUp();
  });

  it('answers deny when an approval decision stalls past its deadline', async () => {
    const harness = new Harness('approval-stall', { options: { approvals: { deadlineMs: 150, evaluate: () => new Promise(() => undefined) } } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(harness.fixtureEvents('approvalAnswer')[0]).toMatchObject({ decision: 'deny' });
    expect(harness.eventsOfType('tool_denied')[0]?.data.reason).toBe('decision_deadline');
  });

  it('treats a policy denial of an off-profile tool as expected and continues', async () => {
    const harness = new Harness('off-profile-denied');
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(harness.eventsOfType('tool_denied')[0]?.data).toMatchObject({ tool: 'file_system.write_file', outcome: 'permission_denied_by_policy' });
    expect(harness.fixtureEvents('callbackCall')).toHaveLength(0);
  });

  it('treats a denylist denial of a profile tool as expected and continues', async () => {
    const harness = new Harness({
      name: 'denylist-on-profile-tool',
      steps: [
        { op: 'call', tool: 'file_system.read_file', mode: 'never', input: { filePath: '${cwd}/.env', offset: null, limit: 2000 } },
        { op: 'say', text: 'The denylist held.' }
      ]
    });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(harness.eventsOfType('tool_denied')[0]?.data).toMatchObject({ tool: 'file_system.read_file', outcome: 'permission_denied_by_policy' });
    expect(harness.eventsOfType('tool_call')).toHaveLength(0);
  });

  it('fails the run when an off-profile tool was executed', async () => {
    const harness = new Harness('off-profile-executed');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'unapproved_effect', tool: 'file_system.write_file' } });
    expect(harness.eventsOfType('message')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('fails the run when an in-profile tool was allowed without the handler', async () => {
    const harness = new Harness('auto-allowed-in-profile');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'unapproved_effect', tool: 'file_system.read_file' } });
  });

  it('fails the run when an effect carries no approval metadata', async () => {
    const harness = new Harness('unrecorded-approval-meta', { mode: 'edit' });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal).details).toMatchObject({ reason: 'unapproved_effect' });
  });

  it('stops on a watermark gap, resynchronizes from session/read and finds the hidden write', async () => {
    const harness = new Harness('watermark-gap');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'unapproved_effect', tool: 'file_system.write_file' } });
    expect(harness.frames('session/read').length).toBeGreaterThanOrEqual(1);
    harness.expectCleanedUp();
  });

  it('fails closed on an unknown history entry kind', async () => {
    const harness = new Harness('unknown-entry-kind');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'unknown_entry_kind' } });
    harness.expectCleanedUp();
  });

  it('never lets reasoning or the credential reach an emitted event', async () => {
    const harness = new Harness({
      name: 'secrets-and-reasoning',
      steps: [
        { op: 'reasoning', text: 'chain of thought that must never be persisted' },
        { op: 'say', text: `The key is ${SECRET} and api_key=abcdef123456 must be hidden.` }
      ]
    });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    const emitted = harness.everythingEmitted();
    expect(emitted).not.toContain('chain of thought');
    expect(emitted).not.toContain(SECRET);
    expect(emitted).not.toContain('abcdef123456');
    expect(emitted).toContain('[REDACTED]');
    expect(terminal.update?.result?.summary).not.toContain(SECRET);
    expect(harness.eventsOfType('diagnostic').find((event) => event.data.reason === 'reasoning_observation')?.data).toMatchObject({
      streamed_entries: 1, history_entries: 1, history_audited: true
    });
  });

  it('does not count the word reasoning in ordinary messages or configuration as a reasoning entry', async () => {
    const harness = new Harness({ name: 'reasoning-word-is-not-an-entry', steps: [{ op: 'say', text: 'The reasoning setting is off.' }] });
    const terminal = await harness.run();
    expect(terminal.state).toBe('completed');
    expect(harness.eventsOfType('diagnostic').find((event) => event.data.reason === 'reasoning_observation')?.data).toMatchObject({
      streamed_entries: 0, history_entries: 0, history_audited: true
    });
    harness.expectCleanedUp();
  });
});

describe('app-server backend: outcomes', () => {
  it('maps a turn limit to a completed run with the incomplete-result warning', async () => {
    const harness = new Harness('limit');
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.stopReason).toBe('turn_limit');
    expect(terminal.update?.result?.warnings?.[0]).toContain('stopped at a limit');
    expect(terminal.update?.result?.summary).toBe('Partial answer.');
  });

  it('maps a length stop to an output-limit failure', async () => {
    const terminal = await new Harness('length').run();
    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal).code).toBe('VSUP_OUTPUT_LIMIT');
  });

  it('fails a turn that was interrupted by something other than the supervisor', async () => {
    const terminal = await new Harness('interrupted').run();
    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { classification: 'unrequested_interrupt' } });
  });

  it('maps a failed turn error code to a retryable backend error', async () => {
    const terminal = await new Harness('failed').run();
    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', retryable: true, details: { error_code: 'backend_error' } });
  });

  it('maps provider error codes: auth, rate limit and refusal', async () => {
    const withError = (code: string) => ({ name: code, steps: [{ op: 'end', status: 'failed', error: { message: 'provider said no', code, details: null } }] });
    expect(errorOf(await new Harness(withError('invalid_api_key')).run()).code).toBe('VSUP_AUTH_REQUIRED');
    expect(errorOf(await new Harness(withError('rate_limit')).run()).code).toBe('VSUP_RATE_LIMITED');
    const refusal = await new Harness(withError('refusal')).run();
    expect(refusal.state).toBe('completed');
    expect(refusal.update?.result?.stopReason).toBe('refusal');
  });

  it('rebuilds usage from stats and cost from the snapshot prices', async () => {
    const harness = new Harness('stats-usage');
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.usage?.tokensUsed).toBe(5900);
    expect(terminal.update?.usage?.cost?.amount).toBeCloseTo(0.00308, 8);
    expect(terminal.update?.usage?.contextSize).toBe(128000);
    for (const item of harness.states.filter((entry) => entry.state === 'running' && entry.update?.usage)) {
      expect(item.update?.usage?.tokensUsed).toBeLessThanOrEqual(5900);
    }
  });

  it('interrupts when modelCalls pass the turn limit plus its margin and completes at the limit', async () => {
    const harness = new Harness({ name: 'turn-backstop', steps: [{ op: 'say', text: 'Working.' }, { op: 'stats', stats: { modelCalls: 99 } }, { op: 'hold' }] });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.stopReason).toBe('turn_limit');
    expect(harness.fixtureEvents('interrupt')).toHaveLength(1);
    expect(terminal.update?.result?.summary).toBe('Working.');
    harness.expectCleanedUp();
  });

  it('interrupts on the token ceiling', async () => {
    const harness = new Harness(
      { name: 'token-ceiling', steps: [{ op: 'stats', stats: { modelCalls: 1, sessionPromptTokens: 5000, sessionCompletionTokens: 10 } }, { op: 'hold' }] },
      { options: { budgets: { maxTokens: 100 } } }
    );
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.stopReason).toBe('token_limit');
    expect(harness.fixtureEvents('interrupt')).toHaveLength(1);
  });
});

describe('app-server backend: startup failures', () => {
  it('refuses to spawn when the pin check fails', async () => {
    const harness = new Harness('allowed-call', { options: { preparation: { check: async () => ({ status: "passed" as const, candidate_sha256: null, version: "fixture", reason: "Fake ACP fixture evidence only" }) }, pin: { verify: async () => { throw new PinCheckError('file-mismatch', 'Installed files differ from the pinned digests.', { mismatched: { total: 1 } }); } } } });
    const failure = await rejection(harness.start());

    expect(failure).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { reason: 'file-mismatch' } });
    expect(harness.log()).toEqual([]);
    expect(harness.order).toEqual([]);
    expect(existsSync(path.join(harness.runDirectory, 'child-home'))).toBe(false);
  });

  it('refuses to spawn without a pin manifest', async () => {
    const harness = new Harness('allowed-call', { options: { pin: {} } });
    const failure = await rejection(harness.start());
    expect(failure).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { reason: 'manifest-unreadable' } });
    expect(harness.log()).toEqual([]);
  });

  it('refuses to spawn when the credential is missing', async () => {
    const harness = new Harness('allowed-call', { options: { resolveCredential: async () => ({ status: 'not-found', detail: 'ai.mistral.vibe=not-found', credential: undefined }) } });
    const failure = await rejection(harness.start());

    expect(failure).toMatchObject({ code: 'VSUP_AUTH_REQUIRED', details: { credential_status: 'not-found' } });
    expect(harness.log()).toEqual([]);
  });

  it('rejects a workspace with project Vibe configuration before spawning', async () => {
    const harness = new Harness('allowed-call', { workspaceFiles: { '.vibe/config.toml': 'x = 1\n' } });
    const failure = await rejection(harness.start());

    expect(failure.code).toBe('VSUP_WORKSPACE_INVALID');
    expect(harness.log()).toEqual([]);
    harness.expectCleanedUp();
  });

  it('reports a missing app-server executable', async () => {
    const harness = new Harness('allowed-call', { options: { executable: '/nonexistent/vibe-app-server' } });
    const failure = await rejection(harness.start());
    expect(failure.code).toBe('VSUP_VIBE_NOT_FOUND');
  });

  it('fails when the server version is not the pinned one', async () => {
    const harness = new Harness({ name: 'drift', serverVersion: '2.27.0' });
    const failure = await rejection(harness.start());

    expect(failure).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { detected_version: '2.27.0' } });
    expect(harness.frames('session/start')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('classifies a server that exits during startup and keeps its stderr tail', async () => {
    const harness = new Harness('startup-failure');
    const failure = await rejection(harness.start());

    expect(failure.code).toBe('VSUP_BACKEND_CRASHED');
    expect(failure.message).toContain('code 1');
    expect(String(failure.details?.stderr_tail)).toContain('Unified Harness runtime could not be loaded');
    expect(harness.handle).toBeDefined();
    expect(harness.states).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('maps an unauthorized session/start to an authentication failure', async () => {
    const harness = new Harness('session-start-unauthorized');
    const failure = await rejection(harness.start());

    expect(failure.code).toBe('VSUP_AUTH_REQUIRED');
    expect(harness.frames('turn/start')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('rejects remote managed-config drift before a turn and releases its listener on failed start', async () => {
    const harness = new Harness({ name: 'managed-config-drift', effectiveConfig: { vibe_base_url: 'https://remote.example.test' } });
    const failure = await rejection(harness.start());
    expect(failure).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'readback_mismatch' } });
    expect(failure.details?.fields).toContain('config.vibe_base_url');
    expect(harness.frames('turn/start')).toHaveLength(0);
    const start = harness.log().find((entry) => entry.kind === 'start');
    const endpoint = (start?.env as Json).VIBE_VIBE_BASE_URL as string;
    await expect(fetch(`${endpoint}/api/v1/code/managed-config`)).rejects.toThrow();
    harness.expectCleanedUp();
  });

  it('accepts bundled plugin skills while retaining the exact file-tool profile', async () => {
    const skills = BUNDLED_SKILL_NAMES.map((name) => ({ name, source: 'plugin', scope: 'builtin', registry: null }));
    const harness = new Harness({ name: 'bundled-skills', harnessSelectionSource: null, runtime: { skills }, steps: [{ op: 'say', text: 'checked' }] });
    const terminal = await harness.run();
    expect(terminal.state).toBe('completed');
    expect(harness.frames('session/start')[0]?.params).toMatchObject({ agentConfig: { enabledTools: ['read_file'] } });
    await harness.backend.close(harness.handle!);
    harness.expectCleanedUp();
  });

  it('accepts the unified null selection-source response before a bounded turn', async () => {
    const harness = new Harness({ name: 'nullable-selection', harnessSelectionSource: null, steps: [{ op: 'say', text: 'checked' }] });
    await harness.start();
    const terminal = await harness.terminal;
    expect(terminal.state).toBe('completed');
    expect(harness.frames('turn/start')).toHaveLength(1);
    await harness.backend.close(harness.handle!);
    harness.expectCleanedUp();
  });

  it('fails a run whose read-back shows the supervisor configuration was not applied, before any turn', async () => {
    const harness = new Harness('readback-mismatch');
    const failure = await rejection(harness.start());

    expect(failure).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'readback_mismatch' } });
    expect(failure.details?.fields).toContain('runtime.hooksCount');
    expect(failure.message).toContain('hooksCount');
    expect(harness.frames('turn/start')).toHaveLength(0);
    expect(harness.states).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it.each([
    ['a different harness', { harness: 'legacy' }, 'session.harness'],
    ['bypassed tool permissions', { runtime: { bypassToolPermissions: true } }, 'runtime.bypassToolPermissions'],
    ['an MCP source', { runtime: { mcpSources: [{ name: 'x' }] } }, 'runtime.mcp.sources'],
    ['an extra tool', { runtime: { tools: ['read_file', 'write_file'] } }, 'runtime.tools'],
    ['settings the environment did not apply', { effectiveFromEnv: false }, 'config.enable_subagents']
  ])('fails the run on %s', async (_label, patch, field) => {
    const harness = new Harness({ name: 'readback-variant', steps: [{ op: 'say', text: 'must never run' }], ...patch });
    const failure = await rejection(harness.start());

    expect(failure.details?.reason).toBe('readback_mismatch');
    expect(failure.details?.fields).toContain(field);
    expect(harness.frames('turn/start')).toHaveLength(0);
  });

  it('fails the run when the thinking write is ignored (second read-back)', async () => {
    const harness = new Harness({ name: 'thinking-ignored', modelWrite: { ignore: true }, steps: [{ op: 'say', text: 'must never run' }] });
    const failure = await rejection(harness.start());

    expect(failure.details?.reason).toBe('readback_mismatch');
    expect(failure.details?.fields).toContain('runtime.config.activeModel.thinking');
    expect(harness.frames('config/model/write')).toHaveLength(1);
    expect(harness.frames('turn/start')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('fails with a classified error when the reaper cannot start', async () => {
    const harness = new Harness('allowed-call', { options: { reaper: { executable: '/nonexistent/node', startupTimeoutMs: 500 } } });
    const failure = await rejection(harness.start());

    expect(failure.code).toBe('VSUP_INTERNAL');
    harness.expectCleanedUp();
  });

  it('cancels during the handshake without leaking the process', async () => {
    const harness = new Harness('allowed-call');
    const started = harness.start().then(() => 'started' as const, (error: unknown) => error as SupervisorError);
    await waitFor(() => harness.handle, (handle) => handle !== undefined);
    await harness.backend.cancel(harness.handle as BackendRunHandle);
    const outcome = await started;

    expect(outcome).not.toBe('started');
    expect((outcome as SupervisorError).code).toBe('VSUP_CANCELLED');
    harness.expectCleanedUp();
  });
});

describe('app-server backend: transport failures', () => {
  it('fails with a crash when the server dies mid-turn and redacts its stderr', async () => {
    const harness = new Harness({
      name: 'crash-with-secret',
      steps: [{ op: 'say', text: 'Starting.' }, { op: 'crash', exitCode: 139, message: `fake crash holding ${SECRET}` }]
    });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_CRASHED' });
    expect(String(errorOf(terminal).details?.detail)).toContain('code 139');
    expect(harness.eventsOfType('diagnostic').some((event) => String(event.data.text).includes('fake crash'))).toBe(true);
    expect(harness.everythingEmitted()).not.toContain(SECRET);
    harness.expectCleanedUp();
  });

  it('fails with a crash when the server dies after a partial frame', async () => {
    const terminal = await new Harness('partial-frame-crash').run();
    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal).code).toBe('VSUP_BACKEND_CRASHED');
  });

  it('fails with a backend error on a malformed line', async () => {
    const harness = new Harness('malformed-line');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'malformed_frame' } });
    harness.expectCleanedUp();
  });

  it('fails with an output limit on an oversized frame', async () => {
    const harness = new Harness('oversized-frame', { limits: { maxEventBytes: 1_000_000 } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal).code).toBe('VSUP_OUTPUT_LIMIT');
    harness.expectCleanedUp();
  });

  it('group-kills a server that ignores stdin EOF', async () => {
    const harness = new Harness({ name: 'eof-ignored', eof: 'ignore', steps: [{ op: 'say', text: 'Done.' }] });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(harness.fixtureEvents('eof')).toHaveLength(1);
    harness.expectCleanedUp();
  });
});

describe('app-server backend: deadline, cancel, close and termination', () => {
  it('interrupts at the deadline and fails with a timeout', async () => {
    const harness = new Harness('hold', { limits: { timeoutSeconds: 3 } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal).code).toBe('VSUP_TIMEOUT');
    expect(harness.fixtureEvents('interrupt')).toHaveLength(1);
    harness.expectCleanedUp();
  }, 20_000);

  it('kills a wedged server that ignores SIGTERM and fails with a timeout', async () => {
    const harness = new Harness('wedge', { limits: { timeoutSeconds: 3 } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal).code).toBe('VSUP_TIMEOUT');
    expect(harness.fixtureEvents('wedged')).toHaveLength(1);
    expect(harness.fixtureEvents('signalIgnored').length).toBeGreaterThanOrEqual(1);
    harness.expectCleanedUp();
  }, 20_000);

  it('lets the reaper kill a wedged group at its recorded deadline', async () => {
    const harness = new Harness('wedge', { limits: { timeoutSeconds: 30 }, options: { timing: { reaperMarginMs: -28_000 }, reaper: { pollMs: 50, graceMs: 200 } } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal).code).toBe('VSUP_BACKEND_CRASHED');
    expect(harness.eventsOfType('diagnostic').some((event) => event.data.reason === 'reaper_fired')).toBe(true);
    harness.expectCleanedUp();
  }, 20_000);

  it('cancels mid-turn: interrupts, settles cancelled and cleans up', async () => {
    const harness = new Harness('hold');
    const started = await harness.start();
    await waitFor(() => harness.frames('turn/start'), (frames) => frames.length > 0);
    await harness.backend.cancel(started.handle);
    const terminal = await harness.terminal;

    expect(terminal.state).toBe('cancelled');
    expect(terminal.update?.result).toBeUndefined();
    expect(harness.fixtureEvents('interrupt')).toHaveLength(1);
    harness.expectCleanedUp();
    await harness.backend.close(started.handle);
    expect(harness.terminalStates()).toHaveLength(1);
  });

  it('cancels a server that ignores the interrupt by group-killing it after the grace period', async () => {
    const harness = new Harness('hold-ignore-interrupt');
    const started = await harness.start();
    await waitFor(() => harness.frames('turn/start'), (frames) => frames.length > 0);
    await harness.backend.cancel(started.handle);
    const terminal = await harness.terminal;

    expect(terminal.state).toBe('cancelled');
    expect(harness.fixtureEvents('interruptIgnored').length).toBeGreaterThanOrEqual(1);
    harness.expectCleanedUp();
  });

  it('terminateNow skips the grace period and still verifies termination', async () => {
    const harness = new Harness('hold-ignore-interrupt', { options: { timing: { interruptGraceMs: 10_000, stdinGraceMs: 10_000, terminateGraceMs: 10_000 } } });
    const started = await harness.start();
    await waitFor(() => harness.frames('turn/start'), (frames) => frames.length > 0);
    const begun = Date.now();
    await harness.backend.terminateNow?.(started.handle);
    const terminal = await harness.terminal;

    expect(Date.now() - begun).toBeLessThan(4000);
    expect(terminal.state).toBe('cancelled');
    expect(harness.fixtureEvents('interrupt')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('close on a live run cancels it and verifies termination', async () => {
    const harness = new Harness('hold');
    const started = await harness.start();
    await waitFor(() => harness.frames('turn/start'), (frames) => frames.length > 0);
    await harness.backend.close(started.handle);
    const terminal = await harness.terminal;

    expect(terminal.state).toBe('cancelled');
    harness.expectCleanedUp();
  });

  it('close after a completed run is a no-op that leaves one terminal state', async () => {
    const harness = new Harness('allowed-call');
    const terminal = await harness.run();
    await harness.backend.close(harness.handle as BackendRunHandle);
    await harness.backend.cancel(harness.handle as BackendRunHandle);

    expect(terminal.state).toBe('completed');
    expect(harness.terminalStates()).toHaveLength(1);
    harness.expectCleanedUp();
  });

  it('hands the handle out at spawn so a cancel can reach the process before start resolves', async () => {
    const harness = new Harness('allowed-call');
    const started = await harness.start();
    expect(harness.handle).toBe(started.handle);
    expect(started.initialState).toBe('running');
    expect(started.process?.executable).toContain('vibe-app-server');
    expect(typeof started.process?.pid).toBe('number');
    await harness.terminal;
  });
});

describe('app-server backend: probe and runtime check', () => {
  it('probes by verifying the pin without spawning', async () => {
    const harness = new Harness('allowed-call');
    const probe = await harness.backend.probe();

    expect(probe).toMatchObject({ available: true, version: '2.26.1' });
    expect(harness.log()).toEqual([]);

    const failing = new AppServerBackend(DEFAULT_CONFIG, { executable: '/x/vibe-app-server', preparation: { check: async () => ({ status: "passed" as const, candidate_sha256: null, version: "fixture", reason: "Fake ACP fixture evidence only" }) }, pin: { verify: async () => { throw new PinCheckError('file-mismatch', 'differs'); } } });
    expect(await failing.probe()).toMatchObject({ available: false, details: { code: 'VSUP_VIBE_VERSION_UNSUPPORTED' } });
    const unconfigured = new AppServerBackend(DEFAULT_CONFIG, { executable: '/x/vibe-app-server' });
    expect(await unconfigured.probe()).toMatchObject({ available: false, details: { code: 'VSUP_VIBE_VERSION_UNSUPPORTED' } });
  });

  it('derives the app-server executable from the configured vibe directory', async () => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'vsup-app-server-derive-')));
    try {
      writeFileSync(path.join(base, 'vibe'), '#!/bin/sh\n');
      writeFileSync(path.join(base, 'vibe-app-server'), '#!/bin/sh\n');
      chmodSync(path.join(base, 'vibe'), 0o755);
      chmodSync(path.join(base, 'vibe-app-server'), 0o755);
      const found = await new AppServerBackend({ ...DEFAULT_CONFIG, paths: { vibe: path.join(base, 'vibe') } }).runtimeCheck();
      expect(found).toMatchObject({ executable_found: true, resolved_executable: path.join(base, 'vibe-app-server'), pinned_version: '2.26.1', version_verified: false });
      rmSync(path.join(base, 'vibe-app-server'));
      const missing = await new AppServerBackend({ ...DEFAULT_CONFIG, paths: { vibe: path.join(base, 'vibe') } }).runtimeCheck();
      expect(missing).toMatchObject({ executable_found: false, resolved_executable: null });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('app-server backend: session handoff', () => {
  const NEXT = 'fake-session-0002';
  const sessionOf = (frame: Json | undefined): unknown => (frame?.params as Json | undefined)?.sessionId;

  it('follows a compaction mid-turn, reads the configuration back again and carries usage across the reset', async () => {
    const harness = new Harness('handoff-usage');
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.summary).toBe('Finished after the handoff.');
    expect(terminal.update?.result?.warnings).toEqual(['The Vibe session was compacted or cleared during the run; the supervisor followed the new session.']);
    expect(terminal.update?.usage?.tokensUsed).toBe(1600);
    expect(terminal.update?.usage?.cost?.amount).toBeCloseTo(0.00094, 9);

    expect(harness.fixtureEvents('handoff')).toMatchObject([{ handoffKind: 'compacted', previous: 'fake-session-0001', next: NEXT }]);
    expect(harness.frames('callback/result').map(sessionOf)).toEqual(['fake-session-0001', NEXT]);
    expect(harness.frames('session/read').map(sessionOf)).toEqual([NEXT]);
    const afterHandoff = harness.frames().filter((frame) => sessionOf(frame) === NEXT).map((frame) => frame.method);
    expect(afterHandoff.slice(0, 5)).toEqual(['session/read', 'session/history/list', 'runtime/read', 'config/effective/read', 'config/read']);
    expect(harness.eventsOfType('tool_call')).toHaveLength(2);
    expect(new Set(harness.eventsOfType('tool_call').map((event) => event.data.entry_id)).size).toBe(2);
    expect(harness.eventsOfType('diagnostic').find((event) => event.data.reason === 'session_handoff')?.data.text).toContain('read back again');
    harness.expectCleanedUp();
  });

  it('keeps enforcing the token ceiling on the totals after the counters reset', async () => {
    const harness = new Harness('handoff-usage', { options: { budgets: { maxTokens: 1500 } } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.stopReason).toBe('token_limit');
    expect(terminal.update?.usage?.tokensUsed).toBeGreaterThan(1500);
    expect(harness.fixtureEvents('interrupt')).toHaveLength(1);
    expect(harness.frames('turn/interrupt')[0]?.params).toMatchObject({ sessionId: NEXT });
  });

  it('follows a context clear whose counters kept growing, without counting the old session twice', async () => {
    const harness = new Harness('handoff-cumulative');
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.summary).toBe('Cleared and carried on.');
    expect(terminal.update?.usage?.tokensUsed).toBe(1800);
    expect(harness.fixtureEvents('handoff')).toMatchObject([{ handoffKind: 'contextCleared' }]);
  });

  it('fails closed when the handoff arrives while a callback is open', async () => {
    const harness = new Harness('handoff-pending-callback');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'session_handoff_unsafe' } });
    expect(errorOf(terminal).message).toContain('a callback is still open');
    expect(harness.frames('session/read')).toHaveLength(0);
    expect(harness.eventsOfType('message')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('fails closed when the handoff arrives with an effect that has not finished', async () => {
    const harness = new Harness('handoff-unfinished-effect');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ details: { reason: 'session_handoff_unsafe' } });
    expect(errorOf(terminal).message).toContain('have not finished');
    harness.expectCleanedUp();
  });

  it('fails when the new session does not carry the supervisor configuration', async () => {
    const harness = new Harness({
      name: 'handoff-config-drift',
      afterHandoff: { effectiveConfig: { tools: { read_file: { permission: 'always' } } } },
      steps: [{ op: 'handoff', kind: 'compacted', newSessionId: NEXT }, { op: 'hold' }]
    });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'readback_mismatch', fields: ['config.tools.read_file.permission'] } });
    expect(harness.fixtureEvents('interrupt').length).toBeLessThanOrEqual(1);
    harness.expectCleanedUp();
  });
});

describe('app-server backend: usage faults', () => {
  it('fails the run when a usage counter goes backwards outside a handoff', async () => {
    const harness = new Harness('counters-backwards');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'usage_counter_regressed', counter: 'promptTokens', previous: 5000, observed: 100 } });
    expect(harness.fixtureEvents('interrupt')).toHaveLength(1);
    harness.expectCleanedUp();
  });

  it('fails before the first turn when a cost ceiling is set and the model has no prices', async () => {
    const harness = new Harness('unpriced-model', { options: { budgets: { maxCost: 0.5 } } });
    const failure = await rejection(harness.start());

    expect(failure).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'price_unavailable', ceiling_usd: 0.5 } });
    expect(failure.message).toContain('cannot be enforced');
    expect(harness.frames('turn/start')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('still counts tokens of an unpriced model when no cost ceiling is set, and enforces a priced ceiling', async () => {
    const unpriced = await new Harness('unpriced-model').run();
    expect(unpriced.state).toBe('completed');
    expect(unpriced.update?.usage?.tokensUsed).toBe(15);
    expect(unpriced.update?.usage?.cost).toBeUndefined();
    const priced = await new Harness('stats-usage', { options: { budgets: { maxCost: 100 } } }).run();
    expect(priced.state).toBe('completed');
    const tripped = await new Harness('stats-usage', { options: { budgets: { maxCost: 0.0001 } } }).run();
    expect(tripped.update?.result?.stopReason).toBe('price_limit');
  });
});

describe('app-server backend: effect to callback binding', () => {
  it('fails when a second effect names the callback that was approved for the first', async () => {
    const harness = new Harness('approval-reused');
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'unapproved_effect', tool: 'file_system.read_file', entry_id: 'effect-action-0002' } });
    expect(errorOf(terminal).message).toContain('reuses an approval that belongs to another effect');
    expect(harness.fixtureEvents('approvalAnswer')).toHaveLength(1);
    harness.expectCleanedUp();
  });

  it('fails when the executed edit differs from the input the callback showed', async () => {
    const harness = new Harness('args-altered', { mode: 'edit' });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ details: { reason: 'unapproved_effect', tool: 'file_system.search_replace' } });
    expect(errorOf(terminal).message).toContain('the executed input differs from the approved input');
    expect(harness.fixtureEvents('approvalAnswer')[0]).toMatchObject({ decision: 'approve' });
    expect(harness.eventsOfType('tool_call')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it('fails when the input of the effect entry is patched after the approval', async () => {
    const harness = new Harness('args-altered-after-approval', { mode: 'edit' });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ details: { reason: 'unapproved_effect', tool: 'file_system.search_replace' } });
    expect(errorOf(terminal).message).toContain('the executed input differs from the approved input');
  });

  it('accepts the unchanged edit the callback showed', async () => {
    const harness = new Harness('edit-call', { mode: 'edit' });
    expect((await harness.run()).state).toBe('completed');
  });
});

describe('app-server backend: workspace file listing in the prompt', () => {
  const files = {
    'README.md': '# demo\n',
    'docs/guide.md': 'guide\n',
    'config/.env.production': 'A=1\n',
    'keys/server.pem': 'pem\n',
    '.vibeignore': '*\n',
    '.gitignore': 'ignored.log\n',
    'ignored.log': 'noise\n'
  };
  const promptOf = (harness: Harness): string => ((harness.frames('turn/start')[0]?.params as Json).message as Array<{ text: string }>)[0]?.text ?? '';

  it('puts a bounded listing of the allowed files before the context paths and the task in a review', async () => {
    const harness = new Harness('allowed-call', { gitRepository: true, workspaceFiles: files, contextFiles: ['/ws/a.ts'], task: 'Check them.' });
    await harness.run();
    const prompt = promptOf(harness);

    expect(prompt.startsWith('Workspace files (paths relative to the workspace root):\n- .gitignore\n- README.md\n- docs/guide.md\n- src/index.ts\n\nApproved context path: /ws/a.ts\n\nTask:\nCheck them.')).toBe(true);
    for (const hidden of ['.env', 'config/.env.production', 'keys/server.pem', '.vibeignore', 'ignored.log', '.git/']) expect(prompt, hidden).not.toContain(hidden);
    expect(prompt).not.toContain('truncated');
    expect(harness.eventsOfType('diagnostic').filter((event) => event.data.reason === 'file_listing_unavailable')).toHaveLength(0);
  });

  it('includes the same listing in an edit run', async () => {
    const harness = new Harness('edit-call', { mode: 'edit', gitRepository: true, workspaceFiles: files });
    await harness.run();
    expect(promptOf(harness)).toContain('- docs/guide.md');
  });

  it('says plainly when the listing was truncated by the file count', async () => {
    const harness = new Harness('allowed-call', { gitRepository: true, workspaceFiles: files, options: { listing: { maxFiles: 2 } } });
    await harness.run();
    const prompt = promptOf(harness);

    expect(prompt).toContain('- .gitignore\n- README.md\n[Listing truncated: 2 more files not shown; the limit is 2 files or 32768 bytes.]');
    expect(prompt).not.toContain('docs/guide.md');
  });

  it('says plainly when the listing was truncated by its byte budget', async () => {
    const harness = new Harness('allowed-call', { gitRepository: true, workspaceFiles: files, options: { listing: { maxBytes: 90 } } });
    await harness.run();
    expect(promptOf(harness)).toMatch(/\[Listing truncated: \d+ more files? not shown; the limit is 1000 files or 90 bytes\.\]/);
  });

  it('leaves the prompt as it was outside a Git repository, without a diagnostic', async () => {
    const harness = new Harness('allowed-call', { workspaceFiles: files });
    await harness.run();
    expect(promptOf(harness)).toBe('Review the repository.');
    expect(harness.eventsOfType('diagnostic').filter((event) => event.data.reason === 'file_listing_unavailable')).toHaveLength(0);
  });

  it('leaves the listing out and reports it when Git output exceeds its cap', async () => {
    const harness = new Harness('allowed-call', { gitRepository: true, workspaceFiles: files, options: { listing: { maxGitOutputBytes: 10 } } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(promptOf(harness)).toBe('Review the repository.');
    expect(harness.eventsOfType('diagnostic').find((event) => event.data.reason === 'file_listing_unavailable')?.data).toMatchObject({ detail: 'output_limit' });
  });
});

const SILENT_WRITE = { op: 'call', tool: 'file_system.write_file', mode: 'auto', source: 'bypass', silent: true, input: { filePath: '${cwd}/src/hidden.ts', content: 'hidden\n' } };
const OVER_CEILING = { op: 'stats', stats: { modelCalls: 1, sessionPromptTokens: 5000, sessionCompletionTokens: 10 } };

describe('app-server backend: audit after a forced limit stop', () => {
  it('audits the history after a budget interrupt the server ignored and catches an unapproved write', async () => {
    const harness = new Harness(
      { name: 'budget-hidden-write', interrupt: 'ignore', steps: [OVER_CEILING, SILENT_WRITE, { op: 'hold' }] },
      { options: { budgets: { maxTokens: 100 } } }
    );
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'unapproved_effect', tool: 'file_system.write_file' } });
    expect(harness.frames('session/history/list').length).toBeGreaterThanOrEqual(1);
    harness.expectCleanedUp();
  });

  it('does not report a clean completed budget stop when the audit could not run', async () => {
    const harness = new Harness(
      { name: 'budget-audit-fails', interrupt: 'ignore', errors: { 'session/history/list': { code: 'internal_error', message: 'history unavailable' } }, steps: [OVER_CEILING, { op: 'hold' }] },
      { options: { budgets: { maxTokens: 100 } } }
    );
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal).code).toBe('VSUP_BACKEND_ERROR');
    expect(terminal.update?.result).toBeUndefined();
    harness.expectCleanedUp();
  });

  it('still completes a budget stop with the incomplete-result warning when the audit passes', async () => {
    const harness = new Harness(
      { name: 'budget-clean-forced', interrupt: 'ignore', steps: [OVER_CEILING, { op: 'say', text: 'Partial.' }, { op: 'hold' }] },
      { options: { budgets: { maxTokens: 100 } } }
    );
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.stopReason).toBe('token_limit');
    expect(terminal.update?.result?.warnings?.length).toBeGreaterThan(0);
    expect(harness.frames('session/history/list').length).toBeGreaterThanOrEqual(1);
  });

  it('audits the history at the deadline and reports the unapproved write instead of a plain timeout', async () => {
    const harness = new Harness({ name: 'deadline-hidden-write', interrupt: 'ignore', steps: [SILENT_WRITE, { op: 'hold' }] }, { limits: { timeoutSeconds: 3 } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'unapproved_effect' } });
    harness.expectCleanedUp();
  }, 20_000);
});

describe('app-server backend: stop requests revoke the approval handler', () => {
  const lateCall = { op: 'call', tool: 'file_system.read_file', mode: 'approval', input: { filePath: '${cwd}/src/index.ts', offset: null, limit: 2000 } };

  async function lateCallRun(scenario: Json, harnessOptions: HarnessOptions, stop: (harness: Harness, started: BackendStartResult) => Promise<void>): Promise<{ harness: Harness; evaluated: number }> {
    let evaluated = 0;
    const harness = new Harness(scenario, {
      ...harnessOptions,
      options: {
        ...harnessOptions.options,
        timing: { interruptGraceMs: 1500, ...harnessOptions.options?.timing },
        approvals: { evaluate: async () => { evaluated += 1; return { decision: 'approve', reason: null }; } }
      }
    });
    const started = await harness.start();
    await waitFor(() => harness.frames('turn/start'), (frames) => frames.length > 0);
    await stop(harness, started);
    await waitFor(() => harness.fixtureEvents('approvalAnswer'), (answers) => answers.length > 0, 3000);
    return { harness, evaluated };
  }

  it('denies a callback that arrives after a cancel without consulting the policy', async () => {
    const { harness, evaluated } = await lateCallRun(
      { name: 'late-after-cancel', interrupt: 'ignore', steps: [{ op: 'delay', ms: 300 }, lateCall, { op: 'hold' }] },
      {},
      async (run, started) => { void run.backend.cancel(started.handle); }
    );
    await harness.terminal;

    expect(evaluated).toBe(0);
    expect(harness.fixtureEvents('approvalAnswer')[0]).toMatchObject({ decision: 'deny' });
  });

  it('denies a callback that arrives after the budget interrupt', async () => {
    const { harness, evaluated } = await lateCallRun(
      { name: 'late-after-budget', interrupt: 'ignore', steps: [OVER_CEILING, { op: 'delay', ms: 300 }, lateCall, { op: 'hold' }] },
      { options: { budgets: { maxTokens: 100 } } },
      async () => undefined
    );
    await harness.terminal;

    expect(evaluated).toBe(0);
    expect(harness.fixtureEvents('approvalAnswer')[0]).toMatchObject({ decision: 'deny' });
  });

  it('denies a callback that arrives after the deadline interrupt', async () => {
    const { harness, evaluated } = await lateCallRun(
      { name: 'late-after-deadline', interrupt: 'ignore', steps: [{ op: 'delay', ms: 3300 }, lateCall, { op: 'hold' }] },
      { limits: { timeoutSeconds: 3 }, options: { timing: { interruptGraceMs: 5000 } } },
      async () => undefined
    );
    await harness.terminal;

    expect(evaluated).toBe(0);
    expect(harness.fixtureEvents('approvalAnswer')[0]).toMatchObject({ decision: 'deny' });
  }, 20_000);
});

describe('app-server backend: protocol failures outrank a later stop request', () => {
  const gapThenHold = { name: 'gap-then-hold', interrupt: 'ignore', steps: [{ op: 'reasoning', text: 'hidden', silent: true }, { op: 'say', text: 'After the gap.' }, { op: 'hold' }] };

  it('keeps the watermark gap error and mentions the cancel that came after it', async () => {
    const harness = new Harness(gapThenHold, { options: { timing: { interruptGraceMs: 3000 } } });
    const started = await harness.start();
    await waitFor(() => harness.frames('session/read'), (frames) => frames.length > 0);
    void harness.backend.cancel(started.handle);
    const terminal = await harness.terminal;

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'watermark_gap', also: ['cancelled'] } });
    expect(errorOf(terminal).message).toContain('also cancelled');
    harness.expectCleanedUp();
  });

  it('keeps the watermark gap error when the deadline arrives after it', async () => {
    const harness = new Harness(gapThenHold, { limits: { timeoutSeconds: 3 }, options: { timing: { interruptGraceMs: 5000 } } });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'watermark_gap', also: ['deadline'] } });
    harness.expectCleanedUp();
  }, 20_000);

  it('still reports a plain timeout when no protocol failure came first', async () => {
    const harness = new Harness({ name: 'plain-deadline', interrupt: 'ignore', steps: [{ op: 'hold' }] }, { limits: { timeoutSeconds: 3 } });
    const terminal = await harness.run();

    expect(errorOf(terminal).code).toBe('VSUP_TIMEOUT');
  }, 20_000);
});

describe('app-server backend: notifications in the turn/start response chunk', () => {
  it('lets the queued notifications advance the watermark instead of dropping them as stale', async () => {
    const harness = new Harness({ name: 'early-notifications', notifyBeforeTurnResponse: 6, steps: [{ op: 'say', text: 'Done.' }] });
    const terminal = await harness.run();

    expect(terminal.state).toBe('completed');
    expect(terminal.update?.result?.summary).toBe('Done.');
    expect(harness.eventsOfType('diagnostic').filter((event) => event.data.reason === 'ignored_notifications')).toEqual([]);
    harness.expectCleanedUp();
  });
});

describe('app-server backend: configuration counts and unfinished effects', () => {
  it.each(['hooksCount', 'skillsCount'])('treats a missing %s in config/read as a read-back mismatch', async (field) => {
    const harness = new Harness({ name: `no-${field}`, omit: { 'config/read': [field] }, steps: [{ op: 'say', text: 'unreachable' }] });
    const failure = await rejection(harness.start());

    expect(failure.code).toBe('VSUP_BACKEND_ERROR');
    expect(failure.details).toMatchObject({ reason: 'readback_mismatch' });
    expect(failure.details?.fields).toContain(`config/read.${field}`);
    expect(harness.frames('turn/start')).toHaveLength(0);
    harness.expectCleanedUp();
  });

  it.each(['running', 'blocked'])('fails closed when the turn completes while an effect is still %s', async (status) => {
    const harness = new Harness({
      name: `completed-with-${status}-effect`,
      steps: [{ op: 'call', tool: 'file_system.read_file', mode: 'pending', status, input: { filePath: '${cwd}/src/index.ts' } }, { op: 'say', text: 'Done.' }]
    });
    const terminal = await harness.run();

    expect(terminal.state).toBe('failed');
    expect(errorOf(terminal)).toMatchObject({ code: 'VSUP_BACKEND_ERROR', details: { reason: 'unfinished_effect' } });
    expect(terminal.update?.result).toBeUndefined();
    harness.expectCleanedUp();
  });
});
