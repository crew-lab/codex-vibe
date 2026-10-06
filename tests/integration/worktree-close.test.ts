import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, appendFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, RunState, StartRunInput, SupervisorBackend } from "../../src/contracts.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { RunManager } from "../../src/core/run-manager.js";
import { runToWire } from "../../src/core/serialization.js";
import { createDetachedWorktree } from "../../src/git/worktree.js";

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const savedPath = process.env.PATH;

afterEach(async () => {
  if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
  readonly kind = "programmatic" as const;
  callbacks = new Map<string, BackendCallbacks>();
  cancelled: string[] = [];
  closed: string[] = [];
  continueError: Error | undefined;
  recovered: BackendRunHandle | undefined;
  recoverCalls = 0;
  continued: string[] = [];
  beforeReturn: ((input: StartRunInput) => Promise<void>) | undefined;
  closeGate: Promise<void> | undefined;
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    await this.beforeReturn?.(input);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: "running" };
  }
  async continue(_handle: BackendRunHandle, message: string) {
    if (this.continueError) throw this.continueError;
    this.continued.push(message);
  }
  async respond() {}
  async cancel(handle: BackendRunHandle) { this.cancelled.push(handle.runId); await this.callbacks.get(handle.runId)?.onState("cancelled"); }
  async close(handle: BackendRunHandle) { await this.closeGate; this.closed.push(handle.runId); }
  async recover(_record: RunRecord, _callbacks: BackendCallbacks) { this.recoverCalls += 1; return this.recovered; }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function setup(options: { backend?: FakeBackend; git?: boolean; maxConcurrentRuns?: number } = {}) {
  const backend = options.backend ?? new FakeBackend();
  const parent = await mkdtemp(path.join(canonicalTmp, "vsup-worktree-")); roots.push(parent);
  const source = path.join(parent, "source"); const data = path.join(parent, "data");
  await mkdir(source);
  if (options.git !== false) {
    await writeFile(path.join(source, "tracked.txt"), "original\n");
    await writeFile(path.join(source, ".gitignore"), "ignored.log\n");
    await exec("git", ["init", "-q"], { cwd: source });
    await exec("git", ["config", "user.email", "vsup@example.invalid"], { cwd: source });
    await exec("git", ["config", "user.name", "Vibe Supervisor Test"], { cwd: source });
    await exec("git", ["add", "tracked.txt", ".gitignore"], { cwd: source });
    await exec("git", ["commit", "-qm", "baseline"], { cwd: source });
  }
  const config = { ...DEFAULT_CONFIG, backend: "programmatic" as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600, maxConcurrentRuns: options.maxConcurrentRuns ?? 2 };
  const manager = new RunManager(config, data, [backend]);
  return { parent, source, data, backend, config, manager };
}

const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;
const stateOf = (manager: RunManager, runId: string) => manager.status({ run_id: runId }).then((value) => value.state as string);
const runDir = (data: string, runId: string) => path.join(data, "runs", runId);
const readMeta = async (data: string, runId: string) => JSON.parse(await readFile(path.join(runDir(data, runId), "meta.json"), "utf8")) as Record<string, unknown>;
const readResult = async (data: string, runId: string) => JSON.parse(await readFile(path.join(runDir(data, runId), "result.json"), "utf8")) as { state: string; warnings: string[]; artifacts: Array<{ name: string }> };
const exists = (file: string) => access(file).then(() => true, () => false);

async function readEvents(data: string, runId: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  return (await readFile(path.join(runDir(data, runId), "events.ndjson"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
}

async function registeredWorktrees(source: string): Promise<string[]> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: source });
  return stdout.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
}

async function completedEdit(context: Awaited<ReturnType<typeof setup>>, prepare?: (workspace: string) => Promise<void>) {
  context.backend.beforeReturn = async (input) => { await writeFile(path.join(input.workerWorkspace, "generated.txt"), "new output\n"); await prepare?.(input.workerWorkspace); };
  const started = await context.manager.editStart({ task: "edit", cwd: context.source });
  await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
  await context.backend.callbacks.get(started.run_id)?.onState("completed", { result: { summary: "done" } });
  await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "completed");
  return { runId: started.run_id, worktree: path.join(context.data, "worktrees", started.run_id) };
}

