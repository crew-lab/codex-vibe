import { BUNDLED_SKILL_NAMES } from '../../src/backends/app-server/bundled-skills.js';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generatePinManifest, serializePinManifest } from '../../src/backends/app-server/pin.js';
import { workspaceDenylist } from '../../src/backends/app-server/session-config.js';
import { makeFakeVibeEnvironment } from './support/fake-vibe-environment.js';
import { makeLaunchableFakeVibe } from './support/launchable-fake-vibe.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const script = path.join(root, 'scripts', 'v2-conformance-check.mjs');
const fixture = path.join(root, 'tests', 'fixtures', 'fake-vibe-app-server.mjs');
const sentinelKey = 'fake-owner-key-0123456789abcdef';

type Json = Record<string, unknown>;

interface CheckResult {
  code: number;
  stdout: string;
  stderr: string;
  report: Json;
}

let scratch = '';

beforeEach(async () => { scratch = await mkdtemp(path.join(await realpath(tmpdir()), 'v2-conformance-test-')); });
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

function at(value: unknown, dotted: string): unknown {
  let cursor: unknown = value;
  for (const part of dotted.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function findings(report: Json): Json[] {
  return report.findings as Json[];
}

function findingIds(report: Json, severity?: string): string[] {
  return findings(report).filter((item) => severity === undefined || item.severity === severity).map((item) => String(item.id));
}

async function runCheck(args: string[], env: Record<string, string> = {}): Promise<CheckResult> {
  const dist = process.env.VIBE_SUPERVISOR_TEST_DIST;
  if (!dist) throw new Error('VIBE_SUPERVISOR_TEST_DIST is not set by the global setup');
  const output = path.join(scratch, `report-${Math.random().toString(36).slice(2)}.json`);
  const outcome = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [script, '--dist', dist, '--output', output, ...args], { env: { ...process.env, ...env }, timeout: 90_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 99) : 0;
      resolve({ code, stdout, stderr });
    });
  });
  const report = existsSync(output) ? (JSON.parse(readFileSync(output, 'utf8')) as Json) : {};
  return { ...outcome, report };
}

function workerPid(file: string): number {
  return (JSON.parse(readFileSync(file, 'utf8')) as { pid: number }).pid;
}

