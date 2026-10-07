import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "smol-toml";
import { Client } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { Transport, JSONRPCMessage } from "@modelcontextprotocol/server";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, PendingRequest, RunRecord, StartRunInput, SupervisorBackend, SupervisorConfig } from "../../src/contracts.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { validateConfig } from "../../src/config/validation.js";
import { RunManager } from "../../src/core/run-manager.js";
import { createSupervisorMcpServer } from "../../src/mcp/server.js";
import type { RunManagerTools } from "../../src/mcp/tools.js";
import { toolSchemas } from "../../src/mcp/schemas.js";
import { runCli } from "../../src/cli.js";

const roots: string[] = [];
const canonicalTmp = await realpath(tmpdir());
const exec = promisify(execFile);
const clients: Client[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => {})));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
  readonly kind = "programmatic" as const;
  handle: BackendRunHandle | undefined;
  callbacks: BackendCallbacks | undefined;
  nextPending: PendingRequest | undefined;
  beforeReturn: ((input: StartRunInput) => Promise<void>) | undefined;
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks = callbacks;
    this.handle = { runId: input.runId, backend: this.kind, opaque: {} };
    if (this.nextPending) await callbacks.onPendingRequest(this.nextPending);
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
  const parent = await mkdtemp(join(canonicalTmp, "vsup-shape-")); roots.push(parent);
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
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for run-manager state");
}

async function runningRun(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: "review", cwd: source });
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
  return started.run_id;
}

