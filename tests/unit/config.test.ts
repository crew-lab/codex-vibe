import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configFingerprint, getConfigPath, getDataDir, loadConfig, loadResolvedConfig, resolveConfigSelection } from "../../src/config/config.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { bootBoundDrift } from "../../src/config/policy.js";
import { validateConfig } from "../../src/config/validation.js";

const manifestPaths = { vibe_pin_manifest: "/data/vibe-pin-manifest.json" } as const;
const base = { version: 1, paths: manifestPaths } as const;
const manifestToml = `[paths]\nvibe_pin_manifest = "/data/vibe-pin-manifest.json"\n`;
const roots: string[] = [];
const canonicalTmp = await realpath(tmpdir());
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("supervisor config", () => {
  it("uses the macOS Application Support default and honors the home override", () => {
    expect(getDataDir({ HOME: "/Users/example" })).toBe("/Users/example/Library/Application Support/VibeSupervisor-oneshot");
    expect(getDataDir({ VIBE_SUPERVISOR_HOME: "/tmp/custom-vsup" })).toBe("/tmp/custom-vsup");
    expect(getConfigPath({ VIBE_SUPERVISOR_HOME: "/tmp/custom-vsup" })).toBe("/tmp/custom-vsup/config.toml");
  });

  it("returns conservative defaults when the file is absent", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config).not.toHaveProperty("backend");
    expect(config).not.toHaveProperty("maxConcurrentRuns");
    expect(config).not.toHaveProperty("security");
    expect(config).not.toHaveProperty("phase1");
  });

  it("loads valid TOML, preserving defaults for omitted fields", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    const workspace = join(root, "workspace"); await mkdir(workspace);
    await writeFile(join(root, "config.toml"), `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[limits]\nmax_turns_review = 7\n${manifestToml}`);
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } });
    expect(config.allowedWorkspaceRoots).toEqual([workspace]);
    expect(config.limits.maxTurnsReview).toBe(7);
    expect(config.limits.maxTurnsEdit).toBe(DEFAULT_CONFIG.limits.maxTurnsEdit);
  });

  it("rejects keys removed in earlier releases like any unknown key", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    await writeFile(join(root, "config.toml"), `version = 1\n[security]\nallow_network_tools = true\n${manifestToml}`);
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID" } });
    expect(() => validateConfig({ ...base, phase1: { allow_temporary_trust: true } })).toThrow(/phase1/);
    expect(() => validateConfig({ ...base, security: { allow_shell_in_review: true } })).toThrow(/security/);
  });

  it("rejects options that no longer exist", () => {
    expect(() => validateConfig({ ...base, max_queued_runs: 8 })).toThrow(/max_queued_runs/);
    expect(() => validateConfig({ ...base, retention: { preserve_failed_runs: false } })).toThrow(/preserve_failed_runs/);
    expect(() => validateConfig({ ...base, limits: { mcp_result_format: "both" } })).toThrow(/mcp_result_format/);
    expect(() => validateConfig({ ...base, paths: { ...manifestPaths, data_dir: "/var/vibe" } })).toThrow(/data_dir/);
  });

  it("rejects removed backend and scheduling keys", () => {
    for (const value of ["acp", "app-server"]) expect(() => validateConfig({ ...base, backend: value }), value).toThrow(/backend/);
    expect(() => validateConfig({ ...base, max_concurrent_runs: 1 })).toThrow(/max_concurrent_runs/);
    expect(() => validateConfig({ ...base, worker_idle_ttl_seconds: 1 })).toThrow(/worker_idle_ttl_seconds/);
    expect(() => validateConfig({ ...base, paths: { ...manifestPaths, vibe_acp: "vibe-acp" } })).toThrow(/vibe_acp/);
  });

  it("enforces the tool bounds on the limits defaults", () => {
    expect(() => validateConfig({ ...base, limits: { max_turns_review: 0 } })).toThrow();
    expect(() => validateConfig({ ...base, limits: { max_turns_edit: 51 } })).toThrow();
    expect(() => validateConfig({ ...base, limits: { review_timeout_seconds: 29 } })).toThrow();
    expect(() => validateConfig({ ...base, limits: { edit_timeout_seconds: 7201 } })).toThrow();
    expect(validateConfig({ ...base, limits: { max_turns_review: 1, max_turns_edit: 50, review_timeout_seconds: 30, edit_timeout_seconds: 7200 } }).limits).toMatchObject({ maxTurnsReview: 1, maxTurnsEdit: 50, reviewTimeoutSeconds: 30, editTimeoutSeconds: 7200 });
  });

  it("rejects unknown root and nested fields", () => {
    expect(() => validateConfig({ ...base, surprise: true })).toThrow();
    expect(() => validateConfig({ ...base, security: { allow_everything: true } })).toThrow();
    expect(() => validateConfig({ ...base, phase1: { surprise: true } })).toThrow();
  });

  it("rejects broad, missing, dot-dot and symlinked roots consistently when a config is used", async () => {
    const parent = await mkdtemp(join(canonicalTmp, "vsup-config-root-")); roots.push(parent);
    const workspace = join(parent, "workspace"); const alias = join(parent, "alias");
    await mkdir(workspace); await symlink(workspace, alias);
    const sharedTemps = process.platform === 'darwin' ? ['/tmp', '/var/tmp', '/private/tmp', '/private/var/tmp'] : ['/tmp', '/var/tmp'];
    for (const root of [path.parse(parent).root, process.env.HOME ?? "~", "/Users", "/home", tmpdir(), ...sharedTemps, `${workspace}/../workspace`]) {
      expect(() => validateConfig({ ...base, allowed_workspace_roots: [root] }), root).toThrow();
    }
    const writeConfig = async (allowedRoot: string) => writeFile(join(parent, "config.toml"), `version = 1\nallowed_workspace_roots = [${JSON.stringify(allowedRoot)}]\n${manifestToml}`);
    for (const root of [alias, canonicalTmp]) {
      await writeConfig(root);
      await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: parent } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID" } });
    }
    await writeConfig(join(parent, "missing"));
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: parent } })).resolves.toMatchObject({ allowedWorkspaceRoots: [join(parent, "missing")] });
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
    await writeFile(join(realRoot, "config.toml"), `version = 1\n${manifestToml}`);
    await symlink(realRoot, linkRoot);
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: linkRoot } })).rejects.toThrow("symlink");
  });
});

