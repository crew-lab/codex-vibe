import { modelObservationSchema } from "../reporting/telemetry.js";
import { checkPreparation, type PreparationStatus } from "../preparation/evidence.js";
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  ApprovalLedgerEntry, ApprovalLedgerSnapshot, BackendCallbacks, BackendCapabilities, BackendKind, BackendRunHandle, BackendStartResult, EventSeverity,
  PinIdentity, ProcessRecord, ResultSummary, RuntimeCheck, StartRunInput, SupervisorBackend, SupervisorConfig, SupervisorError, ToolCallCounts
} from '../contracts.js';
import { MAX_APPROVAL_LEDGER_RECORDS, supervisorError } from '../contracts.js';
import { describeFailure, reportBackgroundFailure } from '../diagnostics/background.js';
import { sanitizeForPersistence } from '../persistence/atomic.js';
import { spawnManaged, type ManagedProcess } from '../process/managed.js';
import { ReaperStartError, startReaper, type ReaperHandle, type ReaperOptions } from '../process/reaper.js';
import { buildChildEnvironment } from '../security/environment.js';
import { WorkspacePathError } from '../security/paths.js';
import { denylistAnchors, workspaceAnchors } from '../security/globs.js';
import { assertNoProjectVibeExtensions } from '../security/workspace-guard.js';
import { redactSecrets, StreamingRedactor } from '../security/redaction.js';
import { APP_VERSION } from '../version.js';
import { FINDINGS_OUTPUT_CONTRACT } from '../core/findings.js';
import { ApprovalHandler, type ApprovalHandlerOptions, type ApprovalRecord, type PendingApproval } from './app-server/approvals.js';
import { resolveCredential, type CredentialResolution, type ResolvedCredential } from './app-server/credentials.js';
import { EventProcessor, auditSessionHistory, unfinishedEffectFatal, type EffectRecord, type EventFatal, type EventSignal, type HistoryAudit } from './app-server/events.js';
import {
  JsonRpcClient, JsonRpcClosedError, JsonRpcFatalError, JsonRpcServerError, JsonRpcTimeoutError,
  type JsonObject, type NotificationHandler
} from './app-server/jsonrpc.js';
import { mapOutcome, type RunOutcome, type SupervisorCondition } from './app-server/outcome.js';
import { DEFAULT_PIN_LIMITS, PinCheckError, locateEnvironment, parsePinManifest, readPinManifestBytes, verifyPinnedInstall } from './app-server/pin.js';
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
import { UsageTracker, describeUsageFault, turnBackstop, type BudgetCeilings, type UsageFault, type UsageUpdate } from './app-server/usage.js';
import { buildWorkspaceListing, type ListingLimits, type WorkspaceListing } from './app-server/workspace-listing.js';
import { resolveCommand, spawned } from './app-server/executable.js';
import {
  authFailureText, classifyFailureText, classifyStartFailure, rateLimitFailure, stderrTailText,
  versionMismatchOnStderr, versionUnsupported
} from './app-server/failure.js';
import { configureManagedConfigEndpoint, startManagedConfigEndpoint, type ManagedConfigEndpoint } from './app-server/managed-config.js';
import { SUPPORTED_VIBE } from './app-server/supported-vibe.js';

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
const STOP_REQUEST_KINDS: ReadonlySet<SupervisorCondition['kind']> = new Set(['budget', 'cancelled', 'deadline']);
const BENIGN_SERVER_ERRORS: ReadonlySet<string> = new Set(['stale_turn', 'conflict', 'not_found', 'callback_closed']);
const SHA256_HEX = /^[0-9a-f]{64}$/;
const VERSION_TEXT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_VERSION_CHARS = 128;

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
  preparation?: { check: (config: SupervisorConfig, dataDir?: string) => Promise<PreparationStatus> };
  dataDir?: string;
  executable?: string;
  expectedServerVersion?: string;
  pin?: { manifestPath?: string; verify?: (executable: string) => Promise<unknown> };
  resolveCredential?: () => Promise<CredentialResolution>;
  approvals?: { deadlineMs?: number; evaluate?: ApprovalHandlerOptions['evaluate'] };
  budgets?: BudgetCeilings;
  listing?: Partial<ListingLimits>;
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

