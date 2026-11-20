import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REASON_REMEDIATION, supervisorError, type BackendCallbacks, type BackendRunHandle, type BackendStartResult, type StartRunInput, type SupervisorBackend, type SupervisorConfig, type SupervisorError } from "../../src/contracts.js";
import { loadConfig } from "../../src/config/config.js";
import { selectedConfigPolicy } from "../../src/config/policy.js";
import { RunManager } from "../../src/core/run-manager.js";
import { authorizedEditStart, authorizedReviewStart } from "../support/authorized-start.js";

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const managers: RunManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class ScriptedBackend implements SupervisorBackend {
  readonly kind = "app-server" as const;
  readonly runs = new Map<string, { input: StartRunInput; callbacks: BackendCallbacks }>();
  startError: SupervisorError | undefined;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    if (this.startError) throw this.startError;
    this.runs.set(input.runId, { input, callbacks });
    callbacks.onPromptSent?.();
    return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: "running" };
  }
  async cancel(handle: BackendRunHandle) { await this.runs.get(handle.runId)?.callbacks.onState("cancelled"); }
  async close() {}
}

type Status = Record<string, unknown> & { state: string; next_action: string; error?: SupervisorError; task_authorize?: { argv: string[] } };
type Readiness = Record<string, unknown> & { eligible: boolean; blockers: unknown[]; warnings?: string[] };

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) { await new Promise((resolve) => setTimeout(resolve, 20)); value = await read(); }
  return value;
}

