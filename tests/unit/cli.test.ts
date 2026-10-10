import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { runCli } from '../../src/cli.js';
import { applyCodexPlan, planCodexConfig } from '../../src/cli/codex.js';

const dirs: string[] = [];
const output: string[] = [];
async function configureCodex(isolated = false): Promise<void> {
  const plan = await planCodexConfig('user', process.cwd(), isolated);
  if (plan.changed) await applyCodexPlan(plan);
}
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
    await configureCodex();
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
    await configureCodex();
    expect(await readFile(file, 'utf8')).toBe(updated);
    expect((await readdir(codex)).filter((name) => name.startsWith('config.toml.bak-'))).toHaveLength(1);
  });

  it('registers isolated startup idempotently without changing other settings', async () => {
    const home = await tempDir(); const codex = path.join(home, '.codex'); await mkdir(codex);
    const file = path.join(codex, 'config.toml');
    await writeFile(file, 'title = "keep"\n');
    vi.stubEnv('HOME', home); captureOutput();
    await configureCodex(true);
    const source = await readFile(file, 'utf8');
    expect(parse(source)).toMatchObject({ title: 'keep', mcp_servers: { 'vibe-supervisor': { args: [expect.any(String), 'serve', '--stdio', '--isolated'], tool_timeout_sec: 600 } } });
    await configureCodex(true);
    expect(await readFile(file, 'utf8')).toBe(source);
    expect((await readdir(codex)).filter(name => name.startsWith('config.toml.bak-'))).toHaveLength(1);
  });
});

describe('CLI diagnostics for the programmatic runtime', () => {
  let errorSpy: ReturnType<typeof vi.spyOn> | undefined;
  const errors: string[] = [];

  afterEach(() => { errorSpy?.mockRestore(); errorSpy = undefined; errors.length = 0; });

  async function programmaticInstall(): Promise<void> {
    const data = await tempDir();
    const bin = path.join(data, 'bin'); await mkdir(bin);
    const script = (name: string) => path.join(bin, name);
    await writeFile(script('vibe'), '#!/usr/bin/env python3\nprint("vibe 2.26.1")\n');
    await chmod(script('vibe'), 0o755);
    await writeFile(path.join(data, 'config.toml'), `version = 1\nallowed_workspace_roots = []\n\n[paths]\nvibe = ${JSON.stringify(script('vibe'))}\n`);
    vi.stubEnv('VIBE_SUPERVISOR_HOME', data);
    captureOutput();
    errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { errors.push(String(chunk)); return true; }) as typeof process.stderr.write);
  }

  it('doctor --json verifies the pinned Vibe runtime without checking ACP', async () => {
    await programmaticInstall();
    await runCli(['doctor', '--json']);
    const report = JSON.parse(output.join('')) as { checks: Array<{ name: string; ok: boolean; version?: string }> };
    expect(report.checks.find((entry) => entry.name === 'vibe')).toMatchObject({ ok: true, version: 'vibe 2.26.1' });
    expect(report.checks.some((entry) => entry.name.includes('acp'))).toBe(false);
  }, 30_000);

  it('doctor reports unknown authentication separately from local runtime checks', async () => {
    await programmaticInstall();
    await runCli(['doctor']);
    expect(output.join('')).toMatch(/UNVERIFIED authentication: Vibe authentication was not inspected/);
    expect(output.join('')).not.toMatch(/ACP/i);
  }, 30_000);
});
