import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { runCli } from '../../src/cli.js';
import { runSetup } from '../../src/cli/setup.js';

const dirs: string[] = [];
const output: string[] = [];
const errors: string[] = [];
let outSpy: ReturnType<typeof vi.spyOn> | undefined;
let errSpy: ReturnType<typeof vi.spyOn> | undefined;

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-setup-')));
  dirs.push(dir); return dir;
}

function capture(): void {
  outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write);
  errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { errors.push(String(chunk)); return true; }) as typeof process.stderr.write);
}

afterEach(async () => {
  outSpy?.mockRestore(); errSpy?.mockRestore(); outSpy = undefined; errSpy = undefined;
  output.length = 0; errors.length = 0;
  vi.unstubAllEnvs(); process.exitCode = undefined;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Sandbox { data: string; home: string; bin: string; workspace: string; config: string; codex: string }

async function sandbox(options: { withVibe?: boolean } = {}): Promise<Sandbox> {
  const root = await tempDir();
  const data = path.join(root, 'data'); const home = path.join(root, 'home'); const bin = path.join(root, 'bin'); const workspace = path.join(root, 'work');
  await Promise.all([mkdir(home), mkdir(bin), mkdir(workspace)]);
  if (options.withVibe !== false) {
    for (const name of ['vibe', 'vibe-acp']) {
      await writeFile(path.join(bin, name), `#!/usr/bin/env python3\nprint("${name} 2.25.8")\n`);
      await chmod(path.join(bin, name), 0o755);
    }
  }
  vi.stubEnv('VIBE_SUPERVISOR_HOME', data); vi.stubEnv('HOME', home);
  vi.stubEnv('PATH', options.withVibe === false ? bin : `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
  return { data, home, bin, workspace, config: path.join(data, 'config.toml'), codex: path.join(home, '.codex', 'config.toml') };
}

async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch { return false; }
}

type ParsedConfig = { allowed_workspace_roots: string[]; paths?: { vibe?: string; vibe_acp?: string }; retention?: { days: number } };

describe('setup', () => {
  it('creates a private valid config with the canonical workspace and resolved paths and only previews Codex without --yes', async () => {
    const box = await sandbox(); capture();
    await runCli(['setup', '--workspace', box.workspace]);
    expect((await stat(box.config)).mode & 0o777).toBe(0o600);
    const parsed = parse(await readFile(box.config, 'utf8')) as ParsedConfig;
    expect(parsed.allowed_workspace_roots).toEqual([box.workspace]);
    expect(parsed.paths).toEqual({ vibe: path.join(box.bin, 'vibe'), vibe_acp: path.join(box.bin, 'vibe-acp') });
    expect(output.join('')).toContain('[mcp_servers.vibe-supervisor]');
    expect(await exists(box.codex)).toBe(false);
    expect(await exists(path.join(box.home, '.codex'))).toBe(false);
  }, 60_000);

  it('prints only non-PASS doctor lines', async () => {
    const box = await sandbox(); capture();
    await runCli(['setup', '--workspace', box.workspace]);
    expect(output.join('')).not.toMatch(/^PASS /m);
  }, 60_000);

  it('writes the Codex config with --yes and is idempotent on a second run', async () => {
    const box = await sandbox(); capture();
    await runCli(['setup', '--workspace', box.workspace, '--yes']);
    const codex = parse(await readFile(box.codex, 'utf8')) as { mcp_servers: Record<string, { args: string[] }> };
    expect(codex.mcp_servers['vibe-supervisor']?.args.slice(-2)).toEqual(['serve', '--stdio']);
    const configBefore = await readFile(box.config, 'utf8'); const codexBefore = await readFile(box.codex, 'utf8');
    const backupsBefore = (await readdir(path.dirname(box.codex))).length;
    await runCli(['setup', '--workspace', box.workspace, '--yes']);
    expect(await readFile(box.config, 'utf8')).toBe(configBefore);
    expect(await readFile(box.codex, 'utf8')).toBe(codexBefore);
    expect((await readdir(path.dirname(box.codex))).length).toBe(backupsBefore);
  }, 120_000);

  it('adds --isolated to the Codex launch arguments', async () => {
    const box = await sandbox(); capture();
    await runCli(['setup', '--workspace', box.workspace, '--yes', '--isolated']);
    const codex = parse(await readFile(box.codex, 'utf8')) as { mcp_servers: Record<string, { args: string[] }> };
    expect(codex.mcp_servers['vibe-supervisor']?.args.slice(-3)).toEqual(['serve', '--stdio', '--isolated']);
  }, 60_000);

  it('writes the project Codex config inside the workspace for --codex project', async () => {
    const box = await sandbox(); capture();
    await runCli(['setup', '--workspace', box.workspace, '--codex', 'project', '--yes']);
    expect(await exists(path.join(box.workspace, '.codex', 'config.toml'))).toBe(true);
    expect(await exists(box.codex)).toBe(false);
  }, 60_000);

  it('writes after an interactive confirmation and not after a refusal', async () => {
    const box = await sandbox(); capture();
    const base = { workspace: box.workspace, codex: 'user' as const, isolated: false, yes: false, interactive: true };
    await runSetup({ ...base, confirm: async () => false });
    expect(await exists(box.codex)).toBe(false);
    await runSetup({ ...base, confirm: async () => true });
    expect(await exists(box.codex)).toBe(true);
  }, 120_000);

  it('never asks and never writes without a TTY and without --yes', async () => {
    const box = await sandbox(); capture();
    const confirm = vi.fn(async () => true);
    await runSetup({ workspace: box.workspace, codex: 'user', isolated: false, yes: false, interactive: false, confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(await exists(box.codex)).toBe(false);
  }, 60_000);

  it('preserves existing config entries and does not overwrite configured paths', async () => {
    const box = await sandbox(); capture();
    const other = path.join(box.data, 'other-root'); await mkdir(other, { recursive: true });
    await writeFile(box.config, `version = 1\nallowed_workspace_roots = [${JSON.stringify(other)}]\n\n[retention]\ndays = 3\n\n[paths]\nvibe = "/custom/vibe"\n`, { mode: 0o600 });
    await runCli(['setup', '--workspace', box.workspace]);
    const parsed = parse(await readFile(box.config, 'utf8')) as ParsedConfig;
    expect(parsed.allowed_workspace_roots).toEqual([other, box.workspace]);
    expect(parsed.retention?.days).toBe(3);
    expect(parsed.paths?.vibe).toBe('/custom/vibe');
    expect(parsed.paths?.vibe_acp).toBe(path.join(box.bin, 'vibe-acp'));
    expect((await stat(box.config)).mode & 0o777).toBe(0o600);
  }, 60_000);

  it('leaves paths absent and says so when vibe is not on PATH', async () => {
    const box = await sandbox({ withVibe: false }); capture();
    await runCli(['setup', '--workspace', box.workspace]);
    const parsed = parse(await readFile(box.config, 'utf8')) as ParsedConfig;
    expect(parsed.allowed_workspace_roots).toEqual([box.workspace]);
    expect(parsed.paths?.vibe).toBeUndefined();
    expect(parsed.paths?.vibe_acp).toBeUndefined();
    expect(output.join('')).toMatch(/vibe-acp.*not found on PATH/);
    expect(output.join('')).toMatch(/vibe .*not found on PATH|vibe: not found on PATH/);
  }, 60_000);

  it('refuses a symlinked workspace without creating any file', async () => {
    const box = await sandbox(); capture();
    const link = path.join(path.dirname(box.workspace), 'link'); await symlink(box.workspace, link);
    await runCli(['setup', '--workspace', link]);
    expect(process.exitCode).toBe(2);
    expect(await exists(box.config)).toBe(false);
    expect(errors.join('')).toContain('VSUP_INVALID_ARGUMENT');
  });

  it('refuses a nonexistent workspace and a file', async () => {
    const box = await sandbox(); capture();
    await runCli(['setup', '--workspace', path.join(box.workspace, 'missing')]);
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;
    await writeFile(path.join(box.workspace, 'file'), 'x');
    await runCli(['setup', '--workspace', path.join(box.workspace, 'file')]);
    expect(process.exitCode).toBe(2);
    expect(await exists(box.config)).toBe(false);
  });

  it('requires --workspace and rejects unknown options and codex scopes', async () => {
    await sandbox(); capture();
    await runCli(['setup']); expect(process.exitCode).toBe(2); process.exitCode = undefined;
    await runCli(['setup', '--workspace', '/tmp', '--bogus']); expect(process.exitCode).toBe(2); process.exitCode = undefined;
    await runCli(['setup', '--workspace', '/tmp', '--codex', 'global']); expect(process.exitCode).toBe(2);
  });
});

describe('allow', () => {
  it('adds one canonical root idempotently', async () => {
    const box = await sandbox(); capture();
    const sub = path.join(box.workspace, 'sub'); await mkdir(sub);
    const roundabout = path.join(sub, '..', 'sub');
    await runCli(['allow', roundabout]);
    await runCli(['allow', sub]);
    const parsed = parse(await readFile(box.config, 'utf8')) as ParsedConfig;
    expect(parsed.allowed_workspace_roots).toEqual([sub]);
    expect((await stat(box.config)).mode & 0o777).toBe(0o600);
  });

  it('keeps existing entries untouched when adding another root', async () => {
    const box = await sandbox(); capture();
    await runCli(['allow', box.workspace]);
    const second = path.join(box.bin, '..', 'extra'); await mkdir(second);
    await runCli(['allow', second]);
    const parsed = parse(await readFile(box.config, 'utf8')) as ParsedConfig;
    expect(parsed.allowed_workspace_roots).toEqual([box.workspace, path.join(path.dirname(box.bin), 'extra')]);
  });

  it('refuses a symlink, a missing directory and a wrong argument count', async () => {
    const box = await sandbox(); capture();
    const link = path.join(path.dirname(box.workspace), 'link'); await symlink(box.workspace, link);
    for (const args of [[link], [path.join(box.workspace, 'missing')], [], [box.workspace, box.bin]]) {
      process.exitCode = undefined;
      await runCli(['allow', ...args]);
      expect(process.exitCode).toBe(2);
    }
    expect(await exists(box.config)).toBe(false);
  });
});

describe('allow and setup reload note', () => {
  it('tells the user to restart the MCP server after a change and stays quiet when nothing changed', async () => {
    const box = await sandbox(); capture();
    await runCli(['allow', box.workspace]);
    expect(output.join('')).toMatch(/restart the Codex MCP server/i);
    expect(output.join('')).toMatch(/--isolated/);
    output.length = 0;
    await runCli(['allow', box.workspace]);
    expect(output.join('')).not.toMatch(/restart/i);
  });

  it('prints the same note from setup when the allowlist changed', async () => {
    const box = await sandbox(); capture();
    await runCli(['setup', '--workspace', box.workspace]);
    expect(output.join('')).toMatch(/restart the Codex MCP server/i);
  }, 60_000);
});

describe('config rewrite backup', () => {
  const ORIGINAL = '# my comment\nversion = 1\nallowed_workspace_roots = []   # none yet\n';

  it('keeps an owner-only backup with the original bytes before allow rewrites the file', async () => {
    const box = await sandbox(); capture();
    await mkdir(box.data, { recursive: true });
    await writeFile(box.config, ORIGINAL, { mode: 0o600 });
    await runCli(['allow', box.workspace]);
    const backups = (await readdir(box.data)).filter((name) => name.startsWith('config.toml.bak-'));
    expect(backups).toHaveLength(1);
    const backup = path.join(box.data, backups[0] as string);
    expect(await readFile(backup, 'utf8')).toBe(ORIGINAL);
    expect((await stat(backup)).mode & 0o777).toBe(0o600);
    expect(output.join('')).toContain(backup);
    expect(await readFile(box.config, 'utf8')).not.toContain('# my comment');
  });

  it('makes no backup when the file is created or left unchanged', async () => {
    const box = await sandbox(); capture();
    await runCli(['allow', box.workspace]);
    await runCli(['allow', box.workspace]);
    expect((await readdir(box.data)).filter((name) => name.includes('.bak-'))).toEqual([]);
  });
});

describe('allow comparisons and broad roots', () => {
  it('treats a ~-prefixed root as the same directory and does not rewrite the file', async () => {
    const box = await sandbox(); capture();
    const project = path.join(box.home, 'proj'); await mkdir(project);
    await mkdir(box.data, { recursive: true });
    const original = 'version = 1\nallowed_workspace_roots = ["~/proj"]\n';
    await writeFile(box.config, original, { mode: 0o600 });
    await runCli(['allow', project]);
    expect(await readFile(box.config, 'utf8')).toBe(original);
    expect((await readdir(box.data)).filter((name) => name.includes('.bak-'))).toEqual([]);
    expect(output.join('')).toContain('already allowed');
  });

  it.each(['/', 'home'])('refuses %s as a root with exit 2 and writes nothing', async (target) => {
    const box = await sandbox(); capture();
    const dir = target === 'home' ? box.home : target;
    await runCli(['allow', dir]);
    expect(process.exitCode).toBe(2);
    expect(errors.join('')).toMatch(/too broad/i);
    expect(await exists(box.config)).toBe(false);
    process.exitCode = undefined;
    await runCli(['setup', '--workspace', dir]);
    expect(process.exitCode).toBe(2);
    expect(await exists(box.config)).toBe(false);
  });

  it('refuses the home directory reached through a dot segment', async () => {
    const box = await sandbox(); capture();
    await runCli(['allow', path.join(box.home, 'sub', '..')]).catch(() => undefined);
    expect(process.exitCode).toBe(2);
    expect(await exists(box.config)).toBe(false);
  });

  it('accepts a directory below home', async () => {
    const box = await sandbox(); capture();
    const project = path.join(box.home, 'proj'); await mkdir(project);
    await runCli(['allow', project]);
    expect(process.exitCode).toBeUndefined();
    expect((parse(await readFile(box.config, 'utf8')) as ParsedConfig).allowed_workspace_roots).toEqual([project]);
  });
});

describe('setup plans before writing', () => {
  it('leaves the supervisor config untouched when the Codex config is malformed', async () => {
    const box = await sandbox(); capture();
    await mkdir(path.dirname(box.codex), { recursive: true });
    await writeFile(box.codex, '[mcp_servers\nbroken = \n');
    await runCli(['setup', '--workspace', box.workspace, '--yes']);
    expect(process.exitCode).toBe(2);
    expect(await exists(box.config)).toBe(false);
    expect(await readFile(box.codex, 'utf8')).toBe('[mcp_servers\nbroken = \n');
    expect(errors.join('')).toMatch(/Codex config/);
  }, 60_000);

  it('leaves an existing supervisor config byte-identical when the Codex config is malformed', async () => {
    const box = await sandbox(); capture();
    await mkdir(box.data, { recursive: true });
    const original = 'version = 1\nallowed_workspace_roots = []\n';
    await writeFile(box.config, original, { mode: 0o600 });
    await mkdir(path.dirname(box.codex), { recursive: true });
    await writeFile(box.codex, 'not = [valid');
    await runCli(['setup', '--workspace', box.workspace, '--yes']);
    expect(process.exitCode).toBe(2);
    expect(await readFile(box.config, 'utf8')).toBe(original);
    expect((await readdir(box.data)).filter((name) => name.includes('.bak-'))).toEqual([]);
  }, 60_000);
});

describe('doctor --config and command aliases', () => {
  it('doctor --config reports ignored keys as warnings', async () => {
    const box = await sandbox(); capture();
    const file = path.join(box.data, 'custom.toml'); await mkdir(box.data, { recursive: true });
    await writeFile(file, `version = 1\nallowed_workspace_roots = [${JSON.stringify(box.workspace)}]\n\n[security]\nallow_network_tools = true\n`);
    await runCli(['doctor', '--config', file]);
    expect(output.join('')).toMatch(/WARN .*allow_network_tools/);
  }, 60_000);

  it('doctor --config fails with exit code 1 on an invalid config', async () => {
    const box = await sandbox(); capture();
    await mkdir(box.data, { recursive: true });
    const file = path.join(box.data, 'bad.toml'); await writeFile(file, 'version = 2\n');
    await runCli(['doctor', '--config', file]);
    expect(process.exitCode).toBe(1);
    expect(errors.join('')).toContain('VSUP_CONFIG_INVALID');
    expect(errors.join('')).toContain('Invalid supervisor configuration');
  });

  it('doctor --config requires a value', async () => {
    await sandbox(); capture();
    await runCli(['doctor', '--config']);
    expect(process.exitCode).toBe(2);
  });

  it('config validate prints a pointer to doctor on stderr and still validates', async () => {
    const box = await sandbox(); capture();
    await mkdir(box.data, { recursive: true });
    const good = path.join(box.data, 'good.toml'); await writeFile(good, 'version = 1\n');
    await runCli(['config', 'validate', good]);
    expect(errors.join('')).toMatch(/doctor --config/);
    expect(output.join('')).toContain('"valid": true');
    expect(process.exitCode).toBeUndefined();
    errors.length = 0;
    const bad = path.join(box.data, 'bad.toml'); await writeFile(bad, 'version = 2\n');
    await runCli(['config', 'validate', bad]);
    expect(errors.join('')).toMatch(/doctor --config/);
    expect(process.exitCode).toBe(1);
  });

  it('test-acp prints a pointer to doctor on stderr and keeps its exit code', async () => {
    const box = await sandbox(); capture();
    await mkdir(box.data, { recursive: true });
    await writeFile(box.config, `version = 1\n\n[paths]\nvibe_acp = ${JSON.stringify(path.join(box.bin, 'vibe-acp'))}\n`);
    await runCli(['test-acp']);
    expect(errors.join('')).toMatch(/doctor/);
    expect(process.exitCode).toBe(1);
  }, 30_000);
});

describe('init template', () => {
  it('writes only version, backend, allowed roots and an empty paths table without comments', async () => {
    const box = await sandbox(); capture();
    await runCli(['init']);
    const source = await readFile(box.config, 'utf8');
    expect(source).not.toContain('#');
    const parsed = parse(source);
    expect(Object.keys(parsed).sort()).toEqual(['allowed_workspace_roots', 'backend', 'paths', 'version']);
    expect(parsed.allowed_workspace_roots).toEqual([]);
    expect(parsed.paths).toEqual({});
  });
});

describe('configure-codex arguments', () => {
  it('rejects the removed --scope and --path= forms', async () => {
    await sandbox(); capture();
    for (const args of [['--scope', 'user'], ['--scope=user'], ['--project', '--path=/tmp']]) {
      process.exitCode = undefined;
      await runCli(['configure-codex', ...args, '--dry-run']);
      expect(process.exitCode).toBe(2);
    }
    expect(output.join('')).not.toContain('mcp_servers');
  });

  it('keeps --project --path <dir> for an explicit project directory', async () => {
    const box = await sandbox(); capture();
    await runCli(['configure-codex', '--project', '--path', box.workspace, '--dry-run']);
    expect(process.exitCode).toBeUndefined();
    expect(output.join('')).toContain(path.join(box.workspace, '.codex', 'config.toml'));
  });
});
