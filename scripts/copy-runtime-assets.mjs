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
await copyFile(path.join(root, 'src', 'backends', 'runtime', 'app_server_bootstrap.py'), path.join(output, 'app_server_bootstrap.py'));
const appServer = path.join(distRoot, 'backends', 'app-server');
await mkdir(appServer, { recursive: true });
await copyFile(path.join(root, 'src', 'backends', 'app-server', 'vibe-2.26.1-macos-arm64.json'), path.join(appServer, 'vibe-2.26.1-macos-arm64.json'));
const files = await readdir(output);
if (files.length !== 2 || !files.includes('vibe_supervisor_launcher.py') || !files.includes('app_server_bootstrap.py')) throw new Error('Unexpected backend runtime asset was copied');
process.stdout.write('Copied the pinned Vibe launch shim into dist/backends/runtime.\n');
