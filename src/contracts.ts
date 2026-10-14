/** Shared, versioned contracts for the supervisor, MCP surface, and backends. */
import { SUPPORTED_VIBE } from "./backends/pinned.js";

export const SCHEMA_VERSION = 1 as const;

export type BackendKind = "programmatic" | "app-server";
export type RunMode = "review" | "edit";
export type RunState =
  | "starting" | "running" | "completed" | "failed"
  | "cancelled" | "closing" | "closed";
export type EventSeverity = "debug" | "info" | "warning" | "error";
export type EventSource = "supervisor" | "vibe";

export interface RunLimits {
  timeoutSeconds: number;
  maxTurns: number;
  maxEventBytes: number;
  maxTranscriptBytes: number;
  maxArtifactBytes: number;
  maxSessionTokens?: number;
  maxEstimatedCostUsd?: number;
}

export interface WorktreeRecord {
  path: string;
  baseRef: string;
  createdBySupervisor: boolean;
}

export interface ProcessRecord {
  pid?: number;
  executable: string;
  version?: string;
}

export interface UsageState {
  tokensUsed?: number;
  contextSize?: number;
  cost?: { amount: number; currency: string; authoritative: false };
}

export interface ResultArtifact {
  name: string;
  path: string;
  sha256: string;
  bytes: number;
  mediaType: string;
}

export interface ReviewIntegrity {
  status: "verified" | "changed" | "unverified";
  writeToolObserved: boolean;
  changedPaths?: string[];
  changedPathsTotal?: number;
  reason?: string;
}

export interface ResultSummary {
  stopReason?: string;
  summary?: string;
  artifacts?: ResultArtifact[];
  changedFiles?: string[];
  warnings?: string[];
  integrity?: ReviewIntegrity;
}

export interface SupervisorError {
  code: SupervisorErrorCode;
  message: string;
  remediation: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type SupervisorErrorCode =
  | "VSUP_CONFIG_INVALID" | "VSUP_VIBE_NOT_FOUND"
  | "VSUP_VIBE_VERSION_UNSUPPORTED"
  | "VSUP_AUTH_REQUIRED" | "VSUP_WORKSPACE_INVALID"
  | "VSUP_WORKTREE_CREATE_FAILED" | "VSUP_GIT_REQUIRED"
  | "VSUP_BACKEND_CRASHED" | "VSUP_TIMEOUT"
  | "VSUP_RATE_LIMITED" | "VSUP_CANCELLED" | "VSUP_OUTPUT_LIMIT"
  | "VSUP_ARTIFACT_ERROR" | "VSUP_INVALID_ARGUMENT" | "VSUP_NOT_FOUND"
  | "VSUP_BACKEND_ERROR" | "VSUP_LIMIT_EXCEEDED"
  | "VSUP_NO_PROGRESS" | "VSUP_INVALID_STATE" | "VSUP_STORAGE_ERROR" | "VSUP_INTERNAL"
  | "VSUP_RESTART_REQUIRED" | "VSUP_READINESS_RECEIPT_INVALID"
  | "VSUP_OWNER_LOCKED" | "VSUP_PREPARATION_TIMEOUT";

export interface RunRecord {
  /** Release that created the run; absent on legacy records. */
  supervisorVersion?: string;
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  backend: BackendKind;
  mode: RunMode;
  state: RunState;
  sourceWorkspace: string;
  workerWorkspace: string;
  worktree?: WorktreeRecord;
  createdAt: string;
  updatedAt: string;
  launchedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  taskSha256: string;
  policyRevision?: string;
  admittedRoot?: string;
  workspaceSnapshotSha256?: string;
  process?: ProcessRecord;
  limits: RunLimits;
  usage?: UsageState;
  result?: ResultSummary;
  error?: SupervisorError;
}

export interface SupervisorEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  seq: number;
  timestamp: string;
  runId: string;
  backend: BackendKind;
  source: EventSource;
  type: string;
  severity: EventSeverity;
  data: Record<string, unknown>;
}

export interface SupervisorConfig {
  version: 1;
  allowedWorkspaceRoots: string[];
  retention: { days: number };
  limits: {
    reviewTimeoutSeconds: number;
    editTimeoutSeconds: number;
    maxTurnsReview: number;
    maxTurnsEdit: number;
    maxEventBytes: number;
    maxTranscriptBytes: number;
    maxArtifactBytes: number;
    workerProgressTimeoutSeconds: number;
    maxMcpResultChars: number;
    maxSessionTokens?: number;
    maxEstimatedCostUsd?: number;
  };
  paths?: { vibe?: string; vibeAppServer?: string };
}

export interface StartRunInput {
  runId: string;
  mode: RunMode;
  task: string;
  cwd: string;
  workerWorkspace: string;
  runDirectory: string;
  baseRef?: string;
  contextFiles?: string[];
  limits: RunLimits;
}

export interface BackendCapabilities {
  available: boolean;
  backend: BackendKind;
  executable?: string;
  version?: string;
  details?: Record<string, unknown>;
}

/** Opaque lifetime handle owned by the selected backend implementation. */
export interface BackendRunHandle {
  readonly runId: string;
  readonly backend: BackendKind;
  readonly opaque: unknown;
}

export interface BackendCallbacks {
  onEvent(event: Omit<SupervisorEvent, "schemaVersion" | "seq" | "timestamp" | "runId" | "backend">): void | Promise<void>;
  onActivity?(kind: string): void;
  onSpawn?(handle: BackendRunHandle): void;
  onState(state: RunState, update?: Partial<Pick<RunRecord, "usage" | "result" | "error" | "process">>): void | Promise<void>;
}

export interface BackendStartResult {
  handle: BackendRunHandle;
  initialState: RunState;
  process?: ProcessRecord;
}

