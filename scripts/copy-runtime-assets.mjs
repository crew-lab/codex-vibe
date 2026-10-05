import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'backends', 'runtime', 'vibe_supervisor_launcher.py');
const distRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist');
const output = path.join(distRoot, 'backends', 'runtime');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await copyFile(source, path.join(output, 'vibe_supervisor_launcher.py'));
const files = await readdir(output);
if (files.length !== 1 || files[0] !== 'vibe_supervisor_launcher.py') throw new Error('Unexpected backend runtime asset was copied');
process.stdout.write('Copied the pinned Vibe launch shim into dist/backends/runtime.\n');
