import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, realpath, rm } from 'node:fs/promises';
import type { SupervisorBackend, SupervisorConfig, StartRunInput, BackendCallbacks, BackendRunHandle, BackendStartResult, BackendCapabilities, RuntimeCheck, SupervisorError, UsageState } from '../contracts.js';
import { supervisorError } from '../contracts.js';
import { APP_VERSION } from '../version.js';
import { spawnManaged, type ManagedProcess } from '../process/managed.js';
import { resolveCommand } from './launcher.js';
import { assertNoProjectVibeExtensions } from './profile.js';
import { SUPPORTED_VIBE } from './pinned.js';
import { environmentSecrets, redactSecrets } from '../security/redaction.js';
import { JsonRpcClient } from './app-server/jsonrpc.js';
import { object, array, string, type JsonObject } from './app-server/protocol.js';
import { createAppServerProfile, APP_SERVER_MODEL, APP_SERVER_REASONING, type AppServerProfile } from './app-server/session-config.js';
import { validateRuntime, validateEffectiveConfig, validateSessionSnapshot } from './app-server/readback.js';
import { verifyInstallation } from './app-server/pin.js';
import { UsageAccounting, type AccountingStop } from './app-server/usage.js';
import { ApprovalPolicy, toolName, historicalEffectFingerprint, type ApprovalAnswer } from './app-server/approvals.js';
import { HistoryProjection, EventWatermark } from './app-server/events.js';
import { waitForSearchTermination } from './app-server/search-lifetime.js';

interface LaunchResult { process: ManagedProcess; executable: string; version: string }
export interface AppServerDependencies {
  /** Trusted caller seam for independent fixture tests; not selectable by config or MCP input. */
  launch?(input: StartRunInput, profile: AppServerProfile): Promise<LaunchResult>;
}

interface Runtime {
  input: StartRunInput;
  callbacks: BackendCallbacks;
  profile: AppServerProfile;
  process: ManagedProcess;
  rpc: JsonRpcClient;
  handle: BackendRunHandle;
  sessionId?: string;
  turnId?: string;
  history?: HistoryProjection;
  watermark?: EventWatermark;
  policy?: ApprovalPolicy;
  accounting?: UsageAccounting;
  usage?: UsageState;
  stop?: AccountingStop;
  reported: boolean;
  terminalState?: 'completed' | 'failed' | 'cancelled';
  closing: boolean;
  cancelled: boolean;
  finished: Promise<void>;
  finish(): void;
  pending: Map<string, { answer: ApprovalAnswer; deadline: number }>;
  effectOutcomes: Map<string, string>;
  historicalEffects: Map<string, string>;
  closePromise?: Promise<void>;
  elapsedStart: number;
}

function normalized(cause: unknown): SupervisorError {
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' && cause.code.startsWith('VSUP_')) return cause as SupervisorError;
  return supervisorError('VSUP_BACKEND_ERROR', 'App-server runtime validation or communication failed.');
}