describe("worktree creation", () => {
  it("records the worktree only after git created it", async () => {
    const context = await setup({ maxConcurrentRuns: 1 });
    try {
      const blocker = await context.manager.reviewStart({ task: "blocker", cwd: context.source });
      await waitFor(() => stateOf(context.manager, blocker.run_id), (value) => value === "running");
      const queued = await context.manager.editStart({ task: "edit", cwd: context.source });
      expect(await stateOf(context.manager, queued.run_id)).toBe("queued");
      expect((await readMeta(context.data, queued.run_id)).worktree).toBeUndefined();
      await context.backend.callbacks.get(blocker.run_id)?.onState("completed", { result: { summary: "done" } });
      await waitFor(() => stateOf(context.manager, queued.run_id), (value) => value === "running");
      expect((await readMeta(context.data, queued.run_id)).worktree).toMatchObject({ path: path.join(context.data, "worktrees", queued.run_id), created_by_supervisor: true });
    } finally { await context.manager.shutdown(); }
  });

  it("fails a base_ref that does not exist with VSUP_WORKTREE_CREATE_FAILED, git's stderr, and no worktree record", async () => {
    const context = await setup();
    try {
      const started = await context.manager.editStart({ task: "edit", cwd: context.source, base_ref: "no-such-ref" });
      const status = await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === "failed");
      expect(status.state).toBe("failed");
      const error = status.error as { code: string; details?: { stderr_tail?: string } };
      expect(error.code).toBe("VSUP_WORKTREE_CREATE_FAILED");
      expect(error.details?.stderr_tail).toEqual(expect.stringContaining("fatal"));
      expect(error.details?.stderr_tail?.length).toBeLessThanOrEqual(1024);
      const meta = await waitFor(() => readMeta(context.data, started.run_id), (value) => value.state === "failed");
      expect(meta.worktree).toBeUndefined();
      expect(meta.error).toMatchObject({ code: "VSUP_WORKTREE_CREATE_FAILED" });
      expect((await readResult(context.data, started.run_id)).state).toBe("failed");
      expect(await exists(path.join(context.data, "worktrees", started.run_id))).toBe(false);
      expect(await waitFor(async () => activeSlots(context.manager), (value) => value === 0)).toBe(0);
    } finally { await context.manager.shutdown(); }
  });

  it("fails an edit run in a directory that is not a repository with VSUP_WORKTREE_CREATE_FAILED", async () => {
    const context = await setup({ git: false });
    try {
      const started = await context.manager.editStart({ task: "edit", cwd: context.source });
      const status = await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === "failed");
      expect((status.error as { code: string }).code).toBe("VSUP_WORKTREE_CREATE_FAILED");
    } finally { await context.manager.shutdown(); }
  });

  it("reports VSUP_GIT_REQUIRED only when the git binary is missing", async () => {
    const context = await setup();
    const empty = path.join(context.parent, "empty-path"); await mkdir(empty);
    process.env.PATH = empty;
    await expect(createDetachedWorktree(context.source, path.join(context.data, "worktrees", randomUUID()), "HEAD")).rejects.toMatchObject({ code: "VSUP_GIT_REQUIRED" });
    process.env.PATH = savedPath;
    await expect(createDetachedWorktree(context.source, path.join(context.data, "worktrees", randomUUID()), "no-such-ref")).rejects.toMatchObject({ code: "VSUP_WORKTREE_CREATE_FAILED", details: { stderr_tail: expect.stringContaining("fatal") } });
  });

  it("finalizes a queued edit run cancelled before launch with a clean result.json", async () => {
    const context = await setup({ maxConcurrentRuns: 1 });
    try {
      const blocker = await context.manager.reviewStart({ task: "blocker", cwd: context.source });
      await waitFor(() => stateOf(context.manager, blocker.run_id), (value) => value === "running");
      const queued = await context.manager.editStart({ task: "edit", cwd: context.source });
      expect(await stateOf(context.manager, queued.run_id)).toBe("queued");
      await context.manager.cancel({ run_id: queued.run_id });
      expect(await stateOf(context.manager, queued.run_id)).toBe("cancelled");
      const result = await readResult(context.data, queued.run_id);
      expect(result.state).toBe("cancelled");
      expect(result.warnings.some((warning) => warning.includes("could not be finalized"))).toBe(false);
      expect(result.artifacts.map((artifact) => artifact.name)).toEqual(expect.arrayContaining(["transcript.md", "events.ndjson"]));
      expect((await readEvents(context.data, queued.run_id)).some((event) => event.data.reason === "artifact_finalization_failed")).toBe(false);
      expect((await readMeta(context.data, queued.run_id)).worktree).toBeUndefined();
    } finally { await context.manager.shutdown(); }
  });
});

