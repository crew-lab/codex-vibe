import { authorizedEditStart, authorizedReviewStart } from "../support/authorized-start.js";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from "../../src/contracts.js";
import { loadConfig } from "../../src/config/config.js";
import { selectedConfigPolicy } from "../../src/config/policy.js";
import { prepareIsolatedHome } from "../../src/config/isolated-home.js";
import { RunManager } from "../../src/core/run-manager.js";
import { createIsolatedRunRouter } from "../../src/core/isolated-run-router.js";
import { RECEIPT_TTL_MS } from "../../src/core/readiness-receipt.js";
import { toolSchemas } from "../../src/mcp/schemas.js";
import { APP_VERSION } from "../../src/version.js";
import { overrideGitBounds } from "../../src/git/worktree.js";

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const scratch: string[] = [];
const managers: RunManager[] = [];
const savedPath = process.env.PATH;
let restoreBounds: (() => void) | undefined;

afterEach(async () => {
  vi.useRealTimers();
  process.env.PATH = savedPath;
  restoreBounds?.(); restoreBounds = undefined;
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown().catch(() => undefined)));
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

class FakeBackend implements SupervisorBackend {
  readonly kind = "app-server" as const;
  starts = 0;
  callbacks: BackendCallbacks | undefined;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.starts += 1;
    this.callbacks = callbacks;
    const handle: BackendRunHandle = { runId: input.runId, backend: this.kind, opaque: {} };
    return { handle, initialState: "running" };
  }
  async cancel() {}
  async close() {}
}

function toml(roots: string[], extra = "", pathsExtra = ""): string {
  return `version = 1\nallowed_workspace_roots = ${JSON.stringify(roots)}\npaths = { vibe_pin_manifest = "/unused/vibe-pin-manifest.json"${pathsExtra} }\n${extra}`;
}

async function replaceConfig(file: string, text: string): Promise<void> {
  const temporary = `${file}.next`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, file);
}

async function git(cwd: string, args: string[]): Promise<void> {
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd });
}

async function repository(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "a.txt"), "one\n");
  await git(directory, ["init", "-q"]);
  await git(directory, ["add", "a.txt"]);
  await git(directory, ["commit", "-qm", "init"]);
}

async function sandbox(initialRoots: (box: { alpha: string; beta: string }) => string[] = ({ alpha }) => [alpha]) {
  const parent = await mkdtemp(path.join(canonicalTmp, "vsup-policy-")); scratch.push(parent);
  const alpha = path.join(parent, "alpha"); const beta = path.join(parent, "beta");
  await repository(alpha); await repository(beta);
  const settings = path.join(parent, "settings"); await mkdir(settings, { mode: 0o700 });
  const configPath = path.join(settings, "config.toml");
  await writeFile(configPath, toml(initialRoots({ alpha, beta })), { mode: 0o600 });
  return { parent, alpha, beta, settings, configPath };
}

async function connect(configPath: string, dataDir: string, options: { sessionId?: string } = {}) {
  const backend = new FakeBackend();
  const manager = new RunManager(await loadConfig({ configPath }), dataDir, [backend], undefined, { policy: selectedConfigPolicy(configPath), ...options });
  managers.push(manager);
  await manager.initialize();
  return { manager, backend };
}

type Readiness = Record<string, unknown> & { eligible: boolean; blockers: { code: string; message: string; remediation: string; retryable: boolean; details?: Record<string, unknown> }[]; readiness_receipt?: string; policy_revision: string | null };

async function readiness(manager: RunManager, workspace: string, operation: "review" | "edit" = "review", baseRef?: string): Promise<Readiness> {
  return await manager.status({ workspace, operation, ...(baseRef ? { base_ref: baseRef } : {}) }) as Readiness;
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: string; details?: { reason?: string }; message?: string }> {
  try { await promise; }
  catch (error) { return error as { code?: string; details?: { reason?: string } }; }
  throw new Error("expected a rejection");
}