function grandchildPid(file: string): number {
  return (JSON.parse(readFileSync(file, 'utf8')) as { grandchild: number }).grandchild;
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function fakeLog(file: string): Promise<Json[]> {
  const text = await readFile(file, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Json);
}

async function proxyAwareFake(directory: string, attempt: 'experiments-on' | 'always' | 'subjects-only'): Promise<{ appServer: string; manifest: string }> {
  await mkdir(directory, { recursive: true });
  const scenarioFile = path.join(directory, 'scenario.json');
  await writeFile(scenarioFile, JSON.stringify({ name: 'proxy-aware' }));
  const scriptBody = [
    "const fs = require('node:fs'); const path = require('node:path'); const net = require('node:net');",
    '(async () => {',
    "  const proxy = process.env.HTTPS_PROXY;",
    `  const attempt = ${attempt === 'always' ? 'true' : attempt === 'subjects-only' ? "process.env.VIBE_EXPERIMENTS__ENABLE !== 'true'" : "process.env.VIBE_EXPERIMENTS__ENABLE === 'true' && process.env.VIBE_ENABLE_TELEMETRY === 'true'"};`,
    '  if (proxy && attempt) {',
    '    await new Promise((resolve) => {',
    '      const url = new URL(proxy);',
    "      const socket = net.connect(Number(url.port), url.hostname, () => socket.write('CONNECT experiments.example.test:443 HTTP/1.1\\r\\nHost: experiments.example.test:443\\r\\n\\r\\n'));",
    "      socket.on('data', () => socket.destroy());",
    "      socket.on('close', resolve);",
    "      socket.on('error', resolve);",
    '    });',
    '  }',
    `  const { parse } = await import(${JSON.stringify(import.meta.resolve('smol-toml'))});`,
    "  const agents = path.join(process.env.VIBE_HOME, 'agents');",
    "  const profile = parse(fs.readFileSync(path.join(agents, fs.readdirSync(agents).find((name) => name.endsWith('.toml'))), 'utf8'));",
    `  const scenario = JSON.parse(fs.readFileSync(${JSON.stringify(scenarioFile)}, 'utf8'));`,
    '  scenario.effectiveConfig = { tools: profile.tools };',
    "  const resolved = path.join(process.env.TMPDIR, 'scenario.json');",
    '  fs.writeFileSync(resolved, JSON.stringify(scenario));',
    "  process.argv.push('--scenario', resolved);",
    `  await import(${JSON.stringify(pathToFileURL(fixture).href)});`,
    '})();',
    ''
  ].join('\n');
  const fake = await makeFakeVibeEnvironment(directory, undefined, { scriptBody, interpreterTarget: process.execPath });
  const manifest = path.join(directory, 'vibe-pin-manifest.json');
  await writeFile(manifest, serializePinManifest(await generatePinManifest({ executable: fake.shim })), { mode: 0o600 });
  return { appServer: fake.shim, manifest };
}

describe('v2 conformance check against the scripted fake app-server', () => {
  it('passes both modes, sends no turn, forwards no real key and leaves nothing behind', async () => {
    const logFile = path.join(scratch, 'fake.log');
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'conformance', log: logFile, harnessSelectionSource: null, runtime: { skills: BUNDLED_SKILL_NAMES.map((name) => ({ name, source: 'plugin', scope: 'builtin', registry: null })) } } });
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer], { MISTRAL_API_KEY: sentinelKey });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^PASS 0 failing findings/);
    expect(result.report.result).toBe('pass');
    expect(findingIds(result.report, 'fail')).toEqual([]);
    expect(at(result.report, 'inference.turn_start_sent')).toBe(false);
    expect(at(result.report, 'credential_mode')).toBe('none');
    expect(at(result.report, 'pin.ok')).toBe(true);
    expect(at(result.report, 'pin.tamper_control.rejected')).toBe(true);
    expect((at(result.report, 'pin.verify_runs_ms') as number[]).length).toBe(3);
    const runs = result.report.runs as Json[];
    expect(runs.map((run) => run.mode)).toEqual(['review', 'edit']);
    for (const run of runs) {
      expect(at(run, 'handshake.version_ok')).toBe(true);
      expect(at(run, 'session_start.harness')).toBe('unified');
      expect(at(run, 'session_start.cwd_ok')).toBe(true);
      expect(at(run, 'readback.before_thinking.total')).toBe(0);
      expect(at(run, 'readback.after_thinking.total')).toBe(0);
      expect(at(run, 'thinking.after')).toBe('off');
      expect(at(run, 'observed.permission_ask_visible')).toBe(true);
      expect(((at(run, 'observed.settings') as Record<string, Json>)['experiments.enable'])?.actual).toBe(false);
      expect(at(run, 'shutdown.exited_on_eof')).toBe(true);
      expect(at(run, 'shutdown.group_gone')).toBe(true);
      expect(at(run, 'shutdown.private_directories_removed')).toBe(true);
      expect(at(run, 'shutdown.reaper.reason')).toBe('stopped');
      expect(at(run, 'stats_after.model_calls') ?? 0).toBe(0);
    }
    expect((at(runs[0], 'observed.runtime_tools') as string[])).toEqual(['read_file']);
    expect((at(runs[1], 'observed.runtime_tools') as string[])).toEqual(['edit', 'read_file', 'write_file']);
    expect(at(result.report, 'gates.permission-ask-visible-in-effective-config.config')).toBe('visible');
    expect(at(result.report, 'gates.thinking-off-effect.setting_read_back')).toBe(true);
    expect(at(result.report, 'gates.experiments-fetch-off.setting_read_back')).toBe(true);

    const log = await fakeLog(logFile);
    const frames = log.filter((entry) => entry.kind === 'frame').map((entry) => at(entry, 'frame.method'));
    expect(frames).toContain('session/start');
    expect(frames).toContain('config/model/write');
    expect(frames).not.toContain('turn/start');
    expect(log.filter((entry) => entry.kind === 'start').map((entry) => entry.hasMistralApiKey)).toEqual([false, false]);

    const text = JSON.stringify(result.report);
    expect(text).not.toContain(sentinelKey);
    expect(text).not.toContain(scratch);
    expect(text).not.toMatch(/\/(?:Users|home|private|var)\//);
    expect(alive(workerPid(fake.workerRecord))).toBe(false);
  }, 90_000);

  it('fails and terminates the group when a descendant outlives the server', async () => {
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'survivor' }, spawnGrandchild: true });
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review']);

    expect(result.code).toBe(1);
    expect(findingIds(result.report, 'fail')).toContain('process-group-survived');
    const run = (result.report.runs as Json[])[0]!;
    expect(at(run, 'shutdown.exited_on_eof')).toBe(true);
    expect(at(run, 'shutdown.forced')).toBe(true);
    expect(at(run, 'shutdown.group_gone')).toBe(true);
    expect(alive(grandchildPid(fake.workerRecord))).toBe(false);
    expect(alive(workerPid(fake.workerRecord))).toBe(false);
  }, 60_000);

  it('sends only a labelled placeholder key when asked and never echoes it', async () => {
    const logFile = path.join(scratch, 'fake.log');
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'conformance', log: logFile, harnessSelectionSource: null, runtime: { skills: BUNDLED_SKILL_NAMES.map((name) => ({ name, source: 'plugin', scope: 'builtin', registry: null })) } } });
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review', '--placeholder-key'], { MISTRAL_API_KEY: sentinelKey });

    expect(result.code, result.stderr).toBe(0);
    expect(at(result.report, 'credential_mode')).toBe('placeholder');
    expect((result.report.runs as Json[]).length).toBe(1);
    const log = await fakeLog(logFile);
    expect(log.filter((entry) => entry.kind === 'start').map((entry) => entry.hasMistralApiKey)).toEqual([true]);
    const text = JSON.stringify(result.report);
    expect(text).not.toContain(sentinelKey);
    expect(text).not.toContain('vsup-conformance-placeholder');
  }, 60_000);

  it('reports every read-back mismatch, still shuts the server down and exits non-zero', async () => {
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), {
      scenario: { name: 'mismatch', runtime: { hooksCount: 1, bypassToolPermissions: true }, effectiveConfig: { enable_telemetry: true } }
    });
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review']);

    expect(result.code).toBe(1);
    expect(result.report.result).toBe('fail');
    const paths = findings(result.report).filter((item) => item.id === 'readback-mismatch').map((item) => at(item, 'details.path'));
    expect(paths).toEqual(expect.arrayContaining(['runtime.hooksCount', 'runtime.bypassToolPermissions', 'config.enable_telemetry']));
    const run = (result.report.runs as Json[])[0]!;
    expect(at(run, 'readback.before_thinking.total')).toBeGreaterThanOrEqual(3);
    expect(at(run, 'shutdown.group_gone')).toBe(true);
    expect(at(run, 'shutdown.private_directories_removed')).toBe(true);
    expect(alive(workerPid(fake.workerRecord))).toBe(false);
    expect(at(result.report, 'gates.target-no-inference-conformance-check')).toBe('fail');
  }, 60_000);

  it('takes the executable and manifest from the selected configuration', async () => {
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'from-config' } });
    const config = path.join(scratch, 'config.toml');
    await writeFile(config, `version = 1\n\n[paths]\napp_server = ${JSON.stringify(fake.appServer)}\nvibe_pin_manifest = ${JSON.stringify(fake.manifest)}\n`, { mode: 0o600 });
    const result = await runCheck(['--config', config, '--mode', 'review']);

    expect(result.code, result.stderr).toBe(0);
    expect(result.report.result).toBe('pass');
    expect((result.report.runs as Json[]).length).toBe(1);
  }, 60_000);

  it('redacts paths and secrets that arrive through the server standard error', async () => {
    const stderr = `Traceback: File "/Users/someone/secret/vibe/main.py" and ${scratch}/inside using ${sentinelKey}`;
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'startup-failure', startup: { stderr, exitCode: 1 } } });
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review'], { MISTRAL_API_KEY: sentinelKey });

    expect(result.code).toBe(1);
    expect(findingIds(result.report, 'fail')).toContain('run-failed');
    const text = JSON.stringify(result.report);
    expect(text).toContain('Traceback');
    expect(text).not.toContain('/Users/someone');
    expect(text).not.toContain(scratch);
    expect(text).not.toContain(sentinelKey);
    expect(at((result.report.runs as Json[])[0], 'shutdown.group_gone')).toBe(true);
  }, 60_000);

  it('flags a server that reports another version', async () => {
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'version', serverVersion: '2.27.0' } });
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review']);

    expect(result.code).toBe(1);
    expect(findingIds(result.report, 'fail')).toContain('server-version-mismatch');
    expect(at((result.report.runs as Json[])[0], 'session_start')).toBeNull();
  }, 60_000);

  it('does not launch the server when the installed files differ from the manifest', async () => {
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'tampered' } });
    const manifest = JSON.parse(await readFile(fake.manifest, 'utf8')) as { files: Record<string, string> };
    const [first] = Object.keys(manifest.files).sort();
    manifest.files[first!] = 'f'.repeat(64);
    const tampered = path.join(scratch, 'tampered-manifest.json');
    await writeFile(tampered, JSON.stringify(manifest), { mode: 0o600 });
    const result = await runCheck(['--manifest', tampered, '--executable', fake.appServer]);

    expect(result.code).toBe(1);
    expect(at(result.report, 'pin.ok')).toBe(false);
    expect(findingIds(result.report, 'fail')).toContain('pin-check-failed');
    expect(result.report.runs).toEqual([]);
    expect(existsSync(fake.workerRecord)).toBe(false);
  }, 60_000);

  it('reports a credential requirement as an incomplete check, not a failure', async () => {
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'unauthorized', errors: { 'session/start': { code: 'unauthorized', message: 'missing api key' } } } });
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review']);

    expect(result.code).toBe(3);
    expect(result.report.result).toBe('incomplete');
    expect(findingIds(result.report)).toContain('credential-required-at-startup');
    expect(findingIds(result.report, 'fail')).toEqual([]);
    expect(at((result.report.runs as Json[])[0], 'blocked.kind')).toBe('credential');
    expect(at((result.report.runs as Json[])[0], 'shutdown.group_gone')).toBe(true);
    expect(alive(workerPid(fake.workerRecord))).toBe(false);
  }, 60_000);

  it('validates the network observation with a control and finds no request when experiments are off', async () => {
    const fake = await proxyAwareFake(path.join(scratch, 'fake'), 'experiments-on');
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review', '--observe-network', '--settle-ms', '200']);

    expect(result.code, result.stderr).toBe(0);
    expect(at(result.report, 'network_observation.verdict')).toBe('none-observed-control-validated');
    expect(at(result.report, 'network_observation.subject_attempts')).toEqual([]);
    expect(at(result.report, 'network_observation.control_hosts')).toEqual(['experiments.example.test']);
    expect(at(result.report, 'gates.experiments-fetch-off.network')).toBe('unverified-host-only-observation');
    expect((result.report.runs as Json[]).map((run) => run.label)).toEqual(['review', 'control-experiments-on']);
  }, 60_000);

  it('fails when the supervisor configuration still contacts the host the control contacted', async () => {
    const fake = await proxyAwareFake(path.join(scratch, 'fake'), 'always');
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review', '--observe-network', '--settle-ms', '200']);

    expect(result.code).toBe(1);
    expect(at(result.report, 'network_observation.verdict')).toBe('requests-observed');
    expect(findingIds(result.report, 'fail')).toContain('network-request-observed');
    expect(at((at(result.report, 'network_observation.subject_attempts') as Json[])[0], 'host')).toBe('experiments.example.test');
  }, 60_000);

  it('fails any subject request even when the control contacted no matching host', async () => {
    const fake = await proxyAwareFake(path.join(scratch, 'fake'), 'subjects-only');
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review', '--observe-network', '--settle-ms', '100']);
    expect(result.code).toBe(1);
    expect(at(result.report, 'network_observation.control_hosts')).toEqual([]);
    expect(findingIds(result.report, 'fail')).toContain('network-request-observed');
    expect(at(result.report, 'gates.experiments-fetch-off.network')).toBe('unverified-host-only-observation');
  }, 60_000);

  it('calls the observation inconclusive when the control sees no request', async () => {
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'quiet' } });
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review', '--observe-network', '--settle-ms', '100']);

    expect(result.code).toBe(0);
    expect(at(result.report, 'network_observation.verdict')).toBe('inconclusive-control-saw-nothing');
    expect(findingIds(result.report, 'warn')).toContain('network-method-inconclusive');
  }, 60_000);

  it('merges repeatable --excluded-glob values into the profile denylist and reads them back', async () => {
    const fake = await makeLaunchableFakeVibe(path.join(scratch, 'fake'), { scenario: { name: 'conformance', harnessSelectionSource: null, runtime: { skills: BUNDLED_SKILL_NAMES.map((name) => ({ name, source: 'plugin', scope: 'builtin', registry: null })) } } });
    const globs = ['*.tfvars', 'fixtures/private/**', '*.tfvars'];
    const result = await runCheck(['--manifest', fake.manifest, '--executable', fake.appServer, '--mode', 'review', ...globs.flatMap((glob) => ['--excluded-glob', glob])]);

    expect(result.code, result.stderr).toBe(0);
    expect(at(result.report, 'options.excluded_globs')).toEqual(['*.tfvars', 'fixtures/private/**']);
    const merged = workspaceDenylist('/conformance/workspace', ['*.tfvars', 'fixtures/private/**']).length;
    expect(merged).toBe(workspaceDenylist('/conformance/workspace').length + 3);
    const run = (result.report.runs as Json[])[0]!;
    expect(at(run, 'observed.tool_policies.read_file.denylist_entries')).toBe(merged);
    expect(at(run, 'observed.tool_policies.read_file.denylist_matches_expected')).toBe(true);
    expect(at(run, 'readback.before_thinking.total')).toBe(0);
  }, 60_000);

  it('rejects an unsafe --excluded-glob with exit code 2 before launching anything', async () => {
    const invalid = await runCheck(['--manifest', path.join(scratch, 'm.json'), '--excluded-glob', '../outside']);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain('--excluded-glob');
    const empty = await runCheck(['--manifest', path.join(scratch, 'm.json'), '--excluded-glob']);
    expect(empty.code).toBe(2);
  }, 30_000);

  it('rejects missing and unknown arguments with exit code 2', async () => {
    const missing = await runCheck([]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Usage:');
    const unknown = await runCheck(['--manifest', path.join(scratch, 'm.json'), '--frobnicate']);
    expect(unknown.code).toBe(2);
    const relative = await runCheck(['--manifest', 'relative.json']);
    expect(relative.code).toBe(2);
  }, 30_000);
});
