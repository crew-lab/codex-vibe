import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { supervisorError } from "../contracts.js";

const LOCK_FILE = "supervisor.lock";
const RECOVERY_SUFFIX = ".recovery";
const MAX_LOCK_BYTES = 4096;
const STALE_RECOVERY_MS = 30_000;
const FRESH_LOCK_MS = 2000;
const REREAD_DELAY_MS = 250;
const MAX_REREADS = 4;
const REUSED_PID_SKEW_MS = 5000;
const PS_TIMEOUT_MS = 2000;
const MAX_ATTEMPTS = 3;

export interface LockFileInfo { isFile: boolean; isSymbolicLink: boolean; size: number; mtimeMs: number }

export interface OwnerLockFs {
  createExclusive(file: string, content: string): Promise<void>;
  stat(file: string): Promise<LockFileInfo>;
  read(file: string): Promise<string>;
  remove(file: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface OwnerLockDeps {
  fs: OwnerLockFs;
  kill(pid: number, signal: 0): void;
  processStartTime(pid: number): Promise<number | undefined>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  pid: number;
}

export interface OwnerLock { path: string; token: string; release(): Promise<void> }

export type OwnerLockStatus =
  | { path: string; held: false }
  | { path: string; held: true; owner: "alive" | "stale"; pid: number; startedAt?: string }
  | { path: string; held: true; owner: "malformed" };

interface ParsedLock { pid: number; token: string; startedAt?: string }
interface Observation { text: string; parsed: ParsedLock | undefined }

const nodeFs: OwnerLockFs = {
  async createExclusive(file, content) {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(content, "utf8"); await handle.sync(); }
    catch (error) { await handle.close().catch(() => undefined); await rm(file, { force: true }).catch(() => undefined); throw error; }
    await handle.close();
  },
  async stat(file) {
    const info = await lstat(file);
    return { isFile: info.isFile(), isSymbolicLink: info.isSymbolicLink(), size: info.size, mtimeMs: info.mtimeMs };
  },
  read: (file) => readFile(file, "utf8"),
  remove: (file) => rm(file, { force: false }),
  rename: (from, to) => rename(from, to)
};

const ELAPSED = /^(?:(?:(\d+)-)?(\d{1,2}):)?(\d{1,2}):(\d{2})$/;

export function parseElapsedMs(text: string): number | undefined {
  const match = ELAPSED.exec(text.trim());
  if (!match) return undefined;
  const days = Number(match[1] ?? 0); const hours = Number(match[2] ?? 0); const minutes = Number(match[3]); const seconds = Number(match[4]);
  if (hours > 23 || minutes > 59 || seconds > 59) return undefined;
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

export function readProcessStartTime(pid: number, now: () => number = Date.now): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "etime=", "-p", String(pid)], { env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: PS_TIMEOUT_MS, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      if (error) { resolve(undefined); return; }
      const elapsed = parseElapsedMs(stdout);
      resolve(elapsed === undefined ? undefined : now() - elapsed);
    });
  });
}

function defaults(): OwnerLockDeps {
  return {
    fs: nodeFs,
    kill: (pid, signal) => { process.kill(pid, signal); },
    processStartTime: readProcessStartTime,
    now: () => Date.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pid: process.pid
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function lockError(message: string, lockPath: string, ownerPid?: number): Error {
  const details = { lock_path: lockPath, ...(ownerPid === undefined ? {} : { owner_pid: ownerPid }) };
  return Object.assign(new Error(message), supervisorError("VSUP_INVALID_STATE", message, details));
}

function parseLock(text: string): ParsedLock | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.pid !== "number" || !Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.token !== "string") return undefined;
  return { pid: record.pid, token: record.token, ...(typeof record.started_at === "string" ? { startedAt: record.started_at } : {}) };
}

