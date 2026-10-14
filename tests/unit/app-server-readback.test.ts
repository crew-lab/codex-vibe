import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildConfigEffectiveRead,
  buildRuntimeRead,
  buildSessionReadyWait,
  buildSessionStart,
  parseConfigEffectiveReadResult,
  parseRuntimeReadResult,
  parseSessionStartResult
} from '../../src/backends/app-server/protocol.js';
import {
  compareReadback,
  formatReadbackMismatches,
  type ReadbackExpectation,
  type ReadbackMismatch,
  type ReadbackObservation
} from '../../src/backends/app-server/readback.js';
import { buildSessionConfig, buildThinkingOffWrite, writeSessionFiles, type SessionConfigPlan } from '../../src/backends/app-server/session-config.js';

type Json = Record<string, unknown>;

const root = path.resolve(import.meta.dirname, '..', '..');
const fixture = path.join(root, 'tests', 'fixtures', 'fake-vibe-app-server.mjs');
const workspace = '/srv/work/space';
const alias = 'mistral-medium-3.5';

function assign(target: Json, segments: readonly string[], value: unknown): void {
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (typeof next === 'object' && next !== null && !Array.isArray(next)) cursor = next as Json;
    else { const created: Json = {}; cursor[segment] = created; cursor = created; }
  }
  cursor[segments.at(-1) as string] = value;
}

function cleanWire(expectation: ReadbackExpectation, thinking: string): { start: unknown; runtime: unknown; effective: unknown } {
  const config: Json = {
    active_model: '',
    models: { [alias]: { thinking } },
    enabled_tools: [...expectation.tools],
    disabled_tools: [...expectation.disabledTools],
    tools: Object.fromEntries(Object.entries(expectation.toolPolicies).map(([name, policy]) => [name, { permission: policy.permission, denylist: [...policy.denylist] }])),
    unrelated_future_field: { nested: true }
  };
  for (const setting of expectation.settings) assign(config, setting.path, JSON.parse(JSON.stringify(setting.value)));
  return {
    start: { lastEventId: 3, state: { eventId: 3, session: { id: 's-1', harness: expectation.harness, cwd: expectation.cwd, model: alias, reasoningEffort: thinking, status: { type: 'idle' } }, history: [], historyBeforeCursor: null, turns: [], isQuiescent: true } },
    runtime: {
      runtime: {
        config: { activeModel: { alias, thinking } },
        tools: expectation.tools.map((name) => ({ name, isCustom: false })),
        skills: [],
        mcp: { sources: [], discoveryErrors: {}, connectorError: null, manageConnectorsUrl: null },
        connectors: { connected: 0, total: 0 },
        hooksCount: 0,
        issues: [],
        bypassToolPermissions: false,
        stats: { sessionPromptTokens: 0, sessionCompletionTokens: 0 },
        futureField: 1
      },
      ready: true
    },
    effective: { config }
  };
}

function observe(wire: { start: unknown; runtime: unknown; effective: unknown }): ReadbackObservation {
  return {
    sessionStart: parseSessionStartResult(wire.start),
    runtime: parseRuntimeReadResult(wire.runtime),
    effective: parseConfigEffectiveReadResult(wire.effective)
  };
}

const plan = buildSessionConfig({ mode: 'edit', workspace, runDirectory: '/srv/runs/run-0001', maxTurns: 5 });
const paths = (mismatches: readonly ReadbackMismatch[]) => mismatches.map((item) => item.path);

