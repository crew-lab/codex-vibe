import path from "node:path";
import { z } from "zod";
import type { SupervisorConfig } from "../contracts.js";
import { MAX_TURNS_LIMIT } from "../mcp/schemas.js";

const pathString = z.string().min(1).max(4096);
const rootString = pathString.refine((value) => path.isAbsolute(value) || value === "~" || value.startsWith("~/"), "must be an absolute path or start with ~/");
const executableString = pathString.refine((value) => path.isAbsolute(value) || !/[\\/]/.test(value), "must be an absolute path or a bare command name");
const configSchema = z.object({
  version: z.literal(1),
  backend: z.enum(["programmatic", "acp"], { error: "backend must be \"programmatic\" or \"acp\"" }).default("programmatic"),
  allowed_workspace_roots: z.array(rootString).max(100).default([]),
  max_concurrent_runs: z.number().int().min(1).max(32).default(2),
  worker_idle_ttl_seconds: z.number().int().min(0).max(86_400).default(600),
  retention: z.object({
    days: z.number().int().min(0).max(3650).default(7)
  }).strict().prefault({}),
  limits: z.object({
    review_timeout_seconds: z.number().int().min(30).max(7200).default(1800),
    edit_timeout_seconds: z.number().int().min(30).max(7200).default(2400),
    max_turns_review: z.number().int().min(1).max(MAX_TURNS_LIMIT).default(20),
    max_turns_edit: z.number().int().min(1).max(MAX_TURNS_LIMIT).default(20),
    max_event_bytes: z.number().int().min(1024).max(1_073_741_824).default(52_428_800),
    max_transcript_bytes: z.number().int().min(1024).max(1_073_741_824).default(10_485_760),
    max_artifact_bytes: z.number().int().min(1024).max(2_147_483_648).default(104_857_600),
    worker_progress_timeout_seconds: z.number().int().refine((value) => value === 0 || (value >= 60 && value <= 7200), "must be 0 or between 60 and 7200").default(600),
    max_mcp_result_chars: z.number().int().min(1000).max(1_000_000).default(8000)
  }).strict().prefault({}),
  paths: z.object({ vibe: executableString.optional(), vibe_acp: executableString.optional() }).strict().optional()
}).strict();

export function validateConfig(input: unknown): SupervisorConfig {
  const parsed = configSchema.parse(input);
  return {
    version: parsed.version,
    backend: parsed.backend,
    allowedWorkspaceRoots: parsed.allowed_workspace_roots,
    maxConcurrentRuns: parsed.max_concurrent_runs,
    workerIdleTtlSeconds: parsed.worker_idle_ttl_seconds,
    retention: { days: parsed.retention.days },
    limits: {
      reviewTimeoutSeconds: parsed.limits.review_timeout_seconds,
      editTimeoutSeconds: parsed.limits.edit_timeout_seconds,
      maxTurnsReview: parsed.limits.max_turns_review,
      maxTurnsEdit: parsed.limits.max_turns_edit,
      maxEventBytes: parsed.limits.max_event_bytes,
      maxTranscriptBytes: parsed.limits.max_transcript_bytes,
      maxArtifactBytes: parsed.limits.max_artifact_bytes,
      workerProgressTimeoutSeconds: parsed.limits.worker_progress_timeout_seconds,
      maxMcpResultChars: parsed.limits.max_mcp_result_chars
    },
    ...(parsed.paths ? { paths: {
      ...(parsed.paths.vibe === undefined ? {} : { vibe: parsed.paths.vibe }),
      ...(parsed.paths.vibe_acp === undefined ? {} : { vibeAcp: parsed.paths.vibe_acp })
    } } : {})
  };
}
