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
    expect(config.security.persistReasoning).toBe(false);
  });

  it("loads valid TOML, preserving defaults for omitted fields", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    await writeFile(join(root, "config.toml"), 'version = 1\nallowed_workspace_roots = ["/work/project"]\n[security]\nallow_shell_in_edit = true\n');
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } });
    expect(config.allowedWorkspaceRoots).toEqual(["/work/project"]);
    expect(config.security.allowShellInEdit).toBe(true);
    expect(config.security.allowNetworkTools).toBe(false);
  });

  it("rejects unknown root and nested fields", () => {
    expect(() => validateConfig({ version: 1, surprise: true })).toThrow();
    expect(() => validateConfig({ version: 1, security: { allow_everything: true } })).toThrow();
    expect(() => validateConfig({ version: 1, security: { persist_reasoning: true } })).toThrow();
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
