import { createHash } from "node:crypto";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { listGitVisibleFiles } from "../git/worktree.js";

export interface WorkspaceHashLimits { maxFiles: number; maxBytes: number }
export const DEFAULT_HASH_LIMITS: WorkspaceHashLimits = { maxFiles: 200_000, maxBytes: 2 * 1024 * 1024 * 1024 };

export interface ManifestEntry { kind: "F" | "L" | "D"; size?: string; mtimeNs?: string; ino?: string; mode?: number; target?: string; hash?: string }
export interface WorkspaceSnapshot { sha256: string; manifest: Map<string, ManifestEntry> }

const STAT_CONCURRENCY = 32;
const READ_CHUNK = 64 * 1024;

function limitError(): Error {
  return Object.assign(new Error("Workspace snapshot exceeded its safety limits."), { code: "VSUP_OUTPUT_LIMIT" });
}

function createGate(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (work) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve)); else active += 1;
    try { return await work(); }
    finally { const next = waiting.shift(); if (next) next(); else active -= 1; }
  };
}

async function scan(root: string, limits: WorkspaceHashLimits, gate: ReturnType<typeof createGate>): Promise<Map<string, ManifestEntry>> {
  const manifest = new Map<string, ManifestEntry>();
  let failure: unknown;
  const walk = async (relative: string): Promise<void> => {
    const names = await gate(() => readdir(path.join(root, relative), { withFileTypes: true }));
    await Promise.all(names.map(async (dirent) => {
      if (failure) return;
      if (relative === "" && dirent.name === ".git") return;
      const entryPath = path.join(relative, dirent.name); const absolute = path.join(root, entryPath);
      try {
        const info = await gate(() => lstat(absolute, { bigint: true })).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
        if (!info) return;
        if (info.isSymbolicLink()) manifest.set(entryPath, { kind: "L", target: await gate(() => readlink(absolute)) });
        else if (info.isDirectory()) { manifest.set(entryPath, { kind: "D" }); if (manifest.size > limits.maxFiles) throw limitError(); await walk(entryPath); }
        else if (info.isFile()) manifest.set(entryPath, { kind: "F", size: String(info.size), mtimeNs: String(info.mtimeNs), ino: String(info.ino), mode: Number(info.mode) });
        if (manifest.size > limits.maxFiles) throw limitError();
      } catch (error) { failure ??= error; throw error; }
    }));
  };
  await walk("");
  return manifest;
}

async function hashFile(file: string, gate: ReturnType<typeof createGate>): Promise<string> {
  return await gate(async () => {
    const digest = createHash("sha256");
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.allocUnsafe(READ_CHUNK);
      while (true) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break; digest.update(buffer.subarray(0, bytesRead)); }
    } finally { await handle.close(); }
    return digest.digest("hex");
  });
}

function manifestDigest(manifest: Map<string, ManifestEntry>): string {
  const digest = createHash("sha256");
  for (const key of [...manifest.keys()].sort()) {
    const entry = manifest.get(key)!;
    digest.update(`${entry.kind}${key}\0${entry.size ?? ""}\0${entry.mtimeNs ?? ""}\0${entry.ino ?? ""}\0${entry.mode ?? ""}\0${entry.target ?? ""}\0${entry.hash ?? ""}\0`);
  }
  return digest.digest("hex");
}

export async function snapshotWorkspace(root: string, limits: WorkspaceHashLimits = DEFAULT_HASH_LIMITS): Promise<WorkspaceSnapshot> {
  const gate = createGate(STAT_CONCURRENCY);
  const [manifest, visible] = await Promise.all([scan(root, limits, gate), listGitVisibleFiles(root)]);
  if (visible) {
    const targets = visible.filter((file) => manifest.get(file)?.kind === "F");
    let hashed = 0;
    for (const file of targets) { hashed += Number(manifest.get(file)!.size); if (hashed > limits.maxBytes) throw limitError(); }
    await Promise.all(targets.map(async (file) => { manifest.get(file)!.hash = await hashFile(path.join(root, file), gate); }));
  }
  return { sha256: manifestDigest(manifest), manifest };
}

export async function hashWorkspace(root: string, limits: WorkspaceHashLimits = DEFAULT_HASH_LIMITS): Promise<string> {
  return (await snapshotWorkspace(root, limits)).sha256;
}

function statChanged(before: ManifestEntry, after: ManifestEntry): boolean {
  if (before.kind !== after.kind) return true;
  if (before.kind === "D") return false;
  if (before.kind === "L") return before.target !== after.target;
  return before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ino !== after.ino || before.mode !== after.mode;
}

export async function changedSinceSnapshot(root: string, launch: Map<string, ManifestEntry>, limits: WorkspaceHashLimits = DEFAULT_HASH_LIMITS): Promise<string[]> {
  const gate = createGate(STAT_CONCURRENCY);
  const current = await scan(root, limits, gate);
  const changed: string[] = [];
  const touched: string[] = [];
  for (const [file, before] of launch) {
    const after = current.get(file);
    if (!after) changed.push(file);
    else if (statChanged(before, after)) { if (before.hash !== undefined && before.kind === "F" && after.kind === "F" && before.mode === after.mode) touched.push(file); else changed.push(file); }
  }
  for (const file of current.keys()) if (!launch.has(file)) changed.push(file);
  let hashed = 0;
  for (const file of touched) { hashed += Number(current.get(file)!.size); if (hashed > limits.maxBytes) throw limitError(); }
  await Promise.all(touched.map(async (file) => {
    const digest = await hashFile(path.join(root, file), gate).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
    if (digest !== launch.get(file)!.hash) changed.push(file);
  }));
  return changed.sort();
}
