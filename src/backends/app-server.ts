import { constants as fsConstants } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  BackendCallbacks, BackendCapabilities, BackendKind, BackendRunHandle, BackendStartResult, EventSeverity,
  ProcessRecord, ResultSummary, RuntimeCheck, StartRunInput, SupervisorBackend, SupervisorConfig, SupervisorError
} from '../contracts.js';
import { supervisorError } from '../contracts.js';
import { describeFailure, reportBackgroundFailure } from '../diagnostics/background.js';
import { sanitizeForPersistence } from '../persistence/atomic.js';
import { spawnManaged, type ManagedProcess } from '../process/managed.js';
import { ReaperStartError, startReaper, type ReaperHandle, type ReaperOptions } from '../process/reaper.js';
import { buildChildEnvironment } from '../security/environment.js';
import { WorkspacePathError } from '../security/paths.js';
import { redactSecrets, StreamingRedactor } from '../security/redaction.js';
import { APP_VERSION } from '../version.js';
import { ApprovalHandler, type ApprovalHandlerOptions, type PendingApproval } from './app-server/approvals.js';
import { resolveCredential, type CredentialResolution, type ResolvedCredential } from './app-server/credentials.js';
import { EventProcessor, auditSessionHistory, type EffectRecord, type EventSignal, type HistoryAudit } from './app-server/events.js';
import {
  JsonRpcClient, JsonRpcClosedError, JsonRpcFatalError, JsonRpcServerError, JsonRpcTimeoutError,
  type JsonObject, type NotificationHandler
} from './app-server/jsonrpc.js';
import { mapOutcome, type RunOutcome, type SupervisorCondition } from './app-server/outcome.js';
import { PinCheckError, verifyPinnedInstall } from './app-server/pin.js';
import {
  MAX_PAGE_LIMIT, ProtocolParseError, buildCallbackResult, buildConfigEffectiveRead, buildConfigRead, buildInitialize,
  buildInitialized, buildRuntimeRead, buildSessionHistoryList, buildSessionRead, buildSessionReadyWait, buildSessionStart,
  buildTurnInterrupt, buildTurnStart, parseAcceptedResult, parseConfigEffectiveReadResult, parseConfigModelWriteResult,
  parseConfigReadResult, parseHistoryListResult, parseInitializeResult, parseRuntimeReadResult, parseSessionReadResult,
  parseSessionReadyWaitResult, parseSessionStartResult, parseTurnStartResult, serverErrorIssues,
  type AgentStats, type RuntimeReadResult, type SessionStartResult, type Turn
} from './app-server/protocol.js';
import { compareReadback, formatReadbackMismatches, type ReadbackMismatch } from './app-server/readback.js';
import { buildSessionConfig, buildThinkingOffWrite, writeSessionFiles, type SessionConfigPlan } from './app-server/session-config.js';
import { UsageTracker, turnBackstop, type BudgetCeilings } from './app-server/usage.js';
import {
  authFailureText, classifyFailureText, classifyStartFailure, rateLimitFailure, resolveCommand, spawned, stderrTailText,
  versionMismatchOnStderr, versionUnsupported
} from './launcher.js';
import { SUPPORTED_VIBE } from './pinned.js';
import { assertNoProjectVibeExtensions } from './profile.js';

const BACKEND_KIND: BackendKind = 'app-server';
const APP_SERVER_BINARY = 'vibe-app-server';
const CLIENT_NAME = 'vibe-supervisor';
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const STDOUT_MARGIN_BYTES = 1024 * 1024;
const STDERR_CAP_BYTES = 1024 * 1024;
const CLOSE_INPUT_WAIT_MS = 1000;
const EXIT_WAIT_MS = 1500;
const BACKGROUND_WAIT_MS = 2000;
const MAX_STDERR_DETAIL_CHARS = 400;

const TOOL_NAMES: Readonly<Record<string, string>> = {
  'file_system.read_file': 'read_file',
  'file_system.write_file': 'write_file',
  'file_system.search_replace': 'edit'
};
const TOOL_KINDS: Readonly<Record<string, string>> = { read_file: 'read', write_file: 'edit', edit: 'edit' };
const BENIGN_SERVER_ERRORS: ReadonlySet<string> = new Set(['stale_turn', 'conflict', 'not_found', 'callback_closed']);

export interface AppServerTiming {
  requestTimeoutMs: number;
  interruptTimeoutMs: number;
  interruptGraceMs: number;
  stdinGraceMs: number;
  terminateGraceMs: number;
  finalizeRequestTimeoutMs: number;
  statsThrottleMs: number;
  reaperMarginMs: number;
}

export const DEFAULT_APP_SERVER_TIMING: Readonly<AppServerTiming> = {
  requestTimeoutMs: 30_000,
  interruptTimeoutMs: 3000,
  interruptGraceMs: 1000,
  stdinGraceMs: 1000,
  terminateGraceMs: 1000,
  finalizeRequestTimeoutMs: 10_000,
  statsThrottleMs: 1000,
  reaperMarginMs: 15_000
};

export interface AppServerBackendOptions {
  executable?: string;
  expectedServerVersion?: string;
  pin?: { manifestPath?: string; verify?: (executable: string) => Promise<unknown> };
  resolveCredential?: () => Promise<CredentialResolution>;
  approvals?: { deadlineMs?: number; evaluate?: ApprovalHandlerOptions['evaluate'] };
  budgets?: BudgetCeilings;
  turnBackstopMargin?: number;
  timing?: Partial<AppServerTiming>;
  reaper?: Partial<Pick<ReaperOptions, 'executable' | 'pollMs' | 'graceMs' | 'startupTimeoutMs' | 'stopTimeoutMs'>>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  readonly settled: boolean;
}

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve(value: T) { if (!settled) { settled = true; resolvePromise(value); } },
    get settled() { return settled; }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref(); });
}