async function waitForState(manager: RunManager, runId: string, state: string): Promise<void> {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const current = await manager.status({ run_id: runId });
    if (current.state === state) return;
    if (current.state === "failed" && state === "running") throw new Error(JSON.stringify(current));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run never reached ${state}`);
}

async function runDirectories(dataDir: string): Promise<string[]> {
  return readdir(path.join(dataDir, "runs")).catch(() => []);
}

describe("authoritative policy source", () => {
  it("sees a root approved after connect in the same manager's readiness and start without restart", async () => {
    const box = await sandbox();
    const { manager, backend } = await connect(box.configPath, path.join(box.parent, "data"));
    const before = await readiness(manager, box.beta);
    expect(before.eligible).toBe(false);
    expect(before.blockers.map((blocker) => blocker.code)).toEqual(["VSUP_WORKSPACE_INVALID"]);
    expect(before.readiness_receipt).toBeUndefined();

    await replaceConfig(box.configPath, toml([box.alpha, box.beta]));
    const after = await readiness(manager, box.beta);
    expect(after).toMatchObject({ eligible: true, blockers: [], workspace: box.beta, restart_required: false, policy_path: box.configPath });
    expect(after.policy_revision).not.toBe(before.policy_revision);

    const started = await authorizedReviewStart(manager, { task: "review", cwd: box.beta, readiness_receipt: after.readiness_receipt! });
    expect(started.policy_revision).toBe(after.policy_revision);
    await waitForState(manager, started.run_id, "running");
    expect(backend.starts).toBe(1);
    const saved = JSON.parse(await readFile(path.join(box.parent, "data", "runs", started.run_id, "meta.json"), "utf8")) as Record<string, unknown>;
    expect(saved.policy_revision).toBe(after.policy_revision);
  });

  it("denies readiness and start for a removed root without creating a run or launching", async () => {
    const box = await sandbox(({ alpha, beta }) => [alpha, beta]);
    const dataDir = path.join(box.parent, "data");
    const { manager, backend } = await connect(box.configPath, dataDir);
    expect((await readiness(manager, box.beta)).eligible).toBe(true);
    await replaceConfig(box.configPath, toml([box.alpha]));
    const denied = await readiness(manager, box.beta);
    expect(denied.eligible).toBe(false);
    expect(denied.blockers[0]?.code).toBe("VSUP_WORKSPACE_INVALID");
    expect((await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.beta }))).code).toBe("VSUP_WORKSPACE_INVALID");
    expect((await rejection(authorizedEditStart(manager, { task: "edit", cwd: box.beta }))).code).toBe("VSUP_WORKSPACE_INVALID");
    expect(backend.starts).toBe(0);
    expect(await runDirectories(dataDir)).toEqual([]);
  });

  it.each([
    ["malformed", async (file: string) => { await replaceConfig(file, "version = 1\nallowed_workspace_roots = [\n"); }, /could not be reread/],
    ["missing", async (file: string) => { await rm(file); }, /not found|ENOENT/],
    ["oversized", async (file: string) => { await replaceConfig(file, `${toml([])}#${"x".repeat(1_048_576)}\n`); }, /1 MiB/],
    ["group-writable", async (file: string) => { await chmod(file, 0o620); }, /group or others/],
    ["symlinked", async (file: string) => { const target = `${file}.real`; await writeFile(target, await readFile(file), { mode: 0o600 }); await rm(file); await symlink(target, file); }, /ELOOP|symbolic/i],
    ["unsupported field", async (file: string) => { await replaceConfig(file, `${toml([])}allow_shell = true\n`); }, /unsupported|Unrecognized/i]
  ])("fails closed on a %s source with an actionable reason and no stale fallback", async (_name, damage, reason) => {
    const box = await sandbox();
    const dataDir = path.join(box.parent, "data");
    const { manager, backend } = await connect(box.configPath, dataDir);
    expect((await readiness(manager, box.alpha)).eligible).toBe(true);
    await damage(box.configPath);
    const blocked = await readiness(manager, box.alpha);
    expect(blocked).toMatchObject({ eligible: false, policy_revision: null, workspace: null });
    expect(blocked.blockers[0]?.code).toBe("VSUP_CONFIG_INVALID");
    expect(blocked.blockers[0]?.message).toContain(box.configPath);
    expect(blocked.blockers[0]?.message).toMatch(reason);
    const refused = await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.alpha }));
    expect(refused.code).toBe("VSUP_CONFIG_INVALID");
    expect(backend.starts).toBe(0);
    expect(await runDirectories(dataDir)).toEqual([]);
  });

  it("lets two isolated sessions on one template see the same new revision while keeping their own storage", async () => {
    const box = await sandbox();
    const prepared = await Promise.all([prepareIsolatedHome({}, () => undefined, box.configPath), prepareIsolatedHome({}, () => undefined, box.configPath)]);
    const snapshot = await readFile(path.join(prepared[0]!.home, "config.toml"), "utf8");
    const sessions = [];
    for (const entry of prepared) {
      const backend = new FakeBackend();
      const manager = new RunManager(await loadConfig({ configPath: box.configPath }), entry.home, [backend], entry.lock, { policy: selectedConfigPolicy(box.configPath), sessionId: path.basename(entry.home) });
      managers.push(manager); await manager.initialize();
      sessions.push(manager);
    }
    await replaceConfig(box.configPath, toml([box.alpha, box.beta]));
    const reports = await Promise.all(sessions.map((manager) => readiness(manager, box.beta)));
    expect(reports.map((report) => report.eligible)).toEqual([true, true]);
    expect(reports[0]!.policy_revision).toBe(reports[1]!.policy_revision);
    expect(reports[0]!.session_id).not.toBe(reports[1]!.session_id);
    expect(reports[0]!.server_instance_id).not.toBe(reports[1]!.server_instance_id);
    expect(reports.map((report) => report.policy_path)).toEqual([box.configPath, box.configPath]);
    expect(await readFile(path.join(prepared[0]!.home, "config.toml"), "utf8")).toBe(snapshot);
  });

  it.each([
    ["limits.max_turns_review", `[limits]\nmax_turns_review = 7\n`, ""],
    ["paths.vibe", "", `, vibe = "/opt/other/vibe"`],
    ["paths.app_server", "", `, app_server = "/opt/other/vibe-app-server"`],
    ["retention.days", `[retention]\ndays = 2\n`, ""]
  ])("reports restart_required for a %s change and refuses starts instead of adopting it", async (key, extra, pathsExtra) => {
    const box = await sandbox();
    const dataDir = path.join(box.parent, "data");
    const { manager, backend } = await connect(box.configPath, dataDir);
    await replaceConfig(box.configPath, toml([box.alpha, box.beta], extra, pathsExtra));
    const report = await readiness(manager, box.beta);
    expect(report).toMatchObject({ eligible: false, restart_required: true, boot_drift: [key] });
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(["VSUP_RESTART_REQUIRED"]);
    expect(report.blockers[0]).toMatchObject({ retryable: false, details: { boot_drift: [key] } });
    const refused = await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.beta }));
    expect(refused.code).toBe("VSUP_RESTART_REQUIRED");
    expect(backend.starts).toBe(0);
    expect(await runDirectories(dataDir)).toEqual([]);
  });
});

