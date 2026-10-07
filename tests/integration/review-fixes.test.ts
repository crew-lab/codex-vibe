import { chmod, mkdtemp, mkdir, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend, SupervisorConfig } from "../../src/contracts.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { RunManager } from "../../src/core/run-manager.js";
import { bounded } from "../../src/mcp/tools.js";
import { toolSchemas } from "../../src/mcp/schemas.js";

const roots: string[] = [];
const canonicalTmp = await realpath(tmpdir());
const exec = promisify(execFile);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class FakeBackend implements SupervisorBackend {
  readonly kind = "programmatic" as const;
  handle: BackendRunHandle | undefined;
  callbacks: BackendCallbacks | undefined;
  beforeReturn: ((input: StartRunInput) => Promise<void>) | undefined;
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks = callbacks;
    this.handle = { runId: input.runId, backend: this.kind, opaque: {} };
    await this.beforeReturn?.(input);
    return { handle: this.handle, initialState: "running" };
  }
  async continue() {}
  async respond() {}
  async cancel() {}
  async close() {}
  async recover(_record: RunRecord) { return this.handle; }
}

async function setup(backend = new FakeBackend(), overrides: Partial<SupervisorConfig> = {}) {
  const parent = await mkdtemp(join(canonicalTmp, "vsup-review-")); roots.push(parent);
  const source = join(parent, "source"); const data = join(parent, "data");
  await mkdir(source);
  const config = { ...DEFAULT_CONFIG, backend: "programmatic" as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 0, ...overrides };
  const manager = new RunManager(config, data, [backend]);
  return { parent, source, data, manager, backend };
}

async function setupGit(backend: FakeBackend) {
  const context = await setup(backend);
  await writeFile(join(context.source, "tracked.txt"), "original\n");
  await exec("git", ["init", "-q"], { cwd: context.source });
  await exec("git", ["config", "user.email", "vsup@example.invalid"], { cwd: context.source });
  await exec("git", ["config", "user.name", "Vibe Supervisor Test"], { cwd: context.source });
  await exec("git", ["add", "tracked.txt"], { cwd: context.source });
  await exec("git", ["commit", "-qm", "baseline"], { cwd: context.source });
  return context;
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for run-manager state");
}

async function runningReview(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: "review", cwd: source });
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
  return started.run_id;
}

function runDirectory(manager: RunManager, runId: string): string {
  return (manager as unknown as { runs: Map<string, { directory: string }> }).runs.get(runId)!.directory;
}

async function integrityEvents(manager: RunManager, runId: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(runDirectory(manager, runId), "events.ndjson"), "utf8");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>).filter((event) => event.type === "review_integrity");
}

const CHANGED_WITH_WRITE = "Possible read-only boundary violation: the review worker issued a write-capable tool call and the source workspace changed. Inspect the changed paths before trusting the review.";
const CHANGED_PLAIN = "The source workspace changed during this read-only review. The changes may be your own edits or a read-only boundary violation; inspect the changed paths before trusting the review.";
const UNVERIFIED = "The source workspace could not be snapshotted (too large or unreadable); review integrity was NOT checked, so a read-only boundary violation would go undetected.";

