import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');

export default async function setup(): Promise<() => Promise<void>> {
  const cacheRoot = path.join(repo, 'node_modules', '.cache');
  await mkdir(cacheRoot, { recursive: true });
  const dist = await mkdtemp(path.join(cacheRoot, 'vsup-test-dist-'));
  const compile = spawnSync(process.execPath, [path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '--outDir', dist], { cwd: repo, encoding: 'utf8' });
  const assets = compile.status === 0 ? spawnSync(process.execPath, [path.join(repo, 'scripts', 'copy-runtime-assets.mjs'), dist], { cwd: repo, encoding: 'utf8' }) : compile;
  if (assets.status !== 0) {
    await rm(dist, { recursive: true, force: true });
    throw new Error(`Isolated test build failed:\n${compile.stdout}${compile.stderr}${assets.stdout}${assets.stderr}`);
  }
  process.env.VIBE_SUPERVISOR_TEST_DIST = dist;
  return async () => { await rm(dist, { recursive: true, force: true }); };
}
