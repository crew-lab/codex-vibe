import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile, rm, realpath } from 'node:fs/promises';
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
