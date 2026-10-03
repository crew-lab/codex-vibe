import type { RunRecord, SupervisorErrorCode, SupervisorEvent } from "../contracts.js";

type JsonObject = Record<string, unknown>;

export function runToWire(run: RunRecord): JsonObject {
  const acp = run.acp ? {
    ...(run.acp.protocolVersion === undefined ? {} : { protocol_version: run.acp.protocolVersion }),
    ...(run.acp.sessionId === undefined ? {} : { session_id: run.acp.sessionId }),
    ...(run.acp.capabilities === undefined ? {} : { capabilities: run.acp.capabilities }),
    ...(run.acp.runDirectory === undefined ? {} : { run_directory: run.acp.runDirectory }),
    ...(run.acp.home === undefined ? {} : { home: run.acp.home }),
    ...(run.acp.vibeHome === undefined ? {} : { vibe_home: run.acp.vibeHome }),
    ...(run.acp.profileMode === undefined ? {} : { profile_mode: run.acp.profileMode })
  } : undefined;
  const usage = run.usage ? {
    ...(run.usage.tokensUsed === undefined ? {} : { tokens_used: run.usage.tokensUsed }),
    ...(run.usage.contextSize === undefined ? {} : { context_size: run.usage.contextSize }),
    ...(run.usage.cost === undefined ? {} : { cost: { amount: run.usage.cost.amount, currency: run.usage.cost.currency, authoritative: false } })
  } : undefined;
  return {
    schema_version: run.schemaVersion,
    run_id: run.runId,
    backend: run.backend,
    mode: run.mode,
    state: run.state,
    source_workspace: run.sourceWorkspace,
    worker_workspace: run.workerWorkspace,
    ...(run.worktree ? { worktree: {
      path: run.worktree.path,
      base_ref: run.worktree.baseRef,
      created_by_supervisor: run.worktree.createdBySupervisor
    } } : {}),
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    ...(run.startedAt ? { started_at: run.startedAt } : {}),
    ...(run.finishedAt ? { finished_at: run.finishedAt } : {}),
    task_sha256: run.taskSha256,
    ...(run.workspaceSnapshotSha256 ? { workspace_snapshot_sha256: run.workspaceSnapshotSha256 } : {}),
    ...(run.process ? { process: run.process } : {}),
    ...(acp ? { acp } : {}),
    limits: {
      timeout_seconds: run.limits.timeoutSeconds,
      max_turns: run.limits.maxTurns,
      max_event_bytes: run.limits.maxEventBytes,
      max_transcript_bytes: run.limits.maxTranscriptBytes,
      max_artifact_bytes: run.limits.maxArtifactBytes
    },
    ...(usage ? { usage } : {}),
    ...(run.pendingRequest ? { pending_request: pendingToWire(run.pendingRequest) } : {}),
    ...(run.result ? { result: resultToWire(run.result) } : {}),
    ...(run.error ? { error: run.error } : {})
  };
}

export function eventToWire(event: SupervisorEvent): JsonObject {
  return {
    schema_version: event.schemaVersion,
    seq: event.seq,
    timestamp: event.timestamp,
    run_id: event.runId,
    backend: event.backend,
    source: event.source,
    type: event.type,
    severity: event.severity,
    data: event.data
  };
}

export function eventFromWire(value: unknown): SupervisorEvent {
  if (!isObject(value) || value.schema_version !== 1 || !Number.isSafeInteger(value.seq) || typeof value.timestamp !== "string" || Number.isNaN(Date.parse(value.timestamp)) || typeof value.run_id !== "string" || typeof value.backend !== "string" || (value.backend !== "acp" && value.backend !== "programmatic") || typeof value.source !== "string" || !["supervisor", "vibe", "acp"].includes(value.source) || typeof value.type !== "string" || typeof value.severity !== "string" || !["debug", "info", "warning", "error"].includes(value.severity) || !isObject(value.data)) throw new TypeError("Invalid persisted supervisor event");
  return { schemaVersion: 1, seq: value.seq as number, timestamp: value.timestamp, runId: value.run_id, backend: value.backend, source: value.source as SupervisorEvent["source"], type: value.type, severity: value.severity as SupervisorEvent["severity"], data: value.data };
}

