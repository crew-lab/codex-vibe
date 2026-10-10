import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from "../../src/contracts.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { supervisorError } from "../../src/contracts.js";
import { APP_VERSION } from "../../src/version.js";
import { RunManager } from "../../src/core/run-manager.js";

const roots: string[] = [];
const canonicalTmp = await realpath(tmpdir());
const exec = promisify(execFile);
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

class FakeBackend implements SupervisorBackend {
  readonly kind = "programmatic" as const;
  handle: BackendRunHandle | undefined;
  callbacks: BackendCallbacks | undefined;
  cancelCalls = 0;
  starts = 0;
  gate: Promise<void> | undefined;
  releaseStart: (() => void) | undefined;
  beforeReturn: ((input: StartRunInput) => Promise<void>) | undefined;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.starts += 1;
    this.callbacks = callbacks;
    this.handle = { runId: input.runId, backend: this.kind, opaque: {} };
    if (this.gate) await this.gate;
    await this.beforeReturn?.(input);
    return { handle: this.handle, initialState: "running" };
  }
  async cancel() { this.cancelCalls += 1; }
  async close() {}
}

async function setup(backend = new FakeBackend()) {
  const parent = await mkdtemp(join(canonicalTmp, "vsup-core-")); roots.push(parent);
  const source = join(parent, "source"); const data = join(parent, "data");
  await mkdir(source);
  const config = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] };
  const manager = new RunManager(config, data, [backend]);
  return { parent, source, data, manager, backend };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for run-manager state");
}