function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = (): void => { clearTimeout(timer); resolve(true); };
    promise.then(done, done);
  });
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return { text, truncated: false };
  let end = Math.max(0, maxBytes);
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true };
}

function isSupervisorError(value: unknown): value is SupervisorError {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === 'string' && record.code.startsWith('VSUP_') && typeof record.message === 'string' && typeof record.remediation === 'string';
}

function fatalToError(error: JsonRpcFatalError): SupervisorError {
  switch (error.kind) {
    case 'output_limit': return supervisorError('VSUP_OUTPUT_LIMIT', `The Vibe app-server exceeded a transport limit (${error.code}).`, { reason: error.code });
    case 'protocol': return supervisorError('VSUP_BACKEND_ERROR', `The Vibe app-server sent a malformed frame (${error.code}).`, { reason: error.code });
    case 'io': return supervisorError('VSUP_BACKEND_CRASHED', `The connection to the Vibe app-server failed (${error.code}).`, { reason: error.code });
    default: return supervisorError('VSUP_BACKEND_ERROR', `The Vibe app-server transport failed internally (${error.code}).`, { reason: error.code });
  }
}

function toSupervisorError(error: unknown, secrets: readonly string[]): SupervisorError {
  if (isSupervisorError(error)) return error;
  const safe = (text: string): string => redactSecrets(text, secrets).slice(0, 500);
  if (error instanceof PinCheckError) return supervisorError(error.code, safe(error.message), { reason: error.reason, ...error.details });
  if (error instanceof JsonRpcServerError) {
    if (error.code === 'unauthorized') return supervisorError('VSUP_AUTH_REQUIRED', 'The Vibe app-server rejected the credentials (unauthorized).', { method: error.method });
    const issues = serverErrorIssues(error.data);
    return supervisorError('VSUP_BACKEND_ERROR', safe(`Vibe rejected ${error.method} (${error.code}): ${error.message}`), {
      method: error.method, server_error_code: error.code, ...(issues.length > 0 ? { issues } : {})
    });
  }
  if (error instanceof JsonRpcTimeoutError) return supervisorError('VSUP_BACKEND_ERROR', `Vibe did not answer ${error.method} within ${error.timeoutMs} ms.`, { method: error.method }, true);
  if (error instanceof JsonRpcFatalError) return fatalToError(error);
  if (error instanceof JsonRpcClosedError) return supervisorError('VSUP_BACKEND_CRASHED', 'The connection to the Vibe app-server closed.');
  if (error instanceof ProtocolParseError) return supervisorError('VSUP_BACKEND_ERROR', safe(`Vibe sent a message the supervisor does not recognize: ${error.message}`), { context: error.context });
  if (error instanceof WorkspacePathError) return supervisorError('VSUP_WORKSPACE_INVALID', safe(error.message));
  if (error instanceof ReaperStartError) return supervisorError('VSUP_INTERNAL', safe(error.message));
  return supervisorError('VSUP_INTERNAL', safe(describeFailure(error)));
}

function promptFor(input: StartRunInput): string {
  const prefix = (input.contextFiles ?? []).map((file) => `Approved context path: ${file}`).join('\n');
  return prefix ? `${prefix}\n\nTask:\n${input.task}` : input.task;
}

interface RunParts {
  input: StartRunInput;
  callbacks: BackendCallbacks;
  options: AppServerBackendOptions;
  timing: AppServerTiming;
  executable: string;
  credential: ResolvedCredential;
  plan: SessionConfigPlan;
  expectedVersion: string;
}

type TurnEnd = 'turn' | 'forced';

class AppServerRun {
  readonly handle: BackendRunHandle;
  private readonly input: StartRunInput;
  private readonly callbacks: BackendCallbacks;
  private readonly options: AppServerBackendOptions;
  private readonly timing: AppServerTiming;
  private readonly executable: string;
  private readonly credential: ResolvedCredential;
  private readonly plan: SessionConfigPlan;
  private readonly expectedVersion: string;
  private readonly secrets: string[];
  private readonly deadlineAt: number;
  private readonly handler: ApprovalHandler;
  private readonly stderrRedactor: StreamingRedactor;
  private readonly turnDone = deferred<TurnEnd>();
  private readonly startReported = deferred<void>();
  private readonly hurried = deferred<void>();
  private readonly emittedEffects = new Set<string>();
  private readonly background = new Set<Promise<unknown>>();
  private readonly conditions: SupervisorCondition[] = [];
  private readonly warnings: string[] = [];
  private child: ManagedProcess | undefined;
  private client!: JsonRpcClient;
  private reaper: ReaperHandle | undefined;
  private processor!: EventProcessor;
  private usage: UsageTracker | undefined;
  private sessionStart: SessionStartResult | undefined;
  private openedSessionId = '';
  private turnId = '';
  private completedTurn: Turn | null = null;
  private processRecord: ProcessRecord | undefined;
  private failure: SupervisorError | undefined;
  private gap: { expected: number; received: number } | undefined;
  private startAbort: SupervisorError | undefined;
  private deadlineTimer: NodeJS.Timeout | undefined;
  private graceTimer: NodeJS.Timeout | undefined;
  private eventChain: Promise<void> = Promise.resolve();
  private cleaning: Promise<void> | undefined;
  private cleaned = false;
  private turnStarted = false;
  private interruptWanted = false;
  private interruptSent = false;
  private concludeStarted = false;
  private terminalEmitted = false;
  private shuttingDown = false;
  private hurriedFlag = false;
  private stderrTail = '';
  private lastUsageEmit = 0;

