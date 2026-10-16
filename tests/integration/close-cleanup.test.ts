import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, RunState, StartRunInput, SupervisorBackend } from "../../src/contracts.js";
import { TEST_CONFIG } from '../unit/support/test-config.js';
import { RunManager } from "../../src/core/run-manager.js";
import { runToWire } from "../../src/core/serialization.js";
import { acceptanceContractSchema, contractDigest } from "../../src/acceptance/schema.js";
import { exportReport } from "../../src/reporting/export.js";
import { createDetachedWorktree } from "../../src/git/worktree.js";

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class CloseBackend implements SupervisorBackend {
  readonly kind = "app-server" as const;
  callbacks = new Map<string, BackendCallbacks>();
  announceRunning = false;
  closeGate: Promise<void> | undefined;
  closeFailure: "none" | "throws" | "rejects" = "none";
  closes = 0;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    if (this.announceRunning) await callbacks.onState("running");
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: "running" };
  }
  async cancel(handle: BackendRunHandle) { await this.callbacks.get(handle.runId)?.onState("cancelled"); }
  close(_handle: BackendRunHandle): Promise<void> {
    this.closes += 1;
    if (this.closeFailure === "throws") throw new Error("backend close exploded");
    if (this.closeFailure === "rejects") return Promise.reject(new Error("backend close exploded"));
    return (async () => { await this.closeGate; })();
  }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function setup(backend = new CloseBackend(), names = { source: "source", data: "data" }) {
  const parent = await mkdtemp(path.join(canonicalTmp, "vsup-close-")); roots.push(parent);
  const source = path.join(parent, names.source); const data = path.join(parent, names.data);
  await mkdir(source);
  await writeFile(path.join(source, "tracked.txt"), "original\n");
  await exec("git", ["init", "-q"], { cwd: source });
  await exec("git", ["config", "user.email", "vsup@example.invalid"], { cwd: source });
  await exec("git", ["config", "user.name", "Vibe Supervisor Test"], { cwd: source });
  await exec("git", ["add", "tracked.txt"], { cwd: source });
  await exec("git", ["commit", "-qm", "baseline"], { cwd: source });
  const config = { ...TEST_CONFIG, allowedWorkspaceRoots: [source] };
  return { parent, source, data, backend, config, manager: new RunManager(config, data, [backend]) };
}

const stateOf = (manager: RunManager, runId: string) => manager.status({ run_id: runId }).then((value) => value.state as string);
const exists = (file: string) => access(file).then(() => true, () => false);
const runDir = (data: string, runId: string) => path.join(data, "runs", runId);

async function runningEdit(context: Awaited<ReturnType<typeof setup>>) {
  const started = await context.manager.editStart({ task: "edit", cwd: context.source });
  await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
  const worktree = path.join(context.data, "worktrees", started.run_id);
  await writeFile(path.join(worktree, "generated.txt"), "new output\n");
  return { runId: started.run_id, worktree };
}