async function box(options: { progressSeconds?: number } = {}) {
  const root = await mkdtemp(path.join(canonicalTmp, "vsup-failure-guidance-")); roots.push(root);
  const workspace = path.join(root, "workspace"); await mkdir(workspace);
  await writeFile(path.join(workspace, "a.txt"), "one\n");
  for (const args of [["init", "-q"], ["add", "a.txt"], ["commit", "-qm", "init"]]) await exec("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: workspace });
  const state = path.join(root, "state"); await mkdir(state, { mode: 0o700 });
  const configPath = path.join(state, "config.toml");
  await writeFile(configPath, `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\npaths = { vibe_pin_manifest = "/unused/vibe-pin-manifest.json" }\n`, { mode: 0o600 });
  const loaded = await loadConfig({ configPath });
  const backend = new ScriptedBackend();
  const withPolicy = options.progressSeconds === undefined;
  const config: SupervisorConfig = withPolicy ? loaded : { ...loaded, limits: { ...loaded.limits, workerProgressTimeoutSeconds: options.progressSeconds! } };
  const manager = new RunManager(config, path.join(root, "data"), [backend], undefined, withPolicy ? { policy: selectedConfigPolicy(configPath) } : undefined);
  managers.push(manager);
  await manager.initialize();
  const callbacksOf = async (runId: string) => (await waitFor(async () => backend.runs.get(runId), (run) => run !== undefined))!;
  const settled = (runId: string) => waitFor(() => manager.status({ run_id: runId }) as Promise<Status>, (status) => !["starting", "running"].includes(status.state));
  const readiness = () => manager.status({ workspace, operation: "review" }) as Promise<Readiness>;
  return { workspace, configPath, data: path.join(root, "data"), backend, manager, callbacksOf, settled, readiness };
}

async function failReview(context: Awaited<ReturnType<typeof box>>, error: SupervisorError, answer = false): Promise<Status> {
  const started = await authorizedReviewStart(context.manager, { task: "Review a.txt.", cwd: context.workspace });
  const { callbacks } = await context.callbacksOf(started.run_id);
  if (answer) await callbacks.onEvent(MODEL_OUTPUT);
  await callbacks.onState("failed", { error });
  return context.settled(started.run_id);
}

const MODEL_OUTPUT = { source: "supervisor", type: "diagnostic", severity: "info", data: { reason: "model_output", text: "The model is producing output." } } as const;

const refusal = () => supervisorError("VSUP_BACKEND_ERROR", "The model provider refused the request.", { reason: "provider_refused", model: "mistral-medium-3.5", message: `The model provider refused this request: not in your subscription tier. ${"x".repeat(1000)}` }, false, REASON_REMEDIATION.provider_refused);

describe("a failed run whose task reached the worker", () => {
  it("says the grant is spent and a new attempt is a full rerun, without an authorize command when the error is not retryable", async () => {
    const context = await box();
    const status = await failReview(context, supervisorError("VSUP_BACKEND_ERROR", "No credit.", { reason: "provider_usage_limit" }, false, REASON_REMEDIATION.provider_usage_limit));
    expect(status.state).toBe("failed");
    expect(status.next_action).toMatch(/grant is spent.*new task authorize and a full rerun from the base/);
    expect(status.next_action).toContain("error.retryable is false");
    expect(status.next_action).not.toContain("diff.patch");
    expect(status.task_authorize).toBeUndefined();
    expect(status.error?.remediation).toBe(REASON_REMEDIATION.provider_usage_limit);
  });

  it("attaches the authorize command when the error is retryable", async () => {
    const context = await box();
    const status = await failReview(context, supervisorError("VSUP_BACKEND_ERROR", "Sign-in unavailable.", { reason: "credential_unavailable" }, true, REASON_REMEDIATION.credential_unavailable));
    expect(status.next_action).toMatch(/grant is spent.*error\.retryable is true.*task_authorize/);
    expect(status.task_authorize?.argv.slice(-2)).toEqual(["--config", context.configPath]);
    const full = await context.manager.result({ run_id: String(status.run_id), detail: "full" }) as Status;
    expect(full.next_action).toBe(status.next_action);
    expect(full.task_authorize?.argv.at(-1)).toBe(context.configPath);
  });

  it("points an edit at the preserved diff.patch when the worker changed files", async () => {
    const context = await box();
    const started = await authorizedEditStart(context.manager, { task: "Change a.txt.", cwd: context.workspace });
    const { input, callbacks } = await context.callbacksOf(started.run_id);
    await writeFile(path.join(input.workerWorkspace, "a.txt"), "two\n");
    await callbacks.onState("failed", { error: supervisorError("VSUP_BACKEND_ERROR", "Stream broke.") });
    const status = await context.settled(started.run_id);
    expect(status.state).toBe("failed");
    expect(status.next_action).toMatch(/grant is spent.*changed files are preserved in diff\.patch; inspect them before a new start/);
  });

  it("keeps a remedy of its own on a failure thrown by the backend at launch", async () => {
    const context = await box();
    context.backend.startError = supervisorError("VSUP_BACKEND_ERROR", "Vibe did not select the configured model.", { reason: "model_not_selected" }, false, REASON_REMEDIATION.model_not_selected);
    const started = await authorizedReviewStart(context.manager, { task: "Review a.txt.", cwd: context.workspace });
    const status = await context.settled(started.run_id);
    expect(status.error).toMatchObject({ code: "VSUP_BACKEND_ERROR", remediation: REASON_REMEDIATION.model_not_selected, details: { reason: "model_not_selected", launch_failed: true } });
    expect(status.next_action).toMatch(/never sent to the worker/);
  });

  it("does not claim the task reached the worker for a run recovered after a restart while it was starting", async () => {
    const context = await box();
    const started = await authorizedReviewStart(context.manager, { task: "Review a.txt.", cwd: context.workspace });
    await context.callbacksOf(started.run_id);
    const meta = path.join(context.data, "runs", started.run_id, "meta.json");
    const wire = JSON.parse(await readFile(meta, "utf8")) as Record<string, unknown>;
    await context.manager.shutdown();
    await writeFile(meta, JSON.stringify({ ...wire, state: "starting" }), { mode: 0o600 });
    const restarted = new RunManager(await loadConfig({ configPath: context.configPath }), context.data, [new ScriptedBackend()], undefined, { policy: selectedConfigPolicy(context.configPath) });
    managers.push(restarted);
    await restarted.initialize();
    const status = await restarted.status({ run_id: started.run_id }) as Status;
    expect(status).toMatchObject({ state: "failed", error: { code: "VSUP_BACKEND_CRASHED" } });
    expect(status.next_action).not.toMatch(/reached the worker|grant is spent/);
  });
});

describe("a run that ends while the provider is failing", () => {
  it("reports no progress after a retry notice as provider_retrying, keeping the code", async () => {
    const context = await box({ progressSeconds: 1 });
    const started = await authorizedReviewStart(context.manager, { task: "Review a.txt.", cwd: context.workspace });
    const { callbacks } = await context.callbacksOf(started.run_id);
    await callbacks.onEvent({ source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "turn_retrying", category: "rate_limited", detail: "Rate limited." } });
    const status = await context.settled(started.run_id);
    expect(status.error).toMatchObject({ code: "VSUP_NO_PROGRESS", retryable: true, remediation: REASON_REMEDIATION.provider_retrying, details: { reason: "provider_retrying", retry_category: "rate_limited", retry_detail: "Rate limited." } });
    expect(status.error?.message).toContain("while the model provider was failing");
  });

  it("reports a deadline after a retry notice as provider_retrying, with a remedy that does not say to raise the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    try {
      const context = await box({ progressSeconds: 0 });
      const started = await authorizedReviewStart(context.manager, { task: "Review a.txt.", cwd: context.workspace, timeout_seconds: 30 });
      const { callbacks } = await context.callbacksOf(started.run_id);
      await callbacks.onEvent({ source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "turn_retrying", category: "connection", detail: "Connection reset." } });
      await vi.advanceTimersByTimeAsync(31_000);
      const status = await context.settled(started.run_id);
      expect(status.error).toMatchObject({ code: "VSUP_TIMEOUT", retryable: true, remediation: REASON_REMEDIATION.provider_retrying, details: { reason: "provider_retrying", retry_category: "connection" } });
      expect(status.error?.message).toMatch(/reached its timeout while the model provider was failing/);
    } finally { vi.useRealTimers(); }
  }, 30_000);

  it("does not blame the provider once the model answered after the notice", async () => {
    const context = await box({ progressSeconds: 1 });
    const started = await authorizedReviewStart(context.manager, { task: "Review a.txt.", cwd: context.workspace });
    const { callbacks } = await context.callbacksOf(started.run_id);
    await callbacks.onEvent({ source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "turn_retrying", category: "server_error" } });
    await callbacks.onEvent(MODEL_OUTPUT);
    const status = await context.settled(started.run_id);
    expect(status.error?.code).toBe("VSUP_NO_PROGRESS");
    expect(status.error?.details?.reason).toBeUndefined();
  });
});

