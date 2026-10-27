import { describe, expect, it } from "vitest";
import { toolSchemas } from "../../src/mcp/schemas.js";

const runId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("MCP tool input schemas", () => {
  it("exports the stable five-tool surface", () => {
    expect(Object.keys(toolSchemas)).toEqual([
      "vibe_review_start", "vibe_edit_start", "vibe_status", "vibe_result", "vibe_close"
    ]);
  });

  it("leaves turn and timeout limits to the configured defaults", () => {
    const review = toolSchemas.vibe_review_start.parse({ authorization_id: runId, attempt_id: runId, task: "Inspect", cwd: "/repo" });
    expect(review).toMatchObject({ context_files: [], output: "text" });
    expect(review.max_turns).toBeUndefined();
    expect(review.timeout_seconds).toBeUndefined();
    expect(toolSchemas.vibe_review_start.parse({ authorization_id: runId, attempt_id: runId, task: "Inspect", cwd: "/repo", output: "findings" })).toMatchObject({ output: "findings" });
    const edit = toolSchemas.vibe_edit_start.parse({ authorization_id: runId, attempt_id: runId, task: "Change", cwd: "/repo" });
    expect(edit).toMatchObject({ base_ref: "HEAD" });
    expect(() => toolSchemas.vibe_edit_start.parse({ authorization_id: runId, attempt_id: runId, task: "Change", cwd: "/repo", session_mode: "correctable" })).toThrow();
    expect(() => toolSchemas.vibe_edit_start.parse({ authorization_id: runId, attempt_id: runId, task: "Change", cwd: "/repo", max_corrections: 1 })).toThrow();
    expect(edit.max_turns).toBeUndefined();
    expect(edit.timeout_seconds).toBeUndefined();
    expect(toolSchemas.vibe_review_start.parse({ authorization_id: runId, attempt_id: runId, task: "Inspect", cwd: "/repo", max_turns: 3, timeout_seconds: 60 })).toMatchObject({ max_turns: 3, timeout_seconds: 60 });
  });

  it("accepts allowed_write_paths as safe file or directory paths and rejects the rest", () => {
    const base = { authorization_id: runId, attempt_id: runId, task: "Change", cwd: "/repo" };
    expect(toolSchemas.vibe_edit_start.parse({ ...base, allowed_write_paths: ["src/a.ts", "docs/"] })).toMatchObject({ allowed_write_paths: ["src/a.ts", "docs/"] });
    for (const bad of [[], ["../a.ts"], ["/abs.ts"], [".env"], [".git/"], ["a//b"], ["src/a.ts", "src/a.ts"], ["/"]]) {
      expect(() => toolSchemas.vibe_edit_start.parse({ ...base, allowed_write_paths: bad }), JSON.stringify(bad)).toThrow();
    }
    expect(() => toolSchemas.vibe_review_start.parse({ ...base, allowed_write_paths: ["src/a.ts"] })).toThrow();
  });

  it("requires UUIDv4 authorization and attempt identifiers on each start", () => {
    for (const schema of [toolSchemas.vibe_review_start, toolSchemas.vibe_edit_start]) {
      expect(() => schema.parse({ task: "Inspect", cwd: "/repo" })).toThrow();
      expect(() => schema.parse({ authorization_id: "123e4567-e89b-12d3-a456-426614174000", attempt_id: runId, task: "Inspect", cwd: "/repo" })).toThrow();
      expect(() => schema.parse({ authorization_id: runId, attempt_id: "123e4567-e89b-12d3-a456-426614174000", task: "Inspect", cwd: "/repo" })).toThrow();
    }
  });

  it("rejects unknown fields and invalid bounds before dispatch", () => {
    expect(() => toolSchemas.vibe_edit_start.parse({ authorization_id: runId, attempt_id: runId, task: "x", cwd: "/repo", isolation: "same-working-tree" })).toThrow();
    expect(() => toolSchemas.vibe_review_start.parse({ authorization_id: runId, attempt_id: runId, task: "x", cwd: "/repo", context_files: Array(51).fill("x") })).toThrow();
    expect(() => toolSchemas.vibe_review_start.parse({ authorization_id: runId, attempt_id: runId, task: "x", cwd: "/repo", max_turns: 51 })).toThrow();
    expect(() => toolSchemas.vibe_edit_start.parse({ authorization_id: runId, attempt_id: runId, task: "x", cwd: "/repo", timeout_seconds: 29 })).toThrow();
  });

  it("rejects the removed allow_shell, backend and detail summary inputs", () => {
    expect(() => toolSchemas.vibe_edit_start.parse({ authorization_id: runId, attempt_id: runId, task: "x", cwd: "/repo", allow_shell: false })).toThrow();
    expect(() => toolSchemas.vibe_edit_start.parse({ authorization_id: runId, attempt_id: runId, task: "x", cwd: "/repo", allow_shell: true })).toThrow();
    expect(() => toolSchemas.vibe_review_start.parse({ authorization_id: runId, attempt_id: runId, task: "x", cwd: "/repo", backend: "acp" })).toThrow();
    expect(() => toolSchemas.vibe_edit_start.parse({ authorization_id: runId, attempt_id: runId, task: "x", cwd: "/repo", backend: "auto" })).toThrow();
    expect(() => toolSchemas.vibe_result.parse({ run_id: runId, detail: "summary" })).toThrow();
    expect(toolSchemas.vibe_result.parse({ run_id: runId, detail: "full" })).toMatchObject({ detail: "full" });
    expect(toolSchemas.vibe_result.parse({ run_id: runId })).toMatchObject({ detail: "compact" });
  });

  it("records a close decision only through assessment, never a separate accepted field", () => {
    const hash = "a".repeat(64);
    const assessment = { decision: "accepted", reason: "Checked independently", patch_sha256: hash, contract_sha256: hash };
    expect(toolSchemas.vibe_close.parse({ run_id: runId })).toEqual({ run_id: runId, cleanup_worktree: false });
    expect(toolSchemas.vibe_close.parse({ run_id: runId, assessment })).toMatchObject({ assessment: { decision: "accepted", validations: [] } });
    expect(Object.keys(toolSchemas.vibe_close.shape)).toEqual(["run_id", "cleanup_worktree", "assessment"]);
    expect(() => toolSchemas.vibe_close.parse({ run_id: runId, accepted: true })).toThrow();
    expect(() => toolSchemas.vibe_close.parse({ run_id: runId, accepted: false, reason: "No" })).toThrow();
    expect(() => toolSchemas.vibe_close.parse({ run_id: runId, assessment: { ...assessment, reason: "" } })).toThrow();
    expect(() => toolSchemas.vibe_close.parse({ run_id: runId, assessment: { ...assessment, decision: "maybe" } })).toThrow();
  });

});
