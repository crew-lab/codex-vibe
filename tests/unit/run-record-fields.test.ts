import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from "../../src/contracts.js";
import { MAX_APPROVAL_LEDGER_RECORDS } from "../../src/contracts.js";
import { approvalsToWire, runFromWire, runToWire } from "../../src/core/serialization.js";
import { RunManager } from "../../src/core/run-manager.js";
import { TEST_CONFIG } from "./support/test-config.js";

const RUN_ID = "3c9e6a51-2f4d-4b8e-9a17-5d6c7b8a9f01";
const HASH = "ab".repeat(32);
const OTHER_HASH = "cd".repeat(32);

function recordWrittenBy201(): Record<string, unknown> {
  return {
    cleanup: { worktree: "none", checked_at: "2026-10-01T10:00:09.000Z" },
    schema_version: 1,
    supervisor_version: "2.0.1",
    run_id: RUN_ID,
    backend: "app-server",
    mode: "review",
    state: "closed",
    execution_state: "completed",
    source_workspace: "/work/project",
    worker_workspace: "/work/project",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:09.000Z",
    launched_at: "2026-10-01T10:00:01.000Z",
    started_at: "2026-10-01T10:00:02.000Z",
    finished_at: "2026-10-01T10:00:08.000Z",
    task_sha256: HASH,
    policy_revision: OTHER_HASH,
    admitted_root: "/work",
    workspace_snapshot_sha256: HASH,
    process: { executable: "/opt/vibe/bin/vibe-app-server", pid: 4242, version: "2.26.1" },
    limits: { timeout_seconds: 180, max_turns: 12, max_event_bytes: 52428800, max_transcript_bytes: 10485760, max_artifact_bytes: 104857600 },
    usage: { prompt_tokens: 39800, completion_tokens: 1400, cached_tokens: null, model_calls: null, cost_source: "runtime-stats-prices", tokens_used: 41200, context_size: 128000, cost: { amount: 0.031, currency: "USD", authoritative: false } },
    result: { stop_reason: "end_turn", summary: "No defect found.", artifacts: [{ name: "transcript.md", path: "/data/runs/x/transcript.md", sha256: HASH, bytes: 12, media_type: "text/markdown" }], changed_files: [], warnings: [] }
  };
}

function recordWith21Fields(): Record<string, unknown> {
  const base = recordWrittenBy201();
  return {
    ...base,
    excluded_globs: ["*.tfvars", "fixtures/private/**"],
    pin: { vibe_version: "2.26.1", manifest_sha256: HASH, record_sha256: OTHER_HASH },
    limits: { ...(base.limits as object), max_tokens: 200000, max_cost_usd: 0.5, max_model_calls: 17 },
    usage: { ...(base.usage as object), tool_calls: { executed: 7, denied_by_handler: 1, denied_by_policy: 0 } }
  };
}

function reorderLikeWriter(value: Record<string, unknown>): Record<string, unknown> {
  return runToWire(runFromWire(value));
}

