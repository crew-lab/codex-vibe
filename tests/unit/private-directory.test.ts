import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { chmod, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPrivateDir } from '../../src/security/paths.js';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, chmod: vi.fn(original.chmod) };
});
const directories: string[] = [];
async function tempDir() { const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-private-directory-')); directories.push(directory); return directory; }
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.chmod).mockReset();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
describe('private directory preparation', () => {
  it('verifies already-private owned directories without chmod', async () => {
    const dir = await tempDir();
    await chmod(dir, 0o700);
    const change = vi.spyOn(fs, 'chmod').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EPERM' }));
    change.mockClear();
    await expect(createPrivateDir(dir)).resolves.toBeUndefined();
    expect(change).not.toHaveBeenCalled();
  });

  it('does not accept insecure permissions when permission repair is denied', async () => {
    const dir = await tempDir();
    await chmod(dir, 0o755);
    vi.spyOn(fs, 'chmod').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EPERM' }));
    await expect(createPrivateDir(dir)).rejects.toMatchObject({ code: 'EPERM' });
    expect((await stat(dir)).mode & 0o777).toBe(0o755);
  });

  it('rejects a foreign-owned private directory before chmod', async () => {
    const dir = await tempDir();
    const uid = process.getuid!();
    vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    const change = vi.spyOn(fs, 'chmod');
    await expect(createPrivateDir(dir)).rejects.toThrow('owned by the current user');
    expect(change).not.toHaveBeenCalled();
  });

 });