describe("preparation deadline", () => {
  it("blocks readiness with VSUP_PREPARATION_TIMEOUT, not an invalid run state", async () => {
    const box = await sandbox();
    const backend = new FakeBackend();
    const inner = selectedConfigPolicy(box.configPath);
    const policy = { configPath: inner.configPath, read: async () => { const config = await inner.read(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 60_000); return config; } };
    const manager = new RunManager(await loadConfig({ configPath: box.configPath }), path.join(box.parent, "data"), [backend], undefined, { policy });
    managers.push(manager);
    await manager.initialize();
    const report = await readiness(manager, box.alpha);
    expect(report.eligible).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(["VSUP_PREPARATION_TIMEOUT"]);
    expect(report.blockers[0]!.remediation).not.toMatch(/run status/i);
  });
});

describe("unavailable allowed roots", () => {
  it("denies only a deleted root while readiness, start and cleanup in the other root keep working", async () => {
    const box = await sandbox(({ alpha, beta }) => [alpha, beta]);
    const dataDir = path.join(box.parent, "data");
    const { manager, backend } = await connect(box.configPath, dataDir);
    const started = await authorizedEditStart(manager, { task: "edit", cwd: box.alpha });
    await waitForState(manager, started.run_id, "running");
    await backend.callbacks!.onState("completed", { result: { summary: "done" } });
    await waitForState(manager, started.run_id, "completed");
    const revision = (await readiness(manager, box.alpha)).policy_revision;

    await rm(box.beta, { recursive: true, force: true });
    await expect(loadConfig({ configPath: box.configPath })).resolves.toMatchObject({ allowedWorkspaceRoots: [box.alpha, box.beta] });
    const alive = await readiness(manager, box.alpha, "edit");
    expect(alive).toMatchObject({ eligible: true, blockers: [], policy_revision: revision });
    const lost = await readiness(manager, box.beta);
    expect(lost.eligible).toBe(false);
    expect(lost.blockers).toEqual([expect.objectContaining({ code: "VSUP_WORKSPACE_INVALID", message: expect.stringContaining(`allowed root ${box.beta}`), details: { unavailable_root: box.beta }, retryable: false })]);
    expect(await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.beta }))).toMatchObject({ code: "VSUP_WORKSPACE_INVALID", details: { unavailable_root: box.beta } });
    expect(await manager.close({ run_id: started.run_id, cleanup_worktree: true })).toMatchObject({ worktree_removed: true });
    const next = await authorizedReviewStart(manager, { task: "review", cwd: box.alpha, readiness_receipt: (await readiness(manager, box.alpha)).readiness_receipt! });
    await waitForState(manager, next.run_id, "running");
    expect(backend.starts).toBe(2);
  });

  it("boots with an unavailable root and keeps the rest of the policy", async () => {
    const box = await sandbox(({ alpha, beta }) => [alpha, beta]);
    await rm(box.beta, { recursive: true, force: true });
    const { manager } = await connect(box.configPath, path.join(box.parent, "data"));
    expect((await readiness(manager, box.alpha)).eligible).toBe(true);
    expect((await readiness(manager, box.beta)).blockers[0]?.message).toContain("unavailable");
  });
});