describe("path contracts", () => {
  it("requires absolute or ~-prefixed workspace roots", () => {
    expect(validateConfig({ ...base, allowed_workspace_roots: ["/work/project", "~/code"] }).allowedWorkspaceRoots).toEqual(["/work/project", "~/code"]);
    for (const root of ["relative/dir", ".", "..", "./here", "~other/dir", "work", "/", "~", "~/"]) expect(() => validateConfig({ ...base, allowed_workspace_roots: [root] }), root).toThrow();
  });

  it("accepts an absolute executable path or a bare command name and rejects relative paths", () => {
    expect(validateConfig({ ...base, paths: { ...manifestPaths, vibe: "/opt/bin/vibe" } }).paths).toEqual({ vibe: "/opt/bin/vibe", vibePinManifest: manifestPaths.vibe_pin_manifest });
    for (const value of ["bin/vibe", "./vibe", "../vibe", "~/bin/vibe"]) {
      expect(() => validateConfig({ ...base, paths: { ...manifestPaths, vibe: value } }), value).toThrow();
      expect(() => validateConfig({ ...base, paths: { ...manifestPaths, vibe_acp: value } }), value).toThrow();
    }
  });
});

describe("configuration selection and provenance", () => {
  it("uses explicit config before the selected home and never falls back when it is missing", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-select-")); roots.push(root);
    const home = join(root, "obsolete"); const selected = join(root, "artifact", "config.toml");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(home, { recursive: true }));
    await writeFile(join(home, "config.toml"), 'version = 1\nbackend = "acp"\n');
    expect(resolveConfigSelection(selected, { VIBE_SUPERVISOR_HOME: home }).configPath).toBe(selected);
    await expect(loadConfig({ configPath: selected, env: { VIBE_SUPERVISOR_HOME: home } })).rejects.toThrow(selected);
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: home } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID" } });
  });

  it("fingerprints only the sanitized operational whitelist and resolves canonical config provenance", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-select-")); roots.push(root);
    const workspace = join(root, "workspace"); await mkdir(workspace);
    await writeFile(join(root, "config.toml"), `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[limits]\nmax_turns_review = 7\n${manifestToml}`);
    const result = await loadResolvedConfig({ configPath: join(root, "config.toml") });
    expect(result.configPath).toBe(await realpath(join(root, "config.toml")));
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fingerprint).toBe(configFingerprint(result.config));
    expect(JSON.stringify(result)).not.toMatch(/credential|token|secret/i);
  });
});

