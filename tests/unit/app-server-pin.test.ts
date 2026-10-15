import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PinCheckError,
  generatePinManifest,
  loadPinManifest,
  locateEnvironment,
  parsePinManifest,
  parseRecord,
  serializePinManifest,
  verifyPinnedInstall,
  type PinFailureReason,
  type PinManifest,
} from '../../src/backends/app-server/pin.js';
import { SUPPORTED_VIBE } from '../../src/backends/app-server/supported-vibe.js';

interface FakeEnvironment {
  root: string;
  site: string;
  distInfo: string;
  script: string;
  shim: string;
  rows: string[];
}

let scratch = '';

beforeEach(async () => { scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'app-server-pin-'))); });
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

const digest = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const recordHash = (data: Buffer): string => `sha256=${createHash('sha256').update(data).digest('base64url')}`;
const quote = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

async function put(file: string, content: string | Buffer, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  if (mode !== undefined) await chmod(file, mode);
}

async function writeRecord(env: FakeEnvironment, rows: readonly string[] = env.rows): Promise<void> {
  const lines: string[] = [];
  for (const relative of rows) {
    const data = await readFile(path.join(env.site, relative));
    lines.push(`${quote(relative)},${recordHash(data)},${data.length}`);
  }
  lines.push(`${path.basename(env.distInfo)}/RECORD,,`);
  lines.push('vibe/__pycache__/__init__.cpython-312.pyc,,');
  await writeFile(path.join(env.distInfo, 'RECORD'), `${lines.join('\n')}\n`);
}

async function makeEnvironment(options: { version?: string; distInfoVersion?: string; longShebang?: boolean; name?: string } = {}): Promise<FakeEnvironment> {
  const version = options.version ?? SUPPORTED_VIBE;
  const root = path.join(scratch, options.name ?? 'tools', 'mistral-vibe');
  const basePython = path.join(scratch, 'base-python', options.name ?? 'tools', 'python3.12');
  const site = path.join(root, 'lib', 'python3.12', 'site-packages');
  const distInfo = path.join(site, `mistral_vibe-${options.distInfoVersion ?? version}.dist-info`);
  await put(basePython, '', 0o755);
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await symlink(basePython, path.join(root, 'bin', 'python'));
  await put(path.join(root, 'pyvenv.cfg'), 'home = /opt/python\n');
  const python = path.join(root, 'bin', 'python');
  const shebang = options.longShebang === true ? `#!/bin/sh\n'''exec' "${python}" "$0" "$@"\n' '''\n` : `#!${python}\n`;
  const script = path.join(root, 'bin', 'vibe-app-server');
  await put(script, `${shebang}import sys\nfrom vibe.app_server import main\nsys.exit(main())\n`, 0o755);
  await put(path.join(site, 'vibe', '__init__.py'), `__version__ = "${version}"\n`);
  await put(path.join(site, 'vibe', 'app_server', '__init__.py'), 'def main():\n    return 0\n');
  await put(path.join(site, 'vibe', 'data,odd "name".txt'), 'quoted path\n');
  await put(path.join(site, '_native.so'), Buffer.from([0, 1, 2, 3, 250, 251, 252]));
  await put(path.join(site, 'vibe', '__pycache__', '__init__.cpython-312.pyc'), 'compiled');
  await put(path.join(distInfo, 'METADATA'), `Metadata-Version: 2.4\nName: mistral-vibe\nVersion: ${version}\nSummary: test\n\nLong description\nVersion: 9.9.9\n`);
  await put(path.join(distInfo, 'WHEEL'), 'Wheel-Version: 1.0\n');
  const shim = path.join(scratch, 'user-bin', options.name ?? 'tools', 'vibe-app-server');
  await mkdir(path.dirname(shim), { recursive: true });
  await symlink(script, shim);
  const env: FakeEnvironment = {
    root, site, distInfo, script, shim,
    rows: [
      'vibe/__init__.py', 'vibe/app_server/__init__.py', 'vibe/data,odd "name".txt', '_native.so',
      `${path.basename(distInfo)}/METADATA`, `${path.basename(distInfo)}/WHEEL`, '../../../bin/vibe-app-server',
    ],
  };
  await writeRecord(env);
  return env;
}

