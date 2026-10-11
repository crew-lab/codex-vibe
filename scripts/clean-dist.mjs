import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') {
  throw new Error('Refusing to clean a build output outside the repository dist directory.');
}

try {
  const stat = await lstat(dist);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Refusing to clean dist because it is not a repository-owned directory.');
  }
  await rm(dist, { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
