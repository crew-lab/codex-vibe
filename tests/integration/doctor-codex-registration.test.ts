import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { resolveConfigSelection } from '../../src/config/config.js';
import os from 'node:os';
import path from 'node:path';
import { TEST_CONFIG } from '../unit/support/test-config.js';
import { applyCodexPlan, codexConfigFile, MIN_CODEX_TOOL_TIMEOUT_SECONDS, planCodexConfig } from '../../src/cli/codex.js';
import { formatDoctorCheck, runDoctor, type DoctorCheck } from '../../src/diagnostics/doctor.js';
import type { SupervisorBackend } from '../../src/contracts.js';

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-doctor-codex-')));
  dirs.push(dir);
  return dir;
}

const backend = {
  kind: 'app-server',
  probe: async () => ({ available: true, backend: 'app-server', executable: '/x/vibe-app-server', version: '3.1.2' })
} as unknown as SupervisorBackend;

interface Fixture { home: string; project: string; configPath: string; codexFile: string }

async function fixture(): Promise<Fixture> {
  const home = await tempDir();
  vi.stubEnv('HOME', home);
  vi.stubEnv('VIBE_SUPERVISOR_HOME', path.join(home, 'data'));
  const project = path.join(home, 'project');
  const configPath = path.join(home, 'supervisor', 'config.toml');
  return { home, project, configPath, codexFile: codexConfigFile('user', project).file };
}

async function register(at: Fixture, configPath: string | null = at.configPath): Promise<void> {
  const plan = await planCodexConfig('user', at.project, true, configPath ?? undefined);
  if (plan.changed) await applyCodexPlan(plan);
}

async function rewrite(at: Fixture, change: (text: string) => string): Promise<void> {
  await writeFile(at.codexFile, change(await readFile(at.codexFile, 'utf8')));
}

async function codexChecksFor(at: Fixture, configPath: string, configSource: 'explicit' | 'environment' | 'default'): Promise<Record<string, DoctorCheck>> {
  const report = await runDoctor({ ...TEST_CONFIG, allowedWorkspaceRoots: [at.home] }, { configPath, configSource, dataDir: path.join(at.home, 'data') }, { backend, codex: { projectPath: at.project } });
  return Object.fromEntries(report.checks.filter((check) => check.name.startsWith('codex-')).map((check) => [check.name, check]));
}

async function codexChecks(at: Fixture): Promise<Record<string, DoctorCheck>> {
  return await codexChecksFor(at, at.configPath, 'explicit');
}

function defaultConfigPath(): string {
  return resolveConfigSelection(undefined, { ...process.env, VIBE_SUPERVISOR_HOME: '' }).configPath;
}

