import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SUPPORTED_VIBE } from '../../../src/backends/pinned.js';

export interface FakeVibeEnvironment {
  root: string;
  site: string;
  distInfo: string;
  script: string;
  shim: string;
  vibeShim: string;
}

const recordHash = (data: Buffer): string => `sha256=${createHash('sha256').update(data).digest('base64url')}`;

async function put(file: string, content: string | Buffer, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  if (mode !== undefined) await chmod(file, mode);
}

export async function makeFakeVibeEnvironment(scratch: string, version: string = SUPPORTED_VIBE): Promise<FakeVibeEnvironment> {
  const root = path.join(scratch, 'tools', 'mistral-vibe');
  const basePython = path.join(scratch, 'base-python', 'python3.12');
  const site = path.join(root, 'lib', 'python3.12', 'site-packages');
  const distInfo = path.join(site, `mistral_vibe-${version}.dist-info`);
  await put(basePython, '', 0o755);
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await symlink(basePython, path.join(root, 'bin', 'python'));
  await put(path.join(root, 'pyvenv.cfg'), 'home = /opt/python\n');
  const script = path.join(root, 'bin', 'vibe-app-server');
  await put(script, `#!${path.join(root, 'bin', 'python')}\nimport sys\nfrom vibe.app_server import main\nsys.exit(main())\n`, 0o755);
  await put(path.join(site, 'vibe', '__init__.py'), `__version__ = "${version}"\n`);
  await put(path.join(site, 'vibe', 'app_server', '__init__.py'), 'def main():\n    return 0\n');
  await put(path.join(site, '_native.so'), Buffer.from([0, 1, 2, 3, 250, 251, 252]));
  await put(path.join(distInfo, 'METADATA'), `Metadata-Version: 2.4\nName: mistral-vibe\nVersion: ${version}\n\nDescription\n`);
  await put(path.join(distInfo, 'WHEEL'), 'Wheel-Version: 1.0\n');
  const shim = path.join(scratch, 'user-bin', 'vibe-app-server');
  const vibeShim = path.join(scratch, 'user-bin', 'vibe');
  await mkdir(path.dirname(shim), { recursive: true });
  await symlink(script, shim);
  await put(vibeShim, '#!/bin/sh\nexit 0\n', 0o755);
  const rows = ['vibe/__init__.py', 'vibe/app_server/__init__.py', '_native.so', `${path.basename(distInfo)}/METADATA`, `${path.basename(distInfo)}/WHEEL`, '../../../bin/vibe-app-server'];
  const lines: string[] = [];
  for (const relative of rows) {
    const data = await readFile(path.join(site, relative));
    lines.push(`${relative},${recordHash(data)},${data.length}`);
  }
  lines.push(`${path.basename(distInfo)}/RECORD,,`);
  await writeFile(path.join(distInfo, 'RECORD'), `${lines.join('\n')}\n`);
  return { root, site, distInfo, script, shim, vibeShim };
}