describe("runs cleanup <id> only touches a run that is finished", () => {
  it("fails an interrupted run without replay and retains its dirty worktree", async () => {
    const first = await setup();
    const { runId, worktree } = await runningEdit(first);
    await first.manager.shutdown();
    const second = new RunManager(first.config, first.data, [new CloseBackend()]);
    try {
      await second.initialize();
      expect(await stateOf(second, runId)).toBe("failed");
      const cleaned = await second.cleanup(runId);
      expect(cleaned).toMatchObject({ run_id: runId, worktree_removed: false });
      expect(String(cleaned.worktree_retained_reason)).toMatch(/uncommitted or untracked files/i);
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

  it("retains exported dirty worktrees for cancelled and closed runs", async () => {
    const context = await setup();
    try {
      const cancelled = await runningEdit(context);
      await context.manager.cancel({ run_id: cancelled.runId });
      expect(await context.manager.cleanup(cancelled.runId)).toMatchObject({ run_id: cancelled.runId, worktree_removed: false, worktree_retained_reason: expect.stringMatching(/uncommitted or untracked files/i) });
      expect(await exists(cancelled.worktree)).toBe(true);
      const closed = await runningEdit(context);
      await context.manager.close({ run_id: closed.runId });
      expect(await exists(closed.worktree)).toBe(true);
      expect(await context.manager.cleanup(closed.runId)).toMatchObject({ run_id: closed.runId, worktree_removed: false, worktree_retained_reason: expect.stringMatching(/uncommitted or untracked files/i) });
      expect(await exists(closed.worktree)).toBe(true);
      const listing = await context.manager.cleanup() as { retained_worktrees?: Array<{ run_id: string; path: string; manual_command: string }> };
      expect(listing.retained_worktrees?.map((entry) => entry.run_id).sort()).toEqual([cancelled.runId, closed.runId].sort());
      const entry = listing.retained_worktrees!.find((item) => item.run_id === closed.runId)!;
      expect(entry.path).toBe(path.resolve(closed.worktree));
      expect(entry.manual_command).toBe(`git -C '${context.source}' worktree remove '${path.resolve(closed.worktree)}'`);
    } finally { await context.manager.shutdown(); }
  });

  it("prints a manual cleanup command that a shell passes to git literally", async () => {
    const hostile = "x $(touch subst) `touch tick` $HOME it's";
    const context = await setup(new CloseBackend(), { source: `source ${hostile}`, data: `data ${hostile}` });
    try {
      const run = await runningEdit(context);
      await context.manager.cancel({ run_id: run.runId });
      const listing = await context.manager.cleanup() as { retained_worktrees?: Array<{ run_id: string; manual_command: string }> };
      const command = listing.retained_worktrees!.find((item) => item.run_id === run.runId)!.manual_command;
      const bin = path.join(context.parent, "record-bin"); await mkdir(bin);
      const recorded = path.join(context.parent, "recorded-args");
      await writeFile(path.join(bin, "git"), `#!/bin/sh\nprintf '%s\\0' "$@" > '${recorded}'\n`, { mode: 0o755 });
      await exec("/bin/sh", ["-c", command], { cwd: context.parent, env: { PATH: bin, HOME: "/expanded-home" } });
      expect((await readFile(recorded, "utf8")).split("\0").filter(Boolean)).toEqual(["-C", context.source, "worktree", "remove", path.resolve(run.worktree)]);
      expect(await exists(path.join(context.parent, "subst"))).toBe(false);
      expect(await exists(path.join(context.parent, "tick"))).toBe(false);
    } finally { await context.manager.shutdown(); }
  });
});

function startingEditRecord(source: string, worktree: { path: string; baseRef: string }): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, runId: randomUUID(), backend: "app-server", mode: "edit", state: "starting" as RunState, sourceWorkspace: source, workerWorkspace: worktree.path,
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
      expect(await stateOf(context.manager, record.runId)).toBe("failed");
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
  it("serializes concurrent close requests around worker cancellation and retains dirty output", async () => {
    const context = await setup();
    try {
      const { runId, worktree } = await runningEdit(context);
      let release!: () => void;
      context.backend.closeGate = new Promise<void>((resolve) => { release = resolve; });
      const first = context.manager.close({ run_id: runId, cleanup_worktree: true });
      await waitFor(async () => context.backend.closes, (value) => value === 1);
      const second = context.manager.close({ run_id: runId, cleanup_worktree: true });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await exists(worktree)).toBe(true);
      expect((context.manager as unknown as { activeSlots: number }).activeSlots).toBe(1);
      await expect(context.manager.reviewStart({ task: "must not overlap", cwd: context.source })).rejects.toMatchObject({ code: "VSUP_LIMIT_EXCEEDED" });
      release();
      expect(await first).toMatchObject({ state: "closed", worktree_removed: false });
      expect(await second).toMatchObject({ state: "closed", worktree_removed: false });
      expect(await exists(worktree)).toBe(true);
      expect(context.backend.closes).toBe(1);
      expect((context.manager as unknown as { activeSlots: number }).activeSlots).toBe(0);
    } finally { await context.manager.shutdown(); }
  });

  it.each(["throws", "rejects"] as const)("retains the worker and slot when backend close %s, then closes after a safe retry", async (failure) => {
    const context = await setup();
    try {
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      context.backend.closeFailure = failure;
      await context.backend.callbacks.get(started.run_id)?.onState("completed", { result: { summary: "done" } });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "failed");
      expect((context.manager as unknown as { activeSlots: number }).activeSlots).toBe(1);
      const unverified = await context.manager.close({ run_id: started.run_id, cleanup_worktree: true });
      expect(unverified).toMatchObject({ run_id: started.run_id, state: "failed", worktree_removed: false, worker_termination_unverified: true, error: { code: "VSUP_BACKEND_ERROR" } });
      expect((context.manager as unknown as { activeSlots: number }).activeSlots).toBe(1);
      await expect(context.manager.reviewStart({ task: "must not overlap", cwd: context.source })).rejects.toMatchObject({ code: "VSUP_LIMIT_EXCEEDED" });
      expect(JSON.parse(await readFile(path.join(runDir(context.data, started.run_id), "meta.json"), "utf8"))).toMatchObject({ state: "failed" });

      context.backend.closeFailure = "none";
      const closed = await context.manager.close({ run_id: started.run_id });
      expect(closed).toMatchObject({ run_id: started.run_id, state: "closed", worktree_removed: false });
      expect((context.manager as unknown as { activeSlots: number }).activeSlots).toBe(0);
      expect(context.backend.closes).toBe(3);
    } finally { await context.manager.shutdown(); }
  });
});


