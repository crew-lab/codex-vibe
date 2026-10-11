import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportDirtySnapshot, removeVerifiedWorktree } from '../../src/git/worktree.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function setup() {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-order-'))); dirs.push(dir);
  const repo = path.join(dir, 'repo'); await mkdir(repo);
  const run = (cwd: string, args: string[]) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout;
  };
  run(repo, ['init', '-q']); run(repo, ['config', 'user.email', 'test@example.invalid']); run(repo, ['config', 'user.name', 'Test']);
  await writeFile(path.join(repo, 'm.txt'), 'base\n'); await writeFile(path.join(repo, 'z.txt'), 'base\n');
  run(repo, ['add', '-A']); run(repo, ['commit', '-qm', 'base']);
  const base = run(repo, ['rev-parse', 'HEAD']).trim();
  const worktree = path.join(dir, 'worker');
  run(repo, ['worktree', 'add', '--detach', worktree, base]);
  await writeFile(path.join(worktree, 'z.txt'), 'changed\n');
  await writeFile(path.join(worktree, 'a-new.txt'), 'untracked\n');
  await writeFile(path.join(worktree, 'b-new.txt'), 'untracked too\n');
  const artifacts = path.join(dir, 'artifacts'); await mkdir(artifacts, { mode: 0o700 });
  const exported = await exportDirtySnapshot(worktree, artifacts, base);
  return { repo, worktree, base, exported, run };
}

function sections(patch: Buffer): Buffer[] {
  const text = patch.toString('latin1');
  return text.split(/^(?=diff --git )/m).filter(Boolean).map((section) => Buffer.from(section, 'latin1'));
}

async function legacyExport(exported: { patchPath: string; patch: Buffer }): Promise<{ patchPath: string; sha256: string }> {
  const parts = sections(exported.patch);
  expect(parts.length).toBe(3);
  const tracked = parts.filter((part) => part.toString('latin1').includes('index ') && !part.toString('latin1').includes('new file mode'));
  const untracked = parts.filter((part) => part.toString('latin1').includes('new file mode'));
  const legacy = Buffer.concat([...tracked, ...untracked]);
  expect(legacy.equals(exported.patch)).toBe(false);
  await writeFile(exported.patchPath, legacy);
  return { patchPath: exported.patchPath, sha256: createHash('sha256').update(legacy).digest('hex') };
}

describe('worktree cleanup verification', () => {
  it('accepts a reordered verified patch but retains its dirty worktree', async () => {
    const { repo, worktree, base, exported } = await setup();
    const legacy = await legacyExport(exported);
    await expect(removeVerifiedWorktree(repo, { path: worktree, baseRef: base, createdBySupervisor: true }, legacy, worktree)).rejects.toThrow(/uncommitted or untracked files/i);
    await expect(stat(worktree)).resolves.toBeDefined();
  });

  it('still refuses a one-byte content change in the reordered patch comparison', async () => {
    const { repo, worktree, base, exported } = await setup();
    const legacy = await legacyExport(exported);
    await writeFile(path.join(worktree, 'a-new.txt'), 'untrackeX\n');
    await expect(removeVerifiedWorktree(repo, { path: worktree, baseRef: base, createdBySupervisor: true }, legacy, worktree)).rejects.toThrow(/changed after export/);
    expect(await readFile(path.join(worktree, 'a-new.txt'), 'utf8')).toBe('untrackeX\n');
  });

  it('still refuses a tampered saved artifact', async () => {
    const { repo, worktree, base, exported } = await setup();
    const legacy = await legacyExport(exported);
    await writeFile(legacy.patchPath, Buffer.concat([await readFile(legacy.patchPath), Buffer.from('\n')]));
    await expect(removeVerifiedWorktree(repo, { path: worktree, baseRef: base, createdBySupervisor: true }, legacy, worktree)).rejects.toThrow(/verification failed/);
  });
});
