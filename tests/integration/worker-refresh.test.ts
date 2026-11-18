import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppServerBackend } from '../../src/backends/app-server.js';
import { AntigravityBackend } from '../../src/backends/antigravity.js';
import { ResolvedCredential } from '../../src/backends/app-server/credentials.js';
import { atomicWriteJson } from '../../src/persistence/atomic.js';
import { digest } from '../../src/acceptance/schema.js';
import { loadConfig } from '../../src/config/config.js';
import { selectedConfigPolicy } from '../../src/config/policy.js';
import type { BackendCallbacks, BackendRunHandle, BackendStartResult, StartRunInput, SupervisorBackend, SupervisorConfig } from '../../src/contracts.js';
import { RunManager } from '../../src/core/run-manager.js';
import { PIN_HISTORY_DIRECTORY } from '../../src/backends/app-server/pin-replace.js';
import { generatePinManifest, parsePinManifest } from '../../src/backends/app-server/pin.js';
import { preparationComponents, preparationIdentity, readPreparationFacts, receiptPath } from '../../src/preparation/evidence.js';
import { runPreparation, type RunPreparationInput } from '../../src/preparation/run.js';
import { makeLaunchableFakeVibe, type LaunchableFakeVibe } from '../unit/support/launchable-fake-vibe.js';

const exec = promisify(execFile);
const SECRET = ['worker', 'refresh', 'credential', 'abcdefghijklmnop'].join('-');
const roots: string[] = [];
const managers: RunManager[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PASSING_CHILD = `import { writeFileSync } from 'node:fs';
const output = process.argv[process.argv.indexOf('--output') + 1];
writeFileSync(output, JSON.stringify({ result: 'pass', network_observation: { verdict: 'none-observed-control-validated' }, findings: [] }), { mode: 0o600 });
`;
const FAILING_CHILD = `import { writeFileSync } from 'node:fs';
const output = process.argv[process.argv.indexOf('--output') + 1];
writeFileSync(output, JSON.stringify({ result: 'fail', network_observation: { verdict: 'none-observed-control-validated' }, findings: [{ level: 'fail', code: 'handshake-version', message: 'The server reported another version.' }] }), { mode: 0o600 });
process.exitCode = 1;
`;
const HANGING_CHILD = `setInterval(() => undefined, 1000);
`;

type Blocker = { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
type Readiness = Record<string, unknown> & { eligible: boolean; blockers: Blocker[]; readiness_receipt?: string; warnings?: string[]; worker: { backend: string; version: string | null; refreshed?: { at: string; from?: string } }; worker_refresh?: Record<string, unknown>; boot_drift: string[]; effective_limits: { max_turns: number; timeout_seconds: number } };

interface Gate { promise: Promise<void>; open(): void }
function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd });
}

function scenario(version: string, steps: unknown[] = [{ op: 'say', text: 'No findings.' }]): Record<string, unknown> {
  return { name: 'answer', serverVersion: version, steps };
}

