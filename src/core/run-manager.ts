import { createHash, randomUUID } from "node:crypto";
import { open, readFile, readdir, realpath, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import type {
  BackendCallbacks, BackendKind, BackendRunHandle,
  ReviewStartToolInput, EditStartToolInput, StatusToolInput,
  ResultToolInput, WaitOptions, CloseToolInput, RunLimits, RunMode, RunRecord, RunState, SupervisorBackend,
  ReviewIntegrity, SupervisorConfig, SupervisorError, SupervisorErrorCode, SupervisorEvent
} from "../contracts.js";
import { APP_VERSION } from "../version.js";
import { SCHEMA_VERSION, supervisorError } from "../contracts.js";
import { closeSchema, editStartSchema, resultSchema, reviewStartSchema, statusSchema } from "../mcp/schemas.js";
import { atomicWriteJson, sanitizeForPersistence } from "../persistence/atomic.js";
import { readNdjsonRecovering } from "../persistence/ndjson.js";
import { EventLog } from "../persistence/event-log.js";
import { asStorageError, storageErrorDetails } from "../persistence/storage-error.js";
import { describeFailure, reportBackgroundFailure, writeDiagnostic } from "../diagnostics/background.js";
import { createPrivateDir, resolveCanonicalRoot, resolveContextFile, isPathWithinRoot } from "../security/paths.js";
import { redactSecrets } from "../security/redaction.js";
import { assertNotSupervisorChild } from "../security/environment.js";
import { createDetachedWorktree, exportDirtySnapshot, removeVerifiedWorktree, resolveGitRoot } from "../git/worktree.js";
import { assertNoProjectVibeExtensions, assertSimpleGlobRoot } from "../backends/profile.js";
import { eventFromWire, eventToWire, integrityToWire, runFromWire, runToWire } from "./serialization.js";
import { assertTransition, isTerminal } from "./run-state.js";
import { changedSinceSnapshot, parseManifest, serializeManifest, snapshotWorkspace } from "./workspace-snapshot.js";
import type { ManifestEntry } from "./workspace-snapshot.js";
import { acquireOwnerLock } from "./owner-lock.js";
import type { OwnerLock } from "./owner-lock.js";

interface Runtime {
  record: RunRecord;
  directory: string;
  task: string;
  contextFiles: string[];
  handle?: BackendRunHandle;
  closedHandles: Set<BackendRunHandle>;
  starting?: Promise<unknown>;
  backend?: SupervisorBackend;
  events: SupervisorEvent[];
  eventSeq: number;
  eventBytes: number;
  eventLog?: EventLog;
  loading?: Promise<void> | undefined;
  transcript: string;
  serial: Promise<void>;
  timer?: NodeJS.Timeout;
  deadlineAt?: number;
  slot: boolean;
  cancelRequested: boolean;
  started: boolean;
  sourceSnapshot?: string;
  sourceManifest?: Map<string, ManifestEntry>;
  snapshotFailed?: boolean;
  verifiedPatch?: { patchPath: string; sha256: string };
  baseRef?: string;
  progressTimer?: NodeJS.Timeout;
  progressArmedAt?: number;
  lastActivity?: { at: number; kind: string };
  transcriptOverflow: boolean;
  requestedOutcome?: RequestedOutcome;
  storageDegraded?: { code: string; directory: string };
  storageHealed?: { meta: boolean; event: boolean };
  reportedEventFailures?: Set<string>;
  manifestWrite?: Promise<void>;
  logUnavailable?: { kind: "content" | "filesystem"; reason: string; code?: string };
  persistChain: Promise<void>;
  closeChain: Promise<void>;
  waiters: Set<() => void>;
}

type SettleOutcome = { state: "completed" | "failed" | "cancelled"; error?: SupervisorError };
type RequestedOutcome = { state: "failed" | "cancelled"; error?: SupervisorError };

type StartResult = {
  supervisor_version: string | null;
  run_id: string;
  state: RunState;
  backend: BackendKind;
  mode: RunMode;
  source_workspace: string;
  worker_workspace: string;
  created_at: string;
  next_action: string;
  base_ref?: string;
  error?: SupervisorError;
  result?: Record<string, unknown>;
};

const START_ENVELOPE_RESERVE_CHARS = 1500;
const STATUS_RESULT_RESERVE_CHARS = 100;
const MAX_META_BYTES = 1_048_576;
const MAX_MANIFEST_BYTES = 192 * 1024 * 1024;
const LAUNCH_MANIFEST_FILE = "launch-manifest.json";
const MAX_INLINE_TRANSCRIPT = 32_768;
const COMPACT_TRANSCRIPT_CHARS = 4000;
const COMPACT_PATCH_BYTES = 4000;
const COMPACT_DIFF_STAT_CHARS = 2000;
const COMPACT_CHANGED_FILES = 50;
const COORDINATOR_ACTION_STATES: ReadonlySet<RunState> = new Set<RunState>(["completed", "failed", "cancelled", "closed"]);
const SETTLED_RESULT_STATES: ReadonlySet<RunState> = new Set<RunState>(["completed", "failed", "cancelled"]);
const DAY_MS = 86_400_000;
const RETENTION_FIRST_DELAY_MS = 5000;
const RETENTION_INTERVAL_MS = DAY_MS;
const SHUTDOWN_DEADLINE_MS = 10_000;
const SHUTDOWN_TERMINATE_MS = 10_000;
const SHUTDOWN_START_DRAIN_MS = 180_000;
const BACKEND_RELEASE_DEADLINE_MS = 7_500;
const START_PREPARATION_DEADLINE_MS = 30_000;
const CLEANABLE_STATES: ReadonlySet<RunState> = new Set<RunState>(["failed", "cancelled", "closed"]);
const STATUS_TEXT_EVENT_TYPES: ReadonlySet<string> = new Set(["diagnostic", "review_integrity", "timeout", "permission_denied_by_policy"]);
const STATUS_TEXT_CHARS = 400;
const MAX_RETAINED_REASON_CHARS = 400;
const DEFAULT_REMEDIATION = "Inspect the run status and supervisor diagnostics, then retry if safe.";

export class RunManager {
  private readonly runRoot: string;
  private readonly backends = new Map<BackendKind, SupervisorBackend>();
  private readonly runs = new Map<string, Runtime>();
  private readonly persisted = new Map<string, RunRecord>();
  private initializePromise: Promise<void> | undefined;
  private ownerLock: OwnerLock | undefined;
  private initialized = false;
  private stopping = false;
  private activeSlots = 0;
  private readonly startPreparations = new Set<Promise<void>>();
  private retentionTimer: NodeJS.Timeout | undefined;
  private terminationRetryTimer: NodeJS.Timeout | undefined;
  private retentionRun: Promise<void> = Promise.resolve();
  private shutdownDrain: Promise<void> | undefined;
  private readonly unverifiedWorktrees = new Map<string, string>();
  private readonly unreadableRecords = new Set<string>();

  constructor(private readonly config: SupervisorConfig, private readonly dataDir: string, backends: readonly SupervisorBackend[] = [], preAcquiredLock?: OwnerLock) {
    this.ownerLock = preAcquiredLock;
    this.runRoot = path.join(path.resolve(dataDir), "runs");
    for (const backend of backends) this.backends.set(backend.kind, backend);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.stopping) throw codedError("VSUP_INVALID_STATE", "The supervisor is shutting down.");
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeInternal();
    try { await this.initializePromise; }
    catch (error) { this.initializePromise = undefined; await this.releaseOwnerLock(); throw error; }
  }

  private async initializeInternal(): Promise<void> {
    assertNotSupervisorChild();
    await createPrivateDir(this.dataDir);
    await createPrivateDir(this.runRoot);
    this.ownerLock ??= await acquireOwnerLock(this.dataDir);
    if (this.backends.size === 0) await this.loadDefaultBackends();
    const entries = await readdir(this.runRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_V4.test(entry.name)) continue;
      const directory = path.join(this.runRoot, entry.name);
      try {
        const file = path.join(directory, "meta.json");
        const info = await lstat(file);
        if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_META_BYTES) continue;
        const raw = JSON.parse(await readFile(file, "utf8")) as { backend?: unknown };
        if (raw && raw.backend === "acp") continue;
        const record = runFromWire(raw);
        if (record.runId !== entry.name || !isPathWithinRoot(this.runRoot, path.resolve(directory))) continue;
        const runtime = this.makeRuntime(record, directory, "", [], true);
        if (record.workspaceSnapshotSha256) runtime.sourceSnapshot = record.workspaceSnapshotSha256;
        if (isTerminal(record.state)) {
          this.runs.set(record.runId, runtime); this.persisted.set(record.runId, record); continue;
        }
        if (record.state === "completed") {
          const completedBackend = this.backends.get(record.backend);
          if (completedBackend) runtime.backend = completedBackend;
          this.runs.set(record.runId, runtime); continue;
        }
        const backend = this.backends.get(record.backend);
        if (backend) runtime.backend = backend;
        this.runs.set(record.runId, runtime);
        await this.settleRecovered(runtime);
        if (isTerminal(runtime.record.state)) this.persisted.set(record.runId, runtime.record);
      } catch {}
    }
    this.initialized = true;
  }

  async reviewStart(value: ReviewStartToolInput, wait?: WaitOptions): Promise<StartResult> {
    const input = parseInput(reviewStartSchema, value);
    const started = await this.start("review", input.task, input.cwd, {
      maxTurns: input.max_turns ?? this.config.limits.maxTurnsReview, timeoutSeconds: input.timeout_seconds ?? this.config.limits.reviewTimeoutSeconds,
      contextFiles: input.context_files
    });
    return this.awaitStartOutcome(started, input.wait_seconds, wait?.signal);
  }

  async editStart(value: EditStartToolInput, wait?: WaitOptions): Promise<StartResult> {
    const input = parseInput(editStartSchema, value);
    const started = await this.start("edit", input.task, input.cwd, {
      maxTurns: input.max_turns ?? this.config.limits.maxTurnsEdit, timeoutSeconds: input.timeout_seconds ?? this.config.limits.editTimeoutSeconds,
      baseRef: input.base_ref
    });
    return this.awaitStartOutcome(started, input.wait_seconds, wait?.signal);
  }

  private async awaitStartOutcome(started: StartResult, waitSeconds: number, signal?: AbortSignal): Promise<StartResult> {
    if (waitSeconds <= 0) return started;
    const runtime = this.requireRun(started.run_id);
    await this.waitUntil(runtime, () => COORDINATOR_ACTION_STATES.has(runtime.record.state), waitSeconds, signal);
    const record = runtime.record;
    const settled = SETTLED_RESULT_STATES.has(record.state);
    return {
      ...started, state: record.state, backend: record.backend, worker_workspace: record.workerWorkspace,
      next_action: this.nextAction(record, record.state),
      ...(record.error ? { error: record.error } : {}),
      ...(settled ? { result: await this.compactResult(runtime, false, START_ENVELOPE_RESERVE_CHARS) } : {})
    };
  }

  private waitUntil(runtime: Runtime, ready: () => boolean, seconds: number, signal?: AbortSignal): Promise<void> {
    if (seconds <= 0 || this.stopping || signal?.aborted || ready()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        runtime.waiters.delete(check);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const check = (): void => { if (this.stopping || ready()) finish(); };
      const timer = setTimeout(finish, seconds * 1000);
      runtime.waiters.add(check);
      signal?.addEventListener("abort", finish, { once: true });
    });
  }

  private notify(runtime: Runtime): void {
    for (const check of [...runtime.waiters]) check();
  }

  private async start(mode: RunMode, task: string, cwd: string, options: { maxTurns: number; timeoutSeconds: number; contextFiles?: string[]; baseRef?: string }): Promise<StartResult> {
    await this.ready();
    if (this.stopping) throw codedError("VSUP_INVALID_STATE", "The supervisor is shutting down.");
    if (this.activeSlots >= 1) throw codedError("VSUP_LIMIT_EXCEEDED", "One run is already active for this supervisor.");
    this.activeSlots += 1;
    let finishPreparation!: () => void;
    const preparation = new Promise<void>((resolve) => { finishPreparation = resolve; });
    this.startPreparations.add(preparation);
    const preparationDeadline = Date.now() + START_PREPARATION_DEADLINE_MS;
    let runtime: Runtime | undefined;
    try {
      const source = await withDeadline(resolveCanonicalRoot(cwd, this.config.allowedWorkspaceRoots), preparationDeadline - Date.now(), "Workspace validation exceeded its preparation deadline.");
      for (const file of options.contextFiles ?? []) await withDeadline(resolveContextFile(source, file), preparationDeadline - Date.now(), "Context validation exceeded its preparation deadline.");
      if (mode === "edit") await withDeadline(assertEditAtRepositoryRoot(source), preparationDeadline - Date.now(), "Git workspace validation exceeded its preparation deadline.");
      const id = randomUUID();
      const now = new Date().toISOString();
      const workerWorkspace = mode === "edit" ? path.join(this.dataDir, "worktrees", id) : source;
      assertSimpleGlobRoot(source);
      assertSimpleGlobRoot(workerWorkspace);
      await withDeadline(assertNoProjectVibeExtensions(source), preparationDeadline - Date.now(), "Project extension validation exceeded its preparation deadline.");
      if (this.stopping) throw codedError("VSUP_INVALID_STATE", "The supervisor is shutting down.");
      const limits: RunLimits = {
        timeoutSeconds: options.timeoutSeconds, maxTurns: options.maxTurns,
        maxEventBytes: this.config.limits.maxEventBytes,
        maxTranscriptBytes: this.config.limits.maxTranscriptBytes,
        maxArtifactBytes: this.config.limits.maxArtifactBytes
      };
      const record: RunRecord = {
        schemaVersion: SCHEMA_VERSION, supervisorVersion: APP_VERSION, runId: id,
        backend: "programmatic", mode, state: "starting", sourceWorkspace: source,
        workerWorkspace, createdAt: now, updatedAt: now,
        taskSha256: createHash("sha256").update(task).digest("hex"), limits
      };
      runtime = this.makeRuntime(record, path.join(this.runRoot, id), task, options.contextFiles ?? []);
      runtime.slot = true;
      if (mode === "edit") runtime.baseRef = options.baseRef ?? "HEAD";
      this.runs.set(id, runtime);
      await createPrivateDir(runtime.directory);
      await this.persist(runtime);
      runtime.starting = this.launch(runtime);
      runtime.starting.catch((error: unknown) => this.reportBackground(runtime, "launch", error));
      return {
        supervisor_version: runtime.record.supervisorVersion ?? null, run_id: id,
        state: runtime.record.state, backend: "programmatic", mode,
        source_workspace: source, worker_workspace: workerWorkspace, created_at: now,
        next_action: this.nextAction(runtime.record, runtime.record.state),
        ...(mode === "edit" ? { base_ref: options.baseRef ?? "HEAD" } : {})
      };
    } catch (error) {
      if (runtime) { this.runs.delete(runtime.record.runId); this.releaseSlot(runtime); await rm(runtime.directory, { recursive: true, force: true }).catch(() => undefined); }
      else this.activeSlots = Math.max(0, this.activeSlots - 1);
      throw error instanceof Error && "code" in error ? error : asStorageError(error, runtime?.directory ?? this.dataDir);
    } finally {
      this.startPreparations.delete(preparation);
      finishPreparation();
    }
  }

  async status(value: StatusToolInput, wait?: WaitOptions): Promise<Record<string, unknown>> {
    const input = parseInput(statusSchema, value); const runtime = this.requireRun(input.run_id);
    await this.ensureLoaded(runtime);
    this.assertLogReadable(runtime);
    if (runtime.storageDegraded) await this.flushQuietly(runtime);
    const initialState = runtime.record.state;
    await this.waitUntil(runtime, () => runtime.eventSeq > input.after_seq || runtime.record.state !== initialState || COORDINATOR_ACTION_STATES.has(runtime.record.state), input.wait_seconds, wait?.signal);
    const events = runtime.events.filter((event) => event.seq > input.after_seq).slice(0, input.max_events).map((event) => ({
      seq: event.seq, type: event.type,
      ...statusText(event),
      ...(typeof event.data.title === "string" ? { title: event.data.title } : {}),
      ...(typeof event.data.kind === "string" ? { kind: event.data.kind } : {}),
      ...(typeof event.data.status === "string" ? { status: event.data.status } : {})
    }));
    const nextAfterSeq = events.at(-1)?.seq ?? input.after_seq;
    const body = {
      supervisor_version: runtime.record.supervisorVersion ?? null, run_id: runtime.record.runId, state: runtime.record.state, backend: runtime.record.backend,
      last_seq: runtime.eventSeq, next_after_seq: nextAfterSeq, events,
      next_action: this.nextAction(runtime.record, runtime.record.state, nextAfterSeq),
      ...(runtime.record.error ? { error: runtime.record.error } : {}),
      ...(runtime.storageDegraded ? { warnings: [`Run state could not be saved (${runtime.storageDegraded.code} in ${runtime.storageDegraded.directory}); progress recorded since may be lost if the supervisor restarts.`] } : {})
    };
    if (!SETTLED_RESULT_STATES.has(runtime.record.state)) return body;
    return { ...body, result: await this.compactResult(runtime, false, JSON.stringify(body).length + STATUS_RESULT_RESERVE_CHARS) };
  }

  async result(value: ResultToolInput): Promise<Record<string, unknown>> {
    const input = parseInput(resultSchema, value); const runtime = this.requireRun(input.run_id); const record = runtime.record;
    await this.ensureLoaded(runtime);
    this.assertLogReadable(runtime);
    await this.flushQuietly(runtime);
    const result = record.result;
    if (input.detail === "compact") return this.compactResult(runtime, input.include_transcript);
    const next_action = this.nextAction(record, record.state);
    if (!result) return { supervisor_version: record.supervisorVersion ?? null, run_id: record.runId, state: record.state, backend: record.backend, summary: "Run has not produced a result yet.", artifacts: [], changed_files: [], warnings: [], ...(record.error ? { error: record.error } : {}), next_action };
    const output: Record<string, unknown> = {
      schema_version: 1, supervisor_version: record.supervisorVersion ?? null, run_id: record.runId, state: record.state, backend: record.backend,
      ...(result.stopReason ? { stop_reason: result.stopReason } : {}),
      summary: result.summary ?? "",
      workspace: { source: record.sourceWorkspace, worker: record.workerWorkspace },
      artifacts: (result.artifacts ?? []).map(artifactToWire),
      changed_files: result.changedFiles ?? [], ...(record.usage ? { usage: usageToWire(record.usage) } : {}), warnings: result.warnings ?? [], ...(result.integrity ? { integrity: integrityToWire(result.integrity) } : {}), ...(record.error ? { error: record.error } : {}),
      next_action
    };
    if (input.include_transcript) {
      const transcriptPath = path.join(runtime.directory, "transcript.md");
      try {
        const info = await lstat(transcriptPath);
        if (info.isFile() && !info.isSymbolicLink() && info.size <= MAX_INLINE_TRANSCRIPT) output.transcript = await readFile(transcriptPath, "utf8");
      } catch {}
    }
    return output;
  }

  /** Internal cancellation used by close and lifecycle coordinators; MCP exposes only close. */
  async cancel(value: { run_id: string }): Promise<Record<string, unknown>> {
    const runtime = this.requireRun(value.run_id);
    if (isTerminal(runtime.record.state) || runtime.record.state === "completed" || runtime.record.state === "closing") {
      return { run_id: value.run_id, state: runtime.record.state, next_action: this.nextAction(runtime.record, runtime.record.state) };
    }
    runtime.cancelRequested = true;
    const outcome = this.requestOutcome(runtime, { state: "cancelled" });
    await this.cancelBackendSession(runtime);
    await this.serial(runtime, () => this.settle(runtime, outcome));
    return { run_id: value.run_id, state: runtime.record.state, next_action: this.nextAction(runtime.record, runtime.record.state) };
  }

  private async compactResult(runtime: Runtime, includeTranscript: boolean, reserveChars = 0): Promise<Record<string, unknown>> {
    const record = runtime.record; const result = record.result;
    const output: Record<string, unknown> = { supervisor_version: record.supervisorVersion ?? null, run_id: record.runId, state: record.state, backend: record.backend };
    if (!result) {
      output.summary = "Run has not produced a result yet.";
      output.warnings = [];
      if (record.error) output.error = record.error;
      output.next_action = this.nextAction(record, record.state);
      return output;
    }
    const artifacts = result.artifacts ?? []; const files = result.changedFiles ?? [];
    if (result.stopReason) output.stop_reason = result.stopReason;
    output.summary = result.summary ?? "";
    output.warnings = result.warnings ?? [];
    output.next_action = this.nextAction(record, record.state);
    if (result.integrity) output.integrity = integrityToWire(result.integrity);
    if (record.error) output.error = record.error;
    if (record.mode === "edit") output.worker = record.workerWorkspace;
    output.changed_files = files.slice(0, COMPACT_CHANGED_FILES);
    output.changed_files_total = files.length;
    const stat = artifacts.find((artifact) => artifact.name === "diff.stat");
    const statText = stat ? await this.readArtifactText(runtime, stat.path, MAX_META_BYTES) : undefined;
    if (statText) output.diff_stat = statText.slice(0, COMPACT_DIFF_STAT_CHARS);
    output.artifacts = artifacts.map((artifact) => ({ name: artifact.name, path: artifact.path }));
    if (includeTranscript) {
      const transcriptPath = path.join(runtime.directory, "transcript.md");
      const text = await this.readArtifactText(runtime, transcriptPath, record.limits.maxTranscriptBytes);
      if (text !== undefined) {
        output.transcript = text.length > COMPACT_TRANSCRIPT_CHARS ? text.slice(-COMPACT_TRANSCRIPT_CHARS) : text;
        if (text.length > COMPACT_TRANSCRIPT_CHARS) output.transcript_truncated = true;
        output.transcript_path = transcriptPath;
      }
    }
    const patch = artifacts.find((artifact) => artifact.name === "diff.patch");
    if (patch && patch.bytes > 0) {
      const patchText = patch.bytes <= COMPACT_PATCH_BYTES ? await this.readArtifactText(runtime, patch.path, COMPACT_PATCH_BYTES) : undefined;
      const patchCost = patchText === undefined ? Infinity : JSON.stringify(patchText).length + '"patch":,'.length;
      if (patchText !== undefined && JSON.stringify(output).length + patchCost + reserveChars <= this.config.limits.maxMcpResultChars) output.patch = patchText;
      else { output.patch_path = patch.path; output.patch_bytes = patch.bytes; }
    }
    return output;
  }

  private async readArtifactText(runtime: Runtime, file: string, maxBytes: number): Promise<string | undefined> {
    try {
      const resolved = path.resolve(file);
      if (!isPathWithinRoot(runtime.directory, resolved)) return undefined;
      const info = await lstat(resolved);
      if (info.isSymbolicLink() || !info.isFile() || info.size > maxBytes) return undefined;
      return await readFile(resolved, "utf8");
    } catch { return undefined; }
  }

  async close(value: CloseToolInput): Promise<Record<string, unknown>> {
    const input = parseInput(closeSchema, value); const runtime = this.requireRun(input.run_id);
    const next = runtime.closeChain.then(() => this.closeRun(runtime, input.cleanup_worktree === true));
    runtime.closeChain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async closeRun(runtime: Runtime, cleanupWanted: boolean): Promise<Record<string, unknown>> {
    const record = runtime.record;
    if (record.state === "closed") return this.closeOutcome(runtime, cleanupWanted ? await this.cleanupWorktree(runtime) : { removed: false });
    this.clearProgress(runtime);
    if (!isTerminal(record.state)) {
      runtime.cancelRequested = true;
      try { await this.cancelBackendSession(runtime); }
      catch (error) { return this.unverifiedWorkerOutcome(runtime, error); }
      await this.serial(runtime, () => this.settle(runtime, { state: "cancelled" }));
    }
    try { await this.releaseSession(runtime); }
    catch (error) { return this.unverifiedWorkerOutcome(runtime, error); }
    if (!runtime.handle) this.releaseSlot(runtime);
    await this.setState(runtime, "closing");
    let failure: unknown;
    let cleanup: WorktreeCleanup = { removed: false };
    try {
      const handle = runtime.handle;
      if (handle && runtime.backend) await runtime.backend.close(handle);
      if (handle) delete runtime.handle;
    } catch (error) { failure = error; }
    try { if (cleanupWanted) cleanup = await this.cleanupWorktree(runtime); }
    catch (error) { failure ??= error; }
    if (cleanup.reason) await this.serial(runtime, () => this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "worktree_retained", message: cleanup.reason } }, true)).catch(() => undefined);
    if (failure !== undefined) await this.serial(runtime, () => this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "close_failed", message: describeFailure(failure) } }, true)).catch(() => undefined);
    try { await this.setState(runtime, "closed", { finishedAt: record.finishedAt ?? new Date().toISOString() }); }
    catch (error) {
      failure ??= error;
      const now = new Date().toISOString();
      record.state = "closed"; record.updatedAt = now; record.finishedAt ??= now;
      this.persisted.set(record.runId, record);
      this.notify(runtime);
    }
    return { ...this.closeOutcome(runtime, cleanup), ...(failure === undefined ? {} : { error: normalizeError(failure) }) };
  }

  private unverifiedWorkerOutcome(runtime: Runtime, cause: unknown): Record<string, unknown> {
    const error = supervisorError("VSUP_BACKEND_ERROR", "Worker termination could not be verified. The run remains active and its slot, handle, workspace and owner lock are retained so the owned handle can be retried safely.");
    this.reportBackground(runtime, "worker-termination-unverified", cause);
    return { ...this.closeOutcome(runtime, { removed: false }), state: runtime.record.state, worker_termination_unverified: true, error };
  }

  private closeOutcome(runtime: Runtime, cleanup: WorktreeCleanup): Record<string, unknown> {
    const retainedPath = runtime.record.worktree ? path.resolve(runtime.record.worktree.path) : undefined;
    const retainedReason = cleanup.reason ?? (retainedPath && !cleanup.removed ? "Worktree retained because verified cleanup was not requested." : undefined);
    return { supervisor_version: runtime.record.supervisorVersion ?? null, run_id: runtime.record.runId, state: runtime.record.state, next_action: this.nextAction(runtime.record, runtime.record.state), worktree_removed: cleanup.removed, ...(retainedReason ? { worktree_retained_reason: retainedReason } : {}), ...(retainedPath && !cleanup.removed ? { worktree_retained_path: retainedPath } : {}) };
  }

  async runsList(): Promise<Record<string, unknown>[]> {
    await this.ready();
    return [...this.runs.values()].map((runtime) => ({
      run_id: runtime.record.runId, mode: runtime.record.mode, backend: runtime.record.backend,
      state: runtime.record.state, created_at: runtime.record.createdAt, updated_at: runtime.record.updatedAt,
      source_workspace: runtime.record.sourceWorkspace, worker_workspace: runtime.record.workerWorkspace
    })).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  async cleanup(runId?: string): Promise<Record<string, unknown>> {
    await this.ready();
    if (runId) {
      const runtime = this.requireRun(runId);
      if (!CLEANABLE_STATES.has(runtime.record.state)) return { run_id: runId, worktree_removed: false, worktree_retained_reason: `The run is ${runtime.record.state}; only the worktree of a failed, cancelled or closed run can be removed. Close the run first.` };
      const cleanup = await this.cleanupWorktree(runtime);
      return { run_id: runId, worktree_removed: cleanup.removed, ...(cleanup.reason ? { worktree_retained_reason: cleanup.reason, ...(runtime.record.worktree ? { worktree_retained_path: path.resolve(runtime.record.worktree.path) } : {}) } : {}) };
    }
    const removed = await this.pruneRuns(false);
    const unverified = [...this.unverifiedWorktrees].map(([run_id, worktreePath]) => ({ run_id, path: worktreePath }));
    return { removed_run_ids: removed, ...(unverified.length ? { unverified_worktrees: unverified } : {}) };
  }

  startAutomaticRetention(options: { firstDelayMs?: number; intervalMs?: number } = {}): void {
    if (this.retentionTimer || this.stopping) return;
    const firstDelay = options.firstDelayMs ?? RETENTION_FIRST_DELAY_MS;
    const interval = options.intervalMs ?? RETENTION_INTERVAL_MS;
    const schedule = (delay: number): void => {
      if (this.stopping) return;
      this.retentionTimer = setTimeout(() => {
        this.retentionTimer = undefined;
        this.retentionRun = this.pruneRuns(true, (error) => reportBackgroundFailure("retention", error))
          .then(() => undefined, (error: unknown) => reportBackgroundFailure("retention", error))
          .then(() => schedule(interval));
      }, delay);
      this.retentionTimer.unref?.();
    };
    this.ready().then(() => schedule(firstDelay), () => undefined);
  }

  private async pruneRuns(closeCompleted: boolean, onError?: (error: unknown) => void): Promise<string[]> {
    const cutoff = Date.now() - this.config.retention.days * DAY_MS;
    const removed: string[] = [];
    for (const runtime of [...this.runs.values()]) {
      if (this.stopping && closeCompleted) break;
      try { if (await this.pruneRun(runtime, cutoff, closeCompleted)) removed.push(runtime.record.runId); }
      catch (error) { if (!onError) throw error; onError(error); }
    }
    if (!(this.stopping && closeCompleted)) {
      try { removed.push(...await this.pruneUnloadedRuns(cutoff)); }
      catch (error) { if (!onError) throw error; onError(error); }
    }
    return removed;
  }

  private async pruneUnloadedRuns(cutoff: number): Promise<string[]> {
    const removed: string[] = [];
    const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
    for (const entry of await readdir(this.runRoot, { withFileTypes: true })) {
      if (this.stopping) break;
      if (!entry.isDirectory() || !UUID_V4.test(entry.name) || this.runs.has(entry.name)) continue;
      const directory = path.join(this.runRoot, entry.name);
      const info = await lstat(directory).catch(() => undefined);
      if (!info || info.isSymbolicLink() || !info.isDirectory() || (owner !== undefined && info.uid !== owner) || (info.mode & 0o077) !== 0) continue;
      if (info.mtimeMs > cutoff) continue;
      if (!await isDiscardableRecord(path.join(directory, "meta.json"))) {
        if (!this.unreadableRecords.has(entry.name)) writeDiagnostic(`run ${entry.name} has a record this release cannot load; it was left in place`);
        this.unreadableRecords.add(entry.name);
        continue;
      }
      const worktree = path.join(this.dataDir, "worktrees", entry.name);
      const owned = await lstat(worktree).then(() => true, (error: NodeJS.ErrnoException) => error.code !== "ENOENT");
      if (owned) {
        if (!this.unverifiedWorktrees.has(entry.name)) writeDiagnostic(`run ${entry.name} has an unreadable record and still owns the worktree ${worktree}; it was left in place and must be removed manually`);
        this.unverifiedWorktrees.set(entry.name, worktree);
        continue;
      }
      this.unverifiedWorktrees.delete(entry.name);
      await rm(directory, { recursive: true, force: false });
      removed.push(entry.name);
    }
    for (const runId of [...this.unverifiedWorktrees.keys()]) {
      if (!await lstat(path.join(this.dataDir, "worktrees", runId)).then(() => true, () => false)) this.unverifiedWorktrees.delete(runId);
    }
    return removed;
  }

  private async pruneRun(runtime: Runtime, cutoff: number, closeCompleted: boolean): Promise<boolean> {
    const record = runtime.record;
    const completed = record.state === "completed";
    if (!isTerminal(record.state) && !(closeCompleted && completed)) return false;
    if (runtime.slot || runtime.handle) return false;
    // A saved worktree reference must pass the same ownership checks as explicit
    // cleanup. Retention never treats a missing or redirected path as safe to forget.
    if (record.worktree) return false;
    const expectedWorktree = path.join(path.resolve(this.dataDir), "worktrees", record.runId);
    const expectedPathExists = await lstat(expectedWorktree).then(() => true, (error: NodeJS.ErrnoException) => error.code !== "ENOENT");
    if (expectedPathExists) return false;
    const completedCutoff = Math.min(cutoff, Date.now() - DAY_MS);
    if (Date.parse(record.updatedAt) > (completed ? completedCutoff : cutoff) || record.worktree) return false;
    if (record.state === "failed") return false;
    if (completed) {
      await this.close({ run_id: record.runId });
      if (!isTerminal(record.state) || record.worktree) return false;
    }
    runtime.eventLog?.dispose();
    await rm(runtime.directory, { recursive: true, force: false });
    this.runs.delete(record.runId); this.persisted.delete(record.runId);
    return true;
  }

  async shutdown(deadlineMs = SHUTDOWN_DEADLINE_MS): Promise<{ timedOut: boolean; terminationUnverified?: boolean }> {
    const graceful = this.shutdownGracefully();
    graceful.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<"expired">((resolve) => { timer = setTimeout(() => resolve("expired"), deadlineMs); });
    try {
      const winner = await Promise.race([graceful.then(() => "done" as const, () => "failed" as const), expired]);
      if (winner === "done") {
        const terminationUnverified = [...this.runs.values()].some((runtime) => runtime.slot || Boolean(runtime.handle));
        if (terminationUnverified) this.scheduleTerminationRetry();
        return { timedOut: false, ...(terminationUnverified ? { terminationUnverified: true } : {}) };
      }
    } finally { if (timer) clearTimeout(timer); }
    writeDiagnostic(`shutdown exceeded ${deadlineMs} ms; terminating owned workers and waiting for bounded start and cleanup work before releasing the storage lock`);
    await this.terminateOwnedWorkers();
    // Keep the owner lock until every start operation that can still persist
    // state or finish creating a worktree has reached its bounded disposition.
    const pendingStarts = Promise.all([
      ...(this.initializePromise ? [this.initializePromise] : []),
      ...this.startPreparations,
      ...[...this.runs.values()].map((runtime) => runtime.starting).filter((starting): starting is Promise<unknown> => Boolean(starting))
    ].map((pending) => Promise.resolve(pending).catch(() => undefined)));
    if (!await settlesWithin(pendingStarts, SHUTDOWN_START_DRAIN_MS)) {
      writeDiagnostic("shutdown could not verify that start or Git worktree creation has stopped; the owner lock remains held");
      return { timedOut: true };
    }
    const gracefulFinished = await settlesWithin(graceful, SHUTDOWN_TERMINATE_MS + BACKEND_RELEASE_DEADLINE_MS);
    if (!gracefulFinished) writeDiagnostic("shutdown cleanup is still waiting on storage; the owner lock remains held until those writes finish");
    const terminationUnverified = [...this.runs.values()].some((runtime) => runtime.slot || Boolean(runtime.handle));
    if (terminationUnverified) this.scheduleTerminationRetry();
    // The CLI may exit immediately for a timed-out shutdown. Keep it alive when
    // owned workers remain unverified so its retry timer and owner lock survive.
    return { timedOut: !terminationUnverified, ...(terminationUnverified ? { terminationUnverified: true } : {}) };
  }

  private scheduleTerminationRetry(): void {
    if (this.terminationRetryTimer) return;
    this.terminationRetryTimer = setInterval(() => {
      void this.shutdownGracefully().then(() => {
        if (![...this.runs.values()].some((runtime) => runtime.slot || Boolean(runtime.handle))) {
          if (this.terminationRetryTimer) clearInterval(this.terminationRetryTimer);
          this.terminationRetryTimer = undefined;
        }
      }).catch((error: unknown) => writeDiagnostic(`shutdown retry retained the owner lock: ${describeFailure(error)}`));
    }, 1000);
  }

  private async terminateOwnedWorkers(): Promise<void> {
    const terminations = [...this.runs.values()].flatMap((runtime) => {
      const backend = runtime.backend; const handle = runtime.handle;
      if (runtime.timer) clearTimeout(runtime.timer);
      if (runtime.progressTimer) clearTimeout(runtime.progressTimer);
      if (!backend || !handle) return [];
      return [Promise.resolve().then(() => (backend.terminateNow ? backend.terminateNow(handle) : backend.cancel(handle)))];
    });
    let timer: NodeJS.Timeout | undefined;
    const cap = new Promise<void>((resolve) => { timer = setTimeout(resolve, SHUTDOWN_TERMINATE_MS); });
    try { await Promise.race([Promise.allSettled(terminations), cap]); } finally { if (timer) clearTimeout(timer); }
  }

  private shutdownGracefully(): Promise<void> {
    if (this.shutdownDrain) return this.shutdownDrain;
    const wrapped = this.performShutdownGracefully().finally(() => { this.shutdownDrain = undefined; });
    this.shutdownDrain = wrapped;
    return wrapped;
  }

  private async performShutdownGracefully(): Promise<void> {
    this.stopping = true;
    if (this.retentionTimer) clearTimeout(this.retentionTimer);
    this.retentionTimer = undefined;
    await this.initializePromise?.catch(() => undefined);
    await Promise.all([...this.startPreparations]);
    await this.retentionRun;
    for (const runtime of this.runs.values()) this.notify(runtime);
    const active = [...this.runs.values()].filter((runtime) => runtime.slot || Boolean(runtime.handle));
    await Promise.all(active.map(async (runtime) => {
      await runtime.serial;
      runtime.cancelRequested = true;
      try { await this.cancelBackendSession(runtime, BACKEND_RELEASE_DEADLINE_MS); }
      catch (error) { this.reportBackground(runtime, "shutdown-termination-unverified", error); return; }
      if (!isTerminal(runtime.record.state) && runtime.record.state !== "completed") await this.serial(runtime, () => this.settle(runtime, { state: "failed", error: supervisorError("VSUP_BACKEND_CRASHED", "The supervisor shut down before this one-shot run completed; the task will not be resumed or replayed.") })).catch(() => undefined);
      try { await this.releaseSession(runtime); }
      catch (error) { this.reportBackground(runtime, "shutdown-close-unverified", error); return; }
      if (runtime.timer) clearTimeout(runtime.timer);
      if (runtime.progressTimer) clearTimeout(runtime.progressTimer);
      if (!runtime.handle) this.releaseSlot(runtime);
    }));
    if ([...this.runs.values()].some((runtime) => runtime.slot || Boolean(runtime.handle))) return;
    await Promise.all([...this.runs.values()].map(async (runtime) => {
      try { await runtime.eventLog?.flush(); } catch (error) { this.noteEventFailure(runtime, error); }
      runtime.eventLog?.dispose();
    }));
    await Promise.all([...this.runs.values()].map((runtime) => runtime.manifestWrite));
    await this.releaseOwnerLock();
  }

  private ensureLoaded(runtime: Runtime): Promise<void> {
    runtime.loading ??= this.loadRuntime(runtime).catch((error: unknown) => { runtime.loading = undefined; throw error; });
    return runtime.loading;
  }

  private async loadRuntime(runtime: Runtime): Promise<void> {
    const record = runtime.record;
    const eventsPath = path.join(runtime.directory, "events.ndjson");
    let events: SupervisorEvent[] = [];
    try {
      const wireEvents = await readNdjsonRecovering<unknown>(eventsPath, { maxBytes: record.limits.maxEventBytes, truncatePartial: true });
      events = wireEvents.map(eventFromWire).filter((event, index) => event.runId === record.runId && event.seq === index + 1);
    } catch (error) { runtime.logUnavailable = describeUnreadableLog(error); }
    let transcript = "";
    try {
      const transcriptPath = path.join(runtime.directory, "transcript.md");
      const transcriptInfo = await lstat(transcriptPath);
      if (transcriptInfo.isFile() && !transcriptInfo.isSymbolicLink() && transcriptInfo.size <= record.limits.maxTranscriptBytes) transcript = await readFile(transcriptPath, "utf8");
    } catch {}
    const eventBytes = runtime.logUnavailable ? 0 : await lstat(eventsPath).then((info) => info.size, () => 0);
    runtime.events = events; runtime.eventSeq = events.at(-1)?.seq ?? 0; runtime.eventBytes = eventBytes; runtime.transcript = transcript;
  }

  private assertLogReadable(runtime: Runtime): void {
    const unavailable = runtime.logUnavailable;
    if (!unavailable) return;
    const message = `The event log of this run cannot be read (${unavailable.reason}); the file was left untouched. Close the run to discard it.`;
    if (unavailable.kind === "filesystem") throw codedError("VSUP_STORAGE_ERROR", message, { code: unavailable.code ?? "UNKNOWN", directory: runtime.directory });
    throw codedError("VSUP_ARTIFACT_ERROR", message);
  }

  private logFor(runtime: Runtime): EventLog {
    runtime.eventLog ??= new EventLog(path.join(runtime.directory, "events.ndjson"), {
      maxBytes: runtime.record.limits.maxEventBytes, initialBytes: runtime.eventBytes,
      onFailure: (error) => this.noteEventFailure(runtime, error),
      onFlushed: () => this.noteStorageSuccess(runtime, "event")
    });
    return runtime.eventLog;
  }

  private async flushQuietly(runtime: Runtime): Promise<void> {
    try { await runtime.eventLog?.flush(); } catch (error) { this.noteEventFailure(runtime, error); }
  }

  private async ready(): Promise<void> { if (!this.initialized) await this.initialize(); }

  private async releaseOwnerLock(): Promise<void> {
    const lock = this.ownerLock;
    this.ownerLock = undefined;
    await lock?.release();
  }

  private makeRuntime(record: RunRecord, directory: string, task: string, contextFiles: string[], lazy = false): Runtime {
    return { record, directory, task, contextFiles, events: [], eventSeq: 0, eventBytes: 0, ...(lazy ? {} : { loading: Promise.resolve() }), transcript: "", serial: Promise.resolve(), slot: false, cancelRequested: false, started: false, closedHandles: new Set(), transcriptOverflow: false, persistChain: Promise.resolve(), closeChain: Promise.resolve(), waiters: new Set() };
  }

  private async loadDefaultBackends(): Promise<void> {
    const { ProgrammaticBackend } = await import("../backends/programmatic.js");
    this.backends.set("programmatic", new ProgrammaticBackend(this.config));
  }

  private async launch(runtime: Runtime): Promise<void> {
    if (this.stopping || runtime.cancelRequested || isTerminal(runtime.record.state)) { this.releaseSlot(runtime); return; }
    runtime.record.launchedAt = new Date().toISOString();
    this.armDeadline(runtime, runtime.record.limits.timeoutSeconds * 1000);
    let snapshotTask: Promise<void> | undefined;
    try {
      let workerWorkspace = runtime.record.sourceWorkspace;
      let baseRef: string | undefined;
      if (runtime.record.mode !== "edit") snapshotTask = this.captureLaunchSnapshot(runtime);
      if (runtime.record.mode === "edit") {
        const worktree = await createDetachedWorktree(runtime.record.sourceWorkspace, runtime.record.workerWorkspace, runtime.baseRef ?? "HEAD");
        runtime.record.worktree = worktree; runtime.record.workerWorkspace = worktree.path; workerWorkspace = worktree.path; baseRef = worktree.baseRef;
        await this.persist(runtime);
      }
      if (runtime.cancelRequested || isTerminal(runtime.record.state)) return;
      const backend = this.backends.get("programmatic");
      if (!backend) throw codedError("VSUP_BACKEND_CRASHED", "The programmatic backend is unavailable.");
      runtime.backend = backend;
      await snapshotTask;
      if (snapshotTask) await this.persist(runtime);
      if (runtime.cancelRequested || isTerminal(runtime.record.state)) return;
      const contextFiles = runtime.contextFiles.map((file) => path.resolve(runtime.record.sourceWorkspace, file));
      const limits = runtime.record.limits;
      const input = {
        runId: runtime.record.runId, mode: runtime.record.mode, task: runtime.task,
        cwd: runtime.record.sourceWorkspace, workerWorkspace, runDirectory: runtime.directory,
        ...(baseRef ? { baseRef } : {}), ...(contextFiles.length ? { contextFiles } : {}),
        limits
      };
      if (runtime.cancelRequested || isTerminal(runtime.record.state)) return;
      const result = await backend.start(input, this.callbacks(runtime));
      if (runtime.cancelRequested || isTerminal(runtime.record.state) || runtime.record.state === "closing" || SETTLED_RESULT_STATES.has(runtime.record.state)) {
        runtime.handle ??= result.handle;
        if (runtime.record.state !== "completed") await this.cancelBackendSession(runtime, BACKEND_RELEASE_DEADLINE_MS, false);
        await this.releaseSession(runtime);
        if (!runtime.handle) this.releaseSlot(runtime);
        return;
      }
      runtime.handle = result.handle;
      if (result.process) runtime.record.process = result.process;
      runtime.started = true;
      if (runtime.cancelRequested || runtime.record.state === "cancelled" || SETTLED_RESULT_STATES.has(runtime.record.state)) {
        if (runtime.record.state !== "completed") await this.cancelBackendSession(runtime, BACKEND_RELEASE_DEADLINE_MS, false);
        await this.releaseSession(runtime);
        if (!runtime.handle) this.releaseSlot(runtime);
        return;
      }
      if (!isTerminal(runtime.record.state) && runtime.record.state === "starting") await this.setState(runtime, "running", { startedAt: runtime.record.startedAt ?? new Date().toISOString() });
    } catch (error) {
      await snapshotTask;
      if (runtime.cancelRequested || runtime.record.state === "cancelled") return;
      const outcome: SettleOutcome = { state: "failed", error: normalizeError(error) };
      await this.serial(runtime, async () => {
        await this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "error", data: { reason: "launch_failed", message: describeFailure(error) } }).catch(() => undefined);
        await this.settle(runtime, outcome);
      });
    }
  }

  private async captureLaunchSnapshot(runtime: Runtime): Promise<void> {
    try {
      const snapshot = await snapshotWorkspace(runtime.record.sourceWorkspace);
      runtime.sourceSnapshot = snapshot.sha256; runtime.sourceManifest = snapshot.manifest;
      runtime.record.workspaceSnapshotSha256 = snapshot.sha256;
      runtime.manifestWrite = this.atomicWriteText(path.join(runtime.directory, LAUNCH_MANIFEST_FILE), serializeManifest(snapshot)).catch((error: unknown) => reportBackgroundFailure("launch-manifest", error));
    } catch {
      delete runtime.sourceSnapshot; delete runtime.sourceManifest; delete runtime.record.workspaceSnapshotSha256;
      runtime.snapshotFailed = true;
    }
  }

  private callbacks(runtime: Runtime): BackendCallbacks {
    return {
      onEvent: (event) => {
        if (this.stopping) return undefined;
        if (event.source === "vibe") this.noteActivity(runtime, `vibe:${String(event.type).slice(0, 64)}`);
        return this.serial(runtime, async () => this.appendEvent(runtime, event)).catch((error: unknown) => this.noteEventFailure(runtime, error));
      },
      onActivity: (kind) => { this.noteActivity(runtime, kind); },
      onSpawn: (handle) => {
        if (runtime.cancelRequested || isTerminal(runtime.record.state) || runtime.record.state === "closing" || SETTLED_RESULT_STATES.has(runtime.record.state)) {
          // Keep the live handle attached. launch() owns cancellation after start() resolves.
          runtime.handle ??= handle;
          return;
        }
        runtime.handle ??= handle;
      },
      onState: (state, update) => {
        if (this.stopping) return undefined;
        if (state === "running") this.noteActivity(runtime, `state:${state}`);
        else this.clearProgress(runtime);
        return this.serial(runtime, async () => this.applyBackendState(runtime, state, update)).catch((error: unknown) => this.recordIgnoredTransition(runtime, state, error));
      }
    };
  }

  private async recordIgnoredTransition(runtime: Runtime, reportedState: RunState, error: unknown): Promise<void> {
    if ((error as { code?: unknown } | null)?.code !== "VSUP_INVALID_STATE") throw error;
    const message = redactSecrets(error instanceof Error ? error.message : "Invalid run state transition.").slice(0, 512);
    await this.serial(runtime, async () => this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "ignored_backend_state_transition", backend_state: reportedState, run_state: runtime.record.state, message } }, true)).catch(() => undefined);
  }

  private async appendEvent(runtime: Runtime, event: Parameters<BackendCallbacks["onEvent"]>[0], allowTerminal = false): Promise<void> {
    if (isTerminal(runtime.record.state) && !allowTerminal) return;
    await this.ensureLoaded(runtime);
    if (runtime.logUnavailable || (isTerminal(runtime.record.state) && !allowTerminal)) return;
    const type = redactSecrets(String(event.type).slice(0, 128));
    let data = event.data ?? {};
    if (/reasoning|thought/i.test(type)) {
      const omitted = Buffer.byteLength(JSON.stringify(data));
      data = { present: true, bytes_omitted: omitted };
    } else {
      data = sanitizeForPersistence(data) as Record<string, unknown>;
      if (type === "agent_message" || type === "assistant_message" || type === "message") {
        const text = typeof data.text === "string" ? data.text : "";
        if (text && !this.appendTranscript(runtime, text)) {
          runtime.transcriptOverflow = true;
          queueMicrotask(() => { this.fail(runtime, supervisorError("VSUP_OUTPUT_LIMIT", "The transcript reached its configured byte limit.")).catch((failure: unknown) => this.reportBackground(runtime, "output-limit", failure)); });
        }
      }
    }
    const full: SupervisorEvent = {
      schemaVersion: SCHEMA_VERSION,
      seq: runtime.eventSeq + 1,
      timestamp: new Date().toISOString(),
      runId: runtime.record.runId,
      backend: runtime.record.backend,
      source: event.source,
      type,
      severity: event.severity,
      data
    };
    try { if (!this.logFor(runtime).append(eventToWire(full))) return; }
    catch (error) {
      if (error instanceof RangeError) {
        runtime.cancelRequested = true;
        queueMicrotask(() => { this.fail(runtime, supervisorError("VSUP_OUTPUT_LIMIT", "The event log reached its configured byte limit.")).catch((failure: unknown) => this.reportBackground(runtime, "output-limit", failure)); });
        return;
      }
      throw asStorageError(error, runtime.directory, { eventLog: true });
    }
    runtime.events.push(full); runtime.eventSeq = full.seq;
    this.notify(runtime);
  }

  private endTranscriptTurn(runtime: Runtime): void {
    if (runtime.transcript && !runtime.transcript.endsWith("\n")) runtime.transcript += "\n";
  }

  private appendTranscript(runtime: Runtime, text: string): boolean {
    const safe = String(text);
    const next = `${runtime.transcript}${safe}`;
    if (Buffer.byteLength(next) > runtime.record.limits.maxTranscriptBytes) return false;
    runtime.transcript = next;
    return true;
  }

  private async applyBackendState(runtime: Runtime, state: RunState, update?: Partial<Pick<RunRecord, "usage" | "result" | "error" | "process">>): Promise<void> {
    if (isTerminal(runtime.record.state) || runtime.record.state === "closing") return;
    const outcome = this.reportedOutcome(runtime, state, update?.error);
    if (outcome && runtime.record.state === "completed") { await this.settle(runtime, outcome); return; }
    if (update?.usage) runtime.record.usage = update.usage;
    if (update?.result) runtime.record.result = update.result;
    if (update?.process) runtime.record.process = update.process;
    if (outcome) { await this.settle(runtime, outcome); return; }
    await this.setState(runtime, state, update);
  }

  private reportedOutcome(runtime: Runtime, state: RunState, error: SupervisorError | undefined): SettleOutcome | undefined {
    if (state !== "completed" && state !== "failed" && state !== "cancelled") return undefined;
    if (runtime.requestedOutcome) return runtime.requestedOutcome;
    if (state === "completed") return { state };
    if (state === "failed" && error?.code === "VSUP_BACKEND_CRASHED" && runtime.deadlineAt !== undefined && Date.now() >= runtime.deadlineAt) {
      return { state, error: supervisorError("VSUP_TIMEOUT", "The run exceeded its configured timeout.") };
    }
    return state === "failed" && error ? { state, error } : { state };
  }

  private requestOutcome(runtime: Runtime, outcome: RequestedOutcome): RequestedOutcome {
    runtime.cancelRequested = true;
    runtime.requestedOutcome ??= outcome;
    this.clearProgress(runtime);
    return runtime.requestedOutcome;
  }

  private async cancelBackendSession(runtime: Runtime, deadlineMs = BACKEND_RELEASE_DEADLINE_MS, waitForStartup = true): Promise<void> {
    const backend = runtime.backend; const handle = runtime.handle;
    if (backend && handle) {
      const cancellation = Promise.resolve().then(() => backend.cancel(handle));
      if (!await settlesWithin(cancellation, deadlineMs)) {
        this.reportBackground(runtime, "backend-cancel", new Error("Worker cancellation exceeded its shutdown deadline."));
        const terminateNow = backend.terminateNow;
        if (terminateNow) {
          const emergencyTermination = Promise.resolve().then(() => terminateNow.call(backend, handle));
          if (!await settlesWithin(emergencyTermination, SHUTDOWN_TERMINATE_MS)) throw new Error("Owned worker termination exceeded its bounded deadline; termination remains unverified.");
          await emergencyTermination;
        } else throw new Error("Owned worker cancellation exceeded its bounded deadline; termination remains unverified.");
      } else {
        await cancellation;
      }
    }
    if (waitForStartup) await runtime.starting;
  }

  private async settle(runtime: Runtime, requested: SettleOutcome): Promise<void> {
    const current = runtime.record.state;
    if (isTerminal(current) || current === "closing") return;
    if (current === "completed") return;
    let outcome = requested;
    try {
      await this.ensureLoaded(runtime);
      this.endTranscriptTurn(runtime);
      if (outcome.error) runtime.record.error = outcome.error;
      await this.assessReviewIntegrity(runtime, outcome.state);
      try { await this.finalizeArtifacts(runtime, outcome.state); }
      catch (error) {
        if (outcome.state === "completed") outcome = { state: "failed", error: isCodedFailure(error) ? normalizeError(error) : supervisorError("VSUP_ARTIFACT_ERROR", "Could not finish and verify the run artifacts.") };
        else await this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "artifact_finalization_failed", message: describeFailure(error) } }, true).catch(() => undefined);
        if (outcome.error) runtime.record.error = outcome.error;
        await this.writeFallbackResult(runtime, outcome.state);
      }
      try { await this.releaseSession(runtime); }
      catch (error) {
        const workerError = supervisorError("VSUP_BACKEND_ERROR", "Worker termination could not be verified. The run is retained with its active slot and owned handle for safe retry.");
        outcome = { state: "failed", error: workerError };
        runtime.record.error = workerError;
        await this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "error", data: { reason: "worker_termination_unverified", message: describeFailure(error) } }, true).catch(() => undefined);
      }
      await this.setState(runtime, outcome.state, { ...(outcome.error ? { error: outcome.error } : {}), finishedAt: new Date().toISOString() });
      delete runtime.requestedOutcome;
    } finally {
      if (!runtime.handle) this.releaseSlot(runtime);
      this.notify(runtime);
    }
  }

  private async settleRecovered(runtime: Runtime): Promise<void> {
    const record = runtime.record;
    const previous = record.state;
    if (isTerminal(previous) || previous === "completed") return;
    const now = new Date().toISOString();
    record.state = "failed";
    record.error = supervisorError("VSUP_BACKEND_CRASHED", "The supervisor restarted while this one-shot run was active. The task was not resumed or replayed.");
    record.updatedAt = now; record.finishedAt = now;
    await this.writeFallbackResult(runtime, "failed", "The supervisor restarted while the run was active; no worker was resumed or task replayed.");
    try { await this.persist(runtime); }
    catch (error) { if (!this.degrade(runtime, error)) throw error; }
  }

  private reportBackground(runtime: Runtime | undefined, context: string, error: unknown): void {
    reportBackgroundFailure(context, error);
    if (!runtime || this.stopping) return;
    this.serial(runtime, () => this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "background_failure", context, message: describeFailure(error) } }, true)).catch(() => undefined);
  }

  private noteEventFailure(runtime: Runtime, error: unknown): void {
    if (this.degrade(runtime, asStorageError(error, runtime.directory, { eventLog: true }))) return;
    const description = describeFailure(error);
    runtime.reportedEventFailures ??= new Set();
    if (runtime.reportedEventFailures.has(description)) return;
    runtime.reportedEventFailures.add(description);
    reportBackgroundFailure("event", error);
  }

  private degrade(runtime: Runtime, error: unknown): boolean {
    const fault = storageErrorDetails(error);
    if (!fault) return false;
    if (!runtime.storageDegraded) { runtime.storageDegraded = fault; reportBackgroundFailure("storage", error); }
    runtime.storageHealed = { meta: false, event: false };
    return true;
  }

  private noteStorageSuccess(runtime: Runtime, kind: "meta" | "event"): void {
    const healed = runtime.storageHealed;
    if (!runtime.storageDegraded || !healed) return;
    healed[kind] = true;
    if (healed.meta && healed.event) { delete runtime.storageDegraded; delete runtime.storageHealed; }
  }

  private async finalizeArtifacts(runtime: Runtime, resultState: RunState = runtime.record.state): Promise<void> {
    try { await this.writeArtifacts(runtime, resultState); }
    catch (error) { throw asStorageError(error, runtime.directory); }
  }

  private async writeFallbackResult(runtime: Runtime, resultState: RunState, warning = ARTIFACTS_INCOMPLETE_WARNING): Promise<void> {
    const previous = runtime.record.result;
    const warnings = withoutStopReasonWarnings(previous?.warnings ?? []);
    runtime.record.result = {
      ...(previous?.stopReason ? { stopReason: previous.stopReason } : {}),
      summary: hasText(previous?.summary) ? previous.summary : "Vibe run ended before normal completion.",
      artifacts: previous?.artifacts ?? [],
      changedFiles: previous?.changedFiles ?? [],
      warnings: warnings.includes(warning) ? warnings : [...warnings, warning],
      ...(previous?.integrity ? { integrity: previous.integrity } : {})
    };
    await atomicWriteJson(path.join(runtime.directory, "result.json"), this.resultWire(runtime, resultState)).catch((error: unknown) => this.degrade(runtime, asStorageError(error, runtime.directory)));
  }

  private resultWire(runtime: Runtime, resultState: RunState): Record<string, unknown> {
    const record = runtime.record; const result = record.result;
    return {
      schema_version: 1, supervisor_version: record.supervisorVersion ?? null, run_id: record.runId, state: resultState, backend: record.backend,
      ...(result?.stopReason ? { stop_reason: result.stopReason } : {}),
      summary: result?.summary ?? "",
      workspace: { source: record.sourceWorkspace, worker: record.workerWorkspace },
      artifacts: (result?.artifacts ?? []).map(artifactToWire), changed_files: result?.changedFiles ?? [],
      ...(record.error ? { error: record.error } : {}),
      ...(record.usage ? { usage: usageToWire(record.usage) } : {}), warnings: result?.warnings ?? [],
      ...(result?.integrity ? { integrity: integrityToWire(result.integrity) } : {})
    };
  }

  private async writeArtifacts(runtime: Runtime, resultState: RunState): Promise<void> {
    await this.ensureLoaded(runtime);
    const artifactDir = path.join(runtime.directory, "artifacts");
    await createPrivateDir(artifactDir);
    let patchInfo: { patchPath: string; statPath: string; sha256: string; bytes: number; changedFiles: string[] } | undefined;
    if (runtime.record.mode === "edit" && runtime.record.worktree) {
      patchInfo = await exportDirtySnapshot(runtime.record.workerWorkspace, artifactDir, runtime.record.worktree.baseRef);
      runtime.verifiedPatch = { patchPath: patchInfo.patchPath, sha256: patchInfo.sha256 };
      await this.atomicWriteText(path.join(artifactDir, "changed-files.json"), JSON.stringify({ schema_version: 1, changed_files: patchInfo.changedFiles }, null, 2) + "\n");
    }
    await this.atomicWriteText(path.join(runtime.directory, "transcript.md"), runtime.transcript.slice(0, runtime.record.limits.maxTranscriptBytes));
    const eventsPath = path.join(runtime.directory, "events.ndjson");
    try { await runtime.eventLog?.flush(); } catch (error) { throw asStorageError(error, runtime.directory, { eventLog: true }); }
    if (!runtime.logUnavailable) try {
      const info = await lstat(eventsPath);
      if (!info.isFile()) throw asStorageError(Object.assign(new Error("Unsafe event log"), { code: info.isSymbolicLink() ? "ELOOP" : info.isDirectory() ? "EISDIR" : "ENOTSUP", path: eventsPath }), runtime.directory, { eventLog: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") await this.atomicWriteText(eventsPath, ""); else throw error; }
    const artifacts: NonNullable<RunRecord["result"]>["artifacts"] = [];
    if (patchInfo) {
      artifacts.push(await describeArtifact("diff.patch", patchInfo.patchPath, "text/x-diff"));
      artifacts.push(await describeArtifact("diff.stat", patchInfo.statPath, "text/plain"));
      const changedPath = path.join(artifactDir, "changed-files.json");
      artifacts.push(await describeArtifact("changed-files.json", changedPath, "application/json"));
    }
    artifacts.push(await describeArtifact("transcript.md", path.join(runtime.directory, "transcript.md"), "text/markdown"));
    if (!runtime.logUnavailable) artifacts.push(await describeArtifact("events.ndjson", path.join(runtime.directory, "events.ndjson"), "application/x-ndjson"));
    const artifactBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
    if (artifactBytes > runtime.record.limits.maxArtifactBytes) throw codedError("VSUP_OUTPUT_LIMIT", "Run artifacts exceeded the configured byte limit.");
    const stopReason = runtime.record.result?.stopReason;
    const recordedSummary = runtime.record.result?.summary;
    const summary = hasText(recordedSummary) ? recordedSummary : resultState === "completed" ? completedSummary(stopReason, runtime.record.backend) : "Vibe run ended before normal completion.";
    const stopWarning = resultState === "completed" ? stopReasonWarning(stopReason) : undefined;
    const carriedWarnings = withoutStopReasonWarnings(runtime.record.result?.warnings ?? []);
    if (runtime.logUnavailable) carriedWarnings.push(`${UNREADABLE_LOG_WARNING} (${runtime.logUnavailable.reason})`);
    runtime.record.result = {
      ...(stopReason ? { stopReason } : {}),
      summary,
      artifacts,
      changedFiles: patchInfo?.changedFiles ?? [],
      warnings: stopWarning ? [...carriedWarnings, stopWarning] : carriedWarnings,
      ...(runtime.record.result?.integrity ? { integrity: runtime.record.result.integrity } : {})
    };
    await atomicWriteJson(path.join(runtime.directory, "result.json"), this.resultWire(runtime, resultState));
    await this.persist(runtime);
  }

  private async atomicWriteText(file: string, value: string): Promise<void> {
    const directory = path.dirname(file); await createPrivateDir(directory);
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(value, "utf8"); await handle.sync(); await handle.close();
      await rename(temp, file);
      const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
    } catch (error) { await handle.close().catch(() => undefined); await rm(temp, { force: true }).catch(() => undefined); throw error; }
  }

  private savedPatchExport(runtime: Runtime): { patchPath: string; sha256: string } | undefined {
    if (runtime.verifiedPatch) return runtime.verifiedPatch;
    const artifact = runtime.record.result?.artifacts?.find((candidate) => candidate.name === "diff.patch");
    if (!artifact?.sha256 || !artifact.path || path.resolve(artifact.path) !== path.join(runtime.directory, "artifacts", "diff.patch")) return undefined;
    return { patchPath: path.resolve(artifact.path), sha256: artifact.sha256 };
  }

  private async cleanupWorktree(runtime: Runtime): Promise<WorktreeCleanup> {
    const worktree = runtime.record.worktree;
    if (!worktree) return { removed: false };
    if (!worktree.createdBySupervisor) return { removed: false, reason: "The worktree was not created by the supervisor." };
    const expectedPath = path.join(path.resolve(this.dataDir), "worktrees", runtime.record.runId);
    if (path.resolve(worktree.path) !== expectedPath || path.resolve(runtime.record.workerWorkspace) !== expectedPath) {
      return { removed: false, reason: `The saved worktree identity does not match the run-owned path ${expectedPath}.` };
    }
    try {
      const canonicalSource = await resolveCanonicalRoot(runtime.record.sourceWorkspace, this.config.allowedWorkspaceRoots);
      if (canonicalSource !== runtime.record.sourceWorkspace) return { removed: false, reason: "The saved source workspace no longer matches its canonical allowed path." };
    } catch { return { removed: false, reason: "The saved source workspace is no longer an allowed canonical path." }; }
    if (!worktree.baseRef) return { removed: false, reason: "The saved worktree base reference is incomplete." };
    let verified = this.savedPatchExport(runtime);
    if (!verified) {
      try { await this.finalizeArtifacts(runtime, await this.settledResultState(runtime)); }
      catch (error) { return { removed: false, reason: redactSecrets(error instanceof Error ? error.message : "The worktree could not be exported before removal.").slice(0, MAX_RETAINED_REASON_CHARS) }; }
      verified = this.savedPatchExport(runtime);
    }
    if (!verified) return { removed: false, reason: "No verified patch export is available for this worktree." };
    try { await removeVerifiedWorktree(runtime.record.sourceWorkspace, worktree, verified, expectedPath); }
    catch (error) { return { removed: false, reason: redactSecrets(error instanceof Error ? error.message : "Worktree cleanup was refused.").slice(0, MAX_RETAINED_REASON_CHARS) }; }
    delete runtime.record.worktree;
    try { await this.persist(runtime); }
    catch (error) { if (!this.degrade(runtime, error)) throw error; }
    return { removed: true };
  }

  private async settledResultState(runtime: Runtime): Promise<RunState> {
    const text = await this.readArtifactText(runtime, path.join(runtime.directory, "result.json"), MAX_META_BYTES);
    try {
      const state = (JSON.parse(text ?? "") as { state?: unknown }).state;
      if (typeof state === "string" && SETTLED_RESULT_STATES.has(state as RunState)) return state as RunState;
    } catch {}
    return "cancelled";
  }

  private noteActivity(runtime: Runtime, kind: string): void {
    if (this.stopping) return;
    runtime.lastActivity = { at: Date.now(), kind };
    this.watchProgress(runtime);
  }

  private clearProgress(runtime: Runtime): void {
    if (runtime.progressTimer) clearTimeout(runtime.progressTimer);
    delete runtime.progressTimer;
  }

  private watchProgress(runtime: Runtime): void {
    this.clearProgress(runtime);
    const seconds = this.config.limits.workerProgressTimeoutSeconds;
    if (this.stopping || !(seconds > 0) || runtime.record.state !== "running" || runtime.requestedOutcome) return;
    runtime.progressArmedAt = Date.now();
    runtime.progressTimer = setTimeout(() => { this.noProgress(runtime, seconds).catch((error: unknown) => this.reportBackground(runtime, "progress-watchdog", error)); }, seconds * 1000);
    runtime.progressTimer.unref?.();
  }

  private async noProgress(runtime: Runtime, seconds: number): Promise<void> {
    delete runtime.progressTimer;
    if (this.stopping || runtime.requestedOutcome || runtime.record.state !== "running") return;
    const since = runtime.lastActivity?.at ?? runtime.progressArmedAt ?? Date.now() - seconds * 1000;
    const silence = Math.max(1, Math.round((Date.now() - since) / 1000));
    const lastKind = runtime.lastActivity?.kind ?? "none";
    this.requestOutcome(runtime, { state: "failed", error: supervisorError("VSUP_NO_PROGRESS", `The worker produced no output for ${seconds} seconds.`) });
    await this.serial(runtime, async () => {
      if (runtime.record.state !== "running") return;
      await this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "no_progress", silence_seconds: silence, last_activity_kind: lastKind, message: `The worker produced no output for ${seconds} seconds.` } }).catch(() => undefined);
    });
    await this.cancelBackendSession(runtime);
    await this.serial(runtime, async () => {
      if (runtime.record.state !== "running") return;
      await this.settle(runtime, runtime.requestedOutcome ?? { state: "failed", error: supervisorError("VSUP_NO_PROGRESS", `The worker produced no output for ${seconds} seconds.`) });
    });
  }

  private async deadline(runtime: Runtime): Promise<void> {
    if (isTerminal(runtime.record.state) || runtime.record.state === "completed") return;
    const outcome = this.requestOutcome(runtime, { state: "failed", error: supervisorError("VSUP_TIMEOUT", "The run exceeded its configured timeout.") });
    if (outcome.error?.code === "VSUP_TIMEOUT") await this.serial(runtime, async () => {
      if (isTerminal(runtime.record.state) || runtime.record.state === "completed") return;
      await this.appendEvent(runtime, { source: "supervisor", type: "timeout", severity: "warning", data: { timeout_seconds: runtime.record.limits.timeoutSeconds } }).catch(() => undefined);
    });
    await this.cancelBackendSession(runtime);
    await this.serial(runtime, async () => {
      if (isTerminal(runtime.record.state) || runtime.record.state === "completed") return;
      await this.settle(runtime, outcome);
    });
  }

  private async setState(runtime: Runtime, state: RunState, update?: Partial<Pick<RunRecord, "usage" | "result" | "error" | "process"> & { startedAt?: string; finishedAt?: string }>): Promise<void> {
    if (isTerminal(runtime.record.state) && state !== "closing" && state !== "closed") return;
    assertTransition(runtime.record.state, state);
    runtime.record.state = state;
    runtime.record.updatedAt = new Date().toISOString();
    if (update?.usage) runtime.record.usage = update.usage;
    if (update?.result) runtime.record.result = update.result;
    if (update?.error) runtime.record.error = update.error;
    if (update?.process) runtime.record.process = update.process;
    if (update?.startedAt) runtime.record.startedAt = update.startedAt;
    if (update?.finishedAt) runtime.record.finishedAt = update.finishedAt;
    if ((isTerminal(state) || state === "completed") && runtime.timer) clearTimeout(runtime.timer);
    if (state === "running") delete runtime.lastActivity;
    this.watchProgress(runtime);
    try { await this.persist(runtime); }
    catch (error) { if (!this.degrade(runtime, error)) throw error; }
    if (isTerminal(state)) this.persisted.set(runtime.record.runId, runtime.record);
    this.notify(runtime);
  }

  private async persist(runtime: Runtime): Promise<void> {
    try { await runtime.eventLog?.flush(); }
    catch (error) { if (!this.degrade(runtime, asStorageError(error, runtime.directory, { eventLog: true }))) throw error; }
    const write = runtime.persistChain.then(() => atomicWriteJson(path.join(runtime.directory, "meta.json"), runToWire(runtime.record)));
    runtime.persistChain = write.then(() => undefined, () => undefined);
    try { await write; }
    catch (error) { throw asStorageError(error, runtime.directory); }
    this.noteStorageSuccess(runtime, "meta");
  }

  private serial<T>(runtime: Runtime, fn: () => Promise<T>): Promise<T> {
    const next = runtime.serial.then(fn, fn);
    runtime.serial = next.then(() => undefined, () => undefined);
    return next;
  }

  private releaseSlot(runtime: Runtime): void {
    if (runtime.slot) { runtime.slot = false; this.activeSlots = Math.max(0, this.activeSlots - 1); }
    if (runtime.timer) clearTimeout(runtime.timer);
    if (runtime.progressTimer) clearTimeout(runtime.progressTimer);
    delete runtime.progressTimer;
  }

  private async releaseSession(runtime: Runtime): Promise<void> {
    const backend = runtime.backend; const handle = runtime.handle;
    if (backend && handle) {
      await this.closeBackendHandle(runtime, backend, handle);
      if (runtime.handle === handle) delete runtime.handle;
    }
  }

  private async closeBackendHandle(runtime: Runtime, backend: SupervisorBackend, handle: BackendRunHandle): Promise<void> {
    if (runtime.closedHandles.has(handle)) return;
    const closing = Promise.resolve().then(() => backend.close(handle));
    if (!await settlesWithin(closing, BACKEND_RELEASE_DEADLINE_MS)) throw new Error("Worker cleanup exceeded its bounded deadline; termination remains unverified.");
    await closing;
    runtime.closedHandles.add(handle);
  }

  private armDeadline(runtime: Runtime, milliseconds: number): void {
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.deadlineAt = Date.now() + milliseconds;
    runtime.timer = setTimeout(() => { this.deadline(runtime).catch((error: unknown) => this.reportBackground(runtime, "deadline", error)); }, milliseconds);
    runtime.timer.unref?.();
  }

  private async loadLaunchManifest(runtime: Runtime): Promise<void> {
    const text = await this.readArtifactText(runtime, path.join(runtime.directory, LAUNCH_MANIFEST_FILE), MAX_MANIFEST_BYTES);
    const snapshot = text === undefined ? undefined : parseManifest(text);
    if (snapshot && snapshot.sha256 === runtime.sourceSnapshot) runtime.sourceManifest = snapshot.manifest;
  }

  private async assessReviewIntegrity(runtime: Runtime, outcome: SettleOutcome["state"]): Promise<void> {
    if (runtime.record.mode !== "review" || !runtime.record.launchedAt || runtime.record.result?.integrity) return;
    if (outcome !== "completed" && !runtime.sourceSnapshot && !runtime.snapshotFailed) return;
    const writeToolObserved = runtime.events.some(isWriteEvidence);
    let integrity: ReviewIntegrity;
    if (runtime.sourceSnapshot && !runtime.sourceManifest) await this.loadLaunchManifest(runtime);
    if (!runtime.sourceSnapshot) {
      integrity = { status: "unverified", writeToolObserved, reason: runtime.snapshotFailed ? "The launch snapshot failed: the workspace is too large or unreadable." : "No launch snapshot is available for this run." };
    } else if (!runtime.sourceManifest) {
      integrity = { status: "unverified", writeToolObserved, reason: "The launch manifest was not saved or could not be read (the run predates manifest persistence or the file is damaged), so the source workspace cannot be compared after the restart." };
    } else {
      try {
        const paths = await changedSinceSnapshot(runtime.record.sourceWorkspace, runtime.sourceManifest);
        if (paths.length === 0) integrity = { status: "verified", writeToolObserved };
        else {
          integrity = {
            status: "changed", writeToolObserved,
            changedPaths: paths.slice(0, MAX_INTEGRITY_PATHS), changedPathsTotal: paths.length,
            reason: `The source workspace content changed between the launch snapshot and the end of the run (${paths.length} paths).`
          };
        }
      } catch {
        integrity = { status: "unverified", writeToolObserved, reason: "The end-of-run snapshot failed: the workspace is too large or unreadable." };
      }
    }
    const warning = integrity.status === "changed" ? (writeToolObserved ? CHANGED_WITH_WRITE_WARNING : CHANGED_WARNING) : integrity.status === "unverified" ? UNVERIFIED_WARNING : undefined;
    const warnings = runtime.record.result?.warnings ?? [];
    runtime.record.result = { ...runtime.record.result, warnings: warning && !warnings.includes(warning) ? [...warnings, warning] : warnings, integrity };
    if (integrity.status !== "verified" || writeToolObserved) {
      await this.appendEvent(runtime, { source: "supervisor", type: "review_integrity", severity: integrity.status === "changed" && writeToolObserved ? "error" : "warning", data: integrityToWire(integrity) }).catch((error: unknown) => this.reportBackground(runtime, "review-integrity-event", error));
    }
  }

  private async fail(runtime: Runtime, error: SupervisorError): Promise<void> {
    if (isTerminal(runtime.record.state) || runtime.record.state === "completed" || runtime.record.state === "closing") return;
    const outcome = this.requestOutcome(runtime, { state: "failed", error });
    await this.cancelBackendSession(runtime);
    await this.serial(runtime, () => this.settle(runtime, outcome));
  }

  private nextAction(record: RunRecord, state: RunState, afterSeq?: number): string {
    switch (state) {
      case "completed": return "Check stop_reason and warnings before trusting the result; call vibe_close when done.";
      case "failed":
      case "cancelled": return "Read error and warnings; call vibe_close when done.";
      case "closing":
      case "closed": return "The run is closed; start a new run for more work.";
      default: return afterSeq === undefined
        ? "Call vibe_status with wait_seconds 120-300 until the run needs action."
        : `Call vibe_status again with after_seq=${afterSeq} and wait_seconds 120-300 until the run needs action.`;
    }
  }

  private requireRun(id: string): Runtime {
    if (!UUID_V4.test(id)) throw codedError("VSUP_NOT_FOUND", "Run was not found.");
    const runtime = this.runs.get(id);
    if (!runtime) throw codedError("VSUP_NOT_FOUND", "Run was not found.");
    return runtime;
  }
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function isDiscardableRecord(file: string): Promise<boolean> {
  let text: string;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_DISCARDABLE_RECORD_BYTES) return false;
    text = await readFile(file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  if (!text.trim()) return true;
  try { JSON.parse(text); return false; } catch { return true; }
}

