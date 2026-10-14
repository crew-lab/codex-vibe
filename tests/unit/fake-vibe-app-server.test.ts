import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..');
const fixture = path.join(root, 'tests', 'fixtures', 'fake-vibe-app-server.mjs');
const scenarioDirectory = path.join(root, 'tests', 'fixtures', 'app-server-scenarios');
const watermark = 7;
const secretValue = 'sk-test-not-a-real-credential-value';

type Json = Record<string, unknown>;
type Exit = { code: number | null; signal: NodeJS.Signals | null };

function at(value: unknown, dotted: string): unknown {
  let cursor: unknown = value;
  for (const part of dotted.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

async function thinking(client: FakeClient): Promise<unknown> {
  const effective = await client.ok('config/effective/read', { sessionId: 'fake-session-0001' });
  return at((at(effective, 'config.models') as Json)['mistral-medium-3.5'], 'thinking');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let workDirectory = '';
const clients: FakeClient[] = [];

beforeEach(() => { workDirectory = mkdtempSync(path.join(tmpdir(), 'fake-vibe-test-')); });
afterEach(() => {
  for (const client of clients.splice(0)) client.kill();
  rmSync(workDirectory, { recursive: true, force: true });
});

function scenarioFile(name: string, patch?: Json): string {
  const base = JSON.parse(readFileSync(path.join(scenarioDirectory, `${name}.json`), 'utf8')) as Json;
  const file = path.join(workDirectory, `${name}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ ...base, ...patch }));
  return file;
}

class FakeClient {
  readonly child: ChildProcessWithoutNullStreams;
  readonly frames: Json[] = [];
  readonly notifications: Json[] = [];
  readonly serverRequests: Json[] = [];
  readonly rawLines: string[] = [];
  readonly logPath: string;
  readonly exited: Promise<Exit>;
  stderr = '';
  exit: Exit | null = null;
  buffered = '';
  private nextId = 1;
  private readonly pending = new Map<number, (frame: Json) => void>();

  constructor(scenario: string | Json, env: Record<string, string> = {}, extraArgs: string[] = []) {
    this.logPath = path.join(workDirectory, `log-${Math.random().toString(36).slice(2)}.jsonl`);
    const scenarioPath = typeof scenario === 'string'
      ? (scenario.endsWith('.json') && path.isAbsolute(scenario) ? scenario : scenarioFile(scenario))
      : this.writeInline(scenario);
    this.child = spawn(process.execPath, [fixture, '--scenario', scenarioPath, ...extraArgs], {
      env: { PATH: process.env.PATH ?? '', HOME: workDirectory, TMPDIR: workDirectory, FAKE_VIBE_LOG: this.logPath, MISTRAL_API_KEY: secretValue, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.child.stderr.on('data', (chunk: string) => { this.stderr += chunk; });
    this.child.stdin.on('error', () => undefined);
    this.exited = new Promise((resolve) => {
      this.child.once('exit', (code, signal) => { this.exit = { code, signal }; resolve(this.exit); });
    });
    clients.push(this);
  }

  private writeInline(scenario: Json): string {
    const file = path.join(workDirectory, `inline-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(scenario));
    return file;
  }

  private onData(chunk: string) {
    this.buffered += chunk;
    for (;;) {
      const newline = this.buffered.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffered.slice(0, newline);
      this.buffered = this.buffered.slice(newline + 1);
      this.rawLines.push(line.length > 200 ? `${line.slice(0, 200)}...(${line.length})` : line);
      let frame: Json;
      try { frame = JSON.parse(line) as Json; } catch { continue; }
      this.frames.push(frame);
      if ('id' in frame && ('result' in frame || 'error' in frame)) this.pending.get(frame.id as number)?.(frame);
      else if ('id' in frame && typeof frame.method === 'string') this.serverRequests.push(frame);
      else if (typeof frame.method === 'string') this.notifications.push(frame);
    }
  }

  sendRaw(text: string) { this.child.stdin.write(text); }
  sendFrame(frame: Json) { this.sendRaw(`${JSON.stringify(frame)}\n`); }
  notify(method: string, params: Json = {}) { this.sendFrame({ jsonrpc: '2.0', method, params }); }

  call(method: string, params: Json = {}): Promise<Json> {
    const id = this.nextId++;
    const response = new Promise<Json>((resolve) => this.pending.set(id, resolve));
    this.sendFrame({ jsonrpc: '2.0', id, method, params });
    return response;
  }

  async ok(method: string, params: Json = {}): Promise<Json> {
    const frame = await this.call(method, params);
    if (frame.error) throw new Error(`${method} failed: ${JSON.stringify(frame.error)}`);
    return frame.result as Json;
  }

  acknowledge(request: Json) {
    this.sendFrame({ jsonrpc: '2.0', id: request.id, result: { callbackId: at(request, 'params.callback.callbackId'), accepted: true } });
  }

  answer(request: Json, type: string, extra: Json = {}) {
    return this.call('callback/result', {
      sessionId: 'fake-session-0001',
      result: { callbackId: at(request, 'params.callback.callbackId'), output: { type: 'approval', decision: { type }, feedback: null, ...extra } }
    });
  }

  async handshake(callbackKinds: string[] = ['approval']) {
    const result = await this.ok('initialize', {
      clientInfo: { name: 'vibe-supervisor', version: '2.0.0', entrypoint: 'programmatic' },
      capabilities: { callbackKinds, clientTools: [], disabledNotifications: [] }
    });
    this.notify('initialized', {});
    return result;
  }

  async open(agentConfig: Json = {}, callbackKinds?: string[]) {
    await this.handshake(callbackKinds);
    const started = await this.ok('session/start', { agentConfig: { cwd: '/work/space', enabledTools: ['read_file'], headless: true, ...agentConfig } });
    await this.ok('session/ready/wait', { sessionId: 'fake-session-0001' });
    return started;
  }

  async startTurn(text = 'review this') {
    const result = await this.ok('turn/start', { sessionId: 'fake-session-0001', message: [{ type: 'text', text }] });
    return at(result, 'turn.id') as string;
  }

  async waitFor<T>(find: () => T | undefined, timeoutMs = 5000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = find();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`timed out; frames: ${JSON.stringify(this.frames.slice(-6))}; stderr: ${this.stderr}`);
      await sleep(10);
    }
  }

  completion(index = 0) {
    return this.waitFor(() => this.notifications.filter((n) => n.method === 'turn/completed')[index]);
  }

  serverRequest(index = 0) {
    return this.waitFor(() => this.serverRequests.filter((r) => r.method === 'callback/call')[index]);
  }

  named(method: string) { return this.notifications.filter((n) => n.method === method); }

  log(): Json[] {
    if (!existsSync(this.logPath)) return [];
    return readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Json);
  }

  logEvents(name: string) { return this.log().filter((record) => record.kind === 'event' && record.name === name); }
  sentFrames() { return this.log().filter((record) => record.kind === 'frame').map((record) => record.frame as Json); }
  storeDirectories() { return readdirSync(workDirectory).filter((entry) => entry.startsWith('vibe-session-logging-disabled-')); }

  closeStdin() { this.child.stdin.end(); }
  kill() { try { this.child.kill('SIGKILL'); } catch { /* already gone */ } }
}

