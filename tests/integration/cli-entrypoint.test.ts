import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('doctor selects the explicit artifact config over an obsolete default home and reports sanitized provenance', async () => {
    const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-cli-config-'));
    roots.push(root);
    const legacy = path.join(root, 'legacy'); const selected = path.join(root, 'artifact'); const workspace = path.join(root, 'workspace'); const bin = path.join(root, 'bin');
    await Promise.all([mkdir(legacy), mkdir(selected), mkdir(workspace), mkdir(bin)]);
    const legacyBytes = 'version = 1\nbackend = "acp"\n';
    await writeFile(path.join(legacy, 'config.toml'), legacyBytes, { mode: 0o600 });
    const vibe = path.join(bin, 'vibe'); await writeFile(vibe, '#!/bin/sh\nprintf "vibe 2.26.1\\n"\n'); await chmod(vibe, 0o700);
    const config = `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[paths]\nvibe = ${JSON.stringify(vibe)}\n`;
    const configFile = path.join(selected, 'config.toml'); await writeFile(configFile, config, { mode: 0o600 });
    const { stdout, stderr } = await exec(process.execPath, [cli, 'doctor', '--json', '--config', configFile], { env: { ...process.env, VIBE_SUPERVISOR_HOME: legacy, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` } });
    expect(stderr).toBe('');
    const report = JSON.parse(stdout) as { provenance: { application_entrypoint: string; runtime_module: string; config_path: string; config_source: string; config_fingerprint: string; data_directory: string }; checks: Array<{ name: string; ok: boolean }> };
    expect(report.provenance).toMatchObject({ config_path: configFile, config_source: 'explicit', data_directory: selected });
    expect(report.provenance.application_entrypoint).toBe(cli);
    expect(report.provenance.runtime_module).toBe(path.join(path.dirname(cli), 'diagnostics', 'doctor.js'));
    expect(report.provenance.config_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.checks.find(check => check.name === 'vibe')?.ok).toBe(true);
    expect(await readFile(path.join(legacy, 'config.toml'), 'utf8')).toBe(legacyBytes);
  });
});
