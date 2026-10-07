import { Readable, Writable } from 'node:stream';
import { client, ndJsonStream } from '@agentclientprotocol/sdk';
import type { ClientContext, RequestPermissionRequest } from '@agentclientprotocol/sdk';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, realpath, rm, lstat } from 'node:fs/promises';
import type {
  BackendCapabilities, BackendRespondInput, BackendRunHandle, BackendStartResult, RunRecord,
  StartRunInput, SupervisorBackend, BackendCallbacks, PendingRequest
} from '../contracts.js';
import { supervisorError, type SupervisorConfig, type SupervisorError } from '../contracts.js';
import { spawnManaged } from '../process/managed.js';
import { assertNoProjectVibeExtensions, createVibeChildProfile } from './profile.js';
import type { VibeChildProfile } from './profile.js';
import { APP_VERSION } from '../version.js';
import { buildVibeLaunch, classifyFailureText, classifyStartFailure, describeMissing, isCodedError, spawned, versionUnsupported } from './launcher.js';
import { ACP_PROTOCOL_VERSION, SUPPORTED_VIBE } from './pinned.js';
import { executableProbeKey, ProbeCache } from './probe-cache.js';
import type { ProbeOptions } from './probe-cache.js';
import type { VibeLaunch } from './launcher.js';
import { environmentSecrets, redactSecrets, redactedTail, StreamingRedactor } from '../security/redaction.js';
import { resolveCanonicalRoot } from '../security/paths.js';
import { reportBackgroundFailure } from '../diagnostics/background.js';

const PROTOCOL_VERSION = ACP_PROTOCOL_VERSION;
const MAX_WIRE_BYTES = 1024 * 1024;
const CANCEL_TURN_GRACE_MS = 500;
const DEFAULT_RECOVER_TIMEOUT_MS = 30_000;
const RECOVER_STDERR_CHARS = 4096;
const EXITED_MID_TURN = 'Vibe ACP exited before the turn finished.';

function interpreterReason(launcher: string, interpreter: unknown): string {
  return `The interpreter for the ${launcher} launcher${typeof interpreter === 'string' ? ` (${interpreter})` : ''} was not found.`;
}

const reportFailure = (context: string) => (error: unknown): void => reportBackgroundFailure(context, error);

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
interface Queue<T> { items: T[]; waiters: Array<(value: T | undefined) => void>; closed: boolean }
function makeQueue<T>(): Queue<T> { return { items: [], waiters: [], closed: false }; }
function enqueue<T>(queue: Queue<T>, value: T): void { const waiter = queue.waiters.shift(); if (waiter) waiter(value); else queue.items.push(value); }
function dequeue<T>(queue: Queue<T>): Promise<T | undefined> {
  const item = queue.items.shift(); if (item !== undefined) return Promise.resolve(item);
  if (queue.closed) return Promise.resolve(undefined);
  return new Promise((resolve) => queue.waiters.push(resolve));
}
function closeQueue<T>(queue: Queue<T>): void { queue.closed = true; for (const waiter of queue.waiters.splice(0)) waiter(undefined); }

interface AcpState {
  process: ReturnType<typeof spawnManaged>;
  home: string;
  vibeHome: string;
  ready: Deferred<BackendStartResult>;
  commands: Queue<{ kind: 'prompt'; message: string } | { kind: 'close' }>;
  request?: { requestId: string; kind: 'permission' | 'elicitation'; resolve: (response: unknown) => void; cancelled: unknown; options: Array<{ optionId: string; kind?: string }> };
  sessionId?: string;
  connected: Promise<void>;
  closed: boolean;
  exited: boolean;
  readySettled: boolean;
  sessionReady: boolean;
  failureReported: boolean;
  released: boolean;
  toolCalls: Map<string, Record<string, unknown>>;
  callbacks: BackendCallbacks;
  input: StartRunInput;
  context?: ClientContext;
  recovering: boolean;
  suppressReplay: boolean;
  turnActive: boolean;
  turnRedactor?: StreamingRedactor;
  activeTurn?: Promise<void>;
}
interface AcpHandle extends BackendRunHandle { opaque: AcpState }

