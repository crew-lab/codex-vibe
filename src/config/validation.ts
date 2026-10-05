import { z } from "zod";
import type { SupervisorConfig } from "../contracts.js";

const pathString = z.string().min(1).max(4096);
const configSchema = z.object({
  version: z.literal(1),
  backend: z.enum(["auto", "acp", "programmatic"]).default("programmatic"),
  allowed_workspace_roots: z.array(pathString).max(100).default([]),
  max_concurrent_runs: z.number().int().min(1).max(32).default(2),
  max_queued_runs: z.number().int().min(0).max(256).default(8),
  worker_idle_ttl_seconds: z.number().int().min(0).max(86_400).default(600),
  retention: z.object({
    days: z.number().int().min(0).max(3650).default(7),
    preserve_failed_runs: z.boolean().default(true)
  }).strict().prefault({}),
  limits: z.object({
    review_timeout_seconds: z.number().int().min(30).max(7200).default(1800),
    edit_timeout_seconds: z.number().int().min(30).max(7200).default(2400),
    max_turns_review: z.number().int().min(1).max(50).default(12),
    max_turns_edit: z.number().int().min(1).max(50).default(20),
    max_event_bytes: z.number().int().min(1024).max(1_073_741_824).default(52_428_800),
    max_transcript_bytes: z.number().int().min(1024).max(1_073_741_824).default(10_485_760),
    max_artifact_bytes: z.number().int().min(1024).max(2_147_483_648).default(104_857_600),
    max_mcp_result_chars: z.number().int().min(1000).max(1_000_000).default(8000),
    mcp_result_format: z.enum(["text", "structured", "both"]).default("text")
  }).strict().prefault({}),
  phase1: z.object({ allow_temporary_trust: z.boolean().default(false) }).strict().prefault({}),
  security: z.object({
    allow_shell_in_review: z.boolean().default(false),
    allow_shell_in_edit: z.boolean().default(false),
    allow_network_tools: z.boolean().default(false),
    log_raw_acp: z.boolean().default(false),
    persist_reasoning: z.literal(false).default(false)
  }).strict().prefault({}),
  paths: z.object({ vibe: pathString.optional(), vibe_acp: pathString.optional(), data_dir: pathString.optional() }).strict().optional()
}).strict();

export function validateConfig(input: unknown): SupervisorConfig {
  const parsed = configSchema.parse(input);
  return {
    version: parsed.version,
    backend: parsed.backend,
    allowedWorkspaceRoots: parsed.allowed_workspace_roots,
    maxConcurrentRuns: parsed.max_concurrent_runs,
    maxQueuedRuns: parsed.max_queued_runs,
    workerIdleTtlSeconds: parsed.worker_idle_ttl_seconds,
    retention: { days: parsed.retention.days, preserveFailedRuns: parsed.retention.preserve_failed_runs },
    limits: {
      reviewTimeoutSeconds: parsed.limits.review_timeout_seconds,
      editTimeoutSeconds: parsed.limits.edit_timeout_seconds,
      maxTurnsReview: parsed.limits.max_turns_review,
      maxTurnsEdit: parsed.limits.max_turns_edit,
      maxEventBytes: parsed.limits.max_event_bytes,
      maxTranscriptBytes: parsed.limits.max_transcript_bytes,
      maxArtifactBytes: parsed.limits.max_artifact_bytes,
      maxMcpResultChars: parsed.limits.max_mcp_result_chars,
      mcpResultFormat: parsed.limits.mcp_result_format
    },
    phase1: { allowTemporaryTrust: parsed.phase1.allow_temporary_trust },
    security: {
      allowShellInReview: parsed.security.allow_shell_in_review,
      allowShellInEdit: parsed.security.allow_shell_in_edit,
      allowNetworkTools: parsed.security.allow_network_tools,
      logRawAcp: parsed.security.log_raw_acp,
      persistReasoning: false
    },
    ...(parsed.paths ? { paths: {
      ...(parsed.paths.vibe === undefined ? {} : { vibe: parsed.paths.vibe }),
      ...(parsed.paths.vibe_acp === undefined ? {} : { vibeAcp: parsed.paths.vibe_acp }),
      ...(parsed.paths.data_dir === undefined ? {} : { dataDir: parsed.paths.data_dir })
    } } : {})
  };
}
