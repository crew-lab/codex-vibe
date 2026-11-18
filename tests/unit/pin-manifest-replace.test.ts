import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializePinManifest, type PinManifest } from '../../src/backends/app-server/pin.js';
import { replacePinManifest } from '../../src/backends/app-server/pin-replace.js';
import { pinManifestCommand } from '../../src/cli/pin.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { acquirePreparationLock } from '../../src/preparation/lock.js';
import { writePrivateFileAtomic } from '../../src/security/paths.js';
import { makeFakeVibeEnvironment } from './support/fake-vibe-environment.js';

let scratch = '';

beforeEach(async () => { scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pin-replace-'))); });
afterEach(async () => { vi.restoreAllMocks(); process.exitCode = undefined; await rm(scratch, { recursive: true, force: true }); });

const manifestFor = (version: string): PinManifest => ({ format: 1, version, record_sha256: 'a'.repeat(64), files: { 'b.py': 'b'.repeat(64), 'a.py': 'c'.repeat(64) } });
const clock = (iso: string) => () => new Date(iso);

describe('writePrivateFileAtomic', () => {
  it('writes the bytes exactly with mode 0600 and leaves no temporary file', async () => {
    const file = path.join(scratch, 'out.bin');
    const bytes = Buffer.from([0, 255, 10, 13, 128]);
    await writePrivateFileAtomic(file, bytes);
    await writePrivateFileAtomic(file, bytes);
    expect(await readFile(file)).toEqual(bytes);
    expect((await lstat(file)).mode & 0o7777).toBe(0o600);
    expect(await readdir(scratch)).toEqual(['out.bin']);
  });

  it('refuses a symlink target and a directory target', async () => {
    const real = path.join(scratch, 'real');
    await writeFile(real, 'keep');
    const link = path.join(scratch, 'link');
    await symlink(real, link);
    await expect(writePrivateFileAtomic(link, 'x')).rejects.toThrow(/regular file/);
    expect(await readFile(real, 'utf8')).toBe('keep');
    await mkdir(path.join(scratch, 'dir'));
    await expect(writePrivateFileAtomic(path.join(scratch, 'dir'), 'x')).rejects.toThrow(/regular file/);
    expect((await readdir(scratch)).sort()).toEqual(['dir', 'link', 'real']);
  });
});

describe('replacePinManifest', () => {
  const historyDirectory = () => path.join(scratch, 'pin-history');

  it('writes a first manifest without history', async () => {
    const target = path.join(scratch, 'pin.json');
    expect(await replacePinManifest(target, manifestFor('3.1.4'))).toEqual({ previousVersion: null, historyPath: null });
    expect(await readFile(target, 'utf8')).toBe(serializePinManifest(manifestFor('3.1.4')));
    await expect(readdir(historyDirectory())).rejects.toThrow();
  });

  it('keeps the newest three history files and preserves the previous bytes exactly', async () => {
    const target = path.join(scratch, 'pin.json');
    const versions = ['3.1.2', '3.1.3', '3.1.4', '3.1.5', '3.1.6'];
    const stamps = ['2026-11-18T10:15:00Z', '2026-11-18T10:16:00Z', '2026-11-18T10:17:00Z', '2026-11-18T10:18:00Z'];
    await replacePinManifest(target, manifestFor(versions[0] as string));
    const results = [];
    for (const [index, stamp] of stamps.entries()) results.push(await replacePinManifest(target, manifestFor(versions[index + 1] as string), clock(stamp)));
    expect(results[0]).toEqual({ previousVersion: '3.1.2', historyPath: path.join(historyDirectory(), 'vibe-pin-3.1.2-20261118T101500Z.json') });
    expect((await readdir(historyDirectory())).sort()).toEqual([
      'vibe-pin-3.1.3-20261118T101600Z.json',
      'vibe-pin-3.1.4-20261118T101700Z.json',
      'vibe-pin-3.1.5-20261118T101800Z.json',
    ]);
    expect(await readFile(path.join(historyDirectory(), 'vibe-pin-3.1.5-20261118T101800Z.json'), 'utf8')).toBe(serializePinManifest(manifestFor('3.1.5')));
    expect((await lstat(historyDirectory())).mode & 0o7777).toBe(0o700);
    expect((await lstat(path.join(historyDirectory(), 'vibe-pin-3.1.3-20261118T101600Z.json'))).mode & 0o7777).toBe(0o600);
    expect(await readFile(target, 'utf8')).toBe(serializePinManifest(manifestFor('3.1.6')));
  });

  it('archives an invalid previous file under unknown', async () => {
    const target = path.join(scratch, 'pin.json');
    await writeFile(target, 'not json {', { mode: 0o600 });
    const result = await replacePinManifest(target, manifestFor('3.1.4'), clock('2026-11-18T10:15:00Z'));
    expect(result.previousVersion).toBeNull();
    expect(result.historyPath).toBe(path.join(historyDirectory(), 'vibe-pin-unknown-20261118T101500Z.json'));
    expect(await readFile(result.historyPath as string, 'utf8')).toBe('not json {');
  });
});

describe('pin-manifest command', () => {
  async function setup(): Promise<{ args: string[]; output: string; stderr: string[]; fakeRecord: string; fake: string }> {
    const fake = await makeFakeVibeEnvironment(scratch);
    const config = path.join(scratch, 'config.toml');
    await writeFile(config, 'version = 1\nallowed_workspace_roots = []\n', { mode: 0o600 });
    const output = path.join(scratch, 'data', 'pin.json');
    await mkdir(path.dirname(output));
    const stderr: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write);
    return { args: ['--config', config, '--executable', fake.shim, '--output', output], output, stderr, fakeRecord: path.join(fake.distInfo, 'RECORD'), fake: fake.shim };
  }

  it('replaces with --force leaving one history file, and refuses without it', async () => {
    const { args, output } = await setup();
    await pinManifestCommand(args);
    const first = await readFile(output, 'utf8');
    await expect(pinManifestCommand(args)).rejects.toThrow(/already exists/);
    expect(await readFile(output, 'utf8')).toBe(first);
    await pinManifestCommand([...args, '--force']);
    const history = await readdir(path.join(path.dirname(output), 'pin-history'));
    expect(history).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(output), 'pin-history', history[0] as string), 'utf8')).toBe(first);
  });

  it('takes the preparation lock to replace the configured manifest and writes nothing while it is held', async () => {
    const { args, output, fake } = await setup();
    const configured = path.join(scratch, 'configured.toml');
    await writeFile(configured, `version = 1\nallowed_workspace_roots = []\n[paths]\nvibe_pin_manifest = ${JSON.stringify(output)}\n`, { mode: 0o600 });
    const configuredArgs = ['--config', configured, '--executable', fake, '--force'];
    await pinManifestCommand(configuredArgs);
    const first = await readFile(output, 'utf8');
    const held = await acquirePreparationLock({ ...DEFAULT_CONFIG, paths: { vibePinManifest: output } });
    try {
      await expect(pinManifestCommand(configuredArgs)).rejects.toThrow(/^A preparation is already running \(pid \d+\); wait for it to finish, then run pin-manifest again\.$/);
      expect(await readFile(output, 'utf8')).toBe(first);
      await expect(readdir(path.join(path.dirname(output), 'pin-history'))).rejects.toMatchObject({ code: 'ENOENT' });
      const elsewhere = path.join(scratch, 'elsewhere.json');
      await pinManifestCommand(['--config', configured, '--executable', fake, '--output', elsewhere, '--force']);
      expect(JSON.parse(await readFile(elsewhere, 'utf8'))).toMatchObject({ format: 1 });
      await writeFile(path.join(scratch, 'broken.toml'), 'not toml [', { mode: 0o600 });
      await pinManifestCommand(['--config', path.join(scratch, 'broken.toml'), ...args.slice(2), '--force']);
    } finally { await held.release(); }
    await expect(pinManifestCommand(configuredArgs)).resolves.toBeUndefined();
  });

  it('warns on stderr and still writes when a RECORD row is unhashed', async () => {
    const { args, output, stderr, fakeRecord } = await setup();
    const lines = (await readFile(fakeRecord, 'utf8')).split('\n').map((line) => (line.startsWith('_native.so,') ? '_native.so,,' : line));
    await writeFile(fakeRecord, lines.join('\n'));
    await pinManifestCommand(args);
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ format: 1 });
    expect(stderr.join('')).toMatch(/Warning: RECORD lists 1 file\(s\) without a sha256 hash \(_native\.so\)/);
  });
});
