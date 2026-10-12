import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { acquireOwnerLock, inspectOwnerLock, isOwnerLockContention } from "./owner-lock.js";
import type { OwnerLock } from "./owner-lock.js";
import { runFromWire } from "./serialization.js";

export const SESSION_NAME = /^session-[A-Za-z0-9]{6}$/;
const TOMBSTONE_NAME = /^\.pruned-session-[A-Za-z0-9]{6}-[0-9a-f]{16}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIG_TEMPORARY = /^config\.toml\.\d+\.\d+\.tmp$/;
const DAY_MS = 86_400_000;
const MAX_META_BYTES = 1_048_576;
export const MAX_SESSIONS_PER_SWEEP = 64;
export const MAX_RUNS_PER_SESSION = 256;
const REMOVABLE_RUN_STATES: ReadonlySet<string> = new Set(["closed", "cancelled"]);

export type KeptSessionReason =
  | "unsafe_namespace" | "unsafe" | "recently_used" | "live_owner" | "lock_unavailable"
  | "run_retained" | "worktree_retained" | "unreadable" | "unexpected_entry" | "too_many_runs"
  | "changed_during_sweep" | "removal_failed" | "deferred";

export interface KeptSession { session: string; path: string; reason: KeptSessionReason; message: string }
export interface SessionSweep { pruned_sessions: string[]; kept_sessions: KeptSession[] }

export interface SessionSweepOptions {
  sessions: string;
  retentionDays: number;
  currentHome?: string;
  now?: () => number;
  stopping?: () => boolean;
  maxSessions?: number;
}

const QUIET_REASONS: ReadonlySet<KeptSessionReason> = new Set(["recently_used", "live_owner", "run_retained", "worktree_retained", "deferred"]);

export function needsAttention(entry: KeptSession): boolean {
  return !QUIET_REASONS.has(entry.reason);
}

class Keep extends Error {
  constructor(readonly reason: KeptSessionReason, message: string) { super(message); }
}

function ownedPrivate(info: Stats): boolean {
  const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
  return !info.isSymbolicLink() && (owner === undefined || info.uid === owner) && (info.mode & 0o077) === 0;
}