function promptFor(input: StartRunInput, listing: string | null): string {
  const context = (input.contextFiles ?? []).map((file) => `Approved context path: ${file}`).join('\n');
  const prefix = [listing, context].filter((part): part is string => part !== null && part.length > 0).join('\n\n');
  let prompt = prefix ? `${prefix}\n\nTask:\n${input.task}` : input.task;
  if (input.mode === 'review' && input.output === 'findings') {
    prompt = `${prompt}\n\n${FINDINGS_OUTPUT_CONTRACT}`;
  }
  return prompt;
}

function usageFaultError(fault: UsageFault): SupervisorError {
  if (fault.kind === 'price_unavailable') {
    return supervisorError('VSUP_BACKEND_ERROR', describeUsageFault(fault), { reason: 'price_unavailable', ceiling_usd: fault.ceiling });
  }
  return supervisorError('VSUP_BACKEND_ERROR', describeUsageFault(fault), {
    reason: 'usage_counter_regressed', counter: fault.counter, previous: fault.previous, ...(Number.isNaN(fault.observed) ? {} : { observed: fault.observed })
  });
}

interface RunParts {
  preparation: PreparationStatus;
  input: StartRunInput;
  callbacks: BackendCallbacks;
  options: AppServerBackendOptions;
  timing: AppServerTiming;
  executable: string;
  pin: PinIdentity | undefined;
  credential: ResolvedCredential;
  plan: SessionConfigPlan;
  expectedVersion: string;
  listing: WorkspaceListing;
}

interface VerifiedPin {
  executable: string;
  pin: PinIdentity | undefined;
}

function ledgerEntry(record: ApprovalRecord): ApprovalLedgerEntry {
  const { callbackId, relatedEntryId, turnId, tool, path: recordedPath, fingerprint, decision, reason } = record;
  return { callbackId, relatedEntryId, turnId, tool, path: recordedPath, fingerprint, decision, reason };
}

function reportedPin(value: unknown): PinIdentity | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const { vibeVersion, manifestSha256, recordSha256 } = value as Record<string, unknown>;
  if (typeof vibeVersion !== 'string' || vibeVersion.length > MAX_VERSION_CHARS || !VERSION_TEXT.test(vibeVersion)) return undefined;
  if (typeof manifestSha256 !== 'string' || !SHA256_HEX.test(manifestSha256) || typeof recordSha256 !== 'string' || !SHA256_HEX.test(recordSha256)) return undefined;
  return { vibeVersion, manifestSha256, recordSha256 };
}

type TurnEnd = 'turn' | 'forced';

