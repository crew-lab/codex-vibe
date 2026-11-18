import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest } from '../../src/acceptance/schema.js';
import { AntigravityBackend } from '../../src/backends/antigravity.js';
import { describe, expect, it } from 'vitest';
import { REMEDIATION, supervisorError } from '../../src/contracts.js';
import { PinCheckError, type PinManifest } from '../../src/backends/app-server/pin.js';
import type { OwnerLock } from '../../src/core/owner-lock.js';
import type { PreparationFacts } from '../../src/preparation/evidence.js';
import type { RunPreparationInput } from '../../src/preparation/run.js';
import { decideRefresh, previousBinaryLabel, refreshHold, refreshSummary, refreshWarning, runWorkerRefresh, type WorkerRefreshDependencies, type WorkerRefreshPlan } from '../../src/preparation/worker-refresh.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { errorsDocPath, renderErrorsDoc } from '../../scripts/errors-doc.mjs';

const status = (value: 'passed' | 'failed' | 'missing' | 'stale') => ({ status: value, candidate_sha256: null, version: 'test', reason: 'test' });
const facts = (value: 'passed' | 'failed' | 'missing' | 'stale', extra: Partial<PreparationFacts> = {}): PreparationFacts => ({ status: status(value), changed: null, interrupted: false, ...extra });

describe('decideRefresh', () => {
  it('re-pins a Vibe manifest whose version differs from the install', () => {
    expect(decideRefresh({ backend: 'app-server', pinReason: 'manifest-version-mismatch', facts: facts('passed') })).toBe('repin');
  });

  it('never re-pins for agy or for any other pin failure', () => {
    expect(decideRefresh({ backend: 'antigravity', pinReason: 'manifest-version-mismatch', facts: facts('stale', { changed: ['pin'] }) })).toBe('none');
    for (const reason of ['version-mismatch', 'file-mismatch', 'record-mismatch', 'file-extra', 'dist-info-missing', 'VSUP_VIBE_NOT_FOUND']) {
      expect(decideRefresh({ backend: 'app-server', pinReason: reason, facts: facts('stale', { changed: ['pin'] }) })).toBe('none');
    }
  });

  it('re-prepares a receipt made stale only by the pin, the policy or the Node major', () => {
    for (const changed of [['pin'], ['policy'], ['node_major'], ['pin', 'policy', 'node_major']] as const) {
      expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('stale', { changed: [...changed] }) })).toBe('prepare');
      expect(decideRefresh({ backend: 'antigravity', pinReason: null, facts: facts('stale', { changed: [...changed] }) })).toBe('prepare');
    }
  });

  it('re-prepares an interrupted run', () => {
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('failed', { interrupted: true }) })).toBe('prepare');
  });

  it('leaves a changed candidate, an unknown change, a missing receipt and a finished failure to the owner', () => {
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('stale', { changed: ['candidate'] }) })).toBe('none');
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('stale', { changed: ['candidate', 'pin'] }) })).toBe('none');
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('stale', { changed: null }) })).toBe('none');
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('stale', { changed: [] }) })).toBe('none');
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('missing') })).toBe('none');
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('failed') })).toBe('none');
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: facts('passed') })).toBe('none');
    expect(decideRefresh({ backend: 'app-server', pinReason: null, facts: null })).toBe('none');
  });
});

describe('refreshHold', () => {
  const free = { stopping: false, bootDrift: [], configPath: '/config.toml', busy: false };
  it('allows a refresh only with no drift, no shutdown, a known config path and no run', () => {
    expect(refreshHold(free)).toBeNull();
    expect(refreshHold({ ...free, stopping: true })).toBe('stopping');
    expect(refreshHold({ ...free, bootDrift: ['build'] })).toBe('boot_drift');
    expect(refreshHold({ ...free, configPath: null })).toBe('no_config_path');
    expect(refreshHold({ ...free, busy: true })).toBe('busy');
  });
});

