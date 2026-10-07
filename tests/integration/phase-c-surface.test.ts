import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendKind, BackendRunHandle, BackendStartResult, PendingRequest, RunRecord, StartRunInput, SupervisorBackend, SupervisorConfig } from "../../src/contracts.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { loadConfig } from "../../src/config/config.js";
import { RunManager } from "../../src/core/run-manager.js";

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

class FakeBackend implements SupervisorBackend {
  handle: BackendRunHandle | undefined;
  callbacks: BackendCallbacks | undefined;
  inputs: StartRunInput[] = [];
  responded: string[] = [];
  continued: string[] = [];
  cancelCalls = 0;
  nextPending: PendingRequest | undefined;
  constructor(readonly kind: BackendKind = "programmatic") {}
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.inputs.push(input);
    this.callbacks = callbacks;
    this.handle = { runId: input.runId, backend: this.kind, opaque: {} };
    if (this.nextPending) await callbacks.onPendingRequest(this.nextPending);
    return { handle: this.handle, initialState: "running" };
  }
  async continue(_handle: BackendRunHandle, message: string) { this.continued.push(message); }
  async respond(_handle: BackendRunHandle, response: { optionId?: string }) { if (response.optionId) this.responded.push(response.optionId); }
  async cancel() { this.cancelCalls += 1; }
  async close() {}
  async recover(_record: RunRecord) { return this.handle; }
}

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 3000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 10)); value = await read(); }
  return value;
}

async function setup(options: { backend?: BackendKind; config?: Partial<SupervisorConfig>; git?: boolean } = {}) {
  const parent = await mkdtemp(join(canonicalTmp, "vsup-phase-c-")); roots.push(parent);
  const source = join(parent, "source"); const data = join(parent, "data");
  await mkdir(source);
  if (options.git) {
    await writeFile(join(source, "tracked.txt"), "original\n");
    await exec("git", ["init", "-q"], { cwd: source });
    await exec("git", ["config", "user.email", "vsup@example.invalid"], { cwd: source });
    await exec("git", ["config", "user.name", "Vibe Supervisor Test"], { cwd: source });
    await exec("git", ["add", "tracked.txt"], { cwd: source });
    await exec("git", ["commit", "-qm", "baseline"], { cwd: source });
  }
  const kind = options.backend ?? "programmatic";
  const backend = new FakeBackend(kind);
  const config: SupervisorConfig = { ...DEFAULT_CONFIG, backend: kind, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 600, ...options.config };
  const manager = new RunManager(config, data, [backend]);
  return { parent, source, data, backend, manager, config };
}

async function running(manager: RunManager, source: string, backend?: FakeBackend) {
  const started = await manager.reviewStart({ task: "review", cwd: source });
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running" || value.state === "waiting_permission");
  void backend;
  return started.run_id;
}

describe("limits defaults from the configuration", () => {
  it("uses the configured turn and timeout defaults when a call omits them", async () => {
    const limits = { ...DEFAULT_CONFIG.limits, maxTurnsReview: 7, reviewTimeoutSeconds: 90, maxTurnsEdit: 9, editTimeoutSeconds: 120 };
    const { source, backend, manager } = await setup({ config: { limits, maxConcurrentRuns: 4 }, git: true });
    try {
      await manager.reviewStart({ task: "review", cwd: source });
      await waitFor(() => backend.inputs.length, (count) => count >= 1);
      expect(backend.inputs[0]?.limits).toMatchObject({ maxTurns: 7, timeoutSeconds: 90 });
      await manager.reviewStart({ task: "review", cwd: source, max_turns: 3, timeout_seconds: 60 });
      await waitFor(() => backend.inputs.length, (count) => count >= 2);
      expect(backend.inputs[1]?.limits).toMatchObject({ maxTurns: 3, timeoutSeconds: 60 });
      await manager.editStart({ task: "edit", cwd: source });
      await waitFor(() => backend.inputs.length, (count) => count >= 3);
      expect(backend.inputs[2]?.limits).toMatchObject({ maxTurns: 9, timeoutSeconds: 120 });
    } finally { await manager.shutdown(); }
  });

  it("keeps the built-in defaults when the configuration is untouched", async () => {
    const { source, backend, manager } = await setup();
    try {
      await manager.reviewStart({ task: "review", cwd: source });
      await waitFor(() => backend.inputs.length, (count) => count >= 1);
      expect(backend.inputs[0]?.limits).toMatchObject({ maxTurns: 20, timeoutSeconds: 1800 });
    } finally { await manager.shutdown(); }
  });
});