class AppServerRun {
  readonly handle: BackendRunHandle;
  private readonly preparation: PreparationStatus;
  private readonly input: StartRunInput;
  private readonly callbacks: BackendCallbacks;
  private readonly options: AppServerBackendOptions;
  private readonly timing: AppServerTiming;
  private readonly executable: string;
  private readonly pin: PinIdentity | undefined;
  private readonly credential: ResolvedCredential;
  private readonly plan: SessionConfigPlan;
  private readonly expectedVersion: string;
  private readonly listing: WorkspaceListing;
  private readonly secrets: string[];
  private readonly deadlineAt: number;
  private readonly handler: ApprovalHandler;
  private managedConfigEndpoint: ManagedConfigEndpoint | undefined;
  private readonly stderrRedactor: StreamingRedactor;
  private readonly turnDone = deferred<TurnEnd>();
  private readonly startReported = deferred<void>();
  private readonly hurried = deferred<void>();
  private readonly emittedEffects = new Set<string>();
  private readonly toolCalls: ToolCallCounts = { executed: 0, deniedByHandler: 0, deniedByPolicy: 0 };
  private readonly background = new Set<Promise<unknown>>();
  private readonly conditions: SupervisorCondition[] = [];
  private readonly warnings: string[] = [];
  private child: ManagedProcess | undefined;
  private client!: JsonRpcClient;
  private reaper: ReaperHandle | undefined;
  private processor!: EventProcessor;
  private usage: UsageTracker | undefined;
  private readonly modelObservations: import("../reporting/telemetry.js").ModelObservation[] = [];
  private openedSessionId = '';
  private turnId = '';
  private completedTurn: Turn | null = null;
  private processRecord: ProcessRecord | undefined;
  private failure: SupervisorError | undefined;
  private integrityFailure: SupervisorError | undefined;
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
    this.preparation = parts.preparation;
    this.input = parts.input;
    this.callbacks = parts.callbacks;
    this.options = parts.options;
    this.timing = parts.timing;
    this.executable = parts.executable;
    this.pin = parts.pin;
    this.credential = parts.credential;
    this.plan = parts.plan;
    this.expectedVersion = parts.expectedVersion;
    this.listing = parts.listing;
    this.secrets = [parts.credential.secret()];
    this.deadlineAt = Date.now() + parts.input.limits.timeoutSeconds * 1000;
    this.stderrRedactor = new StreamingRedactor(this.secrets);
    this.handle = { runId: parts.input.runId, backend: BACKEND_KIND, opaque: this };
    this.handler = new ApprovalHandler({
      mode: parts.input.mode,
      workspace: parts.input.workerWorkspace,
      excludedGlobs: workspaceAnchors(parts.input.exclusions, parts.input.cwd),
      currentSessionId: () => this.sessionId,
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
      this.reportListing();
      await this.handshake();
      await this.beginTurn();
    } catch (error) {
      const failure = this.startAbort ?? await this.classifyStartError(error);
      await this.cleanup().catch((cleanupError: unknown) => reportBackgroundFailure('app-server-start-cleanup', cleanupError));
      throw failure;
    }
    const process = this.processRecord;
    try { await this.callbacks.onState('running', { preparation: this.preparation, ...(process ? { process } : {}), ...(this.pin ? { pin: { ...this.pin } } : {}), modelObservations: [...this.modelObservations] }); }
    catch (error) { reportBackgroundFailure('app-server-running', error); }
    void this.supervise().catch((error: unknown) => reportBackgroundFailure('app-server-supervise', error));
    this.startReported.resolve();
    return { handle: this.handle, initialState: 'running', ...(process ? { process } : {}) };
  }

  async cancel(): Promise<void> {
    this.handler.revoke();
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
    this.handler.revoke();
    if (!this.concludeStarted) this.addCondition({ kind: 'cancelled' });
    this.hurry();
    if (!this.turnStarted) this.abortStartup(supervisorError('VSUP_CANCELLED', 'The run was cancelled before the turn started.'));
    else this.turnDone.resolve('forced');
    await this.cleanup();
  }

  async close(): Promise<void> {
    if (this.cleaned) return;
    this.handler.revoke();
    if (this.cleaning === undefined && !this.concludeStarted) await this.cancel();
    else await this.cleanup();
  }