describe('compareReadback on unit inputs', () => {
  it('passes a clean observation, ignores unknown extra fields, and checks thinking only when asked', () => {
    const wire = cleanWire(plan.expectation, 'high');
    expect(compareReadback(plan.expectation, observe(wire), { checkThinking: false })).toEqual([]);
    expect(paths(compareReadback(plan.expectation, observe(wire), { checkThinking: true }))).toEqual(['runtime.config.activeModel.thinking', `config.models["${alias}"].thinking`]);
    expect(compareReadback(plan.expectation, observe(cleanWire(plan.expectation, 'off')), { checkThinking: true })).toEqual([]);
  });

  const mutations: Array<[string, (wire: ReturnType<typeof cleanWire>) => void, string[]]> = [
    ['a non-unified harness', (wire) => { assign(wire.start as Json, ['state', 'session', 'harness'], 'legacy'); }, ['session.harness']],
    ['a different cwd', (wire) => { assign(wire.start as Json, ['state', 'session', 'cwd'], '/elsewhere'); }, ['session.cwd']],
    ['a null cwd', (wire) => { assign(wire.start as Json, ['state', 'session', 'cwd'], null); }, ['session.cwd']],
    ['an extra runtime tool', (wire) => { ((wire.runtime as Json).runtime as Json).tools = [...plan.expectation.tools, 'bash'].map((name) => ({ name })); }, ['runtime.tools']],
    ['a missing runtime tool', (wire) => { ((wire.runtime as Json).runtime as Json).tools = [{ name: 'read_file' }]; }, ['runtime.tools']],
    ['a duplicated runtime tool', (wire) => { ((wire.runtime as Json).runtime as Json).tools = [{ name: 'read_file' }, { name: 'read_file' }, { name: 'write_file' }, { name: 'edit' }]; }, ['runtime.tools']],
    ['a skill', (wire) => { ((wire.runtime as Json).runtime as Json).skills = [{ name: 'x' }]; }, ['runtime.skills']],
    ['a hook', (wire) => { ((wire.runtime as Json).runtime as Json).hooksCount = 1; }, ['runtime.hooksCount']],
    ['an issue', (wire) => { ((wire.runtime as Json).runtime as Json).issues = [{ file: 'a', message: 'b' }]; }, ['runtime.issues']],
    ['bypassed permissions', (wire) => { ((wire.runtime as Json).runtime as Json).bypassToolPermissions = true; }, ['runtime.bypassToolPermissions']],
    ['an MCP source', (wire) => { ((wire.runtime as Json).runtime as Json).mcp = { sources: [{ name: 'x' }] }; }, ['runtime.mcp.sources']],
    ['a connected connector', (wire) => { ((wire.runtime as Json).runtime as Json).connectors = { connected: 1, total: 1 }; }, ['runtime.connectors.connected', 'runtime.connectors.total']],
    ['connectors that exist but are not connected', (wire) => { ((wire.runtime as Json).runtime as Json).connectors = { connected: 0, total: 2 }; }, ['runtime.connectors.total']],
    ['a changed permission', (wire) => { assign(wire.effective as Json, ['config', 'tools', 'edit', 'permission'], 'always'); }, ['config.tools.edit.permission']],
    ['a narrowed denylist', (wire) => { assign(wire.effective as Json, ['config', 'tools', 'read_file', 'denylist'], []); }, ['config.tools.read_file.denylist']],
    ['a re-enabled subagent setting', (wire) => { assign(wire.effective as Json, ['config', 'enable_subagents'], true); }, ['config.enable_subagents']],
    ['enabled session logging', (wire) => { assign(wire.effective as Json, ['config', 'session_logging', 'enabled'], true); }, ['config.session_logging.enabled']],
    ['a string where a boolean is expected', (wire) => { assign(wire.effective as Json, ['config', 'enable_telemetry'], 'false'); }, ['config.enable_telemetry']],
    ['a skill pattern that does not disable everything', (wire) => { assign(wire.effective as Json, ['config', 'disabled_skills'], ['other']); }, ['config.disabled_skills']],
    ['an MCP server in the effective config', (wire) => { assign(wire.effective as Json, ['config', 'mcp_servers'], [{ name: 'x' }]); }, ['config.mcp_servers']],
    ['a widened enabled tool list', (wire) => { assign(wire.effective as Json, ['config', 'enabled_tools'], ['read_file', 'write_file', 'edit', 'bash']); }, ['config.enabled_tools']],
    ['a lost disabled tool', (wire) => { assign(wire.effective as Json, ['config', 'disabled_tools'], ['cron']); }, ['config.disabled_tools']]
  ];
  for (const [name, mutate, expected] of mutations) {
    it(`reports ${name}`, () => {
      const wire = cleanWire(plan.expectation, 'off');
      mutate(wire);
      expect(paths(compareReadback(plan.expectation, observe(wire), { checkThinking: true }))).toEqual(expected);
    });
  }

  it('accepts an unknown connector total and extra disabled tools and skills', () => {
    const wire = cleanWire(plan.expectation, 'off');
    ((wire.runtime as Json).runtime as Json).connectors = { connected: 0, total: null };
    assign(wire.effective as Json, ['config', 'disabled_tools'], ['other', ...plan.expectation.disabledTools]);
    assign(wire.effective as Json, ['config', 'disabled_skills'], ['*', 'other']);
    expect(compareReadback(plan.expectation, observe(wire), { checkThinking: true })).toEqual([]);
  });

  const missing: Array<[string, (wire: ReturnType<typeof cleanWire>) => void, string[]]> = [
    ['every expected setting when the effective config is empty', (wire) => { (wire.effective as Json).config = {}; }, []],
    ['connector counts', (wire) => { ((wire.runtime as Json).runtime as Json).connectors = {}; }, ['runtime.connectors.connected']],
    ['mcp', (wire) => { ((wire.runtime as Json).runtime as Json).mcp = {}; }, ['runtime.mcp.sources']],
    ['a tool policy entry', (wire) => { delete (((wire.effective as Json).config as Json).tools as Json).write_file; }, ['config.tools.write_file.permission', 'config.tools.write_file.denylist']],
    ['a nested setting parent', (wire) => { delete ((wire.effective as Json).config as Json).session_logging; }, ['config.session_logging.enabled', 'config.session_logging.generate_titles']],
    ['the thinking field', (wire) => { ((wire.runtime as Json).runtime as Json).config = {}; }, ['runtime.config.activeModel.thinking', 'runtime.config.activeModel.alias']],
    ['the model entry', (wire) => { delete (((wire.effective as Json).config as Json).models as Json)[alias]; }, [`config.models["${alias}"].thinking`]]
  ];
  for (const [name, mutate, expected] of missing) {
    it(`treats missing ${name} as a mismatch`, () => {
      const wire = cleanWire(plan.expectation, 'off');
      mutate(wire);
      const found = paths(compareReadback(plan.expectation, observe(wire), { checkThinking: true }));
      if (expected.length > 0) expect(found).toEqual(expected);
      else {
        expect(found).toEqual(expect.arrayContaining(['config.enabled_tools', 'config.disabled_tools', 'config.enable_subagents', 'config.session_logging.enabled', 'config.tools.read_file.permission']));
        expect(found.length).toBeGreaterThan(20);
      }
    });
  }

  it('reports the expected and actual values and formats them for an error detail', () => {
    const wire = cleanWire(plan.expectation, 'off');
    assign(wire.effective as Json, ['config', 'enable_subagents'], true);
    ((wire.runtime as Json).runtime as Json).connectors = {};
    const mismatches = compareReadback(plan.expectation, observe(wire), { checkThinking: true });
    expect(mismatches).toEqual([
      { path: 'runtime.connectors.connected', expected: 0, actual: undefined },
      { path: 'config.enable_subagents', expected: false, actual: true }
    ]);
    expect(formatReadbackMismatches(mismatches)).toBe('runtime.connectors.connected: expected 0, got missing; config.enable_subagents: expected false, got true');
  });

  it('bounds the formatted detail', () => {
    const wire = cleanWire(plan.expectation, 'off');
    (wire.effective as Json).config = {};
    const text = formatReadbackMismatches(compareReadback(plan.expectation, observe(wire), { checkThinking: true }));
    expect(text).toMatch(/; and \d+ more$/);
    expect(text.split('; ').length).toBeLessThanOrEqual(21);
  });

  it('judges review expectations against a review-only catalogue', () => {
    const review = buildSessionConfig({ mode: 'review', workspace, runDirectory: '/srv/runs/run-0002', maxTurns: 5 });
    expect(compareReadback(review.expectation, observe(cleanWire(review.expectation, 'off')), { checkThinking: true })).toEqual([]);
    expect(paths(compareReadback(review.expectation, observe(cleanWire(plan.expectation, 'off')), { checkThinking: true }))).toEqual(['runtime.tools', 'config.enabled_tools']);
  });
});

class FixtureClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (frame: Json) => void>();
  private nextId = 1;
  private buffered = '';
  started: unknown;

  constructor(scenario: string, env: Record<string, string>) {
    this.child = spawn(process.execPath, [fixture, '--scenario', scenario], { env: { PATH: process.env.PATH ?? '', MISTRAL_API_KEY: 'sk-test-not-a-real-credential-value', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffered += chunk;
      for (let newline = this.buffered.indexOf('\n'); newline >= 0; newline = this.buffered.indexOf('\n')) {
        const line = this.buffered.slice(0, newline);
        this.buffered = this.buffered.slice(newline + 1);
        const frame = JSON.parse(line) as Json;
        if (typeof frame.id === 'number' && ('result' in frame || 'error' in frame)) this.pending.get(frame.id)?.(frame);
      }
    });
    this.child.stdin.on('error', () => undefined);
  }

  async call(method: string, params: Json): Promise<unknown> {
    const id = this.nextId++;
    const response = new Promise<Json>((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const frame = await response;
    if (frame.error) throw new Error(`${method} failed: ${JSON.stringify(frame.error)}`);
    return frame.result;
  }

  async startSession(agentConfig: Json): Promise<string> {
    await this.call('initialize', { clientInfo: { name: 'vibe-supervisor', version: '2.0.0', entrypoint: 'programmatic' }, capabilities: { callbackKinds: ['approval'] } });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);
    const started = await this.call('session/start', { agentConfig, historyLimit: 200 });
    this.started = started;
    return (parseSessionStartResult(started).state.session.id);
  }

  kill(): void { this.child.kill('SIGKILL'); }
}

let temporary = '';
let runDirectory = '';
let sessionPlan: SessionConfigPlan;
const clients: FixtureClient[] = [];

beforeEach(async () => {
  temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'readback-')));
  runDirectory = path.join(temporary, 'run');
  sessionPlan = buildSessionConfig({ mode: 'edit', workspace, runDirectory, maxTurns: 7 });
  await writeSessionFiles(sessionPlan);
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.kill();
  await rm(temporary, { recursive: true, force: true });
});