describe("review integrity", () => {
  async function prepared(backend = new FakeBackend()) {
    const context = await setup(backend);
    await writeFile(join(context.source, "a.txt"), "a\n");
    await writeFile(join(context.source, "b.txt"), "b\n");
    await mkdir(join(context.source, "dir"));
    await writeFile(join(context.source, "dir", "keep.txt"), "keep\n");
    return context;
  }

  it("flags a changed workspace without a write tool as a warning", async () => {
    const { source, manager, backend } = await prepared();
    try {
      const runId = await runningReview(manager, source);
      await writeFile(join(source, "a.txt"), "changed\n");
      await unlink(join(source, "b.txt"));
      await writeFile(join(source, "dir", "new.txt"), "new\n");
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      const full = await manager.result({ run_id: runId, detail: "full" });
      expect(full.state).toBe("completed");
      const expected = { status: "changed", changed_paths: ["a.txt", "b.txt", "dir/new.txt"], changed_paths_total: 3, write_tool_observed: false, reason: expect.stringContaining("changed") };
      expect(full.integrity).toMatchObject(expected);
      expect(full.warnings).toContain(CHANGED_PLAIN);
      expect(full.warnings).not.toContain(CHANGED_WITH_WRITE);
      expect((await manager.result({ run_id: runId })).integrity).toMatchObject(expected);
      const saved = JSON.parse(await readFile(join(runDirectory(manager, runId), "result.json"), "utf8")) as Record<string, unknown>;
      expect(saved.integrity).toMatchObject(expected);
      expect(saved.warnings).toContain(CHANGED_PLAIN);
      const events = await integrityEvents(manager, runId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ source: "supervisor", severity: "warning", data: expected });
    } finally { await manager.shutdown(); }
  });

  it("escalates a changed workspace when a write-kind tool call was observed", async () => {
    const { source, manager, backend } = await prepared();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onEvent({ source: "acp", type: "tool_call", severity: "info", data: { toolCallId: "t1", kind: "edit", title: "Write file", status: "pending" } });
      await writeFile(join(source, "a.txt"), "changed\n");
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      const full = await manager.result({ run_id: runId, detail: "full" });
      expect(full.state).toBe("completed");
      expect(full.integrity).toMatchObject({ status: "changed", changed_paths: ["a.txt"], changed_paths_total: 1, write_tool_observed: true });
      expect(full.warnings).toContain(CHANGED_WITH_WRITE);
      expect(full.warnings).not.toContain(CHANGED_PLAIN);
      const events = await integrityEvents(manager, runId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ severity: "error", data: { status: "changed", write_tool_observed: true } });
    } finally { await manager.shutdown(); }
  });

  it("recognises write evidence from tool_call_update events and write_file titles", async () => {
    const { source, manager, backend } = await prepared();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onEvent({ source: "acp", type: "tool_call_update", severity: "info", data: { toolCallId: "t1", kind: "other", title: "write_file" } });
      await writeFile(join(source, "a.txt"), "changed\n");
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      const full = await manager.result({ run_id: runId, detail: "full" });
      expect(full.integrity).toMatchObject({ status: "changed", write_tool_observed: true });
      expect(full.warnings).toContain(CHANGED_WITH_WRITE);
    } finally { await manager.shutdown(); }
  });

  it("reports unverified when the workspace cannot be snapshotted", async () => {
    if (process.getuid?.() === 0) return;
    const { source, manager, backend } = await prepared();
    const locked = join(source, "locked");
    await mkdir(locked); await writeFile(join(locked, "secret.txt"), "secret\n"); await chmod(locked, 0o000);
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      const full = await manager.result({ run_id: runId, detail: "full" });
      expect(full.state).toBe("completed");
      expect(full.integrity).toMatchObject({ status: "unverified", write_tool_observed: false, reason: expect.any(String) });
      expect((full.integrity as Record<string, unknown>).changed_paths).toBeUndefined();
      expect(full.warnings).toContain(UNVERIFIED);
      const events = await integrityEvents(manager, runId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ severity: "warning", data: { status: "unverified" } });
      expect((await manager.result({ run_id: runId })).integrity).toMatchObject({ status: "unverified" });
    } finally { await chmod(locked, 0o700).catch(() => undefined); await manager.shutdown(); }
  });

  it("never starts the backend before the launch snapshot resolves", async () => {
    const backend = new FakeBackend();
    const { source, manager } = await prepared(backend);
    let sawLaunchDigest = false;
    backend.beforeReturn = async (input) => {
      const runtime = (manager as unknown as { runs: Map<string, { sourceSnapshot?: string; sourceManifest?: Map<string, unknown> }> }).runs.get(input.runId)!;
      sawLaunchDigest = Boolean(runtime.sourceSnapshot && runtime.sourceManifest?.has("a.txt"));
    };
    try {
      await runningReview(manager, source);
      expect(sawLaunchDigest).toBe(true);
    } finally { await manager.shutdown(); }
  });

  it("reports verified for an untouched workspace", async () => {
    const { source, manager, backend } = await prepared();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      const full = await manager.result({ run_id: runId, detail: "full" });
      expect(full.integrity).toEqual({ status: "verified", write_tool_observed: false });
      expect(full.warnings).toEqual([]);
      expect((await manager.result({ run_id: runId })).integrity).toEqual({ status: "verified", write_tool_observed: false });
      expect(await integrityEvents(manager, runId)).toEqual([]);
    } finally { await manager.shutdown(); }
  });

  it("keeps the failed state while still reporting integrity", async () => {
    const { source, manager, backend } = await prepared();
    try {
      const runId = await runningReview(manager, source);
      await writeFile(join(source, "a.txt"), "changed\n");
      await backend.callbacks?.onState("failed", { error: { code: "VSUP_BACKEND_ERROR", message: "boom", remediation: "retry", retryable: false } });
      const full = await manager.result({ run_id: runId, detail: "full" });
      expect(full.state).toBe("failed");
      expect(full.integrity).toMatchObject({ status: "changed", changed_paths: ["a.txt"] });
    } finally { await manager.shutdown(); }
  });

  it("caps changed_paths at 50 and keeps the total", async () => {
    const { source, manager, backend } = await prepared();
    try {
      const runId = await runningReview(manager, source);
      for (let index = 0; index < 60; index += 1) await writeFile(join(source, `n${String(index).padStart(2, "0")}.txt`), "x\n");
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      const integrity = (await manager.result({ run_id: runId, detail: "full" })).integrity as { changed_paths: string[]; changed_paths_total: number };
      expect(integrity.changed_paths).toHaveLength(50);
      expect(integrity.changed_paths_total).toBe(60);
    } finally { await manager.shutdown(); }
  });

  it("omits integrity for edit runs", async () => {
    const backend = new FakeBackend();
    const { source, manager } = await setupGit(backend);
    try {
      const started = await manager.editStart({ task: "edit", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      await backend.callbacks?.onState("completed", { result: { summary: "Done" } });
      expect((await manager.result({ run_id: started.run_id, detail: "full" })).integrity).toBeUndefined();
    } finally { await manager.shutdown(); }
  });
});

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const INTEGRITY = { status: "changed", changed_paths: ["a.txt"], changed_paths_total: 1, write_tool_observed: true, reason: "r" };

