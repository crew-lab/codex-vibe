import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfigPath, getDataDir, loadConfig } from "../../src/config/config.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { validateConfig } from "../../src/config/validation.js";

const roots: string[] = [];
const canonicalTmp = await realpath(tmpdir());
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("supervisor config", () => {
  it("uses the macOS Application Support default and honors the home override", () => {
    expect(getDataDir({ HOME: "/Users/example" })).toBe("/Users/example/Library/Application Support/VibeSupervisor");
    expect(getDataDir({ VIBE_SUPERVISOR_HOME: "/tmp/custom-vsup" })).toBe("/tmp/custom-vsup");
    expect(getConfigPath({ VIBE_SUPERVISOR_HOME: "/tmp/custom-vsup" })).toBe("/tmp/custom-vsup/config.toml");
  });

  it("returns conservative defaults when the file is absent", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.maxConcurrentRuns).toBe(2);
    expect(config).not.toHaveProperty("security");
    expect(config).not.toHaveProperty("phase1");
  });

  it("loads valid TOML, preserving defaults for omitted fields", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    await writeFile(join(root, "config.toml"), 'version = 1\nallowed_workspace_roots = ["/work/project"]\n[limits]\nmax_turns_review = 7\n');
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } });
    expect(config.allowedWorkspaceRoots).toEqual(["/work/project"]);
    expect(config.limits.maxTurnsReview).toBe(7);
    expect(config.limits.maxTurnsEdit).toBe(DEFAULT_CONFIG.limits.maxTurnsEdit);
  });

  it("rejects keys removed in earlier releases like any unknown key", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    await writeFile(join(root, "config.toml"), 'version = 1\n[security]\nallow_network_tools = true\n');
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID" } });
    expect(() => validateConfig({ version: 1, phase1: { allow_temporary_trust: true } })).toThrow(/phase1/);
    expect(() => validateConfig({ version: 1, security: { allow_shell_in_review: true } })).toThrow(/security/);
  });

  it("rejects options that no longer exist", () => {
    expect(() => validateConfig({ version: 1, max_queued_runs: 8 })).toThrow(/max_queued_runs/);
    expect(() => validateConfig({ version: 1, retention: { preserve_failed_runs: false } })).toThrow(/preserve_failed_runs/);
    expect(() => validateConfig({ version: 1, limits: { mcp_result_format: "both" } })).toThrow(/mcp_result_format/);
    expect(() => validateConfig({ version: 1, paths: { data_dir: "/var/vibe" } })).toThrow(/data_dir/);
  });

  it("rejects backend auto and names the two valid values", () => {
    expect(() => validateConfig({ version: 1, backend: "auto" })).toThrow(/programmatic.*acp/);
    expect(validateConfig({ version: 1, backend: "acp" }).backend).toBe("acp");
  });

  it("enforces the tool bounds on the limits defaults", () => {
    expect(() => validateConfig({ version: 1, limits: { max_turns_review: 0 } })).toThrow();
    expect(() => validateConfig({ version: 1, limits: { max_turns_edit: 51 } })).toThrow();
    expect(() => validateConfig({ version: 1, limits: { review_timeout_seconds: 29 } })).toThrow();
    expect(() => validateConfig({ version: 1, limits: { edit_timeout_seconds: 7201 } })).toThrow();
    expect(validateConfig({ version: 1, limits: { max_turns_review: 1, max_turns_edit: 50, review_timeout_seconds: 30, edit_timeout_seconds: 7200 } }).limits).toMatchObject({ maxTurnsReview: 1, maxTurnsEdit: 50, reviewTimeoutSeconds: 30, editTimeoutSeconds: 7200 });
  });

  it("rejects unknown root and nested fields", () => {
    expect(() => validateConfig({ version: 1, surprise: true })).toThrow();
    expect(() => validateConfig({ version: 1, security: { allow_everything: true } })).toThrow();
    expect(() => validateConfig({ version: 1, phase1: { surprise: true } })).toThrow();
  });

  it("reports malformed TOML/config as a stable configuration error", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    await writeFile(join(root, "config.toml"), "version = [\n");
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID" } });
  });

  it("creates only an explicitly requested private application root", async () => {
    const parent = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(parent);
    const root = join(parent, "nested", "VibeSupervisor");
    await loadConfig({ createDataDir: true, env: { VIBE_SUPERVISOR_HOME: root } });
    await expect(mkdir(root)).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("refuses to read configuration through a symlinked data root", async () => {
    const parent = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(parent);
    const realRoot = join(parent, "real"); const linkRoot = join(parent, "link");
    await mkdir(realRoot);
    await writeFile(join(realRoot, "config.toml"), "version = 1\n");
    await symlink(realRoot, linkRoot);
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: linkRoot } })).rejects.toThrow("symlink");
  });
});

describe("path contracts", () => {
  it("requires absolute or ~-prefixed workspace roots", () => {
    expect(validateConfig({ version: 1, allowed_workspace_roots: ["/work/project", "~", "~/code"] }).allowedWorkspaceRoots).toEqual(["/work/project", "~", "~/code"]);
    for (const root of ["relative/dir", ".", "..", "./here", "~other/dir", "work"]) expect(() => validateConfig({ version: 1, allowed_workspace_roots: [root] }), root).toThrow();
  });

  it("accepts an absolute executable path or a bare command name and rejects relative paths", () => {
    expect(validateConfig({ version: 1, paths: { vibe: "/opt/bin/vibe", vibe_acp: "vibe-acp" } }).paths).toEqual({ vibe: "/opt/bin/vibe", vibeAcp: "vibe-acp" });
    for (const value of ["bin/vibe", "./vibe", "../vibe", "~/bin/vibe"]) {
      expect(() => validateConfig({ version: 1, paths: { vibe: value } }), value).toThrow();
      expect(() => validateConfig({ version: 1, paths: { vibe_acp: value } }), value).toThrow();
    }
  });
});