async function vibeBox(options: { versions: string[]; initial: string; minimum?: string }) {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-refresh-')); roots.push(root);
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'a.txt'), 'one\n');
  await git(workspace, ['init', '-q']); await git(workspace, ['add', 'a.txt']); await git(workspace, ['commit', '-qm', 'init']);
  const environments: Record<string, LaunchableFakeVibe & { directory: string }> = {};
  for (const version of options.versions) {
    const directory = path.join(root, `vibe-${version}`);
    environments[version] = { ...await makeLaunchableFakeVibe(directory, { version, scenario: scenario(version) }), directory };
  }
  const state = path.join(root, 'state'); await mkdir(state, { mode: 0o700 });
  const manifest = path.join(state, 'vibe-pin-manifest.json');
  await copyFile(environments[options.initial]!.manifest, manifest);
  const link = path.join(root, 'bin', 'vibe-app-server');
  await mkdir(path.dirname(link));
  await symlink(environments[options.initial]!.appServer, link);
  const configPath = path.join(state, 'config.toml');
  const writeConfig = async (extra = ''): Promise<void> => {
    const text = `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n${options.minimum ? `vibe_version = ${JSON.stringify(options.minimum)}\n` : ''}${extra}[paths]\napp_server = ${JSON.stringify(link)}\nvibe_pin_manifest = ${JSON.stringify(manifest)}\n`;
    await writeFile(`${configPath}.next`, text, { mode: 0o600 }); await rename(`${configPath}.next`, configPath);
  };
  await writeConfig();
  const config = await loadConfig({ configPath });
  const scripts = { passing: path.join(root, 'passing.mjs'), failing: path.join(root, 'failing.mjs'), hanging: path.join(root, 'hanging.mjs') };
  await writeFile(scripts.passing, PASSING_CHILD); await writeFile(scripts.failing, FAILING_CHILD); await writeFile(scripts.hanging, HANGING_CHILD);
  expect((await runPreparation({ config, configPath, dataDir: state, stderr: 'ignore', conformanceScript: scripts.passing })).status).toBe('passed');
  const swap = async (version: string): Promise<void> => { await unlink(link); await symlink(environments[version]!.appServer, link); };
  const calls: RunPreparationInput[] = [];
  const pins = { count: 0 };
  let managerCount = 0;
  const manager = (settings: { script?: keyof typeof scripts; hold?: Gate; config?: SupervisorConfig } = {}): RunManager => {
    const bootConfig = settings.config ?? config;
    const backend = new AppServerBackend(bootConfig, {
      dataDir: state,
      credentialEnvironment: { environment: { MISTRAL_API_KEY: SECRET }, platform: process.platform },
      resolveCredential: async () => ({ status: 'environment', detail: '', credential: new ResolvedCredential(SECRET) }),
      reaper: { pollMs: 50, graceMs: 200 }
    });
    managerCount += 1;
    const created = new RunManager(bootConfig, path.join(root, `data-${managerCount}`), [backend], undefined, {
      policy: selectedConfigPolicy(configPath), preparationDataDir: state,
      workerRefresh: { generatePinManifest: async (pinOptions) => { pins.count += 1; return generatePinManifest(pinOptions); }, runPreparation: async (input) => { calls.push(input); await settings.hold?.promise; return runPreparation({ ...input, conformanceScript: scripts[settings.script ?? 'passing'] }); } }
    });
    managers.push(created);
    return created;
  };
  const sitePackages = (version: string): string => path.join(environments[version]!.directory, 'tools', 'mistral-vibe', 'lib', 'python3.12', 'site-packages');
  return { root, workspace, state, manifest, configPath, config, environments, swap, manager, calls, pins, writeConfig, sitePackages };
}

async function readiness(manager: RunManager, workspace: string, waitSeconds = 0): Promise<Readiness> {
  return await manager.status({ workspace, operation: 'review', wait_seconds: waitSeconds }) as Readiness;
}

async function grant(manager: RunManager, workspace: string, waitSeconds = 20) {
  const request = { task: 'Review the file.', cwd: workspace, wait_seconds: waitSeconds };
  const issued = await manager.authorizeDispatch('review', request, 'codex-vibe-test-owner', new Date(Date.now() + 3_600_000).toISOString());
  return () => manager.reviewStart({ ...request, authorization_id: issued.authorization_id, attempt_id: issued.attempt_id });
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: string; retryable?: boolean; details?: Record<string, unknown> }> {
  try { await promise; } catch (error) { return error as { code?: string; details?: Record<string, unknown> }; }
  throw new Error('expected a rejection');
}

const codes = (report: Readiness): string[] => report.blockers.map((blocker) => blocker.code);
const WARNING = 'Vibe 3.1.2 -> 3.1.3 was refreshed automatically; no-inference preparation passed; hosted quality has not been re-run on this version.';