export function runFromWire(value: unknown): RunRecord {
  if (!isObject(value) || value.schema_version !== 1 || typeof value.run_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.run_id) || typeof value.backend !== "string" || (value.backend !== "acp" && value.backend !== "programmatic") || typeof value.mode !== "string" || (value.mode !== "review" && value.mode !== "edit") || typeof value.state !== "string" || !RUN_STATES.has(value.state as RunRecord["state"])) throw new TypeError("Invalid persisted run record");
  const limits = asObject(value.limits);
  const run: RunRecord = {
    schemaVersion: 1,
    runId: value.run_id,
    backend: value.backend,
    mode: value.mode,
    state: value.state as RunRecord["state"],
    sourceWorkspace: stringValue(value.source_workspace),
    workerWorkspace: stringValue(value.worker_workspace),
    createdAt: stringValue(value.created_at),
    updatedAt: stringValue(value.updated_at),
    taskSha256: stringValue(value.task_sha256),
    limits: {
      timeoutSeconds: numberValue(limits.timeout_seconds),
      maxTurns: numberValue(limits.max_turns),
      maxEventBytes: numberValue(limits.max_event_bytes),
      maxTranscriptBytes: numberValue(limits.max_transcript_bytes),
      maxArtifactBytes: numberValue(limits.max_artifact_bytes)
    }
  };
  if (typeof value.started_at === "string") run.startedAt = value.started_at;
  if (typeof value.finished_at === "string") run.finishedAt = value.finished_at;
  if (typeof value.workspace_snapshot_sha256 === "string") {
    if (!/^[a-f0-9]{64}$/i.test(value.workspace_snapshot_sha256)) throw new TypeError("Invalid persisted workspace snapshot digest");
    run.workspaceSnapshotSha256 = value.workspace_snapshot_sha256;
  }
  if (isObject(value.worktree) && typeof value.worktree.path === "string" && typeof value.worktree.base_ref === "string" && typeof value.worktree.created_by_supervisor === "boolean") run.worktree = { path: value.worktree.path, baseRef: value.worktree.base_ref, createdBySupervisor: value.worktree.created_by_supervisor };
  if (isObject(value.process) && typeof value.process.executable === "string") run.process = { executable: value.process.executable, ...(typeof value.process.pid === "number" ? { pid: value.process.pid } : {}), ...(typeof value.process.version === "string" ? { version: value.process.version } : {}) };
  if (isObject(value.acp)) run.acp = {
    ...(typeof value.acp.protocol_version === "number" ? { protocolVersion: value.acp.protocol_version } : {}),
    ...(typeof value.acp.session_id === "string" ? { sessionId: value.acp.session_id } : {}),
    ...(isObject(value.acp.capabilities) ? { capabilities: value.acp.capabilities } : {}),
    ...(typeof value.acp.run_directory === "string" ? { runDirectory: value.acp.run_directory } : {}),
    ...(typeof value.acp.home === "string" ? { home: value.acp.home } : {}),
    ...(typeof value.acp.vibe_home === "string" ? { vibeHome: value.acp.vibe_home } : {}),
    ...((value.acp.profile_mode === "review" || value.acp.profile_mode === "edit") ? { profileMode: value.acp.profile_mode } : {})
  };
  if (isObject(value.usage)) {
    const usage: NonNullable<RunRecord["usage"]> = {
      ...(typeof value.usage.tokens_used === "number" ? { tokensUsed: value.usage.tokens_used } : {}),
      ...(typeof value.usage.context_size === "number" ? { contextSize: value.usage.context_size } : {})
    };
    if (isObject(value.usage.cost) && typeof value.usage.cost.amount === "number" && typeof value.usage.cost.currency === "string") usage.cost = { amount: value.usage.cost.amount, currency: value.usage.cost.currency, authoritative: false };
    run.usage = usage;
  }
  if (isObject(value.pending_request)) run.pendingRequest = pendingFromWire(value.pending_request);
  if (isObject(value.result)) run.result = resultFromWire(value.result);
  if (isObject(value.error) && typeof value.error.code === "string" && ERROR_CODES.has(value.error.code as SupervisorErrorCode) && typeof value.error.message === "string" && typeof value.error.remediation === "string" && typeof value.error.retryable === "boolean") run.error = { code: value.error.code as SupervisorErrorCode, message: value.error.message, remediation: value.error.remediation, retryable: value.error.retryable, ...(isObject(value.error.details) ? { details: value.error.details } : {}) };
  const runLimits = Object.values(run.limits);
  if (runLimits.some((limit) => !Number.isSafeInteger(limit) || limit <= 0) || Number.isNaN(Date.parse(run.createdAt)) || Number.isNaN(Date.parse(run.updatedAt)) || !/^[a-f0-9]{64}$/i.test(run.taskSha256)) throw new TypeError("Invalid persisted run limits, timestamps, or task digest");
  return run;
}