describe("an edit whose turn the provider failed after audited writes", () => {
  const contract = { schema_version: 1, allowed_changed_paths: ["a.txt"], required_changed_paths: ["a.txt"], checks: [{ id: "two", kind: "text_contains", path: "a.txt", value: "two" }] };

  it.each([
    ["passes", "two\n", "passed"],
    ["fails", "three\n", "failed"]
  ] as const)("runs verification on the patch, which %s, and points a failed check at a correction", async (_name, content, expected) => {
    const context = await box();
    const started = await authorizedEditStart(context.manager, { task: "Change a.txt.", cwd: context.workspace, acceptance_contract: contract });
    const { input, callbacks } = await context.callbacksOf(started.run_id);
    await writeFile(path.join(input.workerWorkspace, "a.txt"), content);
    await callbacks.onEvent({ source: "supervisor", type: "diagnostic", severity: "warning", data: { reason: "turn_retrying", category: "server_error", detail: "Upstream stalled." } });
    await callbacks.onEvent({ source: "vibe", type: "message", severity: "info", data: { text: "late" } });
    await callbacks.onState("completed", { result: { stopReason: "provider_error", summary: "", warnings: ["The model provider failed the turn after the edit's writes (error code backend_error)."] } });
    const status = await context.settled(started.run_id);
    expect(status.state).toBe("completed");
    expect(status.next_action).toMatch(/provider failed the turn after the worker's audited writes.*acceptance contract.*correction that continues from this patch/);
    const result = await context.manager.result({ run_id: started.run_id }) as Status & { stop_reason?: string; verification?: { status: string }; warnings?: string[] };
    expect(result.stop_reason).toBe("provider_error");
    expect(result.verification).toMatchObject({ status: expected });
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("error code backend_error"), expect.stringContaining("(server_error)")]));
  });

  it("adds no retry warning when no retry notice was seen", async () => {
    const context = await box();
    const started = await authorizedEditStart(context.manager, { task: "Change a.txt.", cwd: context.workspace, acceptance_contract: contract });
    const { input, callbacks } = await context.callbacksOf(started.run_id);
    await writeFile(path.join(input.workerWorkspace, "a.txt"), "two\n");
    await callbacks.onState("completed", { result: { stopReason: "provider_error", summary: "" } });
    await context.settled(started.run_id);
    const result = await context.manager.result({ run_id: started.run_id }) as Status & { warnings?: string[] };
    expect(result.warnings ?? []).not.toEqual(expect.arrayContaining([expect.stringContaining("Vibe retried the turn")]));
  });
});

describe("a provider refusal seen by an earlier run", () => {
  it("warns at readiness without blocking, until a later run on the model gets a model answer", async () => {
    const context = await box();
    const before = await context.readiness();
    expect(before.eligible, JSON.stringify(before.blockers)).toBe(true);
    expect(before.warnings ?? []).not.toEqual(expect.arrayContaining([expect.stringContaining("provider_refused")]));

    await failReview(context, refusal());
    const warned = await context.readiness();
    expect(warned.eligible).toBe(true);
    expect(warned.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^provider_refused: .*mistral-medium-3\.5.*not in your subscription tier/)]));
    expect(warned.warnings!.find((warning) => warning.startsWith("provider_refused"))!.length).toBeLessThan(700);

    await failReview(context, supervisorError("VSUP_BACKEND_ERROR", "Stream broke."));
    expect((await context.readiness()).warnings).toEqual(expect.arrayContaining([expect.stringContaining("provider_refused")]));

    await failReview(context, supervisorError("VSUP_BACKEND_ERROR", "Stream broke after an answer."), true);
    expect((await context.readiness()).warnings ?? []).not.toEqual(expect.arrayContaining([expect.stringContaining("provider_refused")]));
  });
});
