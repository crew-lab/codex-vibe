import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureDirtySnapshot } from '../../src/git/worktree.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.toString()}`);
  return result.stdout.toString();
}

async function splitRepo(): Promise<{ repo: string; dir: string }> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-split-'))); dirs.push(dir);
  const repo = path.join(dir, 'repo'); await mkdir(repo);
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 'test@example.invalid']); git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'core.splitIndex', 'true']); git(repo, ['config', 'core.untrackedCache', 'true']);
  for (let index = 0; index < 5; index += 1) await writeFile(path.join(repo, `file-${index}.txt`), `content ${index}\n`);
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
  git(repo, ['update-index', '--split-index']);
  await writeFile(path.join(repo, 'file-1.txt'), 'modified\n');
  await writeFile(path.join(repo, 'untracked.txt'), 'untracked\n');
  for (let index = 0; index < 20; index += 1) await writeFile(path.join(repo, `extra-${index}.txt`), `extra ${index}\n`);
  return { repo, dir };
}

async function gitFiles(gitDir: string, relative = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(gitDir, relative), { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    if (rel === 'objects' || rel === 'logs') continue;
    if (entry.isDirectory()) for (const [key, value] of await gitFiles(gitDir, rel)) out.set(key, value);
    else out.set(rel, `${(await lstat(path.join(gitDir, rel))).mode}:${createHash('sha256').update(await readFile(path.join(gitDir, rel))).digest('hex')}`);
  }
  return out;
}

describe('split-index repositories', () => {
  it('leaves everything under the real git dir except objects and logs untouched', async () => {
    const { repo } = await splitRepo();
    expect([...(await gitFiles(path.join(repo, '.git'))).keys()].some((key) => key.startsWith('sharedindex.'))).toBe(true);
    const before = await gitFiles(path.join(repo, '.git'));
    const snapshot = await captureDirtySnapshot(repo);
    expect(await gitFiles(path.join(repo, '.git'))).toEqual(before);
    expect(snapshot.changedFiles).toHaveLength(22);
    expect(snapshot.changedFiles).toContain('file-1.txt');
    const patch = snapshot.patch.toString('utf8');
    expect(patch).toContain('+modified');
    expect(patch).toContain('+++ b/untracked.txt');
  });

  it('leaves the common git dir untouched for a linked worktree of a split-index repository', async () => {
    const { repo, dir } = await splitRepo();
    const linked = path.join(dir, 'linked');
    git(repo, ['worktree', 'add', '-q', '--detach', linked, 'HEAD']);
    git(linked, ['update-index', '--split-index']);
    await writeFile(path.join(linked, 'file-2.txt'), 'linked change\n');
    await writeFile(path.join(linked, 'linked-new.txt'), 'new\n');
    for (let index = 0; index < 20; index += 1) await writeFile(path.join(linked, `extra-${index}.txt`), `extra ${index}\n`);
    const before = await gitFiles(path.join(repo, '.git'));
    const snapshot = await captureDirtySnapshot(linked);
    expect(await gitFiles(path.join(repo, '.git'))).toEqual(before);
    expect(snapshot.changedFiles).toHaveLength(22);
    expect(snapshot.changedFiles).toContain('linked-new.txt');
    expect(snapshot.patch.toString('utf8')).toContain('+linked change');
  });
});
