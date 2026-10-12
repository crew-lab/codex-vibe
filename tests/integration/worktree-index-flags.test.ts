import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { captureDirtySnapshot, createDetachedWorktree, exportDirtySnapshot, removeVerifiedWorktree } from '../../src/git/worktree.js';

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function repository(files: Record<string, string> = { 'a.txt': 'one\n', 'b.txt': 'two\n' }) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-flags-')); roots.push(parent);
  const source = path.join(parent, 'source'); await mkdir(source);
  await exec('git', ['init', '-q'], { cwd: source });
  await exec('git', ['config', 'user.email', 'a@example.test'], { cwd: source });
  await exec('git', ['config', 'user.name', 'a'], { cwd: source });
  for (const [name, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(source, name)), { recursive: true }); await writeFile(path.join(source, name), text); }
  await exec('git', ['add', '-A'], { cwd: source });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: source });
  return { parent, source, worktree: path.join(parent, 'worktree'), artifacts: path.join(parent, 'artifacts') };
}

async function emptyExport(artifacts: string): Promise<{ patchPath: string; sha256: string }> {
  await mkdir(artifacts, { recursive: true });
  const patchPath = path.join(artifacts, 'empty.patch');
  await writeFile(patchPath, '');
  return { patchPath, sha256: createHash('sha256').update('').digest('hex') };
}

async function sharedIndexFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.startsWith('sharedindex.')).sort();
}

describe('user index flags', () => {
  it('refuses cleanup while an assume-unchanged edit is missing from the saved export', async () => {
    const { source, worktree, artifacts } = await repository();
    await exec('git', ['config', 'core.ignoreStat', 'true'], { cwd: source });
    const created = await createDetachedWorktree(source, worktree);
    await exec('git', ['update-index', '--assume-unchanged', 'a.txt'], { cwd: worktree });
    await writeFile(path.join(worktree, 'a.txt'), 'edited\n');
    const record = { path: worktree, baseRef: created.baseRef, createdBySupervisor: true };
    await expect(removeVerifiedWorktree(source, record, await emptyExport(artifacts), worktree)).rejects.toThrow(/changed after export/);
    const exported = await exportDirtySnapshot(worktree, artifacts, created.baseRef);
    expect(exported.changedFiles).toEqual(['a.txt']);
    await expect(removeVerifiedWorktree(source, record, exported, worktree)).rejects.toThrow(/uncommitted or untracked/i);
    expect(await readFile(path.join(worktree, 'a.txt'), 'utf8')).toBe('edited\n');
  });

  it('exports a present skip-worktree file but not the absent entries of a sparse checkout', async () => {
    const { source, worktree } = await repository({ 'in/a.txt': 'one\n', 'out/b.txt': 'two\n', 'out/c.txt': 'three\n' });
    await exec('git', ['sparse-checkout', 'set', 'in'], { cwd: source });
    const created = await createDetachedWorktree(source, worktree);
    const listed = (await exec('git', ['ls-files', '-t'], { cwd: worktree })).stdout;
    expect(listed).toContain('S out/b.txt');
    await writeFile(path.join(worktree, 'in', 'a.txt'), 'edited\n');
    await mkdir(path.join(worktree, 'out'), { recursive: true });
    await writeFile(path.join(worktree, 'out', 'b.txt'), 'written outside the cone\n');
    const snapshot = await captureDirtySnapshot(worktree, created.baseRef);
    expect(snapshot.changedFiles.sort()).toEqual(['in/a.txt', 'out/b.txt']);
    expect(snapshot.patch.toString('utf8')).toContain('+written outside the cone');
  });

  it('writes and expires no shared index while exporting a split-index worktree', async () => {
    const { source, worktree, artifacts } = await repository();
    await exec('git', ['config', 'core.splitIndex', 'true'], { cwd: source });
    await exec('git', ['config', 'splitIndex.sharedIndexExpire', 'now'], { cwd: source });
    const created = await createDetachedWorktree(source, worktree);
    await writeFile(path.join(worktree, 'a.txt'), 'edited\n');
    await exec('git', ['update-index', '--split-index'], { cwd: worktree });
    await exec('git', ['status', '--porcelain'], { cwd: worktree });
    const gitDir = (await exec('git', ['rev-parse', '--absolute-git-dir'], { cwd: worktree })).stdout.trim();
    const commonDir = path.join(source, '.git');
    const before = { gitDir: await sharedIndexFiles(gitDir), commonDir: await sharedIndexFiles(commonDir) };
    expect(before.gitDir.length).toBeGreaterThan(0);
    await writeFile(path.join(worktree, 'new.txt'), 'new\n');
    const exported = await exportDirtySnapshot(worktree, artifacts, created.baseRef);
    expect(exported.changedFiles).toEqual(['a.txt', 'new.txt']);
    await expect(removeVerifiedWorktree(source, { path: worktree, baseRef: created.baseRef, createdBySupervisor: true }, exported, worktree)).rejects.toThrow(/uncommitted or untracked/i);
    expect({ gitDir: await sharedIndexFiles(gitDir), commonDir: await sharedIndexFiles(commonDir) }).toEqual(before);
    expect((await exec('git', ['status', '--porcelain'], { cwd: worktree })).stdout).toBe(' M a.txt\n?? new.txt\n');
  });
});