describe("RunManager core lifecycle", () => {
  it("starts asynchronously, persists events and finalizes a completed result", async () => {
    const { source, manager, backend } = await setup();
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      expect(started.state).toBe("starting");
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      await backend.callbacks?.onEvent({ source: "vibe", type: "agent_message", severity: "info", data: { text: "Done." } });
      await backend.callbacks?.onState("completed", { result: { summary: "Finished" } });
      const status = await manager.status({ run_id: started.run_id });
      expect(status.state).toBe("completed");
      const result = await manager.result({ run_id: started.run_id });
      expect(result.summary).toBe("Finished");
      expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: "transcript.md", path: expect.any(String) })]));
    } finally { await manager.shutdown(); }
  });

  it("persists the creator version through results, close and restart", async () => {
    const { source, data, manager, backend } = await setup();
    const started = await manager.reviewStart({ task: "review", cwd: source });
    try {
      expect(started.supervisor_version).toBe(APP_VERSION);
      await waitFor(() => manager.status({ run_id: started.run_id }), value => value.state === "running");
      expect((await manager.result({ run_id: started.run_id })).supervisor_version).toBe(APP_VERSION);
      await backend.callbacks?.onState("completed", { result: { summary: "Done", stopReason: "end_turn" } });
      expect((await manager.result({ run_id: started.run_id, detail: "full" })).supervisor_version).toBe(APP_VERSION);
      expect((await manager.close({ run_id: started.run_id })).supervisor_version).toBe(APP_VERSION);
    } finally { await manager.shutdown(); }
    const metaPath = join(data, "runs", started.run_id, "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    expect(meta.supervisor_version).toBe(APP_VERSION);
    // A later supervisor must not overwrite the recorded creator release.
    meta.supervisor_version = "0.9.0-rc.4";
    await writeFile(metaPath, JSON.stringify(meta), { mode: 0o600 });
    const restarted = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [new FakeBackend()]);
    try {
      await restarted.initialize();
      expect((await restarted.status({ run_id: started.run_id })).supervisor_version).toBe("0.9.0-rc.4");
      expect((await restarted.result({ run_id: started.run_id, detail: "full" })).supervisor_version).toBe("0.9.0-rc.4");
    } finally { await restarted.shutdown(); }
  });

  it("refuses a competing live owner and releases its lock on shutdown", async () => {
    const { data, manager } = await setup();
    const other = new RunManager({ ...DEFAULT_CONFIG }, data, [new FakeBackend()]);
    try {
      await manager.initialize();
      await expect(other.initialize()).rejects.toMatchObject({ code: "VSUP_INVALID_STATE" });
      await manager.shutdown();
      await other.initialize();
    } finally { await manager.shutdown(); await other.shutdown(); }
  });

  it("waits for in-flight initialization writes before releasing the owner lock", async () => {
    const { data, manager } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const marker = join(data, "initialization-finished");
    const internal = manager as unknown as { initializeInternal(): Promise<void> };
    const original = internal.initializeInternal.bind(manager);
    vi.spyOn(internal, "initializeInternal").mockImplementation(async () => {
      await original();
      await gate;
      await writeFile(marker, "settled\n", { mode: 0o600 });
    });
    const initializing = manager.initialize();
    try {
      await waitFor(async () => access(join(data, "supervisor.lock")).then(() => true, () => false), Boolean);
      const shuttingDown = manager.shutdown(5);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(await access(join(data, "supervisor.lock")).then(() => true, () => false)).toBe(true);
      expect(await access(marker).then(() => true, () => false)).toBe(false);
      release();
      await initializing;
      expect(await shuttingDown).toEqual({ timedOut: true });
      expect(await readFile(marker, "utf8")).toBe("settled\n");
      await expect(access(join(data, "supervisor.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { release(); await manager.shutdown(); }
  });

  it("rejects an allow_shell input because the field no longer exists", async () => {
    const { source, manager } = await setup();
    try {
      await expect(manager.editStart({ task: "edit", cwd: source, allow_shell: true } as never)).rejects.toMatchObject({ code: "VSUP_INVALID_ARGUMENT" });
      await expect(manager.editStart({ task: "edit", cwd: source, allow_shell: false } as never)).rejects.toMatchObject({ code: "VSUP_INVALID_ARGUMENT" });
    } finally { await manager.shutdown(); }
  });

  it("cancels and releases the one active worker", async () => {
    const backend = new FakeBackend();
    const { source, manager } = await setup(backend);
    try {
      const started = await manager.reviewStart({ task: "cancel me", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      await expect(manager.cancel({ run_id: started.run_id })).resolves.toMatchObject({ state: "cancelled" });
      expect(backend.cancelCalls).toBe(1);
    } finally { await manager.shutdown(); }
  });

  it("recovers completed history without replaying its task", async () => {
    const { source, data, manager, backend } = await setup();
    let runId = "";
    try {
      const started = await manager.reviewStart({ task: "persist me", cwd: source }); runId = started.run_id;
      await waitFor(() => manager.status({ run_id: runId }), (value) => value.state === "running");
      await backend.callbacks?.onEvent({ source: "vibe", type: "agent_message", severity: "info", data: { text: "Saved transcript." } });
      await backend.callbacks?.onState("completed", { result: { summary: "Saved result" } });
      await manager.shutdown();
    } finally { await manager.shutdown(); }
    const restartedBackend = new FakeBackend();
    const restarted = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [restartedBackend]);
    try {
      await restarted.initialize();
      expect(restartedBackend.starts).toBe(0);
      expect(await restarted.status({ run_id: runId })).toMatchObject({ state: "completed" });
      expect(await restarted.result({ run_id: runId, include_transcript: true })).toMatchObject({ summary: "Saved result", transcript: "Saved transcript.\n" });
    } finally { await restarted.shutdown(); }
  });

  it("exports an edit worktree patch and retains dirty output after close", async () => {
    const backend = new FakeBackend();
    const { source, data } = await setup(backend);
    await writeFile(join(source, "tracked.txt"), "original\n");
    await exec("git", ["init", "-q"], { cwd: source });
    await exec("git", ["config", "user.email", "vsup@example.invalid"], { cwd: source });
    await exec("git", ["config", "user.name", "Vibe Supervisor Test"], { cwd: source });
    await exec("git", ["add", "tracked.txt"], { cwd: source });
    await exec("git", ["commit", "-qm", "baseline"], { cwd: source });
    backend.beforeReturn = async (input) => { await writeFile(join(input.workerWorkspace, "generated.txt"), "new output\n"); };
    const manager = new RunManager({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.editStart({ task: "edit", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      await backend.callbacks?.onState("completed", { result: { summary: "Generated" } });
      const result = await manager.result({ run_id: started.run_id });
      expect(result.changed_files).toContain("generated.txt");
      expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: "diff.patch" })]));
      const worker = join(data, "worktrees", started.run_id);
      expect(await readFile(join(source, "tracked.txt"), "utf8")).toBe("original\n");
      const closed = await manager.close({ run_id: started.run_id, cleanup_worktree: true });
      expect(closed).toMatchObject({ worktree_removed: false, worktree_retained_path: worker });
      expect(String(closed.worktree_retained_reason)).toMatch(/uncommitted or untracked files/i);
      await expect(access(worker)).resolves.toBeUndefined();
    } finally { await manager.shutdown(); }
  });
});

describe("RunManager worker death after the supervisor deadline", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("reports a worker that dies once the run deadline has passed as a timeout", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { source, manager, backend } = await setup();
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      vi.setSystemTime(Date.now() + (DEFAULT_CONFIG.limits.reviewTimeoutSeconds + 1) * 1000);
      await backend.callbacks?.onState("failed", { error: supervisorError("VSUP_BACKEND_CRASHED", "Vibe ACP exited null") });
      const status = await manager.status({ run_id: started.run_id });
      expect(status.state).toBe("failed");
      expect(status.error?.code).toBe("VSUP_TIMEOUT");
    } finally { await manager.shutdown(); }
  });

  it("keeps reporting a crash before the deadline as a crash", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { source, manager, backend } = await setup();
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      vi.setSystemTime(Date.now() + 60_000);
      await backend.callbacks?.onState("failed", { error: supervisorError("VSUP_BACKEND_CRASHED", "Vibe ACP exited null") });
      expect((await manager.status({ run_id: started.run_id })).error?.code).toBe("VSUP_BACKEND_CRASHED");
    } finally { await manager.shutdown(); }
  });
});