const permissionFor = (source: string): PendingRequest => ({ requestId: "req-1", kind: "permission", title: "Read file", options: [{ optionId: "allow", name: "Allow once" }, { optionId: "deny", name: "Deny" }], tool: { kind: "read", locations: [source] } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

describe("vibe_status wait_seconds", () => {
  it("returns immediately when an event past after_seq already exists", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningRun(manager, source);
      await backend.callbacks?.onEvent({ source: "vibe", type: "tool_call", severity: "info", data: { title: "read" } });
      const began = Date.now();
      const status = await manager.status({ run_id: runId, wait_seconds: 30 });
      expect(Date.now() - began).toBeLessThan(1000);
      expect((status.events as unknown[]).length).toBeGreaterThan(0);
    } finally { await manager.shutdown(); }
  });

  it("returns when a new event arrives", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningRun(manager, source);
      const last = (await manager.status({ run_id: runId })).last_seq as number;
      let settled = false;
      const waiting = manager.status({ run_id: runId, after_seq: last, wait_seconds: 30 }).then((value) => { settled = true; return value; });
      await tick();
      expect(settled).toBe(false);
      await backend.callbacks?.onEvent({ source: "vibe", type: "tool_call", severity: "info", data: { title: "grep" } });
      const status = await waiting;
      expect(status.state).toBe("running");
      expect(status.events).toEqual([expect.objectContaining({ type: "tool_call", title: "grep" })]);
    } finally { await manager.shutdown(); }
  });

  it("returns when the run state changes", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningRun(manager, source);
      const last = (await manager.status({ run_id: runId })).last_seq as number;
      const waiting = manager.status({ run_id: runId, after_seq: last + 100, wait_seconds: 30 });
      await tick();
      await backend.callbacks?.onState("ready");
      expect((await waiting).state).toBe("ready");
    } finally { await manager.shutdown(); }
  });

  it("returns when a pending request appears", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningRun(manager, source);
      const last = (await manager.status({ run_id: runId })).last_seq as number;
      const waiting = manager.status({ run_id: runId, after_seq: last + 100, wait_seconds: 30 });
      await tick();
      await backend.callbacks?.onPendingRequest(permissionFor(source));
      const status = await waiting;
      expect(status.pending_request).toMatchObject({ request_id: "req-1" });
    } finally { await manager.shutdown(); }
  });

  it("returns immediately for a run waiting on permission", async () => {
    const backend = new FakeBackend();
    const { source, manager } = await setup(backend);
    backend.nextPending = permissionFor(source);
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "waiting_permission");
      const began = Date.now();
      const status = await manager.status({ run_id: started.run_id, after_seq: 1000, wait_seconds: 300 });
      expect(Date.now() - began).toBeLessThan(1000);
      expect(status.state).toBe("waiting_permission");
    } finally { await manager.shutdown(); }
  });

  it("times out with the unchanged status after the requested wait", async () => {
    const { source, manager } = await setup();
    try {
      const runId = await runningRun(manager, source);
      const last = (await manager.status({ run_id: runId })).last_seq as number;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let settled = false;
      const waiting = manager.status({ run_id: runId, after_seq: last, wait_seconds: 30 }).then((value) => { settled = true; return value; });
      await vi.advanceTimersByTimeAsync(29_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      const status = await waiting;
      expect(status.state).toBe("running");
      expect(status.events).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); await manager.shutdown(); }
  });

  it("leaves no timers, waiters or abort listeners behind across many waits", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningRun(manager, source);
      const runtime = (manager as unknown as { runs: Map<string, { waiters: Set<unknown> }> }).runs.get(runId)!;
      const controller = new AbortController();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      for (let round = 0; round < 25; round += 1) {
        const last = (await manager.status({ run_id: runId })).last_seq as number;
        const waiting = manager.status({ run_id: runId, after_seq: last, wait_seconds: 60 }, { signal: controller.signal });
        await vi.advanceTimersByTimeAsync(0);
        expect(runtime.waiters.size).toBe(1);
        await backend.callbacks?.onEvent({ source: "vibe", type: "tool_call", severity: "info", data: { title: `step ${round}` } });
        await waiting;
        expect(runtime.waiters.size).toBe(0);
        expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
        expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      }
    } finally { vi.useRealTimers(); await manager.shutdown(); }
  });

  it("releases a waiter when the supervisor shuts down", async () => {
    const { source, manager } = await setup();
    const runId = await runningRun(manager, source);
    const last = (await manager.status({ run_id: runId })).last_seq as number;
    const began = Date.now();
    const waiting = manager.status({ run_id: runId, after_seq: last + 100, wait_seconds: 300 });
    await tick();
    await manager.shutdown();
    await waiting;
    expect(Date.now() - began).toBeLessThan(2000);
  });

  it("releases a waiter when the request is aborted", async () => {
    const { source, manager } = await setup();
    try {
      const runId = await runningRun(manager, source);
      const last = (await manager.status({ run_id: runId })).last_seq as number;
      const controller = new AbortController();
      const began = Date.now();
      const waiting = manager.status({ run_id: runId, after_seq: last + 100, wait_seconds: 300 }, { signal: controller.signal });
      await tick();
      controller.abort();
      const status = await waiting;
      expect(status.state).toBe("running");
      expect(Date.now() - began).toBeLessThan(2000);
    } finally { await manager.shutdown(); }
  });

  it("rejects out-of-range wait_seconds", () => {
    expect(toolSchemas.vibe_status.parse({ run_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" })).toMatchObject({ wait_seconds: 0, max_events: 10 });
    expect(() => toolSchemas.vibe_status.parse({ run_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", wait_seconds: 301 })).toThrow();
    expect(() => toolSchemas.vibe_status.parse({ run_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", wait_seconds: -1 })).toThrow();
    expect(() => toolSchemas.vibe_review_start.parse({ task: "x", cwd: "/r", wait_seconds: 301 })).toThrow();
    expect(toolSchemas.vibe_edit_start.parse({ task: "x", cwd: "/r", wait_seconds: 300 })).toMatchObject({ wait_seconds: 300 });
  });
});

describe("start tools with wait_seconds", () => {
  it("returns the compact result when the run completes inside the wait", async () => {
    const backend = new FakeBackend();
    backend.beforeReturn = async () => { setTimeout(() => { void backend.callbacks?.onState("completed", { result: { summary: "Finished" } }); }, 60); };
    const { source, manager } = await setup(backend);
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source, wait_seconds: 30 });
      expect(started.state).toBe("completed");
      expect(started).toMatchObject({ run_id: expect.any(String), worker_workspace: source, result: { summary: "Finished", state: "completed" } });
    } finally { await manager.shutdown(); }
  });

  it("returns immediately when the run needs a permission decision", async () => {
    const backend = new FakeBackend();
    const { source, manager } = await setup(backend);
    backend.nextPending = permissionFor(source);
    try {
      const began = Date.now();
      const started = await manager.reviewStart({ task: "review", cwd: source, wait_seconds: 300 });
      expect(Date.now() - began).toBeLessThan(2000);
      expect(started.state).toBe("waiting_permission");
      expect(started.pending_request).toMatchObject({ request_id: "req-1" });
      expect(started.result).toBeUndefined();
    } finally { await manager.shutdown(); }
  });

  it("does not wait or attach a result when wait_seconds is 0", async () => {
    const { source, manager } = await setup();
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      expect(started.state).toBe("starting");
      expect(started.result).toBeUndefined();
    } finally { await manager.shutdown(); }
  });

  it("an edit start keeps the worker path and returns the compact patch", async () => {
    const backend = new FakeBackend();
    backend.beforeReturn = async (input) => {
      await writeFile(join(input.workerWorkspace, "generated.txt"), "new output\n");
      setTimeout(() => { void backend.callbacks?.onState("completed", { result: { summary: "Generated" } }); }, 40);
    };
    const { source, data, manager } = await setupGit(backend);
    try {
      const started = await manager.editStart({ task: "edit", cwd: source, wait_seconds: 30 });
      expect(started.worker_workspace).toBe(join(data, "worktrees", started.run_id));
      expect(started.state).toBe("completed");
      expect(started.result).toMatchObject({ changed_files: ["generated.txt"], changed_files_total: 1 });
    } finally { await manager.shutdown(); }
  });
});

describe("vibe_result detail", () => {
  async function completedEdit(files: Record<string, string>) {
    const backend = new FakeBackend();
    backend.beforeReturn = async (input) => { for (const [name, text] of Object.entries(files)) await writeFile(join(input.workerWorkspace, name), text); };
    const context = await setupGit(backend);
    const started = await context.manager.editStart({ task: "edit", cwd: context.source });
    await waitFor(() => context.manager.status({ run_id: started.run_id }), (value) => value.state === "running");
    await backend.callbacks?.onEvent({ source: "vibe", type: "agent_message", severity: "info", data: { text: "x".repeat(10_000) } });
    await backend.callbacks?.onState("completed", { result: { summary: "Done" } });
    return { ...context, runId: started.run_id };
  }

  it("inlines a small patch and trims artifacts and workspace", async () => {
    const { manager, runId, data } = await completedEdit({ "small.txt": "hello\n" });
    try {
      const compact = await manager.result({ run_id: runId });
      expect(compact).toMatchObject({ run_id: runId, state: "completed", backend: "programmatic", summary: "Done", warnings: [], changed_files: ["small.txt"], changed_files_total: 1, worker: join(data, "worktrees", runId) });
      expect(compact.patch).toContain("+hello");
      expect(compact.patch_path).toBeUndefined();
      expect(compact.diff_stat).toContain("small.txt");
      expect(compact.workspace).toBeUndefined();
      const artifacts = compact.artifacts as Record<string, unknown>[];
      expect(artifacts.length).toBeGreaterThan(0);
      for (const artifact of artifacts) expect(Object.keys(artifact).sort()).toEqual(["name", "path"]);
      const full = await manager.result({ run_id: runId, detail: "full" });
      expect(full.workspace).toMatchObject({ worker: expect.any(String), source: expect.any(String) });
      expect((full.artifacts as Record<string, unknown>[])[0]).toMatchObject({ sha256: expect.any(String), media_type: expect.any(String) });
      expect(full.patch).toBeUndefined();
    } finally { await manager.shutdown(); }
  });

  it("references a patch larger than 4000 bytes by path instead of inlining it", async () => {
    const { manager, runId } = await completedEdit({ "large.txt": "y".repeat(6000) + "\n" });
    try {
      const compact = await manager.result({ run_id: runId });
      expect(compact.patch).toBeUndefined();
      expect(compact.patch_path).toEqual(expect.stringContaining("diff.patch"));
      expect(compact.patch_bytes).toBeGreaterThan(4000);
      expect(await readFile(compact.patch_path as string, "utf8")).toContain("large.txt");
    } finally { await manager.shutdown(); }
  });

  it("caps changed_files at 50 and reports the total", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 52; index += 1) files[`f${String(index).padStart(2, "0")}.txt`] = "a\n";
    const { manager, runId } = await completedEdit(files);
    try {
      const compact = await manager.result({ run_id: runId });
      expect(compact.changed_files).toHaveLength(50);
      expect(compact.changed_files_total).toBe(52);
      expect(compact.patch).toBeUndefined();
      expect((await manager.result({ run_id: runId, detail: "full" })).changed_files).toHaveLength(52);
    } finally { await manager.shutdown(); }
  });

  it("caps the inline transcript in compact mode and points at the file", async () => {
    const { manager, runId } = await completedEdit({ "a.txt": "a\n" });
    try {
      const compact = await manager.result({ run_id: runId, include_transcript: true });
      expect((compact.transcript as string).length).toBeLessThanOrEqual(4200);
      expect(compact.transcript_path).toEqual(expect.stringContaining("transcript.md"));
      const full = await manager.result({ run_id: runId, detail: "full", include_transcript: true });
      expect((full.transcript as string).length).toBeGreaterThanOrEqual(10_000);
    } finally { await manager.shutdown(); }
  });

  it("rejects the removed summary value", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningRun(manager, source);
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      expect(() => toolSchemas.vibe_result.parse({ run_id: runId, detail: "summary" })).toThrow();
      await expect(manager.result({ run_id: runId, detail: "summary" } as never)).rejects.toMatchObject({ code: "VSUP_INVALID_ARGUMENT" });
    } finally { await manager.shutdown(); }
  });

  it("omits the worker block for a review and defaults to compact", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningRun(manager, source);
      await backend.callbacks?.onState("completed", { result: { summary: "Review done" } });
      const compact = await manager.result({ run_id: runId });
      expect(compact.worker).toBeUndefined();
      expect(compact.workspace).toBeUndefined();
      expect(toolSchemas.vibe_result.parse({ run_id: runId }).detail).toBe("compact");
    } finally { await manager.shutdown(); }
  });
});

