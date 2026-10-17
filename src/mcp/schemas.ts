import path from "node:path";
import { acceptanceContractSchema, assessmentSchema } from "../acceptance/schema.js";
import { z } from "zod";

const runId = z.string().uuid({ version: "v4" });
const workspace = z.string().min(1).max(4096);
const task = z.string().min(1).max(100_000);
const waitSeconds = z.number().int().min(0).max(300).default(0);
export const MAX_TURNS_LIMIT = 50;
const maxTurns = z.number().int().min(1).max(MAX_TURNS_LIMIT).optional();
const timeoutSeconds = z.number().int().min(30).max(7200).optional();
const baseRef = z.string().min(1).max(512);
const readinessReceipt = z.string().min(1).max(2048).optional();

export const reviewStartSchema = z.object({
  task,
  cwd: workspace,
  context_files: z.array(z.string().min(1).max(4096)).max(50).default([]),
  output: z.enum(["text", "findings"]).default("text"),
  max_turns: maxTurns,
  timeout_seconds: timeoutSeconds,
  wait_seconds: waitSeconds,
  readiness_receipt: readinessReceipt
}).strict();

export const editStartSchema = z.object({
  task,
  cwd: workspace,
  base_ref: baseRef.default("HEAD"),
  acceptance_contract: acceptanceContractSchema.optional(),
  max_turns: maxTurns,
  timeout_seconds: timeoutSeconds,
  wait_seconds: waitSeconds,
  readiness_receipt: readinessReceipt
}).strict();

export const statusSchema = z.object({
  expected_candidate: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  run_id: runId.optional(),
  after_seq: z.number().int().min(0).default(0),
  max_events: z.number().int().min(0).max(100).default(10),
  wait_seconds: waitSeconds,
  workspace: workspace.optional(),
  operation: z.enum(["review", "edit"]).optional(),
  base_ref: baseRef.optional()
}).strict().superRefine((input, context) => {
  const issue = (message: string): void => { context.addIssue({ code: "custom", message }); };
  if ((input.run_id === undefined) === (input.workspace === undefined)) { issue("Pass exactly one of run_id (run status) or workspace (readiness check)."); return; }
  if (input.run_id !== undefined) {
    if (input.operation !== undefined || input.base_ref !== undefined || input.expected_candidate !== undefined) issue("operation and base_ref apply only to a workspace readiness check.");
    return;
  }
  if (!path.isAbsolute(input.workspace ?? "")) issue("workspace must be an absolute path.");
  if (input.operation === undefined) issue("A workspace readiness check requires operation: review or edit.");
  if (input.base_ref !== undefined && input.operation !== "edit") issue("base_ref applies only to an edit readiness check.");
});

export const resultSchema = z.object({
  run_id: runId,
  detail: z.enum(["compact", "full"]).default("compact"),
  include_transcript: z.boolean().default(false)
}).strict();

export const closeSchema = z.object({ run_id: runId, cleanup_worktree: z.boolean().default(false), assessment: assessmentSchema.optional() }).strict();

export const toolSchemas = {
  vibe_review_start: reviewStartSchema,
  vibe_edit_start: editStartSchema,
  vibe_status: statusSchema,
  vibe_result: resultSchema,
  vibe_close: closeSchema
} as const;

export type ToolName = keyof typeof toolSchemas;