async function boundedDone(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise.then(() => true, () => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export class AppServerBackend implements SupervisorBackend {
  readonly kind = 'app-server' as const;
  constructor(private readonly config: SupervisorConfig, private readonly dependencies: AppServerDependencies = {}) {}

  private async executable(): Promise<string> {
    if (this.config.paths?.vibeAppServer) return this.config.paths.vibeAppServer;
    if (this.config.paths?.vibe) return path.join(path.dirname(await resolveCommand(this.config.paths.vibe, process.env)), 'vibe-app-server');
    return 'vibe-app-server';
  }

  async probe(): Promise<BackendCapabilities> {
    try {
      const verified = await verifyInstallation(await this.executable());
      return { available: true, backend: this.kind, executable: verified.executable, version: verified.version, details: { reason: 'Published wheel bytes and dependency versions verified; no Vibe import or inference.', files_checked: verified.filesChecked } };
    } catch { return { available: false, backend: this.kind, details: { reason: 'Pinned app-server installation verification failed.' } }; }
  }

  async runtimeCheck(): Promise<RuntimeCheck> {
    const command = await this.executable();
    const identity = { backend: this.kind, expected_model_alias: APP_SERVER_MODEL, expected_reasoning_effort: APP_SERVER_REASONING, accounting_limits: { max_session_tokens: this.config.limits.maxSessionTokens ?? null, max_estimated_cost_usd: this.config.limits.maxEstimatedCostUsd ?? null } };
    try {
      return { ...identity, executable: command, resolved_executable: await resolveCommand(command, process.env), executable_found: true, pinned_version: SUPPORTED_VIBE, version_verified: false, note: 'App-server path resolved only. Wheel hashes, interpreter flags and unified-session controls are checked when a run starts.' };
    } catch { return { ...identity, executable: command, resolved_executable: null, executable_found: false, pinned_version: SUPPORTED_VIBE, version_verified: false, note: 'Pinned app-server executable could not be resolved.' }; }
  }

  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    await assertNoProjectVibeExtensions(input.cwd); await assertNoProjectVibeExtensions(input.workerWorkspace);
    const started = performance.now();
    const profile = await createAppServerProfile(input, Date.now() + input.limits.timeoutSeconds * 1000);
    let launch: LaunchResult;
    try {
      if (this.dependencies.launch) launch = await this.dependencies.launch(input, profile);
      else {
        const verified = await verifyInstallation(await this.executable());
        if (process.env.HOME && path.isAbsolute(process.env.HOME)) profile.env.VIBE_SUPERVISOR_ORIGINAL_HOME = process.env.HOME;
        launch = {
          executable: verified.executable, version: verified.version,
          process: spawnManaged(verified.interpreter, ['-I', '-S', '-B', '-X', 'utf8', fileURLToPath(new URL('./runtime/app_server_bootstrap.py', import.meta.url)), '--site-root', verified.siteRoot], {
            cwd: input.runDirectory, env: profile.env, forwardEnv: Object.keys(profile.env), stdio: ['pipe', 'pipe', 'pipe'],
            maxStdoutBytes: input.limits.maxEventBytes, maxStderrBytes: input.limits.maxEventBytes,
          }),
        };
      }
    } catch (cause) { await this.removePrivate(profile, input.runDirectory); throw normalized(cause); }
    const childProcess = launch.process;
    if (!childProcess.child.stdout || !childProcess.child.stdin) { await childProcess.terminate(); throw supervisorError('VSUP_BACKEND_ERROR', 'App-server pipes are unavailable.'); }
    let resolveFinished: () => void = () => undefined;
    const finished = new Promise<void>(resolve => { resolveFinished = resolve; });
    const runtime = {} as Runtime;
    const handle: BackendRunHandle = { runId: input.runId, backend: this.kind, opaque: runtime };
    const rpc = new JsonRpcClient(childProcess.child.stdout, childProcess.child.stdin, {
      maxBytes: input.limits.maxEventBytes,
      remainingMs: () => Math.max(0, input.limits.timeoutSeconds * 1000 - (performance.now() - started)),
      onNotification: (method, params) => this.notification(runtime, method, params),
      onRequest: (method, params) => this.callback(runtime, method, params),
      afterResponse: (method, params, result) => this.callbackResult(runtime, method, params, result),
      onFailure: error => { if (!runtime.closing) void this.fail(runtime, error); },
      onActivity: () => callbacks.onActivity?.('app-server-frame'),
    });
    Object.assign(runtime, { input, callbacks, profile, process: childProcess, rpc, handle, reported: false, closing: false, cancelled: false, finished, finish: resolveFinished, pending: new Map(), effectOutcomes: new Map(), historicalEffects: new Map(), elapsedStart: started });
    childProcess.child.stderr?.on('data', () => callbacks.onActivity?.('stderr'));
    childProcess.done.then(() => { if (!runtime.closing && !runtime.reported) void this.fail(runtime, supervisorError('VSUP_BACKEND_CRASHED', 'App-server exited before its turn was finalized.')); }, () => { if (!runtime.closing) void this.fail(runtime, supervisorError('VSUP_BACKEND_CRASHED', 'App-server process failed.')); });
    try {
      callbacks.onSpawn?.(handle);
      const initialization = await rpc.request('initialize', { clientInfo: { name: 'vibe-supervisor', version: APP_VERSION, entrypoint: 'programmatic' }, capabilities: { callbackKinds: ['approval'] } });
      if (object(initialization.serverInfo, 'server info').version !== SUPPORTED_VIBE) throw supervisorError('VSUP_VIBE_VERSION_UNSUPPORTED', 'App-server handshake version drift.');
      await rpc.notify('initialized', {});
      const opened = await rpc.request('session/start', { agentConfig: profile.agentConfig });
      const state = object(opened.state, 'session state');
      runtime.sessionId = validateSessionSnapshot(state, input);
      runtime.watermark = new EventWatermark(state.eventId as number);
      runtime.history = new HistoryProjection(runtime.sessionId, input.limits.maxEventBytes);
      await rpc.request('runtime/read', { sessionId: runtime.sessionId });
      await rpc.request('session/ready/wait', { sessionId: runtime.sessionId });
      validateRuntime(await rpc.request('runtime/read', { sessionId: runtime.sessionId }), profile, false);
      validateEffectiveConfig(await rpc.request('config/effective/read', { sessionId: runtime.sessionId }), profile);
      await rpc.request('config/model/write', { sessionId: runtime.sessionId, modelAlias: APP_SERVER_MODEL, reasoningEffort: APP_SERVER_REASONING });
      const ready = await rpc.request('runtime/read', { sessionId: runtime.sessionId });
      validateRuntime(ready, profile, true);
      validateEffectiveConfig(await rpc.request('config/effective/read', { sessionId: runtime.sessionId }), profile);
      runtime.accounting = new UsageAccounting(object(ready.runtime).stats, input.limits);
      if (runtime.cancelled || runtime.closing) throw supervisorError('VSUP_CANCELLED', 'Run was cancelled during app-server preparation.');
      const context = (input.contextFiles ?? []).map(file => `Approved context path: ${file}`).join('\n');
      const turn = object((await rpc.request('turn/start', { sessionId: runtime.sessionId, message: [{ type: 'text', text: context ? `${context}\n\nTask:\n${input.task}` : input.task }] })).turn, 'turn');
      this.bindTurn(runtime, turn);
      if (!runtime.reported) await callbacks.onState('running', { process: { ...(childProcess.child.pid === undefined ? {} : { pid: childProcess.child.pid }), executable: launch.executable, version: launch.version } });
      return { handle, initialState: runtime.terminalState ?? 'running', process: { ...(childProcess.child.pid === undefined ? {} : { pid: childProcess.child.pid }), executable: launch.executable, version: launch.version } };
    } catch (cause) {
      runtime.policy?.stop(); runtime.finish();
      await this.shutdown(runtime);
      throw runtime.cancelled ? supervisorError('VSUP_CANCELLED', 'Run was cancelled during app-server startup.') : normalized(cause);
    }
  }

  private bindTurn(runtime: Runtime, value: JsonObject): void {
    if (value.sessionId !== runtime.sessionId) throw supervisorError('VSUP_BACKEND_ERROR', 'Turn belongs to another session.');
    const id = string(value.id, 'turn id');
    if (runtime.turnId && runtime.turnId !== id) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server created an unexpected turn.');
    if (!runtime.turnId) { runtime.turnId = id; runtime.policy = new ApprovalPolicy(runtime.input.workerWorkspace, runtime.input.mode, runtime.sessionId as string, id); }
  }

  private async history(runtime: Runtime, timeoutMs = 30_000): Promise<void> {
    if (!runtime.sessionId || !runtime.history) throw supervisorError('VSUP_BACKEND_ERROR', 'Session is not initialized.');
    const deadline = performance.now() + timeoutMs;
    const cursors = new Set<string>(); const ids = new Set<string>(); const pages: unknown[][] = []; let cursor: string | undefined;
    for (let page = 0; page < 128; page++) {
      const response = await runtime.rpc.request('session/history/list', { sessionId: runtime.sessionId, ...(runtime.turnId ? { turnId: runtime.turnId } : {}), page: { direction: 'backward', limit: 100, ...(cursor === undefined ? {} : { cursor }) } }, deadline - performance.now());
      const items = array(response.items, 'history page');
      for (const value of items) {
        const id = string(object(value).id, 'history id');
        if (ids.has(id)) throw supervisorError('VSUP_BACKEND_ERROR', 'Repeated history entry in pagination.');
        ids.add(id);
        if (ids.size > 4096) throw supervisorError('VSUP_OUTPUT_LIMIT', 'App-server history entry limit exceeded.');
      }
      pages.push(items);
      if (response.nextCursor === null) {
        for (const values of pages.reverse()) for (const value of values) await this.observe(runtime, runtime.history.add(value));
        return;
      }
      cursor = string(response.nextCursor, 'history cursor');
      if (cursors.has(cursor)) throw supervisorError('VSUP_BACKEND_ERROR', 'Repeated history cursor.');
      cursors.add(cursor);
    }
    throw supervisorError('VSUP_OUTPUT_LIMIT', 'App-server history page limit exceeded.');
  }

  private async observe(runtime: Runtime, entry: JsonObject | undefined): Promise<void> {
    if (!entry || entry.type !== 'effect') return;
    const old = runtime.historicalEffects.get(string(entry.id, 'effect id'));
    if (old !== undefined) {
      if (old !== historicalEffectFingerprint(entry)) throw supervisorError('VSUP_BACKEND_ERROR', 'Historical effect changed after session handoff.');
      return;
    }
    if (!runtime.policy || entry.turnId !== runtime.turnId) throw supervisorError('VSUP_BACKEND_ERROR', 'Tool effect appeared outside the active turn.');
    runtime.policy.record(entry);
    const name = toolName(object(entry.detail).toolName) ?? '<other>';
    const status = string(object(entry.state).status, 'effect status'); const id = string(entry.id, 'effect id');
    if (runtime.effectOutcomes.get(id) !== status) {
      runtime.effectOutcomes.set(id, status);
      await runtime.callbacks.onEvent({ source: 'vibe', type: 'tool_call', severity: 'info', data: { name, state: status, tool_call_id: id } });
    }
  }

  private async reconcile(runtime: Runtime, timeoutMs = 5000): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    const response = await runtime.rpc.request('session/read', { sessionId: runtime.sessionId, history: null, turns: null }, timeoutMs);
    const state = object(response.state, 'reconciled session');
    if (validateSessionSnapshot(state, runtime.input, true) !== runtime.sessionId) throw supervisorError('VSUP_BACKEND_ERROR', 'Session changed while reconciling.');
    await this.history(runtime, deadline - performance.now());
    runtime.watermark?.adopt(state.eventId);
  }

  private async callback(runtime: Runtime, method: string, params: JsonObject): Promise<JsonObject> {
    if (method !== 'callback/call') throw supervisorError('VSUP_BACKEND_ERROR', 'Unknown app-server callback method.');
    const callback = object(params.callback, 'callback'); const id = string(callback.callbackId, 'callback id');
    if (!runtime.policy || runtime.closing || runtime.reported) return { callbackId: id, accepted: false };
    const deadline = performance.now() + 5000;
    await this.reconcile(runtime, 5000);
    const answer = await runtime.policy.decide(callback, deadline - performance.now());
    if (runtime.pending.size >= 32) throw supervisorError('VSUP_OUTPUT_LIMIT', 'Pending callback limit exceeded.');
    runtime.pending.set(id, { answer, deadline });
    return { callbackId: id, accepted: true };
  }

  private async callbackResult(runtime: Runtime, method: string, _params: JsonObject, result: JsonObject): Promise<void> {
    if (method !== 'callback/call' || result.accepted !== true) return;
    const id = string(result.callbackId, 'callback acknowledgement'); const pending = runtime.pending.get(id);
    if (!pending) throw supervisorError('VSUP_BACKEND_ERROR', 'Callback acknowledgement has no decision.');
    runtime.pending.delete(id);
    if (performance.now() >= pending.deadline || runtime.closing) {
      runtime.policy?.revoke(id);
      runtime.policy?.stop();
      pending.answer = { callbackId: id, sessionId: runtime.sessionId as string, approved: false, output: { type: 'approval', decision: { type: 'deny' }, feedback: null } };
    }
    const answer = pending.answer;
    const response = await runtime.rpc.request('callback/result', { sessionId: answer.sessionId, result: { callbackId: id, ...(answer.error ? { error: answer.error } : { output: answer.output }) } }, Math.max(1, pending.deadline - performance.now()));
    if (response.accepted !== true) throw supervisorError('VSUP_BACKEND_ERROR', 'Callback result was not accepted.');
  }

  private async notification(runtime: Runtime, method: string, params: JsonObject): Promise<void> {
    if (runtime.closing || runtime.reported) return;
    if (method === 'warning' || method === 'turn/retrying') return;
    if (method === 'error') throw supervisorError('VSUP_BACKEND_ERROR', 'App-server reported a runtime error.');
    if (!runtime.sessionId) return; // Startup notices cannot authorize work.
    if (method === 'session/compacted' || method === 'session/contextCleared') { await this.handoff(runtime, params); return; }
    if (params.sessionId !== undefined && params.sessionId !== runtime.sessionId) throw supervisorError('VSUP_BACKEND_ERROR', 'Notification belongs to another session.');
    if (params.eventId !== undefined) {
      const order = runtime.watermark?.inspect(params.eventId);
      if (order === 'replay') return;
      if (order === 'gap') { await this.reconcile(runtime); if (runtime.watermark?.inspect(params.eventId) === 'replay') return; }
      runtime.watermark?.adopt(params.eventId);
    }
    if (method === 'turn/started') { this.bindTurn(runtime, object(params.turn)); return; }
    if (method === 'history/entryAdded') { await this.observe(runtime, runtime.history?.add(params.entry)); return; }
    if (method === 'history/entryUpdated') { await this.observe(runtime, runtime.history?.update(string(params.entryId, 'entry id'), params.patch)); return; }
    if (method === 'session/statsUpdated' && runtime.accounting) {
      const value = runtime.accounting.update(params.stats); runtime.usage = value.usage;
      await runtime.callbacks.onState('running', { usage: value.usage });
      if (value.stop && !runtime.stop) { runtime.stop = value.stop; runtime.policy?.stop(); await this.interrupt(runtime); }
      return;
    }
    if (method === 'runtime/updated') {
      validateRuntime(await runtime.rpc.request('runtime/read', { sessionId: runtime.sessionId }), runtime.profile, true);
      validateEffectiveConfig(await runtime.rpc.request('config/effective/read', { sessionId: runtime.sessionId }), runtime.profile);
      return;
    }
    if (method === 'session/childSessionUpdated') throw supervisorError('VSUP_BACKEND_ERROR', 'Unexpected child session.');
    if (method === 'turn/completed') {
      const turn = object(params.turn); this.bindTurn(runtime, turn); await this.complete(runtime, turn);
    }
  }

  private async handoff(runtime: Runtime, params: JsonObject): Promise<void> {
    if (params.oldSessionId !== runtime.sessionId || runtime.pending.size !== 0 || !runtime.turnId || !runtime.history) throw supervisorError('VSUP_BACKEND_ERROR', 'Uncertain session handoff or pending callback.');
    runtime.policy?.stop();
    for (const entry of runtime.history.values()) {
      if (entry.type !== 'effect') continue;
      if (!['completed', 'failed', 'cancelled', 'skipped'].includes(object(entry.state).status as string)) throw supervisorError('VSUP_BACKEND_ERROR', 'Session handoff has an unfinished effect.');
      runtime.historicalEffects.set(string(entry.id, 'historical effect'), historicalEffectFingerprint(entry));
    }
    if (runtime.historicalEffects.size > 4096) throw supervisorError('VSUP_OUTPUT_LIMIT', 'Historical effect limit exceeded.');
    const state = object(params.state, 'handoff state');
    const next = validateSessionSnapshot(state, runtime.input);
    if (next === runtime.sessionId) throw supervisorError('VSUP_BACKEND_ERROR', 'Session handoff did not change identity.');
    runtime.sessionId = next; runtime.watermark = new EventWatermark(state.eventId as number);
    runtime.history = new HistoryProjection(next, runtime.input.limits.maxEventBytes);
    runtime.policy = new ApprovalPolicy(runtime.input.workerWorkspace, runtime.input.mode, next, runtime.turnId);
    const ready = await runtime.rpc.request('runtime/read', { sessionId: next });
    validateRuntime(ready, runtime.profile, true);
    validateEffectiveConfig(await runtime.rpc.request('config/effective/read', { sessionId: next }), runtime.profile);
    if (runtime.accounting) {
      const measured = runtime.accounting.handoff(object(ready.runtime).stats); runtime.usage = measured.usage;
      if (measured.stop) runtime.stop ??= measured.stop;
    }
    for (const entry of array(state.history ?? [], 'handoff history')) await this.observe(runtime, runtime.history.add(entry));
    await runtime.callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { reason: 'session_handoff', message: 'Vibe changed its session identity; configuration was revalidated and no pending grants or task were replayed.' } });
    if (runtime.stop) { runtime.policy.stop(); await this.interrupt(runtime); }
  }

  private async complete(runtime: Runtime, turn: JsonObject): Promise<void> {
    if (runtime.reported) return;
    await this.history(runtime);
    const response = await runtime.rpc.request('runtime/read', { sessionId: runtime.sessionId });
    validateRuntime(response, runtime.profile, true);
    if (runtime.accounting) {
      const measured = runtime.accounting.update(object(response.runtime).stats); runtime.usage = measured.usage; if (measured.stop) runtime.stop ??= measured.stop;
    }
    const text = runtime.history?.finalMessage(runtime.turnId as string, runtime.input.limits.maxTranscriptBytes);
    const summary = text === undefined ? undefined : redactSecrets(text, environmentSecrets(runtime.profile.env));
    if (summary) await runtime.callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: summary } });
    const error = turn.error === null || turn.error === undefined ? undefined : object(turn.error);
    if (!['completed', 'failed', 'interrupted'].includes(turn.status as string) || (turn.stopReason !== undefined && turn.stopReason !== null && !['limit', 'length'].includes(turn.stopReason as string))) throw supervisorError('VSUP_BACKEND_ERROR', 'Unknown completed-turn outcome.');
    runtime.policy?.stop(); runtime.reported = true; runtime.finish();
    if (runtime.cancelled) { runtime.terminalState = 'cancelled'; await runtime.callbacks.onState('cancelled'); return; }
    if (runtime.stop || (turn.status === 'completed' && turn.stopReason === 'limit')) {
      runtime.terminalState = 'completed';
      await runtime.callbacks.onState('completed', { ...(runtime.usage ? { usage: runtime.usage } : {}), result: { stopReason: runtime.stop ?? 'max_turn_requests', ...(summary ? { summary } : {}), warnings: ['Execution ended at a configured limit; the result is incomplete.'] } });
      return;
    }
    if (error?.code === 'refusal') {
      runtime.terminalState = 'completed';
      await runtime.callbacks.onState('completed', { ...(runtime.usage ? { usage: runtime.usage } : {}), result: { stopReason: 'refusal', ...(summary ? { summary } : {}), warnings: ['The provider refused the task; completion does not establish task acceptance.'] } });
      return;
    }
    if (turn.status !== 'completed' || turn.stopReason === 'length' || error) {
      runtime.terminalState = 'failed';
      const code = error?.code === 'rate_limited' ? 'VSUP_RATE_LIMITED' : error?.code === 'invalid_api_key' ? 'VSUP_AUTH_REQUIRED' : error?.code === 'invalid_model' ? 'VSUP_CONFIG_INVALID' : 'VSUP_BACKEND_ERROR';
      await runtime.callbacks.onState('failed', { error: supervisorError(code, 'App-server turn failed, was interrupted, or returned an unsupported outcome.') });
      return;
    }
    runtime.terminalState = 'completed';
    await runtime.callbacks.onState('completed', { ...(runtime.usage ? { usage: runtime.usage } : {}), result: { stopReason: 'end_turn', ...(summary ? { summary } : {}), ...(!summary ? { warnings: ['Vibe produced no final message.'] } : {}) } });
  }

  private async fail(runtime: Runtime, error: SupervisorError): Promise<void> {
    if (runtime.reported || runtime.closing) return;
    runtime.reported = true; runtime.terminalState = 'failed'; runtime.policy?.stop(); runtime.finish();
    try { await runtime.callbacks.onState('failed', { error }); }
    finally { await this.shutdown(runtime).catch(() => undefined); }
  }

  private async interrupt(runtime: Runtime): Promise<void> {
    if (!runtime.sessionId || !runtime.turnId || runtime.closing) return;
    try { await runtime.rpc.request('turn/interrupt', { sessionId: runtime.sessionId, expectedTurnId: runtime.turnId }, 5000); }
    catch (cause) {
      const error = normalized(cause);
      if (error.details?.protocol_code !== 'stale_turn' && error.details?.protocol_code !== 'conflict') throw error;
    }
  }

  async cancel(handle: BackendRunHandle): Promise<void> {
    const runtime = handle.opaque as Runtime; runtime.cancelled = true; runtime.policy?.stop();
    if (runtime.turnId && !runtime.reported) {
      await this.interrupt(runtime).catch(() => undefined);
      await boundedDone(runtime.finished, 5000);
    }
    await this.shutdown(runtime);
  }
  async close(handle: BackendRunHandle): Promise<void> { await this.shutdown(handle.opaque as Runtime); }
  async terminateNow(handle: BackendRunHandle): Promise<void> {
    const runtime = handle.opaque as Runtime; runtime.cancelled = true; runtime.policy?.stop(); runtime.rpc.close();
    await runtime.process.terminate(0); await this.shutdown(runtime);
  }

  private async shutdown(runtime: Runtime): Promise<void> {
    if (runtime.closePromise) return runtime.closePromise;
    const closing = (async () => {
      runtime.closing = true; runtime.policy?.stop(); runtime.rpc.close();
      await boundedDone(runtime.process.done, 5000);
      await runtime.process.terminate(0);
      if (!runtime.process.terminationVerified || runtime.process.child.pid === undefined) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server termination remains unverified.');
      await waitForSearchTermination(runtime.profile.searchRegistry, runtime.profile.searchNonce, runtime.input.runId, runtime.process.child.pid);
      await this.removePrivate(runtime.profile, runtime.input.runDirectory);
      runtime.finish();
    })();
    runtime.closePromise = closing;
    try { await closing; } catch (error) { delete runtime.closePromise; throw error; }
  }

  private async removePrivate(profile: AppServerProfile, runDirectory: string): Promise<void> {
    if (await realpath(runDirectory) !== runDirectory) throw supervisorError('VSUP_BACKEND_ERROR', 'Run directory changed before private cleanup.');
    for (const directory of [profile.home, profile.vibeHome, profile.tmp]) {
      if (path.dirname(directory) !== runDirectory) throw supervisorError('VSUP_BACKEND_ERROR', 'Private cleanup path is outside the run.');
      try {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw supervisorError('VSUP_BACKEND_ERROR', 'Private cleanup path ownership changed.');
        await rm(directory, { recursive: true });
      } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    }
  }
}