describe("frozen patch assessment", () => {
  it("accepts actual disclosure despite a misleading summary and appends a correction after closure", async () => {
    const context = await setup();
    try {
      const contract = acceptanceContractSchema.parse({ schema_version: 1, allowed_changed_paths: ["tracked.txt"], checks: [{ id: "disclosure", kind: "text_contains", path: "tracked.txt", value: "Developing BMS practice." }], required_validations: ["build"] });
      const started = await context.manager.editStart({ task: "edit", cwd: context.source, acceptance_contract: contract });
      await waitFor(() => stateOf(context.manager, started.run_id), value => value === "running");
      await writeFile(path.join(context.data, "worktrees", started.run_id, "tracked.txt"), "Developing BMS practice.\n");
      await context.backend.callbacks.get(started.run_id)?.onState("completed", { result: { summary: "Disclosure omitted", stopReason: "end_turn" } });
      await waitFor(() => stateOf(context.manager, started.run_id), value => value === "completed");
      const result = await context.manager.result({ run_id: started.run_id });
      expect(result.verification).toMatchObject({ status: "passed" });
      const meta = JSON.parse(await readFile(path.join(runDir(context.data, started.run_id), "meta.json"), "utf8"));
      const patchHash = meta.result.artifacts.find((a: {name: string}) => a.name === "diff.patch").sha256;
      const binding = { patch_sha256: patchHash, contract_sha256: contractDigest(contract), reason: "Independent inspection" };
      await expect(context.manager.close({ run_id: started.run_id, assessment: { ...binding, decision: "accepted", validations: [] } })).rejects.toThrow(/required coordinator validations/);
      await context.manager.close({ run_id: started.run_id, assessment: { ...binding, decision: "rejected", validations: [] } });
      await context.manager.close({ run_id: started.run_id, assessment: { ...binding, decision: "accepted", validations: [{ id: "build", status: "passed" }] } });
      const exported = path.join(context.parent, "report");
      await exportReport({ directory: runDir(context.data, started.run_id), output: exported });
      const report = JSON.parse(await readFile(path.join(exported, "report.json"), "utf8"));
      expect(report.assessment).toBe("accepted");
      expect(report.assessments).toHaveLength(2);
      expect(JSON.stringify(report)).not.toContain(context.source);
      await expect(exportReport({ directory: runDir(context.data, started.run_id), output: exported })).rejects.toThrow(/already exists/);
    } finally { await context.manager.shutdown(); }
  });
});