function statusText(event: SupervisorEvent): { text?: string } {
  if (event.source !== "supervisor" || !STATUS_TEXT_EVENT_TYPES.has(event.type)) return {};
  for (const key of ["text", "message", "reason"]) {
    const value = event.data[key];
    if (typeof value === "string" && value.trim()) return { text: redactSecrets(value).slice(0, STATUS_TEXT_CHARS) };
  }
  return {};
}

interface WorktreeCleanup { removed: boolean; reason?: string }

function describeUnreadableLog(error: unknown): NonNullable<Runtime["logUnavailable"]> {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && !code.startsWith("VSUP_")) return { kind: "filesystem", code, reason: `file system error ${code}` };
  if (error instanceof RangeError) return { kind: "content", reason: "the file is larger than the configured event byte limit" };
  if (error instanceof SyntaxError) return { kind: "content", reason: "an event record is not valid JSON" };
  return { kind: "content", reason: "the file is not a valid event log" };
}

const MAX_DISCARDABLE_RECORD_BYTES = 1024 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseInput<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try { return schema.parse(value); }
  catch (error) { throw codedError("VSUP_INVALID_ARGUMENT", error instanceof Error ? error.message : "Invalid tool input."); }
}

async function withDeadline<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  if (milliseconds <= 0) throw codedError("VSUP_INVALID_STATE", message);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(codedError("VSUP_INVALID_STATE", message)), milliseconds); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function settlesWithin(operation: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation.then(() => true, () => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function codedError(code: SupervisorErrorCode, message: string, details?: Record<string, unknown>): Error & { code: SupervisorErrorCode; remediation: string; retryable: boolean } {
  const normalized = supervisorError(code, message, details);
  return Object.assign(new Error(message), normalized);
}

function isCodedFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && error.code.startsWith("VSUP_");
}

function normalizeError(error: unknown): SupervisorError {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && error.code.startsWith("VSUP_")) {
    const code = error.code as SupervisorErrorCode;
    const message = "message" in error && typeof error.message === "string" ? error.message : code;
    const details = "details" in error && typeof error.details === "object" && error.details !== null && !Array.isArray(error.details) ? error.details as Record<string, unknown> : undefined;
    return supervisorError(code, message, details, "retryable" in error && error.retryable === true);
  }
  return { code: "VSUP_BACKEND_ERROR", message: "The backend failed. Check the run diagnostics for details.", remediation: DEFAULT_REMEDIATION, retryable: false };
}

