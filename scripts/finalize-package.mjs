import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const KIT_FILES = ['PROCEDURE.md', 'manifest.json', 'v2-conformance-check.mjs'];
const MAX_KIT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CHECKSUM_FILE_BYTES = 16 * 1024;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  throw new Error(`Package finalization failed: ${message}`);
}

function runNpm(args, options) {
  const result = spawnSync('npm', args, { ...options, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000 });
  if (result.error || result.status !== 0) fail(`offline npm install failed: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
}

async function boundedRead(file, limit) {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > limit) fail(`file is unsafe or exceeds its size limit: ${path.basename(file)}`);
  const bytes = await readFile(file);
  if (bytes.byteLength > limit) fail(`file exceeds its size limit: ${path.basename(file)}`);
  return bytes;
}

async function validateKit(kitDir, expectedManifest) {
  const names = (await readdir(kitDir)).sort();
  const expectedNames = [...KIT_FILES, 'SHA256SUMS'].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) fail('preparation kit has unexpected or missing files');
  const sumsBytes = await boundedRead(path.join(kitDir, 'SHA256SUMS'), MAX_CHECKSUM_FILE_BYTES);
  const rows = sumsBytes.toString('utf8').trimEnd().split('\n');
  const found = new Map();
  for (const row of rows) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(row);
    if (!match) fail('preparation kit checksum entry is malformed');
    const [, digest, name] = match;
    if (!KIT_FILES.includes(name) || found.has(name)) fail('preparation kit checksum entry has an unsafe, unexpected, or duplicate filename');
    found.set(name, digest);
  }
  if (found.size !== KIT_FILES.length) fail('preparation kit checksum list is incomplete');
  for (const name of KIT_FILES) {
    const bytes = await boundedRead(path.join(kitDir, name), MAX_KIT_FILE_BYTES);
    if (sha256(bytes) !== found.get(name)) fail(`preparation kit checksum mismatch: ${name}`);
  }
  const manifest = JSON.parse((await boundedRead(path.join(kitDir, 'manifest.json'), MAX_KIT_FILE_BYTES)).toString('utf8'));
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) fail('preparation kit manifest does not match the packaged candidate');
}

export async function finalizePackage({ releaseDir, tarball, version, candidateSha256, scriptBytes, procedureBytes, cache, candidateIdentity, install = runNpm }) {
  if (!path.isAbsolute(cache) || !path.isAbsolute(tarball)) fail('absolute cache and tarball paths are required');
  if (!/^[a-f0-9]{64}$/.test(candidateSha256)) fail('candidate identity is invalid');
  await mkdir(releaseDir, { recursive: true, mode: 0o700 });
  const manifest = { schema_version: 1, version, candidate_sha256: candidateSha256, script_sha256: sha256(scriptBytes) };
  const kit = path.join(releaseDir, `preparation-kit-${version}`);
  await rm(kit, { recursive: true, force: true });
  await mkdir(kit, { mode: 0o700 });
  await writeFile(path.join(kit, 'v2-conformance-check.mjs'), scriptBytes, { mode: 0o600 });
  await writeFile(path.join(kit, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await writeFile(path.join(kit, 'PROCEDURE.md'), procedureBytes, { mode: 0o600 });
  const kitRows = await Promise.all(KIT_FILES.map(async (name) => `${sha256(await readFile(path.join(kit, name)))}  ${name}`));
  await writeFile(path.join(kit, 'SHA256SUMS'), `${kitRows.join('\n')}\n`, { mode: 0o600 });
  await validateKit(kit, manifest);

  const tempRoot = await mkdtemp(path.join(await os.tmpdir(), 'vibe-supervisor-package-verify-'));
  try {
    const prefix = path.join(tempRoot, 'prefix');
    const env = {
      ...process.env,
      HOME: path.join(tempRoot, 'home'),
      USERPROFILE: path.join(tempRoot, 'home'),
      npm_config_cache: cache,
      npm_config_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    };
    await mkdir(prefix, { recursive: true, mode: 0o700 });
    try {
      await install(['install', '--cache', cache, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, tarball], { cwd: prefix, env });
    } catch (error) {
      fail(`offline npm install failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const installedRoot = path.join(prefix, 'node_modules', 'vibe-supervisor');
    const installedManifest = JSON.parse((await boundedRead(path.join(installedRoot, 'package.json'), MAX_KIT_FILE_BYTES)).toString('utf8'));
    if (installedManifest.version !== version) fail('installed package version differs from the release version');
    if (await candidateIdentity(installedRoot) !== candidateSha256) fail('installed package identity differs from the preparation kit');
    const installedScript = await boundedRead(path.join(installedRoot, 'scripts', 'v2-conformance-check.mjs'), MAX_KIT_FILE_BYTES);
    if (sha256(installedScript) !== manifest.script_sha256) fail('installed conformance script differs from the preparation kit');
    await validateKit(kit, manifest);
    return { kit, kitFiles: [...KIT_FILES, 'SHA256SUMS'].map((name) => path.join(kit, name)) };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function validateKitForTest(kitDir, manifest) {
  return validateKit(kitDir, manifest);
}

export async function reportAfterValidation(validate, announce) {
  const result = await validate();
  announce(result);
  return result;
}
