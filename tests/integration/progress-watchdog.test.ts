import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chmodSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend, SupervisorConfig } from "../../src/contracts.js";
import { TEST_CONFIG } from '../unit/support/test-config.js';
import { validateConfig } from "../../src/config/validation.js";
import { RunManager } from "../../src/core/run-manager.js";
import { AppServerBackend } from "../../src/backends/app-server.js";
import { ResolvedCredential } from "../../src/backends/app-server/credentials.js";
import { PROFILE_TOOLS, TOOL_PERMISSION, workspaceDenylist } from "../../src/backends/app-server/session-config.js";

const fixture = path.resolve(import.meta.dirname, "..", "fixtures", "fake-vibe-app-server.mjs");

function fakeAppServerBackend(parent: string, source: string, scenario: Record<string, unknown>): AppServerBackend {
  const tools = Object.fromEntries(PROFILE_TOOLS.review.map((tool) => [tool, { permission: TOOL_PERMISSION, denylist: workspaceDenylist(source) }]));
  const scenarioFile = path.join(parent, "scenario.json");
  writeFileSync(scenarioFile, JSON.stringify({ ...scenario, effectiveConfig: { tools } }));
  const wrapper = path.join(parent, "vibe-app-server");
  writeFileSync(wrapper, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' --scenario '${scenarioFile}'\n`);
  chmodSync(wrapper, 0o755);
  return new AppServerBackend(TEST_CONFIG, {
    executable: wrapper,
    pin: { verify: async () => undefined },
    resolveCredential: async () => ({ status: "environment", detail: "", credential: new ResolvedCredential("watchdog-credential-abcdefghijklmnop") }),
    reaper: { pollMs: 50, graceMs: 200 },
    timing: { interruptGraceMs: 300, stdinGraceMs: 300, terminateGraceMs: 300, interruptTimeoutMs: 500, statsThrottleMs: 0 }
  });
}

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class ScriptedBackend implements SupervisorBackend {
  readonly kind = "app-server" as const;
  callbacks = new Map<string, BackendCallbacks>();
  cancelled: string[] = [];
  closed: string[] = [];
  cancelDelayMs = 0;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks.set(input.runId, callbacks);
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: "running" };
  }
  async cancel(handle: BackendRunHandle) { this.cancelled.push(handle.runId); if (this.cancelDelayMs) await new Promise((resolve) => setTimeout(resolve, this.cancelDelayMs)); await this.callbacks.get(handle.runId)?.onState("cancelled"); }
  async close(handle: BackendRunHandle) { this.closed.push(handle.runId); }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const activeSlots = (manager: RunManager) => (manager as unknown as { activeSlots: number }).activeSlots;
const stateOf = (manager: RunManager, runId: string) => manager.status({ run_id: runId }).then((value) => value.state as string);
const runtimeOf = (manager: RunManager, runId: string) => (manager as unknown as { runs: Map<string, { progressTimer?: unknown; serial: Promise<unknown> }> }).runs.get(runId)!;
const exists = (file: string) => access(file).then(() => true, () => false);

async function setup(progressSeconds: number, options: { git?: boolean; backend?: (data: string, source: string) => SupervisorBackend; config?: Partial<SupervisorConfig> } = {}) {
  const parent = await mkdtemp(path.join(canonicalTmp, "vsup-progress-")); roots.push(parent);
  const source = path.join(parent, "source"); const data = path.join(parent, "data");
  await mkdir(source);
  if (options.git) {
    await writeFile(path.join(source, "tracked.txt"), "original\n");
    await exec("git", ["init", "-q"], { cwd: source });
    await exec("git", ["config", "user.email", "vsup@example.invalid"], { cwd: source });
    await exec("git", ["config", "user.name", "Vibe Supervisor Test"], { cwd: source });
    await exec("git", ["add", "tracked.txt"], { cwd: source });
    await exec("git", ["commit", "-qm", "baseline"], { cwd: source });
  }
  const backend = options.backend?.(data, source) ?? new ScriptedBackend();
  const config: SupervisorConfig = { ...TEST_CONFIG, allowedWorkspaceRoots: [source], limits: { ...TEST_CONFIG.limits, workerProgressTimeoutSeconds: progressSeconds }, ...options.config };
  const manager = new RunManager(config, data, [backend]);
  return { parent, source, data, backend, manager };
}

