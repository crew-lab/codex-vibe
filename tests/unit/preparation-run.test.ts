import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digest } from '../../src/acceptance/schema.js';
import { prepareCommand } from '../../src/cli/prepare.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { candidateIdentity, packageRoot, preparationIdentity, readPreparationFacts, receiptPath } from '../../src/preparation/evidence.js';
import { acquirePreparationLock } from '../../src/preparation/lock.js';
import { runPreparation } from '../../src/preparation/run.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const PASSING_CHILD = `import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const output = process.argv[process.argv.indexOf('--output') + 1];
writeFileSync(fileURLToPath(new URL('./child.json', import.meta.url)), JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
writeFileSync(output, JSON.stringify({ result: 'pass', network_observation: { verdict: 'none-observed-control-validated' }, findings: [] }), { mode: 0o600 });
`;
const HANGING_CHILD = `import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
writeFileSync(fileURLToPath(new URL('./child.pid', import.meta.url)), String(process.pid));
setInterval(() => undefined, 1000);
`;

async function fixture(childSource: string) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'preparation-run-')); roots.push(root);
  const manifest = path.join(root, 'pin-manifest.json');
  await writeFile(manifest, JSON.stringify({ format: 1, version: '3.2.0', record_sha256: 'd'.repeat(64), files: {} }), { mode: 0o600 });
  const configPath = path.join(root, 'config.toml');
  await writeFile(configPath, `version = 1\n\n[paths]\nvibe_pin_manifest = ${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  const script = path.join(root, 'stand-in.mjs');
  await writeFile(script, childSource, { mode: 0o600 });
  const config = { ...DEFAULT_CONFIG, paths: { vibePinManifest: manifest } };
  return { root, manifest, configPath, script, config };
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not reached');
}

describe('runPreparation', () => {
  it('writes the passed receipt with its saved report, and the refresh facts when given', async () => {
    const { root, configPath, script, config } = await fixture(PASSING_CHILD);
    const seen: { identity: string; candidate: string }[] = [];
    const result = await runPreparation({ config, configPath, dataDir: root, stderr: 'ignore', conformanceScript: script, origin: 'automatic', previousWorkerVersion: '3.1.2', beforeFinalReceipt: async (written) => { seen.push(written); } });
    expect(result).toMatchObject({ status: 'passed', hosted_acceptance: 'unverified', findings: [] });
    const receipt = JSON.parse(await readFile(receiptPath(config), 'utf8')) as Record<string, unknown>;
    expect(receipt).toMatchObject({ schema_version: 1, result: 'passed', identity: await preparationIdentity(config), report_sha256: result.report_sha256, origin: 'automatic', previous_worker_version: '3.1.2' });
    expect(seen).toEqual([{ identity: receipt.identity, candidate: result.candidate_sha256 }]);
    expect(digest(await readFile(result.report_path))).toBe(result.report_sha256);
    const child = JSON.parse(await readFile(path.join(root, 'child.json'), 'utf8')) as { argv: string[]; env: Record<string, string> };
    expect(child.argv).toEqual(['--dist', path.join(packageRoot, 'dist'), '--config', configPath, '--manifest', config.paths.vibePinManifest, '--placeholder-key', '--observe-network', '--output', expect.stringMatching(/conformance\.json$/)]);
    expect(Object.keys(child.env).filter((key) => !key.startsWith('__CF')).sort()).toEqual(['HOME', 'PATH', 'TMPDIR']);
    expect(child.env.TMPDIR).toBe(child.env.HOME);
    expect(await readPreparationFacts(config)).toMatchObject({ status: { status: 'passed' }, interrupted: false, origin: 'automatic', previous_worker_version: '3.1.2' });
  });

  it('writes no refresh facts for a manual run that does not name them', async () => {
    const { root, configPath, script, config } = await fixture(PASSING_CHILD);
    await runPreparation({ config, configPath, dataDir: root, stderr: 'ignore', conformanceScript: script });
    const receipt = JSON.parse(await readFile(receiptPath(config), 'utf8')) as Record<string, unknown>;
    expect(receipt).not.toHaveProperty('origin');
    expect(receipt).not.toHaveProperty('previous_worker_version');
  });

  it('refuses a previous worker version the receipt could not hold before writing anything', async () => {
    const { root, configPath, script, config } = await fixture(PASSING_CHILD);
    await expect(runPreparation({ config, configPath, dataDir: root, stderr: 'ignore', conformanceScript: script, previousWorkerVersion: '9'.repeat(65) })).rejects.toThrow();
    await expect(stat(receiptPath(config))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the placeholder when the check is refused before the final receipt', async () => {
    const { root, configPath, script, config } = await fixture(PASSING_CHILD);
    await expect(runPreparation({ config, configPath, dataDir: root, stderr: 'ignore', conformanceScript: script, beforeFinalReceipt: async () => { throw new Error('Candidate or configuration changed during check'); } })).rejects.toThrow(/changed during check/);
    expect(await readPreparationFacts(config)).toMatchObject({ status: { status: 'failed' }, interrupted: true });
  });

  it('ends the child on abort and leaves a placeholder the facts report as interrupted', async () => {
    const { root, configPath, script, config } = await fixture(HANGING_CHILD);
    const controller = new AbortController();
    const pidFile = path.join(root, 'child.pid');
    const running = runPreparation({ config, configPath, dataDir: root, stderr: 'ignore', conformanceScript: script, signal: controller.signal, origin: 'automatic' });
    await waitFor(() => stat(pidFile).then(() => true, () => false));
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await readPreparationFacts(config)).toMatchObject({ status: { status: 'failed' }, interrupted: true, origin: 'automatic' });
  });
});

describe('runPreparation endings that are not an abort', () => {
  it('stops a check that runs past its limit and records a finished failure that names the timeout', async () => {
    const { root, configPath, script, config } = await fixture(HANGING_CHILD);
    const result = await runPreparation({ config, configPath, dataDir: root, stderr: 'ignore', conformanceScript: script, conformanceTimeoutMs: 300 });
    expect(result).toMatchObject({ status: 'failed', findings: [{ code: 'conformance_timeout', message: expect.stringMatching(/within 0 seconds|within \d+ seconds/) }] });
    const pid = Number(await readFile(path.join(root, 'child.pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await readPreparationFacts(config)).toMatchObject({ status: { status: 'failed' }, interrupted: false, worker_version: '3.2.0' });
  });

  it('records a finished failure when the check exits without a report', async () => {
    const { root, configPath, script, config } = await fixture('process.exitCode = 3;\n');
    const result = await runPreparation({ config, configPath, dataDir: root, stderr: 'ignore', conformanceScript: script });
    expect(result).toMatchObject({ status: 'failed', findings: [{ code: 'conformance_no_report', message: expect.stringContaining('exit code 3') }] });
    expect(await readPreparationFacts(config)).toMatchObject({ status: { status: 'failed' }, interrupted: false });
  });
});

describe('preparation lock', () => {
  it('creates its private directory when the data directory does not exist yet', async () => {
    const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'preparation-lock-')); roots.push(root);
    const dataDir = path.join(root, 'not-yet', 'data');
    const config = { ...DEFAULT_CONFIG, backend: 'antigravity' as const, paths: { antigravity: '/unused/agy' }, experimental: { antigravity: true } };
    const lock = await acquirePreparationLock(config, dataDir);
    try {
      expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
      expect(lock.path).toBe(path.join(dataDir, 'preparation.lock'));
    } finally { await lock.release(); }
  });

  it('names the preparation lock, not the supervisor lock, when it is malformed', async () => {
    const { root, config } = await fixture(PASSING_CHILD);
    const file = path.join(root, 'preparation.lock');
    await writeFile(file, 'not a lock', { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    const error = await acquirePreparationLock(config, root).then(() => undefined, (failure: unknown) => failure as Error);
    expect(error?.message).toBe(`The lock ${file} is malformed; delete it when no preparation or re-pin is running, then retry.`);
    expect(error?.message).not.toMatch(/supervisor/);
  });
});

describe('prepare check', () => {
  it('refuses with one line while another preparation holds the lock', async () => {
    const { root, configPath, config } = await fixture(PASSING_CHILD);
    const kit = path.join(root, 'kit'); await mkdir(kit, { mode: 0o700 });
    const script = path.join(kit, 'v2-conformance-check.mjs');
    await copyFile(path.join(packageRoot, 'scripts/v2-conformance-check.mjs'), script);
    await writeFile(path.join(kit, 'manifest.json'), JSON.stringify({ schema_version: 1, version: 'fixture', candidate_sha256: await candidateIdentity(), script_sha256: digest(await readFile(script)) }), { mode: 0o600 });
    const held = await acquirePreparationLock(config, root);
    try {
      await expect(prepareCommand(['check', '--kit', kit, '--config', configPath])).rejects.toThrow(new RegExp(`^A preparation is already running \\(pid ${process.pid}\\); wait for it to finish, then run prepare check again\\.$`));
      await expect(stat(receiptPath(config))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await held.release(); }
  });
});
