import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, RunRecord, StartRunInput, SupervisorBackend } from "../../src/contracts.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { RunManager } from "../../src/core/run-manager.js";
import { AcpBackend } from "../../src/backends/acp.js";
import type { VibeChildProfile } from "../../src/backends/profile.js";
import type { VibeLaunch } from "../../src/backends/launcher.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { Transport, JSONRPCMessage } from "@modelcontextprotocol/server";
import { PassThrough } from "node:stream";
import { createSupervisorMcpServer } from "../../src/mcp/server.js";

function structured(result: unknown): unknown {
  return JSON.parse((result as { content: { text: string }[] }).content[0]!.text);
}

const fixture = fileURLToPath(new URL("../fixtures/fake-acp.mjs", import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const COMPLETED = "Vibe completed the delegated task.";
const TURN_LIMIT = "Vibe stopped at the turn limit before giving a final answer. Inspect the artifacts and stop_reason before trusting the result; Vibe counts turns cumulatively per session, so start a new run with a larger max_turns.";
const TURN_LIMIT_ACP = "Vibe stopped at the turn limit before giving a final answer. Inspect the artifacts and stop_reason before trusting the result; Vibe counts turns cumulatively per session, so continue with vibe_continue only with a larger max_turns, or start a new run.";
const CHANGED_PLAIN = "The source workspace changed during this read-only review. The changes may be your own edits or a read-only boundary violation; inspect the changed paths before trusting the review.";

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

const clients: Client[] = [];

class FakeBackend implements SupervisorBackend {
  readonly kind = "programmatic" as const;
  callbacks: BackendCallbacks | undefined;
  completeOnStart: { stopReason: string } | undefined;
  async probe() { return { available: true, backend: this.kind, supportsContinue: true, supportsPermissionResponse: true }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.callbacks = callbacks;
    if (this.completeOnStart) { const result = this.completeOnStart; setTimeout(() => { void callbacks.onState("completed", { result }); }, 50); }
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: "running" };
  }
  async continue() {}
  async respond() {}
  async cancel() {}
  async close() {}
  async recover(_record: RunRecord): Promise<BackendRunHandle | undefined> { return undefined; }
}

class FakeAcpBackend extends AcpBackend {
  constructor(private readonly testMode: string, dataDir: string, allowedWorkspaceRoots: string[]) {
    super({ ...DEFAULT_CONFIG, backend: "acp", allowedWorkspaceRoots, paths: { vibeAcp: "fake-acp" } }, dataDir);
  }
  protected override executable(): string { return "fake-acp"; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: this.testMode } };
  }
  override async probe() {
    return { available: true, backend: "acp" as const, executable: "fake-acp", version: "2.25.8", supportsContinue: true, supportsPermissionResponse: true };
  }
}

async function paths() {
  const parent = await mkdtemp(path.join(canonicalTmp, "vsup-stop-")); roots.push(parent);
  const source = path.join(parent, "source"); const data = path.join(parent, "data");
  await mkdir(source);
  return { parent, source, data };
}

async function setup() {
  const { source, data } = await paths();
  const backend = new FakeBackend();
  const manager = new RunManager({ ...DEFAULT_CONFIG, backend: "programmatic", allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 0 }, data, [backend]);
  return { source, data, manager, backend };
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function runningReview(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: "review", cwd: source });
  await waitFor(() => manager.status({ run_id: started.run_id }), (value) => value.state === "running");
  return started.run_id;
}