function artifactToWire(artifact: NonNullable<RunRecord["result"]>["artifacts"] extends (infer A)[] | undefined ? A : never): Record<string, unknown> {
  return { name: artifact.name, path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, media_type: artifact.mediaType };
}

function usageToWire(usage: NonNullable<RunRecord["usage"]>): Record<string, unknown> {
  return { ...(usage.tokensUsed === undefined ? {} : { tokens_used: usage.tokensUsed }), ...(usage.contextSize === undefined ? {} : { context_size: usage.contextSize }), ...(usage.cost ? { cost: { amount: usage.cost.amount, currency: usage.cost.currency, authoritative: false } } : {}) };
}

async function describeArtifact(name: string, file: string, mediaType: string): Promise<NonNullable<RunRecord["result"]>["artifacts"] extends (infer A)[] | undefined ? A : never> {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Unsafe artifact output");
  const bytes = await readFile(file);
  return { name, path: file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength, mediaType } as NonNullable<RunRecord["result"]>["artifacts"] extends (infer A)[] | undefined ? A : never;
}

const UNREADABLE_LOG_WARNING = "The event log of this run could not be read and was left untouched; it is not included in the artifacts";
const ARTIFACTS_INCOMPLETE_WARNING = "Run artifacts could not be finalized; the listed artifacts may be missing or incomplete.";
const CHANGED_WITH_WRITE_WARNING = "Possible read-only boundary violation: the review worker issued a write-capable tool call and the source workspace changed. Inspect the changed paths before trusting the review.";
const STOP_WARNING_PREFIX = "Vibe stopped with stop reason ";
const MAX_STOP_REASON_CHARS = 64;

