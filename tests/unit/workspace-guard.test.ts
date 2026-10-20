import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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

async function createGitRepository(dir: string): Promise<void> {
  const gitDir = path.join(dir, '.git');
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
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

  it('recognizes detached Git worktree with valid gitdir as a proven boundary and stops traversal', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), 'agent instructions');
    const commonGitDir = path.join(root, 'common-git-dir');
    await mkdir(commonGitDir, { recursive: true });

    const worktreeDir = path.join(root, 'worktree');
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(path.join(worktreeDir, '.git'), `gitdir: ${commonGitDir}\n`);

    await expect(assertNoProjectAntigravityExtensions(worktreeDir)).resolves.toBeUndefined();

    const relativeWorktreeDir = path.join(root, 'worktree-relative');
    await mkdir(relativeWorktreeDir, { recursive: true });
    await writeFile(path.join(relativeWorktreeDir, '.git'), 'gitdir: ../common-git-dir\n');

    await expect(assertNoProjectAntigravityExtensions(relativeWorktreeDir)).resolves.toBeUndefined();
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
