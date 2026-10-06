import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { asStorageError, storageErrorDetails, storageFaultCode } from '../../src/persistence/storage-error.js';

describe('storage error mapping', () => {
  it.each(['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO', 'EDQUOT', 'EMFILE'])('maps %s to VSUP_STORAGE_ERROR with the code and directory only', (code) => {
    const original = Object.assign(new Error(`${code}: write failed, contents=secret-body`), { code, path: '/data/runs/abc/meta.json' });
    const mapped = asStorageError(original, '/fallback') as Error & { code: string; details: Record<string, unknown>; remediation: string };
    expect(mapped.code).toBe('VSUP_STORAGE_ERROR');
    expect(mapped.details).toEqual({ code, directory: '/data/runs/abc' });
    expect(mapped.message).not.toContain('secret-body');
    expect(mapped.remediation).toMatch(/permissions and disk space/);
    expect(storageErrorDetails(mapped)).toEqual({ code, directory: '/data/runs/abc' });
  });

  it('falls back to the given directory when the error names no path', () => {
    const mapped = asStorageError(Object.assign(new Error('x'), { code: 'ENOSPC' }), 'relative/dir') as { details: { directory: string } };
    expect(mapped.details.directory).toBe(path.resolve('relative/dir'));
  });

  it('leaves unrelated errors and already-mapped errors untouched', () => {
    const plain = new Error('plain'); const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(asStorageError(plain, '/x')).toBe(plain);
    expect(asStorageError(missing, '/x')).toBe(missing);
    const mapped = asStorageError(Object.assign(new Error('x'), { code: 'EIO' }), '/x');
    expect(asStorageError(mapped, '/y')).toBe(mapped);
    expect(storageFaultCode(missing)).toBeUndefined();
    expect(storageErrorDetails(plain)).toBeUndefined();
  });
});
