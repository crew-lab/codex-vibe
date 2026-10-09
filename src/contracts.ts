/** Shared, versioned contracts for the supervisor, MCP surface, and backends. */
import { SUPPORTED_VIBE } from "./backends/pinned.js";

export const SCHEMA_VERSION = 1 as const;

export type BackendKind = "acp" | "programmatic";
export type BackendPreference = "auto" | BackendKind;
export type RunMode = "review" | "edit";
export type RunState =
  | "queued" | "starting" | "negotiating" | "ready" | "running"
  | "waiting_permission" | "waiting_input" | "completed" | "failed"
  | "cancelled" | "closing" | "closed" | "orphaned" | "recoverable";
export type EventSeverity = "debug" | "info" | "warning" | "error";
export type EventSource = "supervisor" | "vibe" | "acp";

export interface RunLimits {
  timeoutSeconds: number;
  maxTurns: number;
  maxEventBytes: number;
  maxTranscriptBytes: number;
  maxArtifactBytes: number;
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

export interface AcpRecord {
  protocolVersion?: number;
  sessionId?: string;
  capabilities?: Record<string, unknown>;
  runDirectory?: string;
  home?: string;
  vibeHome?: string;
  profileMode?: "review" | "edit";
}

export interface UsageState {
  tokensUsed?: number;
  contextSize?: number;
  cost?: { amount: number; currency: string; authoritative: false };
}

export interface PendingOption {
  optionId: string;
  name: string;
  kind?: string;
}

export type PendingRequest =
  | { requestId: string; kind: "permission"; title: string; options: PendingOption[]; tool?: { kind?: string; locations?: string[]; rawInput?: unknown } }
  | { requestId: string; kind: "elicitation"; title: string; schema?: Record<string, unknown> };

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
  | "VSUP_CONFIG_INVALID" | "VSUP_VIBE_NOT_FOUND" | "VSUP_VIBE_ACP_NOT_FOUND"
  | "VSUP_VIBE_VERSION_UNSUPPORTED" | "VSUP_ACP_INIT_FAILED"
  | "VSUP_ACP_VERSION_UNSUPPORTED" | "VSUP_ACP_PROTOCOL_ERROR"
  | "VSUP_AUTH_REQUIRED" | "VSUP_WORKSPACE_INVALID"
  | "VSUP_WORKTREE_CREATE_FAILED" | "VSUP_GIT_REQUIRED" | "VSUP_PERMISSION_REQUIRED"
  | "VSUP_INPUT_REQUIRED" | "VSUP_REQUEST_EXPIRED" | "VSUP_SESSION_NOT_RESUMABLE"
  | "VSUP_BACKEND_UNAVAILABLE" | "VSUP_BACKEND_CRASHED" | "VSUP_TIMEOUT"
  | "VSUP_RATE_LIMITED" | "VSUP_CANCELLED" | "VSUP_OUTPUT_LIMIT"
  | "VSUP_ARTIFACT_ERROR" | "VSUP_INVALID_ARGUMENT" | "VSUP_NOT_FOUND"
  | "VSUP_BACKEND_ERROR" | "VSUP_LIMIT_EXCEEDED" | "VSUP_PERMISSION_DENIED"
  | "VSUP_TURN_LIMIT_REACHED" | "VSUP_NO_PROGRESS" | "VSUP_INVALID_STATE" | "VSUP_STORAGE_ERROR" | "VSUP_RECOVERY_ERROR" | "VSUP_INTERNAL";

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
  workspaceSnapshotSha256?: string;
  process?: ProcessRecord;
  acp?: AcpRecord;
  limits: RunLimits;
  usage?: UsageState;
  pendingRequest?: PendingRequest;
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

export type McpResultFormat = "text" | "structured" | "both";

export interface SupervisorConfig {
  version: 1;
  backend: BackendPreference;
  allowedWorkspaceRoots: string[];
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
  workerIdleTtlSeconds: number;
  retention: { days: number; preserveFailedRuns: boolean };
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
    mcpResultFormat: McpResultFormat;
  };
  paths?: { vibe?: string; vibeAcp?: string; dataDir?: string };
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
  supportsContinue: boolean;
  supportsPermissionResponse: boolean;
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
  onPendingRequest(request: PendingRequest | undefined): void | Promise<void>;
  onActivity?(kind: string): void;
  onSpawn?(handle: BackendRunHandle): void;
  onState(state: RunState, update?: Partial<Pick<RunRecord, "usage" | "result" | "error" | "process" | "acp">>): void | Promise<void>;
}

export interface BackendStartResult {
  handle: BackendRunHandle;
  initialState: RunState;
  process?: ProcessRecord;
  acp?: AcpRecord;
}

