import path from 'node:path';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { WorkspacePathError } from './paths.js';

export function assertSimpleGlobRoot(root: string): void {
  if (/[\*?\[\]]/.test(root)) throw new WorkspacePathError(`Workspace path contains glob characters (* ? [ ]) and cannot be safely encoded for Vibe: ${root}`);
}

export async function assertNoProjectVibeExtensions(root: string): Promise<void> {
  const canonical = path.resolve(root);
  for (const rel of ['.vibe']) {
    try {
      const info = await lstat(path.join(canonical, rel));
      if (info.isSymbolicLink() || info.isDirectory() || info.isFile()) {
        throw new WorkspacePathError(`Workspace ${canonical} contains project Vibe configuration at ${rel}; this profile cannot prove it inactive. Remove it or use a workspace without it.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  try {
    const info = await lstat(path.join(canonical, '.agents'));
    if (info.isSymbolicLink() || !info.isDirectory()) throw new WorkspacePathError(`Workspace ${canonical} has a .agents path that is not a regular non-symlink directory.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const ignore = path.join(canonical, '.vibeignore');
  try {
    const info = await lstat(ignore);
    if (info.isSymbolicLink() || !info.isFile()) throw new WorkspacePathError(`Workspace ${canonical} has a .vibeignore that is a symlink or not a regular file; replace it with a regular file or remove it.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const ANTIGRAVITY_INSPECTION_TARGETS = ['.gemini', '.agent', '.agents', 'GEMINI.md', 'AGENTS.md'] as const;

async function isProvenGitBoundary(directory: string): Promise<boolean> {
  try {
    const gitPath = path.join(directory, '.git');
    const gitInfo = await lstat(gitPath);
    if (gitInfo.isDirectory()) {
      const headInfo = await stat(path.join(gitPath, 'HEAD')).catch(() => null);
      return headInfo !== null && headInfo.isFile();
    }
    if (gitInfo.isFile()) {
      const content = await readFile(gitPath, 'utf8');
      const match = /^gitdir:\s*(\S.*)$/m.exec(content);
      if (!match) return false;
      const rawGitDir = match[1]?.trim();
      if (!rawGitDir) return false;
      const resolvedGitDir = path.resolve(directory, rawGitDir);
      const realGitDir = await realpath(resolvedGitDir).catch(() => null);
      if (!realGitDir) return false;
      const targetInfo = await stat(realGitDir).catch(() => null);
      return targetInfo !== null && targetInfo.isDirectory();
    }
    return false;
  } catch {
    return false;
  }
}

export async function assertNoProjectAntigravityExtensions(root: string): Promise<void> {
  const canonical = path.resolve(root);
  let current = canonical;
  while (true) {
    for (const rel of ANTIGRAVITY_INSPECTION_TARGETS) {
      const targetPath = path.join(current, rel);
      try {
        const info = await lstat(targetPath);
        if (info.isSymbolicLink() || info.isDirectory() || info.isFile()) {
          if (current === canonical) {
            throw new WorkspacePathError(`Workspace ${canonical} contains project Antigravity configuration at ${rel}; this profile cannot prove it inactive. Remove it or use a workspace without it.`);
          }
          throw new WorkspacePathError(`Workspace ${canonical} contains project Antigravity configuration in ancestor directory ${current} at ${rel}; this profile cannot prove it inactive. Remove it or use a workspace without it.`);
        }
      } catch (error) {
        if (error instanceof WorkspacePathError) {
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new WorkspacePathError(`Workspace ${canonical} path ${targetPath} could not be inspected: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (await isProvenGitBoundary(current)) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}
