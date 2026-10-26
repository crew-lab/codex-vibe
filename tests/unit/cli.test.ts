import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { runCli } from '../../src/cli.js';
import { applyCodexPlan, planCodexConfig } from '../../src/cli/codex.js';
import { generatePinManifest, serializePinManifest } from '../../src/backends/app-server/pin.js';
import { makeFakeVibeEnvironment } from './support/fake-vibe-environment.js';

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

describe('CLI runs list across isolated sessions', () => {
  let errorSpy: ReturnType<typeof vi.spyOn> | undefined;
  const errors: string[] = [];
  afterEach(() => { errorSpy?.mockRestore(); errorSpy = undefined; errors.length = 0; });

  const rootRun = '0b0b9a49-8a52-4c3b-9e31-6d0f1f2a3b4c';
  const sessionRun = '5f2c7e1a-3d4b-4e5f-a6b7-c8d9e0f1a2b3';

  async function dataRoot(): Promise<{ data: string; config: string }> {
    const data = await tempDir();
    const config = path.join(data, 'config.toml');
    await writeFile(config, 'version = 1\nallowed_workspace_roots = []\n', { mode: 0o600 });
    captureOutput();
    errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { errors.push(String(chunk)); return true; }) as typeof process.stderr.write);
    return { data, config };
  }

  async function savedRun(home: string, runId: string): Promise<void> {
    const directory = path.join(home, 'runs', runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, 'meta.json'), JSON.stringify({ schema_version: 1, run_id: runId, usage: { tool_calls: { executed: 3, denied_by_handler: 1, denied_by_policy: 1 } } }), { mode: 0o600 });
  }

  it('lists runs stored under the data root and under isolated sessions', async () => {
    const { data, config } = await dataRoot();
    await savedRun(data, rootRun);
    await mkdir(path.join(data, 'mcp-sessions'), { mode: 0o700 });
    await savedRun(path.join(data, 'mcp-sessions', 'session-Ab12Cd'), sessionRun);
    await runCli(['runs', '--config', config, 'list']);
    const rows = JSON.parse(output.join('')) as Array<{ run_id: string; usage?: { tool_calls?: unknown } }>;
    expect(rows.map((row) => row.run_id)).toEqual([rootRun, sessionRun]);
    expect(rows[1]?.usage?.tool_calls).toEqual({ executed: 3, denied_by_handler: 1, denied_by_policy: 1 });
    expect(process.exitCode).toBeUndefined();
  });

  it('refuses more session directories than the router scans', async () => {
    const { data, config } = await dataRoot();
    const sessions = path.join(data, 'mcp-sessions');
    await mkdir(sessions, { mode: 0o700 });
    await Promise.all(Array.from({ length: 129 }, (_, index) => mkdir(path.join(sessions, `session-${String(index).padStart(6, '0')}`), { mode: 0o700 })));
    await runCli(['runs', '--config', config, 'list']);
    expect(output.join('')).toBe('');
    expect(errors.join('')).toContain('VSUP_INVALID_STATE: The isolated session namespace exceeds its safe scan limit; inspect it manually.');
    expect(process.exitCode).toBe(1);
  });

  it('skips a session directory that resolves through a link with a warning and lists the rest', async () => {
    const { data, config } = await dataRoot();
    await savedRun(data, rootRun);
    const sessions = path.join(data, 'mcp-sessions');
    await mkdir(sessions, { mode: 0o700 });
    const elsewhere = await tempDir();
    await savedRun(elsewhere, sessionRun);
    await symlink(elsewhere, path.join(sessions, 'session-Zz99Yy'));
    await runCli(['runs', '--config', config, 'list']);
    expect((JSON.parse(output.join('')) as Array<{ run_id: string }>).map((row) => row.run_id)).toEqual([rootRun]);
    expect(errors.join('')).toMatch(/Skipped the isolated session .*session-Zz99Yy: An unsafe session directory was found/);
    expect(process.exitCode).toBeUndefined();
  });

  it('still refuses the listing when the data root itself is unsafe', async () => {
    const { data, config } = await dataRoot();
    const elsewhere = await tempDir();
    await mkdir(path.join(elsewhere, 'runs'), { mode: 0o700 });
    await symlink(path.join(elsewhere, 'runs'), path.join(data, 'runs'));
    await runCli(['runs', '--config', config, 'list']);
    expect(output.join('')).toBe('');
    expect(errors.join('')).toMatch(/VSUP_INVALID_STATE: An unsafe run directory was found/);
    expect(process.exitCode).toBe(1);
  });

  it('shows and tails a run saved in an isolated session, as list finds it', async () => {
    const { data, config } = await dataRoot();
    await mkdir(path.join(data, 'mcp-sessions'), { mode: 0o700 });
    const home = path.join(data, 'mcp-sessions', 'session-Ab12Cd');
    await savedRun(home, sessionRun);
    const event = { schema_version: 1, seq: 1, timestamp: '2026-10-01T10:00:00.000Z', run_id: sessionRun, backend: 'app-server', source: 'supervisor', type: 'state', severity: 'info', data: { state: 'running' } };
    await writeFile(path.join(home, 'runs', sessionRun, 'events.ndjson'), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    await runCli(['runs', '--config', config, 'show', sessionRun]);
    expect((JSON.parse(output.join('')) as { record: { run_id: string } }).record.run_id).toBe(sessionRun);
    output.length = 0;
    await runCli(['runs', '--config', config, 'tail', sessionRun]);
    expect((JSON.parse(output.join('')) as Array<{ seq: number }>).map((item) => item.seq)).toEqual([1]);
    expect(process.exitCode).toBeUndefined();
    output.length = 0;
    await runCli(['runs', '--config', config, 'show', rootRun]);
    expect(output.join('')).toBe('');
    expect(errors.join('')).toContain(`Run ${rootRun} was not found`);
  });

  it('rejects an unknown runs subcommand with the usage line', async () => {
    const { config } = await dataRoot();
    await runCli(['runs', '--config', config, 'usefulness-unknown']);
    expect(errors.join('')).toContain('Usage: vibe-supervisor runs');
    expect(process.exitCode).toBe(2);
  });
});