export interface SupervisorBackend {
  readonly kind: BackendKind;
  probe(): Promise<BackendCapabilities>;
  start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult>;
  cancel(handle: BackendRunHandle): Promise<void>;
  close(handle: BackendRunHandle): Promise<void>;
  terminateNow?(handle: BackendRunHandle): Promise<void>;
  runtimeCheck?(): Promise<RuntimeCheck>;
}

export interface RuntimeCheck {
  executable: string;
  resolved_executable: string | null;
  executable_found: boolean;
  pinned_version: string;
  version_verified: false;
  note: string;
  backend?: BackendKind;
  expected_model_alias?: string;
  expected_reasoning_effort?: string;
  accounting_limits?: { max_session_tokens: number | null; max_estimated_cost_usd: number | null };
}

export interface StartToolInput {
  task: string;
  cwd: string;
  readiness_receipt?: string;
  max_turns?: number;
  timeout_seconds?: number;
  wait_seconds?: number;
}
export interface ReviewStartToolInput extends StartToolInput { context_files?: string[] }
export interface EditStartToolInput extends StartToolInput {
  base_ref?: string;
}
export interface StatusToolInput { run_id?: string; after_seq?: number; max_events?: number; wait_seconds?: number; workspace?: string; operation?: RunMode; base_ref?: string }
export interface WaitOptions { signal?: AbortSignal }
export interface ResultToolInput { run_id: string; detail?: "compact" | "full"; include_transcript?: boolean }
export interface CloseToolInput { run_id: string; cleanup_worktree?: boolean }

export const REMEDIATION: Record<SupervisorErrorCode, string> = {
  VSUP_CONFIG_INVALID: "Correct the reported config.toml field and try again.",
  VSUP_VIBE_NOT_FOUND: "Install Vibe or set paths.vibe to its executable.",
  VSUP_VIBE_VERSION_UNSUPPORTED: `Install exactly the supported Vibe version (for example \`uv tool install mistral-vibe==${SUPPORTED_VIBE}\`) or set paths.vibe to its executable.`,
  VSUP_AUTH_REQUIRED: "Sign in to Vibe or configure its supported authentication.",
  VSUP_WORKSPACE_INVALID: "Provide an existing workspace directory under an allowed_workspace_roots entry (the git repository root for an edit, without project .vibe, unsafe .agents paths or glob characters), and existing context files inside it; a real .agents directory is supported without inheriting its content. Add the workspace to the selected config with `node dist/cli.js allow --config <selected-config> <workspace>` (or the equivalent installed executable path). The connected server rereads that file before every readiness check and start, so no restart is needed; confirm with vibe_status in workspace mode.",
  VSUP_WORKTREE_CREATE_FAILED: "Check the repository state and worktree path, then retry.",
  VSUP_GIT_REQUIRED: "Install Git (the git executable must be on PATH) and use a Git repository for edit runs.",
  VSUP_BACKEND_CRASHED: "Inspect the run's diagnostic events and start a new run.",
  VSUP_TIMEOUT: "Increase the timeout or simplify the task, then start a new run. For a Git operation that exceeded its limit (30 s for queries, 5 min for worktree creation, export and cleanup), check the repository size and disk speed.",
  VSUP_RATE_LIMITED: "Wait for the service rate limit to clear and retry.",
  VSUP_CANCELLED: "Start another run if more work is needed.",
  VSUP_OUTPUT_LIMIT: "Reduce the requested output or increase the configured limit.",
  VSUP_ARTIFACT_ERROR: "Inspect the run directory permissions and available disk space; for a Git failure, see details.operation and the repository state.",
  VSUP_INVALID_ARGUMENT: "Correct the tool arguments and try again.",
  VSUP_NOT_FOUND: "Check the run ID and try again.",
  VSUP_BACKEND_ERROR: "Inspect backend diagnostics and retry if the problem is transient.",
  VSUP_LIMIT_EXCEEDED: "Wait for the active run to finish, then start another run.",
  VSUP_NO_PROGRESS: "The worker produced no output for the configured limits.worker_progress_timeout_seconds; inspect the run diagnostics and events, then start a new run deliberately; the task is never replayed.",
  VSUP_INVALID_STATE: "The request conflicts with the current state: check the run status and use an action valid for it, or wait until a shutting-down supervisor has been restarted, or inspect the isolated session path named in the message.",
  VSUP_STORAGE_ERROR: "Check the supervisor data directory permissions and disk space.",
  VSUP_INTERNAL: "Inspect supervisor diagnostics and retry; report the error if it persists.",
  VSUP_RESTART_REQUIRED: "A boot-bound setting (paths.vibe, retention or limits) in the selected config differs from the value this server started with, so new starts are refused rather than partially adopted. Revert the setting, or close any active run and deliberately restart the Codex MCP server; allowed_workspace_roots changes never need a restart.",
  VSUP_OWNER_LOCKED: "Another vibe-supervisor owns this data directory, or its owner lock needs inspection. Stop the other process or give each Codex session its own VIBE_SUPERVISOR_HOME, then retry; for an unsafe or malformed lock, inspect the file named in details.lock_path.",
  VSUP_PREPARATION_TIMEOUT: "Preparation did not finish within its fixed deadline and no run was created. Check that the workspace, repository and configuration filesystems respond, then check readiness again.",
  VSUP_READINESS_RECEIPT_INVALID: "No run was created and nothing was launched. Call vibe_status with workspace and operation on this same connection, resolve any blockers, and start once with the new readiness_receipt; do not retry the start automatically.",
};

export function supervisorError(code: SupervisorErrorCode, message: string, details?: Record<string, unknown>, retryable = false): SupervisorError {
  return { code, message, remediation: REMEDIATION[code], retryable, ...(details ? { details } : {}) };
}