describe("removed security keys never loosen the policy", () => {
  async function loaded(source: string, parent: string): Promise<SupervisorConfig> {
    const home = join(parent, "home"); await mkdir(home);
    await writeFile(join(home, "config.toml"), `version = 1\nallowed_workspace_roots = [${JSON.stringify(source)}]\n[security]\nallow_network_tools = true\nallow_shell_in_edit = true\nallow_shell_in_review = true\n`);
    return loadConfig({ env: { VIBE_SUPERVISOR_HOME: home } });
  }

  it.each([["fetch", "review"], ["execute", "review"], ["fetch", "edit"], ["execute", "edit"]] as const)("denies a %s tool request in a %s run despite the old allow keys", async (toolKind, mode) => {
    const { parent, source, data } = await setup({ git: true });
    const backend = new FakeBackend();
    backend.nextPending = { requestId: "req-1", kind: "permission", title: "Tool", options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }, { optionId: "reject-once", name: "Reject once", kind: "reject_once" }], tool: { kind: toolKind, locations: [] } };
    const manager = new RunManager(await loaded(source, parent), join(data, "loaded"), [backend]);
    try {
      const started = mode === "edit" ? await manager.editStart({ task: "edit", cwd: source }) : await manager.reviewStart({ task: "review", cwd: source });
      expect(started.mode).toBe(mode);
      const status = await waitFor(() => manager.status({ run_id: started.run_id, max_events: 100 }), (value) => (value.events as { type: string }[]).some((event) => event.type === "permission_denied_by_policy"));
      expect((status.events as { type: string }[]).map((event) => event.type)).toContain("permission_denied_by_policy");
      expect(status.state).not.toBe("waiting_permission");
      expect(status.pending_request).toBeUndefined();
      await waitFor(() => backend.responded, (value) => value.length > 0);
      expect(backend.responded).toEqual(["reject-once"]);
    } finally { await manager.shutdown(); }
  });
});

describe("closing a run", () => {
  it("cancels a running run and leaves it readable through status and result", async () => {
    const { source, data, backend, manager, config } = await setup();
    let runId = "";
    try {
      runId = await running(manager, source);
      const closed = await manager.close({ run_id: runId });
      expect(closed).toMatchObject({ run_id: runId, state: "closed", next_action: expect.any(String) });
      expect(backend.cancelCalls).toBe(1);
      expect(await manager.status({ run_id: runId })).toMatchObject({ run_id: runId, state: "closed", next_action: expect.any(String) });
      expect(await manager.result({ run_id: runId })).toMatchObject({ run_id: runId, state: "closed" });
      expect(await manager.result({ run_id: runId, detail: "full" })).toMatchObject({ run_id: runId, state: "closed" });
      await manager.shutdown();
      const restarted = new RunManager(config, data, [new FakeBackend()]);
      try {
        await restarted.initialize();
        expect(await restarted.status({ run_id: runId })).toMatchObject({ run_id: runId, state: "closed" });
        expect(await restarted.result({ run_id: runId })).toMatchObject({ run_id: runId, state: "closed" });
      } finally { await restarted.shutdown(); }
    } finally { await manager.shutdown(); }
  });
});

