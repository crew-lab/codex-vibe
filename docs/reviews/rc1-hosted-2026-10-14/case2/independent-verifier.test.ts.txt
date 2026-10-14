import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repositoryRoot = process.cwd();
const validSha = '0123456789abcdef0123456789abcdef01234567';
const otherSha = 'abcdef0123456789abcdef0123456789abcdef01';
const workflowSource = readFileSync(path.join(repositoryRoot, '.github/workflows/rollback.yml'), 'utf8');
const workflow = parse(workflowSource) as {
  jobs: { rollback: { steps: Array<{ name?: string; run?: string; env?: Record<string, string> }> } };
};
const steps = workflow.jobs.rollback.steps;

function step(name: string) {
  const selected = steps.find((candidate) => candidate.name === name);
  if (!selected?.run) throw new Error(`Rollback workflow step with a run field not found: ${name}`);
  return selected;
}

const validateStep = step('Validate requested release SHA');
const downloadStep = step('Download and verify prior release');
const provenanceStep = step('Verify unpacked release provenance');

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function bounded(value: string) {
  return value.slice(0, 2000);
}

type RunResult = {
  step: string;
  command: string;
  commandBytes: number;
  commandSha256: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function makeHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'garnebo-rollback-workflow-'));
  const binDir = path.join(root, 'bin');
  const artifactDir = path.join(root, 'release-artifact');
  const releaseDir = path.join(artifactDir, 'release');
  const fixtureDir = path.join(root, 'fixtures');
  const marker = path.join(root, 'tar-invoked');
  const resultPath = path.join(root, 'fixture-results.json');
  const scriptsDir = path.join(root, 'scripts');
  const realTar = execFileSync('which', ['tar'], { encoding: 'utf8' }).trim();

  await Promise.all([mkdir(binDir, { recursive: true }), mkdir(fixtureDir, { recursive: true }), mkdir(scriptsDir, { recursive: true })]);
  await copyFile(path.join(repositoryRoot, 'scripts/verify-release.mjs'), path.join(scriptsDir, 'verify-release.mjs'));
  await writeFile(path.join(binDir, 'aws'), [
    '#!/bin/bash',
    'set -e',
    'if [[ "$1" != "s3" || "$2" != "cp" ]]; then echo "unexpected aws invocation" >&2; exit 91; fi',
    'case "$3" in',
    '  "s3://fixture-bucket/releases/$RELEASE_SHA/site.tar.gz") cp "$FIXTURE_ARCHIVE" "$4" ;;',
    '  "s3://fixture-bucket/releases/$RELEASE_SHA/site.tar.gz.sha256") cp "$FIXTURE_CHECKSUM" "$4" ;;',
    '  *) echo "unexpected release object key: $3" >&2; exit 92 ;;',
    'esac',
  ].join('\n'), { mode: 0o755 });
  await writeFile(path.join(binDir, 'tar'), [
    '#!/bin/bash',
    'set -e',
    'printf invoked >> "$TAR_MARKER"',
    `exec "${realTar}" "$@"`,
  ].join('\n'), { mode: 0o755 });

  const results: RunResult[] = [];
  let currentSha = validSha;
  const envValues = {
    '${{ github.workspace }}': root,
    '${{ inputs.release_sha }}': validSha,
    '${{ vars.AWS_RELEASES_BUCKET }}': 'fixture-bucket',
  };

  function expand(value: string) {
    return Object.entries(envValues).reduce((result, [expression, replacement]) => result.replaceAll(expression, replacement), value);
  }

  function stepEnvironment(selected: ReturnType<typeof step>) {
    return Object.fromEntries(Object.entries(selected.env ?? {}).map(([key, value]) => [key, expand(value)]));
  }

  function run(selected: ReturnType<typeof step>, extraEnv: Record<string, string> = {}): RunResult {
    const command = selected.run!;
    const commandBytes = Buffer.byteLength(command, 'utf8');
    const execution = spawnSync('bash', ['-e', '-c', command], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...stepEnvironment(selected),
        RELEASE_SHA: currentSha,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        FIXTURE_ARCHIVE: path.join(fixtureDir, 'archive.tar.gz'),
        FIXTURE_CHECKSUM: path.join(fixtureDir, 'archive.tar.gz.sha256'),
        TAR_MARKER: marker,
        ...extraEnv,
      },
    });
    const result = {
      step: selected.name ?? 'unnamed step',
      command,
      commandBytes,
      commandSha256: sha256(Buffer.from(command, 'utf8')),
      exitCode: execution.status,
      stdout: bounded(execution.stdout ?? ''),
      stderr: bounded(execution.stderr ?? ''),
    };
    results.push(result);
    return result;
  }

  async function writeFixture(options: {
    archive?: Buffer;
    checksum?: string;
    checksumFromGeneratedArchive?: boolean;
  } = {}) {
    const payloadDir = path.join(root, 'payload');
    const wellKnownDir = path.join(payloadDir, '.well-known');
    await mkdir(wellKnownDir, { recursive: true });
    const payload = Buffer.from('small rollback fixture\n');
    const inventory = `${sha256(payload)}  index.html\n`;
    const manifest = `${JSON.stringify({
      schemaVersion: 1,
      sourceSha: validSha,
      inventory: {
        path: '.well-known/garnebo-file-checksums.txt',
        sha256: sha256(inventory),
        algorithm: 'sha256',
        excludedPaths: ['.well-known/garnebo-deployment.json', '.well-known/garnebo-file-checksums.txt'],
      },
    }, null, 2)}\n`;
    await writeFile(path.join(payloadDir, 'index.html'), payload);
    await writeFile(path.join(wellKnownDir, 'garnebo-file-checksums.txt'), inventory);
    await writeFile(path.join(wellKnownDir, 'garnebo-deployment.json'), manifest);
    const generatedArchive = path.join(fixtureDir, 'generated.tar.gz');
    execFileSync(realTar, ['-czf', generatedArchive, '-C', payloadDir, '.']);
    const originalArchive = await readFile(generatedArchive);
    const archive = options.archive ?? originalArchive;
    await writeFile(path.join(fixtureDir, 'archive.tar.gz'), archive);
    const producerRecord = `__ARCHIVE_SHA256__  garnebo-site-${validSha}.tar.gz\n`;
    const checksumSource = options.checksumFromGeneratedArchive ? originalArchive : archive;
    await writeFile(
      path.join(fixtureDir, 'archive.tar.gz.sha256'),
      (options.checksum ?? producerRecord).replaceAll('__ARCHIVE_SHA256__', sha256(checksumSource)),
    );
  }

  async function runDownload(sha = validSha) {
    currentSha = sha;
    return run(downloadStep, { RELEASE_SHA: sha });
  }

  async function unchangedDestination() {
    const entries = await readdir(releaseDir, { withFileTypes: true });
    expect(entries.map((entry) => entry.name)).toEqual([]);
  }

  async function finish(caseName: string) {
    let markerContents: string | null = null;
    try {
      markerContents = await readFile(marker, 'utf8');
    } catch {
      // A missing marker proves tar was not invoked.
    }
    const fixtureResult = {
      caseName,
      workflowSha256: sha256(workflowSource),
      tarInvoked: markerContents !== null,
      tarMarker: markerContents,
      commands: results,
    };
    const serialized = `${JSON.stringify(fixtureResult, null, 2)}\n`;
    await writeFile(resultPath, serialized);
    if (process.env.ROLLBACK_EVIDENCE_DIR) {
      const evidenceDir = path.resolve(process.env.ROLLBACK_EVIDENCE_DIR);
      await mkdir(evidenceDir, { recursive: true });
      const filename = `${caseName.replace(/[^a-z0-9-]+/gi, '-')}.json`;
      await writeFile(path.join(evidenceDir, filename), serialized);
    }
    return readFile(resultPath, 'utf8');
  }

  return { root, fixtureDir, marker, releaseDir, run, runDownload, writeFixture, unchangedDestination, finish, results };
}

