import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, stat, realpath, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveCanonicalRoot, createPrivateDir, createPrivateFile } from '../../src/security/paths.js';
import { buildChildEnvironment, assertNotSupervisorChild } from '../../src/security/environment.js';
import { StreamingRedactor } from '../../src/security/redaction.js';
import { atomicWriteJson } from '../../src/persistence/atomic.js';
import { appendNdjson, readNdjsonRecovering } from '../../src/persistence/ndjson.js';
import { captureDirtySnapshot, exportDirtySnapshot, removeVerifiedWorktree } from '../../src/git/worktree.js';
import { spawnManaged } from '../../src/process/managed.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vibe-supervisor-security-')));
  dirs.push(dir); return dir;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('workspace and child environment boundaries', () => {
  it('uses canonical component containment and rejects sibling-prefix and symlink escapes', async () => {
    const dir = await tempDir();
    const root = path.join(dir, 'workspace'); const sibling = path.join(dir, 'workspace-evil');
    await mkdir(root); await mkdir(sibling);
    expect(await resolveCanonicalRoot(root, [dir])).toBe(await realpath(root));
    await expect(resolveCanonicalRoot(sibling, [root])).rejects.toThrow();
    const outside = path.join(dir, 'outside'); await mkdir(outside);
    await symlink(outside, path.join(root, 'escape'));
    await expect(resolveCanonicalRoot(path.join(root, 'escape'), [root])).rejects.toThrow();
    await expect(resolveCanonicalRoot(path.join(root, '..', 'workspace-evil'), [root])).rejects.toThrow();
  });

  it('copies only allowed environment entries and blocks recursion', () => {
    const child = buildChildEnvironment({ HOME: '/safe', PATH: '/bin', MISTRAL_API_KEY: 'mistral-secret', OPENAI_API_KEY: 'other-secret', RANDOM_SENTINEL: 'must-not-leak', LC_ALL: 'C' });
    expect(child).toMatchObject({ HOME: '/safe', PATH: '/bin', MISTRAL_API_KEY: 'mistral-secret', LC_ALL: 'C', VIBE_SUPERVISOR_CHILD: '1' });
    expect(child.OPENAI_API_KEY).toBeUndefined();
    expect(child.RANDOM_SENTINEL).toBeUndefined();
    expect(() => assertNotSupervisorChild(child)).toThrow();
  });

  it('rejects symlinked ancestors before creating any private output', async () => {
    const dir = await tempDir(); const outside = await tempDir();
    const link = path.join(dir, 'linked-parent'); await symlink(outside, link);
    await expect(createPrivateDir(path.join(link, 'new-private'))).rejects.toThrow(/symlink/);
    await expect(createPrivateFile(path.join(link, 'file.txt'), 'must not be written')).rejects.toThrow(/symlink/);
    await expect(access(path.join(outside, 'new-private'))).rejects.toThrow();
    await expect(access(path.join(outside, 'file.txt'))).rejects.toThrow();
  });
});

describe('redaction and private persistence', () => {
  it('redacts split secrets and keeps oversized lines without leaking', () => {
    const sentinel = 'CUSTOM_SENTINEL_VALUE';
    const input = `{"message":"${sentinel}"}\n`;
    const stream = new StreamingRedactor([sentinel], { maxPendingChars: 2048, keepChars: 512 });
    const output = stream.push(input.slice(0, 11)) + stream.push(input.slice(11, 20)) + stream.push(input.slice(20)) + stream.flush();
    expect(output).not.toContain(sentinel);
    const huge = new StreamingRedactor([], { maxPendingChars: 1024, keepChars: 512 });
    const emitted = huge.push('x'.repeat(2048));
    expect(emitted).toBe('x'.repeat(1536));
    const rest = huge.push(' Bearer secret-that-must-be-discarded\nvisible\n');
    expect(rest).not.toContain('secret-that-must-be-discarded');
    expect(rest).toContain('visible');
  });

  it('preserves JSON syntax, strips reasoning, redacts sentinels and recovers a torn NDJSON tail', async () => {
    const dir = await tempDir(); const jsonPath = path.join(dir, 'run.json');
    await atomicWriteJson(jsonPath, { summary: 'api_key=knownsecret', thought: 'private', reasoning_content: 'hidden', thoughts: ['hidden too'], arbitrary: 'CUSTOM_SENTINEL_VALUE', password: { nested: 'hidden credential' } }, { sentinels: ['CUSTOM_SENTINEL_VALUE'] });
    const saved = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(JSON.stringify(saved)).not.toContain('knownsecret');
    expect(JSON.stringify(saved)).not.toContain('CUSTOM_SENTINEL_VALUE');
    expect(saved.thought).toBeUndefined();
    expect(saved.reasoning_content).toBeUndefined();
    expect(saved.thoughts).toBeUndefined();
    expect(saved.password).toBe('[REDACTED]');
    expect((await stat(jsonPath)).mode & 0o777).toBe(0o600);
    const events = path.join(dir, 'events.ndjson');
    await appendNdjson(events, { seq: 1, text: 'CUSTOM_SENTINEL_VALUE', reasoning: 'private' }, { sentinels: ['CUSTOM_SENTINEL_VALUE'] });
    await writeFile(events, (await readFile(events, 'utf8')) + '{"seq":', 'utf8');
    expect(await readNdjsonRecovering(events)).toEqual([{ seq: 1, text: '[REDACTED]' }]);
    expect(await readNdjsonRecovering(events, { truncatePartial: true })).toEqual([{ seq: 1, text: '[REDACTED]' }]);
    expect((await stat(events)).mode & 0o777).toBe(0o600);
  });
});

