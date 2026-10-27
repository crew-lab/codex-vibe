import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm, lstat } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchGrants } from '../../src/core/dispatch-grants.js';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, open: vi.fn(original.open) };
});
const directories: string[] = [];
afterEach(async () => { vi.mocked(fs.open).mockReset(); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
describe('administrative grant file permissions', () => {
  it.each(['EPERM', 'EACCES'])('reports %s on actual grant-file creation without returning authorization', async code => {
    const parent = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-grant-denied-')); directories.push(parent);
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.open).mockImplementation(((file: Parameters<typeof original.open>[0], flags: Parameters<typeof original.open>[1], mode?: Parameters<typeof original.open>[2]) => {
      if (flags === 'wx') return Promise.reject(Object.assign(new Error('private path must not leak'), { code }));
      return original.open(file, flags, mode);
    }) as typeof original.open);
    const root = path.join(parent, 'dispatch-grants');
    await expect(new DispatchGrants(root).issue({ requestSha256: 'a'.repeat(64), binding: { task: 'b'.repeat(64) }, ownerReference: 'offline-fixture', expiresAt: new Date(Date.now() + 60_000).toISOString() })).rejects.toMatchObject({ code: 'VSUP_STORAGE_ERROR', details: { phase: 'grant_registration', operation: 'write_grant', code }, message: expect.stringContaining('write_grant'), remediation: expect.stringContaining('scoped administrative command permission') });
    await expect(lstat(path.join(root, 'consumed'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
