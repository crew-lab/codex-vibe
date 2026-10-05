import { createHash, randomUUID } from "node:crypto";
import { open, readFile, readdir, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import type {
  BackendCallbacks, BackendKind, BackendRespondInput, BackendRunHandle,
  PendingRequest, ReviewStartToolInput, EditStartToolInput, StatusToolInput, ContinueToolInput,
  RespondToolInput, ResultToolInput, WaitOptions, CancelToolInput, CloseToolInput, RunLimits, RunMode, RunRecord, RunState, SupervisorBackend,
  ReviewIntegrity, SupervisorConfig, SupervisorError, SupervisorErrorCode, SupervisorEvent
} from "../contracts.js";
import { SCHEMA_VERSION, supervisorError } from "../contracts.js";
import { cancelSchema, closeSchema, continueSchema, editStartSchema, resultSchema, reviewStartSchema, respondSchema, statusSchema } from "../mcp/schemas.js";
import { atomicWriteJson, sanitizeForPersistence } from "../persistence/atomic.js";
import { appendNdjson, readNdjsonRecovering } from "../persistence/ndjson.js";
import { createPrivateDir, resolveCanonicalRoot, isPathWithinRoot, assertPathWithinRoot } from "../security/paths.js";
import { redactSecrets } from "../security/redaction.js";
import { assertNotSupervisorChild } from "../security/environment.js";
import { createDetachedWorktree, exportDirtySnapshot, removeVerifiedWorktree, resolveBaseCommit } from "../git/worktree.js";
import { eventFromWire, eventToWire, integrityToWire, runFromWire, runToWire } from "./serialization.js";
import { assertTransition, isTerminal } from "./run-state.js";
import { PolicyEngine, normalizeKind } from "./policy-engine.js";

interface Runtime {
  record: RunRecord;
  directory: string;
  task: string;
  contextFiles: string[];
  allowShell: boolean;
  backendPreference: "auto" | BackendKind;
  handle?: BackendRunHandle;
  backend?: SupervisorBackend;
  events: SupervisorEvent[];
  eventSeq: number;
  transcript: string;
  serial: Promise<void>;
  timer?: NodeJS.Timeout;
  slot: boolean;
  cancelRequested: boolean;
  started: boolean;
  sourceSnapshot?: string;
  sourceManifest?: Map<string, string>;
  snapshotFailed?: boolean;
  verifiedPatch?: { patchPath: string; sha256: string };
  deferredResponses: BackendRespondInput[];
  idleTimer?: NodeJS.Timeout;
  transcriptOverflow: boolean;
  pendingFailure?: SupervisorError;
  completionOrder: number;
  persistChain: Promise<void>;
  waiters: Set<() => void>;
}

type StartResult = {
  run_id: string;
  state: RunState;
  backend: BackendKind;
  mode: RunMode;
  source_workspace: string;
  worker_workspace: string;
  created_at: string;
  next_action: string;
  base_ref?: string;
  pending_request?: Record<string, unknown>;
  error?: SupervisorError;
  result?: Record<string, unknown>;
};

const SUMMARY_DEPRECATION = "detail=summary is deprecated; use detail=compact (default) or detail=full.";
const START_ENVELOPE_RESERVE_CHARS = 1500;
const MAX_META_BYTES = 1_048_576;
const MAX_INLINE_TRANSCRIPT = 32_768;
const COMPACT_TRANSCRIPT_CHARS = 4000;
const COMPACT_PATCH_BYTES = 4000;
const COMPACT_DIFF_STAT_CHARS = 2000;
const COMPACT_CHANGED_FILES = 50;
const COORDINATOR_ACTION_STATES: ReadonlySet<RunState> = new Set<RunState>(["completed", "failed", "cancelled", "closed", "waiting_permission", "waiting_input", "recoverable"]);
const SETTLED_RESULT_STATES: ReadonlySet<RunState> = new Set<RunState>(["completed", "failed", "cancelled"]);
const DEFAULT_REMEDIATION = "Inspect the run status and supervisor diagnostics, then retry if safe.";

export class RunManager {
  private readonly runRoot: string;
  private readonly backends = new Map<BackendKind, SupervisorBackend>();
  private readonly runs = new Map<string, Runtime>();
  private readonly pending: Runtime[] = [];
  private readonly persisted = new Map<string, RunRecord>();
  private readonly policy: PolicyEngine;
  private initializePromise: Promise<void> | undefined;
  private ownerToken: string | undefined;
  private ownerLockPath: string | undefined;
  private initialized = false;
  private stopping = false;
  private activeSlots = 0;
  private completionCounter = 0;

  constructor(private readonly config: SupervisorConfig, private readonly dataDir: string, backends: readonly SupervisorBackend[] = []) {
    this.runRoot = path.join(path.resolve(dataDir), "runs");
    this.policy = new PolicyEngine(config);
    for (const backend of backends) this.backends.set(backend.kind, backend);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeInternal();
    try { await this.initializePromise; }
    catch (error) { this.initializePromise = undefined; await this.releaseOwnerLock(); throw error; }
  }

  private async initializeInternal(): Promise<void> {
    assertNotSupervisorChild();
    await createPrivateDir(this.dataDir);
    await createPrivateDir(this.runRoot);
    await this.acquireOwnerLock();
    if (this.backends.size === 0) await this.loadDefaultBackends();
    const entries = await readdir(this.runRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_V4.test(entry.name)) continue;
      const directory = path.join(this.runRoot, entry.name);
      try {
        const file = path.join(directory, "meta.json");
        const info = await lstat(file);
        if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_META_BYTES) continue;
        const record = runFromWire(JSON.parse(await readFile(file, "utf8")) as unknown);
        if (record.runId !== entry.name || !isPathWithinRoot(this.runRoot, path.resolve(directory))) continue;
        const wireEvents = await readNdjsonRecovering<unknown>(path.join(directory, "events.ndjson"), { maxBytes: record.limits.maxEventBytes, truncatePartial: true });
        const events = wireEvents.map(eventFromWire).filter((event, index) => event.runId === record.runId && event.seq === index + 1);
        const runtime = this.makeRuntime(record, directory, "", [], false, record.backend, events);
        runtime.eventSeq = events.at(-1)?.seq ?? 0;
        if (record.workspaceSnapshotSha256) runtime.sourceSnapshot = record.workspaceSnapshotSha256;
        try {
          const transcriptPath = path.join(directory, "transcript.md");
          const transcriptInfo = await lstat(transcriptPath);
          if (transcriptInfo.isFile() && !transcriptInfo.isSymbolicLink() && transcriptInfo.size <= record.limits.maxTranscriptBytes) runtime.transcript = await readFile(transcriptPath, "utf8");
        } catch { /* Missing or unsafe transcript is never trusted during recovery. */ }
        if (isTerminal(record.state)) {
          this.runs.set(record.runId, runtime); this.persisted.set(record.runId, record); continue;
        }
        if (record.state === "completed") {
          const completedBackend = this.backends.get(record.backend);
          if (completedBackend) runtime.backend = completedBackend;
          this.runs.set(record.runId, runtime); continue;
        }
        // Requests cannot survive a process restart because the ACP request handle is process-local.
        if (record.pendingRequest) {
          delete record.pendingRequest;
          record.error = supervisorError("VSUP_REQUEST_EXPIRED", "The pending request expired when the supervisor restarted.");
        }
        const backend = this.backends.get(record.backend);
        if (backend) {
          runtime.backend = backend;
          try {
            const handle = await backend.recover(record, this.callbacks(runtime));
            if (handle && this.activeSlots < this.config.maxConcurrentRuns) {
              runtime.handle = handle; runtime.slot = true; this.activeSlots += 1;
              if (runtime.record.state === "recoverable") await this.setState(runtime, "ready");
              this.resumeDeadline(runtime);
              this.runs.set(record.runId, runtime); continue;
            }
            if (handle) await backend.close(handle).catch(() => undefined);
          } catch { /* Persist a recoverable record below; never resubmit its task. */ }
        }
        record.state = "recoverable";
        record.updatedAt = new Date().toISOString();
        delete record.pendingRequest;
        if (!record.error) record.error = supervisorError("VSUP_SESSION_NOT_RESUMABLE", "No resumable backend session was recovered.");
        runtime.record = record; runtime.events = events; this.runs.set(record.runId, runtime); this.persisted.set(record.runId, record);
        await this.persist(runtime);
      } catch {
        // One corrupt record must not prevent recovery of other runs.
      }
    }
    this.initialized = true;
  }

  async reviewStart(value: ReviewStartToolInput, wait?: WaitOptions): Promise<StartResult> {
    const input = parseInput(reviewStartSchema, value);
    const started = await this.start("review", input.task, input.cwd, input.backend, {
      maxTurns: input.max_turns, timeoutSeconds: input.timeout_seconds,
      contextFiles: input.context_files, allowShell: false
    });
    return this.awaitStartOutcome(started, input.wait_seconds, wait?.signal);
  }

  async editStart(value: EditStartToolInput, wait?: WaitOptions): Promise<StartResult> {
    const input = parseInput(editStartSchema, value);
    if (input.allow_shell) throw codedError("VSUP_PERMISSION_DENIED", "Shell access is unavailable because this release has no certified kernel sandbox.");
    const started = await this.start("edit", input.task, input.cwd, input.backend, {
      maxTurns: input.max_turns, timeoutSeconds: input.timeout_seconds,
      baseRef: input.base_ref, allowShell: input.allow_shell
    });
    return this.awaitStartOutcome(started, input.wait_seconds, wait?.signal);
  }

  private async awaitStartOutcome(started: StartResult, waitSeconds: number, signal?: AbortSignal): Promise<StartResult> {
    if (waitSeconds <= 0) return started;
    const runtime = this.requireRun(started.run_id);
    await this.waitUntil(runtime, () => COORDINATOR_ACTION_STATES.has(runtime.record.state) || runtime.record.pendingRequest !== undefined, waitSeconds, signal);
    const record = runtime.record;
    const settled = SETTLED_RESULT_STATES.has(record.state);
    return {
      ...started, state: record.state, backend: record.backend, worker_workspace: record.workerWorkspace,
      next_action: settled ? "Read the compact result above; call vibe_close when done." : "Call vibe_status with wait_seconds until the run needs action.",
      ...(record.pendingRequest ? { pending_request: pendingToWire(record.pendingRequest) } : {}),
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

  private async start(mode: RunMode, task: string, cwd: string, requested: "auto" | BackendKind, options: { maxTurns: number; timeoutSeconds: number; contextFiles?: string[]; baseRef?: string; allowShell: boolean }): Promise<StartResult> {
    await this.ready();
    if (this.stopping) throw codedError("VSUP_INVALID_STATE", "The supervisor is shutting down.");
    const source = await resolveCanonicalRoot(cwd, this.config.allowedWorkspaceRoots);
    for (const file of options.contextFiles ?? []) await assertPathWithinRoot(source, path.resolve(source, file));
    const id = randomUUID();
    const now = new Date().toISOString();
    const workerWorkspace = mode === "edit" ? path.join(this.dataDir, "worktrees", id) : source;
    const backendGuess: BackendKind = requested === "auto" ? (this.config.backend === "programmatic" ? "programmatic" : "acp") : requested;
    const limits: RunLimits = {
      timeoutSeconds: options.timeoutSeconds,
      maxTurns: options.maxTurns,
      maxEventBytes: this.config.limits.maxEventBytes,
      maxTranscriptBytes: this.config.limits.maxTranscriptBytes,
      maxArtifactBytes: this.config.limits.maxArtifactBytes
    };
    const record: RunRecord = {
      schemaVersion: SCHEMA_VERSION,
      runId: id,
      backend: backendGuess,
      mode,
      state: this.activeSlots < this.config.maxConcurrentRuns ? "starting" : "queued",
      sourceWorkspace: source,
      workerWorkspace,
      createdAt: now,
      updatedAt: now,
      taskSha256: createHash("sha256").update(task).digest("hex"),
      limits
    };
    if (mode === "edit") record.worktree = { path: workerWorkspace, baseRef: options.baseRef ?? "HEAD", createdBySupervisor: true };
    const slot = this.activeSlots < this.config.maxConcurrentRuns;
    if (!slot && this.pending.length >= this.config.maxQueuedRuns) throw codedError("VSUP_LIMIT_EXCEEDED", "The active and queued run limits are full.");
    const runtime = this.makeRuntime(record, path.join(this.runRoot, id), task, options.contextFiles ?? [], options.allowShell, requested);
    runtime.slot = slot;
    this.runs.set(id, runtime);
    if (slot) this.activeSlots += 1; else this.pending.push(runtime);
    try {
      await createPrivateDir(runtime.directory);
      await this.persist(runtime);
    } catch (error) {
      this.runs.delete(id); this.removeFromPending(runtime); this.releaseSlot(runtime);
      await rm(runtime.directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    if (slot) void this.launch(runtime);
    return {
      run_id: id, state: runtime.record.state, backend: runtime.record.backend, mode,
      source_workspace: source, worker_workspace: workerWorkspace, created_at: now,
      next_action: "Call vibe_status with this run_id and wait_seconds.",
      ...(mode === "edit" ? { base_ref: options.baseRef ?? "HEAD" } : {})
    };
  }

  async status(value: StatusToolInput, wait?: WaitOptions): Promise<Record<string, unknown>> {
    const input = parseInput(statusSchema, value); const runtime = this.requireRun(input.run_id);
    const initialState = runtime.record.state;
    await this.waitUntil(runtime, () => runtime.eventSeq > input.after_seq || runtime.record.state !== initialState || runtime.record.pendingRequest !== undefined || COORDINATOR_ACTION_STATES.has(runtime.record.state), input.wait_seconds, wait?.signal);
    const events = runtime.events.filter((event) => event.seq > input.after_seq).slice(0, input.max_events).map((event) => ({
      seq: event.seq, type: event.type,
      ...(typeof event.data.title === "string" ? { title: event.data.title } : {}),
      ...(typeof event.data.kind === "string" ? { kind: event.data.kind } : {}),
      ...(typeof event.data.status === "string" ? { status: event.data.status } : {})
    }));
    return {
      run_id: runtime.record.runId, state: runtime.record.state, backend: runtime.record.backend,
      last_seq: runtime.eventSeq, events,
      ...(runtime.record.pendingRequest ? { pending_request: pendingToWire(runtime.record.pendingRequest) } : {}),
      ...(runtime.record.error ? { error: runtime.record.error } : {})
    };
  }

  async continue(value: ContinueToolInput): Promise<Record<string, unknown>> {
    const input = parseInput(continueSchema, value); const runtime = this.requireRun(input.run_id);
    if (!runtime.backend) {
      const backend = this.backends.get(runtime.record.backend);
      if (backend) runtime.backend = backend;
    }
    const lazyRecovery = runtime.record.state === "completed";
    if (runtime.backend && !runtime.handle && !lazyRecovery) {
      const handle = await runtime.backend.recover(runtime.record, this.callbacks(runtime));
      if (handle) runtime.handle = handle;
    }
    if (!runtime.backend || (!runtime.handle && !lazyRecovery)) throw codedError("VSUP_SESSION_NOT_RESUMABLE", "No live backend session is available for continuation.");
    const capability = await runtime.backend.probe();
    if (!capability.supportsContinue) throw codedError("VSUP_SESSION_NOT_RESUMABLE", "The active backend does not support continuing this session.");
    if (runtime.record.pendingRequest || (runtime.record.state !== "completed" && runtime.record.state !== "ready" && runtime.record.state !== "recoverable")) throw codedError("VSUP_INVALID_STATE", "This run cannot accept a continuation in its current state.");
    if (runtime.record.state === "completed") {
      if (runtime.slot) throw codedError("VSUP_INVALID_STATE", "A continuation for this run is already starting.");
      if (this.activeSlots >= this.config.maxConcurrentRuns) throw codedError("VSUP_LIMIT_EXCEEDED", "No active run slot is available for continuation.");
      runtime.slot = true; this.activeSlots += 1;
      if (!runtime.handle) {
        let recovered: BackendRunHandle | undefined;
        try { recovered = await runtime.backend.recover(runtime.record, this.callbacks(runtime)); }
        catch { recovered = undefined; }
        if (!recovered) { this.releaseSlot(runtime); throw codedError("VSUP_SESSION_NOT_RESUMABLE", "No live backend session is available for continuation."); }
        runtime.handle = recovered;
      }
      if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
      delete runtime.record.finishedAt;
      runtime.record.launchedAt = new Date().toISOString();
      await this.setState(runtime, "running", { startedAt: runtime.record.launchedAt });
      this.armDeadline(runtime, runtime.record.limits.timeoutSeconds * 1000);
    }
    await runtime.backend.continue(runtime.handle!, input.message);
    return { run_id: runtime.record.runId, state: runtime.record.state };
  }

  async respond(value: RespondToolInput): Promise<Record<string, unknown>> {
    const input = parseInput(respondSchema, value); const runtime = this.requireRun(input.run_id);
    const pending = runtime.record.pendingRequest;
    if (!pending || pending.requestId !== input.request_id || pending.kind !== input.kind) throw codedError("VSUP_REQUEST_EXPIRED", "The request is no longer pending for this run.");
    if (!runtime.backend) throw codedError("VSUP_SESSION_NOT_RESUMABLE", "No live backend session is available to receive this response.");
    if (input.kind === "permission" && pending.kind === "permission") {
      const policy = await this.policy.evaluate(runtime.record.mode, runtime.record.workerWorkspace, pending, runtime.allowShell);
      if (policy.kind === "deny" && this.policy.offeredDenyOption(pending) !== input.option_id) throw codedError("VSUP_PERMISSION_REQUIRED", "This permission is outside the configured safety policy.");
    }
    const response: BackendRespondInput = input.kind === "permission"
      ? (() => {
        if (pending.kind !== "permission" || !pending.options.some((option) => option.optionId === input.option_id)) throw codedError("VSUP_PERMISSION_REQUIRED", "option_id must match an option actually offered by Vibe.");
        if (!this.policy.userChoiceAllowed(pending, input.option_id)) throw codedError("VSUP_PERMISSION_REQUIRED", "This permission is outside the configured safety policy.");
        return { requestId: input.request_id, kind: "permission", optionId: input.option_id };
      })()
      : (() => {
        if (pending.kind !== "elicitation") throw codedError("VSUP_INPUT_REQUIRED", "This request is not an elicitation.");
        validateElicitation(pending.schema, input.action, input.content);
        return { requestId: input.request_id, kind: "elicitation", action: input.action, ...(input.content ? { content: input.content } : {}) };
      })();
    if (pending.kind === "permission") {
      const latest = await this.policy.evaluate(runtime.record.mode, runtime.record.workerWorkspace, pending, runtime.allowShell);
      if (latest.kind === "deny" && this.policy.offeredDenyOption(pending) !== response.optionId) throw codedError("VSUP_PERMISSION_REQUIRED", "This permission is outside the configured safety policy.");
      if (!this.policy.userChoiceAllowed(pending, response.optionId ?? "")) throw codedError("VSUP_PERMISSION_REQUIRED", "This permission is outside the configured safety policy.");
    }
    if (runtime.handle) await runtime.backend.respond(runtime.handle, response);
    else runtime.deferredResponses.push(response);
    delete runtime.record.pendingRequest;
    await this.persist(runtime);
    await this.setState(runtime, "running");
    return { run_id: runtime.record.runId, state: runtime.record.state };
  }

  async result(value: ResultToolInput): Promise<Record<string, unknown>> {
    const input = parseInput(resultSchema, value); const runtime = this.requireRun(input.run_id); const record = runtime.record;
    const result = record.result;
    if (input.detail === "compact") return this.compactResult(runtime, input.include_transcript);
    const deprecation = input.detail === "summary" ? { deprecation: SUMMARY_DEPRECATION } : {};
    if (!result) return { run_id: record.runId, state: record.state, backend: record.backend, summary: "Run has not produced a result yet.", artifacts: [], changed_files: [], warnings: [], ...(record.error ? { error: record.error } : {}), ...deprecation };
    const output: Record<string, unknown> = {
      schema_version: 1, run_id: record.runId, state: record.state, backend: record.backend,
      ...(result.stopReason ? { stop_reason: result.stopReason } : {}),
      summary: result.summary ?? "",
      workspace: { source: record.sourceWorkspace, worker: record.workerWorkspace },
      artifacts: (result.artifacts ?? []).map(artifactToWire),
      changed_files: result.changedFiles ?? [], ...(record.usage ? { usage: usageToWire(record.usage) } : {}), warnings: result.warnings ?? [], ...(result.integrity ? { integrity: integrityToWire(result.integrity) } : {}), ...(record.error ? { error: record.error } : {}),
      ...deprecation
    };
    if (input.include_transcript) {
      const transcriptPath = path.join(runtime.directory, "transcript.md");
      try {
        const info = await lstat(transcriptPath);
        if (info.isFile() && !info.isSymbolicLink() && info.size <= MAX_INLINE_TRANSCRIPT) output.transcript = await readFile(transcriptPath, "utf8");
      } catch { /* Transcript is optional and may be absent. */ }
    }
    return output;
  }

  private async compactResult(runtime: Runtime, includeTranscript: boolean, reserveChars = 0): Promise<Record<string, unknown>> {
    const record = runtime.record; const result = record.result;
    const output: Record<string, unknown> = { run_id: record.runId, state: record.state, backend: record.backend };
    if (!result) {
      output.summary = "Run has not produced a result yet.";
      output.warnings = [];
      if (record.error) output.error = record.error;
      return output;
    }
    const artifacts = result.artifacts ?? []; const files = result.changedFiles ?? [];
    if (result.stopReason) output.stop_reason = result.stopReason;
    output.summary = result.summary ?? "";
    output.warnings = result.warnings ?? [];
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

  async cancel(value: CancelToolInput): Promise<Record<string, unknown>> {
    const input = parseInput(cancelSchema, value); const runtime = this.requireRun(input.run_id);
    if (isTerminal(runtime.record.state) || runtime.record.state === "completed") return { run_id: input.run_id, state: runtime.record.state };
    runtime.cancelRequested = true;
    this.removeFromPending(runtime);
    const sessionBackend = runtime.backend; const sessionHandle = runtime.handle;
    if (sessionHandle && sessionBackend) {
      delete runtime.handle;
      try { await sessionBackend.cancel(sessionHandle); } catch { /* State remains cancelled; diagnostics are redacted and generic. */ }
    }
    if (!isTerminal(runtime.record.state)) {
      await this.finalizeArtifacts(runtime, "cancelled").catch(() => undefined);
      await this.setState(runtime, "cancelled", { finishedAt: new Date().toISOString() });
    }
    this.releaseSlot(runtime);
    return { run_id: input.run_id, state: runtime.record.state };
  }

  async close(value: CloseToolInput): Promise<Record<string, unknown>> {
    const input = parseInput(closeSchema, value); const runtime = this.requireRun(input.run_id);
    if (!isTerminal(runtime.record.state)) await this.cancel({ run_id: input.run_id });
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
    await this.setState(runtime, "closing");
    if (runtime.handle && runtime.backend) await runtime.backend.close(runtime.handle).catch(() => undefined);
    delete runtime.handle;
    if (input.cleanup_worktree && runtime.record.worktree) await this.cleanupWorktree(runtime);
    await this.setState(runtime, "closed", { finishedAt: runtime.record.finishedAt ?? new Date().toISOString() });
    return { run_id: runtime.record.runId, state: runtime.record.state };
  }

  async runsList(): Promise<Record<string, unknown>[]> {
    await this.ready();
    return [...this.runs.values()].map((runtime) => ({
      run_id: runtime.record.runId, mode: runtime.record.mode, backend: runtime.record.backend,
      state: runtime.record.state, created_at: runtime.record.createdAt, updated_at: runtime.record.updatedAt,
      source_workspace: runtime.record.sourceWorkspace, worker_workspace: runtime.record.workerWorkspace
    })).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  /** Removes only expired terminal run records without a retained worktree. */
  async cleanup(runId?: string): Promise<Record<string, unknown>> {
    await this.ready();
    if (runId) {
      const runtime = this.requireRun(runId);
      const removed = await this.cleanupWorktree(runtime);
      return { run_id: runId, worktree_removed: removed };
    }
    const cutoff = Date.now() - this.config.retention.days * 86_400_000;
    const removed: string[] = [];
    for (const [id, runtime] of this.runs) {
      const record = runtime.record;
      if (!isTerminal(record.state) || Date.parse(record.updatedAt) > cutoff || record.worktree) continue;
      if (record.state === "failed" && this.config.retention.preserveFailedRuns) continue;
      await rm(runtime.directory, { recursive: true, force: false });
      this.runs.delete(id); removed.push(id);
    }
    return { removed_run_ids: removed };
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const runtime of this.runs.values()) this.notify(runtime);
    const active = [...this.runs.values()].filter((runtime) => runtime.slot || runtime.record.state === "queued" || Boolean(runtime.handle));
    await Promise.all(active.map(async (runtime) => {
      await runtime.serial;
      runtime.cancelRequested = true;
      this.removeFromPending(runtime);
      if (runtime.handle && runtime.backend) await runtime.backend.close(runtime.handle).catch(() => undefined);
      if (runtime.record.state === "queued") await this.setState(runtime, "cancelled", { finishedAt: new Date().toISOString(), error: supervisorError("VSUP_CANCELLED", "Queued task was not submitted before shutdown.") }).catch(() => undefined);
      else if (!isTerminal(runtime.record.state) && runtime.record.state !== "completed") {
        await this.finalizeArtifacts(runtime, "recoverable").catch(() => undefined);
        await this.setState(runtime, "recoverable", { finishedAt: new Date().toISOString() }).catch(() => undefined);
      }
      if (runtime.timer) clearTimeout(runtime.timer);
      if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
      this.releaseSlot(runtime);
    }));
    await this.releaseOwnerLock();
  }

  private async ready(): Promise<void> { if (!this.initialized) await this.initialize(); }

  private async acquireOwnerLock(): Promise<void> {
    const lockPath = path.join(this.dataDir, "supervisor.lock");
    const recoveryLock = path.join(this.dataDir, "supervisor.lock.recovery");
    const token = randomUUID();
    const payload = JSON.stringify({ pid: process.pid, token, started_at: new Date().toISOString() });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try { await handle.writeFile(payload, "utf8"); await handle.sync(); } finally { await handle.close(); }
        this.ownerToken = token; this.ownerLockPath = lockPath; return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const recoveryToken = randomUUID();
        let recoveryHandle;
        try { recoveryHandle = await open(recoveryLock, "wx", 0o600); }
        catch (recoveryError) { if ((recoveryError as NodeJS.ErrnoException).code === "EEXIST") throw codedError("VSUP_INVALID_STATE", "Another process is recovering the supervisor owner lock; retry shortly."); throw recoveryError; }
        try {
          await recoveryHandle.writeFile(JSON.stringify({ pid: process.pid, token: recoveryToken }), "utf8"); await recoveryHandle.sync();
        } finally { await recoveryHandle.close(); }
        try {
          const info = await lstat(lockPath);
          if (info.isSymbolicLink() || !info.isFile() || info.size > 4096) throw codedError("VSUP_INVALID_STATE", "The supervisor owner lock is unsafe; inspect it manually.");
          const currentText = await readFile(lockPath, "utf8");
          let current: unknown;
          try { current = JSON.parse(currentText) as unknown; } catch { throw codedError("VSUP_INVALID_STATE", "The supervisor owner lock is malformed; inspect it manually."); }
          if (!current || typeof current !== "object" || !("pid" in current) || typeof current.pid !== "number" || !Number.isSafeInteger(current.pid) || current.pid <= 0 || !("token" in current) || typeof current.token !== "string") throw codedError("VSUP_INVALID_STATE", "The supervisor owner lock is invalid; inspect it manually.");
          try {
            process.kill(current.pid, 0);
            throw codedError("VSUP_INVALID_STATE", "Another Vibe Supervisor process owns this data directory.");
          } catch (probeError) {
            if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw probeError;
          }
          if (await readFile(lockPath, "utf8") !== currentText) throw codedError("VSUP_INVALID_STATE", "Supervisor lock changed during stale-owner recovery; retry.");
          await rm(lockPath, { force: false });
        } finally {
          try {
            const guard = JSON.parse(await readFile(recoveryLock, "utf8")) as { token?: unknown };
            if (guard.token === recoveryToken) await rm(recoveryLock, { force: false });
          } catch { /* Do not remove another process's recovery lock. */ }
        }
      }
    }
    throw codedError("VSUP_INVALID_STATE", "Could not acquire the supervisor data-directory lock.");
  }

  private async releaseOwnerLock(): Promise<void> {
    if (!this.ownerLockPath || !this.ownerToken) return;
    try {
      const info = await lstat(this.ownerLockPath);
      if (info.isFile() && !info.isSymbolicLink() && info.size <= 4096) {
        const lock = JSON.parse(await readFile(this.ownerLockPath, "utf8")) as { token?: unknown };
        if (lock.token === this.ownerToken) await rm(this.ownerLockPath, { force: false });
      }
    } catch { /* Preserve a replaced, malformed, or already removed lock. */ }
    this.ownerToken = undefined; this.ownerLockPath = undefined;
  }

  private makeRuntime(record: RunRecord, directory: string, task: string, contextFiles: string[], allowShell: boolean, backendPreference: "auto" | BackendKind, events: SupervisorEvent[] = []): Runtime {
    return { record, directory, task, contextFiles, allowShell, backendPreference, events, eventSeq: events.at(-1)?.seq ?? 0, transcript: "", serial: Promise.resolve(), slot: false, cancelRequested: false, started: false, deferredResponses: [], transcriptOverflow: false, completionOrder: 0, persistChain: Promise.resolve(), waiters: new Set() };
  }

  private async loadDefaultBackends(): Promise<void> {
    const [acpModule, programmaticModule] = await Promise.all([
      import("../backends/acp.js"), import("../backends/programmatic.js")
    ]);
    this.backends.set("acp", new acpModule.AcpBackend(this.config, this.dataDir));
    this.backends.set("programmatic", new programmaticModule.ProgrammaticBackend(this.config));
  }

  private async launch(runtime: Runtime): Promise<void> {
    if (runtime.cancelRequested || isTerminal(runtime.record.state)) { this.releaseSlot(runtime); return; }
    runtime.record.launchedAt = new Date().toISOString();
    this.armDeadline(runtime, runtime.record.limits.timeoutSeconds * 1000);
    try {
      let workerWorkspace = runtime.record.sourceWorkspace;
      let baseRef: string | undefined;
      if (runtime.record.mode === "edit") {
        const requestedBase = runtime.record.worktree?.baseRef ?? "HEAD";
        baseRef = await resolveBaseCommit(runtime.record.sourceWorkspace, requestedBase);
        const worktree = await createDetachedWorktree(runtime.record.sourceWorkspace, runtime.record.workerWorkspace, baseRef);
        runtime.record.worktree = worktree; runtime.record.workerWorkspace = worktree.path; workerWorkspace = worktree.path;
      } else {
        try {
          const snapshot = await snapshotWorkspace(runtime.record.sourceWorkspace);
          runtime.sourceSnapshot = snapshot.sha256; runtime.sourceManifest = snapshot.manifest;
          runtime.record.workspaceSnapshotSha256 = snapshot.sha256;
        } catch {
          delete runtime.sourceSnapshot; delete runtime.sourceManifest; delete runtime.record.workspaceSnapshotSha256;
          runtime.snapshotFailed = true;
        }
        await this.persist(runtime);
      }
      if (runtime.cancelRequested || isTerminal(runtime.record.state)) return;
      const backend = await this.selectBackend(runtime.backendPreference);
      runtime.backend = backend; runtime.record.backend = backend.kind;
      const contextFiles = runtime.contextFiles.map((file) => path.resolve(runtime.record.sourceWorkspace, file));
      const limits = runtime.record.limits;
      const input = {
        runId: runtime.record.runId, mode: runtime.record.mode, task: runtime.task,
        cwd: runtime.record.sourceWorkspace, workerWorkspace, runDirectory: runtime.directory,
        ...(baseRef ? { baseRef } : {}), ...(contextFiles.length ? { contextFiles } : {}), allowShell: runtime.record.mode === "edit" && runtime.allowShell && this.config.security.allowShellInEdit,
        limits
      };
      await this.setState(runtime, "negotiating");
      const result = await backend.start(input, this.callbacks(runtime));
      runtime.handle = result.handle;
      if (result.process) runtime.record.process = result.process;
      if (result.acp) runtime.record.acp = result.acp;
      runtime.started = true;
      if (runtime.cancelRequested || runtime.record.state === "cancelled") {
        await backend.cancel(result.handle).catch(() => undefined);
        await backend.close(result.handle).catch(() => undefined);
        return;
      }
      for (const response of runtime.deferredResponses.splice(0)) await backend.respond(result.handle, response).catch(() => undefined);
      if (!isTerminal(runtime.record.state) && runtime.record.state === "negotiating") await this.setState(runtime, result.initialState === "starting" ? "running" : result.initialState, { startedAt: runtime.record.startedAt ?? new Date().toISOString() });
    } catch (error) {
      if (runtime.cancelRequested || runtime.record.state === "cancelled") return;
      const normalized = normalizeError(error);
      await this.setState(runtime, "failed", { error: normalized, finishedAt: new Date().toISOString() }).catch(() => undefined);
      await this.finalizeArtifacts(runtime, "failed").catch(() => undefined);
      await this.releaseSession(runtime);
      this.releaseSlot(runtime);
    }
  }

  private async selectBackend(preference: "auto" | BackendKind): Promise<SupervisorBackend> {
    const configured = this.config.backend;
    const kind = preference !== "auto" ? preference : configured !== "auto" ? configured : "auto";
    const candidates = kind === "auto" ? ["acp", "programmatic"] as const : [kind];
    for (const candidate of candidates) {
      const backend = this.backends.get(candidate);
      if (!backend) continue;
      const capability = await backend.probe();
      if (capability.available) return backend;
    }
    throw codedError("VSUP_BACKEND_UNAVAILABLE", "No configured backend passed its availability probe.");
  }

  private callbacks(runtime: Runtime): BackendCallbacks {
    return {
      onEvent: (event) => this.stopping ? undefined : this.serial(runtime, async () => this.appendEvent(runtime, event)),
      onPendingRequest: (pending) => this.stopping ? undefined : this.receivePending(runtime, pending),
      onState: (state, update) => this.stopping ? undefined : this.serial(runtime, async () => this.applyBackendState(runtime, state, update)).catch((error: unknown) => this.recordIgnoredTransition(runtime, state, error))
    };
  }

  private async recordIgnoredTransition(runtime: Runtime, reportedState: RunState, error: unknown): Promise<void> {
    if ((error as { code?: unknown } | null)?.code !== "VSUP_INVALID_STATE") throw error;
    const message = redactSecrets(error instanceof Error ? error.message : "Invalid run state transition.").slice(0, 512);
    await this.serial(runtime, async () => this.appendEvent(runtime, { source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "ignored_backend_state_transition", backend_state: reportedState, run_state: runtime.record.state, message } }, true)).catch(() => undefined);
  }

  private async appendEvent(runtime: Runtime, event: Parameters<BackendCallbacks["onEvent"]>[0], allowTerminal = false): Promise<void> {
    if (isTerminal(runtime.record.state) && !allowTerminal) return;
    const type = String(event.type).slice(0, 128);
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
          queueMicrotask(() => { void this.fail(runtime, supervisorError("VSUP_OUTPUT_LIMIT", "The transcript reached its configured byte limit.")); });
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
    const file = path.join(runtime.directory, "events.ndjson");
    const maxBytes = runtime.record.limits.maxEventBytes;
    try { await appendNdjson(file, eventToWire(full), { maxBytes }); }
    catch (error) {
      if (error instanceof RangeError) {
        runtime.cancelRequested = true;
        queueMicrotask(() => { void this.fail(runtime, supervisorError("VSUP_OUTPUT_LIMIT", "The event log reached its configured byte limit.")); });
        return;
      }
      throw error;
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

  private async receivePending(runtime: Runtime, pending: PendingRequest | undefined): Promise<void> {
    if (!pending) {
      await this.serial(runtime, async () => {
        delete runtime.record.pendingRequest;
        if (!isTerminal(runtime.record.state) && runtime.record.state !== "completed") await this.setState(runtime, "running");
      });
      return;
    }
    const decision = await this.policy.evaluate(runtime.record.mode, runtime.record.workerWorkspace, pending, runtime.allowShell);
    if (decision.kind === "prompt") {
      await this.serial(runtime, async () => {
        if (isTerminal(runtime.record.state)) return;
        runtime.record.pendingRequest = pending;
        await this.setState(runtime, pending.kind === "permission" ? "waiting_permission" : "waiting_input");
      });
      return;
    }
    const denyOption = this.policy.offeredDenyOption(pending);
    await this.serial(runtime, async () => {
      if (isTerminal(runtime.record.state)) return;
      delete runtime.record.pendingRequest;
      await this.appendEvent(runtime, { source: "supervisor", type: "permission_denied_by_policy", severity: "warning", data: { request_id: pending.requestId, reason: decision.reason } });
      if (denyOption) {
        const response: BackendRespondInput = { requestId: pending.requestId, kind: "permission", optionId: denyOption };
        runtime.deferredResponses.push(response);
        if (runtime.handle && runtime.backend) {
          runtime.deferredResponses.splice(runtime.deferredResponses.indexOf(response), 1);
          setImmediate(() => { void runtime.backend?.respond(runtime.handle!, response).catch(() => undefined); });
        }
      } else {
        runtime.cancelRequested = true;
        await this.setState(runtime, "failed", { error: supervisorError("VSUP_PERMISSION_REQUIRED", "The requested tool action is outside the configured safety policy."), finishedAt: new Date().toISOString() });
        this.releaseSlot(runtime);
        const sessionBackend = runtime.backend; const sessionHandle = runtime.handle;
        if (sessionHandle && sessionBackend) {
          delete runtime.handle;
          setImmediate(() => { void sessionBackend.cancel(sessionHandle).catch(() => undefined); });
        }
      }
    });
  }

  private async applyBackendState(runtime: Runtime, state: RunState, update?: Partial<Pick<RunRecord, "usage" | "result" | "error" | "process" | "acp">>): Promise<void> {
    if (isTerminal(runtime.record.state) || runtime.record.state === "closing") return;
    if (runtime.record.state === "completed" && (state === "failed" || state === "cancelled" || state === "completed")) {
      if (state === "failed") await this.releaseSession(runtime);
      return;
    }
    if (update?.usage) runtime.record.usage = update.usage;
    if (update?.result) runtime.record.result = update.result;
    if (update?.process) runtime.record.process = update.process;
    if (update?.acp) runtime.record.acp = update.acp;
    if (state === "completed") {
      this.endTranscriptTurn(runtime);
      try {
        await this.assessReviewIntegrity(runtime);
        await this.finalizeArtifacts(runtime, "completed");
        await this.setState(runtime, "completed", { finishedAt: new Date().toISOString() });
        runtime.completionOrder = ++this.completionCounter;
        this.scheduleIdleExpiration(runtime);
      } catch (error) {
        await this.setState(runtime, "failed", { error: error instanceof Error && "code" in error ? normalizeError(error) : supervisorError("VSUP_ARTIFACT_ERROR", "Could not finish and verify the run artifacts."), finishedAt: new Date().toISOString() });
        await this.releaseSession(runtime);
      }
      this.releaseSlot(runtime);
      this.enforceIdleSessionCap();
      return;
    }
    if (state === "failed") {
      await this.assessReviewIntegrity(runtime);
      await this.finalizeArtifacts(runtime, "failed").catch(() => undefined);
      await this.setState(runtime, "failed", { finishedAt: new Date().toISOString(), ...(update?.error ? { error: update.error } : {}) });
      await this.releaseSession(runtime);
      this.releaseSlot(runtime); return;
    }
    if (state === "cancelled") {
      await this.assessReviewIntegrity(runtime);
      await this.finalizeArtifacts(runtime, "cancelled").catch(() => undefined);
      if (runtime.pendingFailure) {
        await this.setState(runtime, "failed", { error: runtime.pendingFailure, finishedAt: new Date().toISOString() });
        delete runtime.pendingFailure;
      } else await this.setState(runtime, "cancelled", { finishedAt: new Date().toISOString() });
      await this.releaseSession(runtime);
      this.releaseSlot(runtime); return;
    }
    await this.setState(runtime, state, update);
  }

  private async finalizeArtifacts(runtime: Runtime, resultState: RunState = runtime.record.state): Promise<void> {
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
    try { await lstat(eventsPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") await this.atomicWriteText(eventsPath, ""); else throw error; }
    const artifacts: NonNullable<RunRecord["result"]>["artifacts"] = [];
    if (patchInfo) {
      artifacts.push(await describeArtifact("diff.patch", patchInfo.patchPath, "text/x-diff"));
      artifacts.push(await describeArtifact("diff.stat", patchInfo.statPath, "text/plain"));
      const changedPath = path.join(artifactDir, "changed-files.json");
      artifacts.push(await describeArtifact("changed-files.json", changedPath, "application/json"));
    }
    artifacts.push(await describeArtifact("transcript.md", path.join(runtime.directory, "transcript.md"), "text/markdown"));
    artifacts.push(await describeArtifact("events.ndjson", path.join(runtime.directory, "events.ndjson"), "application/x-ndjson"));
    const artifactBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
    if (artifactBytes > runtime.record.limits.maxArtifactBytes) throw codedError("VSUP_OUTPUT_LIMIT", "Run artifacts exceeded the configured byte limit.");
    const summary = runtime.record.result?.summary ?? (resultState === "completed" ? "Vibe completed the delegated task." : "Vibe run ended before normal completion.");
    runtime.record.result = {
      ...(runtime.record.result?.stopReason ? { stopReason: runtime.record.result.stopReason } : {}),
      summary,
      artifacts,
      changedFiles: patchInfo?.changedFiles ?? [],
      warnings: runtime.record.result?.warnings ?? [],
      ...(runtime.record.result?.integrity ? { integrity: runtime.record.result.integrity } : {})
    };
    const resultWire = {
      schema_version: 1, run_id: runtime.record.runId, state: resultState, backend: runtime.record.backend,
      ...(runtime.record.result.stopReason ? { stop_reason: runtime.record.result.stopReason } : {}),
      summary,
      workspace: { source: runtime.record.sourceWorkspace, worker: runtime.record.workerWorkspace },
      artifacts: artifacts.map(artifactToWire), changed_files: patchInfo?.changedFiles ?? [],
      ...(runtime.record.usage ? { usage: usageToWire(runtime.record.usage) } : {}), warnings: runtime.record.result.warnings ?? [],
      ...(runtime.record.result.integrity ? { integrity: integrityToWire(runtime.record.result.integrity) } : {})
    };
    await atomicWriteJson(path.join(runtime.directory, "result.json"), resultWire);
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

  private async cleanupWorktree(runtime: Runtime): Promise<boolean> {
    const worktree = runtime.record.worktree;
    if (!worktree || !runtime.verifiedPatch || !worktree.createdBySupervisor) return false;
    await removeVerifiedWorktree(runtime.record.sourceWorkspace, worktree, runtime.verifiedPatch);
    delete runtime.record.worktree;
    await this.persist(runtime);
    return true;
  }

  private async deadline(runtime: Runtime): Promise<void> {
    if (isTerminal(runtime.record.state) || runtime.record.state === "completed") return;
    runtime.cancelRequested = true; runtime.pendingFailure = supervisorError("VSUP_TIMEOUT", "The run exceeded its configured timeout."); this.removeFromPending(runtime);
    const backend = runtime.backend; const handle = runtime.handle;
    if (backend && handle) { delete runtime.handle; await backend.cancel(handle).catch(() => undefined); }
    await this.serial(runtime, async () => {
      if (isTerminal(runtime.record.state) || runtime.record.state === "completed") return;
      await this.appendEvent(runtime, { source: "supervisor", type: "timeout", severity: "warning", data: { timeout_seconds: runtime.record.limits.timeoutSeconds } });
      await this.finalizeArtifacts(runtime, "failed").catch(() => undefined);
      await this.setState(runtime, "failed", { error: runtime.pendingFailure ?? supervisorError("VSUP_TIMEOUT", "The run exceeded its configured timeout."), finishedAt: new Date().toISOString() });
      delete runtime.pendingFailure;
      this.releaseSlot(runtime);
    });
  }

  private async setState(runtime: Runtime, state: RunState, update?: Partial<Pick<RunRecord, "usage" | "result" | "error" | "process" | "acp"> & { startedAt?: string; finishedAt?: string }>): Promise<void> {
    if (isTerminal(runtime.record.state) && state !== "closing" && state !== "closed") return;
    assertTransition(runtime.record.state, state);
    runtime.record.state = state;
    runtime.record.updatedAt = new Date().toISOString();
    if (update?.usage) runtime.record.usage = update.usage;
    if (update?.result) runtime.record.result = update.result;
    if (update?.error) runtime.record.error = update.error;
    if (update?.process) runtime.record.process = update.process;
    if (update?.acp) runtime.record.acp = update.acp;
    if (update?.startedAt) runtime.record.startedAt = update.startedAt;
    if (update?.finishedAt) runtime.record.finishedAt = update.finishedAt;
    if ((isTerminal(state) || state === "completed") && runtime.timer) clearTimeout(runtime.timer);
    await this.persist(runtime);
    if (isTerminal(state)) this.persisted.set(runtime.record.runId, runtime.record);
    this.notify(runtime);
  }

  private async persist(runtime: Runtime): Promise<void> {
    const write = runtime.persistChain.then(() => atomicWriteJson(path.join(runtime.directory, "meta.json"), runToWire(runtime.record)));
    runtime.persistChain = write.then(() => undefined, () => undefined);
    await write;
  }

  private serial<T>(runtime: Runtime, fn: () => Promise<T>): Promise<T> {
    const next = runtime.serial.then(fn, fn);
    runtime.serial = next.then(() => undefined, () => undefined);
    return next;
  }

  private releaseSlot(runtime: Runtime): void {
    if (runtime.slot) { runtime.slot = false; this.activeSlots = Math.max(0, this.activeSlots - 1); }
    if (runtime.timer) clearTimeout(runtime.timer);
    this.pumpQueue();
  }

  private resumeDeadline(runtime: Runtime): void {
    if (runtime.record.state === "completed") return;
    const deadline = Date.parse(runtime.record.launchedAt ?? runtime.record.startedAt ?? runtime.record.createdAt) + runtime.record.limits.timeoutSeconds * 1000;
    const remaining = deadline - Date.now();
    if (remaining <= 0) { void this.deadline(runtime); return; }
    this.armDeadline(runtime, remaining);
  }

  private scheduleIdleExpiration(runtime: Runtime): void {
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
    if (!runtime.handle || !runtime.backend) return;
    runtime.idleTimer = setTimeout(() => { void this.releaseIdleHandle(runtime, "idle_expired"); }, this.config.workerIdleTtlSeconds * 1000);
    runtime.idleTimer.unref?.();
  }

  private async releaseSession(runtime: Runtime): Promise<void> {
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
    const backend = runtime.backend; const handle = runtime.handle;
    delete runtime.handle;
    if (backend && handle) await backend.close(handle).catch(() => undefined);
  }

  private async releaseIdleHandle(runtime: Runtime, eventType: "idle_expired" | "idle_evicted"): Promise<void> {
    if (runtime.record.state !== "completed" || runtime.slot || !runtime.handle || !runtime.backend) return;
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
    const backend = runtime.backend; const handle = runtime.handle;
    delete runtime.handle;
    await backend.close(handle).catch(() => undefined);
    await this.serial(runtime, async () => {
      if (runtime.record.state === "completed") await this.appendEvent(runtime, { source: "supervisor", type: eventType, severity: "info", data: { idle_ttl_seconds: this.config.workerIdleTtlSeconds, max_idle_sessions: this.config.maxConcurrentRuns } });
    }).catch(() => undefined);
  }

  private enforceIdleSessionCap(): void {
    const idle = [...this.runs.values()].filter((candidate) => candidate.record.state === "completed" && !candidate.slot && candidate.handle).sort((a, b) => a.completionOrder - b.completionOrder);
    for (const evicted of idle.slice(0, Math.max(0, idle.length - this.config.maxConcurrentRuns))) void this.releaseIdleHandle(evicted, "idle_evicted");
  }

  private armDeadline(runtime: Runtime, milliseconds: number): void {
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = setTimeout(() => { void this.deadline(runtime); }, milliseconds);
    runtime.timer.unref?.();
  }

  private async assessReviewIntegrity(runtime: Runtime): Promise<void> {
    if (runtime.record.mode !== "review" || runtime.record.result?.integrity) return;
    const writeToolObserved = runtime.events.some(isWriteEvidence);
    let integrity: ReviewIntegrity;
    if (!runtime.sourceSnapshot) {
      integrity = { status: "unverified", writeToolObserved, reason: runtime.snapshotFailed ? "The launch snapshot failed: the workspace is too large or unreadable." : "No launch snapshot is available for this run." };
    } else {
      try {
        const end = await snapshotWorkspace(runtime.record.sourceWorkspace);
        if (end.sha256 === runtime.sourceSnapshot) integrity = { status: "verified", writeToolObserved };
        else {
          const paths = runtime.sourceManifest ? diffManifests(runtime.sourceManifest, end.manifest) : [];
          integrity = {
            status: "changed", writeToolObserved,
            changedPaths: paths.slice(0, MAX_INTEGRITY_PATHS), changedPathsTotal: paths.length,
            reason: runtime.sourceManifest ? `The source workspace content changed between the launch snapshot and the end of the run (${paths.length} paths).` : "The source workspace content changed, but the launch manifest is unavailable so the paths are unknown."
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
      await this.appendEvent(runtime, { source: "supervisor", type: "review_integrity", severity: integrity.status === "changed" && writeToolObserved ? "error" : "warning", data: integrityToWire(integrity) });
    }
  }

  private pumpQueue(): void {
    while (!this.stopping && this.activeSlots < this.config.maxConcurrentRuns && this.pending.length) {
      const next = this.pending.shift();
      if (!next || next.cancelRequested || isTerminal(next.record.state)) continue;
      next.slot = true; this.activeSlots += 1;
      void this.setState(next, "starting").then(() => this.launch(next)).catch((error) => this.fail(next, normalizeError(error)));
    }
  }

  private async fail(runtime: Runtime, error: SupervisorError): Promise<void> {
    runtime.cancelRequested = true;
    runtime.pendingFailure = error;
    const backend = runtime.backend; const handle = runtime.handle;
    if (backend && handle && !isTerminal(runtime.record.state)) { delete runtime.handle; await backend.cancel(handle).catch(() => undefined); }
    await this.serial(runtime, async () => {
      if (isTerminal(runtime.record.state)) return;
      await this.setState(runtime, "failed", { error, finishedAt: new Date().toISOString() });
      await this.finalizeArtifacts(runtime, "failed").catch(() => undefined);
      this.releaseSlot(runtime);
    });
  }

  private removeFromPending(runtime: Runtime): void {
    const index = this.pending.indexOf(runtime);
    if (index >= 0) this.pending.splice(index, 1);
  }

  private requireRun(id: string): Runtime {
    if (!UUID_V4.test(id)) throw codedError("VSUP_NOT_FOUND", "Run was not found.");
    const runtime = this.runs.get(id);
    if (!runtime) throw codedError("VSUP_NOT_FOUND", "Run was not found.");
    return runtime;
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseInput<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try { return schema.parse(value); }
  catch (error) { throw codedError("VSUP_INVALID_ARGUMENT", error instanceof Error ? error.message : "Invalid tool input."); }
}

function codedError(code: SupervisorErrorCode, message: string): Error & { code: SupervisorErrorCode; remediation: string; retryable: boolean } {
  const normalized = supervisorError(code, message);
  return Object.assign(new Error(message), normalized);
}

function normalizeError(error: unknown): SupervisorError {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && error.code.startsWith("VSUP_")) {
    const code = error.code as SupervisorErrorCode;
    const message = "message" in error && typeof error.message === "string" ? error.message : code;
    const known = supervisorError(code, message);
    return { ...known, retryable: "retryable" in error && error.retryable === true };
  }
  return { code: "VSUP_BACKEND_ERROR", message: "The backend failed. Check the run diagnostics for details.", remediation: DEFAULT_REMEDIATION, retryable: false };
}

function pendingToWire(pending: PendingRequest): Record<string, unknown> {
  if (pending.kind === "permission") return {
    request_id: pending.requestId, kind: pending.kind, title: pending.title,
    options: pending.options.map((option) => ({ option_id: option.optionId, name: option.name, ...(option.kind ? { kind: option.kind } : {}) })),
    ...(pending.tool ? { tool: { ...(pending.tool.kind ? { kind: pending.tool.kind } : {}), ...(pending.tool.locations ? { locations: pending.tool.locations } : {}) } } : {})
  };
  return { request_id: pending.requestId, kind: pending.kind, title: pending.title, ...(pending.schema ? { schema: pending.schema } : {}) };
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

const CHANGED_WITH_WRITE_WARNING = "Possible read-only boundary violation: the review worker issued a write-capable tool call and the source workspace changed. Inspect the changed paths before trusting the review.";
const CHANGED_WARNING = "The source workspace changed during this read-only review. The changes may be your own edits or a read-only boundary violation; inspect the changed paths before trusting the review.";
const UNVERIFIED_WARNING = "The source workspace could not be snapshotted (too large or unreadable); review integrity was NOT checked, so a read-only boundary violation would go undetected.";
const MAX_INTEGRITY_PATHS = 50;

function isWriteEvidence(event: SupervisorEvent): boolean {
  if (event.type !== "tool_call" && event.type !== "tool_call_update") return false;
  const kind = normalizeKind(typeof event.data.kind === "string" ? event.data.kind : undefined);
  if (kind === "edit" || kind === "delete" || kind === "move") return true;
  return [event.data.title, event.data.name].some((value) => typeof value === "string" && /^\s*(?:write_file|edit)(?![a-z0-9])/i.test(value));
}

function diffManifests(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const changed: string[] = [];
  for (const [file, digest] of before) if (after.get(file) !== digest) changed.push(file);
  for (const file of after.keys()) if (!before.has(file)) changed.push(file);
  return changed.sort();
}

export interface WorkspaceHashLimits { maxFiles: number; maxBytes: number }
const DEFAULT_HASH_LIMITS: WorkspaceHashLimits = { maxFiles: 200_000, maxBytes: 2 * 1024 * 1024 * 1024 };

export interface WorkspaceSnapshot { sha256: string; manifest: Map<string, string> }

export async function hashWorkspace(root: string, limits: WorkspaceHashLimits = DEFAULT_HASH_LIMITS): Promise<string> {
  return (await snapshotWorkspace(root, limits)).sha256;
}

export async function snapshotWorkspace(root: string, limits: WorkspaceHashLimits = DEFAULT_HASH_LIMITS): Promise<WorkspaceSnapshot> {
  const hash = createHash("sha256");
  const manifest = new Map<string, string>();
  let totalBytes = 0; let count = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (directory === root && entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name); const relative = path.relative(root, absolute);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) { const target = await readFileLink(absolute); manifest.set(relative, `L:${target}`); hash.update(`L${relative}\0${target}\0`); continue; }
      if (info.isDirectory()) { manifest.set(relative, "D"); hash.update(`D${relative}\0`); await visit(absolute); continue; }
      if (!info.isFile()) continue;
      count += 1; totalBytes += info.size;
      if (count > limits.maxFiles || totalBytes > limits.maxBytes) throw codedError("VSUP_OUTPUT_LIMIT", "Workspace snapshot exceeded its safety limits.");
      const fileHash = createHash("sha256");
      const handle = await open(absolute, "r");
      try { const buffer = Buffer.allocUnsafe(64 * 1024); while (true) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break; fileHash.update(buffer.subarray(0, bytesRead)); } }
      finally { await handle.close(); }
      const digest = fileHash.digest("hex");
      manifest.set(relative, `F:${digest}`);
      hash.update(`F${relative}\0${digest}\0`);
    }
  };
  await visit(root);
  return { sha256: hash.digest("hex"), manifest };
}

async function readFileLink(file: string): Promise<string> { const { readlink } = await import("node:fs/promises"); return readlink(file); }

function validateElicitation(schema: Record<string, unknown> | undefined, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>): void {
  if (action !== "accept") {
    if (content !== undefined) throw codedError("VSUP_INVALID_ARGUMENT", "Declined elicitation responses must not include content.");
    return;
  }
  if (!schema || !content) throw codedError("VSUP_INPUT_REQUIRED", "The elicitation requires a supported schema and response content.");
  let encoded: string;
  try { encoded = JSON.stringify(content); } catch { throw codedError("VSUP_INVALID_ARGUMENT", "Elicitation response must contain JSON values only."); }
  if (Buffer.byteLength(encoded) > 16_384 || Object.keys(content).length > 100) throw codedError("VSUP_INVALID_ARGUMENT", "Elicitation response exceeds its size limit.");
  const allowedRootKeys = new Set(["type", "properties", "required", "additionalProperties"]);
  if (Object.keys(schema).some((key) => !allowedRootKeys.has(key)) || schema.type !== "object" || schema.additionalProperties === true) {
    throw codedError("VSUP_INVALID_ARGUMENT", "The offered elicitation schema uses unsupported validation features.");
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw codedError("VSUP_INVALID_ARGUMENT", "The offered elicitation schema is unsupported.");
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some((key) => typeof key !== "string" || !(key in properties))) throw codedError("VSUP_INVALID_ARGUMENT", "The offered elicitation schema is unsupported.");
  const candidate = content as Record<string, unknown>;
  if (required.some((key) => !(key in candidate)) || Object.keys(candidate).some((key) => !(key in properties))) {
    throw codedError("VSUP_INVALID_ARGUMENT", "Elicitation response does not match the offered schema.");
  }
  const propertyKeys = new Set(["type", "enum", "minimum", "maximum", "minLength", "maxLength"]);
  for (const [key, specValue] of Object.entries(properties)) {
    if (!Object.hasOwn(candidate, key)) continue;
    if (!specValue || typeof specValue !== "object" || Array.isArray(specValue)) throw codedError("VSUP_INVALID_ARGUMENT", "The offered elicitation schema is unsupported.");
    const spec = specValue as Record<string, unknown>;
    const type = spec.type;
    if (Object.keys(spec).some((field) => !propertyKeys.has(field)) || !["string", "boolean", "number", "integer"].includes(String(type))) {
      throw codedError("VSUP_INVALID_ARGUMENT", "The offered elicitation schema uses unsupported validation features.");
    }
    const value = candidate[key];
    let valid = false;
    if (type === "string") {
      valid = typeof value === "string" && value.length >= (typeof spec.minLength === "number" ? spec.minLength : 0) && value.length <= (typeof spec.maxLength === "number" ? spec.maxLength : 16_384);
    } else if (type === "boolean") valid = typeof value === "boolean";
    else valid = typeof value === "number" && Number.isFinite(value) && (type !== "integer" || Number.isInteger(value)) && value >= (typeof spec.minimum === "number" ? spec.minimum : -Number.MAX_VALUE) && value <= (typeof spec.maximum === "number" ? spec.maximum : Number.MAX_VALUE);
    if (Array.isArray(spec.enum)) valid = valid && spec.enum.some((item) => Object.is(item, value));
    if (!valid) throw codedError("VSUP_INVALID_ARGUMENT", "Elicitation response does not match the offered schema.");
  }
}