describe("close", () => {
  it("removes a verified worktree and reports worktree_removed", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await completedEdit(context);
      const closed = await context.manager.close({ run_id: runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ run_id: runId, state: "closed", worktree_removed: true });
      expect(closed.worktree_retained_reason).toBeUndefined();
      expect(await exists(worktree)).toBe(false);
      expect(await registeredWorktrees(context.source)).not.toContain(worktree);
    } finally { await context.manager.shutdown(); }
  });

  it("reaches closed and keeps the worktree when ignored files remain, saying why", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await completedEdit(context, async (workspace) => { await writeFile(path.join(workspace, "ignored.log"), "residue\n"); });
      const closed = await context.manager.close({ run_id: runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ run_id: runId, state: "closed", worktree_removed: false });
      expect(String(closed.worktree_retained_reason)).toMatch(/ignored/i);
      expect(await stateOf(context.manager, runId)).toBe("closed");
      expect(await exists(path.join(worktree, "ignored.log"))).toBe(true);
      expect(await registeredWorktrees(context.source)).toContain(worktree);
      const diagnostic = (await readEvents(context.data, runId)).find((event) => event.type === "diagnostic" && event.data.reason === "worktree_retained");
      expect(String(diagnostic?.data.message)).toMatch(/ignored/i);
      expect((await readMeta(context.data, runId)).worktree).toBeDefined();
      expect(activeSlots(context.manager)).toBe(0);
    } finally { await context.manager.shutdown(); }
  });

  it("removes a retained worktree when the closed run is closed again after the residue is gone", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await completedEdit(context, async (workspace) => { await writeFile(path.join(workspace, "ignored.log"), "residue\n"); });
      expect(await context.manager.close({ run_id: runId, cleanup_worktree: true })).toMatchObject({ state: "closed", worktree_removed: false });
      await rm(path.join(worktree, "ignored.log"));
      expect(await context.manager.close({ run_id: runId, cleanup_worktree: true })).toMatchObject({ state: "closed", worktree_removed: true });
      expect(await exists(worktree)).toBe(false);
      expect(await context.manager.close({ run_id: runId })).toMatchObject({ state: "closed", worktree_removed: false });
    } finally { await context.manager.shutdown(); }
  });

  it("reports worktree_removed false without a reason when cleanup was not requested", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await completedEdit(context);
      const closed = await context.manager.close({ run_id: runId });
      expect(closed).toMatchObject({ state: "closed", worktree_removed: false });
      expect(closed.worktree_retained_reason).toBeUndefined();
      expect(await exists(worktree)).toBe(true);
    } finally { await context.manager.shutdown(); }
  });

  it("removes the worktree after a restart using the saved patch artifact", async () => {
    const first = await setup();
    const { runId, worktree } = await completedEdit(first);
    await first.manager.shutdown();
    const second = new RunManager(first.config, first.data, [new FakeBackend()]);
    try {
      await second.initialize();
      expect(await stateOf(second, runId)).toBe("completed");
      const closed = await second.close({ run_id: runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ state: "closed", worktree_removed: true });
      expect(await exists(worktree)).toBe(false);
      expect(await registeredWorktrees(first.source)).not.toContain(worktree);
      expect((await readMeta(first.data, runId)).worktree).toBeUndefined();
    } finally { await second.shutdown(); }
  });

  it("still refuses after a restart when the saved patch was tampered with", async () => {
    const first = await setup();
    const { runId, worktree } = await completedEdit(first);
    await first.manager.shutdown();
    await appendFile(path.join(runDir(first.data, runId), "artifacts", "diff.patch"), "tampered\n");
    const second = new RunManager(first.config, first.data, [new FakeBackend()]);
    try {
      await second.initialize();
      const closed = await second.close({ run_id: runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ state: "closed", worktree_removed: false });
      expect(String(closed.worktree_retained_reason)).toMatch(/verification|retained/i);
      expect(await exists(path.join(worktree, "generated.txt"))).toBe(true);
      expect(await registeredWorktrees(first.source)).toContain(worktree);
    } finally { await second.shutdown(); }
  });

  it("refuses after a restart when the worktree changed since the export", async () => {
    const first = await setup();
    const { runId, worktree } = await completedEdit(first);
    await first.manager.shutdown();
    await writeFile(path.join(worktree, "late.txt"), "late\n");
    const second = new RunManager(first.config, first.data, [new FakeBackend()]);
    try {
      await second.initialize();
      const closed = await second.close({ run_id: runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ state: "closed", worktree_removed: false });
      expect(String(closed.worktree_retained_reason)).toMatch(/changed/i);
      expect(await exists(path.join(worktree, "late.txt"))).toBe(true);
    } finally { await second.shutdown(); }
  });

  it("does not let cancel touch a run that is already closing", async () => {
    const context = await setup();
    try {
      const { runId } = await completedEdit(context);
      let release!: () => void;
      context.backend.closeGate = new Promise<void>((resolve) => { release = resolve; });
      const closing = context.manager.close({ run_id: runId });
      await waitFor(() => stateOf(context.manager, runId), (value) => value === "closing");
      const resultFile = path.join(runDir(context.data, runId), "result.json");
      const before = await stat(resultFile);
      const cancelled = await context.manager.cancel({ run_id: runId });
      expect(cancelled.state).toBe("closing");
      expect(context.backend.cancelled).toEqual([]);
      expect((await stat(resultFile)).mtimeMs).toBe(before.mtimeMs);
      release();
      expect(await closing).toMatchObject({ state: "closed" });
    } finally { await context.manager.shutdown(); }
  });
});

