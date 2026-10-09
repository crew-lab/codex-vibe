import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendKind, BackendRunHandle, BackendStartResult, PendingRequest, RunRecord, StartRunInput, SupervisorBackend, SupervisorConfig } from "../../src/contracts.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
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
