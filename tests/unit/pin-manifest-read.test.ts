import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const MANIFEST_NAME = 'oversized-manifest.json';
const observed = { bytes: 0 };

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open: typeof actual.open = async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if (!String(args[0]).endsWith(MANIFEST_NAME)) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === 'stat') return async () => Object.assign(await target.stat(), { size: 10 });
        if (property === 'readFile') return async (...rest: Parameters<typeof target.readFile>) => {
          const data = await target.readFile(...rest);
          observed.bytes += Buffer.byteLength(data);
          return data;
        };
        if (property === 'read') return async (...rest: unknown[]) => {
          const result = await (target.read as (...values: unknown[]) => Promise<{ bytesRead: number }>)(...rest);
          observed.bytes += result.bytesRead;
          return result;
        };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? (value as (...values: unknown[]) => unknown).bind(target) : value;
      }
    });
  };
  return { ...actual, open, default: { ...actual, open } };
});

const { AppServerBackend } = await import('../../src/backends/app-server.js');
const { DEFAULT_PIN_LIMITS } = await import('../../src/backends/app-server/pin.js');
const { DEFAULT_CONFIG } = await import('../../src/config/defaults.js');
const { makeFakeVibeEnvironment } = await import('./support/fake-vibe-environment.js');

const scratch: string[] = [];
afterEach(async () => { observed.bytes = 0; await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('pin manifest read', () => {
  it('reads at most one byte past the limit even when the file grew after it was opened', async () => {
    const base = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-pin-read-')));
    scratch.push(base);
    const fake = await makeFakeVibeEnvironment(base);
    const manifest = path.join(base, MANIFEST_NAME);
    await writeFile(manifest, Buffer.alloc(DEFAULT_PIN_LIMITS.maxManifestBytes + 256 * 1024, 0x20), { mode: 0o600 });
    const backend = new AppServerBackend({ ...DEFAULT_CONFIG, paths: { vibePinManifest: manifest } }, { executable: fake.shim });

    const probe = await backend.probe();

    expect(probe.available).toBe(false);
    expect(probe.details?.code).toBe('VSUP_VIBE_VERSION_UNSUPPORTED');
    expect(String(probe.details?.reason)).toContain('bounded regular file');
    expect(observed.bytes).toBeGreaterThan(0);
    expect(observed.bytes).toBeLessThanOrEqual(DEFAULT_PIN_LIMITS.maxManifestBytes + 1);
  });
});