describe("workspace readiness on the connection", () => {
  it("reports the serving process separately from run records and creates nothing", async () => {
    const box = await sandbox();
    const dataDir = path.join(box.parent, "data");
    const { manager, backend } = await connect(box.configPath, dataDir, { sessionId: "session-abc123" });
    const report = await readiness(manager, box.alpha, "edit");
    expect(report).toMatchObject({
      server_version: APP_VERSION, session_id: "session-abc123", policy_path: box.configPath, restart_required: false, boot_drift: [],
      operation: "edit", requested_workspace: box.alpha, workspace: box.alpha, base_ref: "HEAD", eligible: true, blockers: [],
      active_slot: { busy: false }, runtime: { status: "not_reported" }
    });
    expect(report.base_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(report.server_instance_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(report.policy_revision).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(String(report.receipt_expires_at)) - Date.now()).toBeLessThanOrEqual(RECEIPT_TTL_MS);
    expect(report).not.toHaveProperty("supervisor_version");
    expect(report).not.toHaveProperty("run_id");
    expect(backend.starts).toBe(0);
    expect(await runDirectories(dataDir)).toEqual([]);
    expect(await readdir(dataDir)).not.toContain("worktrees");
  });

  it("blocks an edit check whose base_ref does not resolve", async () => {
    const box = await sandbox();
    const { manager } = await connect(box.configPath, path.join(box.parent, "data"));
    const report = await readiness(manager, box.alpha, "edit", "no-such-ref");
    expect(report.eligible).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(["VSUP_WORKTREE_CREATE_FAILED"]);
  });

  it("keeps a missing git binary and a Git timeout distinct from an unresolved base_ref", async () => {
    const box = await sandbox();
    const { manager } = await connect(box.configPath, path.join(box.parent, "data"));
    const noGit = path.join(box.parent, "no-git-bin"); await mkdir(noGit);
    process.env.PATH = noGit;
    const missing = await readiness(manager, box.alpha, "edit");
    process.env.PATH = savedPath;
    expect(missing.blockers).toEqual([expect.objectContaining({ code: "VSUP_GIT_REQUIRED", details: expect.objectContaining({ kind: "missing" }) })]);
    const slowBin = path.join(box.parent, "slow-git-bin"); await mkdir(slowBin);
    const realGit = (await exec("sh", ["-c", "command -v git"])).stdout.trim();
    await writeFile(path.join(slowBin, "git"), `#!/bin/sh\ncase " $* " in *" --verify "*) sleep 3;; esac\nexec ${realGit} "$@"\n`, { mode: 0o755 });
    process.env.PATH = `${slowBin}:${savedPath}`;
    restoreBounds = overrideGitBounds({ queryRuntimeMs: 500 });
    const slow = await readiness(manager, box.alpha, "edit");
    expect(slow.blockers).toEqual([expect.objectContaining({ code: "VSUP_TIMEOUT", details: expect.objectContaining({ kind: "timeout" }) })]);
  }, 30_000);

  it("requires exactly one of run_id or an absolute workspace with an operation", () => {
    const runId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(() => toolSchemas.vibe_status.parse({})).toThrow();
    expect(() => toolSchemas.vibe_status.parse({ run_id: runId, workspace: "/repo", operation: "review" })).toThrow();
    expect(() => toolSchemas.vibe_status.parse({ workspace: "relative", operation: "review" })).toThrow();
    expect(() => toolSchemas.vibe_status.parse({ workspace: "/repo" })).toThrow();
    expect(() => toolSchemas.vibe_status.parse({ workspace: "/repo", operation: "review", base_ref: "HEAD" })).toThrow();
    expect(() => toolSchemas.vibe_status.parse({ run_id: runId, operation: "review" })).toThrow();
    expect(toolSchemas.vibe_status.parse({ run_id: runId })).toMatchObject({ run_id: runId, after_seq: 0, max_events: 10, wait_seconds: 0 });
    expect(toolSchemas.vibe_status.parse({ workspace: "/repo", operation: "edit", base_ref: "main" })).toMatchObject({ workspace: "/repo", operation: "edit", base_ref: "main" });
  });

  it("routes a workspace check to the local manager through the isolated router", async () => {
    const calls: unknown[] = [];
    const local = {
      reviewStart: async () => ({}), editStart: async () => ({}), result: async () => ({}), close: async () => ({}),
      status: async (input: unknown) => { calls.push(input); return { eligible: true }; },
      initialize: async () => undefined, shutdown: async () => ({ timedOut: false })
    };
    const parent = await mkdtemp(path.join(canonicalTmp, "vsup-router-")); scratch.push(parent);
    const router = createIsolatedRunRouter(local, { sessions: path.join(parent, "sessions"), currentHome: path.join(parent, "sessions", "session-aaaaaa"), config: await loadConfig({ env: { VIBE_SUPERVISOR_HOME: parent } }) });
    expect(await router.status({ workspace: "/repo", operation: "review" })).toEqual({ eligible: true });
    expect(calls).toEqual([{ workspace: "/repo", operation: "review" }]);
    await router.shutdown();
    await expect(router.status({ workspace: "/repo", operation: "review" })).rejects.toMatchObject({ code: "VSUP_INVALID_STATE" });
  });
});

describe("readiness receipts", () => {
  it("rejects an altered receipt before launch", async () => {
    const box = await sandbox();
    const { manager, backend } = await connect(box.configPath, path.join(box.parent, "data"));
    const receipt = (await readiness(manager, box.alpha)).readiness_receipt!;
    const tampered = `${receipt.slice(0, -2)}${receipt.endsWith("AA") ? "BB" : "AA"}`;
    const refused = await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.alpha, readiness_receipt: tampered }));
    expect(refused).toMatchObject({ code: "VSUP_READINESS_RECEIPT_INVALID", details: { reason: "signature" } });
    const garbage = await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.alpha, readiness_receipt: "not-a-receipt" }));
    expect(garbage).toMatchObject({ code: "VSUP_READINESS_RECEIPT_INVALID", details: { reason: "malformed" } });
    expect(backend.starts).toBe(0);
  });

  it("rejects an expired receipt", async () => {
    const box = await sandbox();
    const { manager, backend } = await connect(box.configPath, path.join(box.parent, "data"));
    const receipt = (await readiness(manager, box.alpha)).readiness_receipt!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + RECEIPT_TTL_MS + 1000);
    const refused = await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.alpha, readiness_receipt: receipt }));
    expect(refused).toMatchObject({ code: "VSUP_READINESS_RECEIPT_INVALID", details: { reason: "expired" } });
    expect(backend.starts).toBe(0);
  });

  it("rejects a receipt issued by another server instance", async () => {
    const box = await sandbox();
    const first = await connect(box.configPath, path.join(box.parent, "data-one"));
    const second = await connect(box.configPath, path.join(box.parent, "data-two"));
    const receipt = (await readiness(first.manager, box.alpha)).readiness_receipt!;
    const refused = await rejection(authorizedReviewStart(second.manager, { task: "review", cwd: box.alpha, readiness_receipt: receipt }));
    expect(refused).toMatchObject({ code: "VSUP_READINESS_RECEIPT_INVALID", details: { reason: "instance" } });
    expect(second.backend.starts).toBe(0);
  });

  it("rejects a receipt after policy revision drift, even when the workspace stays allowed", async () => {
    const box = await sandbox();
    const dataDir = path.join(box.parent, "data");
    const { manager, backend } = await connect(box.configPath, dataDir);
    const receipt = (await readiness(manager, box.alpha)).readiness_receipt!;
    await replaceConfig(box.configPath, toml([box.alpha, box.beta]));
    const refused = await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.alpha, readiness_receipt: receipt }));
    expect(refused).toMatchObject({ code: "VSUP_READINESS_RECEIPT_INVALID", details: { reason: "revision" } });
    expect(backend.starts).toBe(0);
    expect(await runDirectories(dataDir)).toEqual([]);
  });

  it("rejects a receipt used for another operation, workspace or moved edit base", async () => {
    const box = await sandbox(({ alpha, beta }) => [alpha, beta]);
    const { manager, backend } = await connect(box.configPath, path.join(box.parent, "data"));
    const review = (await readiness(manager, box.alpha)).readiness_receipt!;
    expect(await rejection(authorizedEditStart(manager, { task: "edit", cwd: box.alpha, readiness_receipt: review }))).toMatchObject({ details: { reason: "operation" } });
    expect(await rejection(authorizedReviewStart(manager, { task: "review", cwd: box.beta, readiness_receipt: review }))).toMatchObject({ details: { reason: "workspace" } });
    const edit = (await readiness(manager, box.alpha, "edit")).readiness_receipt!;
    expect(await rejection(authorizedEditStart(manager, { task: "edit", cwd: box.alpha, base_ref: "HEAD~0", readiness_receipt: edit }))).toMatchObject({ details: { reason: "base_ref" } });
    await writeFile(path.join(box.alpha, "a.txt"), "two\n");
    await git(box.alpha, ["commit", "-qam", "move"]);
    expect(await rejection(authorizedEditStart(manager, { task: "edit", cwd: box.alpha, readiness_receipt: edit }))).toMatchObject({ code: "VSUP_READINESS_RECEIPT_INVALID", details: { reason: "base_commit" } });
    await git(box.alpha, ["branch", "doomed"]);
    const branch = (await readiness(manager, box.alpha, "edit", "doomed")).readiness_receipt!;
    const branchGrant = await manager.authorizeDispatch("edit", { task: "edit", cwd: box.alpha, base_ref: "doomed" }, "test-owner", new Date(Date.now() + 60000).toISOString());
    await git(box.alpha, ["branch", "-D", "doomed"]);
    const deleted = await rejection(manager.editStart({ task: "edit", cwd: box.alpha, base_ref: "doomed", readiness_receipt: branch, authorization_id: branchGrant.authorization_id, attempt_id: branchGrant.attempt_id }));
    expect(deleted).toMatchObject({ code: "VSUP_READINESS_RECEIPT_INVALID", details: { reason: "base_ref_unresolved" } });
    expect(deleted.message).toContain("no longer resolves");
    expect(backend.starts).toBe(0);
  });

  it("creates the edit worktree at the exact commit the receipt checked even if the ref moves", async () => {
    const box = await sandbox();
    const dataDir = path.join(box.parent, "data");
    const { manager } = await connect(box.configPath, dataDir);
    const ready = await readiness(manager, box.alpha, "edit");
    const started = await authorizedEditStart(manager, { task: "edit", cwd: box.alpha, readiness_receipt: ready.readiness_receipt! });
    expect(started).toMatchObject({ base_ref: "HEAD", base_commit: ready.base_commit });
    await writeFile(path.join(box.alpha, "a.txt"), "moved\n");
    await git(box.alpha, ["commit", "-qam", "move"]);
    await waitForState(manager, started.run_id, "running");
    const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: path.join(dataDir, "worktrees", started.run_id) })).stdout.trim();
    expect(head).toBe(ready.base_commit);
  });

  it("rejects a valid receipt when another start claimed the slot first", async () => {
    const box = await sandbox();
    const { manager, backend } = await connect(box.configPath, path.join(box.parent, "data"));
    const receipt = (await readiness(manager, box.alpha)).readiness_receipt!;
    const first = await authorizedReviewStart(manager, { task: "first", cwd: box.alpha });
    await waitForState(manager, first.run_id, "running");
    const busy = await readiness(manager, box.alpha);
    expect(busy).toMatchObject({ eligible: false, active_slot: { busy: true } });
    expect(busy.blockers.map((blocker) => blocker.code)).toEqual(["VSUP_LIMIT_EXCEEDED"]);
    expect(await rejection(authorizedReviewStart(manager, { task: "second", cwd: box.alpha, readiness_receipt: receipt }))).toMatchObject({ code: "VSUP_LIMIT_EXCEEDED" });
    expect(backend.starts).toBe(1);
  });
});

