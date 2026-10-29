import { chmod, link, mkdir, mkdtemp, lstat, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { assertOwnedDirectory, parseInputJson, readInputFile, readOwnedFile } from '../../src/reporting/private-files.js';
import { taskCommand } from '../../src/cli/task.js';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'intake-'));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('selected and private file intake', () => {
  it.each([0o600, 0o640, 0o644])('reads selected input with mode %s without changing it', async mode => {
    const root = await fixture(); const file = path.join(root, 'input');
    await writeFile(file, 'selected bytes', { mode }); await chmod(file, mode);
    expect(await readInputFile(file, 100, 'request')).toEqual(Buffer.from('selected bytes'));
    expect(await readFile(file, 'utf8')).toBe('selected bytes');
    expect((await lstat(file)).mode & 0o777).toBe(mode);
    if (mode !== 0o600) await expect(readOwnedFile(file, 100)).rejects.toMatchObject({ code: 'VSUP_ARTIFACT_ERROR', details: { role: 'artifact', reason: 'mode' } });
  });
  it('rejects missing, linked, writable, oversized and non-regular selections with typed reasons', async () => {
    const root = await fixture(); const file = path.join(root, 'input');
    await expect(readInputFile(path.join(root, 'absent'), 3, 'contract')).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT', details: { role: 'contract', reason: 'missing' } });
    await writeFile(file, 'four'); await chmod(file, 0o666);
    await expect(readInputFile(file, 10, 'patch')).rejects.toMatchObject({ details: { reason: 'mode' } });
    await chmod(file, 0o644);
    await expect(readInputFile(file, 3, 'patch')).rejects.toMatchObject({ details: { reason: 'size' } });
    await symlink(file, path.join(root, 'alias'));
    await expect(readInputFile(path.join(root, 'alias'), 10, 'validation')).rejects.toMatchObject({ details: { reason: 'link' } });
    await link(file, path.join(root, 'hardlink'));
    await expect(readInputFile(file, 10, 'request')).rejects.toMatchObject({ details: { reason: 'link' } });
    await mkdir(path.join(root, 'dir'));
    await expect(readInputFile(path.join(root, 'dir'), 10, 'request')).rejects.toMatchObject({ details: { reason: 'type' } });
  });
  it('validates request JSON at the task authorization boundary without exposing contents', async () => {
    const root = await fixture(); const file = path.join(root, 'request');
    const args = ['authorize', '--request', file, '--owner-reference', 'owner', '--expires-at', '2026-12-01T00:00:00Z', '--config', path.join(root, 'missing-config')];
    await writeFile(file, JSON.stringify({ operation: 'review', request: { cwd: root, task: 'Inspect the fixture.' } }), { mode: 0o644 }); await chmod(file, 0o644);
    await expect(taskCommand(args)).rejects.not.toMatchObject({ details: { role: 'request' } });
    expect((await lstat(file)).mode & 0o777).toBe(0o644);
    expect(await readFile(file, 'utf8')).toBe(JSON.stringify({ operation: 'review', request: { cwd: root, task: 'Inspect the fixture.' } }));
    await writeFile(file, '{ sensitive-marker');
    await expect(taskCommand(args)).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT', details: { role: 'request', reason: 'invalid_json' } });
    try { await taskCommand(args); } catch (error) { expect(String(error)).not.toContain('sensitive-marker'); }
  });
  it('rejects malformed UTF-8 even when replacement would make valid JSON', () => {
    const bytes = Buffer.concat([Buffer.from('{\"value\":\"'), Buffer.from([0xff]), Buffer.from('\"}')]);
    expect(() => parseInputJson(bytes, 'request', z.object({ value: z.string() }))).toThrowError(expect.objectContaining({ code: 'VSUP_INVALID_ARGUMENT', details: { role: 'request', reason: 'invalid_json' } }));
  });
  it('rejects files owned by another user', async () => {
    if (typeof process.getuid !== 'function') return;
    const root = await fixture(); const file = path.join(root, 'input');
    await writeFile(file, 'data');
    const uid = process.getuid();
    const mocked = vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    try { await expect(readInputFile(file, 100, 'request')).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT', details: { role: 'request', reason: 'owner' } }); }
    finally { mocked.mockRestore(); }
  });
  it('reports unsafe private directories as artifact errors', async () => {
    const root = await fixture(); await chmod(root, 0o755);
    await expect(assertOwnedDirectory(root)).rejects.toMatchObject({ code: 'VSUP_ARTIFACT_ERROR', details: { role: 'directory', reason: 'mode' } });
  });
});
