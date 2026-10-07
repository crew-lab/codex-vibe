import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, realpath, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { changedSinceSnapshot, snapshotWorkspace } from '../../src/core/workspace-snapshot.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-snapshot-')));
  dirs.push(dir); return dir;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

async function gitRoot(): Promise<string> {
  const root = await tempDir();
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'test@example.invalid'); git(root, 'config', 'user.name', 'Test');
  await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
  await writeFile(path.join(root, 'tracked.txt'), 'original\n');
  await mkdir(path.join(root, 'node_modules')); await writeFile(path.join(root, 'node_modules', 'dep.js'), 'dep\n');
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  await writeFile(path.join(root, 'untracked.txt'), 'untracked\n');
  return root;
}

async function changes(root: string, mutate: () => Promise<void>): Promise<string[]> {
  const launch = await snapshotWorkspace(root);
  await mutate();
  return await changedSinceSnapshot(root, launch.manifest);
}

describe('workspace snapshot', () => {
  it('reports an unchanged Git tree as unchanged and is deterministic', async () => {
    const root = await gitRoot();
    const first = await snapshotWorkspace(root);
    expect((await snapshotWorkspace(root)).sha256).toBe(first.sha256);
    expect(await changedSinceSnapshot(root, first.manifest)).toEqual([]);
    expect(first.manifest.get('tracked.txt')?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.manifest.get('untracked.txt')?.hash).toBeDefined();
    expect(first.manifest.get(path.join('node_modules', 'dep.js'))?.hash).toBeUndefined();
    expect(first.manifest.has('.git')).toBe(false);
  });

  it('flags writes to tracked, untracked and ignored files', async () => {
    const root = await gitRoot();
    expect(await changes(root, () => writeFile(path.join(root, 'tracked.txt'), 'edited!\n'))).toEqual(['tracked.txt']);
    expect(await changes(root, () => writeFile(path.join(root, 'untracked.txt'), 'edited, longer\n'))).toEqual(['untracked.txt']);
    expect(await changes(root, () => writeFile(path.join(root, 'node_modules', 'dep.js'), 'tampered dependency\n'))).toEqual([path.join('node_modules', 'dep.js')]);
  });

  it('reports additions, removals and symlink retargets', async () => {
    const root = await gitRoot();
    await symlink('tracked.txt', path.join(root, 'link'));
    expect(await changes(root, async () => {
      await unlink(path.join(root, 'tracked.txt'));
      await writeFile(path.join(root, 'added.txt'), 'new\n');
      await writeFile(path.join(root, 'node_modules', 'extra.js'), 'x\n');
      await unlink(path.join(root, 'link')); await symlink('untracked.txt', path.join(root, 'link'));
    })).toEqual(['added.txt', 'link', 'node_modules/extra.js', 'tracked.txt']);
  });

  it('treats a touch of a Git-visible file as unchanged but a touch of an ignored file as changed', async () => {
    const root = await gitRoot();
    const later = new Date(Date.now() + 60_000);
    expect(await changes(root, () => utimes(path.join(root, 'tracked.txt'), later, later))).toEqual([]);
    expect(await changes(root, () => utimes(path.join(root, 'node_modules', 'dep.js'), later, later))).toEqual([path.join('node_modules', 'dep.js')]);
  });

  it('treats a same-content rewrite of a tracked file as unchanged', async () => {
    const root = await gitRoot();
    expect(await changes(root, async () => { await unlink(path.join(root, 'tracked.txt')); await writeFile(path.join(root, 'tracked.txt'), 'original\n'); })).toEqual([]);
  });

  it('works for a root that is not a Git repository using stat only', async () => {
    const root = await tempDir();
    await writeFile(path.join(root, 'a.txt'), 'a\n'); await mkdir(path.join(root, 'dir')); await writeFile(path.join(root, 'dir', 'b.txt'), 'b\n');
    const launch = await snapshotWorkspace(root);
    expect([...launch.manifest.values()].some((entry) => entry.hash !== undefined)).toBe(false);
    expect(await changedSinceSnapshot(root, launch.manifest)).toEqual([]);
    expect(await changes(root, () => writeFile(path.join(root, 'dir', 'b.txt'), 'bb\n'))).toEqual([path.join('dir', 'b.txt')]);
  });

  it('fails with an output-limit error beyond the entry cap', async () => {
    const root = await tempDir();
    for (let index = 0; index < 5; index += 1) await writeFile(path.join(root, `f${index}`), 'x');
    await expect(snapshotWorkspace(root, { maxFiles: 4, maxBytes: 1_000 })).rejects.toMatchObject({ code: 'VSUP_OUTPUT_LIMIT' });
    await expect(snapshotWorkspace(root, { maxFiles: 5, maxBytes: 1_000 })).resolves.toBeDefined();
  });

  it('snapshots 20,000 small ignored files quickly', async () => {
    const root = await gitRoot();
    const modules = path.join(root, 'node_modules');
    for (let package_ = 0; package_ < 200; package_ += 1) {
      const directory = path.join(modules, `pkg${package_}`); await mkdir(directory);
      await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(path.join(directory, `f${index}.js`), `module.exports = ${index};\n`)));
    }
    const started = performance.now();
    const snapshot = await snapshotWorkspace(root);
    const elapsed = performance.now() - started;
    expect(snapshot.manifest.size).toBeGreaterThan(20_000);
    expect(elapsed).toBeLessThan(3000);
  }, 30_000);
});
