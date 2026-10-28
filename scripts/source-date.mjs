import { spawnSync } from 'node:child_process';

const SECONDS = /^\d+$/;

function commitSeconds(root) {
  const result = spawnSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 });
  const output = result.status === 0 ? result.stdout.trim() : '';
  return SECONDS.test(output) ? output : undefined;
}

export function sourceDate(root, env = process.env) {
  const configured = env.SOURCE_DATE_EPOCH;
  if (configured !== undefined && configured !== '' && !SECONDS.test(configured)) throw new Error(`SOURCE_DATE_EPOCH must be whole seconds since the Unix epoch, got ${JSON.stringify(configured)}.`);
  const seconds = configured || commitSeconds(root);
  if (!seconds) throw new Error('No source date: set SOURCE_DATE_EPOCH or build from a Git checkout with a HEAD commit.');
  return new Date(Number(seconds) * 1000).toISOString();
}
