import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputs = process.argv.slice(2).map((item) => path.resolve(item));
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.isFile()) files.push(file);
  }
}
if (inputs.length) files.push(...inputs);
else await collect(path.join(root, 'dist'));
for (const file of files.sort()) {
  const digest = createHash('sha256').update(await readFile(file)).digest('hex');
  process.stdout.write(`${digest}  ${file.startsWith(root + path.sep) ? path.relative(root, file) : file}\n`);
}
