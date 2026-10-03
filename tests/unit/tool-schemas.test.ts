import { describe, expect, it } from "vitest";
import { toolSchemas } from "../../src/mcp/schemas.js";

const runId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("MCP tool input schemas", () => {
  it("exports the stable eight-tool surface", () => {
    expect(Object.keys(toolSchemas)).toEqual([
      "vibe_review_start", "vibe_edit_start", "vibe_status", "vibe_continue",
      "vibe_respond", "vibe_result", "vibe_cancel", "vibe_close"
    ]);
  });

  it("applies safe defaults to review/edit starts", () => {
    expect(toolSchemas.vibe_review_start.parse({ task: "Inspect", cwd: "/repo" })).toMatchObject({ backend: "auto", context_files: [], max_turns: 12, timeout_seconds: 1800 });
    expect(toolSchemas.vibe_edit_start.parse({ task: "Change", cwd: "/repo" })).toMatchObject({ base_ref: "HEAD", allow_shell: false, max_turns: 20, timeout_seconds: 2400 });
  });

  it("rejects unknown fields and invalid bounds before dispatch", () => {
    expect(() => toolSchemas.vibe_edit_start.parse({ task: "x", cwd: "/repo", isolation: "same-working-tree" })).toThrow();
    expect(() => toolSchemas.vibe_review_start.parse({ task: "x", cwd: "/repo", context_files: Array(51).fill("x") })).toThrow();
    expect(() => toolSchemas.vibe_continue.parse({ run_id: runId, message: "" })).toThrow();
  });

  it("accepts only the offered-choice form of permission responses", () => {
    expect(toolSchemas.vibe_respond.parse({ run_id: runId, request_id: "perm-1", kind: "permission", option_id: "allow-once" })).toMatchObject({ kind: "permission" });
    expect(() => toolSchemas.vibe_respond.parse({ run_id: runId, request_id: "perm-1", kind: "permission", action: "accept" })).toThrow();
    expect(() => toolSchemas.vibe_respond.parse({ run_id: runId, request_id: "perm-1", kind: "elicitation", option_id: "allow-once" })).toThrow();
  });
});
