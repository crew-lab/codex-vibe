import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function readOwnedFile(file: string, maxBytes = 100 * 1024 * 1024): Promise<Buffer> {
  if (!path.isAbsolute(file) || await realpath(file) !== file) throw new Error('Noncanonical or linked artifact');
  const before = await lstat(file);
  const foreign = typeof process.getuid === 'function' && before.uid !== process.getuid();
  if (!before.isFile() || before.isSymbolicLink() || foreign || (before.mode & 0o077) !== 0 || before.nlink !== 1 || before.size > maxBytes) throw new Error('Unsafe artifact');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (info.ino !== before.ino || info.dev !== before.dev || !info.isFile() || info.size > maxBytes) throw new Error('Artifact changed');
    const bytes = await handle.readFile(); const after = await handle.stat(); const current = await lstat(file);
    if (bytes.length > maxBytes || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || current.ino !== info.ino || current.dev !== info.dev) throw new Error('Artifact changed while reading');
    return bytes;
  } finally { await handle.close(); }
}

export async function assertOwnedDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory) || await realpath(directory) !== directory) throw new Error('Unsafe directory');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Unsafe directory');
}
