import { preparationStatusSchema } from "../preparation/evidence.js";
import { z } from "zod";
import { modelObservationsSchema } from "../reporting/telemetry.js";
import { acceptanceContractSchema, verificationSchema, parseAssessments } from "../acceptance/schema.js";
import { MAX_APPROVAL_LEDGER_RECORDS, MAX_RUN_EXCLUDED_GLOBS, REMEDIATION, isBackendKind } from "../contracts.js";
import type { ApprovalLedgerSnapshot, ExclusionScope, PinIdentity, RunLimits, RunRecord, SupervisorErrorCode, SupervisorEvent, ToolCallCounts, UsageState } from "../contracts.js";

type JsonObject = Record<string, unknown>;

export function usageToWire(usage: UsageState): JsonObject {
  return {
    ...usageDetailsToWire(usage),
    ...(usage.tokensUsed === undefined ? {} : { tokens_used: usage.tokensUsed }),
    ...(usage.contextSize === undefined ? {} : { context_size: usage.contextSize }),
    ...(usage.cost === undefined ? {} : { cost: { amount: usage.cost.amount, currency: usage.cost.currency, authoritative: false } }),
    ...(usage.toolCalls === undefined ? {} : { tool_calls: { executed: usage.toolCalls.executed, denied_by_handler: usage.toolCalls.deniedByHandler, denied_by_policy: usage.toolCalls.deniedByPolicy } })
  };
}

export function limitsToWire(limits: RunLimits): JsonObject {
  return {
    timeout_seconds: limits.timeoutSeconds,
    max_turns: limits.maxTurns,
    max_event_bytes: limits.maxEventBytes,
    max_transcript_bytes: limits.maxTranscriptBytes,
    max_artifact_bytes: limits.maxArtifactBytes,
    ...(limits.maxTokens === undefined ? {} : { max_tokens: limits.maxTokens }),
    ...(limits.maxCostUsd === undefined ? {} : { max_cost_usd: limits.maxCostUsd }),
    ...(limits.maxModelCalls === undefined ? {} : { max_model_calls: limits.maxModelCalls })
  };
}

export function pinToWire(pin: PinIdentity): JsonObject {
  return { vibe_version: pin.vibeVersion, manifest_sha256: pin.manifestSha256, record_sha256: pin.recordSha256 };
}

export function approvalsToWire(runId: string, snapshot: ApprovalLedgerSnapshot): JsonObject {
  const records = snapshot.records.slice(0, MAX_APPROVAL_LEDGER_RECORDS);
  return {
    schema_version: 1,
    run_id: runId,
    truncated: snapshot.truncated || snapshot.records.length > records.length,
    records: records.map((record) => ({
      callback_id: record.callbackId,
      related_entry_id: record.relatedEntryId,
      turn_id: record.turnId,
      tool: record.tool,
      path: record.path,
      fingerprint: record.fingerprint,
      decision: record.decision,
      reason: record.reason
    }))
  };
}