export interface BackendRespondInput {
  requestId: string;
  kind: "permission" | "elicitation";
  optionId?: string;
  action?: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

export interface SupervisorBackend {
  readonly kind: BackendKind;
  readonly supportsContinue?: boolean;
  probe(): Promise<BackendCapabilities>;
  start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult>;
  continue(handle: BackendRunHandle, message: string, options?: { maxTurns?: number }): Promise<void>;
  respond(handle: BackendRunHandle, response: BackendRespondInput): Promise<void>;
  cancel(handle: BackendRunHandle): Promise<void>;
  close(handle: BackendRunHandle): Promise<void>;
  recover(record: RunRecord, callbacks: BackendCallbacks): Promise<BackendRunHandle | undefined>;
}

export interface StartToolInput {
  task: string;
  cwd: string;
  max_turns?: number;
  timeout_seconds?: number;
  wait_seconds?: number;
}
export interface ReviewStartToolInput extends StartToolInput { context_files?: string[] }
export interface EditStartToolInput extends StartToolInput {
  base_ref?: string;
}
export interface StatusToolInput { run_id: string; after_seq?: number; max_events?: number; wait_seconds?: number }
export interface WaitOptions { signal?: AbortSignal }
export interface ContinueToolInput { run_id: string; message: string; max_turns?: number }
export type RespondToolInput =
  | { run_id: string; request_id: string; kind: "permission"; option_id: string }
  | { run_id: string; request_id: string; kind: "elicitation"; action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };
export interface ResultToolInput { run_id: string; detail?: "compact" | "full"; include_transcript?: boolean }
export interface CancelToolInput { run_id: string }
export interface CloseToolInput { run_id: string; cleanup_worktree?: boolean }

export const REMEDIATION: Record<SupervisorErrorCode, string> = {
  VSUP_CONFIG_INVALID: "Correct the reported config.toml field and try again.",
  VSUP_VIBE_NOT_FOUND: "Install Vibe or set paths.vibe to its executable.",
  VSUP_VIBE_ACP_NOT_FOUND: "Install Vibe ACP or set paths.vibe_acp to its executable.",
  VSUP_VIBE_VERSION_UNSUPPORTED: `Install exactly the supported Vibe version (for example \`uv tool install mistral-vibe==${SUPPORTED_VIBE}\`) or point paths.vibe and paths.vibe_acp at a pinned install.`,
  VSUP_ACP_INIT_FAILED: "Check the Vibe ACP executable and the run's diagnostic events, then retry.",
  VSUP_ACP_VERSION_UNSUPPORTED: "Upgrade Vibe ACP to a supported ACP version.",
  VSUP_ACP_PROTOCOL_ERROR: "Check ACP diagnostics and retry with a compatible Vibe release.",
  VSUP_AUTH_REQUIRED: "Sign in to Vibe or configure its supported authentication.",
  VSUP_WORKSPACE_INVALID: "Provide an existing workspace directory under an allowed_workspace_roots entry (the git repository root for an edit, without project .vibe, unsafe .agents paths or glob characters), and existing context files inside it; a real .agents directory is supported without inheriting its content. After vibe-supervisor allow, restart the Codex MCP server (reconnect when it uses --isolated) so it reads the new list.",
  VSUP_WORKTREE_CREATE_FAILED: "Check the repository state and worktree path, then retry.",
  VSUP_GIT_REQUIRED: "Install Git and use a Git repository for edit runs.",
  VSUP_PERMISSION_REQUIRED: "Answer the pending permission request with vibe_respond before continuing.",
  VSUP_INPUT_REQUIRED: "Answer the pending input request with vibe_respond before continuing.",
  VSUP_REQUEST_EXPIRED: "Start a new run because the pending request has expired.",
  VSUP_SESSION_NOT_RESUMABLE: "Start a new run; this backend session cannot be resumed.",
  VSUP_BACKEND_UNAVAILABLE: "Install or configure an available backend and retry.",
  VSUP_BACKEND_CRASHED: "Inspect the run's diagnostic events and start a new run.",
  VSUP_TIMEOUT: "Increase the timeout or simplify the task, then start a new run.",
  VSUP_RATE_LIMITED: "Wait for the service rate limit to clear and retry.",
  VSUP_CANCELLED: "Start another run if more work is needed.",
  VSUP_OUTPUT_LIMIT: "Reduce the requested output or increase the configured limit.",
  VSUP_ARTIFACT_ERROR: "Inspect the run directory permissions and available disk space.",
  VSUP_INVALID_ARGUMENT: "Correct the tool arguments and try again.",
  VSUP_NOT_FOUND: "Check the run ID and try again.",
  VSUP_BACKEND_ERROR: "Inspect backend diagnostics and retry if the problem is transient.",
  VSUP_LIMIT_EXCEEDED: "Wait for capacity or increase the configured limit.",
  VSUP_PERMISSION_DENIED: "The action is outside the supervisor's safety policy and cannot be granted; narrow the task to read and search (or to edits inside the worktree) and start a new run.",
  VSUP_NO_PROGRESS: "The worker produced no output for the configured limits.worker_progress_timeout_seconds; inspect the run diagnostics and events, then start a new run deliberately; the task is never replayed.",
  VSUP_TURN_LIMIT_REACHED: "Vibe counts turns cumulatively per session: pass max_turns greater than the current limit when it is below 50, otherwise start a new run from a deliberate base; the task is never replayed.",
  VSUP_INVALID_STATE: "Check the run status and use an action valid for its current state.",
  VSUP_STORAGE_ERROR: "Check the supervisor data directory permissions and disk space.",
  VSUP_RECOVERY_ERROR: "Inspect recovery diagnostics and start a new run if needed.",
  VSUP_INTERNAL: "Inspect supervisor diagnostics and retry; report the error if it persists.",
};

export function supervisorError(code: SupervisorErrorCode, message: string, details?: Record<string, unknown>, retryable = false): SupervisorError {
  return { code, message, remediation: REMEDIATION[code], retryable, ...(details ? { details } : {}) };
}