describe("run record fields added in 2.1", () => {
  it("loads a 2.0.1 record without the new fields and re-serializes it byte for byte", () => {
    const written = recordWrittenBy201();
    const record = runFromWire(written);
    expect(record.limits).toEqual({ timeoutSeconds: 180, maxTurns: 12, maxEventBytes: 52428800, maxTranscriptBytes: 10485760, maxArtifactBytes: 104857600 });
    expect(record.usage?.toolCalls).toBeUndefined();
    expect(record.pin).toBeUndefined();
    expect(record.excludedGlobs).toBeUndefined();
    expect(JSON.stringify(runToWire(record))).toBe(JSON.stringify(written));
  });

  it("round-trips the ceilings, tool-call counts, exclusions and pin identity", () => {
    const wire = recordWith21Fields();
    const record = runFromWire(wire);
    expect(record.limits).toMatchObject({ maxTokens: 200000, maxCostUsd: 0.5, maxModelCalls: 17 });
    expect(record.usage?.toolCalls).toEqual({ executed: 7, deniedByHandler: 1, deniedByPolicy: 0 });
    expect(record.usage?.modelCalls).toBeNull();
    expect(record.excludedGlobs).toEqual(["*.tfvars", "fixtures/private/**"]);
    expect(record.pin).toEqual({ vibeVersion: "2.26.1", manifestSha256: HASH, recordSha256: OTHER_HASH });
    const again = runToWire(record);
    expect(again).toEqual(wire);
    expect(JSON.stringify(reorderLikeWriter(again))).toBe(JSON.stringify(again));
  });

  it("loads a decimal cost ceiling and validates each ceiling on its own terms", () => {
    const base = recordWrittenBy201();
    const withLimits = (extra: Record<string, unknown>) => ({ ...base, limits: { ...(base.limits as object), ...extra } });
    expect(runFromWire(withLimits({ max_cost_usd: 0.5 })).limits.maxCostUsd).toBe(0.5);
    expect(runFromWire(withLimits({ max_cost_usd: 1_000_000 })).limits.maxCostUsd).toBe(1_000_000);
    for (const invalid of [{ max_cost_usd: 0 }, { max_cost_usd: -1 }, { max_cost_usd: 1_000_000.01 }, { max_cost_usd: "0.5" }, { max_tokens: 0 }, { max_tokens: 1.5 }, { max_model_calls: -3 }, { max_model_calls: null }]) {
      expect(() => runFromWire(withLimits(invalid)), JSON.stringify(invalid)).toThrow(TypeError);
    }
    expect(() => runFromWire(withLimits({ max_turns: 0.5 }))).toThrow(TypeError);
  });

  it("rejects a malformed pin identity or exclusion list and ignores malformed tool-call counts", () => {
    const base = recordWith21Fields();
    expect(() => runFromWire({ ...base, pin: { vibe_version: "2.26.1", manifest_sha256: "short", record_sha256: HASH } })).toThrow(TypeError);
    expect(() => runFromWire({ ...base, pin: { vibe_version: "latest", manifest_sha256: HASH, record_sha256: HASH } })).toThrow(TypeError);
    expect(() => runFromWire({ ...base, excluded_globs: "*.tfvars" })).toThrow(TypeError);
    expect(() => runFromWire({ ...base, excluded_globs: [""] })).toThrow(TypeError);
    expect(() => runFromWire({ ...base, excluded_globs: Array(101).fill("*.sql") })).toThrow(TypeError);
    const usage = { ...(base.usage as object), tool_calls: { executed: 1, denied_by_handler: -1, denied_by_policy: 0 } };
    expect(runFromWire({ ...base, usage }).usage?.toolCalls).toBeUndefined();
  });

  it("serializes the approval ledger in wire names and bounds it", () => {
    const entry = { callbackId: "cb-1", relatedEntryId: "entry-1", turnId: "turn-1", tool: "file_system.read_file", path: "src/limit.mjs", fingerprint: HASH, decision: "approve" as const, reason: null };
    expect(approvalsToWire(RUN_ID, { records: [entry], truncated: false })).toEqual({
      schema_version: 1, run_id: RUN_ID, truncated: false,
      records: [{ callback_id: "cb-1", related_entry_id: "entry-1", turn_id: "turn-1", tool: "file_system.read_file", path: "src/limit.mjs", fingerprint: HASH, decision: "approve", reason: null }]
    });
    const many = Array.from({ length: MAX_APPROVAL_LEDGER_RECORDS + 1 }, (_, index) => ({ ...entry, callbackId: `cb-${index}` }));
    const bounded = approvalsToWire(RUN_ID, { records: many, truncated: false });
    expect(bounded.truncated).toBe(true);
    expect((bounded.records as unknown[]).length).toBe(MAX_APPROVAL_LEDGER_RECORDS);
  });
});

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

class RecordingBackend implements SupervisorBackend {
  readonly kind = "app-server" as const;
  input: StartRunInput | undefined;
  callbacks: BackendCallbacks | undefined;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.input = input; this.callbacks = callbacks;
    const handle: BackendRunHandle = { runId: input.runId, backend: this.kind, opaque: {} };
    return { handle, initialState: "running" };
  }
  async cancel() {}
  async close() {}
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the run");
}