async function failure(promise: Promise<unknown>): Promise<PinCheckError> {
  try { await promise; } catch (error) {
    expect(error).toBeInstanceOf(PinCheckError);
    return error as PinCheckError;
  }
  throw new Error('expected a PinCheckError');
}

async function expectReason(promise: Promise<unknown>, reason: PinFailureReason): Promise<PinCheckError> {
  const error = await failure(promise);
  expect(error.reason).toBe(reason);
  return error;
}

describe('environment location', () => {
  it('finds the environment from a symlinked console script', async () => {
    const env = await makeEnvironment();
    const located = await locateEnvironment(env.shim);
    expect(located).toEqual({ environmentRoot: env.root, executable: env.script, sitePackages: env.site, distInfo: env.distInfo, version: SUPPORTED_VIBE });
  });

  it('accepts the long-shebang form pip writes for deep paths', async () => {
    const env = await makeEnvironment({ longShebang: true });
    expect((await locateEnvironment(env.script)).environmentRoot).toBe(env.root);
  });

  it('rejects a relative or missing executable', async () => {
    await expectReason(locateEnvironment('vibe-app-server'), 'executable-invalid');
    const missing = await expectReason(locateEnvironment(path.join(scratch, 'absent')), 'executable-missing');
    expect(missing.code).toBe('VSUP_VIBE_NOT_FOUND');
  });

  it('rejects scripts whose first line is not an absolute interpreter path', async () => {
    const env = await makeEnvironment();
    const python = path.join(env.root, 'bin', 'python');
    for (const first of ['#!/usr/bin/env python3', 'import sys', '#!python', `#!${python} -u`, '#!/bin/sh']) {
      await writeFile(env.script, `${first}\nprint(1)\n`);
      await expectReason(locateEnvironment(env.script), 'shebang-unsupported');
    }
    await writeFile(env.script, `#!${path.join(env.root, 'bin', 'ruby')}\n`);
    await expectReason(locateEnvironment(env.script), 'shebang-unsupported');
    await writeFile(env.script, `#!${env.root}/../mistral-vibe/bin/python\n`);
    await expectReason(locateEnvironment(env.script), 'shebang-unsupported');
  });

  it('rejects a script that is not a regular file', async () => {
    const env = await makeEnvironment();
    await expectReason(locateEnvironment(path.dirname(env.script)), 'shebang-unreadable');
  });

  it('rejects a missing interpreter, a non-virtualenv interpreter and a script from another environment', async () => {
    const env = await makeEnvironment();
    await writeFile(env.script, `#!${path.join(scratch, 'nowhere', 'bin', 'python')}\n`);
    await expectReason(locateEnvironment(env.script), 'interpreter-missing');

    const other = await makeEnvironment({ name: 'other' });
    const foreign = path.join(scratch, 'foreign-bin', 'vibe-app-server');
    await put(foreign, `#!${path.join(other.root, 'bin', 'python')}\n`, 0o755);
    await expectReason(locateEnvironment(foreign), 'environment-mismatch');

    await rm(path.join(other.root, 'pyvenv.cfg'));
    await expectReason(locateEnvironment(other.script), 'environment-unsupported');
  });

  it('requires exactly one dist-info', async () => {
    const env = await makeEnvironment();
    await expectReason(locateEnvironment(env.script, '2.26.0'), 'version-mismatch');
    await put(path.join(env.site, 'mistral_vibe-2.26.0.dist-info', 'METADATA'), 'Version: 2.26.0\n');
    await expectReason(locateEnvironment(env.script), 'dist-info-ambiguous');
    await rm(env.site, { recursive: true });
    await mkdir(env.site, { recursive: true });
    await expectReason(locateEnvironment(env.script), 'dist-info-missing');
  });

  it('requires the directory version and the METADATA version to equal the pin', async () => {
    const wrongName = await makeEnvironment({ distInfoVersion: '2.26.0', name: 'wrong-name' });
    const nameError = await expectReason(locateEnvironment(wrongName.script), 'version-mismatch');
    expect(nameError.code).toBe('VSUP_VIBE_VERSION_UNSUPPORTED');
    expect(nameError.details).toMatchObject({ directory: '2.26.0', expected: SUPPORTED_VIBE });

    const wrongMetadata = await makeEnvironment({ name: 'wrong-metadata' });
    await writeFile(path.join(wrongMetadata.distInfo, 'METADATA'), 'Name: mistral-vibe\nVersion: 2.26.1.post1\n');
    await expectReason(locateEnvironment(wrongMetadata.script), 'version-mismatch');

    const duplicated = await makeEnvironment({ name: 'duplicated' });
    await writeFile(path.join(duplicated.distInfo, 'METADATA'), 'Version: 2.26.1\nVersion: 2.26.1\n');
    await expectReason(locateEnvironment(duplicated.script), 'version-unreadable');

    const unreadable = await makeEnvironment({ name: 'no-metadata' });
    await rm(path.join(unreadable.distInfo, 'METADATA'));
    await expectReason(locateEnvironment(unreadable.script), 'version-unreadable');
  });

  it('honours the version header only, not later body lines', async () => {
    const env = await makeEnvironment();
    expect((await locateEnvironment(env.script)).version).toBe(SUPPORTED_VIBE);
  });
});