function safeData(value: unknown, secret?: string): unknown {
  if (Array.isArray(value)) return value.map((x) => safeData(x, secret));
  if (value === null || typeof value !== 'object') return typeof value === 'string' ? redactSecrets(value, secret ? [secret] : []) : value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(reasoning|thought|chain_?of_?thought)/i.test(key)) continue;
    if (/^(api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization|cookie|set-cookie)$/i.test(key)) { result[key] = '[REDACTED]'; continue; }
    if (key === 'type' && typeof item === 'string' && /thought|reasoning/i.test(item)) return undefined;
    const cleaned = safeData(item, secret);
    if (cleaned !== undefined) result[key] = cleaned;
  }
  return result;
}
function expectedAgent(mode: StartRunInput['mode']): string { return mode === 'review' ? 'plan' : 'accept-edits'; }
function isWorkspaceTrustMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const w = (meta as Record<string, unknown>).workspace_trust;
  return !!w && typeof w === 'object' && (w as Record<string, unknown>).status === 'untrusted';
}
function isSafeFormSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 16 * 1024) return false;
  let count = 0;
  const visit = (node: unknown, depth: number): boolean => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 5) return false;
    const record = node as Record<string, unknown>;
    if (Object.keys(record).some((key) => ['$ref', '$schema', 'oneOf', 'anyOf', 'allOf', 'not'].includes(key))) return false;
    if (depth === 0 && record.type !== 'object') return false;
    if (record.type === 'object') {
      if (!record.properties || typeof record.properties !== 'object' || Array.isArray(record.properties)) return false;
      const props = record.properties as Record<string, unknown>;
      for (const [key, item] of Object.entries(props)) {
        count++;
        if (count > 24 || /url|uri|token|password|secret|credential|auth|cookie|api.?key/i.test(key) || !visit(item, depth + 1)) return false;
      }
      if (record.required !== undefined && (!Array.isArray(record.required) || record.required.some((x) => typeof x !== 'string' || !(x in props)))) return false;
      return true;
    }
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(String(record.type))) return false;
    if (record.type === 'array') return !!record.items && typeof record.items === 'object' && (record.items as Record<string, unknown>).type === 'string';
    return record.format === undefined && record.pattern === undefined;
  };
  try { return visit(value, 0); } catch { return false; }
}
function toPermissionRequest(params: RequestPermissionRequest, id: string, known?: Record<string, unknown>): PendingRequest | undefined {
  const call = known ? { ...known, ...params.toolCall } : params.toolCall;
  const name = call.name ?? call.title;
  const rawInput = call.rawInput;
  const locations = call.locations;
  // Permission data is trusted only when a prior tool-call update identifies the action and path.
  if (typeof name !== 'string' || !rawInput || typeof rawInput !== 'object' || !Array.isArray(locations) || !locations.length) return undefined;
  const safeLocations = locations.flatMap((location) => {
    if (!location || typeof location !== 'object') return [];
    const filePath = (location as Record<string, unknown>).path;
    return typeof filePath === 'string' ? [filePath] : [];
  });
  if (!safeLocations.length) return undefined;
  return { requestId: id, kind: 'permission', title: `Vibe requests permission for ${name}`, options: params.options.map((option) => ({ optionId: option.optionId, name: option.name, kind: option.kind })), tool: { ...(typeof call.kind === 'string' ? { kind: call.kind } : {}), locations: safeLocations, rawInput: safeData(rawInput) } };
}

function refusalOutcome(options: ReadonlyArray<{ optionId: string; kind?: string }>): { outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } } {
  const reject = options.find((option) => option.kind === 'reject_once') ?? options.find((option) => option.kind === 'reject_always');
  return reject ? { outcome: { outcome: 'selected', optionId: reject.optionId } } : { outcome: { outcome: 'cancelled' } };
}

export class AcpBackend implements SupervisorBackend {
  readonly kind = 'acp' as const;
  readonly supportsContinue = true;
  private readonly recoverTimeoutMs: number;
  constructor(private readonly config: SupervisorConfig, private readonly dataDirectory = config.paths?.dataDir, options: { recoverTimeoutMs?: number } = {}) {
    this.recoverTimeoutMs = options.recoverTimeoutMs ?? DEFAULT_RECOVER_TIMEOUT_MS;
  }
  private readonly probeCache = new ProbeCache();
  protected executable(): string { return this.config.paths?.vibeAcp ?? 'vibe-acp'; }
  /** Test subclasses can attach an ACP fixture process; production uses the pinned shim only. */
  protected buildLaunch(args: readonly string[], profile: VibeChildProfile, runDirectory: string): Promise<VibeLaunch> {
    return buildVibeLaunch(this.executable(), 'acp', args, profile, runDirectory);
  }

  async probe(options: ProbeOptions = {}): Promise<BackendCapabilities> {
    const key = await executableProbeKey(this.executable(), { interpreter: true });
    return this.probeCache.get(key, options.fresh === true, () => this.runProbe());
  }

