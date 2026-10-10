import { realpath, lstat, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export class WorkspacePathError extends Error {
  readonly code = 'VSUP_WORKSPACE_INVALID';
  constructor(message = 'Workspace path is invalid or outside configured roots') {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function expandHome(input: string, home = process.env.HOME ?? ''): string {
  if (input === '~') return home;
  if (input.startsWith(`~${path.sep}`)) return path.join(home, input.slice(2));
  return input;
}

function sharedTemporaryRoots(): Set<string> {
  const roots = [tmpdir()];
  if (process.platform === 'darwin' || process.platform === 'linux') roots.push('/tmp', '/var/tmp');
  if (process.platform === 'darwin') roots.push('/private/tmp', '/private/var/tmp');
  return new Set(roots.map(root => path.resolve(root)));
}

/** Reject broad roots consistently in config parsing and setup/allow. */
export function assertWorkspaceRootScope(input: string, home = process.env.HOME ?? process.env.USERPROFILE ?? homedir()): string {
  if (input.split(/[\\/]+/).includes('..')) throw new WorkspacePathError('Workspace root must not contain parent-directory components.');
  const expanded = path.resolve(expandHome(input, home));
  const canonicalHome = path.resolve(home);
  const sharedHomeParent = process.platform === 'win32'
    ? path.join(path.parse(canonicalHome).root, 'Users')
    : '/Users';
  const broad = [path.parse(expanded).root, canonicalHome, path.resolve(sharedHomeParent), path.resolve('/home')];
  if (broad.some(root => expanded === root || isPathWithinRoot(expanded, root)) || sharedTemporaryRoots().has(expanded)) {
    throw new WorkspacePathError('Workspace root is too broad; allow a project directory, not a filesystem root, home parent, or global temporary directory.');
  }
  return expanded;
}

/** Ensure allowlist entries exist as canonical directories and cannot use symlink aliases. */
export async function resolveCanonicalWorkspaceRoot(input: string, home?: string): Promise<string> {
  const expanded = assertWorkspaceRootScope(input, home);
  let canonical: string;
  try { canonical = await realpath(expanded); } catch { throw new WorkspacePathError('Configured workspace root must exist as a directory.'); }
  if (canonical !== expanded) throw new WorkspacePathError('Configured workspace root must use its canonical path, without symlink components.');
  let info;
  try { info = await lstat(canonical); } catch { throw new WorkspacePathError('Configured workspace root must exist as a directory.'); }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new WorkspacePathError('Configured workspace root must be a real directory.');
  const canonicalTemporaryRoots = sharedTemporaryRoots();
  for (const temporaryRoot of canonicalTemporaryRoots) {
    const resolved = await realpath(temporaryRoot).catch(() => temporaryRoot);
    canonicalTemporaryRoots.add(resolved);
  }
  if (canonicalTemporaryRoots.has(canonical)) throw new WorkspacePathError('The global temporary directory is too broad to allow.');
  return canonical;
}

export async function validateWorkspaceRootsAtUse(roots: readonly string[], home?: string): Promise<string[]> {
  const canonical = await Promise.all(roots.map(root => resolveCanonicalWorkspaceRoot(root, home)));
  if (new Set(canonical).size !== canonical.length) throw new WorkspacePathError('Workspace roots must be unique after canonicalization.');
  return canonical;
}

/** Canonicalize both sides before containment checks; string prefixes are never used. */
export async function resolveCanonicalRoot(input: string, allowedRoots: readonly string[], home?: string): Promise<string> {
  const candidateInput = path.resolve(expandHome(input, home));
  let candidate: string;
  try { candidate = await realpath(candidateInput); } catch { throw new WorkspacePathError(); }
  const canonicalRoots = await Promise.all(allowedRoots.map(async (root) => {
    try { return await resolveCanonicalWorkspaceRoot(root, home); } catch { return null; }
  }));
  if (!canonicalRoots.some((root) => root !== null && isPathWithinRoot(root, candidate))) throw new WorkspacePathError();
  return candidate;
}

export async function assertPathWithinRoot(root: string, candidate: string): Promise<string> {
  const [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!isPathWithinRoot(canonicalRoot, canonicalCandidate)) throw new WorkspacePathError();
  return canonicalCandidate;
}

export async function resolveContextFile(root: string, file: string): Promise<string> {
  const candidate = path.resolve(root, file);
  let canonical: string;
  try { canonical = await realpath(candidate); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new WorkspacePathError(`context_files entry does not exist: ${file}`);
    throw error;
  }
  if (!isPathWithinRoot(await realpath(root), canonical)) throw new WorkspacePathError(`context_files entry resolves outside the workspace: ${file}`);
  return canonical;
}

export async function createPrivateDir(dir: string): Promise<void> {
  const absolute = path.resolve(dir);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new WorkspacePathError('Private directory path contains a symlink or non-directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new WorkspacePathError('Private directory changed during creation');
    }
  }
  const { chmod } = await import('node:fs/promises');
  await chmod(absolute, 0o700);
}

async function assertNoSymlinkComponents(input: string): Promise<void> {
  const absolute = path.resolve(input);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new WorkspacePathError('Private path contains a symlink');
  }
}

export async function createPrivateFile(file: string, data: string | Uint8Array, flag: 'wx' | 'w' = 'wx'): Promise<void> {
  const parent = path.dirname(path.resolve(file));
  await assertNoSymlinkComponents(parent);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory()) throw new WorkspacePathError('Private file parent must be a real directory');
  const absolute = path.resolve(file);
  if (flag === 'w') {
    try { const info = await lstat(absolute); if (info.isSymbolicLink() || !info.isFile()) throw new WorkspacePathError('Private file must be a regular file'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(absolute, flag === 'wx' ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow : constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow, 0o600);
  try { await handle.chmod(0o600); await handle.writeFile(data); await handle.sync(); }
  finally { await handle.close(); }
}
