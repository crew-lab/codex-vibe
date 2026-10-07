import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, PendingRequest, RunRecord, StartRunInput, SupervisorBackend } from "../../src/contracts.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { RunManager } from "../../src/core/run-manager.js";

const roots: string[] = [];
const canonicalTmp = await realpath(tmpdir());
const exec = promisify(execFile);
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

class FakeBackend implements SupervisorBackend {
  readonly kind = "programmatic" as const;
  handle: BackendRunHandle | undefined;
  callbacks: BackendCallbacks | undefined;
  responded: string[] = [];
  nextPending: PendingRequest | undefined;
  cancelCalls = 0;
  starts = 0;
  gate: Promise<void> | undefined;
  releaseStart: (() => void) | undefined;
  cancelCompletesRun = false;
  beforeReturn: ((input: StartRunInput) => Promise<void>) | undefined;
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.starts += 1;
    this.callbacks = callbacks;
    this.handle = { runId: input.runId, backend: this.kind, opaque: {} };
    if (this.nextPending) await callbacks.onPendingRequest(this.nextPending);
    if (this.gate) await this.gate;
    await this.beforeReturn?.(input);
    return { handle: this.handle, initialState: "running" };
  }
  async continue() {}
  async respond(_handle: BackendRunHandle, response: { optionId?: string }) { if (response.optionId) this.responded.push(response.optionId); }
  async cancel() { this.cancelCalls += 1; if (this.cancelCompletesRun) await this.callbacks?.onState("cancelled"); }
  async close() {}
  async recover(_record: RunRecord) { return this.handle; }
}

async function setup(backend = new FakeBackend()) {
  const parent = await mkdtemp(join(canonicalTmp, "vsup-core-")); roots.push(parent);
  const source = join(parent, "source"); const data = join(parent, "data");
  await mkdir(source);
  const config = { ...DEFAULT_CONFIG, backend: "programmatic" as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 0 };
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

  it("prompts only with scoped permission metadata and accepts an offered safe choice", async () => {
    const { source, manager, backend } = await setup();
    backend.nextPending = { requestId: "req-1", kind: "permission", title: "Read file", options: [{ optionId: "allow", name: "Allow once" }, { optionId: "deny", name: "Deny" }], tool: { kind: "read", locations: [source] } };
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      const status = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "waiting_permission");
      expect(status.pending_request).toMatchObject({ request_id: "req-1", tool: { kind: "read", locations: [source] } });
      await manager.respond({ run_id: started.run_id, request_id: "req-1", kind: "permission", option_id: "allow" });
      expect(backend.responded).toContain("allow");
    } finally { await manager.shutdown(); }
  });

  it("refuses a competing live owner and releases its lock on shutdown", async () => {
    const { data, manager } = await setup();
    const other = new RunManager({ ...DEFAULT_CONFIG, backend: "programmatic" }, data, [new FakeBackend()]);
    try {
      await manager.initialize();
      await expect(other.initialize()).rejects.toMatchObject({ code: "VSUP_INVALID_STATE" });
      await manager.shutdown();
      await other.initialize();
    } finally { await manager.shutdown(); await other.shutdown(); }
  });

  it("rejects an allow_shell input because the field no longer exists", async () => {
    const { source, manager } = await setup();
    try {
      await expect(manager.editStart({ task: "edit", cwd: source, allow_shell: true } as never)).rejects.toMatchObject({ code: "VSUP_INVALID_ARGUMENT" });
      await expect(manager.editStart({ task: "edit", cwd: source, allow_shell: false } as never)).rejects.toMatchObject({ code: "VSUP_INVALID_ARGUMENT" });
      await expect(manager.reviewStart({ task: "review", cwd: source, backend: "acp" } as never)).rejects.toMatchObject({ code: "VSUP_INVALID_ARGUMENT" });
    } finally { await manager.shutdown(); }
  });

  it("enforces active and queued limits, then drains queued work", async () => {
    const { source, data, backend } = await setup();
    backend.gate = new Promise<void>((resolve) => { backend.releaseStart = resolve; });
    const config = { ...DEFAULT_CONFIG, backend: "programmatic" as const, allowedWorkspaceRoots: [source], maxConcurrentRuns: 1, maxQueuedRuns: 1 };
    const manager = new RunManager(config, data, [backend]);
    try {
      const first = await manager.reviewStart({ task: "first", cwd: source });
      const second = await manager.reviewStart({ task: "second", cwd: source });
      expect(second.state).toBe("queued");
      await expect(manager.reviewStart({ task: "overflow", cwd: source })).rejects.toMatchObject({ code: "VSUP_LIMIT_EXCEEDED" });
      backend.releaseStart?.();
      await waitFor(() => manager.status({ run_id: first.run_id }), (value) => value.state === "running");
      await backend.callbacks?.onState("completed");
      await waitFor(() => manager.status({ run_id: second.run_id }), (value) => value.state === "running");
      expect(backend.starts).toBe(2);
    } finally { backend.releaseStart?.(); await manager.shutdown(); }
  });

  it("cancels without deadlocking when backend cancellation awaits its state callback", async () => {
    const backend = new FakeBackend(); backend.cancelCompletesRun = true;
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
    const restarted = new RunManager({ ...DEFAULT_CONFIG, backend: "programmatic", allowedWorkspaceRoots: [source] }, data, [restartedBackend]);
    try {
      await restarted.initialize();
      expect(restartedBackend.starts).toBe(0);
      expect(await restarted.status({ run_id: runId })).toMatchObject({ state: "completed" });
      expect(await restarted.result({ run_id: runId, include_transcript: true })).toMatchObject({ summary: "Saved result", transcript: "Saved transcript.\n" });
    } finally { await restarted.shutdown(); }
  });

  it("exports an edit worktree patch and removes only the verified worktree", async () => {
    const backend = new FakeBackend();
    const { source, data } = await setup(backend);
    await writeFile(join(source, "tracked.txt"), "original\n");
    await exec("git", ["init", "-q"], { cwd: source });
    await exec("git", ["config", "user.email", "vsup@example.invalid"], { cwd: source });
    await exec("git", ["config", "user.name", "Vibe Supervisor Test"], { cwd: source });
    await exec("git", ["add", "tracked.txt"], { cwd: source });
    await exec("git", ["commit", "-qm", "baseline"], { cwd: source });
    backend.beforeReturn = async (input) => { await writeFile(join(input.workerWorkspace, "generated.txt"), "new output\n"); };
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: "programmatic", allowedWorkspaceRoots: [source] }, data, [backend]);
    try {
      const started = await manager.editStart({ task: "edit", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      await backend.callbacks?.onState("completed", { result: { summary: "Generated" } });
      const result = await manager.result({ run_id: started.run_id });
      expect(result.changed_files).toContain("generated.txt");
      expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: "diff.patch" })]));
      const worker = join(data, "worktrees", started.run_id);
      expect(await readFile(join(source, "tracked.txt"), "utf8")).toBe("original\n");
      await manager.close({ run_id: started.run_id, cleanup_worktree: true });
      await expect(access(worker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await manager.shutdown(); }
  });
});