describe('refresh wording', () => {
  it('names the versions for Vibe and the previous binary for agy', () => {
    expect(refreshWarning('app-server', '3.1.2', '3.1.3')).toBe('Vibe 3.1.2 -> 3.1.3 was refreshed automatically; no-inference preparation passed; hosted quality has not been re-run on this version.');
    const label = previousBinaryLabel('ab'.repeat(32));
    expect(label).toBe('sha256:abababababab');
    expect(label.length).toBeLessThanOrEqual(64);
    expect(refreshWarning('antigravity', label, '1.6.0')).toBe('Antigravity CLI (previous binary sha256:abababababab) -> 1.6.0 was refreshed automatically; no-inference preparation passed; hosted quality has not been re-run on this version.');
    expect(refreshSummary('app-server', { kind: 'prepared', passed: true, repinned: true, from: '3.1.2', to: '3.1.3', reportPath: '/private/report.json', findings: [] })).toBe('Vibe 3.1.2 -> 3.1.3: re-pinned, preparation passed');
    expect(refreshSummary('app-server', { kind: 'not_needed' })).toBeUndefined();
  });
});

describe('VSUP_PREPARING', () => {
  it('is documented as retryable', async () => {
    expect(REMEDIATION.VSUP_PREPARING).toMatch(/wait_seconds/);
    const doc = renderErrorsDoc(REMEDIATION);
    expect(doc).toMatch(/^\| `VSUP_PREPARING` \|.*\| yes \|$/m);
    expect(await readFile(errorsDocPath, 'utf8')).toBe(doc);
  });
});