describe('RECORD parsing', () => {
  it('handles quoting, CRLF and the three-field shape', () => {
    expect(parseRecord('a/b.py,sha256=x,3\r\n"c,d.py",,\r\n"q ""x"".py",sha256=y,1\n')).toEqual([
      { path: 'a/b.py', hash: 'sha256=x', size: '3' },
      { path: 'c,d.py', hash: '', size: '' },
      { path: 'q "x".py', hash: 'sha256=y', size: '1' },
    ]);
  });

  it('rejects malformed rows', () => {
    expect(() => parseRecord('a,b\n')).toThrow(PinCheckError);
    expect(() => parseRecord('"a,b,c\n')).toThrow(PinCheckError);
  });
});

describe('manifest format', () => {
  it('round-trips through serialization and a bounded file read', async () => {
    const env = await makeEnvironment();
    const manifest = await generatePinManifest({ executable: env.shim });
    expect(manifest.version).toBe(SUPPORTED_VIBE);
    expect(Object.keys(manifest.files).sort()).toEqual([...env.rows].sort());
    expect(manifest.files['_native.so']).toBe(digest(Buffer.from([0, 1, 2, 3, 250, 251, 252])));
    expect(Object.keys(manifest.files).some((key) => key.endsWith('/RECORD') || key.endsWith('.pyc'))).toBe(false);
    const file = path.join(scratch, 'manifest.json');
    await writeFile(file, serializePinManifest(manifest));
    expect(await loadPinManifest(file)).toEqual(manifest);
  });

  it('rejects invalid manifests with a typed reason', async () => {
    const good = { format: 1, version: SUPPORTED_VIBE, record_sha256: 'a'.repeat(64), files: { 'vibe/x.py': 'b'.repeat(64) } };
    expect(parsePinManifest(JSON.stringify(good))).toEqual(good);
    const bad: unknown[] = [
      { ...good, format: 2 }, { ...good, extra: true }, { ...good, record_sha256: 'ABC' },
      { ...good, files: { 'vibe/x.py': 'short' } }, { ...good, files: [] }, { version: SUPPORTED_VIBE }, 'text', null,
    ];
    for (const value of bad) {
      expect(() => parsePinManifest(JSON.stringify(value))).toThrow(expect.objectContaining({ reason: 'manifest-invalid' }));
    }
    expect(() => parsePinManifest('{')).toThrow(expect.objectContaining({ reason: 'manifest-invalid' }));
    await expectReason(loadPinManifest(path.join(scratch, 'absent.json')), 'manifest-unreadable');
    const big = path.join(scratch, 'big.json');
    await writeFile(big, serializePinManifest(good));
    await expectReason(loadPinManifest(big, { maxManifestBytes: 10 }), 'manifest-unreadable');
  });
});