describe('Vibe worker refresh at readiness', () => {
  it('re-pins and re-prepares after an update, then starts and warns about the refresh', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    expect(await readiness(manager, box.workspace)).toMatchObject({ eligible: true, worker: { backend: 'app-server', version: '3.1.2' } });
    await box.swap('3.1.3');
    const first = await readiness(manager, box.workspace);
    expect(first.eligible).toBe(false);
    expect(codes(first)).toEqual(['VSUP_PREPARING']);
    expect(first.blockers[0]).toMatchObject({ retryable: true, details: { backend: 'app-server', stage: expect.stringMatching(/^(pinning|preparing)$/), retry_after_seconds: expect.any(Number) } });
    const ready = await readiness(manager, box.workspace, 60);
    expect(ready).toMatchObject({ eligible: true, blockers: [], worker: { backend: 'app-server', version: '3.1.3', refreshed: { from: '3.1.2', at: expect.any(String) } }, warnings: [WARNING] });
    expect(parsePinManifest(await readFile(box.manifest, 'utf8')).version).toBe('3.1.3');
    const history = await readdir(path.join(box.state, PIN_HISTORY_DIRECTORY));
    expect(history).toEqual([expect.stringMatching(/^vibe-pin-3\.1\.2-\d{8}T\d{6}Z\.json$/)]);
    expect(await readPreparationFacts(box.config, box.state)).toMatchObject({ status: { status: 'passed' }, origin: 'automatic', previous_worker_version: '3.1.2' });
    expect(box.calls).toHaveLength(1);
    const started = await (await grant(manager, box.workspace))();
    expect(started.error, JSON.stringify(started)).toBeUndefined();
    expect(started.state).toBe('completed');
    expect((started.result as { warnings: string[] }).warnings).toContain(WARNING);
    expect(box.calls).toHaveLength(1);
  }, 60_000);

  it('refreshes a downgrade that stays at or above the minimum', async () => {
    const box = await vibeBox({ versions: ['3.1.3', '3.1.4'], initial: '3.1.4', minimum: '3.1.3' });
    const manager = box.manager();
    await box.swap('3.1.3');
    const ready = await readiness(manager, box.workspace, 60);
    expect(ready).toMatchObject({ eligible: true, worker: { version: '3.1.3', refreshed: { from: '3.1.4' } } });
    expect(parsePinManifest(await readFile(box.manifest, 'utf8')).version).toBe('3.1.3');
  }, 60_000);

  it('refuses a version below the minimum without refreshing', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.4'], initial: '3.1.4', minimum: '3.1.3' });
    const manager = box.manager();
    await box.swap('3.1.2');
    const report = await readiness(manager, box.workspace, 5);
    expect(report.eligible).toBe(false);
    expect(report.blockers).toContainEqual(expect.objectContaining({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: expect.objectContaining({ reason: 'version-mismatch' }) }));
    expect(codes(report)).not.toContain('VSUP_PREPARING');
    expect(box.calls).toHaveLength(0);
    expect(parsePinManifest(await readFile(box.manifest, 'utf8')).version).toBe('3.1.4');
  }, 60_000);

  it('never re-pins a changed file under the same version, and the start refuses without spending its grant', async () => {
    const box = await vibeBox({ versions: ['3.1.2'], initial: '3.1.2' });
    const manager = box.manager();
    const start = await grant(manager, box.workspace);
    await writeFile(path.join(box.environments['3.1.2']!.directory, 'tools', 'mistral-vibe', 'lib', 'python3.12', 'site-packages', 'vibe', '__init__.py'), '__version__ = "changed"\n');
    const report = await readiness(manager, box.workspace, 5);
    expect(codes(report)).not.toContain('VSUP_PREPARING');
    const refused = await rejection(start());
    expect(refused).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { reason: 'file-mismatch', attempt_consumed: false } });
    expect(refused.details).not.toHaveProperty('worker_refresh');
    expect(box.calls).toHaveLength(0);
  }, 60_000);

  it('reports an install still changing as retryable, writes nothing, and refreshes once the files settle', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    const changed = path.join(box.environments['3.1.3']!.directory, 'tools', 'mistral-vibe', 'lib', 'python3.12', 'site-packages', 'vibe', '__init__.py');
    const original = await readFile(changed);
    await writeFile(changed, '__version__ = "half-written"\n');
    const manifestBefore = await readFile(box.manifest);
    const receiptBefore = await readFile(receiptPath(box.config, box.state));
    await box.swap('3.1.3');
    const unsettled = await readiness(manager, box.workspace, 30);
    expect(codes(unsettled)).toEqual(['VSUP_PREPARING']);
    expect(unsettled.blockers[0]).toMatchObject({ retryable: true, details: { stage: 'install_unsettled', reason: 'record-hash-mismatch' } });
    expect(await readFile(box.manifest)).toEqual(manifestBefore);
    expect(await readFile(receiptPath(box.config, box.state))).toEqual(receiptBefore);
    await expect(readdir(path.join(box.state, PIN_HISTORY_DIRECTORY))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(box.calls).toHaveLength(0);
    await writeFile(changed, original);
    expect(await readiness(manager, box.workspace, 60)).toMatchObject({ eligible: true, worker: { refreshed: { from: '3.1.2' } } });
  }, 60_000);

  it('keeps a failed preparation as a blocker with its report and does not retry it', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager({ script: 'failing' });
    await box.swap('3.1.3');
    const failed = await readiness(manager, box.workspace, 60);
    expect(failed.eligible).toBe(false);
    expect(codes(failed)).toEqual(['VSUP_INVALID_STATE']);
    expect(failed.blockers[0]!.details).toMatchObject({ preparation: { status: 'failed' }, report_path: expect.stringMatching(/preparation-reports/), findings: [{ code: 'handshake-version', message: 'The server reported another version.' }] });
    const again = await readiness(manager, box.workspace, 5);
    expect(codes(again)).toEqual(['VSUP_INVALID_STATE']);
    expect(box.calls).toHaveLength(1);
  }, 60_000);

  it('leaves an interrupted refresh for the next server, which retries it and passes', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const first = box.manager({ script: 'hanging' });
    await box.swap('3.1.3');
    expect(codes(await readiness(first, box.workspace))).toEqual(['VSUP_PREPARING']);
    await vi.waitFor(async () => expect(await readPreparationFacts(box.config, box.state)).toMatchObject({ interrupted: true }), { timeout: 10_000 });
    await first.shutdown();
    expect(await readPreparationFacts(box.config, box.state)).toMatchObject({ status: { status: 'failed' }, interrupted: true, origin: 'automatic', previous_worker_version: '3.1.2' });
    const second = box.manager();
    expect(await readiness(second, box.workspace, 60)).toMatchObject({ eligible: true, worker: { refreshed: { from: '3.1.2' } } });
    expect(box.calls.map((call) => call.previousWorkerVersion)).toEqual(['3.1.2', '3.1.2']);
  }, 60_000);

  it('lets one of two servers sharing the records refresh while the other reports the lock', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const hold = gate();
    const owner = box.manager({ hold });
    const other = box.manager();
    await box.swap('3.1.3');
    expect(codes(await readiness(owner, box.workspace))).toEqual(['VSUP_PREPARING']);
    await vi.waitFor(() => expect(box.calls).toHaveLength(1), { timeout: 10_000 });
    const locked = await readiness(other, box.workspace);
    expect(codes(locked)).toEqual(['VSUP_PREPARING']);
    expect(locked.blockers[0]).toMatchObject({ retryable: true, details: { stage: 'locked' } });
    hold.open();
    expect(await readiness(other, box.workspace, 60)).toMatchObject({ eligible: true });
    expect(await readiness(owner, box.workspace, 60)).toMatchObject({ eligible: true });
    expect(box.calls).toHaveLength(1);
  }, 60_000);

  it('does not refresh while a restart is required', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    await manager.initialize();
    await box.writeConfig('[limits]\nmax_turns_review = 7\n');
    await box.swap('3.1.3');
    const report = await readiness(manager, box.workspace, 5);
    expect(codes(report)).toContain('VSUP_RESTART_REQUIRED');
    expect(codes(report)).not.toContain('VSUP_PREPARING');
    expect(report.worker_refresh).toMatchObject({ status: 'held', reason: 'boot_drift' });
    expect(box.calls).toHaveLength(0);
  }, 60_000);

  it('waits for an active run, and a start during the refresh is refused without spending its grant', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const hold = gate();
    const manager = box.manager({ hold });
    await writeFile(path.join(box.environments['3.1.2']!.directory, 'scenario.json'), JSON.stringify(scenario('3.1.2', [{ op: 'hold' }])));
    const running = await (await grant(manager, box.workspace, 0))();
    await box.swap('3.1.3');
    const busy = await readiness(manager, box.workspace);
    expect(codes(busy)).toContain('VSUP_LIMIT_EXCEEDED');
    expect(codes(busy)).not.toContain('VSUP_PREPARING');
    expect(busy.worker_refresh).toMatchObject({ status: 'pending', reason: 'busy' });
    expect(box.calls).toHaveLength(0);
    await manager.close({ run_id: running.run_id });
    expect(codes(await readiness(manager, box.workspace))).toEqual(['VSUP_PREPARING']);
    await vi.waitFor(() => expect(box.calls).toHaveLength(1), { timeout: 10_000 });
    const start = await grant(manager, box.workspace);
    const refused = await rejection(start());
    expect(refused).toMatchObject({ code: 'VSUP_PREPARING', retryable: true, details: { stage: 'preparing', attempt_consumed: false } });
    hold.open();
    expect(await readiness(manager, box.workspace, 60)).toMatchObject({ eligible: true });
    const started = await start();
    expect(started.error, JSON.stringify(started)).toBeUndefined();
    expect(started.state).toBe('completed');
  }, 60_000);

  it('tells a start refused for a stale pin that a readiness check refreshes it', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    const start = await grant(manager, box.workspace);
    await box.swap('3.1.3');
    const refused = await rejection(start());
    expect(refused).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { reason: 'manifest-version-mismatch', attempt_consumed: false, worker_refresh: expect.stringMatching(/readiness/) } });
    expect(box.calls).toHaveLength(0);
  }, 60_000);

  it('remembers a refused re-pin against the install and does not hash it again', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    const extra = path.join(box.sitePackages('3.1.3'), 'vibe', 'planted.py');
    await writeFile(extra, 'print("unlisted")\n');
    const manifestBefore = await readFile(box.manifest);
    await box.swap('3.1.3');
    const refused = await readiness(manager, box.workspace, 30);
    expect(codes(refused)).toEqual(['VSUP_VIBE_VERSION_UNSUPPORTED']);
    expect(refused.blockers[0]).toMatchObject({ retryable: false, details: { reason: 'file-extra', rechecked_when: expect.stringMatching(/restart/) } });
    expect(box.pins.count).toBe(1);
    const again = await readiness(manager, box.workspace, 30);
    expect(again.blockers[0]).toMatchObject({ details: { reason: 'file-extra' } });
    expect(box.pins.count).toBe(1);
    expect(box.calls).toHaveLength(0);
    expect(await readFile(box.manifest)).toEqual(manifestBefore);
  }, 60_000);

  it('shows a re-pin refusal it cannot key to the install once, then tries again', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    const record = path.join(box.environments['3.1.3']!.directory, 'tools', 'mistral-vibe', 'lib', 'python3.12', 'site-packages', 'mistral_vibe-3.1.3.dist-info', 'RECORD');
    const saved = await readFile(record);
    await rm(record);
    await box.swap('3.1.3');
    const refused = await readiness(manager, box.workspace, 30);
    expect(codes(refused)).toEqual(['VSUP_VIBE_VERSION_UNSUPPORTED']);
    expect(refused.blockers[0]).toMatchObject({ details: { reason: 'record-unreadable' } });
    expect(box.pins.count).toBe(1);
    await writeFile(record, saved);
    expect(await readiness(manager, box.workspace, 60)).toMatchObject({ eligible: true });
    expect(box.pins.count).toBe(2);
  }, 60_000);

  it('gives the exact prepare check command for a missing receipt and starts nothing', async () => {
    const box = await vibeBox({ versions: ['3.1.2'], initial: '3.1.2' });
    await rm(receiptPath(box.config, box.state));
    const report = await readiness(box.manager(), box.workspace, 5);
    expect(codes(report)).toEqual(['VSUP_INVALID_STATE']);
    const command = report.blockers[0]!.details?.prepare_check as string;
    expect(report.blockers[0]!.details).toMatchObject({ preparation: { status: 'missing' } });
    expect(command.endsWith(` prepare check --kit <kit directory> --config ${box.configPath}`)).toBe(true);
    expect(box.calls).toHaveLength(0);
  }, 60_000);
});