async function optionalLstat(target: string): Promise<Stats | undefined> {
  try { return await lstat(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

async function assertSessionDirectory(root: string, name: string): Promise<Stats> {
  const directory = path.join(root, name);
  const info = await lstat(directory);
  if (!info.isDirectory() || !ownedPrivate(info)) throw new Keep("unsafe", "The session directory is a link, not a directory, not owner-only or owned by another user; inspect it manually.");
  if (await realpath(directory) !== directory) throw new Keep("unsafe", "The session directory resolves outside the session namespace; inspect it manually.");
  return info;
}

async function readRunRecord(file: string): Promise<unknown> {
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_META_BYTES || !ownedPrivate(info)) throw new Error("unsafe run record");
    return JSON.parse(await handle.readFile("utf8")) as unknown;
  } finally { await handle.close(); }
}

async function assertRunsRemovable(runs: string, cutoff: number): Promise<void> {
  const info = await lstat(runs);
  if (!info.isDirectory() || !ownedPrivate(info)) throw new Keep("unsafe", "The session run directory is unsafe; inspect it manually.");
  const entries = await readdir(runs);
  if (entries.length > MAX_RUNS_PER_SESSION) throw new Keep("too_many_runs", `The session holds more than ${MAX_RUNS_PER_SESSION} run entries; inspect it manually.`);
  for (const name of entries.sort()) {
    if (!UUID_V4.test(name)) throw new Keep("unexpected_entry", `The session run directory holds an unexpected entry ${name}.`);
    const directory = path.join(runs, name);
    const runInfo = await lstat(directory);
    if (!runInfo.isDirectory() || !ownedPrivate(runInfo)) throw new Keep("unsafe", `Run ${name} has an unsafe directory; inspect it manually.`);
    let record;
    try { record = runFromWire(await readRunRecord(path.join(directory, "meta.json"))); }
    catch { throw new Keep("unreadable", `Run ${name} has a record this release cannot read; it was left in place.`); }
    if (record.runId !== name) throw new Keep("unreadable", `Run ${name} has a record for a different run; it was left in place.`);
    if (record.worktree) throw new Keep("worktree_retained", `Run ${name} still records a worktree.`);
    if (!REMOVABLE_RUN_STATES.has(record.state)) throw new Keep("run_retained", `Run ${name} is ${record.state}; retention does not remove it.`);
    const updatedAt = Date.parse(record.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt > cutoff) throw new Keep("run_retained", `Run ${name} was updated within the retention period.`);
  }
}

async function assertContentsRemovable(home: string, cutoff: number): Promise<void> {
  for (const name of (await readdir(home)).sort()) {
    const entry = path.join(home, name);
    const info = await lstat(entry);
    if (name === "config.toml" || name === "supervisor.lock" || CONFIG_TEMPORARY.test(name)) {
      if (!info.isFile() || !ownedPrivate(info)) throw new Keep("unsafe", `The session file ${name} is unsafe; inspect it manually.`);
      if (name !== "supervisor.lock" && info.mtimeMs > cutoff) throw new Keep("recently_used", "The session was adopted within the retention period.");
      continue;
    }
    if (name === "worktrees") {
      if (!info.isDirectory() || !ownedPrivate(info)) throw new Keep("unsafe", "The session worktree directory is unsafe; inspect it manually.");
      if ((await readdir(entry)).length > 0) throw new Keep("worktree_retained", "The session still holds a worktree directory.");
      continue;
    }
    if (name === "runs") {
      if (info.mtimeMs > cutoff) throw new Keep("recently_used", "A run was created or removed in the session within the retention period.");
      await assertRunsRemovable(entry, cutoff);
      continue;
    }
    throw new Keep("unexpected_entry", `The session holds an unexpected entry ${name}; inspect it manually.`);
  }
}

async function assertNoLiveOwner(home: string): Promise<void> {
  const status = await inspectOwnerLock(home);
  if (!status.held) return;
  if (status.owner === "alive") throw new Keep("live_owner", `The session is owned by a live supervisor (pid ${status.pid}).`);
  if (status.owner === "malformed") throw new Keep("lock_unavailable", "The session owner lock is malformed; inspect it manually.");
}

async function claim(home: string): Promise<OwnerLock> {
  try { return await acquireOwnerLock(home); }
  catch (error) {
    if (isOwnerLockContention(error)) throw new Keep("live_owner", "The session is owned by a live supervisor or another sweep.");
    throw new Keep("lock_unavailable", `The session owner lock could not be taken: ${(error as Error).message}`);
  }
}

async function pruneOne(root: string, name: string, cutoff: number): Promise<void> {
  const home = path.join(root, name);
  const before = await assertSessionDirectory(root, name);
  if (before.mtimeMs > cutoff) throw new Keep("recently_used", "The session was used within the retention period.");
  await assertNoLiveOwner(home);
  await assertContentsRemovable(home, cutoff);
  const lock = await claim(home);
  let moved = false;
  try {
    const held = await assertSessionDirectory(root, name);
    if (held.ino !== before.ino || held.dev !== before.dev) throw new Keep("changed_during_sweep", "The session directory was replaced during the sweep.");
    await assertContentsRemovable(home, cutoff);
    const tombstone = path.join(root, `.pruned-${name}-${randomBytes(8).toString("hex")}`);
    await rename(home, tombstone);
    moved = true;
    try { await rm(tombstone, { recursive: true, force: true }); }
    catch (error) { throw new Keep("removal_failed", `The session was retired to ${tombstone} but could not be removed: ${(error as Error).message}`); }
  } finally {
    if (!moved) await lock.release();
  }
}

async function removeTombstone(root: string, name: string): Promise<void> {
  const tombstone = path.join(root, name);
  const info = await lstat(tombstone);
  if (!info.isDirectory() || !ownedPrivate(info)) throw new Keep("unsafe", "A retired session entry is unsafe; inspect it manually.");
  await rm(tombstone, { recursive: true, force: true });
}

function keep(root: string, name: string, error: unknown): KeptSession {
  const target = path.join(root, name);
  if (error instanceof Keep) return { session: name, path: target, reason: error.reason, message: error.message };
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return { session: name, path: target, reason: "unreadable", message: `The session could not be inspected${typeof code === "string" ? ` (${code})` : ""}; it was left in place.` };
}

export async function pruneIsolatedSessions(options: SessionSweepOptions): Promise<SessionSweep> {
  const now = options.now ?? Date.now;
  const stopping = options.stopping ?? (() => false);
  const limit = options.maxSessions ?? MAX_SESSIONS_PER_SWEEP;
  const cutoff = now() - options.retentionDays * DAY_MS;
  const sweep: SessionSweep = { pruned_sessions: [], kept_sessions: [] };
  const requested = path.resolve(options.sessions);
  const rootInfo = await optionalLstat(requested);
  if (!rootInfo) return sweep;
  let root: string;
  try {
    if (!rootInfo.isDirectory() || !ownedPrivate(rootInfo)) throw new Error("unsafe");
    root = await realpath(requested);
  } catch {
    sweep.kept_sessions.push({ session: path.basename(requested), path: requested, reason: "unsafe_namespace", message: "The isolated session namespace is not a private directory; nothing was pruned." });
    return sweep;
  }
  const currentHome = options.currentHome;
  const current = currentHome === undefined ? undefined : await realpath(currentHome).catch(() => path.resolve(currentHome));
  const names = (await readdir(root)).sort();
  let budget = limit;
  for (const name of names) {
    if (!TOMBSTONE_NAME.test(name)) continue;
    if (stopping() || budget <= 0) break;
    budget -= 1;
    try { await removeTombstone(root, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") sweep.kept_sessions.push(keep(root, name, error)); }
  }
  const candidates: Array<{ name: string; usedAt: number }> = [];
  for (const name of names) {
    if (!SESSION_NAME.test(name) || path.join(root, name) === current) continue;
    const info = await lstat(path.join(root, name)).catch(() => undefined);
    candidates.push({ name, usedAt: info?.mtimeMs ?? 0 });
  }
  candidates.sort((a, b) => a.usedAt - b.usedAt || a.name.localeCompare(b.name));
  for (const { name } of candidates) {
    if (stopping()) break;
    if (budget <= 0) {
      sweep.kept_sessions.push({ session: name, path: path.join(root, name), reason: "deferred", message: `The sweep inspects at most ${limit} entries; this session waits for the next sweep.` });
      continue;
    }
    budget -= 1;
    try { await pruneOne(root, name, cutoff); sweep.pruned_sessions.push(name); }
    catch (error) {
      if (!(error instanceof Keep) && !await optionalLstat(path.join(root, name)).catch(() => true)) continue;
      sweep.kept_sessions.push(keep(root, name, error));
    }
  }
  return sweep;
}
