import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { assertWorkspaceRootScope } from "../security/paths.js";
import { BACKEND_KINDS, type SupervisorConfig } from "../contracts.js";
import { MAX_TURNS_LIMIT } from "../mcp/schemas.js";
import { SELECTABLE_VIBE_VERSIONS } from "../backends/app-server/supported-vibe.js";

const pathString = z.string().min(1).max(4096);
const rootString = pathString.refine((value) => path.isAbsolute(value) || value === "~" || value.startsWith("~/"), "must be an absolute path or start with ~/");
const executableString = pathString.refine((value) => path.isAbsolute(value) || !/[\\/]/.test(value), "must be an absolute path or a bare command name");
const absolutePathString = pathString.refine((value) => path.isAbsolute(value), "must be an absolute path");
export const MAX_EXCLUDED_GLOBS_PER_ROOT = 100;
export const MAX_EXCLUDED_GLOB_CHARS = 256;
export const MAX_EXCLUDED_GLOB_SEGMENTS = 16;
const GLOB_SEGMENT_CHARACTERS = /^[A-Za-z0-9._@+=,*-]+$/;

export function excludedGlobProblem(glob: string): string | null {
  if (glob.length < 1 || glob.length > MAX_EXCLUDED_GLOB_CHARS) return `must be 1 to ${MAX_EXCLUDED_GLOB_CHARS} characters`;
  if (glob.startsWith("/")) return "must be relative to the workspace, not start with /";
  if (glob.startsWith("~")) return "must not start with ~";
  const segments = glob.split("/");
  if (segments.length > MAX_EXCLUDED_GLOB_SEGMENTS) return `must have at most ${MAX_EXCLUDED_GLOB_SEGMENTS} segments`;
  for (const segment of segments) {
    if (segment === "") return "must not contain an empty segment (a leading, trailing or doubled /)";
    if (segment === "." || segment === "..") return "must not contain a . or .. segment";
    if (!GLOB_SEGMENT_CHARACTERS.test(segment)) return "may only use ASCII letters, digits and . _ - @ + = , * in a segment (no negation, ?, [ ], braces or backslash)";
    if (segment.includes("**") && segment !== "**") return "may use ** only as a whole segment";
  }
  return null;
}

const excludedGlobString = z.string().superRefine((value, context) => {
  const problem = excludedGlobProblem(value);
  if (problem !== null) context.addIssue({ code: "custom", message: problem });
});

const baseSchema = z.object({
  version: z.literal(1),
  backend: z.enum(BACKEND_KINDS).optional(),
  vibe_version: z.enum(SELECTABLE_VIBE_VERSIONS).optional(),
  allowed_workspace_roots: z.array(rootString).max(100).default([]),
  excluded_globs: z.record(pathString, z.array(excludedGlobString).max(MAX_EXCLUDED_GLOBS_PER_ROOT)).optional(),
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
    max_mcp_result_chars: z.number().int().min(1000).max(1_000_000).default(8000),
    max_tokens: z.number().int().min(1).max(1_000_000_000).optional(),
    max_cost_usd: z.number().positive().max(1_000_000).optional()
  }).strict().prefault({}),
  paths: z.object({
    vibe: executableString.optional(),
    app_server: executableString.optional(),
    vibe_pin_manifest: absolutePathString.optional(),
    antigravity: executableString.optional()
  }).strict().optional(),
  budgets: z.record(
    pathString,
    z.object({
      max_cost_usd_per_day: z.number().positive().max(1_000_000).optional()
    }).strict()
  ).optional(),
  experimental: z.object({
    antigravity: z.boolean().optional()
  }).strict().optional()
}).strict().superRefine((value, context) => {
  if (value.backend === "antigravity" && value.experimental?.antigravity !== true) {
    context.addIssue({ code: "custom", path: ["backend"], message: `"antigravity" is an experimental backend and is off by default; set [experimental] antigravity = true to opt in after following docs/target-acceptance.md, or remove backend to use the default app-server.` });
  }
  if (value.backend === "antigravity") {
    for (const [root, budget] of Object.entries(value.budgets ?? {})) {
      if (budget.max_cost_usd_per_day !== undefined) {
        context.addIssue({ code: "custom", path: ["budgets", root, "max_cost_usd_per_day"], message: "cannot be enforced with backend = \"antigravity\", because Antigravity reports no USD cost; remove it or use the app-server backend." });
      }
    }
  }
  for (const root of Object.keys(value.excluded_globs ?? {})) {
    if (!value.allowed_workspace_roots.includes(root)) {
      context.addIssue({ code: "custom", path: ["excluded_globs", root], message: "must equal an entry of allowed_workspace_roots, written the same way; an exclusion never grants access." });
    }
  }
  for (const root of Object.keys(value.budgets ?? {})) {
    if (!value.allowed_workspace_roots.includes(root)) {
      context.addIssue({ code: "custom", path: ["budgets", root], message: "must equal an entry of allowed_workspace_roots, written the same way; a budget can only be set on an allowed root." });
    }
  }
});

