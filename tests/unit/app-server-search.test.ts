import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceSearch } from '../../src/backends/app-server/search.js';
import { checkedPath } from '../../src/backends/app-server/path-policy.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-search-'))); directories.push(root);
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'first.ts'), 'export const answer = 42;\n');
  await writeFile(path.join(root, 'nested', 'second.ts'), 'function answer() {}\nANSWER\n');
  return { root, search: new WorkspaceSearch(root, 'fixture') };
}

describe('Supervisor-owned workspace search', () => {
  it('lists sorted scoped files with cursor paging', async () => {
    const { search } = await fixture();
    const first = await search.listFiles({ limit: 1 });
    expect(first.files).toEqual(['first.ts']); expect(first.complete).toBe(false);
    const second = await search.listFiles({ cursor: first.next_cursor });
    expect(second.files).toEqual(['nested/second.ts']); expect(second.complete).toBe(true);
    expect(second.next_cursor).toBeNull();
  });
  it('rejects listing cursors after edits and across runs or scopes', async () => {
    const { root, search } = await fixture();
    const first = await search.listFiles({ limit: 1 });
    await expect(new WorkspaceSearch(root, 'other').listFiles({ cursor: first.next_cursor })).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT' });
    await expect(search.listFiles({ path: 'nested', cursor: first.next_cursor })).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT' });
    await writeFile(path.join(root, 'first.ts'), 'changed\n');
    await expect(search.listFiles({ cursor: first.next_cursor })).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT' });
  });
  it('searches regular text with line numbers and case sensitivity', async () => {
    const { search } = await fixture();
    const result = await search.grep({ pattern: '\\banswer\\b', case_sensitive: false });
    expect(result.complete).toBe(true);
    expect(result.matches.map(match => [match.path, match.line])).toEqual([['first.ts', 1], ['nested/second.ts', 1], ['nested/second.ts', 2]]);
    expect((await search.grep({ pattern: 'ANSWER' })).matches).toHaveLength(1);
  });
  it('excludes secrets, reserved state and generated trees', async () => {
    const { root, search } = await fixture();
    await mkdir(path.join(root, '.agents')); await mkdir(path.join(root, 'node_modules'));
    for (const rel of ['.env', '.env.production', 'private.pem', '.agents/secret.txt', 'node_modules/secret.txt']) await writeFile(path.join(root, rel), 'secret-canary');
    const result = await search.grep({ pattern: 'secret-canary' });
    expect(result.matches).toEqual([]);
    expect(result.skipped_files).toBeGreaterThan(0);
    expect((await search.listFiles({})).files).toEqual(['first.ts', 'nested/second.ts']);
    await expect(search.grep({ pattern: 'secret', path: '.env' })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID' });
  });
  it('refuses direct traversal and symlink escapes and never reveals outside content', async () => {
    const { root, search } = await fixture();
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-search-outside-'))); directories.push(outside);
    await writeFile(path.join(outside, 'canary'), 'outside-canary');
    await symlink(outside, path.join(root, 'escape'));
    await expect(search.grep({ pattern: 'canary', path: 'escape/canary' })).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID' });
    await expect(checkedPath(root, 'nested/../first.ts')).rejects.toMatchObject({ code: 'VSUP_WORKSPACE_INVALID' });
    expect((await search.grep({ pattern: 'outside-canary' })).matches).toEqual([]);
  });
  it('reports match and file-size truncation explicitly', async () => {
    const { root, search } = await fixture();
    const limited = await search.grep({ pattern: 'answer', max_matches: 1 });
    expect(limited.complete).toBe(false); expect(limited.reason).toBe('match_limit');
    await writeFile(path.join(root, 'large.txt'), 'a'.repeat(1_048_577));
    const result = await search.grep({ pattern: 'not-found' });
    expect(result.complete).toBe(false); expect(result.reason).toBe('file_size_limit');
  });
  it('rejects invalid regex even in an empty scope', async () => {
    const { root } = await fixture(); await mkdir(path.join(root, 'empty'));
    await expect(new WorkspaceSearch(root, 'fixture').grep({ pattern: '[', path: 'empty' })).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT' });
  });
  it('terminates pathological regex work within a bound', async () => {
    const { root } = await fixture();
    await writeFile(path.join(root, 'pathological.txt'), 'a'.repeat(20_000) + '!');
    const search = new WorkspaceSearch(root, 'fixture', 10_000, 100);
    await expect(search.grep({ pattern: '(a+)+$', path: 'pathological.txt' })).rejects.toMatchObject({ code: 'VSUP_TIMEOUT' });
    expect((await search.listFiles({})).files).toContain('pathological.txt');
  });
  it('redacts high-confidence credential text in search results', async () => {
    const { root, search } = await fixture();
    await writeFile(path.join(root, 'ordinary.txt'), 'password=do-not-disclose-this-value');
    const result = await search.grep({ pattern: 'password' });
    expect(JSON.stringify(result)).not.toContain('do-not-disclose-this-value');
  });
  it('enforces strict schemas and bounded result requests', async () => {
    const { search } = await fixture();
    await expect(search.grep({ pattern: 'answer', max_matches: 501 })).rejects.toThrow();
    await expect(search.grep({ pattern: 'answer', shell: true })).rejects.toThrow();
    await expect(search.listFiles({ limit: 1001 })).rejects.toThrow();
  });
});
