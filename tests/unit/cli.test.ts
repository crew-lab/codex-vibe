import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { runCli } from '../../src/cli.js';

const dirs: string[] = [];
const output: string[] = [];
let writeSpy: ReturnType<typeof vi.spyOn> | undefined;
async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-cli-')));
  dirs.push(dir); return dir;
}

afterEach(async () => {
  writeSpy?.mockRestore(); writeSpy = undefined; output.length = 0;
  vi.unstubAllEnvs(); process.exitCode = undefined;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function captureOutput(): void {
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write);
}

describe('CLI local setup', () => {
  it('updates the target quoted Codex table idempotently, preserves other content, and backs up mode 0600', async () => {
    const home = await tempDir(); const codex = path.join(home, '.codex'); await mkdir(codex);
    const file = path.join(codex, 'config.toml');
    const original = 'title = "keep exactly"\n\n[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers."vibe-supervisor"]\ncommand = "old"\nargs = ["old"]\n\n[projects]\n"repo" = "keep"\n';
    await writeFile(file, original);
    vi.stubEnv('HOME', home); captureOutput();
    await runCli(['configure-codex', '--scope', 'user']);
    const updated = await readFile(file, 'utf8');
    const parsed = parse(updated) as { title: string; mcp_servers: Record<string, { command: string; args: string[] }>; projects: Record<string, string> };
    expect(parsed.title).toBe('keep exactly');
    expect(parsed.mcp_servers.other.command).toBe('other');
    expect(parsed.mcp_servers['vibe-supervisor'].args.slice(-2)).toEqual(['serve', '--stdio']);
    expect(parsed.projects.repo).toBe('keep');
    expect(updated).toContain('title = "keep exactly"');
    const names = await readdir(codex); const backups = names.filter((name) => name.startsWith('config.toml.bak-'));
    expect(backups).toHaveLength(1);
    expect((await stat(path.join(codex, backups[0]!))).mode & 0o777).toBe(0o600);
    await runCli(['configure-codex', '--scope=user']);
    expect(await readFile(file, 'utf8')).toBe(updated);
    expect((await readdir(codex)).filter((name) => name.startsWith('config.toml.bak-'))).toHaveLength(1);
  });

  it('registers isolated startup idempotently without changing other settings', async () => {
    const home = await tempDir(); const codex = path.join(home, '.codex'); await mkdir(codex);
    const file = path.join(codex, 'config.toml');
    await writeFile(file, 'title = "keep"\n');
    vi.stubEnv('HOME', home); captureOutput();
    await runCli(['configure-codex', '--user', '--isolated']);
    const source = await readFile(file, 'utf8');
    expect(parse(source)).toMatchObject({ title: 'keep', mcp_servers: { 'vibe-supervisor': { args: [expect.any(String), 'serve', '--stdio', '--isolated'], tool_timeout_sec: 600 } } });
    await runCli(['configure-codex', '--user', '--isolated']);
    expect(await readFile(file, 'utf8')).toBe(source);
    expect((await readdir(codex)).filter(name => name.startsWith('config.toml.bak-'))).toHaveLength(1);
  });

  it('dry-run reveals only the new registration block, not unrelated config values', async () => {
    const home = await tempDir(); const codex = path.join(home, '.codex'); await mkdir(codex);
    await writeFile(path.join(codex, 'config.toml'), 'api_key = "UNRELATED_SECRET_SENTINEL"\n');
    vi.stubEnv('HOME', home); captureOutput();
    await runCli(['configure-codex', '--user', '--dry-run']);
    expect(output.join('')).not.toContain('UNRELATED_SECRET_SENTINEL');
    expect(output.join('')).toContain('mcp_servers.vibe-supervisor');
    expect(await readFile(path.join(codex, 'config.toml'), 'utf8')).toContain('UNRELATED_SECRET_SENTINEL');
  });

  it('init creates a private default config without overwriting an existing one', async () => {
    const data = await tempDir(); vi.stubEnv('VIBE_SUPERVISOR_HOME', data); captureOutput();
    await runCli(['init']);
    const config = path.join(data, 'config.toml');
    expect((await stat(data)).mode & 0o777).toBe(0o700);
    expect((await stat(config)).mode & 0o777).toBe(0o600);
    expect(parse(await readFile(config, 'utf8'))).toMatchObject({ version: 1, backend: 'programmatic' });
  });
});

describe('CLI diagnostics for a failing ACP probe', () => {
  let errorSpy: ReturnType<typeof vi.spyOn> | undefined;
  const errors: string[] = [];

  afterEach(() => { errorSpy?.mockRestore(); errorSpy = undefined; errors.length = 0; });

  async function failingInstall(): Promise<void> {
    const data = await tempDir();
    const bin = path.join(data, 'bin'); await mkdir(bin);
    const script = (name: string) => path.join(bin, name);
    for (const name of ['vibe', 'vibe-acp']) {
      await writeFile(script(name), `#!/usr/bin/env python3\nprint("${name} 2.25.8")\n`);
      await chmod(script(name), 0o755);
    }
    await writeFile(path.join(data, 'config.toml'), `version = 1\nallowed_workspace_roots = []\n\n[paths]\nvibe = ${JSON.stringify(script('vibe'))}\nvibe_acp = ${JSON.stringify(script('vibe-acp'))}\n`);
    vi.stubEnv('VIBE_SUPERVISOR_HOME', data);
    captureOutput();
    errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { errors.push(String(chunk)); return true; }) as typeof process.stderr.write);
  }

  it('doctor --json carries the captured stderr tail on the failed acp-initialize check', async () => {
    await failingInstall();
    await runCli(['doctor', '--json']);
    const report = JSON.parse(output.join('')) as { checks: Array<{ name: string; ok: boolean; stderr_tail?: string }> };
    const check = report.checks.find((entry) => entry.name === 'acp-initialize');
    expect(check?.ok).toBe(false);
    expect(typeof check?.stderr_tail).toBe('string');
    expect(check?.stderr_tail?.length).toBeGreaterThan(0);
    expect(check?.stderr_tail?.length).toBeLessThanOrEqual(1024);
  }, 30_000);

  it('doctor prints the stderr tail under the failed check', async () => {
    await failingInstall();
    await runCli(['doctor']);
    expect(output.join('')).toMatch(/CHECK acp-initialize: .*\n {2}Vibe ACP stderr: .+/);
  }, 30_000);

  it('test-acp prints the stderr tail and exits non-zero when the probe fails', async () => {
    await failingInstall();
    await runCli(['test-acp']);
    const report = JSON.parse(output.join('')) as { available: boolean; details?: { stderr_tail?: string } };
    expect(report.available).toBe(false);
    expect(report.details?.stderr_tail?.length).toBeGreaterThan(0);
    expect(errors.join('')).toContain('vibe-acp stderr:');
    expect(errors.join('')).toContain(report.details?.stderr_tail?.split('\n')[0] ?? 'missing');
    expect(process.exitCode).toBe(1);
  }, 30_000);
});
