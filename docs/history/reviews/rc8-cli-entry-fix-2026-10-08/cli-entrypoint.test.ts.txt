import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/version.js';

const exec = promisify(execFile);
const roots: string[] = [];
const cli = path.resolve(import.meta.dirname, '../../dist/cli.js');
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function installedCommand() {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-cli-entry-'));
  roots.push(root);
  const command = path.join(root, 'vibe-supervisor');
  await symlink(cli, command);
  return command;
}

describe('CLI executable entry point', () => {
  it('prints the package version through an npm-style executable symlink', async () => {
    const { stdout, stderr } = await exec(process.execPath, [await installedCommand(), '--version']);
    expect(stdout.trim()).toBe(APP_VERSION);
    expect(stderr).toBe('');
  });

  it('executes command validation through the executable symlink', async () => {
    await expect(exec(process.execPath, [await installedCommand(), 'not-a-command'])).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('Unknown command') });
  });

  it('does not run the CLI when the module is imported', async () => {
    const { stdout, stderr } = await exec(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(cli)});`]);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });
});
