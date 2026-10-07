import { afterEach, describe, expect, it } from 'vitest';
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureDirtySnapshot } from '../../src/git/worktree.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vibe-supervisor-export-')));
  dirs.push(dir); return dir;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function git(cwd: string, args: string[], allowed: number[] = [0], input?: Buffer): Buffer {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, maxBuffer: 256 * 1024 * 1024, ...(input ? { input } : {}) });
  if (result.status === null || !allowed.includes(result.status)) throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.toString()}`);
  return result.stdout;
}

function referenceCapture(root: string): { patch: Buffer; changedFiles: string[] } {
  const base = git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim();
  const trackedPatch = git(root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', base, '--']);
  const trackedNames = git(root, ['diff', '--name-only', '-z', '--no-textconv', '--no-renames', base, '--']);
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']).toString('utf8');
  const untracked: string[] = [];
  let cursor = 0;
  while (cursor < status.length) {
    const end = status.indexOf('\0', cursor);
    if (end < 0) break;
    const record = status.slice(cursor, end); cursor = end + 1;
    if (record.slice(0, 2) === '??') untracked.push(record.slice(3));
  }
  const extra = untracked.map((name) => git(root, ['diff', '--no-index', '--binary', '--no-ext-diff', '--no-textconv', '--', '/dev/null', name.startsWith('-') ? `./${name}` : name], [0, 1]));
  return { patch: Buffer.concat([trackedPatch, ...extra]), changedFiles: [...trackedNames.toString('utf8').split('\0').filter(Boolean), ...untracked] };
}

async function readTree(root: string, relative = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (relative === '' && entry.name === '.git') continue;
    const rel = path.join(relative, entry.name); const absolute = path.join(root, rel);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) out.set(rel, `L:${await readlink(absolute)}`);
    else if (info.isDirectory()) for (const [key, value] of await readTree(root, rel)) out.set(key, value);
    else out.set(rel, `${info.mode & 0o111 ? 'x' : '-'}:${(await readFile(absolute)).toString('hex')}`);
  }
  return out;
}

async function dirtyRepo(): Promise<string> {
  const dir = await tempDir(); const repo = path.join(dir, 'repo'); await mkdir(repo);
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 'test@example.invalid']); git(repo, ['config', 'user.name', 'Test']);
  await writeFile(path.join(repo, '.gitignore'), 'ignored.log\nnode_modules/\n');
  await writeFile(path.join(repo, 'keep.txt'), 'keep\n'); await writeFile(path.join(repo, 'del.txt'), 'delete me\n');
  await writeFile(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 3, 255, 254]));
  await writeFile(path.join(repo, 'run.sh'), '#!/bin/sh\n'); await chmod(path.join(repo, 'run.sh'), 0o644);
  await writeFile(path.join(repo, 'sp ace.txt'), 'space\n'); await writeFile(path.join(repo, '-dash.txt'), 'dash\n'); await writeFile(path.join(repo, 'ünï.txt'), 'uni\n');
  await symlink('keep.txt', path.join(repo, 'link'));
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
  await writeFile(path.join(repo, 'keep.txt'), 'keep changed\nmore\n');
  await rm(path.join(repo, 'del.txt'));
  await writeFile(path.join(repo, 'bin.dat'), Buffer.from([9, 0, 8, 255]));
  await chmod(path.join(repo, 'run.sh'), 0o755);
  await writeFile(path.join(repo, 'sp ace.txt'), 'space changed\n'); await writeFile(path.join(repo, '-dash.txt'), 'dash changed\n'); await writeFile(path.join(repo, 'ünï.txt'), 'uni changed\n');
  await rm(path.join(repo, 'link')); await symlink('sp ace.txt', path.join(repo, 'link'));
  await symlink('keep.txt', path.join(repo, 'new-link'));
  await writeFile(path.join(repo, 'new file.txt'), 'untracked\n'); await writeFile(path.join(repo, 'новий.txt'), 'untracked unicode\n');
  await writeFile(path.join(repo, 'new.bin'), Buffer.from([0, 0, 1, 200])); await writeFile(path.join(repo, 'new.sh'), '#!/bin/sh\n'); await chmod(path.join(repo, 'new.sh'), 0o755);
  await mkdir(path.join(repo, 'deep', 'a', 'b'), { recursive: true }); await writeFile(path.join(repo, 'deep', 'a', 'b', 'c.txt'), 'deep\n'); await writeFile(path.join(repo, 'deep', 'a', 'd.txt'), 'deeper\n');
  await writeFile(path.join(repo, 'ignored.log'), 'noise\n'); await mkdir(path.join(repo, 'node_modules')); await writeFile(path.join(repo, 'node_modules', 'x.js'), 'x\n');
  return repo;
}

async function checkoutBase(repo: string): Promise<string> {
  const clone = path.join(path.dirname(repo), `clone-${Math.random().toString(16).slice(2)}`);
  git(path.dirname(repo), ['clone', '-q', repo, clone]);
  return clone;
}

describe('dirty export equivalence with the per-file reference implementation', () => {
  it('produces a patch that rebuilds the same tree as the reference patch', async () => {
    const repo = await dirtyRepo();
    const indexBefore = await readFile(path.join(repo, '.git', 'index'));
    const reference = referenceCapture(repo);
    const actual = await captureDirtySnapshot(repo);
    expect(Buffer.compare(await readFile(path.join(repo, '.git', 'index')), indexBefore)).toBe(0);
    expect([...actual.changedFiles].sort()).toEqual([...reference.changedFiles].sort());
    const referenceTree = await checkoutBase(repo); const actualTree = await checkoutBase(repo);
    const referencePatch = path.join(referenceTree, '..', 'reference.patch'); const actualPatch = path.join(actualTree, '..', 'actual.patch');
    await writeFile(referencePatch, reference.patch); await writeFile(actualPatch, actual.patch);
    git(referenceTree, ['apply', '--binary', referencePatch]); git(actualTree, ['apply', '--binary', actualPatch]);
    const expected = await readTree(referenceTree); const rebuilt = await readTree(actualTree);
    expect(rebuilt).toEqual(expected);
    expect([...rebuilt.keys()]).not.toContain('ignored.log');
    expect([...rebuilt.keys()].some((key) => key.startsWith('node_modules'))).toBe(false);
    expect(rebuilt.get('run.sh')?.startsWith('x:')).toBe(true);
    expect(rebuilt.get('new-link')).toBe('L:keep.txt');
    expect(rebuilt.has('del.txt')).toBe(false);
    expect(rebuilt.has('deep/a/b/c.txt')).toBe(true);
    expect(rebuilt.has('новий.txt')).toBe(true);
  });

  it('exports an untracked file with a leading dash as an applicable patch', async () => {
    const repo = await dirtyRepo();
    await writeFile(path.join(repo, '-new-dash.txt'), 'untracked dash\n');
    const actual = await captureDirtySnapshot(repo);
    const clone = await checkoutBase(repo); const patchFile = path.join(clone, '..', 'dash.patch');
    await writeFile(patchFile, actual.patch); git(clone, ['apply', '--binary', patchFile]);
    expect(await readFile(path.join(clone, '-new-dash.txt'), 'utf8')).toBe('untracked dash\n');
  });

  it('leaves the real index and the staged state untouched', async () => {
    const repo = await dirtyRepo();
    await writeFile(path.join(repo, 'staged.txt'), 'staged\n'); git(repo, ['add', 'staged.txt']);
    const indexBefore = await readFile(path.join(repo, '.git', 'index'));
    const statusBefore = git(repo, ['status', '--porcelain=v1', '-z']).toString();
    await captureDirtySnapshot(repo);
    expect(Buffer.compare(await readFile(path.join(repo, '.git', 'index')), indexBefore)).toBe(0);
    expect(git(repo, ['status', '--porcelain=v1', '-z']).toString()).toBe(statusBefore);
  });

  it('exports 50 untracked files in constant time', async () => {
    const dir = await tempDir(); const repo = path.join(dir, 'repo'); await mkdir(repo);
    git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 'test@example.invalid']); git(repo, ['config', 'user.name', 'Test']);
    await writeFile(path.join(repo, 'base.txt'), 'base\n'); git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
    for (let index = 0; index < 50; index += 1) await writeFile(path.join(repo, `untracked-${index}.txt`), `content ${index}\n`);
    const started = performance.now();
    const snapshot = await captureDirtySnapshot(repo);
    const elapsed = performance.now() - started;
    expect(snapshot.changedFiles).toHaveLength(50);
    expect(elapsed).toBeLessThan(600);
  });
});