describe("stop reason reporting", () => {
  it("explains a turn-limit stop when the backend gave no summary", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { stopReason: "max_turn_requests" } });
      const compact = await manager.result({ run_id: runId });
      expect(compact.state).toBe("completed");
      expect(compact.stop_reason).toBe("max_turn_requests");
      expect(compact.summary).toBe(TURN_LIMIT);
      expect(compact.warnings).toEqual([expect.stringContaining("max_turn_requests")]);
      const full = await manager.result({ run_id: runId, detail: "full" });
      expect(full.summary).toBe(TURN_LIMIT);
      expect(full.warnings).toEqual(compact.warnings);
    } finally { await manager.shutdown(); }
  });

  it.each([
    ["max_tokens", /token limit/],
    ["refusal", /declined/],
    ["cancelled", /cancelled/]
  ])("derives a distinct summary and warning for %s", async (reason, pattern) => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { stopReason: reason } });
      const compact = await manager.result({ run_id: runId });
      expect(compact.state).toBe("completed");
      expect(compact.summary).toMatch(pattern);
      expect(compact.summary).not.toBe(COMPLETED);
      expect(compact.warnings).toEqual([expect.stringContaining(reason)]);
    } finally { await manager.shutdown(); }
  });

  it("names an unknown stop reason in the summary and warning", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { stopReason: "brand_new_reason" } });
      const compact = await manager.result({ run_id: runId });
      expect(compact.summary).toContain("Vibe stopped with reason brand_new_reason");
      expect(compact.warnings).toEqual([expect.stringContaining("brand_new_reason")]);
    } finally { await manager.shutdown(); }
  });

  it("keeps a backend summary on a non-end_turn stop and still warns", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { stopReason: "max_turn_requests", summary: "Partial findings so far" } });
      const compact = await manager.result({ run_id: runId });
      expect(compact.summary).toBe("Partial findings so far");
      expect(compact.warnings).toEqual([expect.stringContaining("max_turn_requests")]);
    } finally { await manager.shutdown(); }
  });

  it("leaves an end_turn completion unchanged", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { stopReason: "end_turn" } });
      const compact = await manager.result({ run_id: runId });
      expect(compact.summary).toBe(COMPLETED);
      expect(compact.warnings).toEqual([]);
    } finally { await manager.shutdown(); }
  });

  it("surfaces the cap through the MCP compact result and a start-with-wait response", async () => {
    const { source, manager, backend } = await setup();
    const input = new PassThrough(); const output = new PassThrough();
    const server = createSupervisorMcpServer(manager, { config: { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits } } });
    await server.connect(new StdioServerTransport(input, output));
    const client = new Client({ name: "stop-reason-client", version: "1.0.0" }); clients.push(client);
    await client.connect(new StdioClientHarness(input, output));
    try {
      backend.completeOnStart = { stopReason: "max_turn_requests" };
      const waited = await client.callTool({ name: "vibe_review_start", arguments: { task: "review", cwd: source, wait_seconds: 5 } });
      const envelope = structured(waited) as { state: string; result: Record<string, unknown> };
      expect(envelope.state).toBe("completed");
      expect(envelope.result.stop_reason).toBe("max_turn_requests");
      expect(envelope.result.summary).toBe(TURN_LIMIT);
      expect(envelope.result.warnings).toEqual([expect.stringContaining("max_turn_requests")]);
      const runId = (structured(waited) as { run_id: string }).run_id;
      const compact = structured(await client.callTool({ name: "vibe_result", arguments: { run_id: runId } })) as Record<string, unknown>;
      expect(compact.stop_reason).toBe("max_turn_requests");
      expect(compact.summary).toBe(TURN_LIMIT);
      expect(compact.warnings).toEqual([expect.stringContaining("max_turn_requests")]);
    } finally { await manager.shutdown(); }
  });

  it("replaces the previous turn's summary and stop-reason warning on a later turn", async () => {
    const { source, manager, backend } = await setup();
    try {
      const runId = await runningReview(manager, source);
      await backend.callbacks?.onState("completed", { result: { stopReason: "max_turn_requests", summary: "First turn partial" } });
      await manager.continue({ run_id: runId, message: "keep going", max_turns: 25 });
      await backend.callbacks?.onState("completed", { result: { stopReason: "end_turn", summary: "Second turn final" } });
      const compact = await manager.result({ run_id: runId });
      expect(compact.stop_reason).toBe("end_turn");
      expect(compact.summary).toBe("Second turn final");
      expect(compact.warnings).toEqual([]);
    } finally { await manager.shutdown(); }
  });

  it("keeps review integrity warnings across a continuation while swapping the stop-reason warning", async () => {
    const { source, manager, backend } = await setup();
    await writeFile(path.join(source, "a.txt"), "a\n");
    try {
      const runId = await runningReview(manager, source);
      await writeFile(path.join(source, "a.txt"), "changed\n");
      await backend.callbacks?.onState("completed", { result: { stopReason: "end_turn" } });
      const first = await manager.result({ run_id: runId });
      expect(first.warnings).toEqual([CHANGED_PLAIN]);
      await manager.continue({ run_id: runId, message: "more" });
      await backend.callbacks?.onState("completed", { result: { stopReason: "max_turn_requests" } });
      const second = await manager.result({ run_id: runId });
      expect(second.summary).toBe(TURN_LIMIT);
      expect(second.warnings).toEqual([CHANGED_PLAIN, expect.stringContaining("max_turn_requests")]);
      await manager.continue({ run_id: runId, message: "finish", max_turns: 30 });
      await backend.callbacks?.onState("completed", { result: { stopReason: "end_turn" } });
      const third = await manager.result({ run_id: runId });
      expect(third.summary).toBe(COMPLETED);
      expect(third.warnings).toEqual([CHANGED_PLAIN]);
    } finally { await manager.shutdown(); }
  });

  it("reflects the capped second ACP turn and drops the first turn's summary", async () => {
    const { source, data } = await paths();
    const backend = new FakeAcpBackend("cap-on-second", data, [source]);
    const manager = new RunManager({ ...DEFAULT_CONFIG, backend: "acp", allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 60 }, data, [backend]);
    try {
      const started = await manager.reviewStart({ task: "review", cwd: source });
      const first = await waitFor(() => manager.result({ run_id: started.run_id }), (value) => value.state === "completed");
      expect(first.state).toBe("completed");
      expect(first.stop_reason).toBe("end_turn");
      expect(first.summary).toBe(COMPLETED);
      expect(first.warnings).toEqual([]);
      for (let attempt = 0; ; attempt += 1) {
        try { await manager.continue({ run_id: started.run_id, message: "go on" }); break; }
        catch (error) { if (attempt >= 100 || !String((error as Error).message).includes("already starting")) throw error; await new Promise((resolve) => setTimeout(resolve, 20)); }
      }
      const second = await waitFor(() => manager.result({ run_id: started.run_id }), (value) => value.state === "completed" && value.stop_reason === "max_turn_requests");
      expect(second.state).toBe("completed");
      expect(second.stop_reason).toBe("max_turn_requests");
      expect(second.summary).toBe(TURN_LIMIT_ACP);
      expect(second.warnings).toEqual([expect.stringContaining("max_turn_requests")]);
    } finally { await manager.shutdown(); }
  }, 30_000);
});