describe("app-server keys", () => {
  const appServer = { version: 1, paths: { vibe_pin_manifest: "/data/vibe-pin-manifest.json" } };

  it("requires the pin manifest path", () => {
    expect(() => validateConfig({ version: 1 })).toThrow(/vibe_pin_manifest/);
    expect(() => validateConfig({ version: 1, paths: {} })).toThrow(/vibe_pin_manifest/);
    expect(() => validateConfig({ version: 1, paths: { vibe: "/opt/bin/vibe" } })).toThrow(/vibe_pin_manifest/);
    const config = validateConfig(appServer);
    expect(config).not.toHaveProperty("backend");
    expect(config.paths).toEqual({ vibePinManifest: "/data/vibe-pin-manifest.json" });
  });

  it("no longer accepts a backend key in any form", () => {
    for (const value of ["acp", "app-server", "", 1, null]) expect(() => validateConfig({ version: 1, backend: value, paths: appServer.paths }), String(value)).toThrow(/backend/);
  });

  it("maps paths.app_server and validates it like the other executable paths", () => {
    expect(validateConfig({ ...appServer, paths: { ...appServer.paths, app_server: "/opt/bin/vibe-app-server" } }).paths).toEqual({ appServer: "/opt/bin/vibe-app-server", vibePinManifest: "/data/vibe-pin-manifest.json" });
    expect(validateConfig({ ...appServer, paths: { ...appServer.paths, app_server: "vibe-app-server" } }).paths?.appServer).toBe("vibe-app-server");
    for (const value of ["bin/vibe-app-server", "./x", "../x", "~/x", ""]) {
      expect(() => validateConfig({ ...appServer, paths: { ...appServer.paths, app_server: value } }), value).toThrow(/app_server/);
    }
  });

  it("requires an absolute pin manifest path", () => {
    for (const value of ["manifest.json", "./manifest.json", "../manifest.json", "~/manifest.json", "vibe-pin-manifest", ""]) {
      expect(() => validateConfig({ version: 1, paths: { vibe_pin_manifest: value } }), value).toThrow(/vibe_pin_manifest/);
    }
    expect(() => validateConfig({ version: 1, paths: { vibe_pin_manifest: `/${"a".repeat(4096)}` } })).toThrow(/vibe_pin_manifest/);
  });

  it("parses the optional token and cost budgets and enforces their bounds", () => {
    expect(validateConfig(appServer).limits).not.toHaveProperty("maxTokens");
    expect(validateConfig(appServer).limits).not.toHaveProperty("maxCostUsd");
    expect(validateConfig({ ...appServer, limits: { max_tokens: 2_000_000, max_cost_usd: 2.5 } }).limits).toMatchObject({ maxTokens: 2_000_000, maxCostUsd: 2.5 });
    for (const value of [0, -1, 1.5, "10", 1_000_000_001]) expect(() => validateConfig({ ...appServer, limits: { max_tokens: value } }), String(value)).toThrow(/max_tokens/);
    for (const value of [0, -0.01, "1", 1_000_001]) expect(() => validateConfig({ ...appServer, limits: { max_cost_usd: value } }), String(value)).toThrow(/max_cost_usd/);
  });

  it("loads the new keys from TOML and reports a missing manifest as a stable configuration error", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    const manifest = join(root, "vibe-pin-manifest.json");
    await writeFile(join(root, "config.toml"), `version = 1\n[limits]\nmax_tokens = 500000\nmax_cost_usd = 1.25\n[paths]\nvibe_pin_manifest = ${JSON.stringify(manifest)}\napp_server = "/opt/bin/vibe-app-server"\n`);
    const config = await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } });
    expect(config).toMatchObject({ limits: { maxTokens: 500000, maxCostUsd: 1.25 }, paths: { vibePinManifest: manifest, appServer: "/opt/bin/vibe-app-server" } });
    await writeFile(join(root, "config.toml"), "version = 1\n");
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID", message: expect.stringContaining("vibe_pin_manifest") } });
  });

  it("accepts a missing manifest path only when the caller asks for the lenient reading, and keeps every other check", async () => {
    expect(validateConfig({ version: 1 }, undefined, { requirePinManifest: false }).paths).toEqual({});
    expect(validateConfig({ version: 1, paths: { vibe: "/opt/bin/vibe" } }, undefined, { requirePinManifest: false }).paths).toEqual({ vibe: "/opt/bin/vibe" });
    expect(() => validateConfig({ version: 1, surprise: true }, undefined, { requirePinManifest: false })).toThrow(/surprise/);
    expect(() => validateConfig({ version: 1, paths: { vibe_pin_manifest: "relative.json" } }, undefined, { requirePinManifest: false })).toThrow(/vibe_pin_manifest/);
    expect(() => validateConfig({ version: 1 })).toThrow(/pin-manifest/);

    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    await writeFile(join(root, "config.toml"), "version = 1\n");
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID" } });
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: root }, requirePinManifest: false })).resolves.toMatchObject({ version: 1, paths: {} });
    const resolved = await loadResolvedConfig({ env: { VIBE_SUPERVISOR_HOME: root }, requirePinManifest: false });
    expect(resolved.config.paths).toEqual({});
  });

  it("includes the new settings in the policy revision and treats them as boot-bound", () => {
    const base = validateConfig(appServer);
    const revision = configFingerprint(base);
    const variants = [
      validateConfig({ ...appServer, paths: { ...appServer.paths, app_server: "/opt/bin/vibe-app-server" } }),
      validateConfig({ ...appServer, paths: { vibe_pin_manifest: "/data/other.json" } }),
      validateConfig({ ...appServer, limits: { max_tokens: 10 } }),
      validateConfig({ ...appServer, limits: { max_cost_usd: 1 } })
    ];
    for (const variant of variants) expect(configFingerprint(variant)).not.toBe(revision);
    expect(variants.map((variant) => bootBoundDrift(base, variant))).toEqual([
      ["paths.app_server"],
      ["paths.vibe_pin_manifest"],
      ["limits.max_tokens"],
      ["limits.max_cost_usd"]
    ]);
    expect(bootBoundDrift(base, validateConfig(appServer))).toEqual([]);
  });
});

