import { execFile } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');

it('ships documentation and the runtime installer without mutating the shared build', async () => {
  const staging = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-package-files-'));
  const ignored = new Set(['node_modules', '.git', 'release', 'coverage']);
  try {
    await cp(repo, staging, { recursive: true, filter: file => !path.relative(repo, file).split(path.sep).some(part => ignored.has(part)) });
    await symlink(path.join(repo, 'node_modules'), path.join(staging, 'node_modules'), 'dir');
    const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: staging, maxBuffer: 16 * 1024 * 1024 });
    const report = JSON.parse(stdout.slice(stdout.indexOf('['))) as { files: { path: string }[] }[];
    const files = report[0]!.files.map(file => file.path);
    expect(files).toContain('docs/security.md');
    expect(files).toContain('scripts/runtime-install.mjs');
    expect(files.filter(file => /^docs\/(history|reviews)\//.test(file))).toEqual([]);
    expect(files.filter(file => /^(marketing|research|planning)\//.test(file))).toEqual([]);
  } finally { await rm(staging, { recursive: true, force: true }); }
}, 60_000);
