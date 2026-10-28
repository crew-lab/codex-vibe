import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend } from "../../src/contracts.js";
import { loadConfig } from "../../src/config/config.js";
import { selectedConfigPolicy } from "../../src/config/policy.js";
import { GRANT_EXPIRY_MS, OWNER_REFERENCE_PLACEHOLDER, REQUEST_FILE_PLACEHOLDER, candidateEntrypoint, taskAuthorizeCommand } from "../../src/core/dispatch-command.js";
import { RunManager } from "../../src/core/run-manager.js";
import { dispatchRequestSchemas } from "../../src/mcp/schemas.js";

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "..", "..");
const canonicalTmp = await realpath(tmpdir());
const scratch: string[] = [];
const managers: RunManager[] = [];
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown().catch(() => undefined)));
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

class IdleBackend implements SupervisorBackend {
  readonly kind = "app-server" as const;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, _callbacks: BackendCallbacks): Promise<BackendStartResult> {
    const handle: BackendRunHandle = { runId: input.runId, backend: this.kind, opaque: {} };
    return { handle, initialState: "running" };
  }
  async cancel() {}
  async close() {}
}

async function repository(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "a.txt"), "one\n");
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "init", "-q"], { cwd: directory });
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "add", "a.txt"], { cwd: directory });
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "init"], { cwd: directory });
}

async function sandbox() {
  const parent = await mkdtemp(path.join(canonicalTmp, "vsup-task-authorize-")); scratch.push(parent);
  const alpha = path.join(parent, "alpha"); const beta = path.join(parent, "beta");
  await repository(alpha); await repository(beta);
  const settings = path.join(parent, "settings with space"); await mkdir(settings, { mode: 0o700 });
  const configPath = path.join(settings, "config.toml");
  await writeFile(configPath, `version = 1\nallowed_workspace_roots = [${JSON.stringify(alpha)}]\npaths = { vibe_pin_manifest = "/unused/vibe-pin-manifest.json" }\n`, { mode: 0o600 });
  const data = path.join(parent, "data"); await mkdir(data, { mode: 0o700 });
  return { alpha, beta, configPath, data };
}

type Readiness = Record<string, unknown> & { task_authorize: { argv: string[]; command: string; expires_at: string; request_template: { operation: string; request: Record<string, unknown> } } | null; readiness_receipt?: string };

async function connect(configPath: string, data: string): Promise<RunManager> {
  const manager = new RunManager(await loadConfig({ configPath }), data, [new IdleBackend()], undefined, { policy: selectedConfigPolicy(configPath) });
  managers.push(manager);
  await manager.initialize();
  return manager;
}