export function runToWire(run: RunRecord): JsonObject {
  const usage = run.usage ? usageToWire(run.usage) : undefined;
  return {
    ...(run.modelObservations ? { model_observations: run.modelObservations } : {}),
    ...(run.preparation ? { preparation: run.preparation } : {}),
    ...(run.cleanup ? { cleanup: run.cleanup } : {}),
    schema_version: run.schemaVersion,
    ...(run.supervisorVersion === undefined ? {} : { supervisor_version: run.supervisorVersion }),
    run_id: run.runId,
    backend: run.backend,
    mode: run.mode,
    ...(run.output ? { output: run.output } : {}),
    ...(run.sessionMode ? { session_mode: run.sessionMode } : {}),
    ...(run.maxCorrections === undefined ? {} : { max_corrections: run.maxCorrections }),
    ...(run.candidateRevision === undefined ? {} : { candidate_revision: run.candidateRevision }),
    ...(run.candidatePatchSha256 ? { candidate_patch_sha256: run.candidatePatchSha256 } : {}),
    ...(run.correctionMessageHashes ? { correction_message_hashes: run.correctionMessageHashes } : {}),
    ...(run.candidateRevisions ? { candidate_revisions: run.candidateRevisions.map((item) => ({ revision: item.revision, patch_sha256: item.patchSha256, contract_sha256: item.contractSha256, artifact_bytes: item.artifactBytes, verification: item.verification })) } : {}),
    ...(run.preparedContextManifestSha256 ? { prepared_context_manifest_sha256: run.preparedContextManifestSha256 } : {}),
    state: run.state,
    ...(run.executionState ? { execution_state: run.executionState } : {}),
    source_workspace: run.sourceWorkspace,
    worker_workspace: run.workerWorkspace,
    ...(run.worktree ? { worktree: {
      path: run.worktree.path,
      base_ref: run.worktree.baseRef,
      created_by_supervisor: run.worktree.createdBySupervisor
    } } : {}),
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    ...(run.launchedAt ? { launched_at: run.launchedAt } : {}),
    ...(run.startedAt ? { started_at: run.startedAt } : {}),
    ...(run.finishedAt ? { finished_at: run.finishedAt } : {}),
    task_sha256: run.taskSha256,
    ...(run.dispatch ? { dispatch: run.dispatch } : {}),
    ...(run.acceptanceContract ? { acceptance_contract: run.acceptanceContract } : {}),
    ...(run.verification ? { verification: run.verification } : {}),
    ...(run.assessments ? { assessments: run.assessments } : {}),
    ...(run.policyRevision ? { policy_revision: run.policyRevision } : {}),
    ...(run.admittedRoot ? { admitted_root: run.admittedRoot } : {}),
    ...(run.exclusions ? { excluded_globs: run.exclusions.map((scope) => ({ root: scope.root, globs: [...scope.globs] })) } : {}),
    ...(run.workspaceSnapshotSha256 ? { workspace_snapshot_sha256: run.workspaceSnapshotSha256 } : {}),
    ...(run.process ? { process: run.process } : {}),
    ...(run.pin ? { pin: pinToWire(run.pin) } : {}),
    limits: limitsToWire(run.limits),
    ...(usage ? { usage } : {}),
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
  if (!isObject(value) || value.schema_version !== 1 || !Number.isSafeInteger(value.seq) || typeof value.timestamp !== "string" || Number.isNaN(Date.parse(value.timestamp)) || typeof value.run_id !== "string" || !isBackendKind(value.backend) || typeof value.source !== "string" || !["supervisor", "vibe", "antigravity"].includes(value.source) || typeof value.type !== "string" || typeof value.severity !== "string" || !["debug", "info", "warning", "error"].includes(value.severity) || !isObject(value.data)) throw new TypeError("Invalid persisted supervisor event");
  return { schemaVersion: 1, seq: value.seq as number, timestamp: value.timestamp, runId: value.run_id, backend: value.backend, source: value.source as SupervisorEvent["source"], type: value.type, severity: value.severity as SupervisorEvent["severity"], data: value.data };
}

export function runFromWire(value: unknown): RunRecord {
  if (!isObject(value) || value.schema_version !== 1 || typeof value.run_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.run_id) || !isBackendKind(value.backend) || typeof value.mode !== "string" || (value.mode !== "review" && value.mode !== "edit") || typeof value.state !== "string" || !RUN_STATES.has(value.state as RunRecord["state"])) throw new TypeError("Invalid persisted run record");
  if (value.supervisor_version !== undefined && (typeof value.supervisor_version !== "string" || value.supervisor_version.length > 128 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.supervisor_version))) throw new TypeError("Invalid persisted supervisor version");
  const limits = asObject(value.limits);
  const run: RunRecord = {
    schemaVersion: 1,
    ...(typeof value.supervisor_version === "string" ? { supervisorVersion: value.supervisor_version } : {}),
    runId: value.run_id,
    backend: value.backend,
    mode: value.mode,
    state: value.state as RunRecord["state"],
    sourceWorkspace: stringValue(value.source_workspace),
    workerWorkspace: stringValue(value.worker_workspace),
    createdAt: stringValue(value.created_at),
    updatedAt: stringValue(value.updated_at),
    taskSha256: stringValue(value.task_sha256),
    limits: limitsFromWire(limits)
  };
  if (value.dispatch !== undefined) {
    const dispatch = asObject(value.dispatch);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (Object.keys(dispatch).sort().join(',') !== 'attempt_id,grant_id,request_sha256' || typeof dispatch.grant_id !== 'string' || !uuid.test(dispatch.grant_id) || typeof dispatch.attempt_id !== 'string' || !uuid.test(dispatch.attempt_id) || typeof dispatch.request_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(dispatch.request_sha256)) throw new TypeError('Invalid persisted dispatch binding');
    run.dispatch = { grant_id: dispatch.grant_id, attempt_id: dispatch.attempt_id, request_sha256: dispatch.request_sha256 };
  }
  if (value.output === "text" || value.output === "findings") run.output = value.output;
  if (value.session_mode !== undefined) {
    if (value.session_mode !== "one_shot" && value.session_mode !== "correctable") throw new TypeError("Invalid persisted session mode");
    run.sessionMode = value.session_mode;
  }
  if (value.max_corrections !== undefined) {
    if (!Number.isInteger(value.max_corrections) || (value.max_corrections as number) < 0 || (value.max_corrections as number) > 2) throw new TypeError("Invalid persisted correction limit");
    run.maxCorrections = value.max_corrections as number;
  }
  if (value.candidate_revision !== undefined) {
    if (!Number.isInteger(value.candidate_revision) || (value.candidate_revision as number) < 1 || (value.candidate_revision as number) > 3) throw new TypeError("Invalid persisted candidate revision");
    run.candidateRevision = value.candidate_revision as number;
  }
  if (value.candidate_patch_sha256 !== undefined) {
    if (typeof value.candidate_patch_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.candidate_patch_sha256)) throw new TypeError("Invalid persisted candidate patch digest");
    run.candidatePatchSha256 = value.candidate_patch_sha256;
  }
  if (value.correction_message_hashes !== undefined) {
    if (!Array.isArray(value.correction_message_hashes) || value.correction_message_hashes.length > 2 || value.correction_message_hashes.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))) throw new TypeError("Invalid persisted correction message digests");
    run.correctionMessageHashes = value.correction_message_hashes as string[];
  }
  if (value.candidate_revisions !== undefined) {
    if (!Array.isArray(value.candidate_revisions) || value.candidate_revisions.length > 3) throw new TypeError("Invalid persisted candidate revision history");
    run.candidateRevisions = value.candidate_revisions.map((entry, index) => {
      if (!isObject(entry) || entry.revision !== index + 1 || typeof entry.patch_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.patch_sha256) || typeof entry.contract_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.contract_sha256) || !Number.isSafeInteger(entry.artifact_bytes) || (entry.artifact_bytes as number) < 0) throw new TypeError("Invalid persisted candidate revision");
      return { revision: entry.revision as number, patchSha256: entry.patch_sha256, contractSha256: entry.contract_sha256, artifactBytes: entry.artifact_bytes as number, verification: verificationSchema.parse(entry.verification) };
    });
  }
  if (value.prepared_context_manifest_sha256 !== undefined) {
    if (typeof value.prepared_context_manifest_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.prepared_context_manifest_sha256)) throw new TypeError("Invalid prepared input manifest digest");
    run.preparedContextManifestSha256 = value.prepared_context_manifest_sha256;
  }
  if (value.execution_state !== undefined) {
    if (value.execution_state !== "completed" && value.execution_state !== "failed" && value.execution_state !== "cancelled") throw new TypeError("Invalid persisted execution state");
    run.executionState = value.execution_state;
  }
  if (value.acceptance_contract !== undefined) run.acceptanceContract = acceptanceContractSchema.parse(value.acceptance_contract);
  if (value.verification !== undefined) run.verification = verificationSchema.parse(value.verification);
  if (value.assessments !== undefined) run.assessments = parseAssessments(value.assessments);
  if (typeof value.launched_at === "string") run.launchedAt = value.launched_at;
  if (typeof value.started_at === "string") run.startedAt = value.started_at;
  if (typeof value.finished_at === "string") run.finishedAt = value.finished_at;
  if (typeof value.policy_revision === "string") {
    if (!/^[a-f0-9]{64}$/i.test(value.policy_revision)) throw new TypeError("Invalid persisted policy revision");
    run.policyRevision = value.policy_revision;
  }
  if (typeof value.admitted_root === "string") {
    if (value.admitted_root.length > 4096 || !value.admitted_root.startsWith("/")) throw new TypeError("Invalid persisted admitted root");
    run.admittedRoot = value.admitted_root;
  }
  if (value.excluded_globs !== undefined) run.exclusions = exclusionsFromWire(value.excluded_globs, run.admittedRoot ?? run.sourceWorkspace);
  if (value.pin !== undefined) run.pin = pinFromWire(value.pin);
  if (typeof value.workspace_snapshot_sha256 === "string") {
    if (!/^[a-f0-9]{64}$/i.test(value.workspace_snapshot_sha256)) throw new TypeError("Invalid persisted workspace snapshot digest");
    run.workspaceSnapshotSha256 = value.workspace_snapshot_sha256;
  }
  if (isObject(value.worktree) && typeof value.worktree.path === "string" && typeof value.worktree.base_ref === "string" && typeof value.worktree.created_by_supervisor === "boolean") run.worktree = { path: value.worktree.path, baseRef: value.worktree.base_ref, createdBySupervisor: value.worktree.created_by_supervisor };
  if (isObject(value.process) && typeof value.process.executable === "string") run.process = { executable: value.process.executable, ...(typeof value.process.pid === "number" ? { pid: value.process.pid } : {}), ...(typeof value.process.version === "string" ? { version: value.process.version } : {}) };
  if (value.preparation !== undefined) run.preparation = preparationStatusSchema.parse(value.preparation);
  if (value.cleanup !== undefined) run.cleanup = z.object({ worktree: z.enum(["removed", "retained", "not_requested", "none"]), checked_at: z.string().datetime(), reason: z.string().max(2000).optional() }).strict().parse(value.cleanup);
  if (value.model_observations !== undefined) run.modelObservations = modelObservationsSchema.parse(value.model_observations);
  if (isObject(value.usage)) {
    const usage: NonNullable<RunRecord["usage"]> = {
      ...(typeof value.usage.tokens_used === "number" ? { tokensUsed: value.usage.tokens_used } : {}),
      ...(typeof value.usage.context_size === "number" ? { contextSize: value.usage.context_size } : {})
    };
    if (isObject(value.usage.cost)) {
      if (typeof value.usage.cost.amount !== 'number' || !Number.isFinite(value.usage.cost.amount) || value.usage.cost.amount < 0 || typeof value.usage.cost.currency !== 'string' || value.usage.cost.currency.length < 1 || value.usage.cost.currency.length > 16) throw new TypeError('Invalid persisted cost amount or currency');
      if (value.usage.cost_availability !== undefined && value.usage.cost.currency !== 'USD') throw new TypeError('Explicit cost availability requires USD currency');
      usage.cost = { amount: value.usage.cost.amount, currency: value.usage.cost.currency, authoritative: false };
    }
    Object.assign(usage, usageDetailsFromWire(value.usage));
    if (usage.costAvailability === 'available' && (!usage.cost || usage.costSource !== 'runtime-stats-prices')) throw new TypeError('Available cost requires a runtime-priced amount');
    if (usage.costAvailability === 'unavailable' && usage.cost !== undefined) throw new TypeError('Unavailable cost cannot include an amount');
    if (usage.priceAvailability !== undefined && usage.priceSource !== 'runtime/read' && usage.priceSource !== 'unavailable') throw new TypeError('Price availability requires explicit provenance');
    const toolCalls = toolCallsFromWire(value.usage.tool_calls);
    if (toolCalls) usage.toolCalls = toolCalls;
    run.usage = usage;
  }
  if (isObject(value.result)) run.result = resultFromWire(value.result);
  if (isObject(value.error) && typeof value.error.code === "string" && ERROR_CODES.has(value.error.code as SupervisorErrorCode) && typeof value.error.message === "string" && typeof value.error.remediation === "string" && typeof value.error.retryable === "boolean") run.error = { code: value.error.code as SupervisorErrorCode, message: value.error.message, remediation: value.error.remediation, retryable: value.error.retryable, ...(isObject(value.error.details) ? { details: value.error.details } : {}) };
  const integerLimits = INTEGER_LIMIT_FIELDS.map((field) => run.limits[field]);
  if (integerLimits.some((limit) => !Number.isSafeInteger(limit) || limit <= 0) || Number.isNaN(Date.parse(run.createdAt)) || Number.isNaN(Date.parse(run.updatedAt)) || !/^[a-f0-9]{64}$/i.test(run.taskSha256)) throw new TypeError("Invalid persisted run limits, timestamps, or task digest");
  return run;
}

