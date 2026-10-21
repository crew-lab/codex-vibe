import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  assertNoProjectAntigravityExtensions,
  assertNoProjectVibeExtensions,
  assertSimpleGlobRoot,
} from '../../src/security/workspace-guard.js';
import { WorkspacePathError } from '../../src/security/paths.js';

let root = '';

beforeEach(async () => { root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'workspace-guard-'))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('project Vibe state is untrusted', () => {
  it('accepts a plain workspace and a real .agents directory', async () => {
    await expect(assertNoProjectVibeExtensions(root)).resolves.toBeUndefined();
    await mkdir(path.join(root, '.agents', 'skills'), { recursive: true });
    await expect(assertNoProjectVibeExtensions(root)).resolves.toBeUndefined();
  });

  it('rejects a project .vibe directory, file or symlink', async () => {
    await mkdir(path.join(root, '.vibe'));
    await expect(assertNoProjectVibeExtensions(root)).rejects.toBeInstanceOf(WorkspacePathError);
    await rm(path.join(root, '.vibe'), { recursive: true });
    await writeFile(path.join(root, '.vibe'), 'x');
    await expect(assertNoProjectVibeExtensions(root)).rejects.toBeInstanceOf(WorkspacePathError);
    await rm(path.join(root, '.vibe'));
    await symlink(root, path.join(root, '.vibe'));
    await expect(assertNoProjectVibeExtensions(root)).rejects.toBeInstanceOf(WorkspacePathError);
  });

  it('rejects a symlinked or non-directory .agents and a symlinked .vibeignore', async () => {
    await symlink(root, path.join(root, '.agents'));
    await expect(assertNoProjectVibeExtensions(root)).rejects.toThrow(/\.agents/);
    await rm(path.join(root, '.agents'));
    await writeFile(path.join(root, '.agents'), 'x');
    await expect(assertNoProjectVibeExtensions(root)).rejects.toThrow(/\.agents/);
    await rm(path.join(root, '.agents'));
    await symlink(path.join(root, 'elsewhere'), path.join(root, '.vibeignore'));
    await expect(assertNoProjectVibeExtensions(root)).rejects.toThrow(/\.vibeignore/);
    await rm(path.join(root, '.vibeignore'));
    await writeFile(path.join(root, '.vibeignore'), 'node_modules\n');
    await expect(assertNoProjectVibeExtensions(root)).resolves.toBeUndefined();
  });

  it('refuses workspace paths with glob characters', () => {
    for (const bad of ['/work/a*b', '/work/a?b', '/work/[a]']) expect(() => assertSimpleGlobRoot(bad), bad).toThrow(WorkspacePathError);
    expect(() => assertSimpleGlobRoot('/work/plain-dir')).not.toThrow();
  });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    stdio: 'ignore',
    env: { PATH: process.env.PATH ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  });
}

async function createGitRepository(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
}

