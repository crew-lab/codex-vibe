import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePinManifest } from '../../src/backends/app-server/pin.js';
import { makeFakeVibeEnvironment } from '../unit/support/fake-vibe-environment.js';

const exec = promisify(execFile);
const cli = path.join(process.env.VIBE_SUPERVISOR_TEST_DIST ?? path.resolve(import.meta.dirname, '../../dist'), 'cli.js');
const canonicalTmp = await realpath(tmpdir());
const scratch: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const exists = (file: string) => stat(file).then(() => true, () => false);

async function sandbox(config?: (workspace: string) => string) {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-no-manifest-'));
  scratch.push(parent);
  const workspace = path.join(parent, 'workspace');
  const data = path.join(parent, 'data');
  await mkdir(workspace);
  await mkdir(data, { mode: 0o700 });
  const configFile = path.join(data, 'config.toml');
  await writeFile(configFile, (config ?? ((root) => `version = 1\nallowed_workspace_roots = [${JSON.stringify(root)}]\n`))(workspace), { mode: 0o600 });
  const fake = await makeFakeVibeEnvironment(parent);
  return { parent, workspace, data, configFile, fake, env: { ...process.env, VIBE_SUPERVISOR_HOME: data } };
}

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [cli, ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('a configuration without paths.vibe_pin_manifest does not block its own repair', () => {
  it('pin-manifest writes the manifest to --output', async () => {
    const box = await sandbox();
    const output = path.join(box.data, 'vibe-pin-manifest.json');
    const result = await run(['pin-manifest', '--config', box.configFile, '--executable', box.fake.shim, '--output', output], box.env);

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(parsePinManifest(await readFile(output, 'utf8')).version).toBe('2.26.1');
  });

  it('pin-manifest asks for --output when neither the configuration nor the command line names one', async () => {
    const box = await sandbox();
    const result = await run(['pin-manifest', '--config', box.configFile, '--executable', box.fake.shim], box.env);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--output');
  });

  it('pin-manifest works from --executable and --output alone when the configuration cannot be read', async () => {
    const box = await sandbox(() => 'this is = not [valid toml\n');
    const output = path.join(box.data, 'vibe-pin-manifest.json');
    const result = await run(['pin-manifest', '--config', box.configFile, '--executable', box.fake.shim, '--output', output], box.env);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('using --executable and --output alone');
    expect(await exists(output)).toBe(true);
  });

  it('pin-manifest does not guess the executable when the configuration cannot be read', async () => {
    const box = await sandbox(() => 'this is = not [valid toml\n');
    const output = path.join(box.data, 'vibe-pin-manifest.json');
    const result = await run(['pin-manifest', '--config', box.configFile, '--output', output], box.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--executable');
    expect(await exists(output)).toBe(false);
  });

  it('allow adds the workspace and states what is missing and how to fix it', async () => {
    const box = await sandbox((root) => `version = 1\nallowed_workspace_roots = [${JSON.stringify(root)}]\n`);
    const other = path.join(box.parent, 'other');
    await mkdir(other);
    const result = await run(['allow', '--config', box.configFile, other], box.env);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Allowed workspace: ${other}`);
    expect(result.stdout).toContain('paths.vibe_pin_manifest is not set');
    expect(result.stdout).toContain('vibe-supervisor pin-manifest');
    expect(await readFile(box.configFile, 'utf8')).toContain(other);
  });

  it('doctor reports the missing manifest as a failed vibe check with the remedy instead of refusing to run', async () => {
    const box = await sandbox();
    const result = await run(['doctor', '--json', '--config', box.configFile], { ...box.env, PATH: `${path.dirname(box.fake.vibeShim)}:${process.env.PATH ?? ''}` });

    const report = JSON.parse(result.stdout) as { ok: boolean; checks: Array<{ name: string; ok: boolean; message: string }> };
    expect(result.code).toBe(1);
    expect(report.ok).toBe(false);
    const vibe = report.checks.find((check) => check.name === 'vibe');
    expect(vibe?.ok).toBe(false);
    expect(vibe?.message).toContain('vibe_pin_manifest');
    expect(vibe?.message).toContain('vibe-supervisor pin-manifest');
  });

  it('serve boots, and every run fails closed with VSUP_CONFIG_INVALID naming the missing path and the repair', async () => {
    const box = await sandbox();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'serve', '--stdio', '--config', box.configFile],
      stderr: 'pipe',
      env: box.env as Record<string, string>
    });
    const client = new Client({ name: 'no-manifest-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(transport);

    const started = await client.callTool({ name: 'vibe_review_start', arguments: { task: 'review', cwd: box.workspace, wait_seconds: 0 } }, { timeout: 20_000 });
    const text = (started.content as Array<{ type: string; text?: string }>).find((part) => part.type === 'text')?.text ?? '';
    expect(started.isError).toBe(true);
    expect(text).toContain('VSUP_CONFIG_INVALID');
    expect(text).toContain('vibe_pin_manifest');
    expect(text).toContain('pin-manifest');

    const readiness = await client.callTool({ name: 'vibe_status', arguments: { workspace: box.workspace, operation: 'review', wait_seconds: 0 } }, { timeout: 20_000 });
    const readinessText = JSON.stringify(readiness.structuredContent ?? readiness.content);
    expect(readinessText).toContain('eligible');
    expect(readinessText).toContain('VSUP_CONFIG_INVALID');
    expect(readinessText).not.toContain('"eligible":true');
  });
});