function baseRecord(source: string, state: RunState, extra: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, runId: randomUUID(), backend: "programmatic", mode: "review", state, sourceWorkspace: source, workerWorkspace: source,
    createdAt: now, updatedAt: now, launchedAt: now, taskSha256: "a".repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_048_576, maxTranscriptBytes: 1_048_576, maxArtifactBytes: 8_388_608 },
    ...extra
  };
}

async function writeRecord(data: string, record: RunRecord): Promise<void> {
  const directory = runDir(data, record.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, "meta.json"), JSON.stringify(runToWire(record)), { mode: 0o600 });
}

describe("startup and retention", () => {
  it("turns a run found in closing into closed", async () => {
    const context = await setup({ git: false });
    const record = baseRecord(context.source, "closing", { result: { summary: "done", artifacts: [], changedFiles: [], warnings: [] } });
    await writeRecord(context.data, record);
    try {
      await context.manager.initialize();
      expect(await context.manager.status({ run_id: record.runId })).toMatchObject({ state: "closed" });
      expect((await context.manager.status({ run_id: record.runId })).error).toBeUndefined();
      expect(await readMeta(context.data, record.runId)).toMatchObject({ state: "closed" });
      expect(activeSlots(context.manager)).toBe(0);
    } finally { await context.manager.shutdown(); }
  });

  it("drops a worktree field whose path is gone and lets retention remove the run", async () => {
    const context = await setup({ git: false });
    const old = "2020-01-01T00:00:00.000Z";
    const gone = baseRecord(context.source, "cancelled", { mode: "edit", updatedAt: old, finishedAt: old, worktree: { path: path.join(context.data, "worktrees", "gone"), baseRef: "a".repeat(40), createdBySupervisor: true } });
    const kept = baseRecord(context.source, "cancelled", { mode: "edit", updatedAt: old, finishedAt: old, worktree: { path: context.source, baseRef: "a".repeat(40), createdBySupervisor: true } });
    await writeRecord(context.data, gone); await writeRecord(context.data, kept);
    try {
      await context.manager.initialize();
      const removed = (await context.manager.cleanup()).removed_run_ids as string[];
      expect(removed).toEqual([gone.runId]);
      expect(await exists(runDir(context.data, gone.runId))).toBe(false);
      expect(await exists(runDir(context.data, kept.runId))).toBe(true);
    } finally { await context.manager.shutdown(); }
  });
});

describe("continue", () => {
  it("settles a resumed run as recoverable and frees the slot when the backend rejects the message", async () => {
    const context = await setup({ git: false, maxConcurrentRuns: 1 });
    try {
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      await context.backend.callbacks.get(started.run_id)?.onState("completed", { result: { summary: "done" } });
      expect(await stateOf(context.manager, started.run_id)).toBe("completed");
      context.backend.continueError = new Error("session is gone");
      await expect(context.manager.continue({ run_id: started.run_id, message: "again" })).rejects.toThrow("session is gone");
      const status = await context.manager.status({ run_id: started.run_id });
      expect(status).toMatchObject({ state: "recoverable", error: { code: "VSUP_SESSION_NOT_RESUMABLE" } });
      expect(activeSlots(context.manager)).toBe(0);
      expect(context.backend.closed).toContain(started.run_id);
      expect(await readMeta(context.data, started.run_id)).toMatchObject({ state: "recoverable", error: { code: "VSUP_SESSION_NOT_RESUMABLE" } });
      const second = await context.manager.reviewStart({ task: "second", cwd: context.source });
      await waitFor(() => stateOf(context.manager, second.run_id), (value) => value === "running");

      await context.manager.cancel({ run_id: second.run_id });
      context.backend.continueError = undefined;
      context.backend.recovered = { runId: started.run_id, backend: "programmatic", opaque: {} };
      await expect(context.manager.continue({ run_id: started.run_id, message: "again" })).resolves.toMatchObject({ state: "running" });
      expect(context.backend.recoverCalls).toBe(1);
      expect(context.backend.continued).toEqual(["again"]);
    } finally { await context.manager.shutdown(); }
  });

  it("leaves a ready run ready when the backend rejects the message", async () => {
    const context = await setup({ git: false });
    try {
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      await context.backend.callbacks.get(started.run_id)?.onState("ready");
      expect(await stateOf(context.manager, started.run_id)).toBe("ready");
      context.backend.continueError = new Error("nope");
      await expect(context.manager.continue({ run_id: started.run_id, message: "again" })).rejects.toThrow("nope");
      expect(await stateOf(context.manager, started.run_id)).toBe("ready");
    } finally { await context.manager.shutdown(); }
  });
});