describe("excluded_globs", () => {
  const project = "/work/project";
  const other = "/work/other";
  const withExclusions = (excluded: unknown, allowed: string[] = [project, other]) => ({ ...base, allowed_workspace_roots: allowed, excluded_globs: excluded });

  it("maps each allowed root to its globs, drops duplicates, keeps order and omits the key when nothing is excluded", () => {
    const config = validateConfig(withExclusions({ [project]: ["*.tfvars", "fixtures/private/**", "*.tfvars", "dumps/*.sql"], [other]: [] }));
    expect(config.excludedGlobs).toEqual({ [project]: ["*.tfvars", "fixtures/private/**", "dumps/*.sql"] });
    expect(validateConfig(withExclusions({}))).not.toHaveProperty("excludedGlobs");
    expect(validateConfig(withExclusions({ [project]: [] }))).not.toHaveProperty("excludedGlobs");
    expect(validateConfig({ ...base, allowed_workspace_roots: [project] })).not.toHaveProperty("excludedGlobs");
  });

  it("rejects the same root listed twice, written alike or differently, so its exclusions cannot split", () => {
    expect(() => validateConfig({ ...base, allowed_workspace_roots: [project, project] }, "/home-of/me")).toThrow(/lists the same root twice/);
    expect(() => validateConfig({ ...base, allowed_workspace_roots: [project, `${project}/`] }, "/home-of/me")).toThrow(/lists the same root twice/);
    expect(() => validateConfig({ ...base, allowed_workspace_roots: ["~/code", "/home-of/me/code"], excluded_globs: { "~/code": ["a"], "/home-of/me/code": ["b"] } }, "/home-of/me")).toThrow(/lists the same root twice/);
    expect(validateConfig({ ...base, allowed_workspace_roots: [project, other] }, "/home-of/me").allowedWorkspaceRoots).toEqual([project, other]);
  });

  it("accepts the documented syntax", () => {
    const globs = ["*.tfvars", "fixtures/private/**", "dumps/*.sql", "**/secret.json", "a/**/b", "x@1+2=3,4_5-6.7", "**", "*", "a/**", ".hidden", "v1.2/*.yaml", "A".repeat(256)];
    expect(validateConfig(withExclusions({ [project]: globs })).excludedGlobs?.[project]).toEqual(globs);
    expect(validateConfig(withExclusions({ [project]: [Array.from({ length: 16 }, () => "a").join("/")] })).excludedGlobs?.[project]).toHaveLength(1);
  });

  it("rejects a key that is not an allowed root, as written, so an exclusion never implies access", () => {
    expect(() => validateConfig(withExclusions({ "/work/unlisted": ["*.tfvars"] }))).toThrow(/excluded_globs.*must equal an entry of allowed_workspace_roots/s);
    expect(() => validateConfig(withExclusions({ "/work/project/": ["*.tfvars"] }))).toThrow(/allowed_workspace_roots/);
    expect(() => validateConfig(withExclusions({ "/work/project/../project": ["*.tfvars"] }))).toThrow(/allowed_workspace_roots/);
    expect(() => validateConfig(withExclusions({ [project]: ["*.tfvars"] }, []))).toThrow(/allowed_workspace_roots/);
    expect(() => validateConfig(withExclusions({ "~/code": ["*.tfvars"] }, ["/work/project"]))).toThrow(/allowed_workspace_roots/);
    expect(validateConfig(withExclusions({ "~/code": ["*.tfvars"] }, ["~/code"])).excludedGlobs).toEqual({ "~/code": ["*.tfvars"] });
  });

  it("rejects patterns that would leave the workspace, negate a rule or change how the matchers read them", () => {
    const rejected: Array<[string, RegExp]> = [
      ["/etc/passwd", /not start with \//],
      ["/", /not start with \//],
      ["~/secrets", /not start with ~/],
      ["~", /not start with ~/],
      ["../outside", /\.\. segment/],
      ["a/../b", /\.\. segment/],
      ["./a", /\. or \.\. segment/],
      ["a/./b", /\. or \.\. segment/],
      ["..", /\.\. segment/],
      [".", /\. or \.\. segment/],
      ["a//b", /empty segment/],
      ["a/", /empty segment/],
      ["", /1 to 256 characters/],
      ["A".repeat(257), /1 to 256 characters/],
      ["a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q", /at most 16 segments/],
      ["!keep.txt", /negation/],
      ["a?b", /\?/],
      ["a[bc]", /\[ \]/],
      ["{a,b}", /braces/],
      ["a\\b", /backslash/],
      ["a b", /ASCII/],
      ["café", /ASCII/],
      ["a\nb", /ASCII/],
      ["a**", /whole segment/],
      ["**a", /whole segment/],
      ["a/b**/c", /whole segment/],
      ["***", /whole segment/],
      ["#comment", /ASCII/],
      ["$HOME", /ASCII/]
    ];
    for (const [glob, message] of rejected) expect(() => validateConfig(withExclusions({ [project]: [glob] })), JSON.stringify(glob)).toThrow(message);
  });

  it("bounds the number of globs per root and the shapes it accepts", () => {
    expect(validateConfig(withExclusions({ [project]: Array.from({ length: 100 }, (_, index) => `f${index}.txt`) })).excludedGlobs?.[project]).toHaveLength(100);
    expect(() => validateConfig(withExclusions({ [project]: Array.from({ length: 101 }, (_, index) => `f${index}.txt`) }))).toThrow(/excluded_globs/);
    expect(() => validateConfig(withExclusions({ [project]: "*.tfvars" }))).toThrow(/excluded_globs/);
    expect(() => validateConfig(withExclusions({ [project]: [1] }))).toThrow(/excluded_globs/);
    expect(() => validateConfig(withExclusions([]))).toThrow(/excluded_globs/);
    expect(() => validateConfig(withExclusions("*.tfvars"))).toThrow(/excluded_globs/);
  });

  it("reports the field path of the offending glob", () => {
    try { validateConfig(withExclusions({ [project]: ["ok", "../bad"] })); expect.unreachable(); }
    catch (error) { expect(String(error)).toMatch(/excluded_globs/); expect(String(error)).toContain(project); }
  });

  it("loads from TOML and reports an invalid table as a stable configuration error", async () => {
    const root = await mkdtemp(join(canonicalTmp, "vsup-config-")); roots.push(root);
    const workspace = join(root, "workspace"); await mkdir(workspace);
    await writeFile(join(root, "config.toml"), `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n${manifestToml}\n[excluded_globs]\n${JSON.stringify(workspace)} = ["*.tfvars", "fixtures/private/**"]\n`);
    expect((await loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } })).excludedGlobs).toEqual({ [workspace]: ["*.tfvars", "fixtures/private/**"] });
    await writeFile(join(root, "config.toml"), `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n${manifestToml}\n[excluded_globs]\n${JSON.stringify(workspace)} = ["/etc/passwd"]\n`);
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID" } });
    await writeFile(join(root, "config.toml"), `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n${manifestToml}\n[excluded_globs]\n"/somewhere/else" = ["*.tfvars"]\n`);
    await expect(loadConfig({ env: { VIBE_SUPERVISOR_HOME: root } })).rejects.toMatchObject({ supervisor: { code: "VSUP_CONFIG_INVALID" } });
  });

  it("changes the policy revision with an exclusion, leaves it unchanged without one, and is not boot-bound", () => {
    const plain = validateConfig({ ...base, allowed_workspace_roots: [project] });
    const revision = configFingerprint(plain);
    expect(configFingerprint(validateConfig(withExclusions({}, [project])))).toBe(revision);
    expect(configFingerprint(validateConfig(withExclusions({ [project]: [] }, [project])))).toBe(revision);
    const one = validateConfig(withExclusions({ [project]: ["*.tfvars"] }, [project]));
    const two = validateConfig(withExclusions({ [project]: ["*.tfvars", "dumps/*.sql"] }, [project]));
    const reordered = validateConfig(withExclusions({ [project]: ["dumps/*.sql", "*.tfvars"] }, [project]));
    const elsewhere = validateConfig(withExclusions({ [other]: ["*.tfvars"] }, [other]));
    const fingerprints = [revision, configFingerprint(one), configFingerprint(two), configFingerprint(reordered), configFingerprint(elsewhere)];
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    expect(configFingerprint(validateConfig(withExclusions({ [project]: ["*.tfvars"] }, [project])))).toBe(configFingerprint(one));
    expect(configFingerprint(validateConfig(withExclusions({ [project]: ["*.tfvars", "*.tfvars"] }, [project])))).toBe(configFingerprint(one));
    expect(bootBoundDrift(plain, one)).toEqual([]);
    expect(bootBoundDrift(one, two)).toEqual([]);
  });

  it("keys the fingerprint on the resolved root, whatever order the table is written in", () => {
    const first = validateConfig(withExclusions({ [project]: ["a"], [other]: ["b"] }));
    const second = validateConfig(withExclusions({ [other]: ["b"], [project]: ["a"] }));
    expect(configFingerprint(first)).toBe(configFingerprint(second));
  });
});