  private async spawnWorker(): Promise<void> {
    const { input } = this;
    await assertNoProjectVibeExtensions(input.cwd);
    await assertNoProjectVibeExtensions(input.workerWorkspace);
    if (this.shuttingDown) throw this.startAbort ?? supervisorError('VSUP_CANCELLED', 'The run was stopped before the app-server was spawned.');
    this.managedConfigEndpoint = await startManagedConfigEndpoint();
    configureManagedConfigEndpoint(this.plan, this.managedConfigEndpoint.url);
    if (this.shuttingDown) {
      await this.managedConfigEndpoint.close();
      throw this.startAbort ?? supervisorError('VSUP_CANCELLED', 'The run stopped before spawning.');
    }
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
        retainStdout: false,
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

  private reportListing(): void {
    const { unavailable } = this.listing;
    if (unavailable === null || unavailable === 'not_repository') return;
    this.emit('diagnostic', 'warning', { text: `The workspace file listing was left out of the prompt (${unavailable}).`, reason: 'file_listing_unavailable', detail: unavailable }, 'supervisor');
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
    await this.readback({ checkThinking: false, checkCounts: true, session: started });
    await this.rpc(buildThinkingOffWrite(this.sessionId), parseConfigModelWriteResult, this.startupTimeout());
    const second = await this.readback({ checkThinking: true, checkCounts: false, session: started });
    const tracker = new UsageTracker(second.runtime.stats, {
      maxModelCalls: turnBackstop(this.input.limits.maxTurns, this.options.turnBackstopMargin),
      ...this.options.budgets
    });
    if (tracker.fault) throw usageFaultError(tracker.fault);
    this.usage = tracker;
  }

  private async readback(options: { checkThinking: boolean; checkCounts: boolean; session: SessionStartResult }): Promise<RuntimeReadResult> {
    const { checkThinking, checkCounts, session: sessionStart } = options;
    const runtime = await this.rpc(buildRuntimeRead(this.sessionId), parseRuntimeReadResult, this.startupTimeout());
    const effective = await this.rpc(buildConfigEffectiveRead(this.sessionId), parseConfigEffectiveReadResult, this.startupTimeout());
    const mismatches: ReadbackMismatch[] = compareReadback(this.plan.expectation, { sessionStart, runtime, effective }, { checkThinking });
    if (checkCounts) {
      const config = await this.rpc(buildConfigRead(this.sessionId), parseConfigReadResult, this.startupTimeout());
      if (config.hooksCount !== 0) mismatches.push({ path: 'config/read.hooksCount', expected: 0, actual: config.hooksCount });
      if (config.skillsCount !== 0) mismatches.push({ path: 'config/read.skillsCount', expected: 0, actual: config.skillsCount });
    }
    if (mismatches.length > 0) {
      throw supervisorError('VSUP_BACKEND_ERROR', `Vibe did not apply the supervisor session configuration: ${formatReadbackMismatches(mismatches)}`, {
        reason: 'readback_mismatch', fields: mismatches.slice(0, 20).map((item) => item.path), total: mismatches.length
      });
    }
    if (checkThinking) {
      if (this.modelObservations.length >= 100) throw supervisorError('VSUP_OUTPUT_LIMIT', 'Model observation limit exceeded.');
      this.modelObservations.push(modelObservationSchema.parse({ observed_at: new Date().toISOString(), source: 'runtime/read', reported_name: runtime.runtime.activeModel?.name ?? null, prices_per_million: { input: runtime.runtime.stats.inputPricePerMillion, output: runtime.runtime.stats.outputPricePerMillion, cached_input: runtime.runtime.stats.cachedInputPricePerMillion }, session_model: sessionStart.state.session.model, alias: runtime.runtime.activeModel?.alias ?? null, thinking: runtime.runtime.activeModel?.thinking ?? null }));
      if (this.startReported.settled) await this.callbacks.onState('running', { modelObservations: [...this.modelObservations] });
    }
    return runtime;
  }

  private async beginTurn(): Promise<void> {
    const started = await this.rpc(buildTurnStart(this.sessionId, promptFor(this.input, this.listing.text)), parseTurnStartResult, this.startupTimeout());
    if (this.startAbort) throw this.startAbort;
    this.turnId = started.turn.id;
    await settlesWithin(this.client.drained(), this.startupTimeout());
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
        this.markIntegrityFailure(toSupervisorError(error, this.secrets));
        this.interrupt();
        throw error;
      }
      setImmediate(() => this.track(this.answer(pending)));
      return pending.acknowledgement;
    });
  }

  private async answer(pending: PendingApproval): Promise<void> {
    try {
      const verdict = await pending.verdict;
      await this.rpc(buildCallbackResult(this.sessionId, pending.callbackId, verdict.decision), (value) => parseAcceptedResult(value, 'callback/result result'), this.timing.requestTimeoutMs);
    } catch (error) {
      if (error instanceof JsonRpcServerError && BENIGN_SERVER_ERRORS.has(error.code)) return;
      throw error;
    } finally {
      this.handler.settle(pending.callbackId);
    }
  }

  private readonly onNotification: NotificationHandler = async (method, params) => {
    let handoff: Extract<EventSignal, { type: 'session_handoff' }> | undefined;
    for (const signal of this.processor.handle(method, params).signals) {
      if (signal.type === 'session_handoff') handoff = signal;
      else this.onSignal(signal);
    }
    if (handoff) await this.handoff(handoff);
  };

  private async handoff(signal: Extract<EventSignal, { type: 'session_handoff' }>): Promise<void> {
    const work = this.revalidateHandoff(signal).then(
      () => undefined,
      (error: unknown) => {
        this.handler.revoke();
        this.recordFailure(error);
        this.interrupt();
        this.turnDone.resolve('forced');
      }
    );
    this.track(work);
    await work;
  }

  private async revalidateHandoff(signal: Extract<EventSignal, { type: 'session_handoff' }>): Promise<void> {
    const timeout = this.startupTimeout();
    const session = await this.rpc(buildSessionRead(this.sessionId, { history: { limit: MAX_PAGE_LIMIT } }), parseSessionReadResult, timeout);
    if (session.state.session.id !== signal.newSessionId) {
      throw supervisorError('VSUP_BACKEND_ERROR', 'The Vibe session read after a handoff names a different session.', { reason: 'session_handoff_unsafe' });
    }
    const adopted = await this.processor.adoptHistory(
      async (page) => this.rpc(buildSessionHistoryList(this.sessionId, page), parseHistoryListResult, this.startupTimeout()),
      { pageLimit: MAX_PAGE_LIMIT }
    );
    for (const next of adopted.signals) this.onSignal(next);
    if (this.processor.fatal) return;
    await this.readback({ checkThinking: true, checkCounts: true, session });
    this.usage?.markHandoff();
    this.warnings.push('The Vibe session was compacted or cleared during the run; the supervisor followed the new session.');
    this.emit('diagnostic', 'warning', { text: `Vibe replaced the session (${signal.kind}); its configuration was read back again and no callback or grant was carried over.`, reason: 'session_handoff' }, 'supervisor');
  }

  private onSignal(signal: EventSignal): void {
    switch (signal.type) {
      case 'fatal':
        this.handler.revoke();
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
    this.applyUsage(this.usage.update(stats, contextWindow));
  }

  private applyUsage(update: UsageUpdate): void {
    if (!this.usage) return;
    if (update.fault) {
      this.markIntegrityFailure(usageFaultError(update.fault));
      this.interrupt();
      return;
    }
    if (update.breach && !this.hasCondition('budget')) {
      this.handler.revoke();
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
    this.handler.revoke();
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
      else this.markIntegrityFailure(fatalToError(error));
      return;
    }
    if (error instanceof ProtocolParseError) { this.markIntegrityFailure(toSupervisorError(error, this.secrets)); return; }
    this.failure ??= toSupervisorError(error, this.secrets);
  }

  private markIntegrityFailure(error: SupervisorError): void {
    this.failure ??= error;
    this.integrityFailure ??= error;
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
      this.toolCalls.executed += 1;
      this.emit('tool_call', 'info', { name, tool: effect.tool, kind: TOOL_KINDS[name] ?? 'other', outcome: effect.outcome, entry_id: effect.entryId, ...location });
    } else if (effect.outcome === 'permission_denied_by_handler' || effect.outcome === 'permission_denied_by_policy') {
      if (effect.outcome === 'permission_denied_by_handler') this.toolCalls.deniedByHandler += 1;
      else this.toolCalls.deniedByPolicy += 1;
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
    const fatal = this.processor.fatal ?? audit?.fatal ?? this.unfinishedEffects(audit);
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
    this.emitCounters(audit);
    try { await this.cleanup(); }
    catch (error) {
      reportBackgroundFailure('app-server-cleanup', error);
      outcome = { state: 'failed', warnings: [], error: supervisorError('VSUP_BACKEND_ERROR', 'The Vibe app-server termination could not be verified; the run keeps its handle so cleanup can be retried.') };
    }
    await this.eventChain;
    const warnings = [...outcome.warnings, ...this.warnings];
    const usage = this.usage ? { ...this.usage.state, toolCalls: { ...this.toolCalls } } : undefined;
    const result: ResultSummary | undefined = outcome.state === 'completed'
      ? { stopReason: outcome.stopReason ?? 'end_turn', summary: bounded?.text ?? '', ...(warnings.length > 0 ? { warnings } : {}) }
      : undefined;
    this.terminalEmitted = true;
    try {
      await this.callbacks.onState(outcome.state, {
        ...(usage ? { usage } : {}),
        ...(result ? { result } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
        approvals: this.approvalSnapshot()
      });
    } catch (error) { reportBackgroundFailure('app-server-terminal-state', error); }
  }

  private approvalSnapshot(): ApprovalLedgerSnapshot {
    const all = this.handler.ledger.all();
    const records = all.slice(0, MAX_APPROVAL_LEDGER_RECORDS).map((record) => sanitizeForPersistence(ledgerEntry(record), this.secrets) as ApprovalLedgerEntry);
    return { records, truncated: this.handler.ledger.truncated || all.length > records.length };
  }

  private unfinishedEffects(audit: HistoryAudit | null): EventFatal | null {
    if (!audit || audit.pendingEffects.length === 0 || this.hasCondition('deadline')) return null;
    return unfinishedEffectFatal(audit.pendingEffects);
  }

  private async finalRead(how: TurnEnd): Promise<HistoryAudit | null> {
    if (this.hasCondition('cancelled') || this.hasCondition('backend_crashed') || this.hasCondition('output_limit') || this.processor.fatal) return null;
    const turn = this.completedTurn;
    const forced = how !== 'turn' || turn === null;
    if (forced && !(this.hasCondition('budget') || this.hasCondition('deadline'))) return null;
    const turnId = turn?.id ?? this.turnId;
    if (turnId === '') return null;
    const timeout = forced ? this.timing.interruptTimeoutMs : this.timing.finalizeRequestTimeoutMs;
    try {
      const runtime = await this.rpc(buildRuntimeRead(this.sessionId), parseRuntimeReadResult, timeout);
      if (this.usage) this.applyUsage(this.usage.update(runtime.runtime.stats));
      return await auditSessionHistory(
        async (page) => this.rpc(buildSessionHistoryList(this.sessionId, page), parseHistoryListResult, timeout),
        {
          mode: this.input.mode, ledger: this.handler.ledger, turnId, secrets: this.secrets, maxMessageChars: Math.min(200_000, this.input.limits.maxTranscriptBytes),
          sessionIds: this.processor.sessionIds, historical: this.processor.historicalEffects
        }
      );
    } catch (error) {
      this.recordFailure(error);
      return null;
    }
  }

  private decide(audit: HistoryAudit | null): RunOutcome {
    if (this.conditions.every((condition) => STOP_REQUEST_KINDS.has(condition.kind))) {
      const budgetOnly = this.conditions.every((condition) => condition.kind === 'budget');
      const error = (budgetOnly ? this.failure : this.integrityFailure) ?? this.gapError();
      if (error) return { state: 'failed', error: this.mentionStops(error), warnings: [] };
    }
    const outcome = mapOutcome({ turn: this.completedTurn, conditions: this.conditions, hasFinalMessage: audit?.finalMessage != null });
    if (outcome.state === 'completed' && audit === null && this.hasCondition('budget')) {
      return {
        state: 'failed', warnings: [],
        error: supervisorError('VSUP_BACKEND_ERROR', 'The run stopped at a limit and the final history audit could not run, so the effects of the run are unverified.', { reason: 'audit_unavailable' })
      };
    }
    if (outcome.error?.code === 'VSUP_BACKEND_CRASHED') return { ...outcome, error: this.refineCrash(outcome.error) };
    return outcome;
  }

  private gapError(): SupervisorError | undefined {
    if (!this.gap) return undefined;
    return supervisorError('VSUP_BACKEND_ERROR', 'The Vibe event stream skipped events, so the run was stopped and could not be trusted.', { reason: 'watermark_gap', expected: this.gap.expected, received: this.gap.received });
  }

  private mentionStops(error: SupervisorError): SupervisorError {
    const stops = this.conditions.filter((condition) => condition.kind !== 'budget').map((condition) => condition.kind);
    if (stops.length === 0) return error;
    const sentence = stops.map((kind) => (kind === 'cancelled' ? 'was also cancelled' : 'also reached its deadline')).join(' and ');
    return { ...error, message: `${error.message} The run ${sentence}.`, details: { ...error.details, also: stops } };
  }

  private refineCrash(error: SupervisorError): SupervisorError {
    const tail = redactSecrets(stderrTailText(this.stderrTail), this.secrets);
    const details = { ...error.details, ...(tail ? { stderr_tail: tail.slice(-MAX_STDERR_DETAIL_CHARS) } : {}) };
    if (rateLimitFailure(tail)) return supervisorError('VSUP_RATE_LIMITED', 'Vibe was rate limited by its provider (HTTP 429).', undefined, true);
    if (authFailureText(tail)) return supervisorError('VSUP_AUTH_REQUIRED', 'Vibe rejected the credentials (authentication failure).');
    return { ...error, details };
  }

  private emitCounters(audit: HistoryAudit | null): void {
    const { counters } = this.processor;
    this.emit('diagnostic', 'info', {
      reason: 'reasoning_observation',
      streamed_entries: counters.reasoningDropped,
      history_entries: audit?.reasoningDropped ?? null,
      history_audited: audit !== null && audit.fatal === null
    }, 'supervisor');
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
    this.handler.revoke();
    this.clearTimers();
    const child = this.child;
    if (child) {
      if (this.client) await settlesWithin(this.client.closeInput(), CLOSE_INPUT_WAIT_MS);
      if (!this.hurriedFlag) await Promise.race([child.done.then(() => undefined, () => undefined), sleep(this.timing.stdinGraceMs), this.hurried.promise]);
      if (child.child.pid !== undefined) await child.terminate(this.hurriedFlag ? 0 : this.timing.terminateGraceMs);
    }
    await this.managedConfigEndpoint?.close();
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

  private async verifyPin(executable: string): Promise<VerifiedPin> {
    const { pin } = this.options;
    if (pin?.verify) {
      const verified = await pin.verify(executable);
      const reported = (verified as { executable?: unknown } | null | undefined)?.executable;
      return { executable: typeof reported === 'string' && path.isAbsolute(reported) ? reported : executable, pin: reportedPin(verified) };
    }
    const manifestPath = pin?.manifestPath ?? this.config.paths?.vibePinManifest;
    if (manifestPath) {
      await locateEnvironment(executable);
      const bytes = await readPinManifestBytes(manifestPath, DEFAULT_PIN_LIMITS);
      const manifest = parsePinManifest(bytes.toString('utf8'));
      const pinned = await verifyPinnedInstall({ executable, manifest });
      return {
        executable: pinned.executable,
        pin: { vibeVersion: pinned.version, manifestSha256: createHash('sha256').update(bytes).digest('hex'), recordSha256: pinned.recordSha256 }
      };
    }
    throw new PinCheckError('manifest-unreadable', 'No pin manifest is configured, so the installed Vibe cannot be verified. Set paths.vibe_pin_manifest in the selected config to an absolute path, write the manifest there with `vibe-supervisor pin-manifest`, and restart the server.');
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

  async preparationCheck(): Promise<PreparationStatus> { return (this.options.preparation?.check ?? checkPreparation)(this.config, this.options.dataDir); }

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
    let verified: VerifiedPin;
    try { verified = await this.verifyPin(executable); }
    catch (error) { throw toSupervisorError(error, []); }
    const preparation = await this.preparationCheck();
    if (preparation.status !== 'passed') throw supervisorError('VSUP_INVALID_STATE', 'Matching candidate conformance is required before dispatch. Run prepare check with the version-matched kit.', { preparation });
    const resolution = await (this.options.resolveCredential ?? resolveCredential)();
    if (!resolution.credential) {
      throw supervisorError('VSUP_AUTH_REQUIRED', 'No Mistral credential was found for the Vibe app-server.', { credential_status: resolution.status, ...(resolution.detail ? { detail: resolution.detail } : {}) });
    }
    let plan: SessionConfigPlan;
    let anchors: ReturnType<typeof workspaceAnchors>;
    try {
      anchors = workspaceAnchors(input.exclusions, input.cwd);
      plan = buildSessionConfig({ mode: input.mode, workspace: input.workerWorkspace, runDirectory: input.runDirectory, maxTurns: input.limits.maxTurns, excludedGlobs: denylistAnchors(input.exclusions, input.cwd, input.workerWorkspace) });
    } catch (error) { throw toSupervisorError(error, []); }
    const listing = await buildWorkspaceListing(input.workerWorkspace, this.options.listing, anchors);
    const run = new AppServerRun({
      input, callbacks, preparation, options: this.runOptions, timing: this.timing, executable: verified.executable, pin: verified.pin, plan, listing,
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
