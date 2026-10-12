import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDirtySnapshot, createDetachedWorktree, overrideGitBounds } from '../../src/git/worktree.js';

const exec = promisify(execFile);
const canonicalTmp = await realpath(tmpdir());
const savedPath = process.env.PATH;
const roots: string[] = [];
let restoreBounds: (() => void) | undefined;

afterEach(async () => {
  process.env.PATH = savedPath;
  restoreBounds?.(); restoreBounds = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-bounds-')); roots.push(parent);
  const source = path.join(parent, 'source'); await mkdir(source);
  await exec('git', ['init', '-q'], { cwd: source });
  await exec('git', ['config', 'user.email', 'a@example.test'], { cwd: source });
  await exec('git', ['config', 'user.name', 'a'], { cwd: source });
  await writeFile(path.join(source, 'a.txt'), 'one\n');
  await exec('git', ['add', '-A'], { cwd: source });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: source });
  return { parent, source };
}

async function slowGit(parent: string, slowSubcommand: string, seconds: number): Promise<void> {
  const { stdout } = await exec('sh', ['-c', 'command -v git']);
  const bin = path.join(parent, 'slow-bin'); await mkdir(bin);
  await writeFile(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" ${slowSubcommand} "*) sleep ${seconds};; esac\nexec ${stdout.trim()} "$@"\n`, { mode: 0o755 });
  process.env.PATH = `${bin}:${savedPath}`;
}

describe('git operation bounds', () => {
  beforeEach(() => { restoreBounds = undefined; });

  it('lets worktree creation take longer than the query bound but still bounds it', async () => {
    const { parent, source } = await repository();
    await slowGit(parent, 'worktree add', 4);
    restoreBounds = overrideGitBounds({ queryRuntimeMs: 3000, heavyRuntimeMs: 30_000 });
    const created = await createDetachedWorktree(source, path.join(parent, 'wt-ok'), 'HEAD');
    expect(created.createdBySupervisor).toBe(true);
    restoreBounds();
    restoreBounds = overrideGitBounds({ queryRuntimeMs: 3000, heavyRuntimeMs: 3500 });
    await expect(createDetachedWorktree(source, path.join(parent, 'wt-late'), 'HEAD')).rejects.toMatchObject({ code: 'VSUP_TIMEOUT', details: { operation: 'worktree', kind: 'timeout' } });
  }, 90_000);

  it('lets patch export take longer than the query bound and reports a timeout past the heavy bound', async () => {
    const { parent, source } = await repository();
    await writeFile(path.join(source, 'a.txt'), 'a longer second version\n');
    await slowGit(parent, 'diff', 4);
    restoreBounds = overrideGitBounds({ queryRuntimeMs: 3000, heavyRuntimeMs: 30_000 });
    const snapshot = await captureDirtySnapshot(source);
    expect(snapshot.changedFiles).toEqual(['a.txt']);
    restoreBounds();
    restoreBounds = overrideGitBounds({ queryRuntimeMs: 3000, heavyRuntimeMs: 3500 });
    await expect(captureDirtySnapshot(source)).rejects.toMatchObject({ code: 'VSUP_TIMEOUT', details: { kind: 'timeout' } });
  }, 90_000);

  it('applies the configured artifact limit to the exported patch', async () => {
    const { source } = await repository();
    await writeFile(path.join(source, 'a.txt'), `${'x'.repeat(5000)}\n`);
    await expect(captureDirtySnapshot(source, 'HEAD', 1024)).rejects.toMatchObject({ code: 'VSUP_OUTPUT_LIMIT', details: { kind: 'overflow' } });
    expect((await captureDirtySnapshot(source, 'HEAD', 1024 * 1024)).bytes).toBeGreaterThan(5000);
  });

  it('exports a same-size edit whose timestamps match the index entry', async () => {
    const { source } = await repository();
    await exec('git', ['config', 'core.trustctime', 'false'], { cwd: source });
    const file = path.join(source, 'a.txt');
    const whole = new Date(Math.floor(Date.now() / 1000 - 3600) * 1000);
    await utimes(file, whole, whole);
    await exec('git', ['update-index', '--refresh'], { cwd: source });
    const index = path.join(source, '.git', 'index');
    const later = new Date(Date.now() + 60_000);
    await utimes(index, later, later);
    await writeFile(file, 'two\n');
    await utimes(file, whole, whole);
    expect((await exec('git', ['status', '--porcelain'], { cwd: source })).stdout).toBe('');
    const snapshot = await captureDirtySnapshot(source);
    expect(snapshot.changedFiles).toEqual(['a.txt']);
    expect(snapshot.patch.toString('utf8')).toContain('+two');
    expect((await exec('git', ['status', '--porcelain'], { cwd: source })).stdout).toBe('');
  });
});