describe('project Antigravity state is untrusted', () => {
  it('accepts a clean workspace at Git repository root', async () => {
    await createGitRepository(root);
    await expect(assertNoProjectAntigravityExtensions(root)).resolves.toBeUndefined();
  });

  it('accepts a clean subfolder workspace in a Git repository', async () => {
    await createGitRepository(root);
    const subfolder = path.join(root, 'packages', 'app');
    await mkdir(subfolder, { recursive: true });
    await expect(assertNoProjectAntigravityExtensions(subfolder)).resolves.toBeUndefined();
  });

  it('rejects Antigravity configuration at workspace root', async () => {
    await createGitRepository(root);
    const targets = ['.gemini', '.agent', '.agents', 'GEMINI.md', 'AGENTS.md'];
    for (const target of targets) {
      const targetPath = path.join(root, target);
      await writeFile(targetPath, 'content');
      await expect(assertNoProjectAntigravityExtensions(root)).rejects.toThrow(
        `Workspace ${root} contains project Antigravity configuration at ${target}; this profile cannot prove it inactive. Remove it or use a workspace without it.`
      );
      await rm(targetPath, { recursive: true, force: true });

      await mkdir(targetPath, { recursive: true });
      await expect(assertNoProjectAntigravityExtensions(root)).rejects.toThrow(
        `Workspace ${root} contains project Antigravity configuration at ${target}; this profile cannot prove it inactive. Remove it or use a workspace without it.`
      );
      await rm(targetPath, { recursive: true, force: true });
    }
  });

  it('rejects Antigravity configuration in ancestor directory of subfolder workspace', async () => {
    await createGitRepository(root);
    const subfolder = path.join(root, 'nested', 'workspace');
    await mkdir(subfolder, { recursive: true });
    const targets = ['.gemini', '.agent', '.agents', 'GEMINI.md', 'AGENTS.md'];
    for (const target of targets) {
      const targetPath = path.join(root, target);
      await writeFile(targetPath, 'content');
      await expect(assertNoProjectAntigravityExtensions(subfolder)).rejects.toThrow(
        `Workspace ${subfolder} contains project Antigravity configuration in ancestor directory ${root} at ${target}; this profile cannot prove it inactive. Remove it or use a workspace without it.`
      );
      await rm(targetPath, { recursive: true, force: true });
    }
  });

  it('ignores configuration in ancestor directory above a proven Git boundary', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), 'agent instructions');
    await mkdir(path.join(root, '.gemini'), { recursive: true });
    const repoDir = path.join(root, 'repo');
    await mkdir(repoDir);
    await createGitRepository(repoDir);
    await expect(assertNoProjectAntigravityExtensions(repoDir)).resolves.toBeUndefined();

    const subfolder = path.join(repoDir, 'src');
    await mkdir(subfolder);
    await expect(assertNoProjectAntigravityExtensions(subfolder)).resolves.toBeUndefined();
  });

  it('does not treat dummy .git files as boundaries and detects ancestor configuration', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), 'agent instructions');
    const dummyRepo = path.join(root, 'dummy-repo');
    await mkdir(dummyRepo);
    const dummyGitPath = path.join(dummyRepo, '.git');

    await writeFile(dummyGitPath, '');
    await expect(assertNoProjectAntigravityExtensions(dummyRepo)).rejects.toThrow(WorkspacePathError);

    await writeFile(dummyGitPath, 'invalid gitdir format');
    await expect(assertNoProjectAntigravityExtensions(dummyRepo)).rejects.toThrow(WorkspacePathError);

    await writeFile(dummyGitPath, `gitdir: ${path.join(root, 'non-existent-git-dir')}\n`);
    await expect(assertNoProjectAntigravityExtensions(dummyRepo)).rejects.toThrow(WorkspacePathError);
  });

  it('does not treat .git directory without HEAD as a boundary', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), 'agent instructions');
    const brokenRepo = path.join(root, 'broken-repo');
    await mkdir(path.join(brokenRepo, '.git'), { recursive: true });
    await expect(assertNoProjectAntigravityExtensions(brokenRepo)).rejects.toThrow(WorkspacePathError);
  });

  it('refuses a .git pointer to an empty directory that Git itself rejects', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), 'agent instructions');
    const emptyGitDir = path.join(root, 'empty-git-dir');
    await mkdir(emptyGitDir, { recursive: true });
    const pointed = path.join(root, 'pointed');
    await mkdir(pointed, { recursive: true });
    await writeFile(path.join(pointed, '.git'), `gitdir: ${emptyGitDir}\n`);
    await expect(assertNoProjectAntigravityExtensions(pointed)).rejects.toThrow(WorkspacePathError);

    const emptyDotGit = path.join(root, 'empty-dot-git');
    await mkdir(path.join(emptyDotGit, '.git'), { recursive: true });
    await expect(assertNoProjectAntigravityExtensions(emptyDotGit)).rejects.toThrow(WorkspacePathError);
  });

  it('recognizes a real detached Git worktree as a boundary and stops traversal', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), 'agent instructions');
    const main = path.join(root, 'main-repo');
    await createGitRepository(main);
    const worktreeDir = path.join(root, 'worktree');
    git(main, 'worktree', 'add', '-q', '--detach', worktreeDir);
    await expect(assertNoProjectAntigravityExtensions(worktreeDir)).resolves.toBeUndefined();

    const nested = path.join(worktreeDir, 'packages', 'app');
    await mkdir(nested, { recursive: true });
    await expect(assertNoProjectAntigravityExtensions(nested)).resolves.toBeUndefined();
  });

  it('still refuses configuration inside a real repository or worktree', async () => {
    const main = path.join(root, 'main-repo');
    await createGitRepository(main);
    const worktreeDir = path.join(root, 'worktree');
    git(main, 'worktree', 'add', '-q', '--detach', worktreeDir);
    await writeFile(path.join(worktreeDir, 'GEMINI.md'), 'instructions');
    await expect(assertNoProjectAntigravityExtensions(worktreeDir)).rejects.toThrow(/GEMINI\.md/);
    await mkdir(path.join(main, '.agents'));
    await expect(assertNoProjectAntigravityExtensions(main)).rejects.toThrow(/\.agents/);
  });

  it('fails closed when customization paths cannot be inspected', async () => {
    await createGitRepository(root);
    const restrictedParent = path.join(root, 'restricted');
    const childWorkspace = path.join(restrictedParent, 'child');
    await mkdir(childWorkspace, { recursive: true });
    await chmod(restrictedParent, 0o000);
    try {
      await expect(assertNoProjectAntigravityExtensions(childWorkspace)).rejects.toThrow(WorkspacePathError);
      await expect(assertNoProjectAntigravityExtensions(childWorkspace)).rejects.toThrow(/could not be inspected/);
    } finally {
      await chmod(restrictedParent, 0o755);
    }
  });
});