describe("readiness returns the task authorize command bound to this server", () => {
  it("names the server's Node executable, CLI entrypoint and selected configuration, with placeholders only for the private file and the owner reference", async () => {
    const box = await sandbox();
    const manager = await connect(box.configPath, box.data);
    const before = Date.now();
    const report = await manager.status({ workspace: box.alpha, operation: "review" }) as Readiness;
    const block = report.task_authorize!;
    expect(block.argv).toEqual([await realpath(process.execPath), path.join(repo, "dist", "cli.js"), "task", "authorize", "--request", REQUEST_FILE_PLACEHOLDER, "--owner-reference", OWNER_REFERENCE_PLACEHOLDER, "--expires-at", block.expires_at, "--config", box.configPath]);
    expect(block.argv[1]).toBe(candidateEntrypoint);
    const expiry = Date.parse(block.expires_at);
    expect(expiry).toBeGreaterThanOrEqual(before + GRANT_EXPIRY_MS);
    expect(expiry).toBeLessThanOrEqual(Date.now() + GRANT_EXPIRY_MS);
    expect(block.command).toContain(`--config '${box.configPath}'`);
    expect(block.command).toContain(`--request ${REQUEST_FILE_PLACEHOLDER} --owner-reference ${OWNER_REFERENCE_PLACEHOLDER} --expires-at ${block.expires_at}`);
    expect(block.command.startsWith(block.argv[0]!.includes(" ") ? "'" : block.argv[0]!)).toBe(true);
    expect(block.request_template).toEqual({ operation: "review", request: { cwd: box.alpha, context_files: [] } });
    expect(report.next_action).toContain("task_authorize");
  });

  it("templates validate against the dispatch request schemas once the task is added, for review and for edit", async () => {
    const box = await sandbox();
    const manager = await connect(box.configPath, box.data);
    const review = (await manager.status({ workspace: box.alpha, operation: "review" }) as Readiness).task_authorize!;
    expect(() => dispatchRequestSchemas.review.parse(review.request_template.request)).toThrow();
    expect(dispatchRequestSchemas.review.parse({ ...review.request_template.request, task: "Read only a.txt." })).toMatchObject({ cwd: box.alpha, context_files: [], output: "text" });
    const edit = (await manager.status({ workspace: box.alpha, operation: "edit", base_ref: "HEAD" }) as Readiness).task_authorize!;
    expect(edit.request_template).toEqual({ operation: "edit", request: { cwd: box.alpha, base_ref: "HEAD" } });
    expect(dispatchRequestSchemas.edit.parse({ ...edit.request_template.request, task: "Change a.txt." })).toMatchObject({ cwd: box.alpha, base_ref: "HEAD" });
    const defaulted = (await manager.status({ workspace: box.alpha, operation: "edit" }) as Readiness).task_authorize!;
    expect(defaulted.request_template.request.base_ref).toBe("HEAD");
  });

  it("carries no receipt, grant identifier or credential, and still describes the command for a workspace that is not admitted", async () => {
    const box = await sandbox();
    const secretParts = ["readiness", "decoy", String(Date.now())];
    const previous = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_API_KEY = secretParts.join("-");
    try {
      const manager = await connect(box.configPath, box.data);
      const admitted = await manager.status({ workspace: box.alpha, operation: "review" }) as Readiness;
      expect(admitted.readiness_receipt).toEqual(expect.any(String));
      const serialized = JSON.stringify(admitted.task_authorize);
      expect(serialized).not.toContain(admitted.readiness_receipt!);
      expect(serialized).not.toMatch(uuid);
      expect(serialized).not.toContain(secretParts.join("-"));
      expect(serialized).not.toContain("MISTRAL");
      const refused = await manager.status({ workspace: box.beta, operation: "review" }) as Readiness;
      expect(refused.workspace).toBeNull();
      expect(refused.task_authorize!.request_template.request.cwd).toBe(box.beta);
      expect(refused.task_authorize!.argv.slice(0, 4)).toEqual(admitted.task_authorize!.argv.slice(0, 4));
    } finally {
      if (previous === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = previous;
    }
  });

  it("is null when the manager has no selected configuration file to name", async () => {
    const box = await sandbox();
    const manager = new RunManager(await loadConfig({ configPath: box.configPath }), box.data, [new IdleBackend()]);
    managers.push(manager);
    await manager.initialize();
    const report = await manager.status({ workspace: box.alpha, operation: "review" }) as Readiness;
    expect(report.policy_path).toBeNull();
    expect(report.task_authorize).toBeNull();
  });

  it("quotes shell words only when they need it", async () => {
    const plain = await taskAuthorizeCommand({ configPath: "/opt/vsup/config.toml", operation: "review", workspace: "/opt/work", now: 0 });
    expect(plain.command.endsWith(" --expires-at 1970-01-01T00:30:00.000Z --config /opt/vsup/config.toml")).toBe(true);
    const quoted = await taskAuthorizeCommand({ configPath: "/opt/it's here/config.toml", operation: "edit", workspace: "/opt/work", baseRef: "main", now: 0 });
    expect(quoted.command.endsWith(` --config '/opt/it'\\''s here/config.toml'`)).toBe(true);
    expect(quoted.request_template).toEqual({ operation: "edit", request: { cwd: "/opt/work", base_ref: "main" } });
  });
});
