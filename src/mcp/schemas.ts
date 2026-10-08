import { z } from "zod";

const runId = z.string().uuid({ version: "v4" });
const workspace = z.string().min(1).max(4096);
const task = z.string().min(1).max(100_000);
const waitSeconds = z.number().int().min(0).max(300).default(0);
export const MAX_TURNS_LIMIT = 50;
const maxTurns = z.number().int().min(1).max(MAX_TURNS_LIMIT).optional();
const timeoutSeconds = z.number().int().min(30).max(7200).optional();

export const reviewStartSchema = z.object({
  task,
  cwd: workspace,
  context_files: z.array(z.string().min(1).max(4096)).max(50).default([]),
  max_turns: maxTurns,
  timeout_seconds: timeoutSeconds,
  wait_seconds: waitSeconds
}).strict();

export const editStartSchema = z.object({
  task,
  cwd: workspace,
  base_ref: z.string().min(1).max(512).default("HEAD"),
  max_turns: maxTurns,
  timeout_seconds: timeoutSeconds,
  wait_seconds: waitSeconds
}).strict();

export const statusSchema = z.object({
  run_id: runId,
  after_seq: z.number().int().min(0).default(0),
  max_events: z.number().int().min(0).max(100).default(10),
  wait_seconds: waitSeconds
}).strict();

export const continueSchema = z.object({ run_id: runId, message: task, max_turns: maxTurns }).strict();

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
  detail: z.enum(["compact", "full"]).default("compact"),
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
  vibe_close: closeSchema
} as const;

export type ToolName = keyof typeof toolSchemas;