describe("policy changes during a live run", () => {
  it("leaves the live run unaffected, applies the new policy to the next admission and still cleans the verified worktree under its frozen admission", async () => {
    const box = await sandbox(({ alpha, beta }) => [alpha, beta]);
    const dataDir = path.join(box.parent, "data");
    const { manager, backend } = await connect(box.configPath, dataDir);
    const ready = await readiness(manager, box.beta, "edit");
    const started = await authorizedEditStart(manager, { task: "edit", cwd: box.beta, readiness_receipt: ready.readiness_receipt! });
    await waitForState(manager, started.run_id, "running");

    await replaceConfig(box.configPath, toml([box.alpha]));
    expect((await manager.status({ run_id: started.run_id })).state).toBe("running");
    await backend.callbacks!.onState("completed", { result: { summary: "done" } });
    await waitForState(manager, started.run_id, "completed");
    const finished = await manager.result({ run_id: started.run_id, detail: "full" });
    expect(finished).toMatchObject({ state: "completed", supervisor_version: APP_VERSION });
    const saved = JSON.parse(await readFile(path.join(dataDir, "runs", started.run_id, "meta.json"), "utf8")) as Record<string, unknown>;
    expect(saved.policy_revision).toBe(ready.policy_revision);

    expect((await readiness(manager, box.beta, "edit")).eligible).toBe(false);
    expect((await rejection(authorizedEditStart(manager, { task: "next", cwd: box.beta }))).code).toBe("VSUP_WORKSPACE_INVALID");
    const next = await readiness(manager, box.alpha);
    expect(next.eligible).toBe(true);
    expect(next.policy_revision).not.toBe(ready.policy_revision);

    expect(saved.admitted_root).toBe(box.beta);
    const closed = await manager.close({ run_id: started.run_id, cleanup_worktree: true });
    expect(closed).toMatchObject({ state: "closed", worktree_removed: true });
    expect(await readdir(path.join(dataDir, "worktrees"))).toEqual([]);
    expect(backend.starts).toBe(1);
  });

  it("still retains a dirty worktree after revocation because cleanup keeps its fresh export checks", async () => {
    const box = await sandbox(({ alpha, beta }) => [alpha, beta]);
    const dataDir = path.join(box.parent, "data");
    const { manager, backend } = await connect(box.configPath, dataDir);
    const started = await authorizedEditStart(manager, { task: "edit", cwd: box.beta });
    await waitForState(manager, started.run_id, "running");
    await backend.callbacks!.onState("completed", { result: { summary: "done" } });
    await waitForState(manager, started.run_id, "completed");
    await replaceConfig(box.configPath, toml([box.alpha]));
    await writeFile(path.join(dataDir, "worktrees", started.run_id, "late.txt"), "written after export\n");
    const closed = await manager.close({ run_id: started.run_id, cleanup_worktree: true });
    expect(closed).toMatchObject({ worktree_removed: false, worktree_retained_path: path.join(dataDir, "worktrees", started.run_id) });
  });
});
