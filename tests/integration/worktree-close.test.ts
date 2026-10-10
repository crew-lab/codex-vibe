import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  startEntered: string[] = [];
  beforeReturn: ((input: StartRunInput) => Promise<void>) | undefined;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    await this.beforeReturn?.(input);
    this.startEntered.push(input.runId);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: "running" };
  }
  async cancel(handle: BackendRunHandle) { this.cancelled.push(handle.runId); await this.callbacks.get(handle.runId)?.onState("cancelled"); }
  async close(handle: BackendRunHandle) { this.closed.push(handle.runId); }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function setup(options: { backend?: FakeBackend; git?: boolean } = {}) {
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
  const config = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] };
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
  it("records the exact detached worktree identity created for the run", async () => {
    const context = await setup();
    try {
      const started = await context.manager.editStart({ task: "edit", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      const meta = await readMeta(context.data, started.run_id);
      expect(meta.worktree).toMatchObject({ path: path.join(context.data, "worktrees", started.run_id), created_by_supervisor: true });
      expect(meta.worker_workspace).toBe(path.join(context.data, "worktrees", started.run_id));
      await context.backend.callbacks.get(started.run_id)?.onState("completed", { result: { summary: "done" } });
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


});

describe("close", () => {
  it("retains exported edits and reports the worktree path and reason", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await completedEdit(context);
      const closed = await context.manager.close({ run_id: runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ run_id: runId, state: "closed", worktree_removed: false, worktree_retained_path: worktree });
      expect(String(closed.worktree_retained_reason)).toMatch(/uncommitted or untracked files/i);
      expect(await exists(worktree)).toBe(true);
      expect(await registeredWorktrees(context.source)).toContain(worktree);
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

  it("continues to retain exported edits after ignored residue is removed", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await completedEdit(context, async (workspace) => { await writeFile(path.join(workspace, "ignored.log"), "residue\n"); });
      expect(await context.manager.close({ run_id: runId, cleanup_worktree: true })).toMatchObject({ state: "closed", worktree_removed: false });
      await rm(path.join(worktree, "ignored.log"));
      const retry = await context.manager.close({ run_id: runId, cleanup_worktree: true });
      expect(retry).toMatchObject({ state: "closed", worktree_removed: false, worktree_retained_path: worktree });
      expect(String(retry.worktree_retained_reason)).toMatch(/uncommitted or untracked files/i);
      expect(await exists(worktree)).toBe(true);
      expect(await context.manager.close({ run_id: runId })).toMatchObject({ state: "closed", worktree_removed: false });
    } finally { await context.manager.shutdown(); }
  });

  it("reports worktree_removed false without a reason when cleanup was not requested", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await completedEdit(context);
      const closed = await context.manager.close({ run_id: runId });
      expect(closed).toMatchObject({ state: "closed", worktree_removed: false });
      expect(closed).toMatchObject({ worktree_retained_path: worktree, worktree_retained_reason: expect.any(String) });
      expect(await exists(worktree)).toBe(true);
    } finally { await context.manager.shutdown(); }
  });

  it("retains an exported dirty worktree after restart using the saved patch artifact", async () => {
    const first = await setup();
    const { runId, worktree } = await completedEdit(first);
    await first.manager.shutdown();
    const second = new RunManager(first.config, first.data, [new FakeBackend()]);
    try {
      await second.initialize();
      expect(await stateOf(second, runId)).toBe("completed");
      const closed = await second.close({ run_id: runId, cleanup_worktree: true });
      expect(closed).toMatchObject({ state: "closed", worktree_removed: false, worktree_retained_path: worktree });
      expect(String(closed.worktree_retained_reason)).toMatch(/uncommitted or untracked files/i);
      expect(await exists(worktree)).toBe(true);
      expect(await registeredWorktrees(first.source)).toContain(worktree);
      expect((await readMeta(first.data, runId)).worktree).toBeDefined();
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

  it("close during delayed worktree creation waits and reports verified cleanup", async () => {
    const context = await setup();
    const bin = path.join(context.parent, "delayed-git-bin"); await mkdir(bin);
    const marker = path.join(context.parent, "worktree-add-entered");
    const gate = path.join(context.parent, "release-worktree-add");
    const gitPath = (await exec("which", ["git"])).stdout.trim();
    const wrapper = path.join(bin, "git");
    await writeFile(wrapper, `#!/bin/sh\ncase " $* " in\n  *" worktree add "*)\n    : > ${JSON.stringify(marker)}\n    while [ ! -e ${JSON.stringify(gate)} ]; do sleep 0.01; done\n    ;;\nesac\nexec ${JSON.stringify(gitPath)} "$@"\n`);
    await chmod(wrapper, 0o755);
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ""}`;
    try {
      const started = await context.manager.editStart({ task: "delayed edit", cwd: context.source });
      const worktree = path.join(context.data, "worktrees", started.run_id);
      await waitFor(() => exists(marker), Boolean);
      let closeFinished = false;
      const closing = context.manager.close({ run_id: started.run_id, cleanup_worktree: true }).then((result) => { closeFinished = true; return result; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(closeFinished).toBe(false);
      await writeFile(gate, "go");
      const result = await closing;
      expect(result).toMatchObject({ state: "closed", worktree_removed: true });
      expect(await exists(worktree)).toBe(false);
      expect(context.backend.startEntered).not.toContain(started.run_id);
      expect(await registeredWorktrees(context.source)).not.toContain(worktree);
    } finally { await writeFile(gate, "go").catch(() => undefined); await context.manager.shutdown(); }
  });

  it("keeps the owner lock through a short-deadline shutdown while Git creation is still pending", async () => {
    const context = await setup();
    const bin = path.join(context.parent, "delayed-shutdown-git-bin"); await mkdir(bin);
    const marker = path.join(context.parent, "shutdown-worktree-add-entered");
    const gate = path.join(context.parent, "release-shutdown-worktree-add");
    const gitPath = (await exec("which", ["git"])).stdout.trim();
    const wrapper = path.join(bin, "git");
    await writeFile(wrapper, `#!/bin/sh\ncase " $* " in\n  *" worktree add "*)\n    : > ${JSON.stringify(marker)}\n    while [ ! -e ${JSON.stringify(gate)} ]; do sleep 0.01; done\n    ;;\nesac\nexec ${JSON.stringify(gitPath)} "$@"\n`);
    await chmod(wrapper, 0o755);
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ""}`;
    try {
      const started = await context.manager.editStart({ task: "delayed shutdown edit", cwd: context.source });
      await waitFor(() => exists(marker), Boolean);
      const lockPath = path.join(context.data, "supervisor.lock");
      let finished = false;
      const shuttingDown = context.manager.shutdown(5).then((result) => { finished = true; return result; });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(finished).toBe(false);
      expect(await exists(lockPath)).toBe(true);
      await writeFile(gate, "go");
      expect(await shuttingDown).toEqual({ timedOut: true });
      expect(await exists(lockPath)).toBe(false);
      expect(await stateOf(context.manager, started.run_id)).toBe("failed");
      expect((await readMeta(context.data, started.run_id)).worktree).toMatchObject({ path: path.join(context.data, "worktrees", started.run_id) });
    } finally { await writeFile(gate, "go").catch(() => undefined); await context.manager.shutdown(); }
  });

  it("refuses cleanup and retention when one run is redirected to another valid owned worktree", async () => {
    const first = await setup();
    const a = await completedEdit(first);
    const b = await completedEdit(first);
    await first.manager.shutdown();
    const metaPath = path.join(runDir(first.data, a.runId), "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as { worker_workspace: string; worktree: { path: string } };
    meta.worktree.path = b.worktree;
    meta.worker_workspace = b.worktree;
    await writeFile(metaPath, JSON.stringify({ ...meta, updated_at: "2020-01-01T00:00:00.000Z" }));
    const bMetaPath = path.join(runDir(first.data, b.runId), "meta.json");
    await writeFile(bMetaPath, JSON.stringify({ ...JSON.parse(await readFile(bMetaPath, "utf8")), updated_at: "2020-01-01T00:00:00.000Z" }));
    const second = new RunManager(first.config, first.data, [new FakeBackend()]);
    try {
      await second.initialize();
      await second.cleanup();
      expect(await exists(a.worktree)).toBe(true);
      expect(await exists(b.worktree)).toBe(true);
      const result = await second.close({ run_id: a.runId, cleanup_worktree: true });
      expect(result).toMatchObject({ state: "closed", worktree_removed: false, worktree_retained_path: b.worktree });
      expect(String(result.worktree_retained_reason)).toMatch(/run-owned path/i);
      expect(await exists(path.join(a.worktree, "generated.txt"))).toBe(true);
      expect(await exists(path.join(b.worktree, "generated.txt"))).toBe(true);
      expect(await registeredWorktrees(first.source)).toContain(a.worktree);
      expect(await registeredWorktrees(first.source)).toContain(b.worktree);
      await second.cleanup();
      expect(await exists(a.worktree)).toBe(true);
      expect(await exists(b.worktree)).toBe(true);
      expect(await exists(path.join(first.source, "tracked.txt"))).toBe(true);
    } finally { await second.shutdown(); }
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
  it("marks a run interrupted in closing as failed without replay", async () => {
    const context = await setup({ git: false });
    const record = baseRecord(context.source, "closing", { result: { summary: "done", artifacts: [], changedFiles: [], warnings: [] } });
    await writeRecord(context.data, record);
    try {
      await context.manager.initialize();
      expect(await context.manager.status({ run_id: record.runId })).toMatchObject({ state: "failed", error: { code: "VSUP_BACKEND_CRASHED" } });
      expect((await context.manager.status({ run_id: record.runId })).error).toMatchObject({ code: "VSUP_BACKEND_CRASHED" });
      expect(await readMeta(context.data, record.runId)).toMatchObject({ state: "failed" });
      expect(activeSlots(context.manager)).toBe(0);
    } finally { await context.manager.shutdown(); }
  });

  it("retains run metadata when a saved worktree path is missing", async () => {
    const context = await setup({ git: false });
    const old = "2020-01-01T00:00:00.000Z";
    const gone = baseRecord(context.source, "cancelled", { mode: "edit", updatedAt: old, finishedAt: old, worktree: { path: path.join(context.data, "worktrees", "gone"), baseRef: "a".repeat(40), createdBySupervisor: true } });
    const kept = baseRecord(context.source, "cancelled", { mode: "edit", updatedAt: old, finishedAt: old, worktree: { path: context.source, baseRef: "a".repeat(40), createdBySupervisor: true } });
    await writeRecord(context.data, gone); await writeRecord(context.data, kept);
    try {
      await context.manager.initialize();
      const removed = (await context.manager.cleanup()).removed_run_ids as string[];
      expect(removed).toEqual([]);
      expect(await exists(runDir(context.data, gone.runId))).toBe(true);
      expect(await exists(runDir(context.data, kept.runId))).toBe(true);
    } finally { await context.manager.shutdown(); }
  });
});