const INTEGER_LIMIT_FIELDS = ["timeoutSeconds", "maxTurns", "maxEventBytes", "maxTranscriptBytes", "maxArtifactBytes"] as const;
export const MAX_COST_CEILING_USD = 1_000_000;
const MAX_EXCLUDED_GLOB_CHARS = 256;
const MAX_RECORDED_ROOT_CHARS = 4096;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const VERSION_TEXT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function limitsFromWire(limits: JsonObject): RunLimits {
  const out: RunLimits = {
    timeoutSeconds: numberValue(limits.timeout_seconds),
    maxTurns: numberValue(limits.max_turns),
    maxEventBytes: numberValue(limits.max_event_bytes),
    maxTranscriptBytes: numberValue(limits.max_transcript_bytes),
    maxArtifactBytes: numberValue(limits.max_artifact_bytes)
  };
  if (limits.max_tokens !== undefined) out.maxTokens = integerCeiling(limits.max_tokens);
  if (limits.max_model_calls !== undefined) out.maxModelCalls = integerCeiling(limits.max_model_calls);
  if (limits.max_cost_usd !== undefined) out.maxCostUsd = costCeiling(limits.max_cost_usd);
  return out;
}

function integerCeiling(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new TypeError("Invalid persisted run ceiling");
  return value;
}