class StdioClientHarness implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private buffer = "";
  constructor(private readonly input: PassThrough, private readonly output: PassThrough) {}
  async start(): Promise<void> {
    this.output.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      for (;;) {
        const newline = this.buffer.indexOf("\n");
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        if (line) this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
      }
    });
    this.output.on("error", (error) => this.onerror?.(error));
  }
  async send(message: JSONRPCMessage): Promise<void> { this.input.write(`${JSON.stringify(message)}\n`); }
  async close(): Promise<void> { this.input.end(); this.output.end(); this.onclose?.(); }
}

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";

function stubManager(overrides: Partial<RunManagerTools> = {}): RunManagerTools {
  return {
    reviewStart: vi.fn(async () => ({})), editStart: vi.fn(async () => ({})),
    status: vi.fn(async () => ({ run_id: RUN_ID, state: "running", events: [{ seq: 1, type: "tool_call" }] })),
    continue: vi.fn(async () => ({})), respond: vi.fn(async () => ({})), result: vi.fn(async () => ({})),
    close: vi.fn(async () => ({})),
    ...overrides,
  };
}

async function connect(manager: RunManagerTools, limits: Partial<SupervisorConfig["limits"]> = {}) {
  const input = new PassThrough(); const output = new PassThrough();
  const server = createSupervisorMcpServer(manager, { config: { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits, ...limits } } });
  await server.connect(new StdioServerTransport(input, output));
  const client = new Client({ name: "shape-test-client", version: "1.0.0" }); clients.push(client);
  await client.connect(new StdioClientHarness(input, output));
  return client;
}