describe('verification of the installed wheel', () => {
  let env: FakeEnvironment;
  let manifest: PinManifest;

  beforeEach(async () => {
    env = await makeEnvironment();
    manifest = await generatePinManifest({ executable: env.shim });
  });

  it('accepts the exact installation and reports counts', async () => {
    const pinned = await verifyPinnedInstall({ executable: env.shim, manifest });
    expect(pinned).toMatchObject({ environmentRoot: env.root, version: SUPPORTED_VIBE, fileCount: env.rows.length, recordSha256: manifest.record_sha256 });
    expect(pinned.totalBytes).toBeGreaterThan(0);
    const file = path.join(scratch, 'manifest.json');
    await writeFile(file, serializePinManifest(manifest));
    expect((await verifyPinnedInstall({ executable: env.shim, manifestPath: file })).fileCount).toBe(env.rows.length);
  });

  it('requires a manifest', async () => {
    await expect(verifyPinnedInstall({ executable: env.shim })).rejects.toThrow(TypeError);
  });

  it('ignores compiled bytecode under __pycache__', async () => {
    await put(path.join(env.site, 'vibe', '__pycache__', 'later.cpython-312.pyc'), 'other');
    await writeFile(path.join(env.site, 'vibe', '__pycache__', '__init__.cpython-312.pyc'), 'recompiled');
    await verifyPinnedInstall({ executable: env.shim, manifest });
  });

  it('fails on a manifest for another version or a drifted RECORD', async () => {
    const other = await expectReason(verifyPinnedInstall({ executable: env.shim, manifest: { ...manifest, version: '2.26.0' } }), 'manifest-version-mismatch');
    expect(other.code).toBe('VSUP_VIBE_VERSION_UNSUPPORTED');
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest, expectedVersion: '2.27.0' }), 'version-mismatch');
    await writeFile(path.join(env.distInfo, 'RECORD'), `${await readFile(path.join(env.distInfo, 'RECORD'), 'utf8')}vibe/planted.py,,\n`);
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'record-mismatch');
  });

  it('fails on an unreadable, empty, or malformed RECORD', async () => {
    const record = path.join(env.distInfo, 'RECORD');
    await writeFile(record, '');
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'record-malformed');
    await writeFile(record, 'vibe/__init__.py,sha256=x\n');
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'record-malformed');
    await writeFile(record, Buffer.from([0xff, 0xfe, 0x00]));
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'record-malformed');
    await rm(record);
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'record-unreadable');
  });

  it('fails on RECORD paths that escape the environment or are not normalized', async () => {
    const record = path.join(env.distInfo, 'RECORD');
    for (const row of ['../../../../../etc/passwd,,', '/etc/passwd,,', 'vibe//x.py,,', 'vibe/./x.py,,', 'vibe\\x.py,,', 'vibe/__init__.py,,\nvibe/__init__.py,,']) {
      await writeFile(record, `${row}\n`);
      const error = await failure(verifyPinnedInstall({ executable: env.shim, manifest }));
      expect(['record-malformed', 'file-unsafe']).toContain(error.reason);
    }
    await writeFile(record, '../../../../../etc/passwd,,\n');
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'file-unsafe');
  });

  it('fails on a modified file and names it', async () => {
    await writeFile(path.join(env.site, 'vibe', 'app_server', '__init__.py'), 'def main():\n    return 1\n');
    const error = await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'file-mismatch');
    expect(error.details).toEqual({ mismatched: { paths: ['vibe/app_server/__init__.py'], total: 1 } });
  });

  it('fails on a modified console script', async () => {
    await writeFile(env.script, `${await readFile(env.script, 'utf8')}print("tamper")\n`);
    const error = await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'file-mismatch');
    expect(error.details).toEqual({ mismatched: { paths: ['../../../bin/vibe-app-server'], total: 1 } });
  });

  it('fails on a missing file', async () => {
    await rm(path.join(env.site, '_native.so'));
    const error = await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'file-missing');
    expect(error.details).toEqual({ missing: { paths: ['_native.so'], total: 1 } });
  });

  it('fails on a file the manifest pins but RECORD no longer lists', async () => {
    const withExtraPin = { ...manifest, files: { ...manifest.files, 'vibe/ghost.py': 'c'.repeat(64) } };
    const error = await expectReason(verifyPinnedInstall({ executable: env.shim, manifest: withExtraPin }), 'file-missing');
    expect(error.details).toEqual({ missing: { paths: ['vibe/ghost.py'], total: 1 } });
  });

  it('fails on a file RECORD lists that the manifest does not pin', async () => {
    await put(path.join(env.site, 'vibe', 'added.py'), 'x = 1\n');
    await writeRecord(env, [...env.rows, 'vibe/added.py']);
    const record = await readFile(path.join(env.distInfo, 'RECORD'));
    const error = await expectReason(verifyPinnedInstall({ executable: env.shim, manifest: { ...manifest, record_sha256: digest(record) } }), 'file-extra');
    expect(error.details).toEqual({ extra: { paths: ['vibe/added.py'], total: 1 } });
  });

  it('fails on an unlisted file inside a covered directory', async () => {
    for (const planted of ['vibe/planted.py', 'vibe/app_server/sitecustomize.py', 'vibe/legacy.pyc', 'mistral_vibe-2.26.1.dist-info/entry_points.txt']) {
      await put(path.join(env.site, planted), 'import os\n');
      const error = await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'file-extra');
      expect(error.details).toEqual({ extra: { paths: [planted], total: 1 } });
      await rm(path.join(env.site, planted));
    }
  });

  it('fails on a symlink replacing a pinned file or a covered directory', async () => {
    const target = path.join(scratch, 'elsewhere.py');
    await writeFile(target, '__version__ = "2.26.1"\n');
    const file = path.join(env.site, 'vibe', '__init__.py');
    await rm(file);
    await symlink(target, file);
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'file-unsafe');
    await rm(file);
    await writeFile(file, `__version__ = "${SUPPORTED_VIBE}"\n`);

    const elsewhere = path.join(scratch, 'elsewhere-dir');
    await mkdir(elsewhere);
    await writeFile(path.join(elsewhere, '__init__.py'), 'def main():\n    return 0\n');
    await rm(path.join(env.site, 'vibe', 'app_server'), { recursive: true });
    await symlink(elsewhere, path.join(env.site, 'vibe', 'app_server'));
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'file-unsafe');
  });

  it('fails when the script is not covered by RECORD', async () => {
    const rows = env.rows.filter((row) => !row.endsWith('vibe-app-server'));
    await writeRecord(env, rows);
    const record = await readFile(path.join(env.distInfo, 'RECORD'));
    const files = Object.fromEntries(Object.entries(manifest.files).filter(([key]) => !key.endsWith('vibe-app-server')));
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest: { ...manifest, record_sha256: digest(record), files } }), 'script-unlisted');
  });

  it('caps the listed paths in the error details', async () => {
    for (let index = 0; index < 30; index += 1) await put(path.join(env.site, 'vibe', `planted-${String(index).padStart(2, '0')}.py`), 'x\n');
    const error = await expectReason(verifyPinnedInstall({ executable: env.shim, manifest }), 'file-extra');
    expect((error.details.extra as { paths: string[]; total: number }).total).toBe(30);
    expect((error.details.extra as { paths: string[] }).paths).toHaveLength(20);
  });

  it('enforces the file count and byte bounds', async () => {
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest, limits: { maxFiles: 3 } }), 'limit-exceeded');
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest, limits: { maxFileBytes: 8 } }), 'limit-exceeded');
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest, limits: { maxTotalBytes: 100 } }), 'limit-exceeded');
    await expectReason(verifyPinnedInstall({ executable: env.shim, manifest, limits: { maxRecordBytes: 50 } }), 'limit-exceeded');
    await expect(verifyPinnedInstall({ executable: env.shim, manifest, limits: { maxFiles: 0 } })).rejects.toThrow(RangeError);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(verifyPinnedInstall({ executable: env.shim, manifest, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('manifest generation', () => {
  it('refuses to pin an installation that has unlisted files', async () => {
    const env = await makeEnvironment();
    await put(path.join(env.site, 'vibe', 'planted.py'), 'x\n');
    await expectReason(generatePinManifest({ executable: env.shim }), 'file-extra');
  });

  it('refuses to pin the wrong version', async () => {
    const env = await makeEnvironment({ version: '2.27.0' });
    await expectReason(generatePinManifest({ executable: env.shim }), 'version-mismatch');
    expect((await generatePinManifest({ executable: env.shim, expectedVersion: '2.27.0' })).version).toBe('2.27.0');
  });
});