describe("run manager records the 2.1 contract fields", () => {
  it("saves the ceilings in force, the admitted root's exclusions, the pin and the approval ledger", async () => {
    const parent = await mkdtemp(join(await realpath(tmpdir()), "vsup-fields-")); roots.push(parent);
    const source = join(parent, "source"); const unrelated = join(parent, "unrelated"); const data = join(parent, "data");
    await mkdir(source); await mkdir(unrelated);
    const backend = new RecordingBackend();
    const config = {
      ...TEST_CONFIG,
      allowedWorkspaceRoots: [source, unrelated],
      limits: { ...TEST_CONFIG.limits, maxTokens: 200000, maxCostUsd: 0.5 },
      excludedGlobs: { [source]: ["*.tfvars", "dumps/*.sql", "*.tfvars"], [unrelated]: ["never.txt"] }
    };
    const manager = new RunManager(config, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source, max_turns: 12 });
      await waitFor(async () => (await manager.status({ run_id: started.run_id })).state === "running");
      expect(backend.input?.excludedGlobs).toEqual(["*.tfvars", "dumps/*.sql"]);
      expect(backend.input?.limits).toMatchObject({ maxTurns: 12, maxTokens: 200000, maxCostUsd: 0.5, maxModelCalls: 17 });
      const pin = { vibeVersion: "2.26.1", manifestSha256: HASH, recordSha256: OTHER_HASH };
      await backend.callbacks?.onState("running", { pin });
      const approvals = { truncated: false, records: [
        { callbackId: "cb-1", relatedEntryId: "e-1", turnId: "t-1", tool: "file_system.read_file", path: "src/a.ts", fingerprint: HASH, decision: "approve" as const, reason: null },
        { callbackId: "cb-2", relatedEntryId: "e-2", turnId: "t-1", tool: "file_system.read_file", path: ".env", fingerprint: OTHER_HASH, decision: "deny" as const, reason: "path_secret" }
      ] };
      await backend.callbacks?.onState("completed", { result: { summary: "Done" }, usage: { tokensUsed: 10, toolCalls: { executed: 1, deniedByHandler: 1, deniedByPolicy: 0 } }, approvals });
      await waitFor(async () => (await manager.status({ run_id: started.run_id })).state === "completed");
      const directory = join(data, "runs", started.run_id);
      const meta = JSON.parse(await readFile(join(directory, "meta.json"), "utf8")) as Record<string, unknown>;
      expect(meta.limits).toEqual({ timeout_seconds: TEST_CONFIG.limits.reviewTimeoutSeconds, max_turns: 12, max_event_bytes: TEST_CONFIG.limits.maxEventBytes, max_transcript_bytes: TEST_CONFIG.limits.maxTranscriptBytes, max_artifact_bytes: TEST_CONFIG.limits.maxArtifactBytes, max_tokens: 200000, max_cost_usd: 0.5, max_model_calls: 17 });
      expect(meta.excluded_globs).toEqual(["*.tfvars", "dumps/*.sql"]);
      expect(meta.pin).toEqual({ vibe_version: "2.26.1", manifest_sha256: HASH, record_sha256: OTHER_HASH });
      expect(meta.usage).toEqual({ tokens_used: 10, tool_calls: { executed: 1, denied_by_handler: 1, denied_by_policy: 0 } });
      const ledgerText = await readFile(join(directory, "artifacts", "approvals.json"), "utf8");
      const ledger = JSON.parse(ledgerText) as { run_id: string; truncated: boolean; records: Array<{ callback_id: string; decision: string; reason: string | null }> };
      expect(ledger).toMatchObject({ run_id: started.run_id, truncated: false });
      expect(ledger.records.map((record) => [record.callback_id, record.decision, record.reason])).toEqual([["cb-1", "approve", null], ["cb-2", "deny", "path_secret"]]);
      const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8")) as { artifacts: Array<{ name: string; sha256: string }>; usage: unknown };
      expect(result.artifacts.find((artifact) => artifact.name === "approvals.json")?.sha256).toBe(createHash("sha256").update(ledgerText).digest("hex"));
      expect(result.usage).toEqual(meta.usage);
    } finally { await manager.shutdown(); }
  });

  it("records an empty exclusion list and no ledger when neither is provided", async () => {
    const parent = await mkdtemp(join(await realpath(tmpdir()), "vsup-fields-")); roots.push(parent);
    const source = join(parent, "source"); const data = join(parent, "data");
    await mkdir(source);
    const backend = new RecordingBackend();
    const manager = new RunManager({ ...TEST_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      await waitFor(async () => (await manager.status({ run_id: started.run_id })).state === "running");
      expect(backend.input?.excludedGlobs).toEqual([]);
      expect(backend.input?.limits.maxTokens).toBeUndefined();
      expect(backend.input?.limits.maxCostUsd).toBeUndefined();
      await backend.callbacks?.onState("completed", { result: { summary: "Done" } });
      await waitFor(async () => (await manager.status({ run_id: started.run_id })).state === "completed");
      const meta = JSON.parse(await readFile(join(data, "runs", started.run_id, "meta.json"), "utf8")) as Record<string, unknown>;
      expect(meta.excluded_globs).toEqual([]);
      expect(meta.limits).toMatchObject({ max_model_calls: TEST_CONFIG.limits.maxTurnsReview + 5 });
      expect(meta).not.toHaveProperty("pin");
      const result = JSON.parse(await readFile(join(data, "runs", started.run_id, "result.json"), "utf8")) as { artifacts: Array<{ name: string }> };
      expect(result.artifacts.map((artifact) => artifact.name)).not.toContain("approvals.json");
    } finally { await manager.shutdown(); }
  });
});