describe('fake vibe-app-server handshake and strictness', () => {
  it('answers initialize with serverInfo and processId only, and gates everything else', async () => {
    const client = new FakeClient('allowed-call');
    const early = await client.call('runtime/read', { sessionId: 'x' });
    expect(at(early, 'error.code')).toBe('not_initialized');
    const result = await client.handshake();
    expect(Object.keys(result).sort()).toEqual(['processId', 'serverInfo']);
    expect(result.serverInfo).toEqual({ name: 'vibe-app-server', version: '2.26.1' });
    expect(result.processId).toBe(client.child.pid);
    expect(at(await client.call('initialize', { clientInfo: { name: 'a', version: '1' } }), 'error.code')).toBe('invalid_request');
    expect(at(await client.call('shell/run', {}), 'error.code')).toBe('method_not_found');
    expect(typeof at(await client.call('shell/run', {}), 'error.message')).toBe('string');
  });

  it('rejects unknown and snake_case fields with invalid_params issues, as the strict models do', async () => {
    const client = new FakeClient('allowed-call');
    await client.handshake();
    const snake = await client.call('session/start', { agent_config: { cwd: '/work' } });
    expect(at(snake, 'error.code')).toBe('invalid_params');
    expect(at(snake, 'error.data.errorCount')).toBe(1);
    expect(at(snake, 'error.data.issues')).toEqual([{ path: ['agent_config'], message: 'Extra inputs are not permitted' }]);
    const nested = await client.call('session/start', { agentConfig: { max_turns: 3, maxTurns: 'x', trustWorkspace: 'yes' } });
    const messages = (at(nested, 'error.data.issues') as Array<{ path: string[]; message: string }>).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    expect(messages).toEqual(expect.arrayContaining(['agentConfig.max_turns: Extra inputs are not permitted', 'agentConfig.maxTurns: Input should be a valid integer', 'agentConfig.trustWorkspace: Input should be a valid boolean']));
    client.sendFrame({ jsonrpc: '2.0', id: 900, method: 'runtime/read' });
    const noParams = await client.waitFor(() => client.frames.find((frame) => frame.id === 900));
    expect(at(noParams, 'error.code')).toBe('invalid_request');
    const badMessage = await client.call('turn/start', { sessionId: 's', message: [{ type: 'text' }] });
    expect(at(badMessage, 'error.data.issues')).toEqual([{ path: ['message', 0, 'text'], message: 'Field required' }]);
  });

  it('ends the connection on an unknown client notification, invalid JSON and an unknown scenario key', async () => {
    const unknownNotification = new FakeClient('allowed-call');
    await unknownNotification.handshake();
    unknownNotification.notify('session/futureThing', {});
    expect((await unknownNotification.exited).code).toBe(1);
    expect(unknownNotification.stderr).toContain('unknown client notification');

    const invalidJson = new FakeClient('allowed-call');
    await invalidJson.handshake();
    invalidJson.sendRaw('{broken\n');
    expect((await invalidJson.exited).code).toBe(1);
    expect(invalidJson.logEvents('fatal')).toHaveLength(1);

    const badScenario = new FakeClient({ name: 'typo', stepz: [] });
    expect((await badScenario.exited).code).toBe(2);
    expect(badScenario.stderr).toContain('unknown scenario key: stepz');
  });

  it('refuses a camelCase violation in scenario call input so the fixture cannot drift to snake_case', async () => {
    const client = new FakeClient({ steps: [{ op: 'call', tool: 'file_system.read_file', input: { file_path: '/x' } }] });
    expect((await client.exited).code).toBe(2);
    expect(client.stderr).toContain('camelCase');
  });

  it('refuses short tool names, unknown input keys and a malformed edit so scenarios stay on the Unified wire shapes', async () => {
    const rows: Array<[Json, string]> = [
      [{ op: 'call', tool: 'read_file', input: { filePath: '/x' } }, 'wire name'],
      [{ op: 'call', tool: 'edit', input: { filePath: '/x' } }, 'wire name'],
      [{ op: 'call', tool: 'file_system.read_file', input: { filePath: '/x', path: '/x' } }, 'unknown key'],
      [{ op: 'call', tool: 'file_system.write_file', input: { filePath: '/x' } }, 'content must be a string'],
      [{ op: 'call', tool: 'file_system.search_replace', input: { filePath: '/x', changes: [] } }, 'non-empty'],
      [{ op: 'call', tool: 'file_system.search_replace', input: { filePath: '/x', changes: [{ oldString: 'a', new_string: 'b' }] } }, 'camelCase']
    ];
    for (const [step, message] of rows) {
      const client = new FakeClient({ steps: [step] });
      expect((await client.exited).code).toBe(2);
      expect(client.stderr).toContain(message);
    }
    const generic = new FakeClient({ steps: [{ op: 'call', tool: 'file_system.read_file', generic: true, input: { path: '/x' } }] });
    await generic.open();
    expect(generic.exit).toBeNull();
  });

  it('accepts the scenario path from the environment as well as argv', async () => {
    const file = scenarioFile('allowed-call');
    const child = spawn(process.execPath, [fixture], { env: { PATH: process.env.PATH ?? '', FAKE_VIBE_SCENARIO: file, FAKE_VIBE_LOG: path.join(workDirectory, 'env.jsonl') }, stdio: ['pipe', 'pipe', 'pipe'] });
    const line = await new Promise<string>((resolve) => {
      child.stdout.setEncoding('utf8');
      child.stdout.once('data', (chunk: string) => resolve(chunk));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'a', version: '1' } } })}\n`);
    });
    expect(JSON.parse(line).result.serverInfo.version).toBe('2.26.1');
    child.kill('SIGKILL');
  });
});

describe('fake vibe-app-server session and read-back', () => {
  it('returns the snapshot and watermark together, with notifications only after the response', async () => {
    const client = new FakeClient('allowed-call');
    const started = await client.open();
    expect(started.lastEventId).toBe(watermark);
    expect(at(started, 'state.eventId')).toBe(watermark);
    expect(at(started, 'state.session.harness')).toBe('unified');
    expect(at(started, 'state.session.status')).toEqual({ type: 'idle' });
    expect(at(started, 'state.session.cwd')).toBe('/work/space');
    expect(client.notifications).toEqual([]);
    expect(at(await client.call('session/start', {}), 'error.code')).toBe('conflict');
    expect(client.logEvents('sessionStart')[0]).toMatchObject({ initializedNotificationSeen: true });
  });

  it('reports runtime, effective config and harness selection that follow what the client sent', async () => {
    const client = new FakeClient('allowed-call', { VIBE_ENABLE_SUBAGENTS: 'false', VIBE_TOOLS__READ_FILE__PERMISSION: 'ask', VIBE_DISABLED_SKILLS: '["*"]', VIBE_SESSION_LOGGING__ENABLED: 'false' });
    await client.handshake();
    await client.ok('session/start', { agentConfig: { cwd: '/work/space', enabledTools: ['read_file', 'edit'], disabledTools: ['edit'], autoApprove: false } });
    const before = await client.ok('runtime/read', { sessionId: 'fake-session-0001' });
    expect(before.ready).toBe(false);
    await client.ok('session/ready/wait', { sessionId: 'fake-session-0001' });
    const runtime = await client.ok('runtime/read', { sessionId: 'fake-session-0001' });
    expect(runtime.ready).toBe(true);
    expect(at(runtime, 'runtime.tools')).toEqual([{ name: 'read_file', isCustom: false }]);
    expect(at(runtime, 'runtime.skills')).toEqual([]);
    expect(at(runtime, 'runtime.mcp.sources')).toEqual([]);
    expect(at(runtime, 'runtime.connectors')).toEqual({ connected: 0, total: null });
    expect(at(runtime, 'runtime.experimentalHarness')).toBe(true);
    expect(at(runtime, 'runtime.hooksCount')).toBe(0);
    expect(at(runtime, 'runtime.issues')).toEqual([]);
    expect(at(runtime, 'runtime.bypassToolPermissions')).toBe(false);
    expect(at(runtime, 'runtime.stats.modelCalls')).toBeNull();
    expect(at(runtime, 'sessionLog.enabled')).toBe(false);
    const effective = await client.ok('config/effective/read', { sessionId: 'fake-session-0001' });
    expect(effective.config).toMatchObject({
      enable_subagents: false, enable_background_processes: true, disabled_skills: ['*'], tools: { read_file: { permission: 'ask' } },
      enabled_tools: ['read_file', 'edit'], disabled_tools: ['edit'], bypass_tool_permissions: false, active_model: '',
      session_logging: { enabled: false, session_prefix: 'session', generate_titles: true }
    });
    expect(Object.keys(effective)).toEqual(['config']);
    expect(Object.keys(effective.config as Json).every((key) => !/[A-Z]/.test(key))).toBe(true);
    expect('auto_approve' in (effective.config as Json)).toBe(false);
    expect(JSON.stringify(effective)).not.toContain(secretValue);
    const selection = await client.ok('config/read', { sessionId: 'fake-session-0001' });
    expect(selection.harnessSelectionSource).toBe('default');
    expect(selection.hooksCount).toBe(0);
  });

  it('treats autoApprove as bypass in both read-backs', async () => {
    const client = new FakeClient('allowed-call');
    await client.open({ autoApprove: true });
    expect(at(await client.ok('runtime/read', { sessionId: 'fake-session-0001' }), 'runtime.bypassToolPermissions')).toBe(true);
    expect(at(await client.ok('config/effective/read', { sessionId: 'fake-session-0001' }), 'config.bypass_tool_permissions')).toBe(true);
  });

  it('pins the active model in the effective config only after a model write names one', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    await client.ok('config/model/write', { sessionId: 'fake-session-0001', reasoningEffort: 'off' });
    expect(at(await client.ok('config/effective/read', { sessionId: 'fake-session-0001' }), 'config.active_model')).toBe('');
    await client.ok('config/model/write', { sessionId: 'fake-session-0001', modelAlias: 'mistral-medium-3.5' });
    expect(at(await client.ok('config/effective/read', { sessionId: 'fake-session-0001' }), 'config.active_model')).toBe('mistral-medium-3.5');
  });

  it('applies a thinking-off model write to both read-backs, unless the scenario ignores it', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    expect(at(await client.ok('runtime/read', { sessionId: 'fake-session-0001' }), 'runtime.config.activeModel.thinking')).toBe('high');
    const write = await client.ok('config/model/write', { sessionId: 'fake-session-0001', reasoningEffort: 'off' });
    expect(write.status).toBe('applied');
    expect(at(write, 'runtime.config.activeModel.thinking')).toBe('off');
    expect(await thinking(client)).toBe('off');
    expect(at(await client.call('config/model/write', { sessionId: 'fake-session-0001', reasoningEffort: 'maximum' }), 'error.code')).toBe('invalid_params');

    const ignoring = new FakeClient({ name: 'ignore-write', modelWrite: { ignore: true } });
    await ignoring.open();
    await ignoring.ok('config/model/write', { sessionId: 'fake-session-0001', reasoningEffort: 'off' });
    expect(await thinking(ignoring)).toBe('high');
  });

  it('serves a read-back mismatch scenario, a missing field scenario and an injected session error', async () => {
    const mismatch = new FakeClient('readback-mismatch');
    await mismatch.open();
    expect(at(await mismatch.ok('runtime/read', { sessionId: 'fake-session-0001' }), 'runtime.hooksCount')).toBe(1);

    const rows: Array<[Json, string, unknown]> = [
      [{ runtime: { skills: [{ name: 'plugin-skill', description: '', prompt: '' }] } }, 'runtime.skills.0.name', 'plugin-skill'],
      [{ runtime: { mcpSources: [{ name: 'x', kind: 'server', transport: 'stdio', status: 'enabled' }] } }, 'runtime.mcp.sources.0.name', 'x'],
      [{ runtime: { bypassToolPermissions: true } }, 'runtime.bypassToolPermissions', true],
      [{ runtime: { issues: [{ file: 'config.toml', message: 'bad' }] } }, 'runtime.issues.0.message', 'bad'],
      [{ runtime: { tools: ['read_file', 'write_file'] } }, 'runtime.tools.1.name', 'write_file'],
      [{ harness: 'legacy' }, 'harness', 'legacy']
    ];
    for (const [patch, probe, expected] of rows) {
      const client = new FakeClient({ name: 'row', ...patch });
      await client.open();
      const runtime = await client.ok('runtime/read', { sessionId: 'fake-session-0001' });
      const value = probe === 'harness' ? at(await client.ok('session/read', { sessionId: 'fake-session-0001' }), 'state.session.harness') : at(runtime, probe);
      expect(value).toBe(expected);
    }

    const omitting = new FakeClient({ name: 'omit', omit: { 'runtime/read': ['runtime.hooksCount'] } });
    await omitting.open();
    const runtime = await omitting.ok('runtime/read', { sessionId: 'fake-session-0001' });
    expect('hooksCount' in (runtime.runtime as Json)).toBe(false);

    const unauthorized = new FakeClient('session-start-unauthorized');
    await unauthorized.handshake();
    const refused = await unauthorized.call('session/start', { agentConfig: {} });
    expect(at(refused, 'error.code')).toBe('unauthorized');
    expect(at(refused, 'error.data')).toEqual({ provider: 'mistral', env_key: 'MISTRAL_API_KEY' });
  });
});

describe('fake vibe-app-server approvals', () => {
  it('runs an allowed call: camelCase callback, split ack and result, history and watermark ordering', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    const turnId = await client.startTurn();
    const request = await client.serverRequest();
    expect(typeof request.id).toBe('number');
    expect(at(request, 'params.callback.detail.kind')).toBe('approval');
    expect(at(request, 'params.callback.detail.effect.kind')).toBe('file_read');
    expect(at(request, 'params.callback.detail.effect.toolName')).toBe('file_system.read_file');
    expect(at(request, 'params.callback.detail.effect.input')).toEqual({ filePath: '/work/space/src/index.ts', offset: null, limit: 2000 });
    expect(at(request, 'params.callback.detail.effect.display.message')).toBe('src/index.ts');
    expect(at(request, 'params.callback.callbackId')).toBe('approval-call-0001');
    expect(at(request, 'params.callback.id')).toBe('approval-call-0001');
    expect(at(request, 'params.callback.relatedEntryId')).toBe('effect-action-0001');
    expect(at(request, 'params.callback.title')).toBe('Approve file_system.read_file');
    expect(at(request, 'params.callback.generationStatus')).toBe('in_progress');
    expect(at(request, 'params.callback.detail.choices')).toEqual(['approve', 'approve_for_session', 'approve_permanently', 'deny', 'cancel_turn']);
    expect(JSON.stringify(request)).not.toMatch(/file_path|callback_id|tool_name/);
    expect(at(request, 'params.callback.turnId')).toBe(turnId);
    expect(client.named('turn/completed')).toEqual([]);

    client.acknowledge(request);
    const accepted = await client.answer(request, 'approve');
    expect(accepted.result).toEqual({ accepted: true, lastEventId: expect.any(Number) });
    const completed = await client.completion();
    expect(at(completed, 'params.turn')).toMatchObject({ id: turnId, status: 'completed', stopReason: null, error: null });

    const eventIds = client.notifications.map((n) => at(n, 'params.eventId') as number);
    expect(eventIds[0]).toBe(watermark + 1);
    eventIds.forEach((id, index) => { if (index > 0) expect(id).toBe(eventIds[index - 1]! + 1); });
    expect(client.notifications.map((n) => n.method)).toEqual(expect.arrayContaining(['turn/started', 'history/entryAdded', 'history/entryUpdated', 'session/statsUpdated', 'turn/completed']));

    const effect = (await client.ok('session/history/list', { sessionId: 'fake-session-0001' })).items as Json[];
    const call = effect.find((entry) => entry.type === 'effect')!;
    expect(call.id).toBe('effect-action-0001');
    expect(at(call, 'state')).toMatchObject({ status: 'completed', decision: 'execute', approvalType: 'ask', approvalSource: 'user' });
    expect(at(call, 'state.output.filePath')).toBe('/work/space/src/index.ts');
    const answered = effect.find((entry) => entry.type === 'callback')!;
    expect(answered).toMatchObject({ id: 'approval-call-0001', relatedEntryId: call.id, generationStatus: 'completed' });
    expect(at(answered, 'state')).toEqual({ status: 'answered', output: { type: 'approval', decision: { type: 'approve' }, feedback: null } });
    const message = effect.filter((entry) => entry.type === 'message');
    expect(message.map((entry) => at(entry, 'role'))).toEqual(['user', 'assistant']);
    expect(at(message[1], 'content.0.text')).toBe('The review found no issues.');
    expect(at(message[1], 'generationStatus')).toBe('completed');
  });

  it('records the approve envelope exactly and every client frame in the log', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    await client.startTurn();
    const request = await client.serverRequest();
    client.acknowledge(request);
    await client.answer(request, 'approve');
    await client.completion();
    const frames = client.sentFrames();
    const result = frames.find((frame) => frame.method === 'callback/result')!;
    expect(at(result, 'params.result.output')).toEqual({ type: 'approval', decision: { type: 'approve' }, feedback: null });
    expect(frames.map((frame) => frame.method ?? 'response')).toEqual(['initialize', 'initialized', 'session/start', 'session/ready/wait', 'turn/start', 'response', 'callback/result']);
    expect(frames.find((frame) => frame.method === 'initialized')).toEqual({ jsonrpc: '2.0', method: 'initialized', params: {} });
    expect(client.logEvents('approvalAnswer')[0]).toMatchObject({ decision: 'approve', malformed: false, hasPathScope: false });
  });

  it('answers forbidden calls with deny, shows the model a tool_denied failure and keeps running', async () => {
    const client = new FakeClient('forbidden-call-approval');
    await client.open();
    await client.startTurn();
    for (let index = 0; index < 3; index += 1) {
      const request = await client.serverRequest(index);
      client.acknowledge(request);
      await client.answer(request, 'deny');
    }
    expect(at(await client.completion(), 'params.turn.status')).toBe('completed');
    const entries = (await client.ok('session/history/list', { sessionId: 'fake-session-0001' })).items as Json[];
    const effects = entries.filter((entry) => entry.type === 'effect');
    expect(effects.map((entry) => at(entry, 'detail.toolName'))).toEqual(['file_system.read_file', 'file_system.read_file', 'file_system.write_file']);
    expect(effects.map((entry) => at(entry, 'detail.input.filePath'))).toEqual(['/etc/passwd', '/work/space/.env', '/work/space/src/new.ts']);
    for (const effect of effects) {
      expect(effect.state).toMatchObject({ status: 'failed', decision: 'skip', error: { code: 'tool_denied', message: 'Tool execution denied by approval callback' } });
    }
    expect(at(effects[2], 'detail.kind')).toBe('file_write');
    expect(client.logEvents('approvalAnswer').map((event) => event.decision)).toEqual(['deny', 'deny', 'deny']);
  });

  it('counts an error result and a malformed answer as deny, and cancel_turn interrupts', async () => {
    const client = new FakeClient('forbidden-call-approval');
    await client.open();
    await client.startTurn();
    const first = await client.serverRequest(0);
    client.acknowledge(first);
    await client.call('callback/result', { sessionId: 'fake-session-0001', result: { callbackId: at(first, 'params.callback.callbackId'), error: { message: 'client failed' } } });
    const second = await client.serverRequest(1);
    client.acknowledge(second);
    await client.answer(second, 'maybe');
    const third = await client.serverRequest(2);
    client.acknowledge(third);
    await client.answer(third, 'cancel_turn');
    expect(at(await client.completion(), 'params.turn.status')).toBe('interrupted');
    expect(client.logEvents('approvalAnswer').map((event) => [event.decision, event.malformed])).toEqual([['deny', true], ['deny', true], ['cancel_turn', false]]);
  });

  it('rejects unknown callback ids and bad callback/result params strictly', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    expect(at(await client.call('callback/result', { sessionId: 'fake-session-0001', result: { callbackId: 'nope', output: null } }), 'error.code')).toBe('not_found');
    expect(at(await client.call('callback/result', { sessionId: 'fake-session-0001', result: { callbackId: 'nope', outputs: 1 } }), 'error.code')).toBe('invalid_params');
    expect(at(await client.call('callback/respond', { sessionId: 'fake-session-0001' }), 'error.code')).toBe('method_not_found');
  });

  it('records approve_for_session and a path scope so a client sending them is detectable', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    await client.startTurn();
    const request = await client.serverRequest();
    client.acknowledge(request);
    await client.answer(request, 'approve_for_session', { decision: { type: 'approve_for_session', pathScope: { kind: 'folder' } } });
    await client.completion();
    expect(client.logEvents('approvalAnswer')[0]).toMatchObject({ decision: 'approve_for_session', hasPathScope: true });
  });

  it('never times out a pending approval: the turn stalls until the client answers', async () => {
    const client = new FakeClient('approval-stall');
    await client.open();
    await client.startTurn();
    const request = await client.serverRequest();
    client.acknowledge(request);
    await sleep(500);
    expect(client.named('turn/completed')).toEqual([]);
    expect(client.exit).toBeNull();
    const blocked = await client.ok('session/read', { sessionId: 'fake-session-0001' });
    expect(at(blocked, 'state.session.status.type')).toBe('blocked');
    await client.answer(request, 'deny');
    expect(at(await client.completion(), 'params.turn.status')).toBe('completed');
  });

  it('crashes as the real server does when the client did not declare the approval callback kind', async () => {
    const client = new FakeClient('allowed-call');
    await client.open({}, []);
    await client.startTurn();
    expect((await client.exited).code).toBe(1);
    expect(client.stderr).toContain('approval');
    expect(client.serverRequests).toEqual([]);
  });

  it('shows an in-profile call allowed without any callback', async () => {
    const client = new FakeClient('auto-allowed-in-profile');
    await client.open();
    await client.startTurn();
    await client.completion();
    expect(client.serverRequests).toEqual([]);
    const effect = (client.named('history/entryAdded').map((n) => at(n, 'params.entry')) as Json[]).find((entry) => entry.type === 'effect')!;
    expect(at(effect, 'detail.toolName')).toBe('file_system.read_file');
    expect(at(effect, 'detail.input.filePath')).toBe('/work/space/src/index.ts');
    expect(effect.state).toMatchObject({ status: 'completed', decision: 'execute', approvalType: 'always', approvalSource: 'config' });
  });

  it('shows an off-profile write executed without a callback', async () => {
    const client = new FakeClient('off-profile-executed');
    await client.open();
    await client.startTurn();
    await client.completion();
    expect(client.serverRequests).toEqual([]);
    const effect = (client.named('history/entryAdded').map((n) => at(n, 'params.entry')) as Json[]).find((entry) => entry.type === 'effect')!;
    expect(at(effect, 'detail.toolName')).toBe('file_system.write_file');
    expect(at(effect, 'detail.kind')).toBe('file_write');
    expect(effect.state).toMatchObject({ status: 'completed', decision: 'execute', approvalSource: 'bypass' });
  });

  it('shows an off-profile write denied by permission never, with no callback', async () => {
    const client = new FakeClient('off-profile-denied');
    await client.open();
    await client.startTurn();
    expect(at(await client.completion(), 'params.turn.status')).toBe('completed');
    expect(client.serverRequests).toEqual([]);
    const effect = (client.named('history/entryAdded').map((n) => at(n, 'params.entry')) as Json[]).find((entry) => entry.type === 'effect')!;
    expect(effect.state).toMatchObject({
      status: 'failed', decision: 'skip', approvalType: 'never', approvalSource: 'never',
      error: { code: 'tool_denied', message: 'Tool execution denied by approval policy' }
    });
  });

  it('shows an edit as one batched change with camelCase keys and a file_edit kind', async () => {
    const client = new FakeClient('edit-call');
    await client.open();
    await client.startTurn();
    const request = await client.serverRequest();
    expect(at(request, 'params.callback.detail.effect.kind')).toBe('file_edit');
    expect(at(request, 'params.callback.detail.effect.toolName')).toBe('file_system.search_replace');
    expect(at(request, 'params.callback.detail.effect.input')).toEqual({
      filePath: '/work/space/src/index.ts', changes: [{ oldString: 'const a = 1;', newString: 'const a = 2;', replaceAll: false }]
    });
    client.acknowledge(request);
    await client.answer(request, 'approve');
    await client.completion();
    const call = ((await client.ok('session/history/list', { sessionId: 'fake-session-0001' })).items as Json[]).find((entry) => entry.type === 'effect')!;
    expect(at(call, 'state.output.occurrences')).toHaveLength(1);
  });

  it('keeps a call the projection failed on generic with raw snake_case-era input, for a client to deny', async () => {
    const client = new FakeClient('generic-effect-fallback');
    await client.open();
    await client.startTurn();
    const request = await client.serverRequest();
    expect(at(request, 'params.callback.detail.effect.kind')).toBe('tool');
    expect(at(request, 'params.callback.detail.effect.toolName')).toBe('file_system.read_file');
    expect(at(request, 'params.callback.detail.effect.input')).toEqual({ path: '/work/space/src/index.ts', offset: 0 });
    client.acknowledge(request);
    await client.answer(request, 'deny');
    await client.completion();
  });

  it('shows an effect whose result carried no approval metadata as three nulls', async () => {
    const client = new FakeClient('unrecorded-approval-meta');
    await client.open();
    await client.startTurn();
    await client.completion();
    const effect = (client.named('history/entryAdded').map((n) => at(n, 'params.entry')) as Json[]).find((entry) => entry.type === 'effect')!;
    expect(effect.state).toMatchObject({ status: 'completed', decision: null, approvalType: null, approvalSource: null });
  });

  it('keeps the effect running while its callback is open, with blocked available as a scenario override', async () => {
    const running = new FakeClient('approval-stall');
    await running.open();
    await running.startTurn();
    await running.serverRequest();
    const announced = (running.named('history/entryAdded').map((n) => at(n, 'params.entry')) as Json[]).find((entry) => entry.type === 'effect')!;
    expect(announced).toMatchObject({ generationStatus: 'in_progress', state: { status: 'running' } });

    const blocked = new FakeClient({ name: 'blocked', effectWhileBlocked: 'blocked', steps: [{ op: 'call', tool: 'file_system.read_file', input: { filePath: '/work/space/a.ts' } }] });
    await blocked.open();
    await blocked.startTurn();
    const request = await blocked.serverRequest();
    const effect = (blocked.named('history/entryAdded').map((n) => at(n, 'params.entry')) as Json[]).find((entry) => entry.type === 'effect')!;
    expect(effect.state).toMatchObject({ status: 'blocked', callbackId: at(request, 'params.callback.callbackId') });
  });
});

describe('fake vibe-app-server events', () => {
  it('hides an effect behind a watermark gap that history/list still reveals', async () => {
    const client = new FakeClient('watermark-gap');
    await client.open();
    await client.startTurn();
    await client.completion();
    const ids = client.notifications.map((n) => at(n, 'params.eventId') as number);
    const gaps = ids.filter((id, index) => index > 0 && id - ids[index - 1]! > 1);
    expect(gaps).toHaveLength(1);
    const announced = client.named('history/entryAdded').map((n) => at(n, 'params.entry') as Json);
    expect(announced.some((entry) => entry.type === 'effect')).toBe(false);
    const listed = (await client.ok('session/history/list', { sessionId: 'fake-session-0001' })).items as Json[];
    const hidden = listed.find((entry) => entry.type === 'effect')!;
    expect(at(hidden, 'detail.toolName')).toBe('file_system.write_file');
    expect(hidden.state).toMatchObject({ status: 'completed', decision: 'execute', approvalSource: 'bypass' });
  });

  it('replays an event id at or below the watermark and keeps ids otherwise monotonic', async () => {
    const client = new FakeClient('stale-event');
    await client.open();
    await client.startTurn();
    await client.completion();
    const ids = client.notifications.map((n) => at(n, 'params.eventId') as number);
    expect(ids.filter((id) => id <= watermark)).toEqual([watermark]);
  });

  it('streams a message with append patches that rebuild the final text', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    await client.startTurn();
    const request = await client.serverRequest();
    client.acknowledge(request);
    await client.answer(request, 'approve');
    await client.completion();
    const patches = client.named('history/entryUpdated').flatMap((n) => at(n, 'params.patch') as Json[]);
    const appended = patches.filter((patch) => patch.op === 'append').map((patch) => patch.value as string).join('');
    expect(appended).toBe('The review found no issues.');
    expect(patches.some((patch) => patch.op === 'replace' && patch.path === '/generationStatus' && patch.value === 'completed')).toBe(true);
  });

  it('delivers reasoning entries and an unknown entry kind, and an unknown notification method', async () => {
    const reasoning = new FakeClient('allowed-call');
    await reasoning.open();
    await reasoning.startTurn();
    const request = await reasoning.serverRequest();
    reasoning.acknowledge(request);
    await reasoning.answer(request, 'approve');
    await reasoning.completion();
    expect(reasoning.named('history/entryAdded').map((n) => at(n, 'params.entry.type'))).toContain('reasoning');

    const entryKind = new FakeClient('unknown-entry-kind');
    await entryKind.open();
    await entryKind.startTurn();
    await entryKind.completion();
    const unknown = entryKind.named('history/entryAdded').map((n) => at(n, 'params.entry') as Json).find((entry) => entry.type === 'hologram')!;
    expect(unknown.payload).toEqual({ note: 'could hide a call' });
    const listed = (await entryKind.ok('session/history/list', { sessionId: 'fake-session-0001' })).items as Json[];
    expect(listed.some((entry) => entry.type === 'hologram')).toBe(true);

    const method = new FakeClient('unknown-notification');
    await method.open();
    await method.startTurn();
    await method.completion();
    expect(method.named('session/futureThing')).toHaveLength(1);
    expect(at(method.named('session/futureThing')[0], 'params.detail')).toBe(1);
  });

  it('adds unknown fields at every depth of results, notifications and callbacks', async () => {
    const client = new FakeClient('extra-fields');
    const started = await (async () => { await client.handshake(); return client.ok('session/start', { agentConfig: { cwd: '/work/space' } }); })();
    expect(started.futureField).toBe('ignored');
    expect(at(started, 'state.futureField')).toBe('ignored');
    expect(at(started, 'state.session.futureField')).toBe('ignored');
    await client.startTurn();
    const request = await client.serverRequest();
    expect(at(request, 'params.futureField')).toBe('ignored');
    expect(at(request, 'params.callback.detail.effect.futureField')).toBe('ignored');
    client.acknowledge(request);
    await client.answer(request, 'approve');
    const completed = await client.completion();
    expect(at(completed, 'params.futureField')).toBe('ignored');
    expect(at(completed, 'params.turn.futureField')).toBe('ignored');
    expect(at(client.named('session/statsUpdated')[0], 'params.stats.futureField')).toBe('ignored');
  });

  it('pages history by entry id, newest page first, oldest first inside a page', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    await client.startTurn();
    const request = await client.serverRequest();
    client.acknowledge(request);
    await client.answer(request, 'approve');
    await client.completion();
    const list = (page: Json) => client.ok('session/history/list', { sessionId: 'fake-session-0001', page });
    const ids = (result: Json) => (result.items as Json[]).map((entry) => entry.id);
    const all = (await client.ok('session/history/list', { sessionId: 'fake-session-0001' })).items as Json[];
    expect(all.length).toBeGreaterThan(4);

    const newest = await list({ limit: 2 });
    expect(ids(newest)).toEqual(all.slice(-2).map((entry) => entry.id));
    expect(newest.nextCursor).toBe(all.at(-2)!.id);
    expect(newest.previousCursor).toBeNull();
    const older = await list({ limit: 2, cursor: newest.nextCursor as string });
    expect(ids(older)).toEqual(all.slice(-4, -2).map((entry) => entry.id));
    expect(older.previousCursor).toBe(all.at(-3)!.id);
    const oldest = await list({ limit: 500, cursor: older.nextCursor as string });
    expect(ids(oldest)).toEqual(all.slice(0, -4).map((entry) => entry.id));
    expect(oldest.nextCursor).toBeNull();

    const afterFirst = await list({ limit: 2, direction: 'forward', cursor: all[0]!.id as string });
    expect(ids(afterFirst)).toEqual(all.slice(1, 3).map((entry) => entry.id));
    expect(afterFirst.nextCursor).toBe(all[2]!.id);
    expect(afterFirst.previousCursor).toBe(all[1]!.id);
    expect(ids(await list({ limit: 2, direction: 'forward' }))).toEqual(all.slice(-2).map((entry) => entry.id));

    const unknown = await list({ cursor: 'no-such-entry' });
    expect(unknown).toEqual({ items: [], nextCursor: null, previousCursor: null });
    expect(at(await client.call('session/history/list', { sessionId: 'fake-session-0001', page: { limit: 501 } }), 'error.code')).toBe('invalid_params');
    expect(ids(await client.ok('session/history/list', { sessionId: 'fake-session-0001', turnId: all[1]!.turnId as string }))).toEqual(all.filter((entry) => entry.turnId === all[1]!.turnId).map((entry) => entry.id));
  });

  it('raises invalid_params for an unknown page cursor only when the scenario asks for it', async () => {
    const client = new FakeClient({ name: 'bad-cursor', badCursor: 'invalid_params', steps: [{ op: 'say', text: 'x' }] });
    await client.open();
    expect(at(await client.call('session/history/list', { sessionId: 'fake-session-0001', page: { cursor: 'missing' } }), 'error.code')).toBe('invalid_params');
  });
});

describe('fake vibe-app-server turn outcomes and stats', () => {
  it.each([
    ['limit', { status: 'completed', stopReason: 'limit' }],
    ['length', { status: 'completed', stopReason: 'length' }],
    ['interrupted', { status: 'interrupted', stopReason: 'limit' }],
    ['failed', { status: 'failed', stopReason: null, error: { message: 'The backend failed.', code: 'backend_error', details: null } }]
  ])('settles the %s scenario', async (name, expected) => {
    const client = new FakeClient(name);
    await client.open();
    await client.startTurn();
    expect(at(await client.completion(), 'params.turn')).toMatchObject(expected);
  });

  it('streams cumulative usage through statsUpdated and the final runtime/read', async () => {
    const client = new FakeClient('stats-usage');
    await client.open();
    expect(at(await client.ok('runtime/read', { sessionId: 'fake-session-0001' }), 'runtime.stats')).toMatchObject({ modelCalls: null, sessionPromptTokens: 0, inputPricePerMillion: 0.4, outputPricePerMillion: 2, cachedInputPricePerMillion: 0.04 });
    await client.startTurn();
    await client.completion();
    const updates = client.named('session/statsUpdated');
    expect(updates.map((n) => at(n, 'params.stats.sessionPromptTokens'))).toEqual([1000, 5000]);
    expect(at(updates[1], 'params.contextWindow')).toBe(128000);
    expect(at(await client.ok('runtime/read', { sessionId: 'fake-session-0001' }), 'runtime.stats')).toMatchObject({ modelCalls: 3, sessionPromptTokens: 5000, sessionCompletionTokens: 900, sessionCachedTokens: 2000 });
  });

  it('interrupts a held turn, and reports stale and settled turns', async () => {
    const client = new FakeClient('hold');
    await client.open();
    const turnId = await client.startTurn();
    expect(at(await client.call('turn/start', { sessionId: 'fake-session-0001', message: [{ type: 'text', text: 'again' }] }), 'error.code')).toBe('conflict');
    expect(at(await client.call('turn/interrupt', { sessionId: 'fake-session-0001', expectedTurnId: 'other' }), 'error.code')).toBe('stale_turn');
    const accepted = await client.ok('turn/interrupt', { sessionId: 'fake-session-0001', expectedTurnId: turnId });
    expect(accepted.accepted).toBe(true);
    expect(at(await client.completion(), 'params.turn.status')).toBe('interrupted');
    expect(at(await client.call('turn/interrupt', { sessionId: 'fake-session-0001', expectedTurnId: turnId }), 'error.code')).toBe('conflict');
    expect(client.logEvents('interrupt')).toHaveLength(1);
  });

  it('cancels an open callback when the turn is interrupted', async () => {
    const client = new FakeClient('approval-stall');
    await client.open();
    const turnId = await client.startTurn();
    await client.serverRequest();
    await client.ok('turn/interrupt', { sessionId: 'fake-session-0001', expectedTurnId: turnId });
    expect(at(await client.completion(), 'params.turn.status')).toBe('interrupted');
    const entries = (await client.ok('session/history/list', { sessionId: 'fake-session-0001' })).items as Json[];
    expect(entries.find((entry) => entry.type === 'callback')?.state).toMatchObject({ status: 'cancelled' });
    expect(entries.find((entry) => entry.type === 'effect')?.state).toMatchObject({ status: 'cancelled' });
  });

  it('accepts an interrupt but never settles when the scenario ignores it', async () => {
    const client = new FakeClient('hold-ignore-interrupt');
    await client.open();
    const turnId = await client.startTurn();
    expect((await client.ok('turn/interrupt', { sessionId: 'fake-session-0001', expectedTurnId: turnId })).accepted).toBe(true);
    await sleep(400);
    expect(client.named('turn/completed')).toEqual([]);
    expect(client.logEvents('interruptIgnored')).toHaveLength(1);
  });
});

describe('fake vibe-app-server process behavior', () => {
  it('exits 0 on stdin EOF and removes its throwaway store, which holds reasoning while it runs', async () => {
    const client = new FakeClient('allowed-call');
    await client.open();
    await client.startTurn();
    const request = await client.serverRequest();
    client.acknowledge(request);
    await client.answer(request, 'approve');
    await client.completion();
    const [store] = client.storeDirectories();
    expect(store).toBeDefined();
    const journal = readFileSync(path.join(workDirectory, store!, 'journal.jsonl'), 'utf8');
    expect(journal).toContain('private reasoning that must stay out of persisted artifacts');
    client.closeStdin();
    expect(await client.exited).toEqual({ code: 0, signal: null });
    expect(client.storeDirectories()).toEqual([]);
    expect(client.logEvents('eof')).toHaveLength(1);
    expect(client.log().at(-1)).toMatchObject({ kind: 'exit', code: 0 });
  });

  it('exits on EOF mid-turn without hanging', async () => {
    const client = new FakeClient('hold');
    await client.open();
    await client.startTurn();
    client.closeStdin();
    expect((await client.exited).code).toBe(0);
    expect(client.storeDirectories()).toEqual([]);
  });

  it('takes the configured exit path after session/stop', async () => {
    const normal = new FakeClient('allowed-call');
    await normal.open();
    expect((await normal.ok('session/stop', { sessionId: 'fake-session-0001' })).closed).toBe(true);
    expect((await normal.exited).code).toBe(0);

    const cancelled = new FakeClient({ name: 'cancelled', afterStop: 'cancelled' });
    await cancelled.open();
    await cancelled.ok('session/stop', { sessionId: 'fake-session-0001' });
    expect((await cancelled.exited).code).toBe(1);
    expect(cancelled.stderr).toContain('CancelledError');

    const hanging = new FakeClient({ name: 'hanging', afterStop: 'hang' });
    await hanging.open();
    await hanging.ok('session/stop', { sessionId: 'fake-session-0001' });
    await sleep(300);
    expect(hanging.exit).toBeNull();
    hanging.closeStdin();
    expect((await hanging.exited).code).toBe(0);
  });

  it('supports a delayed EOF exit and an ignored EOF', async () => {
    const delayed = new FakeClient({ name: 'delayed', eof: 'delay', eofDelayMs: 300 });
    await delayed.open();
    delayed.closeStdin();
    await sleep(100);
    expect(delayed.exit).toBeNull();
    expect((await delayed.exited).code).toBe(0);

    const ignored = new FakeClient('eof-ignored');
    await ignored.open();
    ignored.closeStdin();
    await sleep(400);
    expect(ignored.exit).toBeNull();
    ignored.kill();
    expect((await ignored.exited).signal).toBe('SIGKILL');
  });

  it('wedges mid-turn, ignores EOF and SIGTERM, and dies only on SIGKILL, leaving its store behind', async () => {
    const client = new FakeClient('wedge');
    await client.open();
    await client.startTurn();
    await client.waitFor(() => client.logEvents('wedged')[0]);
    client.closeStdin();
    client.child.kill('SIGTERM');
    await sleep(500);
    expect(client.exit).toBeNull();
    expect(client.logEvents('signalIgnored').length).toBeGreaterThan(0);
    expect(client.storeDirectories()).toHaveLength(1);
    client.child.kill('SIGKILL');
    expect((await client.exited).signal).toBe('SIGKILL');
  });

  it('crashes mid-turn with a non-zero status and leaves its store behind', async () => {
    const client = new FakeClient('mid-turn-crash');
    await client.open();
    await client.startTurn();
    expect(await client.exited).toEqual({ code: 139, signal: null });
    expect(client.stderr).toContain('simulated crash');
    expect(client.storeDirectories()).toHaveLength(1);
    expect(client.named('turn/completed')).toEqual([]);
  });

  it('can die by signal', async () => {
    const client = new FakeClient({ steps: [{ op: 'crash', signal: 'SIGKILL' }] });
    await client.open();
    await client.startTurn();
    expect((await client.exited).signal).toBe('SIGKILL');
  });

  it('writes a malformed line, an oversized frame and a partial frame on request', async () => {
    const malformed = new FakeClient('malformed-line');
    await malformed.open();
    await malformed.startTurn();
    await malformed.waitFor(() => malformed.rawLines.find((line) => line === '{not json'));

    const oversized = new FakeClient('oversized-frame');
    await oversized.open();
    await oversized.startTurn();
    const huge = await oversized.waitFor(() => oversized.notifications.find((n) => n.method === 'warning'));
    expect((at(huge, 'params.warning.message') as string).length).toBe(2097152);

    const partial = new FakeClient('partial-frame-crash');
    await partial.open();
    await partial.startTurn();
    expect((await partial.exited).code).toBe(1);
    expect(partial.buffered).toBe('{"jsonrpc":"2.0","method":"history/entryAdded","params":{"eventId":');
    expect(partial.notifications.filter((n) => n.method === 'history/entryAdded').length).toBe(1);
  });

  it('fails startup with stderr and a non-zero status before serving anything', async () => {
    const client = new FakeClient('startup-failure');
    expect(await client.exited).toEqual({ code: 1, signal: null });
    expect(client.stderr).toContain('Error: the Unified Harness runtime could not be loaded');
    expect(client.frames).toEqual([]);
  });

  it('refuses an inbound line over its bound', async () => {
    const client = new FakeClient('allowed-call');
    await client.handshake();
    client.sendRaw(`{"jsonrpc":"2.0","id":5,"method":"runtime/read","params":{"sessionId":"${'x'.repeat(1024 * 1024 + 10)}"}}\n`);
    expect((await client.exited).code).toBe(1);
    expect(client.stderr).toContain('inbound line exceeds');
  });

  it('records the child environment names and never the credential value', async () => {
    const client = new FakeClient('allowed-call', { VIBE_HOME: '/private/vibe-home', VIBE_ENABLE_CONNECTORS: 'false' });
    await client.open();
    client.closeStdin();
    await client.exited;
    const start = client.log().find((record) => record.kind === 'start')!;
    expect(start.pid).toBe(client.child.pid);
    expect(start.argv).toEqual(['--scenario', expect.stringContaining('allowed-call')]);
    expect(start.hasMistralApiKey).toBe(true);
    expect(start.envNames).toEqual(expect.arrayContaining(['HOME', 'TMPDIR', 'MISTRAL_API_KEY', 'VIBE_HOME']));
    expect(start.envNames).not.toContain('SSH_AUTH_SOCK');
    expect(start.env).toMatchObject({ VIBE_HOME: '/private/vibe-home', VIBE_ENABLE_CONNECTORS: 'false', HOME: workDirectory });
    expect(readFileSync(client.logPath, 'utf8')).not.toContain(secretValue);
  });
});