  constructor(parts: RunParts) {
    this.input = parts.input;
    this.callbacks = parts.callbacks;
    this.options = parts.options;
    this.timing = parts.timing;
    this.executable = parts.executable;
    this.credential = parts.credential;
    this.plan = parts.plan;
    this.expectedVersion = parts.expectedVersion;
    this.secrets = [parts.credential.secret()];
    this.deadlineAt = Date.now() + parts.input.limits.timeoutSeconds * 1000;
    this.stderrRedactor = new StreamingRedactor(this.secrets);
    this.handle = { runId: parts.input.runId, backend: BACKEND_KIND, opaque: this };
    this.handler = new ApprovalHandler({
      mode: parts.input.mode,
      workspace: parts.input.workerWorkspace,
      ...(parts.options.approvals?.deadlineMs === undefined ? {} : { deadlineMs: parts.options.approvals.deadlineMs }),
      ...(parts.options.approvals?.evaluate === undefined ? {} : { evaluate: parts.options.approvals.evaluate })
    });
  }

  get hasCleanedUp(): boolean {
    return this.cleaned;
  }

  private get sessionId(): string {
    return this.processor ? this.processor.sessionId : this.openedSessionId;
  }

  async start(): Promise<BackendStartResult> {
    try {
      await writeSessionFiles(this.plan);
      await this.spawnWorker();
      await this.handshake();
      await this.beginTurn();
    } catch (error) {
      const failure = this.startAbort ?? await this.classifyStartError(error);
      await this.cleanup().catch((cleanupError: unknown) => reportBackgroundFailure('app-server-start-cleanup', cleanupError));
      await this.reaper?.stop().catch(() => undefined);
      throw failure;
    }
    const process = this.processRecord;
    try { await this.callbacks.onState('running', process ? { process } : undefined); }
    catch (error) { reportBackgroundFailure('app-server-running', error); }
    void this.supervise().catch((error: unknown) => reportBackgroundFailure('app-server-supervise', error));
    this.startReported.resolve();
    return { handle: this.handle, initialState: 'running', ...(process ? { process } : {}) };
  }

  async cancel(): Promise<void> {
    if (!this.concludeStarted) this.addCondition({ kind: 'cancelled' });
    if (!this.turnStarted) {
      this.hurry();
      this.abortStartup(supervisorError('VSUP_CANCELLED', 'The run was cancelled before the turn started.'));
      await this.cleanup();
      return;
    }
    if (!this.concludeStarted) this.interrupt();
    await this.turnDone.promise;
    await this.cleanup();
  }

  async terminateNow(): Promise<void> {
    if (!this.concludeStarted) this.addCondition({ kind: 'cancelled' });
    this.hurry();
    if (!this.turnStarted) this.abortStartup(supervisorError('VSUP_CANCELLED', 'The run was cancelled before the turn started.'));
    else this.turnDone.resolve('forced');
    await this.cleanup();
  }

  async close(): Promise<void> {
    if (this.cleaned) return;
    if (this.cleaning === undefined && !this.concludeStarted) await this.cancel();
    else await this.cleanup();
  }

