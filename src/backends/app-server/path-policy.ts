import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isPathWithinRoot } from '../../security/paths.js';
import { supervisorError } from '../../contracts.js';

const RESERVED = new Set(['.git', '.vibe', '.agents']);
const GENERATED = new Set(['.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache', '.tox', '.nox', '.coverage', 'htmlcov', 'dist', 'build', '.idea', '.vscode']);

export function prohibited(relative: string): boolean {
  const parts = relative.split(path.sep);
  return parts.some(part => RESERVED.has(part.toLowerCase()) || part.toLowerCase() === '.vibeignore' || /^\.env(?:rc)?(?:\..*)?$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part));
}

export function searchExcluded(relative: string): boolean {
  return prohibited(relative) || relative.split(path.sep).some(part => GENERATED.has(part) || /(?:\.egg-info|\.py[cod]|\.env(?:rc)?(?:\..*)?)$/.test(part) || part === '.DS_Store' || part === 'Thumbs.db');
}

/** Refuse every symlink component. The caller's root was admitted independently. */
export async function checkedPath(root: string, input: string, allowMissing = false): Promise<string> {
  if (!input || input.includes('\0') || input.split(/[\\/]/).includes('..')) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Invalid tool path.');
  const candidate = path.resolve(root, input);
  const relative = path.relative(root, candidate);
  if (!isPathWithinRoot(root, candidate) || prohibited(relative)) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Tool path is outside the approved profile.');
  if (await realpath(root) !== root || (await lstat(root)).isSymbolicLink()) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Worker root identity changed.');
  let current = root;
  const parts = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index] as string);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Tool path has an unsafe component.');
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw error;
    }
  }
  return candidate;
}

/** Check identities before releasing content; never follow a final symlink or block on a FIFO. */
export async function readSearchFile(root: string, relative: string): Promise<{ text?: string; reason?: string }> {
  const file = await checkedPath(root, relative);
  const before = await lstat(file);
  if (!before.isFile()) return { reason: 'special_file' };
  if (before.size > 1_048_576) return { reason: 'file_size_limit' };
  const descriptor = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await descriptor.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > 1_048_576) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Search file changed while opening.');
    const bytes = Buffer.alloc(opened.size + 1);
    const { bytesRead } = await descriptor.read(bytes, 0, bytes.length, 0);
    const after = await descriptor.stat();
    const current = await lstat(await checkedPath(root, relative));
    if (bytesRead !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || current.ino !== opened.ino || current.dev !== opened.dev) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Search file identity changed while reading.');
    const data = bytes.subarray(0, bytesRead);
    if (data.includes(0)) return { reason: 'binary_file' };
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(data) }; }
    catch { return { reason: 'non_utf8_file' }; }
  } finally { await descriptor.close(); }
}
