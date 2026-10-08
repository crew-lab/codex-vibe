import { describe, expect, it } from "vitest";
import { toolSchemas } from "../../src/mcp/schemas.js";

const runId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("MCP tool input schemas", () => {
  it("exports the stable seven-tool surface", () => {
    expect(Object.keys(toolSchemas)).toEqual([
      "vibe_review_start", "vibe_edit_start", "vibe_status", "vibe_continue",
      "vibe_respond", "vibe_result", "vibe_close"
    ]);
  });

  it("leaves turn and timeout limits to the configured defaults", () => {
    const review = toolSchemas.vibe_review_start.parse({ task: "Inspect", cwd: "/repo" });
    expect(review).toMatchObject({ context_files: [] });
    expect(review.max_turns).toBeUndefined();
    expect(review.timeout_seconds).toBeUndefined();
    const edit = toolSchemas.vibe_edit_start.parse({ task: "Change", cwd: "/repo" });
    expect(edit).toMatchObject({ base_ref: "HEAD" });
    expect(edit.max_turns).toBeUndefined();
    expect(edit.timeout_seconds).toBeUndefined();
    expect(toolSchemas.vibe_review_start.parse({ task: "Inspect", cwd: "/repo", max_turns: 3, timeout_seconds: 60 })).toMatchObject({ max_turns: 3, timeout_seconds: 60 });
  });

  it("rejects unknown fields and invalid bounds before dispatch", () => {
    expect(() => toolSchemas.vibe_edit_start.parse({ task: "x", cwd: "/repo", isolation: "same-working-tree" })).toThrow();
    expect(() => toolSchemas.vibe_review_start.parse({ task: "x", cwd: "/repo", context_files: Array(51).fill("x") })).toThrow();
    expect(() => toolSchemas.vibe_continue.parse({ run_id: runId, message: "" })).toThrow();
    expect(toolSchemas.vibe_continue.parse({ run_id: runId, message: "go" })).not.toHaveProperty("max_turns");
    expect(toolSchemas.vibe_continue.parse({ run_id: runId, message: "go", max_turns: 50 }).max_turns).toBe(50);
    for (const bad of [0, 51, 1.5]) expect(() => toolSchemas.vibe_continue.parse({ run_id: runId, message: "go", max_turns: bad })).toThrow();
    expect(() => toolSchemas.vibe_review_start.parse({ task: "x", cwd: "/repo", max_turns: 51 })).toThrow();
    expect(() => toolSchemas.vibe_edit_start.parse({ task: "x", cwd: "/repo", timeout_seconds: 29 })).toThrow();
  });

  it("rejects the removed allow_shell, backend and detail summary inputs", () => {
    expect(() => toolSchemas.vibe_edit_start.parse({ task: "x", cwd: "/repo", allow_shell: false })).toThrow();
    expect(() => toolSchemas.vibe_edit_start.parse({ task: "x", cwd: "/repo", allow_shell: true })).toThrow();
    expect(() => toolSchemas.vibe_review_start.parse({ task: "x", cwd: "/repo", backend: "acp" })).toThrow();
    expect(() => toolSchemas.vibe_edit_start.parse({ task: "x", cwd: "/repo", backend: "auto" })).toThrow();
    expect(() => toolSchemas.vibe_result.parse({ run_id: runId, detail: "summary" })).toThrow();
    expect(toolSchemas.vibe_result.parse({ run_id: runId, detail: "full" })).toMatchObject({ detail: "full" });
    expect(toolSchemas.vibe_result.parse({ run_id: runId })).toMatchObject({ detail: "compact" });
  });

  it("accepts only the offered-choice form of permission responses", () => {
    expect(toolSchemas.vibe_respond.parse({ run_id: runId, request_id: "perm-1", kind: "permission", option_id: "allow-once" })).toMatchObject({ kind: "permission" });
    expect(() => toolSchemas.vibe_respond.parse({ run_id: runId, request_id: "perm-1", kind: "permission", action: "accept" })).toThrow();
    expect(() => toolSchemas.vibe_respond.parse({ run_id: runId, request_id: "perm-1", kind: "elicitation", option_id: "allow-once" })).toThrow();
  });
});