describe("run report execution lifecycle", () => {
  it.each(["completed", "failed", "cancelled"] as const)("preserves a %s review outcome and observed start time after close", async (outcome) => {
    const backend = new CloseBackend();
    backend.announceRunning = true;
    const context = await setup(backend);
    try {
      const started = await context.manager.reviewStart({ task: "review lifecycle", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (state) => state === "running");
      const callbacks = backend.callbacks.get(started.run_id)!;
      const directory = runDir(context.data, started.run_id);
      const metaPath = path.join(directory, "meta.json");
      const firstRunning = await waitFor(
        () => readFile(metaPath, "utf8").then((text) => JSON.parse(text) as { started_at?: string }),
        (meta) => typeof meta.started_at === "string"
      );
      expect(firstRunning.started_at).toBeTruthy();
      await callbacks.onState("running", { modelObservations: [] });
      const repeatedRunning = JSON.parse(await readFile(metaPath, "utf8")) as { started_at?: string };
      expect(repeatedRunning.started_at).toBe(firstRunning.started_at);
      if (outcome === "completed") {
        await callbacks.onEvent({ source: "supervisor", type: "diagnostic", severity: "info", data: {
          reason: "reasoning_observation", streamed_entries: 0, history_entries: null, history_audited: false, detail: "discard"
        } });
        await callbacks.onEvent({ source: "supervisor", type: "diagnostic", severity: "info", data: {
          reason: "reasoning_observation", streamed_entries: -1, history_entries: 1.5, history_audited: "false", detail: "arbitrary diagnostic text"
        } });
        await callbacks.onEvent({ source: "supervisor", type: "diagnostic", severity: "info", data: {
          reason: "reasoning_observation", streamed_entries: "0", history_entries: "2", history_audited: true, detail: "also arbitrary"
        } });
        await callbacks.onState("completed", { result: { summary: "review complete", stopReason: "end_turn" } });
      } else if (outcome === "failed") {
        await callbacks.onState("failed", { error: { code: "VSUP_BACKEND_ERROR", message: "Review failed.", remediation: "Inspect backend diagnostics and retry if the problem is transient.", retryable: true } });
      } else {
        await context.manager.cancel({ run_id: started.run_id });
      }
      await waitFor(() => stateOf(context.manager, started.run_id), (state) => state === outcome);
      const settled = await waitFor(
        () => readFile(metaPath, "utf8").then((text) => JSON.parse(text) as { execution_state?: string; started_at?: string; finished_at?: string }),
        (meta) => meta.execution_state === outcome
      );
      expect(settled.started_at).toBe(firstRunning.started_at);
      await context.manager.close({ run_id: started.run_id });
      const closed = JSON.parse(await readFile(path.join(directory, "meta.json"), "utf8")) as { execution_state?: string; started_at?: string; finished_at?: string };
      expect(closed).toMatchObject({ execution_state: outcome, started_at: settled.started_at, finished_at: settled.finished_at });
      const output = path.join(context.parent, `report-${outcome}`);
      await exportReport({ directory, output, include: outcome === "completed" ? ["events"] : [] });
      const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8")) as { execution: { state: string }; timestamps: { started: string | null } };
      expect(report.execution.state).toBe(outcome);
      expect(report.timestamps.started).toBe(settled.started_at);
      if (outcome === "completed") {
        const events = JSON.parse(await readFile(path.join(output, "events.json"), "utf8")) as Array<Record<string, unknown>>;
        expect(events).toContainEqual(expect.objectContaining({
          reason: "reasoning_observation", streamed_entries: 0, history_entries: null, history_audited: false
        }));
        const invalidNumericFields = events.find((event) => event.seq === 2)!;
        expect(invalidNumericFields.reason).toBe("reasoning_observation");
        expect(invalidNumericFields).not.toHaveProperty("streamed_entries");
        expect(invalidNumericFields).not.toHaveProperty("history_entries");
        expect(invalidNumericFields).not.toHaveProperty("history_audited");
        const stringNumericFields = events.find((event) => event.seq === 3)!;
        expect(stringNumericFields.reason).toBe("reasoning_observation");
        expect(stringNumericFields).not.toHaveProperty("streamed_entries");
        expect(stringNumericFields).not.toHaveProperty("history_entries");
        expect(JSON.stringify(events)).not.toContain("discard");
        expect(JSON.stringify(events)).not.toContain("arbitrary");
      }
    } finally { await context.manager.shutdown(); }
  });

  it("keeps legacy closed records without an execution outcome unknown", async () => {
    const context = await setup();
    try {
      await context.manager.initialize();
      const runId = randomUUID();
      const now = new Date().toISOString();
      const legacy: RunRecord = {
        schemaVersion: 1, runId, backend: "app-server", mode: "review", state: "closed",
        sourceWorkspace: context.source, workerWorkspace: context.source, createdAt: now, updatedAt: now,
        finishedAt: now, taskSha256: "a".repeat(64),
        limits: { timeoutSeconds: 240, maxTurns: 12, maxEventBytes: 1024 * 1024, maxTranscriptBytes: 1024 * 1024, maxArtifactBytes: 1024 * 1024 }
      };
      const directory = runDir(context.data, runId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, "meta.json"), JSON.stringify(runToWire(legacy)), { mode: 0o600 });
      const output = path.join(context.parent, "legacy-report");
      await exportReport({ directory, output });
      const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8")) as { execution: { state: string }; timestamps: { started: string | null } };
      expect(report.execution.state).toBe("unknown");
      expect(report.timestamps.started).toBeNull();
    } finally { await context.manager.shutdown(); }
  });
});