describe("MCP result formats", () => {
  it("defaults to the text format with an 8000 character cap", async () => {
    expect(DEFAULT_CONFIG.limits.mcpResultFormat).toBe("text");
    expect(DEFAULT_CONFIG.limits.maxMcpResultChars).toBe(8000);
    expect(validateConfig({ version: 1 }).limits).toMatchObject({ mcpResultFormat: "text", maxMcpResultChars: 8000 });
    const client = await connect(stubManager());
    const result = await client.callTool({ name: "vibe_status", arguments: { run_id: RUN_ID } });
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({ run_id: RUN_ID, state: "running" });
  });

  it("structured sends structuredContent plus a minimal pointer", async () => {
    const client = await connect(stubManager(), { mcpResultFormat: "structured" });
    const result = await client.callTool({ name: "vibe_status", arguments: { run_id: RUN_ID } });
    expect(result.structuredContent).toMatchObject({ run_id: RUN_ID, state: "running", events: [{ seq: 1 }] });
    const text = (result.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text)).toEqual({ run_id: RUN_ID, state: "running", see: "structuredContent" });
  });

  it("both keeps text and structuredContent", async () => {
    const client = await connect(stubManager(), { mcpResultFormat: "both" });
    const result = await client.callTool({ name: "vibe_status", arguments: { run_id: RUN_ID } });
    const text = (result.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text)).toEqual(result.structuredContent);
  });

  it("errors follow the configured format", async () => {
    const failing = stubManager({ status: vi.fn(async () => { throw Object.assign(new Error("run missing"), { code: "VSUP_NOT_FOUND" }); }) });
    const textClient = await connect(failing);
    const asText = await textClient.callTool({ name: "vibe_status", arguments: { run_id: RUN_ID } });
    expect(asText.isError).toBe(true);
    expect(asText.structuredContent).toBeUndefined();
    expect((asText.content as { text: string }[])[0]!.text).toContain("VSUP_NOT_FOUND");
    const structuredClient = await connect(failing, { mcpResultFormat: "structured" });
    const asStructured = await structuredClient.callTool({ name: "vibe_status", arguments: { run_id: RUN_ID } });
    expect(asStructured.isError).toBe(true);
    expect(asStructured.structuredContent).toMatchObject({ error: { code: "VSUP_NOT_FOUND" } });
    expect((asStructured.content as { text: string }[])[0]!.text.length).toBeLessThan(120);
    const bothClient = await connect(failing, { mcpResultFormat: "both" });
    const asBoth = await bothClient.callTool({ name: "vibe_status", arguments: { run_id: RUN_ID } });
    expect(asBoth.structuredContent).toMatchObject({ error: { code: "VSUP_NOT_FOUND" } });
    expect((asBoth.content as { text: string }[])[0]!.text).toContain("VSUP_NOT_FOUND");
  });

  it("passes the request abort signal to the manager and wait_seconds through", async () => {
    let observed: AbortSignal | undefined;
    const manager = stubManager({
      status: vi.fn(async (_input, options) => {
        observed = options?.signal;
        await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
        return { run_id: RUN_ID, state: "running" };
      }),
    });
    const client = await connect(manager);
    const controller = new AbortController();
    const call = client.callTool({ name: "vibe_status", arguments: { run_id: RUN_ID, wait_seconds: 120 } }, { signal: controller.signal });
    call.catch(() => undefined);
    await vi.waitFor(() => expect(observed).toBeDefined());
    expect(manager.status).toHaveBeenCalledWith(expect.objectContaining({ wait_seconds: 120 }), expect.anything());
    controller.abort();
    await vi.waitFor(() => expect(observed?.aborted).toBe(true));
    await expect(call).rejects.toBeDefined();
  });
});