const RUN_STATES = new Set<RunRecord["state"]>(["queued", "starting", "negotiating", "ready", "running", "waiting_permission", "waiting_input", "completed", "failed", "cancelled", "closing", "closed", "orphaned", "recoverable"]);
const ERROR_CODES = new Set(["VSUP_CONFIG_INVALID", "VSUP_VIBE_NOT_FOUND", "VSUP_VIBE_ACP_NOT_FOUND", "VSUP_VIBE_VERSION_UNSUPPORTED", "VSUP_ACP_INIT_FAILED", "VSUP_ACP_VERSION_UNSUPPORTED", "VSUP_ACP_PROTOCOL_ERROR", "VSUP_AUTH_REQUIRED", "VSUP_WORKSPACE_DENIED", "VSUP_WORKSPACE_INVALID", "VSUP_WORKTREE_CREATE_FAILED", "VSUP_GIT_REQUIRED", "VSUP_PERMISSION_REQUIRED", "VSUP_INPUT_REQUIRED", "VSUP_REQUEST_EXPIRED", "VSUP_SESSION_NOT_RESUMABLE", "VSUP_BACKEND_UNAVAILABLE", "VSUP_BACKEND_CRASHED", "VSUP_TIMEOUT", "VSUP_RATE_LIMITED", "VSUP_CANCELLED", "VSUP_OUTPUT_LIMIT", "VSUP_ARTIFACT_ERROR", "VSUP_INVALID_ARGUMENT", "VSUP_NOT_FOUND", "VSUP_BACKEND_ERROR", "VSUP_LIMIT_EXCEEDED", "VSUP_PERMISSION_DENIED", "VSUP_INVALID_STATE", "VSUP_STORAGE_ERROR", "VSUP_RECOVERY_ERROR", "VSUP_INTERNAL"]);

function pendingToWire(pending: NonNullable<RunRecord["pendingRequest"]>): JsonObject {
  if (pending.kind === "permission") return {
    request_id: pending.requestId, kind: pending.kind, title: pending.title,
    options: pending.options.map((option) => ({ option_id: option.optionId, name: option.name, ...(option.kind ? { kind: option.kind } : {}) })),
    ...(pending.tool ? { tool: { ...(pending.tool.kind ? { kind: pending.tool.kind } : {}), ...(pending.tool.locations ? { locations: pending.tool.locations } : {}), ...(pending.tool.rawInput === undefined ? {} : { raw_input: pending.tool.rawInput }) } } : {})
  };
  return { request_id: pending.requestId, kind: pending.kind, title: pending.title, ...(pending.schema ? { schema: pending.schema } : {}) };
}

function pendingFromWire(value: JsonObject): NonNullable<RunRecord["pendingRequest"]> {
  if (value.kind === "permission" && Array.isArray(value.options)) return {
    requestId: stringValue(value.request_id), kind: "permission", title: stringValue(value.title),
    options: value.options.filter(isObject).map((option) => ({ optionId: stringValue(option.option_id), name: stringValue(option.name), ...(typeof option.kind === "string" ? { kind: option.kind } : {}) }))
  };
  if (value.kind === "elicitation") return { requestId: stringValue(value.request_id), kind: "elicitation", title: stringValue(value.title), ...(isObject(value.schema) ? { schema: value.schema } : {}) };
  throw new TypeError("Invalid persisted pending request");
}

function resultToWire(result: NonNullable<RunRecord["result"]>): JsonObject {
  return {
    ...(result.stopReason ? { stop_reason: result.stopReason } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.artifacts ? { artifacts: result.artifacts.map((artifact) => ({ name: artifact.name, path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, media_type: artifact.mediaType })) } : {}),
    ...(result.changedFiles ? { changed_files: result.changedFiles } : {}),
    ...(result.warnings ? { warnings: result.warnings } : {})
  };
}

function resultFromWire(value: JsonObject): NonNullable<RunRecord["result"]> {
  return {
    ...(typeof value.stop_reason === "string" ? { stopReason: value.stop_reason } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(Array.isArray(value.changed_files) ? { changedFiles: value.changed_files.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(value.warnings) ? { warnings: value.warnings.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(value.artifacts) ? { artifacts: value.artifacts.filter(isObject).map((item) => ({ name: stringValue(item.name), path: stringValue(item.path), sha256: stringValue(item.sha256), bytes: numberValue(item.bytes), mediaType: stringValue(item.media_type) })) } : {})
  };
}

function isObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asObject(value: unknown): JsonObject { return isObject(value) ? value : {}; }
function stringValue(value: unknown): string { if (typeof value !== "string") throw new TypeError("Invalid persisted string field"); return value; }
function numberValue(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Invalid persisted number field"); return value; }
