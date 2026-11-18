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

async function abortable(pending: Promise<void> | undefined, signal: AbortSignal | undefined): Promise<void> {
  if (!pending) return;
  await Promise.race([pending, new Promise<void>((resolve) => { if (signal?.aborted) resolve(); else signal?.addEventListener('abort', () => resolve(), { once: true }); })]);
  signal?.throwIfAborted();
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
  const manager = (settings: { script?: keyof typeof scripts; hold?: Gate; config?: SupervisorConfig; now?: () => number } = {}): RunManager => {
    const bootConfig = settings.config ?? config;
    const backend = new AppServerBackend(bootConfig, {
      dataDir: state,
      credentialEnvironment: { environment: { MISTRAL_API_KEY: SECRET }, platform: process.platform },
      resolveCredential: async () => ({ status: 'environment', detail: '', credential: new ResolvedCredential(SECRET) }),
      reaper: { pollMs: 50, graceMs: 200 }
    });
    managerCount += 1;
    const created = new RunManager(bootConfig, path.join(root, `data-${managerCount}`), [backend], undefined, {
      policy: selectedConfigPolicy(configPath), preparationDataDir: state, ...(settings.now ? { now: settings.now } : {}),
      workerRefresh: { generatePinManifest: async (pinOptions) => { pins.count += 1; return generatePinManifest(pinOptions); }, runPreparation: async (input) => { calls.push(input); await abortable(settings.hold?.promise, input.signal); return runPreparation({ ...input, conformanceScript: scripts[settings.script ?? 'passing'] }); } }
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
    expect(history).toEqual([expect.stringMatching(/^vibe-pin-manifest-3\.1\.2-\d{8}T\d{6}Z\.json$/)]);
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
    expect(unsettled.blockers[0]).toMatchObject({ retryable: true, details: { stage: 'install_unsettled', reason: 'record-hash-mismatch', mismatched: { paths: ['vibe/__init__.py'], total: 1 } } });
    expect(unsettled.worker_refresh).toMatchObject({ status: 'install_unsettled', mismatched: { paths: ['vibe/__init__.py'] } });
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

  it('says the configuration could not be reread instead of blaming boot drift', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    await manager.initialize();
    await writeFile(box.configPath, 'not toml [', { mode: 0o600 });
    await box.swap('3.1.3');
    const report = await readiness(manager, box.workspace, 5);
    expect(codes(report)).toContain('VSUP_CONFIG_INVALID');
    expect(report.worker_refresh).toMatchObject({ status: 'held', reason: 'config_unreadable' });
    expect(box.calls).toHaveLength(0);
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

  it('remembers a refused re-pin against the install for a minute, then heals without a restart', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    let clock = Date.now();
    const manager = box.manager({ now: () => clock });
    const extra = path.join(box.sitePackages('3.1.3'), 'vibe', 'planted.py');
    await writeFile(extra, 'print("unlisted")\n');
    const manifestBefore = await readFile(box.manifest);
    await box.swap('3.1.3');
    const refused = await readiness(manager, box.workspace, 30);
    expect(codes(refused)).toEqual(['VSUP_VIBE_VERSION_UNSUPPORTED']);
    expect(refused.blockers[0]).toMatchObject({ retryable: false, details: { reason: 'file-extra', rechecked_when: expect.stringMatching(/60 seconds.*no restart/) } });
    expect(box.pins.count).toBe(1);
    const again = await readiness(manager, box.workspace, 30);
    expect(again.blockers[0]).toMatchObject({ details: { reason: 'file-extra' } });
    expect(box.pins.count).toBe(1);
    expect(box.calls).toHaveLength(0);
    expect(await readFile(box.manifest)).toEqual(manifestBefore);
    await rm(extra);
    expect(codes(await readiness(manager, box.workspace, 30))).toEqual(['VSUP_VIBE_VERSION_UNSUPPORTED']);
    expect(box.pins.count).toBe(1);
    clock += 61_000;
    expect(await readiness(manager, box.workspace, 60)).toMatchObject({ eligible: true, worker: { refreshed: { from: '3.1.2' } } });
    expect(box.pins.count).toBe(2);
  }, 60_000);

  it('treats a RECORD not yet written during the re-pin as an install still changing', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    const record = path.join(box.environments['3.1.3']!.directory, 'tools', 'mistral-vibe', 'lib', 'python3.12', 'site-packages', 'mistral_vibe-3.1.3.dist-info', 'RECORD');
    const saved = await readFile(record);
    await rm(record);
    await box.swap('3.1.3');
    const unsettled = await readiness(manager, box.workspace, 30);
    expect(codes(unsettled)).toEqual(['VSUP_PREPARING']);
    expect(unsettled.blockers[0]).toMatchObject({ retryable: true, details: { stage: 'install_unsettled', reason: 'record-unreadable' } });
    expect(box.pins.count).toBe(1);
    await writeFile(record, saved);
    expect(await readiness(manager, box.workspace, 60)).toMatchObject({ eligible: true });
    expect(box.pins.count).toBe(2);
  }, 60_000);

  it('refuses a RECORD row without a hash and names the row', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    const record = path.join(box.sitePackages('3.1.3'), 'mistral_vibe-3.1.3.dist-info', 'RECORD');
    await writeFile(record, (await readFile(record, 'utf8')).split('\n').map((line) => line.startsWith('_native.so,') ? '_native.so,,' : line).join('\n'));
    const manifestBefore = await readFile(box.manifest);
    await box.swap('3.1.3');
    const refused = await readiness(manager, box.workspace, 30);
    expect(codes(refused)).toEqual(['VSUP_VIBE_VERSION_UNSUPPORTED']);
    expect(refused.blockers[0]).toMatchObject({ retryable: false, details: { reason: 'record-unhashed', unhashed: { paths: ['_native.so'], total: 1 } } });
    expect(refused.worker_refresh).toMatchObject({ status: 'refused', reason: 'record-unhashed', unhashed: { paths: ['_native.so'] } });
    expect(box.pins.count).toBe(1);
    expect(box.calls).toHaveLength(0);
    expect(await readFile(box.manifest)).toEqual(manifestBefore);
  }, 60_000);

  it('reports a missing dist-info at readiness as an install still changing and writes nothing', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    const distInfo = path.join(box.sitePackages('3.1.2'), 'mistral_vibe-3.1.2.dist-info');
    const aside = path.join(box.root, 'dist-info-aside');
    const manifestBefore = await readFile(box.manifest);
    const start = await grant(manager, box.workspace);
    await rename(distInfo, aside);
    const refusedStart = await rejection(start());
    expect(refusedStart).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { reason: 'dist-info-missing', attempt_consumed: false, worker_refresh: expect.stringMatching(/reports whether it is still updating or looks damaged/) } });
    expect(String(refusedStart.details?.worker_refresh)).not.toMatch(/refreshes/);
    const unsettled = await readiness(manager, box.workspace);
    expect(codes(unsettled)).toEqual(['VSUP_PREPARING']);
    expect(unsettled.blockers[0]).toMatchObject({ retryable: true, details: { stage: 'install_unsettled', reason: 'dist-info-missing' } });
    expect(unsettled.worker_refresh).toMatchObject({ status: 'install_unsettled', reason: 'dist-info-missing' });
    expect(await readFile(box.manifest)).toEqual(manifestBefore);
    await rename(aside, distInfo);
    expect(await readiness(manager, box.workspace, 5)).toMatchObject({ eligible: true });
    expect(box.pins.count).toBe(0);
    expect(await readFile(box.manifest)).toEqual(manifestBefore);
    await rename(distInfo, aside);
    expect(codes(await readiness(manager, box.workspace))).toEqual(['VSUP_PREPARING']);
    await box.swap('3.1.3');
    expect(await readiness(manager, box.workspace, 60)).toMatchObject({ eligible: true, worker: { version: '3.1.3', refreshed: { from: '3.1.2' } } });
    expect(box.pins.count).toBe(1);
  }, 60_000);

  it('waits through a dist-info that reappears at the same version without re-pinning', async () => {
    const box = await vibeBox({ versions: ['3.1.2'], initial: '3.1.2' });
    const manager = box.manager();
    const distInfo = path.join(box.sitePackages('3.1.2'), 'mistral_vibe-3.1.2.dist-info');
    const aside = path.join(box.root, 'dist-info-aside');
    await rename(distInfo, aside);
    setTimeout(() => { void rename(aside, distInfo); }, 300);
    expect(await readiness(manager, box.workspace, 30)).toMatchObject({ eligible: true });
    expect(box.pins.count).toBe(0);
    expect(box.calls).toHaveLength(0);
  }, 60_000);

  it('re-pins but leaves the preparation to the owner when the receipt is not one a refresh may renew', async () => {
    const cases: Array<[string, (receipt: Record<string, unknown>) => Record<string, unknown> | null]> = [
      ['changed candidate', (receipt) => ({ ...receipt, identity: '0'.repeat(64), components: { ...(receipt.components as Record<string, unknown>), candidate: '0'.repeat(64) } })],
      ['missing receipt', () => null],
      ['receipt without components', (receipt) => { const { components: _dropped, ...rest } = receipt; return rest; }]
    ];
    for (const [label, change] of cases) {
      const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
      const file = receiptPath(box.config, box.state);
      const changed = change(JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>);
      if (changed) await atomicWriteJson(file, changed); else await rm(file);
      const manager = box.manager();
      await box.swap('3.1.3');
      const report = await readiness(manager, box.workspace, 30);
      expect(codes(report), label).toEqual(['VSUP_INVALID_STATE']);
      expect(report.blockers[0]!.details, label).toMatchObject({ prepare_check: expect.stringContaining('prepare check --kit') });
      expect(parsePinManifest(await readFile(box.manifest, 'utf8')).version, label).toBe('3.1.3');
      expect(box.calls, label).toHaveLength(0);
    }
  }, 120_000);

  it('re-prepares after a version bump that follows a finished failure', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const file = receiptPath(box.config, box.state);
    await atomicWriteJson(file, { ...(JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>), result: 'failed' });
    const manager = box.manager();
    expect(codes(await readiness(manager, box.workspace))).toEqual(['VSUP_INVALID_STATE']);
    await box.swap('3.1.3');
    expect(await readiness(manager, box.workspace, 60)).toMatchObject({ eligible: true, worker: { refreshed: { from: '3.1.2' } } });
    expect(box.calls).toHaveLength(1);
  }, 60_000);

  it('still records the previous version after a refresh stopped between the re-pin and the receipt', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const first = box.manager({ hold: gate() });
    await box.swap('3.1.3');
    expect(codes(await readiness(first, box.workspace))).toEqual(['VSUP_PREPARING']);
    await vi.waitFor(() => expect(box.calls).toHaveLength(1), { timeout: 10_000 });
    await first.shutdown();
    expect(parsePinManifest(await readFile(box.manifest, 'utf8')).version).toBe('3.1.3');
    expect(await readPreparationFacts(box.config, box.state)).toMatchObject({ status: { status: 'stale' }, changed: ['pin'], worker_version: '3.1.2' });
    const second = box.manager();
    const ready = await readiness(second, box.workspace, 60);
    expect(ready).toMatchObject({ eligible: true, worker: { refreshed: { from: '3.1.2' } }, warnings: [WARNING] });
    expect(box.calls.map((call) => call.previousWorkerVersion)).toEqual(['3.1.2', '3.1.2']);
  }, 60_000);

  it('reports an install that stays inconsistent for two minutes as damaged, and recovers once it is fixed', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    let clock = Date.now();
    const manager = box.manager({ now: () => clock });
    const changed = path.join(box.sitePackages('3.1.3'), 'vibe', '__init__.py');
    const original = await readFile(changed);
    await writeFile(changed, '__version__ = "damaged"\n');
    await box.swap('3.1.3');
    const unsettled = await readiness(manager, box.workspace, 30);
    expect(unsettled.blockers[0]).toMatchObject({ code: 'VSUP_PREPARING', details: { stage: 'install_unsettled', reason: 'record-hash-mismatch' } });
    expect(box.pins.count).toBe(1);
    clock += 61_000;
    expect(codes(await readiness(manager, box.workspace, 30))).toEqual(['VSUP_PREPARING']);
    expect(box.pins.count).toBe(2);
    clock += 61_000;
    const damaged = await readiness(manager, box.workspace, 30);
    expect(codes(damaged)).toEqual(['VSUP_VIBE_VERSION_UNSUPPORTED']);
    expect(damaged.blockers[0]).toMatchObject({ retryable: false, remediation: expect.stringMatching(/^Reinstall Vibe/), details: { reason: 'record-hash-mismatch', mismatched: { paths: ['vibe/__init__.py'] } } });
    expect(damaged.worker_refresh).toMatchObject({ status: 'install_damaged' });
    expect(box.pins.count).toBe(3);
    expect(codes(await readiness(manager, box.workspace))).toEqual(['VSUP_VIBE_VERSION_UNSUPPORTED']);
    expect(box.pins.count).toBe(3);
    await writeFile(changed, original);
    clock += 61_000;
    expect(await readiness(manager, box.workspace, 60)).toMatchObject({ eligible: true });
    expect(box.pins.count).toBe(4);
  }, 60_000);

  it('keeps answering damaged across polls while the install stays the same, re-checking it at most once a minute', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    let clock = Date.now();
    const manager = box.manager({ now: () => clock });
    await writeFile(path.join(box.sitePackages('3.1.3'), 'vibe', '__init__.py'), '__version__ = "damaged"\n');
    await box.swap('3.1.3');
    const answers: string[] = [];
    for (let poll = 0; poll < 9; poll += 1) {
      const report = await readiness(manager, box.workspace, poll % 2 === 0 ? 30 : 0);
      answers.push(`${report.blockers[0]!.code}:${String(report.worker_refresh?.status)}`);
      await vi.waitFor(() => expect(report.worker_refresh?.recheck === 'running' ? (manager as unknown as { workerRefresh?: unknown }).workerRefresh : undefined).toBeUndefined(), { timeout: 10_000 });
      clock += 45_000;
    }
    const firstDamaged = answers.findIndex((answer) => answer.startsWith('VSUP_VIBE_VERSION_UNSUPPORTED'));
    expect(firstDamaged).toBeGreaterThan(0);
    expect(answers.slice(firstDamaged).every((answer) => answer === 'VSUP_VIBE_VERSION_UNSUPPORTED:install_damaged'), answers.join(', ')).toBe(true);
    expect(box.pins.count).toBeLessThan(9);
  }, 60_000);

  it('starts the clock again for an unsettled state not seen for over two minutes', async () => {
    const box = await vibeBox({ versions: ['3.1.2'], initial: '3.1.2' });
    let clock = Date.now();
    const manager = box.manager({ now: () => clock });
    const distInfo = path.join(box.sitePackages('3.1.2'), 'mistral_vibe-3.1.2.dist-info');
    const aside = path.join(box.root, 'aside');
    await rename(distInfo, aside);
    expect((await readiness(manager, box.workspace)).blockers[0]).toMatchObject({ code: 'VSUP_PREPARING', details: { stage: 'install_unsettled' } });
    await rename(aside, distInfo);
    clock += 300_000;
    await rename(distInfo, aside);
    expect((await readiness(manager, box.workspace)).blockers[0]).toMatchObject({ code: 'VSUP_PREPARING', details: { stage: 'install_unsettled' } });
  }, 60_000);

  it('reports a dist-info missing for two minutes as damaged', async () => {
    const box = await vibeBox({ versions: ['3.1.2'], initial: '3.1.2' });
    let clock = Date.now();
    const manager = box.manager({ now: () => clock });
    await rename(path.join(box.sitePackages('3.1.2'), 'mistral_vibe-3.1.2.dist-info'), path.join(box.root, 'aside'));
    expect((await readiness(manager, box.workspace)).blockers[0]).toMatchObject({ code: 'VSUP_PREPARING', details: { stage: 'install_unsettled' } });
    clock += 61_000;
    expect((await readiness(manager, box.workspace)).blockers[0]).toMatchObject({ code: 'VSUP_PREPARING' });
    clock += 61_000;
    const damaged = await readiness(manager, box.workspace, 5);
    expect(damaged.blockers[0]).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', retryable: false, details: { reason: 'dist-info-missing' } });
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

describe('worker changes around a run', () => {
  it('warns when the worker was updated while a run was in progress, and not otherwise', async () => {
    const box = await vibeBox({ versions: ['3.1.2', '3.1.3'], initial: '3.1.2' });
    const manager = box.manager();
    await writeFile(path.join(box.environments['3.1.2']!.directory, 'scenario.json'), JSON.stringify(scenario('3.1.2', [{ op: 'hold' }])));
    const steady = await (await grant(manager, box.workspace, 0))();
    await vi.waitFor(async () => expect((await manager.status({ run_id: steady.run_id })).state).toBe('running'), { timeout: 10_000 });
    await manager.close({ run_id: steady.run_id });
    const steadyResult = await manager.result({ run_id: steady.run_id, detail: 'full' }) as { warnings: string[] };
    expect(steadyResult.warnings.filter((warning) => warning.startsWith('worker_updated_during_run'))).toEqual([]);
    const updated = await (await grant(manager, box.workspace, 0))();
    await vi.waitFor(async () => expect((await manager.status({ run_id: updated.run_id })).state).toBe('running'), { timeout: 10_000 });
    await box.swap('3.1.3');
    await manager.close({ run_id: updated.run_id });
    const result = await manager.result({ run_id: updated.run_id, detail: 'full' }) as { state: string; warnings: string[] };
    expect(result.warnings.filter((warning) => warning.startsWith('worker_updated_during_run'))).toEqual([expect.stringMatching(/^worker_updated_during_run: Vibe 3\.1\.2 -> 3\.1\.3 was installed while this run was in progress/)]);
    expect(result.state).not.toBe('completed');
  }, 60_000);

  it('warns when the worker could not be re-read after a run', async () => {
    const box = await vibeBox({ versions: ['3.1.2'], initial: '3.1.2' });
    const manager = box.manager();
    await writeFile(path.join(box.environments['3.1.2']!.directory, 'scenario.json'), JSON.stringify(scenario('3.1.2', [{ op: 'hold' }])));
    const run = await (await grant(manager, box.workspace, 0))();
    await vi.waitFor(async () => expect((await manager.status({ run_id: run.run_id })).state).toBe('running'), { timeout: 10_000 });
    await rename(path.join(box.sitePackages('3.1.2'), 'mistral_vibe-3.1.2.dist-info'), path.join(box.root, 'aside'));
    await manager.close({ run_id: run.run_id });
    const result = await manager.result({ run_id: run.run_id, detail: 'full' }) as { warnings: string[] };
    expect(result.warnings.filter((warning) => warning.startsWith('worker_updated_during_run'))).toEqual([expect.stringMatching(/could not be re-read after the run \(dist-info-missing\); it may have been updated or removed/)]);
  }, 60_000);

  it('offers the authorize command again for a launch that never sent the task', async () => {
    const box = await vibeBox({ versions: ['3.1.2'], initial: '3.1.2' });
    const manager = box.manager();
    await writeFile(path.join(box.environments['3.1.2']!.directory, 'scenario.json'), JSON.stringify({ name: 'startup-failure', serverVersion: '3.1.2', startup: { exitCode: 1, stderr: 'Error: the Unified Harness runtime could not be loaded' } }));
    const finished = await (await grant(manager, box.workspace))();
    expect(finished).toMatchObject({ state: 'failed', result: { execution_state: 'not_started' } });
    const status = await manager.status({ run_id: finished.run_id }) as { next_action: string; task_authorize?: { argv: string[]; request_template: { operation: string; request: { cwd: string } } } };
    expect(status.next_action).toMatch(/never sent to the worker.*authorize the same request again/);
    expect(status.task_authorize?.argv.slice(-2)).toEqual(['--config', box.configPath]);
    expect(status.task_authorize?.request_template).toMatchObject({ operation: 'review', request: { cwd: box.workspace } });
    const full = await manager.result({ run_id: finished.run_id, detail: 'full' }) as { next_action: string; task_authorize?: { argv: string[] } };
    expect(full.next_action).toBe(status.next_action);
    expect(full.task_authorize?.argv.at(-1)).toBe(box.configPath);
    const compact = await manager.result({ run_id: finished.run_id }) as { task_authorize?: { argv: string[] } };
    expect(compact.task_authorize?.argv.at(-1)).toBe(box.configPath);
  }, 60_000);

  it('keeps the ordinary next action for a run that did start', async () => {
    const box = await vibeBox({ versions: ['3.1.2'], initial: '3.1.2' });
    const manager = box.manager();
    const finished = await (await grant(manager, box.workspace))();
    const status = await manager.status({ run_id: finished.run_id }) as { next_action: string; task_authorize?: unknown };
    expect(status.next_action).not.toMatch(/never sent/);
    expect(status.task_authorize).toBeUndefined();
  }, 60_000);
});

describe('Antigravity worker refresh at readiness', () => {
  async function agyBox(options: { recordVersion?: boolean } = {}) {
    const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-refresh-agy-')); roots.push(root);
    const workspace = path.join(root, 'workspace'); await mkdir(workspace);
    const state = path.join(root, 'state'); await mkdir(state, { mode: 0o700 });
    const agy = path.join(root, 'bin', 'agy'); await mkdir(path.dirname(agy));
    let installed = '1.5.8';
    const writeAgy = async (version: string, variant = ''): Promise<void> => { installed = version; await writeFile(`${agy}.next`, `#!/bin/sh\necho "agy ${version}"\n${variant}`, { mode: 0o755 }); await rename(`${agy}.next`, agy); };
    await writeAgy('1.5.8');
    const configPath = path.join(state, 'config.toml');
    await writeFile(configPath, `version = 1\nbackend = "antigravity"\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[experimental]\nantigravity = true\n[paths]\nantigravity = ${JSON.stringify(agy)}\n`, { mode: 0o600 });
    const config = await loadConfig({ configPath });
    vi.stubEnv('GEMINI_API_KEY', 'agy-refresh-test-key');
    const calls: RunPreparationInput[] = [];
    let recordVersion = options.recordVersion !== false;
    const prepare = async (input: RunPreparationInput) => {
      calls.push(input);
      const report = Buffer.from(JSON.stringify({ result: 'pass' }));
      const reports = path.join(input.dataDir, 'preparation-reports'); await mkdir(reports, { recursive: true, mode: 0o700 });
      const reportPath = path.join(reports, `${digest(report)}.json`);
      await writeFile(reportPath, report, { mode: 0o600 });
      await atomicWriteJson(receiptPath(input.config, input.dataDir), { schema_version: 1, result: 'passed', identity: await preparationIdentity(input.config), checked_at: new Date().toISOString(), report_sha256: digest(report), components: await preparationComponents(input.config), ...(input.origin ? { origin: input.origin } : {}), ...(input.previousWorkerVersion ? { previous_worker_version: input.previousWorkerVersion } : {}), ...(recordVersion ? { worker_version: installed } : {}) });
      return { status: 'passed' as const, candidate_sha256: 'c'.repeat(64), hosted_acceptance: 'unverified' as const, report_sha256: digest(report), report_path: reportPath, findings: [] };
    };
    await prepare({ config, configPath, dataDir: state, stderr: 'ignore' });
    calls.length = 0;
    recordVersion = true;
    const manager = new RunManager(config, path.join(root, 'data'), [new AntigravityBackend(config, { dataDir: state })], undefined, { policy: selectedConfigPolicy(configPath), preparationDataDir: state, workerRefresh: { runPreparation: prepare } });
    managers.push(manager);
    return { workspace, state, config, configPath, manager, calls, writeAgy };
  }

  it('re-prepares after an agy update and records the versions on both sides', async () => {
    const box = await agyBox();
    expect(await readiness(box.manager, box.workspace)).toMatchObject({ eligible: true, worker: { backend: 'antigravity', version: '1.5.8' } });
    await box.writeAgy('1.6.0');
    const ready = await readiness(box.manager, box.workspace, 30);
    expect(ready).toMatchObject({ eligible: true, worker: { version: '1.6.0', refreshed: { from: '1.5.8' } } });
    expect(ready.warnings).toEqual(['Antigravity CLI 1.5.8 -> 1.6.0 was refreshed automatically; no-inference preparation passed; hosted quality has not been re-run on this version.']);
    expect(box.calls).toHaveLength(1);
    expect(box.calls[0]).toMatchObject({ origin: 'automatic', previousWorkerVersion: '1.5.8' });
    expect(await readPreparationFacts(box.config, box.state)).toMatchObject({ status: { status: 'passed' }, worker_version: '1.6.0', previous_worker_version: '1.5.8' });
  }, 60_000);

  it('does not re-prepare a different agy binary that reports the same version', async () => {
    const box = await agyBox();
    await box.writeAgy('1.5.8', '# swapped\n');
    const report = await readiness(box.manager, box.workspace, 5);
    expect(codes(report)).toEqual(['VSUP_INVALID_STATE']);
    expect(report.blockers[0]!.details).toMatchObject({ preparation: { status: 'stale' }, worker_change: expect.stringMatching(/changed while its version stayed 1\.5\.8/), prepare_check: expect.stringContaining('prepare check --kit') });
    expect(box.calls).toHaveLength(0);
  }, 60_000);

  it('says so when the agy binary changed and its current version could not be read', async () => {
    const box = await agyBox();
    await box.writeAgy('1.5.8', 'exit 1\n');
    const report = await readiness(box.manager, box.workspace, 5);
    const preparation = report.blockers.find((blocker) => blocker.code === 'VSUP_INVALID_STATE');
    expect(preparation?.details).toMatchObject({ worker_change: expect.stringMatching(/current version could not be read \(the receipt recorded 1\.5\.8\)/) });
    expect(String(preparation?.details?.worker_change)).not.toMatch(/stayed/);
    expect(box.calls).toHaveLength(0);
  }, 60_000);

  it('does not re-prepare an agy change when the receipt predates the recorded version', async () => {
    const box = await agyBox({ recordVersion: false });
    await box.writeAgy('1.6.0');
    const report = await readiness(box.manager, box.workspace, 5);
    expect(codes(report)).toEqual(['VSUP_INVALID_STATE']);
    expect(report.blockers[0]!.details).toMatchObject({ worker_change: expect.stringMatching(/written before it recorded the worker version/) });
    expect(box.calls).toHaveLength(0);
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

  it('keeps a build unreadable at boot unknown for the life of the server and says so', async () => {
    const box = await plainBox();
    let reads = 0;
    const disk: { build?: string } = {};
    const manager = new RunManager(box.config, path.join(box.root, 'data'), [new IdleBackend()], undefined, { policy: selectedConfigPolicy(box.configPath), buildIdentity: async () => { reads += 1; if (disk.build === undefined) throw new Error('dist missing'); return disk.build; } });
    managers.push(manager);
    await manager.initialize();
    expect(reads).toBe(3);
    disk.build = 'c'.repeat(64);
    const report = await readiness(manager, box.workspace);
    expect(report).toMatchObject({ eligible: true, boot_drift: [], restart_required: false, candidate: { sha256: null } });
    expect(report.warnings).toEqual([expect.stringMatching(/could not be read when this server started.*restart the server to restore the check/)]);
    expect(reads).toBe(3);
    const expecting = await manager.status({ workspace: box.workspace, operation: 'review', expected_candidate: 'c'.repeat(64) }) as Readiness;
    expect(codes(expecting)).toEqual(['VSUP_INVALID_STATE']);
  });

  it('treats a build that cannot be read later as a retryable blocker, not as a restart', async () => {
    const box = await plainBox();
    let build: string | undefined = 'c'.repeat(64);
    const backend = new IdleBackend();
    const manager = new RunManager(box.config, path.join(box.root, 'data'), [backend], undefined, { policy: selectedConfigPolicy(box.configPath), buildIdentity: async () => { if (build === undefined) throw new Error('dist missing'); return build; } });
    managers.push(manager);
    expect(await readiness(manager, box.workspace)).toMatchObject({ eligible: true, candidate: { sha256: 'c'.repeat(64) } });
    const start = await grant(manager, box.workspace, 0);
    build = undefined;
    const unreadable = await readiness(manager, box.workspace);
    expect(unreadable).toMatchObject({ eligible: false, boot_drift: [], restart_required: false, candidate: { sha256: 'c'.repeat(64) } });
    expect(unreadable.blockers).toEqual([expect.objectContaining({ code: 'VSUP_INVALID_STATE', retryable: true, message: expect.stringMatching(/could not be read.*Check readiness again shortly.*restart the server if the build was replaced/), details: { reason: 'build_unreadable' } })]);
    expect(await rejection(start())).toMatchObject({ code: 'VSUP_INVALID_STATE', retryable: true, details: { reason: 'build_unreadable', attempt_consumed: false } });
    expect(backend.starts).toBe(0);
    build = 'c'.repeat(64);
    expect(await readiness(manager, box.workspace)).toMatchObject({ eligible: true, boot_drift: [] });
    expect((await start()).error).toBeUndefined();
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
