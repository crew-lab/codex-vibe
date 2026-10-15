import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generatePinManifest, serializePinManifest } from '../../../src/backends/app-server/pin.js';
import { makeFakeVibeEnvironment } from './fake-vibe-environment.js';

const fixture = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'fake-vibe-app-server.mjs');

export interface LaunchableFakeVibe {
  vibe: string;
  appServer: string;
  manifest: string;
  workerRecord: string;
}

export interface LaunchableOptions {
  scenario: Record<string, unknown>;
  spawnGrandchild?: boolean;
}

export async function makeLaunchableFakeVibe(directory: string, options: LaunchableOptions): Promise<LaunchableFakeVibe> {
  await mkdir(directory, { recursive: true });
  const scenarioFile = path.join(directory, 'scenario.json');
  await writeFile(scenarioFile, JSON.stringify(options.scenario));
  const workerRecord = path.join(directory, 'worker.json');
  const scriptBody = [
    "const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process');",
    options.spawnGrandchild
      ? "const grandchild = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }).pid;"
      : 'const grandchild = null;',
    `fs.writeFileSync(${JSON.stringify(workerRecord)}, JSON.stringify({ pid: process.pid, grandchild }));`,
    '(async () => {',
    `  const { parse } = await import(${JSON.stringify(import.meta.resolve('smol-toml'))});`,
    "  const agents = path.join(process.env.VIBE_HOME, 'agents');",
    "  const profile = parse(fs.readFileSync(path.join(agents, fs.readdirSync(agents).find((name) => name.endsWith('.toml'))), 'utf8'));",
    `  const scenario = JSON.parse(fs.readFileSync(${JSON.stringify(scenarioFile)}, 'utf8'));`,
    '  scenario.effectiveConfig = { ...(scenario.effectiveConfig ?? {}), tools: profile.tools };',
    "  const resolved = path.join(process.env.TMPDIR, 'scenario.json');",
    '  fs.writeFileSync(resolved, JSON.stringify(scenario));',
    "  process.argv.push('--scenario', resolved);",
    `  await import(${JSON.stringify(pathToFileURL(fixture).href)});`,
    '})();',
    ''
  ].join('\n');
  const fake = await makeFakeVibeEnvironment(directory, undefined, { scriptBody, interpreterTarget: process.execPath });
  const manifest = path.join(directory, 'vibe-pin-manifest.json');
  await writeFile(manifest, serializePinManifest(await generatePinManifest({ executable: fake.shim })), { mode: 0o600 });
  return { vibe: fake.vibeShim, appServer: fake.shim, manifest, workerRecord };
}
