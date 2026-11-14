import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digest } from '../../src/acceptance/schema.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { checkPreparation, nodeMajor, preparationComponents, preparationIdentity, receiptPath } from '../../src/preparation/evidence.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('preparation status', () => {
  it('reports a receipt whose saved report was deleted as stale, and a deleted receipt as missing', async () => {
    const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'preparation-status-')); roots.push(root);
    const manifest = path.join(root, 'pin-manifest.json');
    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.1.2', record_sha256: 'a'.repeat(64), files: {} }), { mode: 0o600 });
    const config = { ...DEFAULT_CONFIG, paths: { vibePinManifest: manifest } };
    const report = Buffer.from(JSON.stringify({ fixture: true }));
    const reports = path.join(root, 'preparation-reports'); await mkdir(reports, { mode: 0o700 });
    const reportFile = path.join(reports, `${digest(report)}.json`);
    await writeFile(reportFile, report, { mode: 0o600 });
    await writeFile(receiptPath(config), JSON.stringify({ schema_version: 1, result: 'passed', identity: await preparationIdentity(config), checked_at: new Date().toISOString(), report_sha256: digest(report) }), { mode: 0o600 });
    expect(await checkPreparation(config)).toMatchObject({ status: 'passed' });
    await rm(reportFile);
    expect(await checkPreparation(config)).toMatchObject({ status: 'stale', reason: expect.stringMatching(/report is missing or changed/) });
    await rm(receiptPath(config));
    expect(await checkPreparation(config)).toMatchObject({ status: 'missing' });
  });

  it('binds preparation to the Node major version, so a patch or minor update keeps the receipt', async () => {
    const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'preparation-node-')); roots.push(root);
    const manifest = path.join(root, 'pin-manifest.json');
    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.2.0', record_sha256: 'b'.repeat(64), files: {} }), { mode: 0o600 });
    const config = { ...DEFAULT_CONFIG, paths: { vibePinManifest: manifest } };
    const candidate = 'c'.repeat(64);
    expect(nodeMajor('v24.22.1')).toBe('24');
    expect(await preparationIdentity(config, candidate, '24.21.0')).toBe(await preparationIdentity(config, candidate, '24.22.1'));
    expect(await preparationIdentity(config, candidate, '24.21.0')).not.toBe(await preparationIdentity(config, candidate, '20.19.0'));
  });

  it('names the components that changed since the last check and says whether the stale receipt passed', async () => {
    const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'preparation-components-')); roots.push(root);
    const manifest = path.join(root, 'pin-manifest.json');
    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.2.0', record_sha256: 'd'.repeat(64), files: {} }), { mode: 0o600 });
    const config = { ...DEFAULT_CONFIG, paths: { vibePinManifest: manifest } };
    const report = Buffer.from(JSON.stringify({ fixture: true }));
    const reports = path.join(root, 'preparation-reports'); await mkdir(reports, { mode: 0o700 });
    await writeFile(path.join(reports, `${digest(report)}.json`), report, { mode: 0o600 });
    const writeReceipt = async (result: 'passed' | 'failed', withComponents: boolean) => writeFile(receiptPath(config), JSON.stringify({ schema_version: 1, result, identity: await preparationIdentity(config), checked_at: new Date().toISOString(), report_sha256: digest(report), ...(withComponents ? { components: await preparationComponents(config) } : {}) }), { mode: 0o600 });

    await writeReceipt('passed', true);
    expect(await checkPreparation(config)).toMatchObject({ status: 'passed' });

    const changedPolicy = { ...config, retention: { days: config.retention.days + 1 } };
    const policy = await checkPreparation(changedPolicy);
    expect(policy.status).toBe('stale');
    expect(policy.reason).toMatch(/^policy changed since the last check; the stale receipt had passed/);

    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.2.1', record_sha256: 'e'.repeat(64), files: {} }), { mode: 0o600 });
    const pin = await checkPreparation(config);
    expect(pin.status).toBe('stale');
    expect(pin.reason).toMatch(/^pin changed since the last check; the stale receipt had passed/);

    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.2.0', record_sha256: 'd'.repeat(64), files: {} }), { mode: 0o600 });
    const current = await preparationComponents(config);
    const labels = { candidate: 'candidate', pin: 'pin', node_major: 'Node major version', policy: 'policy' } as const;
    for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
      await writeFile(receiptPath(config), JSON.stringify({ schema_version: 1, result: 'passed', identity: 'a'.repeat(64), checked_at: new Date().toISOString(), report_sha256: digest(report), components: { ...current, [key]: 'f'.repeat(64) } }), { mode: 0o600 });
      const status = await checkPreparation(config);
      expect(status.status).toBe('stale');
      expect(status.reason).toMatch(new RegExp(`^${labels[key]} changed since the last check; the stale receipt had passed`));
    }
    expect(await preparationComponents(config, undefined, '24.1.0')).not.toEqual(await preparationComponents(config, undefined, '20.1.0'));

    await writeReceipt('failed', true);
    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.2.1', record_sha256: 'e'.repeat(64), files: {} }), { mode: 0o600 });
    expect((await checkPreparation(config)).reason).toMatch(/had failed/);

    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.2.0', record_sha256: 'd'.repeat(64), files: {} }), { mode: 0o600 });
    await writeReceipt('passed', false);
    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.2.1', record_sha256: 'e'.repeat(64), files: {} }), { mode: 0o600 });
    expect((await checkPreparation(config)).reason).toBe('Candidate, pin, runtime or policy changed; the stale receipt had passed');
  });
});
