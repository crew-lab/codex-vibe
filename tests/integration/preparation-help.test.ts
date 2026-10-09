import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, realpath, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('prints help without accessing invalid configuration or creating preparation output', async () => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'preparation-help-'));
  roots.push(root);
  const home = path.join(root, 'home');
  await mkdir(home, { mode: 0o700 });
  const config = 'invalid_setting = "PRIVATE_CONFIG_SENTINEL"\n';
  await writeFile(path.join(home, 'config.toml'), config, { mode: 0o600 });
  const script = path.resolve(import.meta.dirname, '../../scripts/prepare-reviewed-baseline.mjs');
  const env = { ...process.env, VIBE_SUPERVISOR_HOME: home, VIBE_SUPERVISOR_DIST_DIR: process.env.VIBE_SUPERVISOR_TEST_DIST };
  const help = await exec(process.execPath, [script, '--help'], { env });
  expect(help.stderr).toBe('');
  expect(JSON.parse(help.stdout)).toMatchObject({ status: 'help', usage: expect.stringContaining('Usage:') });
  for (const args of [['--help', 'extra'], ['--help', '--create']]) {
    await expect(exec(process.execPath, [script, ...args], { env })).rejects.toMatchObject({ code: 1, stdout: '', stderr: expect.stringContaining('VSBASE_INPUT_INVALID') });
  }
  await expect(exec(process.execPath, [script, '/nonexistent/manifest.json'], { env })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('VSBASE_CONFIG_INVALID') });
  expect(await readFile(path.join(home, 'config.toml'), 'utf8')).toBe(config);
  expect(await readdir(root)).toEqual(['home']);
  expect(await readdir(home)).toEqual(['config.toml']);
});