describe('Antigravity worker refresh at readiness', () => {
  it('re-prepares after the agy binary changes', async () => {
    const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-refresh-agy-')); roots.push(root);
    const workspace = path.join(root, 'workspace'); await mkdir(workspace);
    const state = path.join(root, 'state'); await mkdir(state, { mode: 0o700 });
    const agy = path.join(root, 'bin', 'agy'); await mkdir(path.dirname(agy));
    const writeAgy = async (version: string): Promise<void> => { await writeFile(`${agy}.next`, `#!/bin/sh\necho "agy ${version}"\n`, { mode: 0o755 }); await rename(`${agy}.next`, agy); };
    await writeAgy('1.5.8');
    const configPath = path.join(state, 'config.toml');
    await writeFile(configPath, `version = 1\nbackend = "antigravity"\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[experimental]\nantigravity = true\n[paths]\nantigravity = ${JSON.stringify(agy)}\n`, { mode: 0o600 });
    const config = await loadConfig({ configPath });
    vi.stubEnv('GEMINI_API_KEY', 'agy-refresh-test-key');
    const calls: RunPreparationInput[] = [];
    const prepare = async (input: RunPreparationInput) => {
      calls.push(input);
      const report = Buffer.from(JSON.stringify({ result: 'pass' }));
      const reports = path.join(input.dataDir, 'preparation-reports'); await mkdir(reports, { recursive: true, mode: 0o700 });
      const reportPath = path.join(reports, `${digest(report)}.json`);
      await writeFile(reportPath, report, { mode: 0o600 });
      await atomicWriteJson(receiptPath(input.config, input.dataDir), { schema_version: 1, result: 'passed', identity: await preparationIdentity(input.config), checked_at: new Date().toISOString(), report_sha256: digest(report), components: await preparationComponents(input.config), ...(input.origin ? { origin: input.origin } : {}), ...(input.previousWorkerVersion ? { previous_worker_version: input.previousWorkerVersion } : {}) });
      return { status: 'passed' as const, candidate_sha256: 'c'.repeat(64), hosted_acceptance: 'unverified' as const, report_sha256: digest(report), report_path: reportPath, findings: [] };
    };
    await prepare({ config, configPath, dataDir: state, stderr: 'ignore' });
    calls.length = 0;
    const previousPin = (await preparationComponents(config)).pin;
    const manager = new RunManager(config, path.join(root, 'data'), [new AntigravityBackend(config, { dataDir: state })], undefined, { policy: selectedConfigPolicy(configPath), preparationDataDir: state, workerRefresh: { runPreparation: prepare } });
    managers.push(manager);
    expect(await readiness(manager, workspace)).toMatchObject({ eligible: true, worker: { backend: 'antigravity', version: '1.5.8' } });
    await writeAgy('1.6.0');
    const ready = await readiness(manager, workspace, 30);
    expect(ready).toMatchObject({ eligible: true, worker: { version: '1.6.0', refreshed: { from: `sha256:${previousPin.slice(0, 12)}` } } });
    expect(ready.warnings).toEqual([`Antigravity CLI (previous binary sha256:${previousPin.slice(0, 12)}) -> 1.6.0 was refreshed automatically; no-inference preparation passed; hosted quality has not been re-run on this version.`]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ origin: 'automatic', previousWorkerVersion: `sha256:${previousPin.slice(0, 12)}` });
  }, 60_000);
});

