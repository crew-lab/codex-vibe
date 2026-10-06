import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireOwnerLock, inspectOwnerLock } from "../../src/core/owner-lock.js";
import type { OwnerLockDeps, OwnerLockFs } from "../../src/core/owner-lock.js";

const DATA = "/data";
const LOCK = `${DATA}/supervisor.lock`;
const RECOVERY = `${DATA}/supervisor.lock.recovery`;
const NOW = Date.parse("2026-10-06T12:00:00.000Z");

interface Entry { content: string; mtimeMs: number }

function memoryFs(files: Record<string, Entry> = {}) {
  const store = new Map<string, Entry>(Object.entries(files));
  const writes: string[] = [];
  const fs: OwnerLockFs = {
    async createExclusive(file, content) {
      if (store.has(file)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      store.set(file, { content, mtimeMs: NOW }); writes.push(file);
    },
    async stat(file) {
      const entry = store.get(file);
      if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { isFile: true, isSymbolicLink: false, size: Buffer.byteLength(entry.content), mtimeMs: entry.mtimeMs };
    },
    async read(file) {
      const entry = store.get(file);
      if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return entry.content;
    },
    async remove(file) { store.delete(file); }
  };
  return { store, fs, writes };
}

function lockText(pid: number, startedAt = new Date(NOW - 60_000).toISOString()): string {
  return JSON.stringify({ pid, token: "other-token", started_at: startedAt });
}

function harness(files: Record<string, Entry> = {}, overrides: Partial<OwnerLockDeps> = {}) {
  const memory = memoryFs(files);
  const kills: Array<[number, unknown]> = [];
  const sleeps: number[] = [];
  const startTimeCalls: number[] = [];
  const deps: Partial<OwnerLockDeps> = {
    fs: memory.fs, pid: 4242, now: () => NOW,
    kill: (pid, signal) => { kills.push([pid, signal]); throw Object.assign(new Error("no such process"), { code: "ESRCH" }); },
    processStartTime: async (pid) => { startTimeCalls.push(pid); return undefined; },
    sleep: async (ms) => { sleeps.push(ms); },
    ...overrides
  };
  return { ...memory, deps, kills, sleeps, startTimeCalls };
}

const alive = () => undefined;
const fresh = (content: string): Entry => ({ content, mtimeMs: NOW - 100 });
const old = (content: string): Entry => ({ content, mtimeMs: NOW - 60_000 });

describe("owner lock", () => {
  it("acquires a free data directory without spawning a process-time lookup", async () => {
    const h = harness();
    const lock = await acquireOwnerLock(DATA, h.deps);
    expect(lock.path).toBe(LOCK);
    expect(JSON.parse(h.store.get(LOCK)!.content)).toMatchObject({ pid: 4242, token: lock.token });
    expect(h.startTimeCalls).toEqual([]);
    expect(h.kills).toEqual([]);
  });

  it("takes over a lock whose owner process is dead", async () => {
    const h = harness({ [LOCK]: old(lockText(9001)) });
    const lock = await acquireOwnerLock(DATA, h.deps);
    expect(JSON.parse(h.store.get(LOCK)!.content)).toMatchObject({ pid: 4242, token: lock.token });
    expect(h.kills).toEqual([[9001, 0]]);
    expect(h.store.has(RECOVERY)).toBe(false);
  });

  it("refuses a live owner whose start time matches the lock and names the path, pid and remedy", async () => {
    const startedAt = new Date(NOW - 60_000).toISOString();
    const h = harness({ [LOCK]: old(lockText(9001, startedAt)) }, { kill: alive, processStartTime: async () => NOW - 3_600_000 });
    const failure = await acquireOwnerLock(DATA, h.deps).then(() => undefined, (error: unknown) => error as { code: string; message: string; details?: Record<string, unknown> });
    expect(failure).toMatchObject({ code: "VSUP_INVALID_STATE", details: { lock_path: LOCK, owner_pid: 9001 } });
    expect(failure?.message).toContain(LOCK);
    expect(failure?.message).toContain("9001");
    expect(failure?.message).toContain("VIBE_SUPERVISOR_HOME");
    expect(JSON.parse(h.store.get(LOCK)!.content)).toMatchObject({ pid: 9001 });
    expect(h.store.has(RECOVERY)).toBe(false);
  });

  it("treats a live pid that started clearly after the lock was written as reused and never signals it", async () => {
    const kills: Array<[number, unknown]> = [];
    const startedAt = new Date(NOW - 3_600_000).toISOString();
    const h = harness({ [LOCK]: old(lockText(9001, startedAt)) }, { kill: (pid, signal) => { kills.push([pid, signal]); }, processStartTime: async () => NOW - 60_000 });
    const lock = await acquireOwnerLock(DATA, h.deps);
    expect(JSON.parse(h.store.get(LOCK)!.content)).toMatchObject({ pid: 4242, token: lock.token });
    expect(kills.every(([, signal]) => signal === 0)).toBe(true);
  });

  it("keeps a live owner whose process started only slightly after the lock timestamp", async () => {
    const startedAt = new Date(NOW - 60_000).toISOString();
    const h = harness({ [LOCK]: old(lockText(9001, startedAt)) }, { kill: alive, processStartTime: async () => NOW - 60_000 + 3_000 });
    await expect(acquireOwnerLock(DATA, h.deps)).rejects.toMatchObject({ code: "VSUP_INVALID_STATE", details: { owner_pid: 9001 } });
  });

  it("keeps refusing when the process start time cannot be determined", async () => {
    const h = harness({ [LOCK]: old(lockText(9001)) }, { kill: alive, processStartTime: async () => undefined });
    await expect(acquireOwnerLock(DATA, h.deps)).rejects.toMatchObject({ code: "VSUP_INVALID_STATE", details: { lock_path: LOCK, owner_pid: 9001 } });
    expect(h.startTimeCalls).toEqual([]);
  });

  it("keeps refusing when the lock timestamp is unparsable", async () => {
    const h = harness({ [LOCK]: old(lockText(9001, "yesterday-ish")) }, { kill: alive, processStartTime: async () => NOW });
    await expect(acquireOwnerLock(DATA, h.deps)).rejects.toMatchObject({ code: "VSUP_INVALID_STATE", details: { owner_pid: 9001 } });
  });

  it("removes a stale recovery lock and retries once", async () => {
    const h = harness({ [LOCK]: old(lockText(9001)), [RECOVERY]: { content: JSON.stringify({ pid: 1, token: "x" }), mtimeMs: NOW - 31_000 } });
    const lock = await acquireOwnerLock(DATA, h.deps);
    expect(JSON.parse(h.store.get(LOCK)!.content)).toMatchObject({ pid: 4242, token: lock.token });
    expect(h.store.has(RECOVERY)).toBe(false);
  });

  it("refuses while a recent recovery lock is held by another process", async () => {
    const h = harness({ [LOCK]: old(lockText(9001)), [RECOVERY]: { content: JSON.stringify({ pid: 1, token: "x" }), mtimeMs: NOW - 5_000 } });
    await expect(acquireOwnerLock(DATA, h.deps)).rejects.toMatchObject({ code: "VSUP_INVALID_STATE", message: expect.stringContaining("recovering") });
    expect(h.store.has(RECOVERY)).toBe(true);
  });

  it("re-reads a fresh empty lock until its owner finishes writing it", async () => {
    const h = harness({ [LOCK]: fresh("") }, { kill: alive, processStartTime: async () => NOW - 3_600_000 });
    let reads = 0;
    const original = h.deps.fs!.read;
    h.deps.fs = { ...h.deps.fs!, read: async (file) => { if (file === LOCK && ++reads === 3) h.store.set(LOCK, fresh(lockText(9001))); return original(file); } };
    await expect(acquireOwnerLock(DATA, h.deps)).rejects.toMatchObject({ code: "VSUP_INVALID_STATE", details: { owner_pid: 9001 } });
    expect(h.sleeps).toEqual([250, 250]);
  });

  it("declares a fresh lock that stays empty malformed after four re-reads", async () => {
    const h = harness({ [LOCK]: fresh("") });
    await expect(acquireOwnerLock(DATA, h.deps)).rejects.toMatchObject({ code: "VSUP_INVALID_STATE", message: expect.stringContaining("malformed"), details: { lock_path: LOCK } });
    expect(h.sleeps).toEqual([250, 250, 250, 250]);
    expect(h.store.has(LOCK)).toBe(true);
  });

  it("declares an old empty lock malformed without waiting", async () => {
    const h = harness({ [LOCK]: old("{not json") });
    await expect(acquireOwnerLock(DATA, h.deps)).rejects.toMatchObject({ code: "VSUP_INVALID_STATE", message: expect.stringContaining("malformed") });
    expect(h.sleeps).toEqual([]);
  });

  it("releases only a lock that still carries its own token", async () => {
    const h = harness();
    const lock = await acquireOwnerLock(DATA, h.deps);
    h.store.set(LOCK, fresh(lockText(777)));
    await lock.release();
    expect(h.store.has(LOCK)).toBe(true);
    const second = harness();
    const own = await acquireOwnerLock(DATA, second.deps);
    await own.release();
    expect(second.store.has(LOCK)).toBe(false);
  });

  it("inspects a lock without removing it", async () => {
    const free = harness();
    await expect(inspectOwnerLock(DATA, free.deps)).resolves.toEqual({ path: LOCK, held: false });
    const dead = harness({ [LOCK]: old(lockText(9001)) });
    await expect(inspectOwnerLock(DATA, dead.deps)).resolves.toMatchObject({ held: true, pid: 9001, owner: "stale" });
    expect(dead.store.has(LOCK)).toBe(true);
    const live = harness({ [LOCK]: old(lockText(9001)) }, { kill: alive, processStartTime: async () => NOW - 3_600_000 });
    await expect(inspectOwnerLock(DATA, live.deps)).resolves.toMatchObject({ held: true, pid: 9001, owner: "alive" });
    const reused = harness({ [LOCK]: old(lockText(9001, new Date(NOW - 3_600_000).toISOString())) }, { kill: alive, processStartTime: async () => NOW - 60_000 });
    await expect(inspectOwnerLock(DATA, reused.deps)).resolves.toMatchObject({ held: true, pid: 9001, owner: "stale" });
    const broken = harness({ [LOCK]: old("garbage") });
    await expect(inspectOwnerLock(DATA, broken.deps)).resolves.toMatchObject({ held: true, owner: "malformed" });
  });
});

describe("owner lock on the real filesystem", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it("excludes a second owner in the same process and frees the directory on release", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vsup-lock-"))); roots.push(root);
    const first = await acquireOwnerLock(root);
    await expect(acquireOwnerLock(root)).rejects.toMatchObject({ code: "VSUP_INVALID_STATE", details: { owner_pid: process.pid, lock_path: join(root, "supervisor.lock") } });
    expect((await stat(join(root, "supervisor.lock"))).mode & 0o777).toBe(0o600);
    await first.release();
    const second = await acquireOwnerLock(root);
    expect(JSON.parse(await readFile(join(root, "supervisor.lock"), "utf8"))).toMatchObject({ pid: process.pid, token: second.token });
    await second.release();
  });
});