async function scenarioFile(patch: Json): Promise<string> {
  const file = path.join(temporary, `scenario-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(file, JSON.stringify({ name: 'readback', effectiveConfig: { tools: sessionPlan.profile.document.tools }, ...patch }));
  return file;
}

async function readBack(patch: Json, options: { applyEnvironment?: boolean; thinkingOff?: boolean } = {}): Promise<{ first: ReadbackMismatch[]; second: ReadbackMismatch[] | null }> {
  const env = options.applyEnvironment === false ? { HOME: temporary, TMPDIR: sessionPlan.directories.tmp } : sessionPlan.environment;
  const client = new FixtureClient(await scenarioFile(patch), env);
  clients.push(client);
  const request = buildSessionStart(sessionPlan.agentConfig);
  const sessionId = await client.startSession(request.params.agentConfig);
  await client.call('session/ready/wait', buildSessionReadyWait(sessionId).params);
  const read = async () => ({
    sessionStart: parseSessionStartResult(client.started),
    runtime: parseRuntimeReadResult(await client.call('runtime/read', buildRuntimeRead(sessionId).params)),
    effective: parseConfigEffectiveReadResult(await client.call('config/effective/read', buildConfigEffectiveRead(sessionId).params))
  });
  const first = compareReadback(sessionPlan.expectation, await read(), { checkThinking: false });
  if (options.thinkingOff !== true) return { first, second: null };
  await client.call('config/model/write', buildThinkingOffWrite(sessionId).params);
  return { first, second: compareReadback(sessionPlan.expectation, await read(), { checkThinking: true }) };
}

describe('compareReadback against the fake vibe-app-server', () => {
  it('passes the startup read-back and the post-write read-back on a clean start', async () => {
    const { first, second } = await readBack({}, { thinkingOff: true });
    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  it('fails the thinking check when the server ignores the model write', async () => {
    const { first, second } = await readBack({ modelWrite: { ignore: true } }, { thinkingOff: true });
    expect(first).toEqual([]);
    expect(paths(second ?? [])).toEqual(['runtime.config.activeModel.thinking', `config.models["${alias}"].thinking`]);
  });

  it('fails the readback-mismatch scenario on the hook count only', async () => {
    const { first } = await readBack({ runtime: { hooksCount: 1 } });
    expect(first).toEqual([{ path: 'runtime.hooksCount', expected: 0, actual: 1 }]);
  });

  it('fails when the process environment did not apply', async () => {
    const { first } = await readBack({}, { applyEnvironment: false });
    expect(paths(first)).toEqual(expect.arrayContaining([
      'config.enable_subagents', 'config.enable_background_processes', 'config.enable_connectors', 'config.disabled_skills',
      'config.enable_telemetry', 'config.enable_update_checks', 'config.session_logging.enabled'
    ]));
    expect(first.find((item) => item.path === 'config.enable_subagents')).toEqual({ path: 'config.enable_subagents', expected: false, actual: true });
  });

  it('fails when the agent profile layer is not reflected in the effective config', async () => {
    const { first } = await readBack({ effectiveConfig: { tools: { $delete: true } } });
    expect(paths(first)).toEqual(['config.tools.read_file.permission', 'config.tools.read_file.denylist', 'config.tools.write_file.permission', 'config.tools.write_file.denylist', 'config.tools.edit.permission', 'config.tools.edit.denylist']);
  });

  it('fails on a legacy harness, a skill, an MCP source, a connected connector, bypass and an issue', async () => {
    const { first } = await readBack({
      harness: 'legacy',
      runtime: {
        skills: [{ name: 'plugin-skill', description: '', prompt: '' }],
        mcpSources: [{ name: 'x', kind: 'server', transport: 'stdio', status: 'enabled' }],
        connectors: { connected: 1, total: 1 },
        bypassToolPermissions: true,
        issues: [{ file: 'config.toml', message: 'bad' }]
      }
    });
    expect(paths(first).sort()).toEqual([
      'runtime.bypassToolPermissions', 'runtime.connectors.connected', 'runtime.connectors.total',
      'runtime.issues', 'runtime.mcp.sources', 'runtime.skills', 'session.harness'
    ].sort());
  });
});
