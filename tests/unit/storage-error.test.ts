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
    if (code !== 'EMFILE') expect(mapped.remediation).toMatch(/permissions and disk space/);
    expect(storageErrorDetails(mapped)).toEqual({ code, directory: '/data/runs/abc' });
  });

  it.each([
    ['ENOSPC', /disk is full/],
    ['EDQUOT', /quota/],
    ['EACCES', /not permitted/],
    ['EPERM', /not permitted/],
    ['EROFS', /read-only/],
    ['EIO', /I\/O error/],
    ['EMFILE', /file descriptors/],
  ])('gives %s its own accurate message', (code, pattern) => {
    const mapped = asStorageError(Object.assign(new Error('x'), { code, path: '/data/runs/abc/meta.json' }), '/fallback') as Error;
    expect(mapped.message).toMatch(pattern);
    expect(mapped.message).toContain(code);
  });

  it('tells the operator to raise the file descriptor limit instead of blaming permissions or disk space for EMFILE', () => {
    const mapped = asStorageError(Object.assign(new Error('x'), { code: 'EMFILE' }), '/fallback') as Error & { remediation: string };
    expect(mapped.message).not.toMatch(/permissions|disk space/);
    expect(mapped.remediation).toMatch(/limit/);
    expect(mapped.remediation).not.toMatch(/permissions and disk space/);
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

describe('event log structural faults', () => {
  it.each([
    ['ENOENT', /disappeared/],
    ['EISDIR', /directory instead of a regular file/],
    ['ELOOP', /symbolic link/],
    ['ENOTDIR', /not a directory/],
  ])('maps %s to an accurate VSUP_STORAGE_ERROR only for the event log', (code, pattern) => {
    const error = Object.assign(new Error('x'), { code, path: '/data/runs/abc/events.ndjson' });
    const mapped = asStorageError(error, '/fallback', { eventLog: true }) as Error & { code: string; details: Record<string, unknown>; remediation: string };
    expect(mapped.code).toBe('VSUP_STORAGE_ERROR');
    expect(mapped.message).toMatch(pattern);
    expect(mapped.message).toContain(code);
    expect(mapped.details).toEqual({ code, directory: '/data/runs/abc' });
    expect(mapped.remediation).not.toMatch(/disk space/);
    expect(asStorageError(error, '/fallback')).toBe(error);
  });
});