class IdleBackend implements SupervisorBackend {
  readonly kind = 'app-server' as const;
  starts = 0;
  async probe() { return { available: true, backend: this.kind }; }
  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    this.starts += 1;
    const handle: BackendRunHandle = { runId: input.runId, backend: this.kind, opaque: {} };
    callbacks.onSpawn?.(handle);
    return { handle, initialState: 'running' };
  }
  async cancel() {}
  async close() {}
}

describe('running build and limits in readiness', () => {
  async function plainBox() {
    const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-refresh-build-')); roots.push(root);
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    await writeFile(path.join(workspace, 'a.txt'), 'one\n');
    await git(workspace, ['init', '-q']); await git(workspace, ['add', 'a.txt']); await git(workspace, ['commit', '-qm', 'init']);
    const configPath = path.join(root, 'config.toml');
    await writeFile(configPath, `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\npaths = { vibe_pin_manifest = "/unused/vibe-pin-manifest.json" }\n`, { mode: 0o600 });
    return { root, workspace, configPath, config: await loadConfig({ configPath }) };
  }

  it('refuses readiness and starts with a restart blocker once the installed build changes', async () => {
    const box = await plainBox();
    let build = 'a'.repeat(64);
    const backend = new IdleBackend();
    const manager = new RunManager(box.config, path.join(box.root, 'data'), [backend], undefined, { policy: selectedConfigPolicy(box.configPath), buildIdentity: async () => build });
    managers.push(manager);
    expect(await readiness(manager, box.workspace)).toMatchObject({ eligible: true, boot_drift: [], candidate: { sha256: 'a'.repeat(64) } });
    const start = await grant(manager, box.workspace);
    build = 'b'.repeat(64);
    const report = await readiness(manager, box.workspace);
    expect(report).toMatchObject({ eligible: false, restart_required: true, boot_drift: ['build'], candidate: { sha256: 'a'.repeat(64) } });
    expect(report.blockers).toContainEqual(expect.objectContaining({ code: 'VSUP_RESTART_REQUIRED', message: expect.stringMatching(/installed supervisor files changed/), details: { boot_drift: ['build'] } }));
    expect(await rejection(start())).toMatchObject({ code: 'VSUP_RESTART_REQUIRED', details: { boot_drift: ['build'] } });
    expect(backend.starts).toBe(0);
  });

  it('reports the limits a run with omitted fields gets', async () => {
    const box = await plainBox();
    const manager = new RunManager(box.config, path.join(box.root, 'data'), [new IdleBackend()], undefined, { policy: selectedConfigPolicy(box.configPath) });
    managers.push(manager);
    expect((await readiness(manager, box.workspace)).effective_limits).toEqual({ max_turns: box.config.limits.maxTurnsReview, timeout_seconds: box.config.limits.reviewTimeoutSeconds });
    const edit = await manager.status({ workspace: box.workspace, operation: 'edit' }) as Readiness;
    expect(edit.effective_limits).toEqual({ max_turns: box.config.limits.maxTurnsEdit, timeout_seconds: box.config.limits.editTimeoutSeconds });
  });
});
