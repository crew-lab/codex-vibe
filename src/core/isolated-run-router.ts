import { lstat, open, readdir, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { supervisorError, type CloseToolInput, type ResultToolInput, type StatusToolInput, type WaitOptions } from "../contracts.js";
import type { SupervisorConfig } from "../contracts.js";
import { acquireOwnerLock, isOwnerLockContention } from "./owner-lock.js";
import { SESSION_NAME } from "./session-pruning.js";
import { writeDiagnostic } from "../diagnostics/background.js";
import type { RunManagerTools } from "../mcp/tools.js";
import type { PolicySource } from "../config/policy.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_SIBLING_SESSIONS = 128;
const MAX_META_BYTES = 1_048_576;
type Manager = RunManagerTools & { initialize(): Promise<void>; shutdown(): Promise<{ timedOut: boolean }> };

export interface IsolatedRunRouterOptions {
  sessions: string;
  currentHome: string;
  config: SupervisorConfig;
  policy?: PolicySource;
  report?: (message: string) => void;
}

function fail(code: "VSUP_NOT_FOUND" | "VSUP_INVALID_STATE" | "VSUP_STORAGE_ERROR" | "VSUP_OWNER_LOCKED", message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), supervisorError(code, message, details));
}

class UnsafeSession extends Error {}

function wrongOwner(uid: number): boolean {
  return typeof process.getuid === "function" && uid !== process.getuid();
}