describe('agy worker identity', () => {
  it('hashes the binary without launching it and reports no version', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-agy-identity-')));
    try {
      const marker = path.join(root, 'launched');
      const binary = path.join(root, 'agy');
      await writeFile(binary, `#!/bin/sh\ntouch "${marker}"\necho "agy 1.6.0"\n`, { mode: 0o755 });
      const backend = new AntigravityBackend({ ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: binary }, experimental: { antigravity: true } });
      expect(await backend.workerIdentity()).toEqual({ version: null, digest: digest(await readFile(binary)) });
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('runWorkerRefresh', () => {
  const lock = (): OwnerLock & { released: number } => {
    const value = { path: '/lock', token: 't', released: 0, release: async () => { value.released += 1; } };
    return value;
  };
  const manifest: PinManifest = { format: 1, version: '3.1.3', record_sha256: 'e'.repeat(64), files: {} };
  const plan = (overrides: Partial<WorkerRefreshPlan> = {}): WorkerRefreshPlan => ({
    backend: 'app-server', config: { ...DEFAULT_CONFIG, paths: { vibePinManifest: '/nowhere/vibe-pin-manifest.json' } }, configPath: '/nowhere/config.toml', dataDir: '/nowhere',
    signal: new AbortController().signal, pinTarget: { executable: '/nowhere/vibe-app-server', manifestPath: '/nowhere/vibe-pin-manifest.json', minimumVersion: '3.1.2' },
    workerVersion: async () => '3.1.3', assess: async () => ({ action: 'repin', facts: facts('passed') }), onStage: () => undefined, ...overrides
  });
  const dependencies = (overrides: Partial<WorkerRefreshDependencies> = {}): WorkerRefreshDependencies & { prepared: RunPreparationInput[] } => {
    const prepared: RunPreparationInput[] = [];
    return {
      prepared,
      acquireLock: async () => lock(),
      generatePinManifest: async () => manifest,
      replacePinManifest: async () => ({ previousVersion: '3.1.2', historyPath: '/nowhere/pin-history/old.json' }),
      runPreparation: async (input) => { prepared.push(input); return { status: 'passed', candidate_sha256: 'c'.repeat(64), hosted_acceptance: 'unverified', report_sha256: 'r'.repeat(64), report_path: '/nowhere/report.json', findings: [] }; },
      ...overrides
    };
  };

  it('re-pins, then prepares with the previous version and releases the lock', async () => {
    const held = lock(); const deps = dependencies(); const stages: string[] = [];
    const outcome = await runWorkerRefresh(plan({ onStage: (stage) => { stages.push(stage); } }), held, deps);
    expect(outcome).toMatchObject({ kind: 'prepared', passed: true, repinned: true, from: '3.1.2', to: '3.1.3' });
    expect(stages).toEqual(['pinning', 'preparing']);
    expect(deps.prepared[0]).toMatchObject({ origin: 'automatic', previousWorkerVersion: '3.1.2', stderr: 'ignore' });
    expect(held.released).toBe(1);
  });

  it('stops when the re-assessment under the lock finds nothing to do', async () => {
    const held = lock(); const deps = dependencies();
    expect(await runWorkerRefresh(plan({ assess: async () => ({ action: 'none', facts: facts('passed') }) }), held, deps)).toEqual({ kind: 'not_needed' });
    expect(deps.prepared).toEqual([]);
    expect(held.released).toBe(1);
  });

  it('reports an install that is still changing and writes nothing', async () => {
    for (const reason of ['dist-info-missing', 'dist-info-ambiguous', 'record-unreadable', 'record-hash-mismatch', 'file-missing'] as const) {
      let replaced = 0;
      const deps = dependencies({ generatePinManifest: async () => { throw new PinCheckError(reason, 'changing'); }, replacePinManifest: async () => { replaced += 1; return { previousVersion: null, historyPath: null }; } });
      expect(await runWorkerRefresh(plan(), lock(), deps)).toMatchObject({ kind: 'install_unsettled', reason });
      expect(replaced).toBe(0);
      expect(deps.prepared).toEqual([]);
    }
  });

  it('refuses a RECORD row without a hash instead of waiting for it, and names the row', async () => {
    const deps = dependencies({ generatePinManifest: async () => { throw new PinCheckError('record-unhashed', 'RECORD lists files without a sha256 hash.', { unhashed: { paths: ['vibe/core.py'], total: 1 } }); } });
    expect(await runWorkerRefresh(plan(), lock(), deps)).toMatchObject({ kind: 'pin_failed', error: { details: { reason: 'record-unhashed', unhashed: { paths: ['vibe/core.py'], total: 1 } } } });
    expect(deps.prepared).toEqual([]);
  });

  it('reports any other re-pin failure as a pin error', async () => {
    const deps = dependencies({ generatePinManifest: async () => { throw new PinCheckError('file-extra', 'Files exist that RECORD does not list.'); } });
    const outcome = await runWorkerRefresh(plan(), lock(), deps);
    expect(outcome).toMatchObject({ kind: 'pin_failed', error: { code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { reason: 'file-extra' } } });
    expect(deps.prepared).toEqual([]);
  });

  it('carries the previous version of an interrupted run forward', async () => {
    const deps = dependencies();
    await runWorkerRefresh(plan({ assess: async () => ({ action: 'prepare', facts: facts('failed', { interrupted: true, origin: 'automatic', previous_worker_version: '3.1.1' }) }) }), lock(), deps);
    expect(deps.prepared[0]).toMatchObject({ previousWorkerVersion: '3.1.1' });
  });

  it('reports an abort as aborted and still releases the lock', async () => {
    const controller = new AbortController(); const held = lock();
    const deps = dependencies({ runPreparation: async () => { controller.abort(); throw controller.signal.reason; } });
    expect(await runWorkerRefresh(plan({ signal: controller.signal, assess: async () => ({ action: 'prepare', facts: facts('stale', { changed: ['policy'] }) }) }), held, deps)).toEqual({ kind: 'aborted' });
    expect(held.released).toBe(1);
  });

  it('turns an unexpected failure into an error without a path in the summary', async () => {
    const deps = dependencies({ replacePinManifest: async () => { throw new Error('EACCES: /secret/place'); } });
    const outcome = await runWorkerRefresh(plan(), lock(), deps);
    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'VSUP_INTERNAL' } });
    expect(refreshSummary('app-server', outcome)).not.toContain('/secret');
    expect(supervisorError('VSUP_PREPARING', 'x').remediation).toBe(REMEDIATION.VSUP_PREPARING);
  });
});
