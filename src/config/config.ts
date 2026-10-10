import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";
import { DEFAULT_CONFIG } from "./defaults.js";
import { validateConfig } from "./validation.js";
import { supervisorError } from "../contracts.js";
import type { SupervisorConfig } from "../contracts.js";
import { createPrivateDir, validateWorkspaceRootsAtUse } from "../security/paths.js";

export interface LoadConfigOptions {
  /** Create the private application data root when it does not exist. */
  createDataDir?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Read this exact config file. An explicit path never falls back. */
  configPath?: string;
}

export interface ConfigSelection {
  configPath: string;
  dataDir: string;
  source: "explicit" | "environment" | "default";
}

export interface ResolvedConfig extends ConfigSelection {
  config: SupervisorConfig;
  fingerprint: string;
}

export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.VIBE_SUPERVISOR_HOME;
  if (override) return resolve(override);
  const userHome = env.HOME ?? env.USERPROFILE ?? homedir();
  if (process.platform === "win32") return join(env.APPDATA ?? join(userHome, "AppData", "Roaming"), "VibeSupervisor-oneshot");
  if (process.platform === "darwin") return join(userHome, "Library", "Application Support", "VibeSupervisor-oneshot");
  return join(env.XDG_DATA_HOME ?? join(userHome, ".local", "share"), "vibe-supervisor-oneshot");
}

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getDataDir(env), "config.toml");
}

/** Select one configuration source consistently for CLI, server and coordinator tools. */
export function resolveConfigSelection(configPath?: string, env: NodeJS.ProcessEnv = process.env): ConfigSelection {
  if (configPath !== undefined) {
    if (!configPath.trim()) throw new Error("Config path must not be empty.");
    const selected = resolve(configPath);
    return { configPath: selected, dataDir: dirname(selected), source: "explicit" };
  }
  if (env.VIBE_SUPERVISOR_HOME) {
    const dataDir = resolve(env.VIBE_SUPERVISOR_HOME);
    return { configPath: join(dataDir, "config.toml"), dataDir, source: "environment" };
  }
  const dataDir = getDataDir(env);
  return { configPath: join(dataDir, "config.toml"), dataDir, source: "default" };
}

/** Stable semantic fingerprint. Credentials and arbitrary config fields are excluded by construction. */
export function configFingerprint(config: SupervisorConfig): string {
  const semantic = {
    version: config.version,
    allowedWorkspaceRoots: config.allowedWorkspaceRoots.map(root => resolve(root === "~" ? homedir() : root.startsWith("~/") ? join(homedir(), root.slice(2)) : root)),
    retention: { days: config.retention.days },
    limits: {
      reviewTimeoutSeconds: config.limits.reviewTimeoutSeconds,
      editTimeoutSeconds: config.limits.editTimeoutSeconds,
      maxTurnsReview: config.limits.maxTurnsReview,
      maxTurnsEdit: config.limits.maxTurnsEdit,
      maxEventBytes: config.limits.maxEventBytes,
      maxTranscriptBytes: config.limits.maxTranscriptBytes,
      maxArtifactBytes: config.limits.maxArtifactBytes,
      workerProgressTimeoutSeconds: config.limits.workerProgressTimeoutSeconds,
      maxMcpResultChars: config.limits.maxMcpResultChars
    },
    ...(config.paths?.vibe ? { vibePath: config.paths.vibe } : {})
  };
  return createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<SupervisorConfig> {
  const env = options.env ?? process.env;
  const explicit = options.configPath !== undefined;
  const selection = resolveConfigSelection(options.configPath, env);
  const dataDir = selection.dataDir;
  await ensureNoSymlinkAncestors(dataDir);
  if (!options.createDataDir) {
    try {
      const current = await lstat(dataDir);
      if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("Supervisor data root must be a real directory, not a symlink.");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
  }
  if (options.createDataDir) {
    await createPrivateDir(dataDir);
    const dirStat = await lstat(dataDir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error("Supervisor data root must be a real directory, not a symlink.");
  }
  let handle;
  try {
    handle = await open(selection.configPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (explicit) throw Object.assign(new Error(`Config not found: ${selection.configPath}`), {
        supervisor: supervisorError("VSUP_CONFIG_INVALID", "Explicit config file was not found.", { configPath: selection.configPath })
      });
      return { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits }, retention: { ...DEFAULT_CONFIG.retention } };
    }
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1_048_576) throw new Error("Config must be a regular file no larger than 1 MiB.");
    const source = await handle.readFile("utf8");
    const raw = parse(source);
    const config = validateConfig(raw, env.HOME ?? env.USERPROFILE);
    await validateWorkspaceRootsAtUse(config.allowedWorkspaceRoots, env.HOME ?? env.USERPROFILE);
    return config;
  } catch (error) {
    if (error instanceof Error) {
      throw Object.assign(new Error(`Invalid supervisor configuration: ${error.message}`, { cause: error }), {
        supervisor: supervisorError("VSUP_CONFIG_INVALID", `Invalid configuration file ${selection.configPath}: ${error.message} Supported fields are version, allowed_workspace_roots, retention, limits, and paths.vibe; remove unsupported fields.`, { configPath: selection.configPath })
      });
    }
    throw error;
  } finally {
    await handle.close();
  }
}

export async function loadResolvedConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const selection = resolveConfigSelection(options.configPath, options.env ?? process.env);
  // Keep default missing-file behavior while preserving an explicit path as authoritative.
  const config = await loadConfig(options);
  let configPath = selection.configPath;
  try { configPath = await realpath(selection.configPath); } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  return { ...selection, configPath, config, fingerprint: configFingerprint(config) };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function ensureNoSymlinkAncestors(target: string): Promise<void> {
  const absolute = resolve(target);
  const parsed = absolute.split(/[\\/]+/).filter(Boolean);
  let current = absolute.startsWith("/") ? "/" : parsed.shift() ?? ".";
  for (const segment of parsed) {
    current = current === "/" ? `/${segment}` : join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("Supervisor data path cannot contain a symlink.");
    } catch (error) { if (!isNodeError(error) || error.code !== "ENOENT") throw error; }
  }
}

/** Used by CLI diagnostics without expanding a shell or interpreting arbitrary commands. */
export function executableSearchPath(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PATH ?? "").split(delimiter).filter(Boolean);
}