async function assertPrivateDirectory(directory: string, label: string): Promise<void> {
  let info;
  try { info = await lstat(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw fail("VSUP_NOT_FOUND", "Run was not found.");
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || wrongOwner(info.uid)) {
    throw fail("VSUP_INVALID_STATE", `An unsafe ${label} was found in the isolated session namespace; inspect it manually.`);
  }
}

async function assertCanonicalPath(target: string, label: string): Promise<void> {
  const canonical = await realpath(target).catch(() => undefined);
  if (canonical !== path.resolve(target)) throw fail("VSUP_INVALID_STATE", `The ${label} path changed or resolves through a link; inspect it manually.`);
}

async function assertSessionUsable(home: string): Promise<boolean> {
  try {
    await assertPrivateDirectory(home, "session directory");
    await assertCanonicalPath(home, "session directory");
  } catch (error) {
    if ((error as { code?: unknown }).code === "VSUP_NOT_FOUND") return false;
    throw new UnsafeSession((error as Error).message);
  }
  const runs = path.join(home, "runs");
  let runRootInfo;
  try { runRootInfo = await lstat(runs); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new UnsafeSession(`The session run directory could not be inspected (${String((error as NodeJS.ErrnoException).code)}).`);
  }
  if (runRootInfo.isSymbolicLink() || !runRootInfo.isDirectory() || (runRootInfo.mode & 0o077) !== 0 || wrongOwner(runRootInfo.uid)) {
    throw new UnsafeSession("An unsafe run directory was found in the isolated session namespace; inspect it manually.");
  }
  return true;
}

async function holdsRun(home: string, runId: string): Promise<boolean> {
  const runDirectory = path.join(home, "runs", runId);
  let info;
  try { info = await lstat(runDirectory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || wrongOwner(info.uid)) {
    throw fail("VSUP_INVALID_STATE", "An unsafe run path was found in the isolated session namespace; inspect it manually.");
  }
  await assertCanonicalPath(runDirectory, "run directory");
  const metadata = path.join(runDirectory, "meta.json");
  try {
    const metaInfo = await lstat(metadata);
    if (metaInfo.isSymbolicLink() || !metaInfo.isFile() || metaInfo.size > MAX_META_BYTES || wrongOwner(metaInfo.uid) || (metaInfo.mode & 0o077) !== 0) {
      throw fail("VSUP_INVALID_STATE", "An unsafe run record was found in the isolated session namespace; inspect it manually.");
    }
    const handle = await open(metadata, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return true;
}

interface Lookup { sessions: string; currentHome: string; report: (home: string, message: string) => void }

async function locate(lookup: Lookup, runId: string): Promise<string> {
  if (!UUID_V4.test(runId)) throw fail("VSUP_NOT_FOUND", "Run was not found.");
  const { sessions, currentHome } = lookup;
  await assertPrivateDirectory(sessions, "session root");
  await assertCanonicalPath(sessions, "session root");
  const matches: string[] = [];
  try {
    if (await assertSessionUsable(currentHome) && await holdsRun(currentHome, runId)) matches.push(currentHome);
  } catch (error) {
    if (error instanceof UnsafeSession) throw fail("VSUP_INVALID_STATE", error.message);
    throw error;
  }
  const siblings = (await readdir(sessions)).filter(name => SESSION_NAME.test(name) && path.join(sessions, name) !== currentHome).sort();
  const scanned = siblings.slice(0, MAX_SIBLING_SESSIONS);
  const skipped: string[] = [];
  for (const name of scanned) {
    const home = path.join(sessions, name);
    try {
      if (await assertSessionUsable(home) && await holdsRun(home, runId)) matches.push(home);
    } catch (error) {
      if (!(error instanceof UnsafeSession)) throw error;
      skipped.push(name);
      lookup.report(home, error.message);
    }
  }
  if (matches.length > 1) throw fail("VSUP_INVALID_STATE", "The run ID appears in multiple isolated sessions; no session was changed.");
  if (matches.length === 1) return matches[0]!;
  const unscanned = siblings.length - scanned.length;
  const notes = [
    ...(skipped.length ? [`${skipped.length} unsafe or unreadable session director${skipped.length === 1 ? "y was" : "ies were"} skipped`] : []),
    ...(unscanned ? [`${unscanned} session director${unscanned === 1 ? "y was" : "ies were"} beyond the scan limit of ${MAX_SIBLING_SESSIONS}`] : [])
  ];
  const details = { ...(skipped.length ? { skipped_sessions: skipped } : {}), ...(unscanned ? { unscanned_sessions: unscanned } : {}) };
  throw fail("VSUP_NOT_FOUND", notes.length ? `Run was not found; ${notes.join(" and ")}.` : "Run was not found.", notes.length ? details : undefined);
}

async function createBorrowedManager(config: SupervisorConfig, policy: PolicySource | undefined, home: string, lookup: Lookup, runId: string): Promise<Manager> {
  const lock = await acquireOwnerLock(home).catch((error: unknown) => {
    if (isOwnerLockContention(error)) throw fail("VSUP_OWNER_LOCKED", "The isolated session is owned by another live supervisor; retry when it is available.");
    throw error;
  });
  let manager: Manager | undefined;
  try {
    const confirmedHome = await locate(lookup, runId);
    if (confirmedHome !== home) throw fail("VSUP_INVALID_STATE", "The run path changed while its session was being claimed; retry after inspection.");
    await assertPrivateDirectory(home, "session directory");
    await assertCanonicalPath(home, "session directory");
    const { RunManager } = await import("./run-manager.js");
    manager = new RunManager(config, home, [], lock, policy ? { policy } : {}) as Manager;
    await manager.initialize();
    return manager;
  } catch (error) {
    // initialize() releases its pre-acquired lock on failure.
    if (!manager) await lock.release().catch(() => undefined);
    throw error;
  }
}

/** Route existing-run operations to exactly one saved isolated session. New runs stay local. */
export function createIsolatedRunRouter(manager: Manager, options: IsolatedRunRouterOptions): RunManagerTools & { shutdown(): Promise<void> } {
  let borrowedChain: Promise<void> = Promise.resolve();
  let shuttingDown = false;
  const currentHome = path.resolve(options.currentHome);
  const reported = new Set<string>();
  const report = options.report ?? ((message: string) => writeDiagnostic(message));
  const lookup: Lookup = {
    sessions: path.resolve(options.sessions), currentHome,
    report: (home, message) => { if (reported.has(home)) return; reported.add(home); report(`isolated run lookup skipped ${home}: ${message}`); },
  };

  async function route<T>(runId: string, operation: (target: RunManagerTools) => Promise<T>): Promise<T> {
    if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
    const firstHome = await locate(lookup, runId);
    if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
    if (path.resolve(firstHome) === currentHome) return operation(manager);
    // Serialize borrowed claims and mutations within this server. The owner lock
    // coordinates the same session with other server processes.
    const pending = borrowedChain.then(async () => {
      if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
      const home = await locate(lookup, runId);
      if (path.resolve(home) === currentHome) return operation(manager);
      const borrowed = await createBorrowedManager(options.config, options.policy, home, lookup, runId);
      try {
        return await operation(borrowed);
      } finally {
        // Only RunManager decides when its lock is safe to release.
        await borrowed.shutdown();
      }
    });
    borrowedChain = pending.then(() => undefined, () => undefined);
    return pending;
  }

  return {
    reviewStart: async (input, wait) => {
      if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
      return manager.reviewStart(input, wait);
    },
    editStart: async (input, wait) => {
      if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
      return manager.editStart(input, wait);
    },
    status: async (input: StatusToolInput, wait?: WaitOptions) => {
      if (input.run_id !== undefined) return route(input.run_id, target => target.status(input, wait));
      if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
      return manager.status(input, wait);
    },
    result: (input: ResultToolInput) => route(input.run_id, target => target.result(input)),
    close: (input: CloseToolInput) => route(input.run_id, target => target.close(input)),
    async shutdown() { shuttingDown = true; await borrowedChain; },
  };
}
