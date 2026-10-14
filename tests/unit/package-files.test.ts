import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');

it('ships documentation but no dated evidence', async () => {
  const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
  const report = JSON.parse(stdout.slice(stdout.indexOf('['))) as { files: { path: string }[] }[];
  const files = report[0]!.files.map((file) => file.path);
  expect(files).toContain('docs/security.md');
  expect(files.filter((file) => file.startsWith('docs/history/') || file.startsWith('docs/reviews/'))).toEqual([]);
}, 60_000);