describe('CLI diagnostics for the app-server runtime', () => {
  let errorSpy: ReturnType<typeof vi.spyOn> | undefined;
  const errors: string[] = [];

  afterEach(() => { errorSpy?.mockRestore(); errorSpy = undefined; errors.length = 0; });

  async function installation(): Promise<void> {
    const data = await tempDir();
    const fake = await makeFakeVibeEnvironment(data);
    const manifest = path.join(data, 'vibe-pin-manifest.json');
    await writeFile(manifest, serializePinManifest(await generatePinManifest({ executable: fake.shim })), { mode: 0o600 });
    await writeFile(path.join(data, 'config.toml'), `version = 1\nallowed_workspace_roots = []\n\n[paths]\nvibe = ${JSON.stringify(fake.vibeShim)}\nvibe_pin_manifest = ${JSON.stringify(manifest)}\n`);
    vi.stubEnv('VIBE_SUPERVISOR_HOME', data);
    captureOutput();
    errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { errors.push(String(chunk)); return true; }) as typeof process.stderr.write);
  }

  it('doctor --json verifies the pinned Vibe install against the manifest without checking ACP', async () => {
    await installation();
    await runCli(['doctor', '--json']);
    const report = JSON.parse(output.join('')) as { checks: Array<{ name: string; ok: boolean; version?: string }>; provenance: { backend: string } };
    expect(report.checks.find((entry) => entry.name === 'vibe')).toMatchObject({ ok: true, version: '3.0.2' });
    expect(report.provenance.backend).toBe('app-server');
    expect(report.checks.some((entry) => entry.name.includes('acp'))).toBe(false);
  }, 30_000);

  it('doctor reports unknown authentication separately from local runtime checks', async () => {
    await installation();
    await runCli(['doctor']);
    expect(output.join('')).toMatch(/UNVERIFIED authentication: The Mistral credential is resolved/);
    expect(output.join('')).not.toMatch(/ACP/i);
  }, 30_000);
});