describe("configure-codex tool timeout", () => {
  async function codexHome() {
    const home = await mkdtemp(join(canonicalTmp, "vsup-codex-")); roots.push(home);
    await mkdir(join(home, ".codex"));
    vi.stubEnv("HOME", home);
    return join(home, ".codex", "config.toml");
  }

  it("writes tool_timeout_sec = 600 in the generated block", async () => {
    const file = await codexHome();
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => { written.push(String(chunk)); return true; }) as typeof process.stdout.write);
    await runCli(["configure-codex", "--user", "--dry-run"]);
    expect(written.join("")).toContain("tool_timeout_sec = 600");
    await runCli(["configure-codex", "--user"]);
    const parsed = parse(await readFile(file, "utf8")) as { mcp_servers: Record<string, { tool_timeout_sec: number }> };
    expect(parsed.mcp_servers["vibe-supervisor"]!.tool_timeout_sec).toBe(600);
  });

  it("adds the timeout to an existing registration that lacks it and then stays idempotent", async () => {
    const file = await codexHome();
    vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write);
    await runCli(["configure-codex", "--user"]);
    const current = await readFile(file, "utf8");
    await writeFile(file, current.replace(/tool_timeout_sec = 600\n/, ""));
    await runCli(["configure-codex", "--user"]);
    const updated = await readFile(file, "utf8");
    expect(updated).toContain("tool_timeout_sec = 600");
    await runCli(["configure-codex", "--user"]);
    expect(await readFile(file, "utf8")).toBe(updated);
  });
});
