import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digest } from '../../src/acceptance/schema.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { checkPreparation, preparationIdentity, receiptPath } from '../../src/preparation/evidence.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('preparation status', () => {
  it('reports a receipt whose saved report was deleted as stale, and a deleted receipt as missing', async () => {
    const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'preparation-status-')); roots.push(root);
    const manifest = path.join(root, 'pin-manifest.json');
    await writeFile(manifest, JSON.stringify({ format: 1, version: '3.0.2', record_sha256: 'a'.repeat(64), files: {} }), { mode: 0o600 });
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
});
