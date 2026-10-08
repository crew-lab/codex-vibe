import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { RunManager } from "../../src/core/run-manager.js";
import { AcpBackend } from "../../src/backends/acp.js";
import type { VibeChildProfile } from "../../src/backends/profile.js";
import type { VibeLaunch } from "../../src/backends/launcher.js";

const fixture = fileURLToPath(new URL("../fixtures/fake-acp.mjs", import.meta.url));
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

class BudgetBackend extends AcpBackend {
  constructor(private readonly log: string, private readonly steps: string, dataDir: string, allowedWorkspaceRoots: string[]) {
    super({ ...DEFAULT_CONFIG, backend: "acp", allowedWorkspaceRoots, paths: { vibeAcp: "fake-acp", dataDir } }, dataDir);
  }
  protected override executable(): string { return "fake-acp"; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return { command: process.execPath, args: [fixture], env: { ...profile.env, FAKE_ACP_CASE: "budget", FAKE_BUDGET_LOG: this.log, FAKE_BUDGET_STEPS: this.steps } };
  }
  override async probe() {
    return { available: true, backend: "acp" as const, executable: "fake-acp", version: "2.25.8", supportsContinue: true, supportsPermissionResponse: true };
  }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function setup(idleTtl: number) {
  const parent = await mkdtemp(path.join(canonicalTmp, "vsup-budget-")); roots.push(parent);
  const source = path.join(parent, "source"); const data = path.join(parent, "data");
  await mkdir(source);
  const log = path.join(parent, "log.txt"); const steps = path.join(parent, "steps.txt");
  const config = { ...DEFAULT_CONFIG, backend: "acp" as const, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: idleTtl };
  const manager = new RunManager(config, data, [new BudgetBackend(log, steps, data, [source])]);
  const lines = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean);
  const started = await manager.reviewStart({ task: "review", cwd: source, max_turns: 1 });
  const first = await waitFor(() => manager.result({ run_id: started.run_id }), (value) => value.state === "completed");
  return { manager, config, data, source, log, steps, lines, runId: started.run_id, first };
}

async function retryContinue(manager: RunManager, input: { run_id: string; message: string; max_turns?: number }) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await manager.continue(input); }
    catch (error) { if (attempt >= 100 || !String((error as Error).message).includes("already starting")) throw error; await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
}

describe("cumulative turn budget on continuation", () => {
  it("rejects a plain or non-raising continue and accepts a raised limit", async () => {
    const { manager, lines, runId, first } = await setup(60);
    try {
      expect(first.stop_reason).toBe("max_turn_requests");
      expect(first.next_action).not.toMatch(/call vibe_continue for a follow-up/);
      expect(first.summary).toMatch(/cumulative/);
      const before = await lines();
      expect(before.filter((line) => line === "session/prompt")).toHaveLength(1);
      await expect(manager.continue({ run_id: runId, message: "more" })).rejects.toMatchObject({ code: "VSUP_TURN_LIMIT_REACHED", retryable: false });
      await expect(manager.continue({ run_id: runId, message: "more", max_turns: 1 })).rejects.toMatchObject({ code: "VSUP_TURN_LIMIT_REACHED" });
      expect(await lines()).toEqual(before);
      await retryContinue(manager, { run_id: runId, message: "more", max_turns: 5 });
      const second = await waitFor(() => manager.result({ run_id: runId }), (value) => value.state === "completed" && value.stop_reason === "end_turn");
      expect(second.stop_reason).toBe("end_turn");
      const after = await lines();
      expect(after.slice(before.length)).toEqual(["set_config_option max_turns 5", "session/prompt"]);
      expect((await manager.status({ run_id: runId })).next_action).toMatch(/vibe_continue/);
    } finally { await manager.shutdown(); }
  }, 30_000);

  it("sends the raised limit after a lazy session load following a supervisor restart", async () => {
    const { manager, config, data, source, log, steps, lines, runId } = await setup(60);
    await manager.shutdown();
    const restarted = new RunManager(config, data, [new BudgetBackend(log, steps, data, [source])]);
    try {
      await restarted.initialize();
      const before = await lines();
      await expect(restarted.continue({ run_id: runId, message: "more" })).rejects.toMatchObject({ code: "VSUP_TURN_LIMIT_REACHED" });
      expect(await lines()).toEqual(before);
      await retryContinue(restarted, { run_id: runId, message: "more", max_turns: 5 });
      const second = await waitFor(() => restarted.result({ run_id: runId }), (value) => value.state === "completed" && value.stop_reason === "end_turn");
      expect(second.stop_reason).toBe("end_turn");
      const after = (await lines()).slice(before.length);
      expect(after.at(-2)).toBe("set_config_option max_turns 5");
      expect(after.at(-1)).toBe("session/prompt");
      expect(after.filter((line) => line === "session/prompt")).toHaveLength(1);
    } finally { await restarted.shutdown(); }
  }, 30_000);
});
