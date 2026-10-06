import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class CloseBackend implements SupervisorBackend {
  readonly kind = "programmatic" as const;
  callbacks = new Map<string, BackendCallbacks>();
  closeGate: Promise<void> | undefined;
  closeFailure: "none" | "throws" | "rejects" = "none";
  closes = 0;
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: "running" };
  }
  async continue() {}
  async respond() {}
  async cancel(handle: BackendRunHandle) { await this.callbacks.get(handle.runId)?.onState("cancelled"); }
  close(_handle: BackendRunHandle): Promise<void> {
    this.closes += 1;
    if (this.closeFailure === "throws") throw new Error("backend close exploded");
    if (this.closeFailure === "rejects") return Promise.reject(new Error("backend close exploded"));
    return (async () => { await this.closeGate; })();
  }
  async recover(_record: RunRecord) { return undefined; }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function setup(backend = new CloseBackend()) {
  const parent = await mkdtemp(path.join(canonicalTmp, "vsup-close-")); roots.push(parent);
  const source = path.join(parent, "source"); const data = path.join(parent, "data");
  await mkdir(source);
  await writeFile(path.join(source, "tracked.txt"), "original\n");
  await exec("git", ["init", "-q"], { cwd: source });
  await exec("git", ["config", "user.email", "vsup@example.invalid"], { cwd: source });
  await exec("git", ["config", "user.name", "Vibe Supervisor Test"], { cwd: source });
  await exec("git", ["add", "tracked.txt"], { cwd: source });
  await exec("git", ["commit", "-qm", "baseline"], { cwd: source });
  const config = { ...DEFAULT_CONFIG, backend: "programmatic" as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600 };
  return { parent, source, data, backend, config, manager: new RunManager(config, data, [backend]) };
}

const stateOf = (manager: RunManager, runId: string) => manager.status({ run_id: runId }).then((value) => value.state as string);
const exists = (file: string) => access(file).then(() => true, () => false);
const runDir = (data: string, runId: string) => path.join(data, "runs", runId);
const readEvents = async (data: string, runId: string) => (await readFile(path.join(runDir(data, runId), "events.ndjson"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });

async function runningEdit(context: Awaited<ReturnType<typeof setup>>) {
  const started = await context.manager.editStart({ task: "edit", cwd: context.source });
  await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
  const worktree = path.join(context.data, "worktrees", started.run_id);
  await writeFile(path.join(worktree, "generated.txt"), "new output\n");
  return { runId: started.run_id, worktree };
}

describe("runs cleanup <id> only touches a run that is finished", () => {
  it("keeps the worktree of a recoverable edit run after a restart", async () => {
    const first = await setup();
    const { runId, worktree } = await runningEdit(first);
    await first.manager.shutdown();
    const second = new RunManager(first.config, first.data, [new CloseBackend()]);
    try {
      await second.initialize();
      expect(await stateOf(second, runId)).toBe("recoverable");
      const cleaned = await second.cleanup(runId);
      expect(cleaned).toMatchObject({ run_id: runId, worktree_removed: false });
      expect(String(cleaned.worktree_retained_reason)).toMatch(/recoverable/);
      expect(await exists(path.join(worktree, "generated.txt"))).toBe(true);
    } finally { await second.shutdown(); }
  });

  it("keeps the worktree of a completed run", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await runningEdit(context);
      await context.backend.callbacks.get(runId)?.onState("completed", { result: { summary: "done" } });
      await waitFor(() => stateOf(context.manager, runId), (value) => value === "completed");
      expect(await context.manager.cleanup(runId)).toMatchObject({ worktree_removed: false, worktree_retained_reason: expect.stringMatching(/completed/) });
      expect(await exists(worktree)).toBe(true);
    } finally { await context.manager.shutdown(); }
  });

  it("removes the verified worktree of a cancelled run and of a closed run", async () => {
    const context = await setup();
    try {
      const cancelled = await runningEdit(context);
      await context.manager.cancel({ run_id: cancelled.runId });
      expect(await context.manager.cleanup(cancelled.runId)).toMatchObject({ run_id: cancelled.runId, worktree_removed: true });
      expect(await exists(cancelled.worktree)).toBe(false);
      const closed = await runningEdit(context);
      await context.manager.close({ run_id: closed.runId });
      expect(await exists(closed.worktree)).toBe(true);
      expect(await context.manager.cleanup(closed.runId)).toMatchObject({ run_id: closed.runId, worktree_removed: true });
      expect(await exists(closed.worktree)).toBe(false);
    } finally { await context.manager.shutdown(); }
  });
});

function startingEditRecord(source: string, worktree: { path: string; baseRef: string }): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, runId: randomUUID(), backend: "programmatic", mode: "edit", state: "starting" as RunState, sourceWorkspace: source, workerWorkspace: worktree.path,
    createdAt: now, updatedAt: now, launchedAt: now, taskSha256: "a".repeat(64),
    limits: { timeoutSeconds: 600, maxTurns: 5, maxEventBytes: 1_048_576, maxTranscriptBytes: 1_048_576, maxArtifactBytes: 8_388_608 },
    worktree: { path: worktree.path, baseRef: worktree.baseRef, createdBySupervisor: true }
  };
}