const strictSchema = baseSchema.superRefine((value, context) => {
  if (value.backend !== "antigravity" && value.paths?.vibe_pin_manifest === undefined) {
    context.addIssue({
      code: "custom",
      path: ["paths", "vibe_pin_manifest"],
      message: "is required: set it to the absolute path of the pin manifest, write the manifest there with `vibe-supervisor pin-manifest --output <that path>`, then restart the server."
    });
  }
});

function normalizeExcludedGlobs(input: Record<string, string[]> | undefined): Record<string, string[]> | undefined {
  const entries = Object.entries(input ?? {})
    .map(([root, globs]): [string, string[]] => [root, [...new Set(globs)]])
    .filter(([, globs]) => globs.length > 0);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function normalizeBudgets(input: Record<string, { max_cost_usd_per_day?: number | undefined }> | undefined): Record<string, { maxCostUsdPerDay?: number }> | undefined {
  if (!input) return undefined;
  const entries: [string, { maxCostUsdPerDay?: number }][] = [];
  for (const [root, budget] of Object.entries(input)) {
    if (budget.max_cost_usd_per_day !== undefined) {
      entries.push([root, { maxCostUsdPerDay: budget.max_cost_usd_per_day }]);
    }
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export interface ValidateConfigOptions {
  requirePinManifest?: boolean;
}

export function validateConfig(input: unknown, home = process.env.HOME ?? process.env.USERPROFILE ?? homedir(), options: ValidateConfigOptions = {}): SupervisorConfig {
  const parsed = (options.requirePinManifest === false ? baseSchema : strictSchema).parse(input);
  const expandedRoots = new Map<string, string>();
  for (const root of parsed.allowed_workspace_roots) {
    let expanded: string;
    try { expanded = assertWorkspaceRootScope(root, home); }
    catch (error) { throw new Error(`allowed_workspace_roots contains an unsafe root: ${(error as Error).message}`); }
    const earlier = expandedRoots.get(expanded);
    if (earlier !== undefined) throw new Error(`allowed_workspace_roots lists the same root twice (${JSON.stringify(earlier)} and ${JSON.stringify(root)}); keep one entry and merge its excluded_globs.`);
    expandedRoots.set(expanded, root);
  }
  const excludedGlobs = normalizeExcludedGlobs(parsed.excluded_globs);
  const budgets = normalizeBudgets(parsed.budgets);
  return {
    version: parsed.version,
    ...(parsed.backend === undefined ? {} : { backend: parsed.backend }),
    ...(parsed.vibe_version === undefined ? {} : { vibeVersion: parsed.vibe_version }),
    allowedWorkspaceRoots: parsed.allowed_workspace_roots,
    ...(excludedGlobs === undefined ? {} : { excludedGlobs }),
    ...(budgets === undefined ? {} : { budgets }),
    ...(parsed.experimental === undefined ? {} : { experimental: { ...(parsed.experimental.antigravity === undefined ? {} : { antigravity: parsed.experimental.antigravity }) } }),
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
      maxMcpResultChars: parsed.limits.max_mcp_result_chars,
      ...(parsed.limits.max_tokens === undefined ? {} : { maxTokens: parsed.limits.max_tokens }),
      ...(parsed.limits.max_cost_usd === undefined ? {} : { maxCostUsd: parsed.limits.max_cost_usd })
    },
    paths: parsed.paths ? {
      ...(parsed.paths.vibe === undefined ? {} : { vibe: parsed.paths.vibe }),
      ...(parsed.paths.app_server === undefined ? {} : { appServer: parsed.paths.app_server }),
      ...(parsed.paths.vibe_pin_manifest === undefined ? {} : { vibePinManifest: parsed.paths.vibe_pin_manifest }),
      ...(parsed.paths.antigravity === undefined ? {} : { antigravity: parsed.paths.antigravity })
    } : {}
  };
}
