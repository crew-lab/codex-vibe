import { realpath, stat } from 'node:fs/promises';
import type { BackendCapabilities } from '../contracts.js';
import { pythonFor, resolveCommand } from './launcher.js';

export interface ProbeOptions { fresh?: boolean }

export const PROBE_SUCCESS_TTL_MS = 10 * 60_000;
export const PROBE_FAILURE_TTL_MS = 30_000;

interface Entry { key: string; expiresAt: number; value: BackendCapabilities }
interface Flight { key: string; promise: Promise<BackendCapabilities> }

/** Per-instance cache with single-flight; a changed key, expiry, or `fresh` forces a new probe. */
export class ProbeCache {
  private entry: Entry | undefined;
  private flight: Flight | undefined;

  invalidate(): void { this.entry = undefined; }

  async get(key: string, fresh: boolean, run: () => Promise<BackendCapabilities>): Promise<BackendCapabilities> {
    if (!fresh) {
      if (this.entry && this.entry.key === key && this.entry.expiresAt > Date.now()) return structuredClone(this.entry.value);
      if (this.flight && this.flight.key === key) return structuredClone(await this.flight.promise);
    }
    const promise = run();
    const flight: Flight = { key, promise };
    this.flight = flight;
    try {
      const value = await promise;
      this.entry = { key, value, expiresAt: Date.now() + (value.available ? PROBE_SUCCESS_TTL_MS : PROBE_FAILURE_TTL_MS) };
      return structuredClone(value);
    } finally {
      if (this.flight === flight) this.flight = undefined;
    }
  }
}

async function fingerprint(file: string): Promise<string> {
  const [real, info] = await Promise.all([realpath(file), stat(file)]);
  return `${file}|${real}|${info.mtimeMs}|${info.size}|${info.ino}`;
}

export async function executableProbeKey(executable: string, options: { interpreter: boolean }): Promise<string> {
  try {
    const resolved = await resolveCommand(executable, process.env);
    const parts = [await fingerprint(resolved)];
    if (options.interpreter) parts.push(await fingerprint(await pythonFor(resolved, process.env)));
    return parts.join('||');
  } catch (error) {
    return `unresolved|${executable}|${String(error)}`;
  }
}