  protected async runProbe(): Promise<BackendCapabilities> {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibe-supervisor-acp-probe-')));
    let home = '';
    let vibeHome = '';
    let probed: ReturnType<typeof spawnManaged> | undefined;
    let secrets: string[] = [];
    const stderrDetails = (): Record<string, unknown> => {
      const tail = probed ? redactedTail(probed.stderr.toBuffer(), 1024, secrets, probed.stderr.truncated ? 'tail' : undefined) : '';
      return tail ? { stderr_tail: tail } : {};
    };
    try {
      const input = { runId: 'probe', mode: 'review' as const, task: '', cwd: root, workerWorkspace: root, runDirectory: root, limits: { timeoutSeconds: 15, maxTurns: 1, maxEventBytes: 4096, maxTranscriptBytes: 4096, maxArtifactBytes: 4096 } };
      const profile = await createVibeChildProfile(input, 'review'); home = profile.home; vibeHome = profile.vibeHome;
      secrets = environmentSecrets(profile.env);
      const launch = await this.buildLaunch([], profile, root);
      secrets = environmentSecrets(launch.env);
      const child = spawnManaged(launch.command, launch.args, { cwd: root, env: launch.env, forwardEnv: Object.keys(launch.env), stdio: ['pipe', 'pipe', 'pipe'], maxStdoutBytes: 1024 * 1024, maxStderrBytes: 4096 });
      probed = child;
      let version: string | undefined;
      let initialized = false;
      let protocolVersion: number | undefined;
      let loadSession: boolean | undefined;
      const stream = ndJsonStream(Writable.toWeb(child.child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.child.stdout!) as ReadableStream<Uint8Array>, { maxMessageBytes: MAX_WIRE_BYTES });
      const probe = client({ name: 'vibe-supervisor-probe' });
      const connected = probe.connectWith(stream, async (cx) => {
        const init = await cx.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: 'vibe-supervisor', version: APP_VERSION } });
        version = init.agentInfo?.version ?? undefined;
        protocolVersion = init.protocolVersion;
        loadSession = init.agentCapabilities?.loadSession === true;
        initialized = init.protocolVersion === PROTOCOL_VERSION && version === SUPPORTED_VIBE;
      });
      const timer = setTimeout(() => { child.terminate(1000).catch(reportFailure('acp-probe-terminate')); }, 15_000);
      try { await Promise.race([connected, child.done.then(() => { throw new Error('ACP exited during initialize probe'); })]); }
      finally { clearTimeout(timer); await child.terminate(250); }
      const available = initialized;
      return { available, backend: this.kind, executable: this.executable(), ...(version ? { version } : {}), supportsContinue: available, supportsPermissionResponse: available, details: { ...(protocolVersion !== undefined ? { protocolVersion } : {}), ...(loadSession !== undefined ? { loadSession } : {}), ...(version ? { detected_version: version } : {}), reason: available ? 'ACP initialize passed under isolated HOME/VIBE_HOME; authenticated session/new is verified during start' : `Requires exactly Vibe ${SUPPORTED_VIBE}`, ...(available ? {} : stderrDetails()) } };
    } catch (error) {
      const missing = await describeMissing(this.executable(), error);
      return { available: false, backend: this.kind, executable: this.executable(), supportsContinue: false, supportsPermissionResponse: false, details: { ...missing, reason: missing.interpreter_missing ? interpreterReason('vibe-acp', missing.interpreter) : 'ACP initialize probe failed.', error: redactSecrets(String(error), secrets), ...stderrDetails() } };
    } finally { if (home) await rm(home, { recursive: true, force: true }); if (vibeHome) await rm(vibeHome, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
  }

  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    await assertNoProjectVibeExtensions(input.cwd); await assertNoProjectVibeExtensions(input.workerWorkspace);
    try { return await this.launchSession(input, callbacks); }
    catch (error) { this.probeCache.invalidate(); throw error; }
  }

  private async launchSession(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    const profile = await createVibeChildProfile(input, input.mode, { forwardOriginalHome: true });
    profile.env.VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS = String(input.limits.timeoutSeconds);
    let launch: VibeLaunch;
    try { launch = await this.buildLaunch([], profile, input.runDirectory); }
    catch (error) { throw await classifyStartFailure('acp', this.executable(), error); }
    const secrets = environmentSecrets(launch.env);
    const stderrRedactor = new StreamingRedactor(secrets);
    let stderrChain = Promise.resolve();
    let outputLimited = false;
    let outputLimitReported = false;
    const child = spawnManaged(launch.command, launch.args, {
      cwd: input.workerWorkspace, env: launch.env, forwardEnv: Object.keys(launch.env), stdio: ['pipe', 'pipe', 'pipe'], maxStdoutBytes: input.limits.maxTranscriptBytes, maxStderrBytes: input.limits.maxEventBytes,
      onLimit: () => { outputLimited = true; outputLimitReported = true; Promise.resolve(callbacks.onState('failed', { error: supervisorError('VSUP_OUTPUT_LIMIT', 'Vibe ACP output exceeded the configured limit.') })).catch(reportFailure('acp-output-limit')); },
      onStderr: (text) => { const safe = stderrRedactor.push(text); if (safe) stderrChain = stderrChain.then(() => callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text: safe } })).then(() => undefined).catch(() => undefined); }
    });
    try { await spawned(child); }
    catch (error) { child.done.catch(() => undefined); throw await classifyStartFailure('acp', this.executable(), error); }
    const state: AcpState = { process: child, home: profile.home, vibeHome: profile.vibeHome, ready: deferred<BackendStartResult>(), commands: makeQueue(), connected: Promise.resolve(), closed: false, exited: false, readySettled: false, sessionReady: false, failureReported: false, released: false, toolCalls: new Map(), callbacks, input, recovering: false, suppressReplay: false, turnActive: false };
    let startFailure: Promise<SupervisorError> | undefined;
    const failStart = (error: unknown): Promise<SupervisorError> => startFailure ??= (async () => {
      state.closed = true; state.readySettled = true;
      await child.terminate();
      const cause = await this.describeStartFailure(error, child, secrets);
      state.ready.reject(cause);
      return cause;
    })();
    state.connected = this.connect(state, launch.env.MISTRAL_API_KEY);
    state.connected.catch(async (error: unknown) => {
      state.closed = true;
      const cause = !state.readySettled || startFailure ? await failStart(error) : undefined;
      await child.terminate();
      const message = redactSecrets(String(error), secrets);
      const exitedIdle = state.sessionReady && !state.turnActive && child.child.exitCode === 0;
      if (!state.failureReported && !state.released && !exitedIdle) {
        state.failureReported = true;
        const exitedMidTurn = state.turnActive && child.child.exitCode === 0;
        const fallback = state.sessionReady ? 'VSUP_ACP_PROTOCOL_ERROR' : 'VSUP_ACP_INIT_FAILED';
        await callbacks.onState('failed', { error: exitedMidTurn ? supervisorError('VSUP_BACKEND_CRASHED', EXITED_MID_TURN) : cause ?? classifyFailureText(message, fallback) });
      }
    }).catch(reportFailure('acp-start-failure'));
    child.done.then(({ code, signal }) => {
      state.exited = true;
      closeQueue(state.commands);
      if (!state.readySettled) failStart(supervisorError('VSUP_ACP_INIT_FAILED', 'Vibe ACP exited before session initialization')).catch(reportFailure('acp-start-failure'));
      const tail = stderrRedactor.flush();
      if (tail) stderrChain = stderrChain.then(() => callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text: tail } })).then(() => undefined);
      stderrChain.then(() => {
        if (state.closed || state.failureReported) return;
        if (outputLimited) { state.failureReported = true; return outputLimitReported ? undefined : callbacks.onState('failed', { error: supervisorError('VSUP_OUTPUT_LIMIT', 'Vibe ACP output exceeded the configured limit.') }); }
        if (code === 0 && !state.turnActive) return;
        state.failureReported = true;
        return callbacks.onState('failed', { error: supervisorError('VSUP_BACKEND_CRASHED', code === 0 ? EXITED_MID_TURN : `Vibe ACP exited ${code ?? signal ?? 'without status'}`) });
      }).catch(reportFailure('acp-exit'));
    }).catch((error: unknown) => Promise.resolve(callbacks.onState('failed', { error: supervisorError('VSUP_BACKEND_CRASHED', String(error)) })).catch(reportFailure('acp-exit')));
    return state.ready.promise;
  }

  private async describeStartFailure(error: unknown, child: ReturnType<typeof spawnManaged>, secrets: string[]): Promise<SupervisorError> {
    const stderr = redactSecrets(child.stderr.toString(), secrets);
    const classified = await classifyStartFailure('acp', this.executable(), error, stderr);
    const tail = redactedTail(child.stderr.toBuffer(), 1024, secrets, child.stderr.truncated ? 'tail' : undefined);
    const withTail = (failure: SupervisorError): SupervisorError => tail && !failure.details && (failure.code === 'VSUP_ACP_INIT_FAILED' || failure.code === 'VSUP_AUTH_REQUIRED') ? supervisorError(failure.code, failure.message, { stderr_tail: tail }) : failure;
    if (isCodedError(classified)) return withTail(classified);
    const message = redactSecrets(String(error), secrets);
    return withTail(classifyFailureText(message, 'VSUP_ACP_INIT_FAILED'));
  }

  private async connect(state: AcpState, secret?: string): Promise<void> {
    const app = client({ name: 'vibe-supervisor' })
      .onNotification('session/update', async (context) => {
        if (state.suppressReplay) return;
        await this.onUpdate(state, context.params.update as unknown as Record<string, unknown>, secret, expectedAgent(state.input.mode));
      })
      .onRequest('session/request_permission', async (context) => {
        const toolCallId = context.params.toolCall.toolCallId;
        const known = state.toolCalls.get(toolCallId);
        const id = String(context.requestId);
        const pending = toPermissionRequest(context.params, id, known);
        if (!pending || state.request) {
          const refusal = refusalOutcome(context.params.options);
          await state.callbacks.onEvent({ source: 'acp', type: 'permission_denied', severity: 'warning', data: { reason: pending ? 'Another permission request was already pending' : 'Permission request lacked a correlated, normalized tool action and path', toolCallId, outcome: refusal.outcome.outcome === 'selected' ? 'rejected' : 'cancelled' } });
          return refusal;
        }
        let resolve!: (response: unknown) => void;
        const decision = new Promise<unknown>((done) => { resolve = done; });
        state.request = { requestId: id, kind: 'permission', resolve, cancelled: { outcome: { outcome: 'cancelled' } }, options: pending.kind === 'permission' ? pending.options : [] };
        await state.callbacks.onPendingRequest(pending);
        const response = await decision as { outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } };
        delete state.request;
        return response;
      })
      .onRequest('elicitation/create', async (context) => {
        const req = context.params;
        if (req.mode !== 'form' || state.request || !isSafeFormSchema(req.requestedSchema)) return { action: 'decline' };
        const id = String(context.requestId);
        const safeSchema = JSON.parse(redactSecrets(JSON.stringify(req.requestedSchema), secret ? [secret] : [])) as Record<string, unknown>;
        const pending: PendingRequest = { requestId: id, kind: 'elicitation', title: redactSecrets(req.message, secret ? [secret] : []), schema: safeSchema };
        let resolve!: (response: unknown) => void;
        const decision = new Promise<unknown>((done) => { resolve = done; });
        state.request = { requestId: id, kind: 'elicitation', resolve, cancelled: { action: 'cancel' }, options: [] };
        await state.callbacks.onPendingRequest(pending);
        const response = await decision as { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string | number | boolean | string[]> };
        delete state.request;
        return response;
      });
    const stream = ndJsonStream(Writable.toWeb(state.process.child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(state.process.child.stdout!) as ReadableStream<Uint8Array>, { maxMessageBytes: MAX_WIRE_BYTES });
    await app.connectWith(stream, async (cx: ClientContext) => {
      state.context = cx;
      const init = await cx.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { elicitation: { form: {} } }, clientInfo: { name: 'vibe-supervisor', version: APP_VERSION } });
      const agentVersion = init.agentInfo?.version;
      if (agentVersion !== SUPPORTED_VIBE) throw versionUnsupported('acp', agentVersion ?? 'unknown');
      if (init.protocolVersion !== PROTOCOL_VERSION) throw supervisorError('VSUP_ACP_VERSION_UNSUPPORTED', `Agent negotiated unsupported ACP version ${init.protocolVersion}`);
      state.suppressReplay = state.recovering;
      let sessionId: string;
      let modes;
      let sessionMeta: unknown;
      if (state.recovering) {
        const capabilities = init.agentCapabilities as unknown as Record<string, unknown> | undefined;
        if (capabilities?.loadSession !== true || !state.sessionId) throw supervisorError('VSUP_SESSION_NOT_RESUMABLE', 'Vibe ACP does not advertise loading this persisted session');
        const response = await cx.request('session/load', { sessionId: state.sessionId, cwd: state.input.workerWorkspace, additionalDirectories: [], mcpServers: [] });
        sessionId = state.sessionId; modes = response.modes; sessionMeta = response._meta;
        state.suppressReplay = false;
      } else {
        const response = await cx.request('session/new', { cwd: state.input.workerWorkspace, additionalDirectories: [], mcpServers: [] });
        sessionId = response.sessionId; modes = response.modes; sessionMeta = response._meta;
        state.sessionId = sessionId;
      }
      await cx.request('session/set_config_option', { sessionId, configId: 'max_turns', value: String(state.input.limits.maxTurns) });
      const expected = expectedAgent(state.input.mode);
      if (!modes || modes.currentModeId !== expected) throw supervisorError('VSUP_ACP_PROTOCOL_ERROR', `Vibe selected mode ${modes?.currentModeId ?? 'unknown'}, expected ${expected}`);
      if (!isWorkspaceTrustMeta(sessionMeta)) throw supervisorError('VSUP_ACP_PROTOCOL_ERROR', 'Vibe did not confirm the workspace is untrusted');
      const result: BackendStartResult = { handle: { runId: state.input.runId, backend: 'acp', opaque: state }, initialState: 'running', process: { ...(state.process.child.pid === undefined ? {} : { pid: state.process.child.pid }), executable: this.executable(), version: SUPPORTED_VIBE }, acp: { protocolVersion: init.protocolVersion, sessionId, capabilities: safeData(init.agentCapabilities) as Record<string, unknown>, runDirectory: state.input.runDirectory, home: state.home, vibeHome: state.vibeHome, profileMode: state.input.mode } };
      state.readySettled = true; state.sessionReady = true;
      state.ready.resolve(result);
      if (!state.recovering) enqueue(state.commands, { kind: 'prompt', message: state.input.task });
      for (;;) {
        const task = await dequeue(state.commands);
        if (!task || task.kind === 'close' || state.closed) break;
        state.turnActive = true;
        await state.callbacks.onState('running', { ...(result.acp ? { acp: result.acp } : {}) });
        state.turnRedactor = new StreamingRedactor(secret ? [secret] : []);
        const turn = cx.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: task.message }] });
        state.activeTurn = turn.then(() => undefined, () => undefined);
        let response;
        try { response = await turn; state.turnActive = false; }
        catch (error) { await this.emitTurnTail(state); throw error; }
        finally { delete state.activeTurn; }
        await this.emitTurnTail(state);
        if (state.closed) break;
        await state.callbacks.onState('completed', { ...(result.acp ? { acp: result.acp } : {}), result: { stopReason: response.stopReason } });
      }
      try { await cx.request('session/close', { sessionId }); } catch { /* close is best-effort after bounded session completion */ }
    });
  }

  private async onUpdate(state: AcpState, update: Record<string, unknown>, secret: string | undefined, expectedMode: string): Promise<void> {
    const type = update.sessionUpdate;
    if (type === 'agent_thought_chunk') return;
    if (type === 'current_mode_update') {
      if (update.currentModeId !== expectedMode) { state.closed = true; await state.process.terminate(); throw supervisorError('VSUP_ACP_PROTOCOL_ERROR', `Vibe changed mode to ${String(update.currentModeId)} outside enforced profile`); }
      return;
    }
    if (type === 'tool_call' || type === 'tool_call_update') {
      const id = update.toolCallId;
      if (typeof id === 'string') state.toolCalls.set(id, { ...(state.toolCalls.get(id) ?? {}), ...update });
    }
    if (type === 'agent_message_chunk') {
      const c = update.content as Record<string, unknown> | undefined;
      if (c?.type !== 'text' || typeof c.text !== 'string') return;
      const redactor = state.turnRedactor ?? (state.turnRedactor = new StreamingRedactor(secret ? [secret] : []));
      const content = redactor.push(c.text);
      if (content) await state.callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: content } });
      return;
    }
    const clean = safeData(update, secret);
    if (!clean || typeof clean !== 'object') return;
    if (type === 'usage_update') {
      await state.callbacks.onEvent({ source: 'acp', type: 'usage', severity: 'info', data: clean as Record<string, unknown> });
    } else {
      await state.callbacks.onEvent({ source: 'acp', type: typeof type === 'string' ? type : 'update', severity: 'info', data: clean as Record<string, unknown> });
    }
  }

  async continue(handle: BackendRunHandle, message: string): Promise<void> {
    const state = (handle as AcpHandle).opaque;
    if (state.closed || state.exited || !state.sessionId) throw supervisorError('VSUP_SESSION_NOT_RESUMABLE', 'ACP session is no longer connected');
    enqueue(state.commands, { kind: 'prompt', message });
  }
  async respond(handle: BackendRunHandle, response: BackendRespondInput): Promise<void> {
    const state = (handle as AcpHandle).opaque;
    const pending = state.request;
    if (!pending || pending.requestId !== response.requestId || pending.kind !== response.kind) throw supervisorError('VSUP_REQUEST_EXPIRED', 'The ACP request is no longer pending');
    if (response.kind === 'permission') {
      if (!response.optionId) throw supervisorError('VSUP_INVALID_ARGUMENT', 'An ACP permission response must select an offered option');
      const option = pending.options.find((candidate) => candidate.optionId === response.optionId);
      if (!option || option.kind === 'allow_always') throw supervisorError('VSUP_PERMISSION_DENIED', 'Only an offered one-time permission choice can be selected');
      pending.resolve({ outcome: { outcome: 'selected', optionId: option.optionId } }); await state.callbacks.onPendingRequest(undefined); return;
    }
    pending.resolve({ action: response.action ?? 'decline', ...(response.action === 'accept' && response.content ? { content: response.content } : {}) });
    await state.callbacks.onPendingRequest(undefined);
  }
  private async emitTurnTail(state: AcpState): Promise<void> {
    const redactor = state.turnRedactor;
    if (!redactor) return;
    delete state.turnRedactor;
    const tail = redactor.flush();
    if (tail) await state.callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: tail } });
  }
  private cancelPendingRequest(state: AcpState): boolean {
    const pending = state.request;
    if (!pending) return false;
    delete state.request;
    pending.resolve(pending.cancelled);
    return true;
  }
  private async awaitTurnEnd(state: AcpState): Promise<void> {
    if (!state.activeTurn) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([state.activeTurn, new Promise<void>((done) => { timer = setTimeout(done, CANCEL_TURN_GRACE_MS); })]);
    if (timer) clearTimeout(timer);
  }
  async cancel(handle: BackendRunHandle): Promise<void> {
    const state = (handle as AcpHandle).opaque; state.released = true; state.closed = true; closeQueue(state.commands);
    const answered = this.cancelPendingRequest(state);
    if (state.sessionId && state.context) { try { await state.context.notify('session/cancel', { sessionId: state.sessionId }); } catch { /* process shutdown remains authoritative */ } }
    if (answered) await this.awaitTurnEnd(state);
    await this.emitTurnTail(state);
    await state.process.terminate();
  }
  async close(handle: BackendRunHandle): Promise<void> {
    const state = (handle as AcpHandle).opaque; state.released = true; state.closed = true; enqueue(state.commands, { kind: 'close' }); closeQueue(state.commands);
    if (this.cancelPendingRequest(state)) {
      if (state.sessionId && state.context) { try { await state.context.notify('session/cancel', { sessionId: state.sessionId }); } catch { /* process shutdown remains authoritative */ } }
      await this.awaitTurnEnd(state);
    }
    await this.emitTurnTail(state);
    // Retain session history and private homes for restart recovery/retention cleanup.
    await state.process.terminate();
  }
  async recover(record: RunRecord, callbacks: BackendCallbacks): Promise<BackendRunHandle | undefined> {
    const acp = record.acp;
    const dataDir = this.dataDirectory;
    if (record.backend !== 'acp' || !acp?.sessionId || acp.protocolVersion !== PROTOCOL_VERSION || acp.profileMode !== record.mode || !dataDir || !acp.runDirectory || !acp.home || !acp.vibeHome) return undefined;
    const advertised = acp.capabilities?.loadSession === true;
    if (!advertised) return undefined;
    const expectedRunDirectory = path.resolve(dataDir, 'runs', record.runId);
    if (path.resolve(acp.runDirectory) !== expectedRunDirectory) return undefined;
    let runDirectory: string;
    try {
      const runInfo = await lstat(expectedRunDirectory);
      if (runInfo.isSymbolicLink() || !runInfo.isDirectory()) return undefined;
      runDirectory = await realpath(expectedRunDirectory);
      if (runDirectory !== expectedRunDirectory || path.basename(runDirectory) !== record.runId) return undefined;
      for (const [candidate, expectedName] of [[acp.home, 'child-home'], [acp.vibeHome, 'vibe-home']] as const) {
        if (path.resolve(candidate) !== path.join(runDirectory, expectedName)) return undefined;
        const info = await lstat(candidate);
        if (info.isSymbolicLink() || !info.isDirectory() || await realpath(candidate) !== path.resolve(candidate)) return undefined;
      }
      const sourceWorkspace = await resolveCanonicalRoot(record.sourceWorkspace, this.config.allowedWorkspaceRoots);
      if (sourceWorkspace !== path.resolve(record.sourceWorkspace)) return undefined;
      let workerWorkspace = sourceWorkspace;
      if (record.mode === 'edit') {
        const expectedWorktree = path.resolve(dataDir, 'worktrees', record.runId);
        if (!record.worktree?.createdBySupervisor || path.resolve(record.worktree.path) !== expectedWorktree || path.resolve(record.workerWorkspace) !== expectedWorktree) return undefined;
        const worktreeInfo = await lstat(expectedWorktree);
        if (worktreeInfo.isSymbolicLink() || !worktreeInfo.isDirectory() || await realpath(expectedWorktree) !== expectedWorktree) return undefined;
        workerWorkspace = expectedWorktree;
      } else if (path.resolve(record.workerWorkspace) !== sourceWorkspace) return undefined;
      await assertNoProjectVibeExtensions(sourceWorkspace);
      await assertNoProjectVibeExtensions(workerWorkspace);
    } catch { return undefined; }

    const input: StartRunInput = { runId: record.runId, mode: record.mode, task: '', cwd: record.sourceWorkspace, workerWorkspace: record.workerWorkspace, runDirectory, limits: record.limits };
    const profile = await createVibeChildProfile(input, record.mode, { forwardOriginalHome: true });
    profile.env.VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS = String(record.limits.timeoutSeconds);
    let launch: VibeLaunch;
    try { launch = await this.buildLaunch([], profile, runDirectory); }
    catch { return undefined; }
    const redactor = new StreamingRedactor(environmentSecrets(launch.env));
    let eventChain = Promise.resolve();
    let stderrTail = '';
    const process = spawnManaged(launch.command, launch.args, {
      cwd: record.workerWorkspace, env: launch.env, forwardEnv: Object.keys(launch.env), stdio: ['pipe', 'pipe', 'pipe'],
      maxStdoutBytes: record.limits.maxTranscriptBytes, maxStderrBytes: record.limits.maxEventBytes,
      onStderr: (chunk) => { stderrTail = `${stderrTail}${chunk}`.slice(-RECOVER_STDERR_CHARS); const safe = redactor.push(chunk); if (safe) eventChain = eventChain.then(() => callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text: safe } })).then(() => undefined); }
    });
    const state: AcpState = { process, home: profile.home, vibeHome: profile.vibeHome, ready: deferred<BackendStartResult>(), commands: makeQueue(), connected: Promise.resolve(), closed: false, exited: false, readySettled: false, sessionReady: false, failureReported: false, released: false, toolCalls: new Map(), callbacks, input, sessionId: acp.sessionId, recovering: true, suppressReplay: true, turnActive: false };
    state.connected = this.connect(state, launch.env.MISTRAL_API_KEY);
    state.connected.catch(async (error: unknown) => {
      state.closed = true;
      const beforeReady = !state.readySettled;
      if (beforeReady) { state.readySettled = true; state.ready.reject(error); }
      await process.terminate();
      if (beforeReady) return;
      const message = redactSecrets(String(error), environmentSecrets(launch.env));
      const exitedIdle = !state.turnActive && process.child.exitCode === 0;
      if (!state.failureReported && !state.released && !exitedIdle) {
        state.failureReported = true;
        const exitedMidTurn = state.turnActive && process.child.exitCode === 0;
        await callbacks.onState('failed', { error: exitedMidTurn ? supervisorError('VSUP_BACKEND_CRASHED', EXITED_MID_TURN) : supervisorError('VSUP_RECOVERY_ERROR', message) });
      }
    }).catch(reportFailure('acp-recover-failure'));
    process.done.then(async ({ code, signal }) => {
      state.exited = true;
      closeQueue(state.commands);
      const tail = redactor.flush();
      if (tail) await eventChain.then(() => callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text: tail } }));
      if (!state.readySettled) { state.closed = true; state.readySettled = true; state.ready.reject(supervisorError('VSUP_SESSION_NOT_RESUMABLE', 'Vibe ACP exited before the session was loaded')); return; }
      if (state.closed || state.failureReported || (code === 0 && !state.turnActive)) return;
      state.failureReported = true;
      await callbacks.onState('failed', { error: supervisorError('VSUP_BACKEND_CRASHED', code === 0 ? EXITED_MID_TURN : `Recovered Vibe ACP exited ${code ?? signal ?? 'without status'}`) });
    }).catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = Symbol('recover-timeout');
    const expiry = new Promise<typeof timedOut>((resolve) => { timer = setTimeout(() => resolve(timedOut), this.recoverTimeoutMs); });
    let outcome: BackendStartResult | typeof timedOut;
    try { outcome = await Promise.race([state.ready.promise, expiry]); }
    catch (error) {
      await process.done.catch(() => undefined);
      const cause = await classifyStartFailure('acp', this.executable(), error, stderrTail).catch(() => undefined);
      if (isCodedError(cause) && cause.code === 'VSUP_VIBE_VERSION_UNSUPPORTED') throw cause;
      return undefined;
    }
    finally { if (timer) clearTimeout(timer); }
    if (outcome !== timedOut) return outcome.handle;
    state.released = true; state.closed = true; state.failureReported = true; state.readySettled = true;
    closeQueue(state.commands);
    await process.terminate();
    throw supervisorError('VSUP_SESSION_NOT_RESUMABLE', `Vibe did not finish loading the session within ${this.recoverTimeoutMs / 1000} ${this.recoverTimeoutMs === 1000 ? 'second' : 'seconds'}.`);
  }
}