  private async spawnWorker(): Promise<void> {
    const { input } = this;
    await assertNoProjectVibeExtensions(input.cwd);
    await assertNoProjectVibeExtensions(input.workerWorkspace);
    if (this.shuttingDown) throw this.startAbort ?? supervisorError('VSUP_CANCELLED', 'The run was stopped before the app-server was spawned.');
    const environment: NodeJS.ProcessEnv = { ...buildChildEnvironment(process.env), ...this.plan.environment, ...this.credential.environment() };
    const inboundBudget = Math.max(input.limits.maxEventBytes, 1);
    let child: ManagedProcess;
    try {
      child = spawnManaged(this.executable, [], {
        cwd: input.runDirectory,
        env: environment,
        forwardEnv: Object.keys(environment),
        stdio: ['pipe', 'pipe', 'pipe'],
        maxStdoutBytes: inboundBudget + STDOUT_MARGIN_BYTES,
        maxStderrBytes: Math.min(input.limits.maxEventBytes, STDERR_CAP_BYTES),
        onLimit: (stream) => this.onProcessLimit(stream),
        onStderr: (chunk) => this.onStderr(chunk)
      });
    } catch (error) {
      throw supervisorError('VSUP_BACKEND_CRASHED', `Could not start the Vibe app-server: ${redactSecrets(describeFailure(error), this.secrets)}`);
    }
    this.child = child;
    const { stdout, stdin } = child.child;
    if (!stdout || !stdin) throw supervisorError('VSUP_INTERNAL', 'The Vibe app-server was spawned without piped standard streams.');
    this.client = new JsonRpcClient({
      input: stdout,
      output: stdin,
      maxLineBytes: Math.min(MAX_LINE_BYTES, inboundBudget),
      maxInboundBytes: inboundBudget,
      defaultTimeoutMs: this.timing.requestTimeoutMs,
      onActivity: () => this.callbacks.onActivity?.('stdout'),
      onDiagnostic: (message) => this.emit('diagnostic', 'warning', { text: message }, 'supervisor'),
      onFatal: (error) => this.onClientFatal(error),
      onEnd: (info) => { if (info.reason === 'eof') this.onUnexpectedEnd('the app-server closed its output stream'); }
    });
    child.done.then((exit) => {
      if (!this.shuttingDown) this.onUnexpectedEnd(`the app-server exited with ${exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? 'null'}`}`);
    }, () => undefined);
    try { await spawned(child); }
    catch (error) {
      child.done.catch(() => undefined);
      const classified = await classifyStartFailure(this.executable, error);
      throw isSupervisorError(classified) ? classified : supervisorError('VSUP_BACKEND_CRASHED', `Could not start the Vibe app-server: ${redactSecrets(describeFailure(error), this.secrets)}`);
    }
    const pid = child.child.pid;
    this.processRecord = { ...(pid === undefined ? {} : { pid }), executable: this.executable, version: SUPPORTED_VIBE };
    this.callbacks.onSpawn?.(this.handle);
    this.deadlineTimer = setTimeout(() => this.onDeadline(), Math.max(0, this.deadlineAt - Date.now()));
    this.deadlineTimer.unref();
    if (pid === undefined) throw supervisorError('VSUP_BACKEND_CRASHED', 'The Vibe app-server has no process id after spawning.');
    const reaper = await startReaper({
      workerPid: pid,
      deadlineAtMs: Math.ceil(this.deadlineAt + this.timing.reaperMarginMs),
      ...this.options.reaper
    });
    this.reaper = reaper;
    if (this.shuttingDown) await reaper.stop();
  }

  private startupTimeout(): number {
    return Math.max(1, Math.min(this.timing.requestTimeoutMs, this.deadlineAt - Date.now()));
  }

  private async rpc<T>(spec: { method: string; params: JsonObject }, parse: (value: unknown) => T, timeoutMs: number): Promise<T> {
    return parse(await this.client.request(spec.method, spec.params, { timeoutMs }));
  }

  private async handshake(): Promise<void> {
    this.registerApprovalHandler();
    const init = await this.rpc(buildInitialize({ name: CLIENT_NAME, version: APP_VERSION }), parseInitializeResult, this.startupTimeout());
    if (init.serverVersion !== this.expectedVersion) throw versionUnsupported(init.serverVersion);
    const initialized = buildInitialized();
    this.client.notify(initialized.method, initialized.params);
    const started = await this.rpc(buildSessionStart(this.plan.agentConfig), parseSessionStartResult, this.startupTimeout());
    this.sessionStart = started;
    this.openedSessionId = started.state.session.id;
    this.processor = new EventProcessor({
      sessionId: started.state.session.id,
      watermark: started.state.eventId,
      mode: this.input.mode,
      ledger: this.handler.ledger,
      secrets: this.secrets,
      maxMessageChars: Math.min(200_000, this.input.limits.maxTranscriptBytes)
    });
    this.processor.seed(started.state.history);
    if (this.processor.fatal) throw supervisorError('VSUP_BACKEND_ERROR', `The new Vibe session already contained an unsafe entry: ${this.processor.fatal.message}`, { reason: this.processor.fatal.code });
    this.client.setNotificationHandler(this.onNotification);
    const ready = await this.rpc(buildSessionReadyWait(this.sessionId), parseSessionReadyWaitResult, this.startupTimeout());
    if (!ready.ready) throw supervisorError('VSUP_BACKEND_ERROR', 'The Vibe session did not become ready.');
    await this.readback(false);
    await this.rpc(buildThinkingOffWrite(this.sessionId), parseConfigModelWriteResult, this.startupTimeout());
    const second = await this.readback(true);
    this.usage = new UsageTracker(second.runtime.stats, {
      maxModelCalls: turnBackstop(this.input.limits.maxTurns, this.options.turnBackstopMargin),
      ...this.options.budgets
    });
  }

  private async readback(checkThinking: boolean): Promise<RuntimeReadResult> {
    const sessionStart = this.sessionStart;
    if (!sessionStart) throw supervisorError('VSUP_INTERNAL', 'The session start result is missing.');
    const runtime = await this.rpc(buildRuntimeRead(this.sessionId), parseRuntimeReadResult, this.startupTimeout());
    const effective = await this.rpc(buildConfigEffectiveRead(this.sessionId), parseConfigEffectiveReadResult, this.startupTimeout());
    const mismatches: ReadbackMismatch[] = compareReadback(this.plan.expectation, { sessionStart, runtime, effective }, { checkThinking });
    if (!checkThinking) {
      const config = await this.rpc(buildConfigRead(this.sessionId), parseConfigReadResult, this.startupTimeout());
      if ((config.hooksCount ?? 0) !== 0) mismatches.push({ path: 'config/read.hooksCount', expected: 0, actual: config.hooksCount });
      if ((config.skillsCount ?? 0) !== 0) mismatches.push({ path: 'config/read.skillsCount', expected: 0, actual: config.skillsCount });
    }
    if (mismatches.length > 0) {
      throw supervisorError('VSUP_BACKEND_ERROR', `Vibe did not apply the supervisor session configuration: ${formatReadbackMismatches(mismatches)}`, {
        reason: 'readback_mismatch', fields: mismatches.slice(0, 20).map((item) => item.path), total: mismatches.length
      });
    }
    return runtime;
  }

  private async beginTurn(): Promise<void> {
    const started = await this.rpc(buildTurnStart(this.sessionId, promptFor(this.input)), parseTurnStartResult, this.startupTimeout());
    if (this.startAbort) throw this.startAbort;
    this.turnId = started.turn.id;
    this.processor.advanceWatermark(started.lastEventId);
    this.turnStarted = true;
    if (started.turn.status !== 'in_progress') this.onTurnCompleted(started.turn);
    if (this.interruptWanted) this.interrupt();
  }

  private registerApprovalHandler(): void {
    this.client.setRequestHandler('callback/call', (params) => {
      let pending: PendingApproval;
      try { pending = this.handler.begin(params); }
      catch (error) {
        this.failure ??= toSupervisorError(error, this.secrets);
        this.interrupt();
        throw error;
      }
      setImmediate(() => this.track(this.answer(pending)));
      return pending.acknowledgement;
    });
  }

  private async answer(pending: PendingApproval): Promise<void> {
    const verdict = await pending.verdict;
    try {
      await this.rpc(buildCallbackResult(this.sessionId, pending.callbackId, verdict.decision), (value) => parseAcceptedResult(value, 'callback/result result'), this.timing.requestTimeoutMs);
    } catch (error) {
      if (error instanceof JsonRpcServerError && BENIGN_SERVER_ERRORS.has(error.code)) return;
      throw error;
    }
  }

  private readonly onNotification: NotificationHandler = (method, params) => {
    for (const signal of this.processor.handle(method, params).signals) this.onSignal(signal);
  };

  private onSignal(signal: EventSignal): void {
    switch (signal.type) {
      case 'fatal':
        this.interrupt();
        return;
      case 'watermark_gap':
        this.gap ??= { expected: signal.expected, received: signal.received };
        this.interrupt();
        this.track(this.resync());
        return;
      case 'tool_effect':
        this.emitEffect(signal);
        return;
      case 'turn_started':
        return;
      case 'turn_completed':
        this.onTurnCompleted(signal.turn);
        return;
      case 'stats':
        this.noteStats(signal.stats, signal.contextWindow);
        return;
      case 'session_handoff':
        this.warnings.push('The Vibe session was compacted or cleared during the run; the supervisor followed the new session.');
        this.emit('diagnostic', 'warning', { text: `Vibe replaced the session (${signal.kind}).`, reason: 'session_handoff' }, 'supervisor');
        return;
      case 'turn_retrying':
        this.emit('diagnostic', 'warning', { text: 'Vibe is retrying the turn.', reason: 'turn_retrying' }, 'supervisor');
        return;
      case 'warning':
      case 'server_error':
        this.emit('diagnostic', signal.type === 'warning' ? 'warning' : 'error', { text: signal.message ?? '', ...(signal.code === null ? {} : { code: signal.code }) }, 'supervisor');
        return;
    }
  }

  private onTurnCompleted(turn: Turn): void {
    if (this.turnId !== '' && turn.id !== this.turnId) return;
    if (this.turnId === '') this.turnId = turn.id;
    this.completedTurn = turn;
    this.turnDone.resolve('turn');
  }

  private noteStats(stats: AgentStats, contextWindow: number | null): void {
    if (!this.usage) return;
    const update = this.usage.update(stats, contextWindow);
    if (update.breach && !this.hasCondition('budget')) {
      this.addCondition({ kind: 'budget', limit: update.breach.limit });
      this.interrupt();
    }
    const now = Date.now();
    if (update.changed && this.startReported.settled && !this.concludeStarted && now - this.lastUsageEmit >= this.timing.statsThrottleMs) {
      this.lastUsageEmit = now;
      const usage = this.usage.state;
      this.eventChain = this.eventChain.then(async () => { if (!this.terminalEmitted) await this.callbacks.onState('running', { usage }); }).catch((error: unknown) => reportBackgroundFailure('app-server-usage', error));
    }
  }

  private async resync(): Promise<void> {
    const read = await this.rpc(buildSessionRead(this.sessionId, { history: { limit: MAX_PAGE_LIMIT } }), parseSessionReadResult, this.timing.finalizeRequestTimeoutMs);
    for (const signal of this.processor.resync(read.state).signals) this.onSignal(signal);
    const latest = read.state.turns.at(-1);
    if (latest && latest.status !== 'in_progress') this.onTurnCompleted(latest);
  }

  private interrupt(): void {
    if (this.completedTurn !== null || this.interruptSent) return;
    if (!this.turnStarted) { this.interruptWanted = true; return; }
    this.interruptSent = true;
    this.track(this.rpc(buildTurnInterrupt(this.sessionId, this.turnId), (value) => parseAcceptedResult(value, 'turn/interrupt result'), this.timing.interruptTimeoutMs).then(
      () => undefined,
      (error: unknown) => {
        if (error instanceof JsonRpcServerError && BENIGN_SERVER_ERRORS.has(error.code)) return;
        throw error;
      }
    ));
    this.graceTimer = setTimeout(() => this.turnDone.resolve('forced'), this.timing.interruptGraceMs);
    this.graceTimer.unref();
  }

  private onDeadline(): void {
    this.addCondition({ kind: 'deadline' });
    if (!this.turnStarted) this.abortStartup(supervisorError('VSUP_TIMEOUT', 'The run exceeded its configured timeout before the turn started.'));
    else this.interrupt();
  }

  private abortStartup(error: SupervisorError): void {
    if (this.turnStarted) return;
    this.startAbort ??= error;
    this.hurry();
    void this.cleanup().catch((cleanupError: unknown) => reportBackgroundFailure('app-server-abort', cleanupError));
  }

  private onProcessLimit(stream: 'stdout' | 'stderr'): void {
    this.shuttingDown = true;
    this.addCondition({ kind: 'output_limit', detail: `${stream} budget exceeded` });
    this.turnDone.resolve('forced');
  }

  private onClientFatal(error: JsonRpcFatalError): void {
    this.recordFailure(error);
    this.turnDone.resolve('forced');
  }

  private onUnexpectedEnd(detail: string): void {
    if (this.shuttingDown || this.completedTurn !== null) return;
    this.addCondition({ kind: 'backend_crashed', detail });
    this.turnDone.resolve('forced');
  }

  private onStderr(chunk: string): void {
    this.callbacks.onActivity?.('stderr');
    this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4096);
    const text = this.stderrRedactor.push(chunk);
    if (text) this.emit('diagnostic', 'warning', { text }, 'supervisor');
  }

  private recordFailure(error: unknown): void {
    if (error instanceof JsonRpcClosedError) {
      if (!this.shuttingDown && !this.hasCondition('cancelled')) this.addCondition({ kind: 'backend_crashed', detail: 'the connection to the app-server closed' });
      return;
    }
    if (error instanceof JsonRpcFatalError) {
      if (error.kind === 'output_limit') this.addCondition({ kind: 'output_limit', detail: error.code });
      else if (error.kind === 'io') { if (!this.shuttingDown && !this.hasCondition('cancelled')) this.addCondition({ kind: 'backend_crashed', detail: error.code }); }
      else this.failure ??= fatalToError(error);
      return;
    }
    this.failure ??= toSupervisorError(error, this.secrets);
  }

  private track(promise: Promise<unknown>): void {
    const tracked: Promise<unknown> = promise.then(() => undefined, (error: unknown) => this.recordFailure(error)).finally(() => { this.background.delete(tracked); });
    this.background.add(tracked);
  }

  private hasCondition(kind: SupervisorCondition['kind']): boolean {
    return this.conditions.some((condition) => condition.kind === kind);
  }

  private addCondition(condition: SupervisorCondition): void {
    if (!this.hasCondition(condition.kind)) this.conditions.push(condition);
  }

  private hurry(): void {
    this.hurriedFlag = true;
    this.hurried.resolve();
  }

  private emit(type: string, severity: EventSeverity, data: Record<string, unknown>, source: 'vibe' | 'supervisor' = 'vibe'): void {
    const safe = sanitizeForPersistence(data, this.secrets) as Record<string, unknown>;
    this.eventChain = this.eventChain
      .then(() => this.callbacks.onEvent({ source, type, severity, data: safe }))
      .then(() => undefined, (error: unknown) => reportBackgroundFailure('app-server-event', error));
  }

  private emitEffect(effect: { entryId: string; tool: string; outcome: EffectRecord['outcome']; path: string | null }): void {
    if (this.emittedEffects.has(effect.entryId)) return;
    this.emittedEffects.add(effect.entryId);
    const name = TOOL_NAMES[effect.tool] ?? effect.tool;
    const location = effect.path === null ? {} : { path: effect.path };
    if (effect.outcome === 'executed') {
      this.emit('tool_call', 'info', { name, tool: effect.tool, kind: TOOL_KINDS[name] ?? 'other', outcome: effect.outcome, entry_id: effect.entryId, ...location });
    } else if (effect.outcome === 'permission_denied_by_handler' || effect.outcome === 'permission_denied_by_policy') {
      const reason = this.handler.ledger.forEffect(effect.entryId)?.reason ?? effect.outcome;
      this.emit('tool_denied', 'warning', { tool: effect.tool, outcome: effect.outcome, reason, entry_id: effect.entryId, ...location });
    }
  }

  private async supervise(): Promise<void> {
    await this.startReported.promise;
    const how = await this.turnDone.promise;
    await this.conclude(how);
  }

  private async conclude(how: TurnEnd): Promise<void> {
    this.concludeStarted = true;
    this.clearTimers();
    await settlesWithin(Promise.allSettled([...this.background]), BACKGROUND_WAIT_MS);
    const audit = await this.finalRead(how);
    const fatal = this.processor.fatal ?? audit?.fatal ?? null;
    if (fatal) this.addCondition({ kind: 'unsafe_event', fatal });
    if (this.hasCondition('backend_crashed')) await this.settleExit();
    let outcome = this.decide(audit);
    const final = outcome.state === 'completed' ? audit?.finalMessage ?? null : null;
    for (const effect of audit?.effects ?? []) this.emitEffect(effect);
    const bounded = final ? truncateUtf8(final.text, this.input.limits.maxTranscriptBytes) : null;
    if (final && bounded) {
      if (bounded.text.length > 0) this.emit('message', 'info', { text: bounded.text });
      if (final.truncated || bounded.truncated) this.warnings.push('The final assistant message was truncated to the configured limit.');
      else if (!final.complete) this.warnings.push('The final assistant message was not marked complete.');
    }
    this.emitCounters();
    try { await this.cleanup(); }
    catch (error) {
      reportBackgroundFailure('app-server-cleanup', error);
      outcome = { state: 'failed', warnings: [], error: supervisorError('VSUP_BACKEND_ERROR', 'The Vibe app-server termination could not be verified; the run keeps its handle so cleanup can be retried.') };
    }
    await this.eventChain;
    const warnings = [...outcome.warnings, ...this.warnings];
    const usage = this.usage?.state;
    const result: ResultSummary | undefined = outcome.state === 'completed'
      ? { stopReason: outcome.stopReason ?? 'end_turn', summary: bounded?.text ?? '', ...(warnings.length > 0 ? { warnings } : {}) }
      : undefined;
    this.terminalEmitted = true;
    try {
      await this.callbacks.onState(outcome.state, {
        ...(usage ? { usage } : {}),
        ...(result ? { result } : {}),
        ...(outcome.error ? { error: outcome.error } : {})
      });
    } catch (error) { reportBackgroundFailure('app-server-terminal-state', error); }
  }

  private async finalRead(how: TurnEnd): Promise<HistoryAudit | null> {
    const turn = this.completedTurn;
    if (how !== 'turn' || turn === null || this.hasCondition('cancelled') || this.hasCondition('backend_crashed') || this.hasCondition('output_limit') || this.processor.fatal) return null;
    const timeout = this.timing.finalizeRequestTimeoutMs;
    try {
      const runtime = await this.rpc(buildRuntimeRead(this.sessionId), parseRuntimeReadResult, timeout);
      this.usage?.update(runtime.runtime.stats);
      return await auditSessionHistory(
        async (page) => this.rpc(buildSessionHistoryList(this.sessionId, page), parseHistoryListResult, timeout),
        { mode: this.input.mode, ledger: this.handler.ledger, turnId: turn.id, secrets: this.secrets, maxMessageChars: Math.min(200_000, this.input.limits.maxTranscriptBytes) }
      );
    } catch (error) {
      this.recordFailure(error);
      return null;
    }
  }

  private decide(audit: HistoryAudit | null): RunOutcome {
    if (this.conditions.length === 0) {
      if (this.failure) return { state: 'failed', error: this.failure, warnings: [] };
      if (this.gap) {
        return {
          state: 'failed', warnings: [],
          error: supervisorError('VSUP_BACKEND_ERROR', 'The Vibe event stream skipped events, so the run was stopped and could not be trusted.', { reason: 'watermark_gap', expected: this.gap.expected, received: this.gap.received })
        };
      }
    }
    const outcome = mapOutcome({ turn: this.completedTurn, conditions: this.conditions, hasFinalMessage: audit?.finalMessage != null });
    if (outcome.error?.code === 'VSUP_BACKEND_CRASHED') return { ...outcome, error: this.refineCrash(outcome.error) };
    return outcome;
  }

  private refineCrash(error: SupervisorError): SupervisorError {
    const tail = redactSecrets(stderrTailText(this.stderrTail), this.secrets);
    const details = { ...error.details, ...(tail ? { stderr_tail: tail.slice(-MAX_STDERR_DETAIL_CHARS) } : {}) };
    if (rateLimitFailure(tail)) return supervisorError('VSUP_RATE_LIMITED', 'Vibe was rate limited by its provider (HTTP 429).', undefined, true);
    if (authFailureText(tail)) return supervisorError('VSUP_AUTH_REQUIRED', 'Vibe rejected the credentials (authentication failure).');
    return { ...error, details };
  }

  private emitCounters(): void {
    const { counters } = this.processor;
    if (counters.unknownNotifications === 0 && counters.staleEvents === 0 && counters.foreignSessionNotifications === 0) return;
    this.emit('diagnostic', 'info', {
      reason: 'ignored_notifications',
      unknown_notifications: counters.unknownNotifications,
      unknown_methods: counters.unknownMethods,
      stale_events: counters.staleEvents,
      foreign_session_notifications: counters.foreignSessionNotifications
    }, 'supervisor');
  }

  private async classifyStartError(error: unknown): Promise<SupervisorError> {
    if (error instanceof JsonRpcClosedError || (error instanceof JsonRpcFatalError && error.kind === 'io')) return this.exitError();
    return toSupervisorError(error, this.secrets);
  }

  private async exitSummary(): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
    const child = this.child;
    if (!child) return null;
    return Promise.race([child.done.then((exit) => exit, () => null), sleep(EXIT_WAIT_MS).then(() => null)]);
  }

  private async settleExit(): Promise<void> {
    const exit = await this.exitSummary();
    const crashed = this.conditions.find((condition) => condition.kind === 'backend_crashed');
    if (crashed && exit) crashed.detail = `exit ${exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? 'null'}`}`;
  }

  private async exitError(): Promise<SupervisorError> {
    const exit = await this.exitSummary();
    const tail = redactSecrets(stderrTailText(this.stderrTail), this.secrets);
    const message = exit ? `Vibe app-server exited with ${exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? 'null'}`} before it was ready.` : 'The Vibe app-server connection closed before it was ready.';
    const mismatch = versionMismatchOnStderr(tail);
    if (mismatch) return mismatch;
    const classified = classifyFailureText(tail, 'VSUP_BACKEND_CRASHED', message);
    return tail ? { ...classified, details: { ...classified.details, stderr_tail: tail.slice(-MAX_STDERR_DETAIL_CHARS) } } : classified;
  }

  private clearTimers(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.deadlineTimer = undefined;
    this.graceTimer = undefined;
  }

  private cleanup(): Promise<void> {
    if (this.cleaned) return Promise.resolve();
    this.cleaning ??= this.performCleanup().then(
      () => { this.cleaned = true; },
      (error: unknown) => { this.cleaning = undefined; throw error; }
    );
    return this.cleaning;
  }

  private async performCleanup(): Promise<void> {
    this.shuttingDown = true;
    this.clearTimers();
    const child = this.child;
    if (child) {
      await settlesWithin(this.client.closeInput(), CLOSE_INPUT_WAIT_MS);
      if (!this.hurriedFlag) await Promise.race([child.done.then(() => undefined, () => undefined), sleep(this.timing.stdinGraceMs), this.hurried.promise]);
      if (child.child.pid !== undefined) await child.terminate(this.hurriedFlag ? 0 : this.timing.terminateGraceMs);
    }
    if (this.reaper) {
      const outcome = await this.reaper.stop();
      if (outcome.reason === 'deadline' || outcome.reason === 'supervisor-gone') this.emit('diagnostic', 'warning', { text: `The process reaper ended the worker (${outcome.reason}).`, reason: 'reaper_fired' }, 'supervisor');
    }
    this.client?.dispose();
    const tail = this.stderrRedactor.flush();
    if (tail) this.emit('diagnostic', 'warning', { text: tail }, 'supervisor');
    await this.removePrivateDirectories();
  }

  private async removePrivateDirectories(): Promise<void> {
    const { home, vibeHome, tmp } = this.plan.directories;
    const results = await Promise.allSettled([home, vibeHome, tmp].map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 2 })));
    if (results.some((result) => result.status === 'rejected')) {
      this.warnings.push('Some private Vibe state could not be deleted and remains in the run directory.');
      this.emit('diagnostic', 'warning', { text: 'The private Vibe directories could not be fully deleted.', reason: 'private_state_retained' }, 'supervisor');
    }
  }
}

export async function resolveAppServerExecutable(config: SupervisorConfig, override?: string): Promise<string> {
  const configured = override ?? config.paths?.appServer;
  if (configured) return path.isAbsolute(configured) ? configured : resolveCommand(configured, process.env);
  const vibe = await resolveCommand(config.paths?.vibe ?? 'vibe', process.env);
  return path.join(path.dirname(vibe), APP_SERVER_BINARY);
}

function configuredBudgets(config: SupervisorConfig): BudgetCeilings {
  return {
    ...(config.limits.maxTokens === undefined ? {} : { maxTokens: config.limits.maxTokens }),
    ...(config.limits.maxCostUsd === undefined ? {} : { maxCost: config.limits.maxCostUsd })
  };
}

export class AppServerBackend implements SupervisorBackend {
  readonly kind: BackendKind = BACKEND_KIND;
  private readonly timing: AppServerTiming;
  private readonly runOptions: AppServerBackendOptions;

  constructor(private readonly config: SupervisorConfig, private readonly options: AppServerBackendOptions = {}) {
    this.timing = { ...DEFAULT_APP_SERVER_TIMING, ...options.timing };
    this.runOptions = { ...options, budgets: options.budgets ?? configuredBudgets(config) };
  }

  private async appServerExecutable(): Promise<string> {
    return resolveAppServerExecutable(this.config, this.options.executable);
  }

  private async verifyPin(executable: string): Promise<void> {
    const { pin } = this.options;
    if (pin?.verify) { await pin.verify(executable); return; }
    const manifestPath = pin?.manifestPath ?? this.config.paths?.vibePinManifest;
    if (manifestPath) { await verifyPinnedInstall({ executable, manifestPath }); return; }
    throw new PinCheckError('manifest-unreadable', 'No pin manifest is configured, so the installed Vibe cannot be verified. Set paths.vibe_pin_manifest and write the manifest with the pin-manifest command.');
  }

  async probe(): Promise<BackendCapabilities> {
    let executable: string | undefined;
    try {
      executable = await this.appServerExecutable();
      await this.verifyPin(executable);
      return { available: true, backend: this.kind, executable, version: SUPPORTED_VIBE, details: { reason: 'The installed Vibe matches the pinned manifest.' } };
    } catch (error) {
      const failure = toSupervisorError(error, []);
      return { available: false, backend: this.kind, ...(executable ? { executable } : {}), details: { reason: failure.message, code: failure.code } };
    }
  }

  async runtimeCheck(): Promise<RuntimeCheck> {
    const command = this.options.executable ?? this.config.paths?.vibe ?? 'vibe';
    const note = `Vibe was not launched. The app-server executable is resolved only; the exact version ${SUPPORTED_VIBE} and the installed files are verified when a run starts and drift fails that run closed.`;
    try {
      const resolved = await this.appServerExecutable();
      await access(resolved, fsConstants.X_OK);
      return { executable: command, resolved_executable: resolved, executable_found: true, pinned_version: SUPPORTED_VIBE, version_verified: false, note };
    } catch {
      return { executable: command, resolved_executable: null, executable_found: false, pinned_version: SUPPORTED_VIBE, version_verified: false, note };
    }
  }

  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    let executable: string;
    try { executable = await this.appServerExecutable(); }
    catch { throw supervisorError('VSUP_VIBE_NOT_FOUND', 'The vibe-app-server executable could not be located next to the configured Vibe.'); }
    try { await this.verifyPin(executable); }
    catch (error) { throw toSupervisorError(error, []); }
    const resolution = await (this.options.resolveCredential ?? resolveCredential)();
    if (!resolution.credential) {
      throw supervisorError('VSUP_AUTH_REQUIRED', 'No Mistral credential was found for the Vibe app-server.', { credential_status: resolution.status, ...(resolution.detail ? { detail: resolution.detail } : {}) });
    }
    let plan: SessionConfigPlan;
    try {
      plan = buildSessionConfig({ mode: input.mode, workspace: input.workerWorkspace, runDirectory: input.runDirectory, maxTurns: input.limits.maxTurns });
    } catch (error) { throw toSupervisorError(error, []); }
    const run = new AppServerRun({
      input, callbacks, options: this.runOptions, timing: this.timing, executable, plan,
      credential: resolution.credential, expectedVersion: this.options.expectedServerVersion ?? SUPPORTED_VIBE
    });
    return run.start();
  }

  async cancel(handle: BackendRunHandle): Promise<void> {
    await (handle.opaque as AppServerRun).cancel();
  }

  async terminateNow(handle: BackendRunHandle): Promise<void> {
    await (handle.opaque as AppServerRun).terminateNow();
  }

  async close(handle: BackendRunHandle): Promise<void> {
    await (handle.opaque as AppServerRun).close();
  }
}