describe('dirty git snapshot', () => {
  it('captures tracked staged and unstaged edits plus binary/newline filenames without mutating index', async () => {
    const dir = await tempDir(); const repo = path.join(dir, 'repo'); await mkdir(repo);
    const git = (args: string[]) => {
      const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout;
    };
    git(['init', '-q']); git(['config', 'user.email', 'test@example.invalid']); git(['config', 'user.name', 'Test']);
    await writeFile(path.join(repo, 'tracked.txt'), 'base\n'); git(['add', 'tracked.txt']); git(['commit', '-qm', 'base']);
    await writeFile(path.join(repo, 'tracked.txt'), 'staged\n'); git(['add', 'tracked.txt']);
    await writeFile(path.join(repo, 'tracked.txt'), 'staged and unstaged\n');
    const oddName = 'new file\nwith ; metachar$.bin'; await writeFile(path.join(repo, oddName), Buffer.from([0, 1, 2, 255]));
    const indexBefore = await readFile(path.join(repo, '.git', 'index'));
    const snapshot = await captureDirtySnapshot(repo);
    const indexAfter = await readFile(path.join(repo, '.git', 'index'));
    expect(indexAfter.equals(indexBefore)).toBe(true);
    expect(snapshot.changedFiles).toContain('tracked.txt');
    expect(snapshot.changedFiles).toContain(oddName);
    expect(snapshot.patch.toString('utf8')).toContain('GIT binary patch');
    expect(snapshot.patch.toString('utf8')).toContain('staged and unstaged');
  });

  it('fails cleanly when git is unavailable for a non-repository path', async () => {
    const dir = await tempDir();
    await expect(captureDirtySnapshot(dir)).rejects.toThrow();
  });

  it('rejects configured clean filters before they can execute', async () => {
    const dir = await tempDir(); const repo = path.join(dir, 'repo'); await mkdir(repo);
    const run = (args: string[]) => {
      const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    run(['init', '-q']); run(['config', 'user.email', 'test@example.invalid']); run(['config', 'user.name', 'Test']);
    await writeFile(path.join(repo, 'base'), 'base\n'); run(['add', 'base']); run(['commit', '-qm', 'base']);
    const marker = path.join(dir, 'filter-was-run');
    run(['config', 'filter.evil.clean', `touch ${marker}`]);
    await writeFile(path.join(repo, 'dirty'), 'payload\n');
    await expect(captureDirtySnapshot(repo)).rejects.toThrow(/external Git filters/);
    await expect(readFile(marker)).rejects.toThrow();
  });

  it('refuses cleanup after post-export changes and retains the worktree', async () => {
    const dir = await tempDir(); const repo = path.join(dir, 'repo'); await mkdir(repo);
    const run = (args: string[]) => {
      const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout;
    };
    run(['init', '-q']); run(['config', 'user.email', 'test@example.invalid']); run(['config', 'user.name', 'Test']);
    await writeFile(path.join(repo, 'tracked'), 'base\n'); run(['add', 'tracked']); run(['commit', '-qm', 'base']);
    const base = run(['rev-parse', 'HEAD']).trim();
    const worktree = path.join(dir, 'worker');
    run(['worktree', 'add', '--detach', worktree, base]);
    await writeFile(path.join(worktree, 'tracked'), 'first result\n');
    const artifacts = path.join(dir, 'artifacts'); await mkdir(artifacts, { mode: 0o700 });
    const exported = await exportDirtySnapshot(worktree, artifacts, base);
    await writeFile(path.join(worktree, 'tracked'), 'edited after export\n');
    await expect(removeVerifiedWorktree(repo, { path: worktree, baseRef: base, createdBySupervisor: true }, exported)).rejects.toThrow(/changed after export/);
    await expect(readFile(path.join(worktree, 'tracked'), 'utf8')).resolves.toBe('edited after export\n');
  });

  it('refuses to persist recognizable credentials inside patches', async () => {
    const dir = await tempDir(); const repo = path.join(dir, 'repo'); await mkdir(repo);
    const run = (args: string[]) => {
      const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout;
    };
    run(['init', '-q']); run(['config', 'user.email', 'test@example.invalid']); run(['config', 'user.name', 'Test']);
    await writeFile(path.join(repo, 'tracked'), 'safe\n'); run(['add', 'tracked']); run(['commit', '-qm', 'base']);
    await writeFile(path.join(repo, 'tracked'), 'api_key = "knownsecret12345"\n');
    await expect(exportDirtySnapshot(repo, path.join(dir, 'artifacts'))).rejects.toMatchObject({ code: 'VSUP_ARTIFACT_ERROR' });
    await expect(readFile(path.join(repo, 'tracked'), 'utf8')).resolves.toBe('api_key = "knownsecret12345"\n');
  });

  it('removes a cleanly verified worktree after export', async () => {
    const dir = await tempDir(); const repo = path.join(dir, 'repo'); await mkdir(repo);
    const run = (args: string[]) => {
      const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout;
    };
    run(['init', '-q']); run(['config', 'user.email', 'test@example.invalid']); run(['config', 'user.name', 'Test']);
    await writeFile(path.join(repo, 'tracked'), 'base\n'); run(['add', 'tracked']); run(['commit', '-qm', 'base']);
    const base = run(['rev-parse', 'HEAD']).trim(); const worktree = path.join(dir, 'worker');
    run(['worktree', 'add', '--detach', worktree, base]);
    await writeFile(path.join(worktree, 'tracked'), 'exported change\n');
    const artifacts = path.join(dir, 'artifacts'); await mkdir(artifacts, { mode: 0o700 });
    const exported = await exportDirtySnapshot(worktree, artifacts, base);
    await removeVerifiedWorktree(repo, { path: worktree, baseRef: base, createdBySupervisor: true }, exported);
    await expect(stat(worktree)).rejects.toThrow();
  });
});

describe('managed process', () => {
  it('keeps argv literal, strips unrelated environment and stops on output limits', async () => {
    const dir = await tempDir();
    const lines: string[] = [];
    let limited = false;
    const proc = spawnManaged(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({arg:process.argv[1], secret:process.env.CUSTOM_SENTINEL}))', 'a ; $(touch nope)'], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, CUSTOM_SENTINEL: 'must-not-leak', MISTRAL_API_KEY: 'kept' },
      onStdout: (text) => lines.push(text),
    });
    await proc.done;
    expect(lines.join('')).toContain('a ; $(touch nope)');
    expect(lines.join('')).not.toContain('must-not-leak');
    const limitedProc = spawnManaged(process.execPath, ['-e', 'process.stdout.write("x".repeat(1000000)); setInterval(()=>{},1000)'], {
      cwd: dir, maxStdoutBytes: 64, onLimit: () => { limited = true; },
    });
    await limitedProc.done;
    expect(limited).toBe(true);
    expect(limitedProc.stdout.toBuffer().byteLength).toBe(64);
    expect(limitedProc.stdout.truncated).toBe(true);
  });

  it('falls back from EPERM group signaling to only its direct child and exposes degraded cleanup', async () => {
    const dir = await tempDir();
    const proc = spawnManaged(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: dir });
    const nativeKill = process.kill;
    const groupTargets: number[] = [];
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid < 0) { groupTargets.push(pid); throw Object.assign(new Error('sandbox denied killpg'), { code: 'EPERM' }); }
      return nativeKill(pid, signal as NodeJS.Signals);
    }) as typeof process.kill;
    try {
      await proc.terminate(25);
      await proc.done;
      expect(proc.groupTerminationDegraded).toBe(true);
      expect(groupTargets).toEqual([-proc.child.pid, -proc.child.pid]);
    } finally {
      process.kill = nativeKill;
      if (proc.child.exitCode === null && proc.child.signalCode === null && proc.child.pid) {
        try { nativeKill(proc.child.pid, 'SIGKILL'); } catch { /* process already exited */ }
      }
    }
  });

  it('rejects termination within a bound when group and direct-child signaling fail', async () => {
    const dir = await tempDir();
    const proc = spawnManaged(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: dir });
    const nativeKill = process.kill;
    const nativeChildKill = proc.child.kill;
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid < 0) throw Object.assign(new Error('sandbox denied killpg'), { code: 'EPERM' });
      return nativeKill(pid, signal as NodeJS.Signals);
    }) as typeof process.kill;
    proc.child.kill = (() => { throw Object.assign(new Error('sandbox denied child kill'), { code: 'EPERM' }); }) as typeof proc.child.kill;
    try {
      await expect(proc.terminate(5)).rejects.toThrow('did not close within the termination deadline');
    } finally {
      process.kill = nativeKill;
      proc.child.kill = nativeChildKill;
      if (proc.child.exitCode === null && proc.child.signalCode === null && proc.child.pid) {
        try { nativeKill(proc.child.pid, 'SIGKILL'); } catch { /* process already exited */ }
      }
      await Promise.race([proc.done.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 500))]);
    }
  });
});
