import { z } from "zod";

const runId = z.string().uuid({ version: "v4" });
const workspace = z.string().min(1).max(4096);
const task = z.string().min(1).max(100_000);
const backend = z.enum(["auto", "acp", "programmatic"]).default("auto");

export const reviewStartSchema = z.object({
  task,
  cwd: workspace,
  context_files: z.array(z.string().min(1).max(4096)).max(50).default([]),
  backend,
  max_turns: z.number().int().min(1).max(50).default(12),
  timeout_seconds: z.number().int().min(30).max(7200).default(1800)
}).strict();

export const editStartSchema = z.object({
  task,
  cwd: workspace,
  base_ref: z.string().min(1).max(512).default("HEAD"),
  backend,
  allow_shell: z.boolean().default(false),
  max_turns: z.number().int().min(1).max(50).default(20),
  timeout_seconds: z.number().int().min(30).max(7200).default(2400)
}).strict();

export const statusSchema = z.object({
  run_id: runId,
  after_seq: z.number().int().min(0).default(0),
  max_events: z.number().int().min(0).max(100).default(20)
}).strict();

export const continueSchema = z.object({ run_id: runId, message: task }).strict();

export const respondSchema = z.discriminatedUnion("kind", [
  z.object({ run_id: runId, request_id: z.string().min(1).max(512), kind: z.literal("permission"), option_id: z.string().min(1).max(512) }).strict(),
  z.object({
    run_id: runId,
    request_id: z.string().min(1).max(512),
    kind: z.literal("elicitation"),
    action: z.enum(["accept", "decline", "cancel"]),
    content: z.record(z.string(), z.unknown()).optional()
  }).strict()
]);

export const resultSchema = z.object({
  run_id: runId,
  detail: z.enum(["summary", "full"]).default("summary"),
  include_transcript: z.boolean().default(false)
}).strict();

export const cancelSchema = z.object({ run_id: runId }).strict();
export const closeSchema = z.object({ run_id: runId, cleanup_worktree: z.boolean().default(false) }).strict();

export const toolSchemas = {
  vibe_review_start: reviewStartSchema,
  vibe_edit_start: editStartSchema,
  vibe_status: statusSchema,
  vibe_continue: continueSchema,
  vibe_respond: respondSchema,
  vibe_result: resultSchema,
  vibe_cancel: cancelSchema,
  vibe_close: closeSchema
} as const;

export type ToolName = keyof typeof toolSchemas;
