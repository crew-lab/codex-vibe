import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertNoProjectVibeExtensions, assertSimpleGlobRoot } from '../../src/security/workspace-guard.js';
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