describe("result cap shaping", () => {
  function bigCompactEdit(): Record<string, unknown> {
    return {
      run_id: RUN_ID, state: "completed", backend: "programmatic",
      summary: "Done", warnings: ["careful"], integrity: INTEGRITY,
      worker: "/data/worktrees/run",
      changed_files: Array.from({ length: 50 }, (_, index) => `src/some/deeply/nested/module-${String(index).padStart(2, "0")}/file.ts`),
      changed_files_total: 50,
      diff_stat: "d".repeat(2000),
      patch: "p".repeat(3900),
      artifacts: [{ name: "diff.patch", path: "/data/runs/run/artifacts/diff.patch" }, { name: "diff.stat", path: "/data/runs/run/artifacts/diff.stat" }, { name: "transcript.md", path: "/data/runs/run/transcript.md" }],
    };
  }

  it("keeps the summary, warnings and integrity of a big compact edit result", () => {
    const original = bigCompactEdit();
    expect(JSON.stringify(original).length).toBeGreaterThan(8000);
    const out = bounded(original, 8000);
    expect(out.text.length).toBeLessThanOrEqual(8000);
    const parsed = out.structuredContent;
    expect(parsed).toMatchObject({ run_id: RUN_ID, state: "completed", summary: "Done", warnings: ["careful"], integrity: INTEGRITY, truncated: true });
    expect(parsed.patch).toBeUndefined();
    expect(parsed.patch_path).toBe("/data/runs/run/artifacts/diff.patch");
    expect(parsed.patch_bytes).toBe(3900);
    expect(parsed.truncated_fields).toContain("patch");
    expect(parsed.changed_files).toHaveLength(50);
  });

  it("keeps a shorter result untouched", () => {
    const out = bounded({ run_id: RUN_ID, state: "completed", summary: "ok" }, 8000);
    expect(out.structuredContent).toEqual({ run_id: RUN_ID, state: "completed", summary: "ok" });
  });

  it("reduces in order: transcript, diff_stat, then file and event lists, then the summary head and tail", () => {
    const value = {
      run_id: RUN_ID, state: "completed", warnings: ["w"], integrity: INTEGRITY, next_action: "n", patch_path: "/p", error: { code: "VSUP_BACKEND_ERROR", message: "m" },
      transcript: "t".repeat(6000), diff_stat: "d".repeat(2000),
      changed_files: Array.from({ length: 50 }, (_, index) => `f${index}.txt`), changed_files_total: 50,
      events: Array.from({ length: 40 }, (_, index) => ({ seq: index, type: "tool_call" })),
      summary: `HEADMARK${"m".repeat(9000)}TAILMARK`,
    };
    const out = bounded(value, 3000);
    const parsed = out.structuredContent as Record<string, unknown>;
    expect(out.text.length).toBeLessThanOrEqual(3000);
    expect(parsed).toMatchObject({ run_id: RUN_ID, state: "completed", warnings: ["w"], integrity: INTEGRITY, next_action: "n", patch_path: "/p", error: { code: "VSUP_BACKEND_ERROR" }, truncated: true });
    expect(parsed.summary).toEqual(expect.stringContaining("HEADMARK"));
    expect(parsed.summary).toEqual(expect.stringContaining("TAILMARK"));
    expect(parsed.summary).toEqual(expect.stringContaining("truncated"));
    expect(parsed.changed_files_total).toBe(50);
    expect(parsed.truncated_fields).toEqual(expect.arrayContaining(["transcript", "diff_stat", "changed_files", "summary"]));
  });

  it("shrinks a nested start result instead of collapsing to handles", async () => {
    const backend = new FakeBackend();
    const { source, manager } = await setup(backend);
    try {
      const summary = `START${"s".repeat(9000)}END`;
      const started = manager.reviewStart({ task: "review", cwd: source, wait_seconds: 30 });
      await waitFor(async () => backend.callbacks, (value) => value !== undefined);
      await backend.callbacks?.onState("completed", { result: { summary, warnings: ["note"] } });
      const result = await started;
      expect(JSON.stringify(result).length).toBeGreaterThan(8000);
      const out = bounded(result, 8000);
      expect(out.text.length).toBeLessThanOrEqual(8000);
      const parsed = out.structuredContent as { run_id: string; state: string; next_action: string; truncated: boolean; truncated_fields: string[]; result: { summary: string; warnings: string[]; integrity: unknown } };
      expect(parsed).toMatchObject({ run_id: result.run_id, state: "completed", truncated: true });
      expect(parsed.next_action).toEqual(expect.any(String));
      expect(parsed.result.summary).toEqual(expect.stringContaining("START"));
      expect(parsed.result.summary).toEqual(expect.stringContaining("END"));
      expect(parsed.result.warnings).toEqual(["note"]);
      expect(parsed.result.integrity).toMatchObject({ status: "verified" });
      expect(parsed.truncated_fields).toContain("result.summary");
    } finally { await manager.shutdown(); }
  });

  it("emergency fallback still carries error, warnings and integrity when they fit", () => {
    const value = {
      run_id: RUN_ID, state: "failed", error: { code: "VSUP_BACKEND_ERROR", message: "boom" }, warnings: ["w"], integrity: INTEGRITY,
      summary: "x".repeat(50_000), artifacts: Array.from({ length: 200 }, (_, index) => ({ name: `a${index}`, path: "/p".repeat(100) })),
    };
    const out = bounded(value, 600);
    expect(out.text.length).toBeLessThanOrEqual(600);
    expect(out.structuredContent).toMatchObject({ truncated: true, run_id: RUN_ID, state: "failed", error: { code: "VSUP_BACKEND_ERROR" }, warnings: ["w"], integrity: INTEGRITY });
  });

  it("compactResult gives a patch path when inlining would exceed the result cap", async () => {
    const backend = new FakeBackend();
    backend.beforeReturn = async (input) => { await writeFile(join(input.workerWorkspace, "mid.txt"), "y".repeat(3000) + "\n"); };
    const { source, manager } = await setupGit(backend);
    try {
      const started = await manager.editStart({ task: "edit", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      await backend.callbacks?.onState("completed", { result: { summary: "z".repeat(6000) } });
      const compact = await manager.result({ run_id: started.run_id });
      expect(compact.patch).toBeUndefined();
      expect(compact.patch_path).toEqual(expect.stringContaining("diff.patch"));
      expect(compact.patch_bytes).toBeGreaterThan(3000);
      expect(JSON.stringify(compact).length).toBeLessThanOrEqual(DEFAULT_CONFIG.limits.maxMcpResultChars);
    } finally { await manager.shutdown(); }
  });

  it("compactResult still inlines a patch that fits the cap", async () => {
    const backend = new FakeBackend();
    backend.beforeReturn = async (input) => { await writeFile(join(input.workerWorkspace, "mid.txt"), "y".repeat(3000) + "\n"); };
    const { source, manager } = await setupGit(backend);
    try {
      const started = await manager.editStart({ task: "edit", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      await backend.callbacks?.onState("completed", { result: { summary: "short" } });
      const compact = await manager.result({ run_id: started.run_id });
      expect(compact.patch).toContain("mid.txt");
      expect(compact.patch_path).toBeUndefined();
    } finally { await manager.shutdown(); }
  });
});

describe("detail=summary", () => {
  it("is no longer accepted by the schema or the run manager", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      expect(() => toolSchemas.vibe_result.parse({ run_id: runId, detail: "summary" })).toThrow();
      await expect(manager.result({ run_id: runId, detail: "summary" } as never)).rejects.toMatchObject({ code: "VSUP_INVALID_ARGUMENT" });
      expect((await manager.result({ run_id: runId, detail: "full" })).deprecation).toBeUndefined();
    } finally { await manager.shutdown(); }
  });
});