async function observe(lockPath: string, deps: OwnerLockDeps): Promise<Observation | undefined> {
  for (let reread = 0; ; reread += 1) {
    let info: LockFileInfo;
    let text: string;
    try {
      info = await deps.fs.stat(lockPath);
      if (info.isSymbolicLink || !info.isFile || info.size > MAX_LOCK_BYTES) throw lockError(`The supervisor owner lock ${lockPath} is unsafe; inspect it manually.`, lockPath);
      text = await deps.fs.read(lockPath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
    const parsed = parseLock(text);
    if (parsed || reread >= MAX_REREADS || deps.now() - info.mtimeMs >= FRESH_LOCK_MS) return { text, parsed };
    await deps.sleep(REREAD_DELAY_MS);
  }
}

async function classifyOwner(lock: ParsedLock, deps: OwnerLockDeps): Promise<"alive" | "stale"> {
  try { deps.kill(lock.pid, 0); }
  catch (error) {
    const code = errorCode(error);
    if (code === "ESRCH") return "stale";
    if (code !== "EPERM") throw error;
  }
  const lockedAt = lock.startedAt === undefined ? Number.NaN : Date.parse(lock.startedAt);
  if (Number.isNaN(lockedAt)) return "alive";
  const startedAt = await deps.processStartTime(lock.pid);
  if (startedAt === undefined) return "alive";
  return startedAt - lockedAt > REUSED_PID_SKEW_MS ? "stale" : "alive";
}

function withDefaults(overrides: Partial<OwnerLockDeps>): OwnerLockDeps {
  return { ...defaults(), ...overrides };
}

export async function inspectOwnerLock(dataDir: string, overrides: Partial<OwnerLockDeps> = {}): Promise<OwnerLockStatus> {
  const deps = withDefaults(overrides);
  const lockPath = path.join(dataDir, LOCK_FILE);
  const observed = await observe(lockPath, deps);
  if (!observed) return { path: lockPath, held: false };
  if (!observed.parsed) return { path: lockPath, held: true, owner: "malformed" };
  return { path: lockPath, held: true, owner: await classifyOwner(observed.parsed, deps), pid: observed.parsed.pid, ...(observed.parsed.startedAt ? { startedAt: observed.parsed.startedAt } : {}) };
}

async function removeIfPresent(deps: OwnerLockDeps, file: string): Promise<void> {
  try { await deps.fs.remove(file); }
  catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
}

async function claimStaleRecovery(deps: OwnerLockDeps, recoveryPath: string): Promise<boolean> {
  let observed: string;
  try {
    const info = await deps.fs.stat(recoveryPath);
    if (deps.now() - info.mtimeMs <= STALE_RECOVERY_MS) return false;
    observed = await deps.fs.read(recoveryPath);
  } catch (error) { if (errorCode(error) === "ENOENT") return true; throw error; }
  const claimedPath = `${recoveryPath}.${randomUUID()}.claimed`;
  try { await deps.fs.rename(recoveryPath, claimedPath); }
  catch (error) { if (errorCode(error) === "ENOENT") return true; throw error; }
  let claimed: string | undefined;
  try { claimed = await deps.fs.read(claimedPath); } catch {}
  if (claimed === observed) { await removeIfPresent(deps, claimedPath); return true; }
  let vacant = false;
  try { await deps.fs.stat(recoveryPath); } catch (error) { vacant = errorCode(error) === "ENOENT"; }
  if (vacant) { try { await deps.fs.rename(claimedPath, recoveryPath); } catch { await removeIfPresent(deps, claimedPath).catch(() => undefined); } }
  else await removeIfPresent(deps, claimedPath).catch(() => undefined);
  return false;
}

export async function acquireOwnerLock(dataDir: string, overrides: Partial<OwnerLockDeps> = {}): Promise<OwnerLock> {
  const deps = withDefaults(overrides);
  const lockPath = path.join(dataDir, LOCK_FILE);
  const recoveryPath = `${lockPath}${RECOVERY_SUFFIX}`;
  const token = randomUUID();
  const payload = JSON.stringify({ pid: deps.pid, token, started_at: new Date(deps.now()).toISOString() });
  let clearedStaleRecovery = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      await deps.fs.createExclusive(lockPath, payload);
      return { path: lockPath, token, release: () => releaseOwnerLock(lockPath, token, deps) };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const recoveryToken = randomUUID();
    try { await deps.fs.createExclusive(recoveryPath, JSON.stringify({ pid: deps.pid, token: recoveryToken })); }
    catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (!clearedStaleRecovery && await claimStaleRecovery(deps, recoveryPath)) { clearedStaleRecovery = true; continue; }
      throw lockError(`Another process is recovering the supervisor owner lock ${lockPath}; retry shortly.`, lockPath);
    }
    try { await reclaimStaleOwner(dataDir, lockPath, deps); }
    finally {
      try {
        const guard = JSON.parse(await deps.fs.read(recoveryPath)) as { token?: unknown };
        if (guard.token === recoveryToken) await deps.fs.remove(recoveryPath);
      } catch {}
    }
  }
  throw lockError(`Could not acquire the supervisor data-directory lock ${lockPath}.`, lockPath);
}

async function reclaimStaleOwner(dataDir: string, lockPath: string, deps: OwnerLockDeps): Promise<void> {
  const observed = await observe(lockPath, deps);
  if (!observed) return;
  if (!observed.parsed) throw lockError(`The supervisor owner lock ${lockPath} is malformed; inspect it manually.`, lockPath);
  const owner = await classifyOwner(observed.parsed, deps);
  if (owner === "alive") throw lockError(`Another vibe-supervisor (pid ${observed.parsed.pid}) owns ${dataDir}. Lock file: ${lockPath}. Stop that process, or give each Codex session its own VIBE_SUPERVISOR_HOME.`, lockPath, observed.parsed.pid);
  let again: string;
  try { again = await deps.fs.read(lockPath); }
  catch (error) { if (errorCode(error) === "ENOENT") return; throw error; }
  if (again !== observed.text) throw lockError(`The supervisor owner lock ${lockPath} changed during stale-owner recovery; retry.`, lockPath);
  await removeIfPresent(deps, lockPath);
}

async function releaseOwnerLock(lockPath: string, token: string, deps: OwnerLockDeps): Promise<void> {
  try {
    const info = await deps.fs.stat(lockPath);
    if (!info.isFile || info.isSymbolicLink || info.size > MAX_LOCK_BYTES) return;
    if (parseLock(await deps.fs.read(lockPath))?.token === token) await deps.fs.remove(lockPath);
  } catch {}
}
