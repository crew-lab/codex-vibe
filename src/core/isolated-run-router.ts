import { lstat, open, readdir, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { supervisorError, type CloseToolInput, type ResultToolInput, type StatusToolInput, type WaitOptions } from "../contracts.js";
import type { SupervisorConfig } from "../contracts.js";
import { acquireOwnerLock, isOwnerLockContention } from "./owner-lock.js";
import type { RunManagerTools } from "../mcp/tools.js";
import type { PolicySource } from "../config/policy.js";

const SESSION_NAME = /^session-[A-Za-z0-9]{6}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSION_DIRECTORIES = 128;
const MAX_META_BYTES = 1_048_576;
type Manager = RunManagerTools & { initialize(): Promise<void>; shutdown(): Promise<{ timedOut: boolean }> };

export interface IsolatedRunRouterOptions {
  sessions: string;
  currentHome: string;
  config: SupervisorConfig;
  policy?: PolicySource;
  preparationDataDir?: string;
}

function fail(code: "VSUP_NOT_FOUND" | "VSUP_INVALID_STATE" | "VSUP_STORAGE_ERROR" | "VSUP_OWNER_LOCKED", message: string): Error {
  return Object.assign(new Error(message), supervisorError(code, message));
}

async function assertPrivateDirectory(directory: string, label: string): Promise<void> {
  let info;
  try { info = await lstat(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw fail("VSUP_NOT_FOUND", "Run was not found.");
    throw error;
  }
  const wrongOwner = typeof process.getuid === "function" && info.uid !== process.getuid();
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || wrongOwner) {
    throw fail("VSUP_INVALID_STATE", `An unsafe ${label} was found in the isolated session namespace; inspect it manually.`);
  }
}

async function assertCanonicalPath(target: string, label: string): Promise<void> {
  const canonical = await realpath(target).catch(() => undefined);
  if (canonical !== path.resolve(target)) throw fail("VSUP_INVALID_STATE", `The ${label} path changed or resolves through a link; inspect it manually.`);
}

/** Find a UUID only inside the bounded, private sibling-session namespace. */
async function locate(sessions: string, runId: string): Promise<string> {
  if (!UUID_V4.test(runId)) throw fail("VSUP_NOT_FOUND", "Run was not found.");
  await assertPrivateDirectory(sessions, "session root");
  await assertCanonicalPath(sessions, "session root");
  const entries = await readdir(sessions);
  if (entries.length > MAX_SESSION_DIRECTORIES) throw fail("VSUP_INVALID_STATE", "The isolated session namespace exceeds its safe scan limit; inspect it manually.");
  const matches: string[] = [];
  for (const name of entries) {
    if (!SESSION_NAME.test(name)) continue;
    const home = path.join(sessions, name);
    await assertPrivateDirectory(home, "session directory");
    await assertCanonicalPath(home, "session directory");
    const runs = path.join(home, "runs");
    let runRootInfo;
    try { runRootInfo = await lstat(runs); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const wrongOwner = typeof process.getuid === "function" && runRootInfo.uid !== process.getuid();
    if (runRootInfo.isSymbolicLink() || !runRootInfo.isDirectory() || (runRootInfo.mode & 0o077) !== 0 || wrongOwner) {
      throw fail("VSUP_INVALID_STATE", "An unsafe run directory was found in the isolated session namespace; inspect it manually.");
    }
    const runDirectory = path.join(runs, runId);
    try {
      const info = await lstat(runDirectory);
      const runWrongOwner = typeof process.getuid === "function" && info.uid !== process.getuid();
      if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || runWrongOwner) {
        throw fail("VSUP_INVALID_STATE", "An unsafe run path was found in the isolated session namespace; inspect it manually.");
      }
      await assertCanonicalPath(runDirectory, "run directory");
      const metadata = path.join(runDirectory, "meta.json");
      try {
        const metaInfo = await lstat(metadata);
        const metaWrongOwner = typeof process.getuid === "function" && metaInfo.uid !== process.getuid();
        if (metaInfo.isSymbolicLink() || !metaInfo.isFile() || metaInfo.size > MAX_META_BYTES || metaWrongOwner || (metaInfo.mode & 0o077) !== 0) {
          throw fail("VSUP_INVALID_STATE", "An unsafe run record was found in the isolated session namespace; inspect it manually.");
        }
        // Open without following a replacement symlink after the lstat check.
        const handle = await open(metadata, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        await handle.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      matches.push(home);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (matches.length === 0) throw fail("VSUP_NOT_FOUND", "Run was not found.");
  if (matches.length !== 1) throw fail("VSUP_INVALID_STATE", "The run ID appears in multiple isolated sessions; no session was changed.");
  return matches[0]!;
}

async function createBorrowedManager(config: SupervisorConfig, policy: PolicySource | undefined, home: string, sessions: string, runId: string, preparationDataDir?: string): Promise<Manager> {
  const lock = await acquireOwnerLock(home).catch((error: unknown) => {
    if (isOwnerLockContention(error)) throw fail("VSUP_OWNER_LOCKED", "The isolated session is owned by another live supervisor; retry when it is available.");
    throw error;
  });
  let manager: Manager | undefined;
  try {
    const confirmedHome = await locate(sessions, runId);
    if (confirmedHome !== home) throw fail("VSUP_INVALID_STATE", "The run path changed while its session was being claimed; retry after inspection.");
    await assertPrivateDirectory(home, "session directory");
    await assertCanonicalPath(home, "session directory");
    const { RunManager } = await import("./run-manager.js");
    manager = new RunManager(config, home, [], lock, {
      ...(policy ? { policy } : {}),
      ...(preparationDataDir ? { preparationDataDir } : {})
    }) as Manager;
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
  const sessions = path.resolve(options.sessions);

  async function route<T>(runId: string, operation: (target: RunManagerTools) => Promise<T>): Promise<T> {
    if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
    const firstHome = await locate(sessions, runId);
    if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
    if (path.resolve(firstHome) === currentHome) return operation(manager);
    // Serialize borrowed claims and mutations within this server. The owner lock
    // coordinates the same session with other server processes.
    const pending = borrowedChain.then(async () => {
      if (shuttingDown) throw fail("VSUP_INVALID_STATE", "The isolated supervisor is shutting down.");
      const home = await locate(sessions, runId);
      if (path.resolve(home) === currentHome) return operation(manager);
      const borrowed = await createBorrowedManager(options.config, options.policy, home, sessions, runId, options.preparationDataDir);
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
