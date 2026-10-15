import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, cp } from 'node:fs/promises';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');

export default async function setup(): Promise<() => Promise<void>> {
  const cacheRoot = path.join(repo, 'node_modules', '.cache');
  await mkdir(cacheRoot, { recursive: true });
  const buildRoot = await mkdtemp(path.join(cacheRoot, 'vsup-test-dist-'));
  const dist = path.join(buildRoot, 'dist');
  for (const file of ['package.json', 'schemas', 'scripts']) await cp(path.join(repo,file), path.join(buildRoot,file), {recursive:true});
  const compile = spawnSync(process.execPath, [path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '--outDir', dist], { cwd: repo, encoding: 'utf8' });
  if (compile.status !== 0) {
    await rm(buildRoot, { recursive: true, force: true });
    throw new Error(`Isolated test build failed:\n${compile.stdout}${compile.stderr}`);
  }
  process.env.VIBE_SUPERVISOR_TEST_DIST = dist;
  return async () => { await rm(buildRoot, { recursive: true, force: true }); };
}
