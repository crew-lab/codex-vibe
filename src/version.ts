import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'vibe-supervisor';

function readManifest(directory: string): { name?: unknown; version?: unknown } | undefined {
  try { return JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }; }
  catch { return undefined; }
}

function readVersion(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = readManifest(directory);
    if (manifest?.name === PACKAGE_NAME && typeof manifest.version === 'string' && manifest.version) return manifest.version;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('The vibe-supervisor package.json was not found next to the module.');
    directory = parent;
  }
}

export const APP_VERSION = readVersion();