function costCeiling(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_COST_CEILING_USD) throw new TypeError("Invalid persisted cost ceiling");
  return value;
}

function recordedGlobs(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_RUN_EXCLUDED_GLOBS && value.every((glob) => typeof glob === "string" && glob.length > 0 && glob.length <= MAX_EXCLUDED_GLOB_CHARS);
}

function exclusionsFromWire(value: unknown, legacyRoot: string): ExclusionScope[] {
  const invalid = (): TypeError => new TypeError("Invalid persisted excluded globs");
  if (!Array.isArray(value)) throw invalid();
  if (value.every((item) => typeof item === "string")) {
    if (!recordedGlobs(value)) throw invalid();
    return value.length === 0 ? [] : [{ root: legacyRoot, globs: [...value] }];
  }
  const scopes = value.map((item): ExclusionScope => {
    if (!isObject(item) || typeof item.root !== "string" || item.root.length > MAX_RECORDED_ROOT_CHARS || !item.root.startsWith("/") || !recordedGlobs(item.globs) || item.globs.length === 0 || Object.keys(item).some((key) => key !== "root" && key !== "globs")) throw invalid();
    return { root: item.root, globs: [...item.globs] };
  });
  if (scopes.reduce((total, scope) => total + scope.globs.length, 0) > MAX_RUN_EXCLUDED_GLOBS || new Set(scopes.map((scope) => scope.root)).size !== scopes.length) throw invalid();
  return scopes;
}

