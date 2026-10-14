import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { verifySite, type CompatibilityManifest } from '../../src/backends/app-server/pin.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-wheel-pin-'))); directories.push(root);
  for (const name of ['vibe', 'mistralai_vibe_local_harness', 'mcp-1.28.1.dist-info']) await mkdir(path.join(root, name));
  const files = { 'vibe/source.py': 'trusted-source', 'mistralai_vibe_local_harness/native.so': 'trusted-native-bytes' };
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(root, name), data);
  await writeFile(path.join(root, 'mcp-1.28.1.dist-info', 'METADATA'), 'Name: mcp\nVersion: 1.28.1\n');
  const manifest: CompatibilityManifest = {
    format: 1, vibe_version: '2.26.1', platform: 'darwin', architecture: 'arm64', python: '3.12', source_commit: 'a'.repeat(40),
    wheel: { filename: 'fixture.whl', url: 'https://example.invalid/fixture.whl', sha256: 'b'.repeat(64) }, dependencies: { mcp: '1.28.1' },
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, createHash('sha256').update(data).digest('hex')])),
  };
  return { root, manifest };
}

describe('release-wheel byte and inventory pins', () => {
  it('verifies expected files and exact dependency versions without importing code', async () => {
    const { root, manifest } = await fixture(); expect(await verifySite(root, manifest)).toBe(2);
  });
  it('refuses modified Python and native bytes', async () => {
    for (const name of ['vibe/source.py', 'mistralai_vibe_local_harness/native.so']) {
      const { root, manifest } = await fixture(); await writeFile(path.join(root, name), 'modified');
      await expect(verifySite(root, manifest)).rejects.toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { reason: 'runtime_hash_mismatch' } });
    }
  });
  it('refuses a newly inserted runtime module even when pinned files still match', async () => {
    const { root, manifest } = await fixture(); await writeFile(path.join(root, 'vibe', 'injected.py'), 'untrusted module');
    await expect(verifySite(root, manifest)).rejects.toMatchObject({ details: { reason: 'unexpected_runtime_file' } });
  });
  it('refuses symlinked source files', async () => {
    const { root, manifest } = await fixture();
    await writeFile(path.join(root, 'other'), 'trusted-source'); await rm(path.join(root, 'vibe', 'source.py'));
    await symlink(path.join(root, 'other'), path.join(root, 'vibe', 'source.py'));
    await expect(verifySite(root, manifest)).rejects.toMatchObject({ details: { reason: 'unsafe_runtime_file' } });
  });
  it('refuses dependency version drift and duplicate installed metadata', async () => {
    const { root, manifest } = await fixture();
    await writeFile(path.join(root, 'mcp-1.28.1.dist-info', 'METADATA'), 'Name: mcp\nVersion: 1.29.0\n');
    await expect(verifySite(root, manifest)).rejects.toMatchObject({ details: { reason: 'dependency_version_mismatch' } });
    await writeFile(path.join(root, 'mcp-1.28.1.dist-info', 'METADATA'), 'Name: mcp\nVersion: 1.28.1\n');
    await mkdir(path.join(root, 'mcp-duplicate.dist-info'));
    await writeFile(path.join(root, 'mcp-duplicate.dist-info', 'METADATA'), 'Name: mcp\nVersion: 1.28.1\n');
    await expect(verifySite(root, manifest)).rejects.toMatchObject({ details: { reason: 'dependency_version_mismatch' } });
  });
  it('ignores cache files only in the dedicated bytecode directory', async () => {
    const { root, manifest } = await fixture(); await mkdir(path.join(root, 'vibe', '__pycache__'));
    await writeFile(path.join(root, 'vibe', '__pycache__', 'source.cpython-312.pyc'), 'cache');
    expect(await verifySite(root, manifest)).toBe(2);
    await writeFile(path.join(root, 'vibe', 'foreign.pyc'), 'standalone cache');
    await expect(verifySite(root, manifest)).rejects.toMatchObject({ details: { reason: 'unexpected_runtime_file' } });
  });
  it('refuses traversal in a manifest without reading an outside file', async () => {
    const { root, manifest } = await fixture(); manifest.files['../outside'] = 'a'.repeat(64);
    await expect(verifySite(root, manifest)).rejects.toMatchObject({ details: { reason: 'unsafe_manifest_path' } });
  });
});