describe("a worktree created before the supervisor died", () => {
  it("is exported and then removed by close with cleanup_worktree", async () => {
    const context = await setup();
    const record = startingEditRecord(context.source, { path: path.join(context.data, "worktrees", "pending"), baseRef: "HEAD" });
    const worktreePath = path.join(context.data, "worktrees", record.runId);
    const created = await createDetachedWorktree(context.source, worktreePath, "HEAD");
    record.worktree = { path: created.path, baseRef: created.baseRef, createdBySupervisor: true }; record.workerWorkspace = created.path;
    const directory = runDir(context.data, record.runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, "meta.json"), JSON.stringify(runToWire(record)), { mode: 0o600 });
    try {
      await context.manager.initialize();
      expect(await stateOf(context.manager, record.runId)).toBe("cancelled");
      expect(await exists(path.join(directory, "artifacts", "diff.patch"))).toBe(false);
      const closed = await context.manager.close({ run_id: record.runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ state: "closed", worktree_removed: true });
      expect(closed.worktree_retained_reason).toBeUndefined();
      expect(await exists(worktreePath)).toBe(false);
      expect(await exists(path.join(directory, "artifacts", "diff.patch"))).toBe(true);
      expect(JSON.parse(await readFile(path.join(directory, "meta.json"), "utf8")).worktree).toBeUndefined();
    } finally { await context.manager.shutdown(); }
  });

  it("still keeps a worktree that holds ignored files, exporting the patch first", async () => {
    const context = await setup();
    await writeFile(path.join(context.source, ".gitignore"), "ignored.log\n");
    await exec("git", ["add", ".gitignore"], { cwd: context.source });
    await exec("git", ["commit", "-qm", "ignore"], { cwd: context.source });
    const record = startingEditRecord(context.source, { path: "", baseRef: "HEAD" });
    const worktreePath = path.join(context.data, "worktrees", record.runId);
    const created = await createDetachedWorktree(context.source, worktreePath, "HEAD");
    await writeFile(path.join(created.path, "ignored.log"), "residue\n");
    record.worktree = { path: created.path, baseRef: created.baseRef, createdBySupervisor: true }; record.workerWorkspace = created.path;
    const directory = runDir(context.data, record.runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, "meta.json"), JSON.stringify(runToWire(record)), { mode: 0o600 });
    try {
      await context.manager.initialize();
      const closed = await context.manager.close({ run_id: record.runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ state: "closed", worktree_removed: false });
      expect(String(closed.worktree_retained_reason)).toMatch(/ignored/i);
      expect(await exists(path.join(created.path, "ignored.log"))).toBe(true);
    } finally { await context.manager.shutdown(); }
  });
});

describe("close under concurrency and failure", () => {
  it("makes a second concurrent close wait for the first and then report the real outcome, retrying removal", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await runningEdit(context);
      await context.backend.callbacks.get(runId)?.onState("completed", { result: { summary: "done" } });
      await waitFor(() => stateOf(context.manager, runId), (value) => value === "completed");
      let release!: () => void;
      context.backend.closeGate = new Promise<void>((resolve) => { release = resolve; });
      const first = context.manager.close({ run_id: runId });
      await waitFor(() => stateOf(context.manager, runId), (value) => value === "closing");
      const second = context.manager.close({ run_id: runId, cleanup_worktree: true });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await exists(worktree)).toBe(true);
      release();
      expect(await first).toMatchObject({ state: "closed", worktree_removed: false });
      expect(await second).toMatchObject({ state: "closed", worktree_removed: true });
      expect(await exists(worktree)).toBe(false);
      expect(context.backend.closes).toBe(1);
    } finally { await context.manager.shutdown(); }
  });

  it.each(["throws", "rejects"] as const)("reaches closed and reports the error when the backend close %s", async (failure) => {
    const context = await setup();
    try {
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      await context.backend.callbacks.get(started.run_id)?.onState("completed", { result: { summary: "done" } });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "completed");
      context.backend.closeFailure = failure;
      const closed = await context.manager.close({ run_id: started.run_id });
      expect(closed).toMatchObject({ run_id: started.run_id, state: "closed", worktree_removed: false, error: { code: "VSUP_BACKEND_ERROR" } });
      expect(await stateOf(context.manager, started.run_id)).toBe("closed");
      expect((await readEvents(context.data, started.run_id)).some((event) => event.type === "diagnostic" && event.data.reason === "close_failed" && String(event.data.message).includes("backend close exploded"))).toBe(true);
      expect(JSON.parse(await readFile(path.join(runDir(context.data, started.run_id), "meta.json"), "utf8"))).toMatchObject({ state: "closed" });
      expect(await context.manager.close({ run_id: started.run_id })).toMatchObject({ state: "closed" });
      expect((context.manager as unknown as { activeSlots: number }).activeSlots).toBe(0);
    } finally { await context.manager.shutdown(); }
  });
});