async function withHarness(caseName: string, test: (harness: Awaited<ReturnType<typeof makeHarness>>) => Promise<void>) {
  const harness = await makeHarness();
  try {
    await test(harness);
  } finally {
    await harness.finish(caseName);
    await rm(harness.root, { recursive: true, force: true });
  }
}

describe('rollback release artifact workflow', () => {
  it('accepts only a full lowercase 40-character release SHA', async () => {
    await withHarness('sha-validation', async ({ run }) => {
      const valid = run(validateStep, { RELEASE_SHA: validSha });
      expect(valid.exitCode).toBe(0);

      for (const invalid of ['', validSha.toUpperCase(), validSha.slice(0, -1), `${validSha}8`, `${validSha.slice(0, -1)}g`]) {
        const result = run(validateStep, { RELEASE_SHA: invalid });
        expect(result.exitCode, `must reject SHA value ${JSON.stringify(invalid)}`).not.toBe(0);
      }
    });
  });

  it('downloads the producer-format archive, verifies it, extracts it, and validates its manifest', async () => {
    await withHarness('producer-format-success', async (harness) => {
      await harness.writeFixture();
      const download = await harness.runDownload();
      expect(download.exitCode, JSON.stringify(download)).toBe(0);
      expect(await readFile(path.join(harness.releaseDir, 'index.html'), 'utf8')).toBe('small rollback fixture\n');
      expect(await readFile(path.join(harness.releaseDir, '.well-known/garnebo-deployment.json'), 'utf8')).toContain(validSha);

      const provenance = harness.run(provenanceStep, {
        DEPLOYMENT_OUT_DIR: harness.releaseDir,
        EXPECTED_SOURCE_SHA: validSha,
      });
      expect(provenance.exitCode, JSON.stringify(provenance)).toBe(0);
      expect(provenance.stdout).toContain(`[release-verify] verified 1 files for ${validSha}`);
      expect(await readFile(harness.marker, 'utf8')).toBe('invoked');

      const fixtureResults = await harness.finish('producer-format-success');
      expect(fixtureResults).toContain('commandSha256');
      expect(fixtureResults).toContain('commandBytes');
    });
  });

  it('rejects a tampered archive against the producer checksum before invoking tar', async () => {
    await withHarness('tampered-archive-original-checksum', async (harness) => {
      await harness.writeFixture({ archive: Buffer.from('not a gzip tar archive\n'), checksumFromGeneratedArchive: true });
      const result = await harness.runDownload();
      expect(result.exitCode).not.toBe(0);
      await expect(readFile(harness.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await harness.unchangedDestination();
    });
  });

  it('rejects an invalid-format archive after checksum verification when tar cannot unpack it', async () => {
    await withHarness('invalid-format-matching-checksum', async (harness) => {
      await harness.writeFixture({ archive: Buffer.from('not a gzip tar archive\n') });
      const result = await harness.runDownload();
      expect(result.exitCode).not.toBe(0);
      expect(await readFile(harness.marker, 'utf8')).toBe('invoked');
      await harness.unchangedDestination();
    });
  });

  it.each([
    ['corrupt digest', () => `${'0'.repeat(64)}  garnebo-site-${validSha}.tar.gz\n`],
    ['malformed digest record', () => `not-a-checksum  garnebo-site-${validSha}.tar.gz\n`],
    ['uppercase digest', () => `${'A'.repeat(64)}  garnebo-site-${validSha}.tar.gz\n`],
    ['short digest', () => `${'a'.repeat(63)}  garnebo-site-${validSha}.tar.gz\n`],
    ['missing final LF', () => `__ARCHIVE_SHA256__  garnebo-site-${validSha}.tar.gz`],
    ['CRLF record', () => `__ARCHIVE_SHA256__  garnebo-site-${validSha}.tar.gz\r\n`],
    ['extra blank line', () => `__ARCHIVE_SHA256__  garnebo-site-${validSha}.tar.gz\n\n`],
    ['wrong release basename', () => `__ARCHIVE_SHA256__  garnebo-site-${otherSha}.tar.gz\n`],
    ['extra records', () => `__ARCHIVE_SHA256__  garnebo-site-${validSha}.tar.gz\n__ARCHIVE_SHA256__  second.tar.gz\n`],
    ['traversal filename', () => `__ARCHIVE_SHA256__  ../garnebo-site-${validSha}.tar.gz\n`],
    ['absolute filename', () => `__ARCHIVE_SHA256__  /tmp/garnebo-site-${validSha}.tar.gz\n`],
  ])('rejects %s before invoking tar or changing the destination', async (label, record) => {
    await withHarness(`checksum-${label.replace(/[^a-z0-9-]+/gi, '-')}`, async (harness) => {
      await harness.writeFixture({ checksum: record() });
      const result = await harness.runDownload();
      expect(result.exitCode).not.toBe(0);
      await expect(readFile(harness.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await harness.unchangedDestination();
    });
  });

  it('fails provenance verification when the unpacked manifest names another source SHA', async () => {
    await withHarness('provenance-mismatch', async (harness) => {
      await harness.writeFixture();
      expect((await harness.runDownload()).exitCode).toBe(0);
      const result = harness.run(provenanceStep, {
        DEPLOYMENT_OUT_DIR: harness.releaseDir,
        EXPECTED_SOURCE_SHA: otherSha,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`does not match ${otherSha}`);
    });
  });
});

it.each([['junk', 'junk'], ['carriage-return', '\r']])('independent trailing bytes %s must fail before extraction', async (label, suffix) => {
  await withHarness(`independent-trailing-${label}`, async (harness) => {
    await harness.writeFixture({checksum: `__ARCHIVE_SHA256__  garnebo-site-${validSha}.tar.gz\n${suffix}`});
    const result = await harness.runDownload();
    expect(result.exitCode, JSON.stringify(result)).not.toBe(0);
    await expect(readFile(harness.marker, 'utf8')).rejects.toMatchObject({code:'ENOENT'});
    await harness.unchangedDestination();
  });
});