describe('doctor Codex registration', () => {
  it('passes a registration written by setup for this installation and configuration', async () => {
    const at = await fixture();
    await register(at);
    const checks = await codexChecks(at);
    for (const name of ['codex-registration', 'codex-command', 'codex-cli', 'codex-config', 'codex-tool-timeout']) expect(checks[name], name).toMatchObject({ ok: true });
    expect(checks['codex-registration']!.message).toContain(at.codexFile);
  });

  it('warns, without failing, when no registration runs this supervisor, and names the setup command', async () => {
    const at = await fixture();
    const checks = await codexChecks(at);
    expect(Object.keys(checks)).toEqual(['codex-registration']);
    expect(checks['codex-registration']).toMatchObject({ ok: true, status: 'warning', message: expect.stringContaining(`setup --workspace ${at.home} --config ${at.configPath}`) });
    expect(formatDoctorCheck(checks['codex-registration']!)).toMatch(/^WARN codex-registration:/);
  });

  it('fails the command item when the registered Node binary is gone', async () => {
    const at = await fixture();
    await register(at);
    const missing = path.join(at.home, 'removed-node', 'bin', 'node');
    await rewrite(at, (text) => text.replace(/^command = .*$/m, `command = ${JSON.stringify(missing)}`));
    const checks = await codexChecks(at);
    expect(checks['codex-command']).toMatchObject({ ok: false, message: expect.stringContaining(missing) });
    expect(checks['codex-command']!.message).toMatch(/does not exist.*run: .* setup --workspace/);
    expect(checks['codex-cli']).toMatchObject({ ok: true });
  });

  it('fails the CLI item when the registered CLI path is gone', async () => {
    const at = await fixture();
    await register(at);
    const moved = path.join(at.home, 'old-install', 'dist', 'cli.js');
    await rewrite(at, (text) => text.replace(/^args = \["[^"]*"/m, `args = [${JSON.stringify(moved)}`));
    const checks = await codexChecks(at);
    expect(checks['codex-cli']).toMatchObject({ ok: false, message: expect.stringContaining(moved) });
  });

  it('fails the config item when the registration passes another --config', async () => {
    const at = await fixture();
    const other = path.join(at.home, 'other', 'config.toml');
    await register(at, other);
    const checks = await codexChecks(at);
    expect(checks['codex-registration']).toMatchObject({ ok: true });
    expect(checks['codex-config']).toMatchObject({ ok: false, message: expect.stringContaining(`--config ${other}, not ${at.configPath}`) });
    expect(checks['codex-config']!.message).toContain(`setup --workspace ${at.home} --config ${at.configPath}`);
  });

  it('fails the timeout item when tool_timeout_sec is below the longest wait plus margin', async () => {
    const at = await fixture();
    await register(at);
    await rewrite(at, (text) => text.replace('tool_timeout_sec = 600', 'tool_timeout_sec = 300'));
    const checks = await codexChecks(at);
    expect(checks['codex-tool-timeout']).toMatchObject({ ok: false, message: expect.stringContaining(`at least ${MIN_CODEX_TOOL_TIMEOUT_SECONDS} seconds`) });
  });

  it('fails the timeout item when tool_timeout_sec is absent', async () => {
    const at = await fixture();
    await register(at);
    await rewrite(at, (text) => text.replace('tool_timeout_sec = 600\n', ''));
    const checks = await codexChecks(at);
    expect(checks['codex-tool-timeout']).toMatchObject({ ok: false, message: expect.stringContaining('sets no tool_timeout_sec') });
  });

  it('finds a project-scope registration and names --codex project in its remedy', async () => {
    const at = await fixture();
    await mkdir(at.project);
    const plan = await planCodexConfig('project', at.project, true, at.configPath);
    await applyCodexPlan(plan);
    await writeFile(plan.file, (await readFile(plan.file, 'utf8')).replace('tool_timeout_sec = 600', 'tool_timeout_sec = 60'));
    const checks = await codexChecks(at);
    expect(checks['codex-registration']!.message).toContain(plan.file);
    expect(checks['codex-tool-timeout']).toMatchObject({ ok: false, message: expect.stringContaining(`setup --workspace ${at.project} --config ${at.configPath} --codex project`) });
  });

  it('does not take another MCP server with a serve subcommand for this supervisor', async () => {
    const at = await fixture();
    await mkdir(path.dirname(at.codexFile), { recursive: true });
    await writeFile(at.codexFile, '[mcp_servers.other]\ncommand = "/usr/bin/env"\nargs = ["other-tool", "serve"]\n');
    const report = await runDoctor({ ...TEST_CONFIG, allowedWorkspaceRoots: [at.home] }, { configSource: 'default', dataDir: path.join(at.home, 'data') }, { backend, codex: { projectPath: at.project } });
    const checks = report.checks.filter((check) => check.name.startsWith('codex-'));
    expect(checks.map((check) => check.name)).toEqual(['codex-registration']);
    expect(checks[0]).toMatchObject({ status: 'warning' });
  });

  it('reads a symlinked Codex config, as Codex does, while setup still refuses to write through it', async () => {
    const at = await fixture();
    await register(at);
    const dotfile = path.join(at.home, 'dotfiles', 'codex.toml');
    await mkdir(path.dirname(dotfile));
    await rename(at.codexFile, dotfile);
    await symlink(dotfile, at.codexFile);
    const checks = await codexChecks(at);
    for (const name of ['codex-registration', 'codex-command', 'codex-cli', 'codex-config', 'codex-tool-timeout']) expect(checks[name], name).toMatchObject({ ok: true });
    await expect(planCodexConfig('user', at.project, false, at.configPath)).rejects.toThrow(/Refusing unsafe Codex config path/);
  });

  it('resolves a registration without --config through the VIBE_SUPERVISOR_HOME in its env table', async () => {
    const at = await fixture();
    await register(at, null);
    const homeX = path.join(at.home, 'x');
    await rewrite(at, (text) => `${text.trimEnd()}\nenv = { VIBE_SUPERVISOR_HOME = ${JSON.stringify(homeX)} }\n`);
    const matching = await codexChecksFor(at, path.join(homeX, 'config.toml'), 'environment');
    expect(matching['codex-config']).toMatchObject({ ok: true, message: expect.stringContaining(`VIBE_SUPERVISOR_HOME = ${homeX}`) });
    const other = await codexChecksFor(at, defaultConfigPath(), 'default');
    expect(other['codex-config']).toMatchObject({ ok: false, message: expect.stringContaining(`not ${defaultConfigPath()}`) });
  });

  it('matches a registration without --config to doctor --config naming the default file', async () => {
    const at = await fixture();
    await register(at, null);
    const checks = await codexChecksFor(at, defaultConfigPath(), 'explicit');
    expect(checks['codex-config']).toMatchObject({ ok: true, message: expect.stringContaining('default configuration') });
  });

  it('warns that setup rewrites the entry when it holds keys added by hand', async () => {
    const at = await fixture();
    await register(at);
    await rewrite(at, (text) => `${text.replace('tool_timeout_sec = 600', 'tool_timeout_sec = 120').trimEnd()}\nenv = { EXTRA = "1" }\n`);
    const checks = await codexChecks(at);
    expect(checks['codex-tool-timeout']).toMatchObject({ ok: false, message: expect.stringContaining('setup rewrites this entry: check that env is still set') });
  });

  it('reports a bare command as unverifiable instead of missing', async () => {
    const at = await fixture();
    await register(at);
    await rewrite(at, (text) => text.replace(/^command = .*$/m, 'command = "node"'));
    const checks = await codexChecks(at);
    expect(checks['codex-command']).toMatchObject({ ok: false, message: expect.stringContaining('not an absolute path') });
  });

  it('keeps the report ok when only the Codex registration is wrong, and reads it without writing', async () => {
    const at = await fixture();
    await register(at);
    await rewrite(at, (text) => text.replace('tool_timeout_sec = 600\n', ''));
    const before = await readFile(at.codexFile, 'utf8');
    const report = await runDoctor({ ...TEST_CONFIG, allowedWorkspaceRoots: [at.home] }, { configPath: at.configPath, configSource: 'explicit', dataDir: path.join(at.home, 'data') }, { backend, codex: { projectPath: at.project } });
    expect(report.checks.find((check) => check.name === 'codex-tool-timeout')).toMatchObject({ ok: false });
    expect(report.ok).toBe(true);
    expect(await readFile(at.codexFile, 'utf8')).toBe(before);
  });
});