function printableStopReason(reason: string): string {
  const cleaned = reason.replace(/[^\x20-\x7e]/g, "?");
  return cleaned.length > MAX_STOP_REASON_CHARS ? `${cleaned.slice(0, MAX_STOP_REASON_CHARS)}...` : cleaned;
}

function completedSummary(stopReason: string | undefined, _backend: RunRecord["backend"]): string {
  switch (stopReason) {
    case undefined:
    case "end_turn": return "Vibe completed the delegated task.";
    case "max_turn_requests": return "Vibe stopped at the turn limit before giving a final answer. Inspect the artifacts and stop_reason before trusting the result; start a fresh run from a reviewed base if more work is needed.";
    case "max_tokens": return "Vibe stopped at the token limit before giving a final answer. Inspect the artifacts and stop_reason before trusting the result; start a fresh run from a reviewed base if more work is needed.";
    case "refusal": return "Vibe declined the request. Inspect the artifacts and stop_reason before trusting the result.";
    case "cancelled": return "The Vibe task was cancelled before it finished. Inspect the artifacts and stop_reason before starting a fresh run.";
    default: return `Vibe stopped with reason ${printableStopReason(stopReason)} instead of a normal final answer. Inspect the artifacts and stop_reason before trusting the result.`;
  }
}

function stopReasonWarning(stopReason: string | undefined): string | undefined {
  if (!stopReason || stopReason === "end_turn") return undefined;
  return `${STOP_WARNING_PREFIX}${printableStopReason(stopReason)} instead of end_turn; the result may be incomplete.`;
}

function withoutStopReasonWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => !warning.startsWith(STOP_WARNING_PREFIX));
}

const CHANGED_WARNING = "The source workspace changed during this read-only review. The changes may be your own edits or a read-only boundary violation; inspect the changed paths before trusting the review.";
const UNVERIFIED_WARNING = "The source workspace could not be snapshotted (too large or unreadable); review integrity was NOT checked, so a read-only boundary violation would go undetected.";
const MAX_INTEGRITY_PATHS = 50;

function isWriteEvidence(event: SupervisorEvent): boolean {
  if (event.type !== "tool_call" && event.type !== "tool_call_update") return false;
  const kind = typeof event.data.kind === "string" ? event.data.kind.toLowerCase().replace(/[^a-z]/g, "") : "";
  if (kind === "edit" || kind === "delete" || kind === "move") return true;
  return [event.data.title, event.data.name].some((value) => typeof value === "string" && /^\s*(?:write_file|edit)(?![a-z0-9])/i.test(value));
}

async function assertEditAtRepositoryRoot(source: string): Promise<void> {
  let root: string;
  try { root = await realpath(await resolveGitRoot(source)); }
  catch { return; }
  if (root !== source) throw codedError("VSUP_WORKSPACE_INVALID", `Edit runs must start at the git repository root because the worker receives the whole repository; use cwd ${root} instead of ${source}.`);
}
