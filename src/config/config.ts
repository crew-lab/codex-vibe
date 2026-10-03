import { lstat, open } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { parse } from "smol-toml";
import { DEFAULT_CONFIG } from "./defaults.js";
import { validateConfig } from "./validation.js";
import { supervisorError } from "../contracts.js";
import type { SupervisorConfig } from "../contracts.js";
import { createPrivateDir } from "../security/paths.js";

export interface LoadConfigOptions {
  /** Create the private application data root when it does not exist. */
  createDataDir?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.VIBE_SUPERVISOR_HOME;
  if (override) return resolve(override);
  const userHome = env.HOME ?? env.USERPROFILE ?? homedir();
  if (process.platform === "win32") return join(env.APPDATA ?? join(userHome, "AppData", "Roaming"), "VibeSupervisor");
  if (process.platform === "darwin") return join(userHome, "Library", "Application Support", "VibeSupervisor");
  return join(env.XDG_DATA_HOME ?? join(userHome, ".local", "share"), "vibe-supervisor");
}

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getDataDir(env), "config.toml");
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<SupervisorConfig> {
  const env = options.env ?? process.env;
  const dataDir = getDataDir(env);
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
    handle = await open(join(dataDir, "config.toml"), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits }, retention: { ...DEFAULT_CONFIG.retention }, phase1: { ...DEFAULT_CONFIG.phase1 }, security: { ...DEFAULT_CONFIG.security } };
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1_048_576) throw new Error("Config must be a regular file no larger than 1 MiB.");
    const source = await handle.readFile("utf8");
    const raw = parse(source);
    const validated = validateConfig(raw);
    if (validated.paths?.dataDir) return { ...validated, paths: { ...validated.paths, dataDir: resolve(validated.paths.dataDir) } };
    return validated;
  } catch (error) {
    if (error instanceof Error) {
      throw Object.assign(new Error(`Invalid supervisor configuration: ${error.message}`, { cause: error }), {
        supervisor: supervisorError("VSUP_CONFIG_INVALID", error.message, { configPath: join(dataDir, "config.toml") })
      });
    }
    throw error;
  } finally {
    await handle.close();
  }
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