async function readEvents(data: string, runId: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  return (await readFile(path.join(data, "runs", runId, "events.ndjson"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
}


describe("worker progress watchdog", () => {
  it("fails a silent run with VSUP_NO_PROGRESS, names the silence, cancels the worker and frees the slot", async () => {
    const context = await setup(1);
    try {
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      const status = await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === "failed");
      expect(status.state).toBe("failed");
      expect(status.error).toMatchObject({ code: "VSUP_NO_PROGRESS", message: expect.stringContaining("1 seconds"), retryable: false });
      expect(context.backend instanceof ScriptedBackend && context.backend.cancelled).toEqual([started.run_id]);
      expect(await waitFor(async () => activeSlots(context.manager), (value) => value === 0)).toBe(0);
      const events = await readEvents(context.data, started.run_id);
      expect(events.find((event) => event.data.reason === "no_progress")?.data).toMatchObject({ silence_seconds: 1 });
    } finally { await context.manager.shutdown(); }
  });

  it("resets on every vibe event and lets a run that keeps talking complete", async () => {
    const context = await setup(2);
    try {
      const backend = context.backend as ScriptedBackend;
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      const callbacks = backend.callbacks.get(started.run_id)!;
      for (let index = 0; index < 4; index += 1) { await sleep(1000); await callbacks.onEvent({ source: "vibe", type: "message", severity: "info", data: { text: `tick ${index}\n` } }); }
      expect(await stateOf(context.manager, started.run_id)).toBe("running");
      await callbacks.onState("completed", { result: { summary: "done" } });
      expect(await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "completed")).toBe("completed");
      await sleep(2300);
      expect(await stateOf(context.manager, started.run_id)).toBe("completed");
      expect(backend.cancelled).toEqual([]);
    } finally { await context.manager.shutdown(); }
  });

  it("does not count supervisor diagnostics as worker output", async () => {
    const context = await setup(1);
    try {
      const backend = context.backend as ScriptedBackend;
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      const callbacks = backend.callbacks.get(started.run_id)!;
      const chatter = setInterval(() => { void callbacks.onEvent({ source: "supervisor", type: "diagnostic", severity: "warning", data: { text: "stderr" } }); }, 200);
      try {
        const status = await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === "failed");
        expect(status.error).toMatchObject({ code: "VSUP_NO_PROGRESS" });
      } finally { clearInterval(chatter); }
    } finally { await context.manager.shutdown(); }
  });

  it("is disabled by 0: no timer is armed, while a sibling with a tiny window trips", async () => {
    const context = await setup(0);
    try {
      const backend = context.backend as ScriptedBackend;
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      expect(runtimeOf(context.manager, started.run_id).progressTimer).toBeUndefined();
      await backend.callbacks.get(started.run_id)!.onEvent({ source: "vibe", type: "message", severity: "info", data: { text: "hello\n" } });
      await backend.callbacks.get(started.run_id)!.onActivity?.("stdout");
      expect(runtimeOf(context.manager, started.run_id).progressTimer).toBeUndefined();
      await sleep(1500);
      expect(await stateOf(context.manager, started.run_id)).toBe("running");
    } finally { await context.manager.shutdown(); }
    const sibling = await setup(1);
    try {
      const started = await sibling.manager.reviewStart({ task: "review", cwd: sibling.source });
      await waitFor(() => stateOf(sibling.manager, started.run_id), (value) => value === "running");
      expect(runtimeOf(sibling.manager, started.run_id).progressTimer).toBeDefined();
      const status = await waitFor(() => sibling.manager.status({ run_id: started.run_id }), (value) => value.state === "failed");
      expect(status.error).toMatchObject({ code: "VSUP_NO_PROGRESS" });
    } finally { await sibling.manager.shutdown(); }
  });

  it("exports and keeps the worktree of a silent edit run like a timeout does", async () => {
    const context = await setup(1, { git: true });
    try {
      const backend = context.backend as ScriptedBackend;
      const started = await context.manager.editStart({ task: "edit", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      const worktree = path.join(context.data, "worktrees", started.run_id);
      await writeFile(path.join(worktree, "generated.txt"), "partial work\n");
      const status = await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === "failed");
      expect(status.error).toMatchObject({ code: "VSUP_NO_PROGRESS" });
      expect(backend.cancelled).toEqual([started.run_id]);
      const result = JSON.parse(await readFile(path.join(context.data, "runs", started.run_id, "result.json"), "utf8")) as { state: string; artifacts: Array<{ name: string }> };
      expect(result.state).toBe("failed");
      expect(result.artifacts.map((artifact) => artifact.name)).toEqual(expect.arrayContaining(["diff.patch"]));
      expect(await exists(path.join(worktree, "generated.txt"))).toBe(true);
    } finally { await context.manager.shutdown(); }
  });

});

describe("worker activity and settle races", () => {
  it("counts app-server frames that carry no assistant text as activity so a slow but busy run completes", async () => {
    const scenario = {
      name: "slow-busy",
      steps: [
        { op: "delay", ms: 900 }, { op: "stats", stats: { modelCalls: 1, sessionPromptTokens: 10, sessionCompletionTokens: 1 } },
        { op: "delay", ms: 900 }, { op: "stats", stats: { modelCalls: 2, sessionPromptTokens: 20, sessionCompletionTokens: 2 } },
        { op: "delay", ms: 900 }, { op: "stats", stats: { modelCalls: 3, sessionPromptTokens: 30, sessionCompletionTokens: 3 } },
        { op: "say", text: "done", stream: true }
      ]
    };
    const context = await setup(2, { backend: (_data, source) => fakeAppServerBackend(path.dirname(source), source, scenario) });
    try {
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      const status = await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === "completed" || value.state === "failed", 20_000);
      expect(status.state).toBe("completed");
    } finally { await context.manager.shutdown(); }
  });

  it("records the last activity kind and the silence in the no_progress diagnostic", async () => {
    const context = await setup(1);
    try {
      const backend = context.backend as ScriptedBackend;
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      await backend.callbacks.get(started.run_id)!.onActivity?.("stdout");
      await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === "failed");
      const events = await readEvents(context.data, started.run_id);
      expect(events.find((event) => event.data.reason === "no_progress")?.data).toMatchObject({ last_activity_kind: "stdout", silence_seconds: 1 });
    } finally { await context.manager.shutdown(); }
    const silent = await setup(1);
    try {
      const started = await silent.manager.reviewStart({ task: "review", cwd: silent.source });
      await waitFor(() => silent.manager.status({ run_id: started.run_id }), (value) => value.state === "failed");
      const events = await readEvents(silent.data, started.run_id);
      expect(events.find((event) => event.data.reason === "no_progress")?.data).toMatchObject({ last_activity_kind: "none" });
    } finally { await silent.manager.shutdown(); }
  });

  it("does not add a no_progress diagnostic to a run being cancelled", async () => {
    const context = await setup(1);
    try {
      const backend = context.backend as ScriptedBackend;
      backend.cancelDelayMs = 2000;
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      await context.manager.cancel({ run_id: started.run_id });
      await sleep(300);
      const status = await context.manager.status({ run_id: started.run_id });
      expect(status.state).toBe("cancelled");
      expect((await readEvents(context.data, started.run_id)).some((event) => event.data.reason === "no_progress")).toBe(false);
    } finally { await context.manager.shutdown(); }
  });

  it("does not add a no_progress diagnostic to a run whose deadline fired", async () => {
    const context = await setup(1);
    try {
      const backend = context.backend as ScriptedBackend;
      backend.cancelDelayMs = 2000;
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      const runtime = runtimeOf(context.manager, started.run_id);
      await (context.manager as unknown as { deadline(runtime: unknown): Promise<void> }).deadline(runtime);
      const status = await context.manager.status({ run_id: started.run_id });
      expect(status.error).toMatchObject({ code: "VSUP_TIMEOUT" });
      expect((await readEvents(context.data, started.run_id)).some((event) => event.data.reason === "no_progress")).toBe(false);
    } finally { await context.manager.shutdown(); }
  });

  it("does not cancel a completed run whose settling outlasts the window", async () => {
    const context = await setup(1);
    try {
      const backend = context.backend as ScriptedBackend;
      const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
      await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
      const runtime = runtimeOf(context.manager, started.run_id);
      runtime.serial = runtime.serial.then(() => sleep(1800));
      const done = backend.callbacks.get(started.run_id)!.onState("completed", { result: { summary: "done" } });
      await done;
      expect(await stateOf(context.manager, started.run_id)).toBe("completed");
      expect(backend.cancelled).toEqual([]);
    } finally { await context.manager.shutdown(); }
  });

  it("fails an interrupted one-shot run when shutdown outlasts the watchdog window", async () => {
    const context = await setup(1);
    const backend = context.backend as ScriptedBackend;
    const started = await context.manager.reviewStart({ task: "review", cwd: context.source });
    await waitFor(() => stateOf(context.manager, started.run_id), (value) => value === "running");
    const runtime = runtimeOf(context.manager, started.run_id);
    runtime.serial = runtime.serial.then(() => sleep(1800));
    await context.manager.shutdown();
    const meta = JSON.parse(await readFile(path.join(context.data, "runs", started.run_id, "meta.json"), "utf8")) as { state: string };
    expect(meta.state).toBe("failed");
    expect((await readEvents(context.data, started.run_id)).some((event) => event.data.reason === "no_progress")).toBe(false);
    expect(backend.callbacks.has(started.run_id)).toBe(true);
  });
});

describe("worker_progress_timeout_seconds config", () => {
  const parse = (value: unknown) => validateConfig({ version: 1, paths: { vibe_pin_manifest: "/unused/manifest.json" }, limits: { worker_progress_timeout_seconds: value } });
  it("defaults to 600 and accepts 0 and 60 to 7200", () => {
    expect(validateConfig({ version: 1, paths: { vibe_pin_manifest: "/unused/manifest.json" } }).limits.workerProgressTimeoutSeconds).toBe(600);
    for (const value of [0, 60, 7200]) expect(parse(value).limits.workerProgressTimeoutSeconds).toBe(value);
  });
  it("rejects values between 1 and 59, above 7200, negatives and non-integers", () => {
    for (const value of [1, 59, 7201, -1, 90.5, "600"]) expect(() => parse(value)).toThrow();
  });
});