describe("next_action on every reply", () => {
  it("is present on start, status, continue, respond, result and close", async () => {
    const { source, backend, manager } = await setup({ backend: "acp" });
    backend.nextPending = { requestId: "req-1", kind: "permission", title: "Read", options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }, { optionId: "reject-once", name: "Reject once", kind: "reject_once" }], tool: { kind: "read", locations: [join(source, "a.txt")] } };
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      expect(typeof started.next_action).toBe("string");
      const waiting = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "waiting_permission");
      expect(waiting.next_action).toEqual(expect.stringContaining("vibe_respond"));
      const responded = await manager.respond({ run_id: started.run_id, request_id: "req-1", kind: "permission", option_id: "allow-once" });
      expect(responded).toMatchObject({ state: expect.any(String), next_action: expect.any(String) });
      const live = await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
      expect(live.next_action).toEqual(expect.stringContaining("after_seq"));
      await backend.callbacks?.onState("completed", { result: { summary: "Done", stopReason: "end_turn" } });
      const settled = await manager.status({ run_id: started.run_id });
      expect(settled.state).toBe("completed");
      expect(typeof settled.next_action).toBe("string");
      expect(settled.next_action).not.toEqual(expect.stringContaining("after_seq"));
      expect(typeof (await manager.result({ run_id: started.run_id })).next_action).toBe("string");
      expect(typeof (await manager.result({ run_id: started.run_id, detail: "full" })).next_action).toBe("string");
      const continued = await manager.continue({ run_id: started.run_id, message: "more" });
      expect(continued).toMatchObject({ state: expect.any(String), next_action: expect.any(String) });
      const closed = await manager.close({ run_id: started.run_id });
      expect(typeof closed.next_action).toBe("string");
    } finally { await manager.shutdown(); }
  });

  it("is present when a start waits for a settled run", async () => {
    const { source, backend, manager } = await setup();
    try {
      const pending = manager.reviewStart({ task: "review", cwd: source, wait_seconds: 5 });
      await waitFor(() => backend.callbacks, (value) => value !== undefined);
      await backend.callbacks?.onState("completed", { result: { summary: "Done" } });
      expect(await pending).toMatchObject({ state: "completed", next_action: expect.any(String), result: { next_action: expect.any(String) } });
    } finally { await manager.shutdown(); }
  });

  it("does not offer continue or respond when the backend is programmatic", async () => {
    const { source, backend, manager } = await setup();
    try {
      const runId = await running(manager, source);
      await backend.callbacks?.onState("completed", { result: { summary: "Done" } });
      const status = await manager.status({ run_id: runId });
      const compact = await manager.result({ run_id: runId });
      for (const action of [status.next_action, compact.next_action, (await manager.result({ run_id: runId, detail: "full" })).next_action]) {
        expect(action).toEqual(expect.stringContaining("vibe_close"));
        expect(action).not.toEqual(expect.stringContaining("vibe_continue"));
        expect(action).not.toEqual(expect.stringContaining("vibe_respond"));
      }
    } finally { await manager.shutdown(); }
  });

  it("offers a follow-up when the backend can continue", async () => {
    const { source, backend, manager } = await setup({ backend: "acp" });
    try {
      const runId = await running(manager, source);
      await backend.callbacks?.onState("completed", { result: { summary: "Done" } });
      expect((await manager.status({ run_id: runId })).next_action).toEqual(expect.stringContaining("vibe_continue"));
    } finally { await manager.shutdown(); }
  });
});

describe("status paging", () => {
  async function emit(backend: FakeBackend, count: number) {
    for (let index = 0; index < count; index += 1) await backend.callbacks?.onEvent({ source: "vibe", type: "tool_call", severity: "info", data: { title: `step ${index}` } });
  }

  it("returns next_after_seq as the last delivered seq so paging never loses or repeats an event", async () => {
    const { source, backend, manager } = await setup();
    try {
      const runId = await running(manager, source);
      await emit(backend, 5);
      const everything = await manager.status({ run_id: runId, max_events: 100 });
      const allSeqs = (everything.events as { seq: number }[]).map((event) => event.seq);
      expect(allSeqs.length).toBeGreaterThanOrEqual(5);
      expect(everything.next_after_seq).toBe(allSeqs.at(-1));
      const seen: number[] = [];
      let cursor = 0;
      for (let page = 0; page < 20; page += 1) {
        const reply = await manager.status({ run_id: runId, after_seq: cursor, max_events: 2 });
        const seqs = (reply.events as { seq: number }[]).map((event) => event.seq);
        expect(seqs.length).toBeLessThanOrEqual(2);
        seen.push(...seqs);
        if (seqs.length > 0) expect(reply.next_after_seq).toBe(seqs.at(-1));
        else { expect(reply.next_after_seq).toBe(cursor); break; }
        expect(reply.next_action).toEqual(expect.stringContaining(`after_seq=${String(reply.next_after_seq)}`));
        cursor = reply.next_after_seq as number;
      }
      expect(seen).toEqual(allSeqs);
    } finally { await manager.shutdown(); }
  });

  it("echoes after_seq when nothing new was delivered", async () => {
    const { source, backend, manager } = await setup();
    try {
      const runId = await running(manager, source);
      await emit(backend, 3);
      const last = (await manager.status({ run_id: runId, max_events: 100 })).next_after_seq as number;
      const idle = await manager.status({ run_id: runId, after_seq: last });
      expect(idle).toMatchObject({ events: [], next_after_seq: last });
      expect(idle.next_action).toEqual(expect.stringContaining(`after_seq=${String(last)}`));
      const none = await manager.status({ run_id: runId, after_seq: 0, max_events: 0 });
      expect(none).toMatchObject({ events: [], next_after_seq: 0 });
    } finally { await manager.shutdown(); }
  });
});
