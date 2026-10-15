import path from 'node:path';
import { lstat } from 'node:fs/promises';
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
