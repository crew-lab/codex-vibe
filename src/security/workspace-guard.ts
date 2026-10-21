import path from 'node:path';
import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { WorkspacePathError } from './paths.js';

const execFileAsync = promisify(execFile);

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

const GIT_PROBE_TIMEOUT_MS = 5000;

function gitProbeEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C'
  };
}

async function gitTopLevel(directory: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: directory,
      env: gitProbeEnvironment(),
      timeout: GIT_PROBE_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    });
    const reported = stdout.trim();
    return reported ? await realpath(reported) : null;
  } catch {
    return null;
  }
}

async function isProvenGitBoundary(directory: string): Promise<boolean> {
  try {
    const gitInfo = await lstat(path.join(directory, '.git'));
    if (gitInfo.isSymbolicLink() || !(gitInfo.isDirectory() || gitInfo.isFile())) return false;
    const [topLevel, canonicalDirectory] = await Promise.all([gitTopLevel(directory), realpath(directory)]);
    return topLevel !== null && topLevel === canonicalDirectory;
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