function pinFromWire(value: unknown): PinIdentity {
  if (!isObject(value) || typeof value.vibe_version !== "string" || value.vibe_version.length > 128 || !VERSION_TEXT.test(value.vibe_version) || typeof value.manifest_sha256 !== "string" || !SHA256_HEX.test(value.manifest_sha256) || typeof value.record_sha256 !== "string" || !SHA256_HEX.test(value.record_sha256)) throw new TypeError("Invalid persisted pin identity");
  return { vibeVersion: value.vibe_version, manifestSha256: value.manifest_sha256, recordSha256: value.record_sha256 };
}

function toolCallsFromWire(value: unknown): ToolCallCounts | undefined {
  if (!isObject(value)) return undefined;
  const counts = [value.executed, value.denied_by_handler, value.denied_by_policy];
  if (!counts.every((count): count is number => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) return undefined;
  const [executed, deniedByHandler, deniedByPolicy] = counts as [number, number, number];
  return { executed, deniedByHandler, deniedByPolicy };
}

const RUN_STATES = new Set<RunRecord["state"]>(["starting", "running", "awaiting_validation", "completed", "failed", "cancelled", "closing", "closed"]);
const ERROR_CODES = new Set<string>(Object.keys(REMEDIATION));

function resultToWire(result: NonNullable<RunRecord["result"]>): JsonObject {
  return {
    ...(result.stopReason ? { stop_reason: result.stopReason } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.artifacts ? { artifacts: result.artifacts.map((artifact) => ({ name: artifact.name, path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, media_type: artifact.mediaType })) } : {}),
    ...(result.changedFiles ? { changed_files: result.changedFiles } : {}),
    ...(result.warnings ? { warnings: result.warnings } : {}),
    ...(result.integrity ? { integrity: integrityToWire(result.integrity) } : {}),
    ...(result.findings ? { findings: result.findings } : {})
  };
}

function findingsSummaryFromWire(value: JsonObject): NonNullable<NonNullable<RunRecord["result"]>["findings"]> {
  return {
    total: numberValue(value.total),
    errors: numberValue(value.errors),
    warnings: numberValue(value.warnings),
    info: numberValue(value.info),
    hints: numberValue(value.hints),
    rejected: numberValue(value.rejected)
  };
}

function resultFromWire(value: JsonObject): NonNullable<RunRecord["result"]> {
  return {
    ...(typeof value.stop_reason === "string" ? { stopReason: value.stop_reason } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(Array.isArray(value.changed_files) ? { changedFiles: value.changed_files.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(value.warnings) ? { warnings: value.warnings.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(value.artifacts) ? { artifacts: value.artifacts.filter(isObject).map((item) => ({ name: stringValue(item.name), path: stringValue(item.path), sha256: stringValue(item.sha256), bytes: numberValue(item.bytes), mediaType: stringValue(item.media_type) })) } : {}),
    ...(isObject(value.integrity) ? { integrity: integrityFromWire(value.integrity) } : {}),
    ...(isObject(value.findings) ? { findings: findingsSummaryFromWire(value.findings) } : {})
  };
}

export function integrityToWire(integrity: NonNullable<NonNullable<RunRecord["result"]>["integrity"]>): JsonObject {
  return {
    status: integrity.status,
    write_tool_observed: integrity.writeToolObserved,
    ...(integrity.changedPaths ? { changed_paths: integrity.changedPaths } : {}),
    ...(integrity.changedPathsTotal === undefined ? {} : { changed_paths_total: integrity.changedPathsTotal }),
    ...(integrity.reason ? { reason: integrity.reason } : {})
  };
}

function integrityFromWire(value: JsonObject): NonNullable<NonNullable<RunRecord["result"]>["integrity"]> {
  const status = value.status;
  if (status !== "verified" && status !== "changed" && status !== "unverified") throw new TypeError("Invalid persisted integrity status");
  return {
    status,
    writeToolObserved: value.write_tool_observed === true,
    ...(Array.isArray(value.changed_paths) ? { changedPaths: value.changed_paths.filter((item): item is string => typeof item === "string") } : {}),
    ...(typeof value.changed_paths_total === "number" ? { changedPathsTotal: value.changed_paths_total } : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {})
  };
}

function isObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asObject(value: unknown): JsonObject { return isObject(value) ? value : {}; }
function stringValue(value: unknown): string { if (typeof value !== "string") throw new TypeError("Invalid persisted string field"); return value; }
function numberValue(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Invalid persisted number field"); return value; }

function usageDetailsToWire(usage: NonNullable<RunRecord["usage"]>): JsonObject {
  return Object.fromEntries(([['prompt_tokens',usage.promptTokens],['completion_tokens',usage.completionTokens],['cached_tokens',usage.cachedTokens],['model_calls',usage.modelCalls],['cost_source',usage.costSource],['price_availability',usage.priceAvailability],['price_source',usage.priceSource],['cost_availability',usage.costAvailability]] as const).filter(([,value]) => value !== undefined));
}
function usageDetailsFromWire(raw: JsonObject): Partial<NonNullable<RunRecord["usage"]>> {
  const out: Partial<NonNullable<RunRecord["usage"]>> = {};
  for (const [wire,field] of [['prompt_tokens','promptTokens'],['completion_tokens','completionTokens'],['cached_tokens','cachedTokens'],['model_calls','modelCalls']] as const) {
    const value = raw[wire];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[field] = value;
    else if (value === null && (field === 'cachedTokens' || field === 'modelCalls')) out[field] = null;
  }
  if (raw.cost_source !== undefined && raw.cost_source !== 'runtime-stats-prices') throw new TypeError('Invalid persisted cost source');
  if (raw.cost_source === 'runtime-stats-prices') out.costSource = raw.cost_source;
  if (raw.price_availability !== undefined && raw.price_availability !== 'available' && raw.price_availability !== 'unavailable') throw new TypeError('Invalid persisted price availability');
  if (raw.price_availability === 'available' || raw.price_availability === 'unavailable') out.priceAvailability = raw.price_availability;
  if (raw.price_source !== undefined && raw.price_source !== 'runtime/read' && raw.price_source !== 'unavailable') throw new TypeError('Invalid persisted price source');
  if (raw.price_source === 'runtime/read' || raw.price_source === 'unavailable') out.priceSource = raw.price_source;
  if (raw.cost_availability !== undefined && raw.cost_availability !== 'available' && raw.cost_availability !== 'unavailable') throw new TypeError('Invalid persisted cost availability');
  if (raw.cost_availability === 'available' || raw.cost_availability === 'unavailable') out.costAvailability = raw.cost_availability;
  return out;
}
