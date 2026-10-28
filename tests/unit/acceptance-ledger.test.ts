import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEDGER_SCHEMA_VERSION, buildAcceptanceReport, supportedBuild } from '../../scripts/acceptance-report.mjs';

interface Observed { gate: string; result: string; evidence: string | null; note: string }
interface Open { gate: string; why: string }
interface Build { label: string; archive_sha256?: string; candidate_sha256?: string; recorded_on: string; evidence: string | null; observed: Observed[]; open: Open[] }
interface Ledger { schema_version: number; supported_release: string; rule: string; gates: { name: string; settles: string }[]; builds: Build[] }

const repo = path.resolve(import.meta.dirname, '..', '..');
const ledger = JSON.parse(await readFile(path.join(repo, 'docs', 'acceptance.json'), 'utf8')) as Ledger;
const catalogue = new Set(ledger.gates.map((gate) => gate.name));
const SHA256 = /^[0-9a-f]{64}$/;

async function exists(relative: string): Promise<boolean> {
  return stat(path.join(repo, relative)).then(() => true, () => false);
}

describe('docs/acceptance.json', () => {
  it('is one observed list per build with the supported release first', () => {
    expect(ledger.schema_version).toBe(LEDGER_SCHEMA_VERSION);
    expect(ledger.builds[0]?.label).toBe(ledger.supported_release);
    expect(supportedBuild(ledger).label).toBe(ledger.supported_release);
    expect(ledger.rule).toContain('research/evidence/');
  });

  it('names each gate once with what it settles', () => {
    expect(catalogue.size).toBe(ledger.gates.length);
    for (const gate of ledger.gates) expect(gate.settles.length).toBeGreaterThan(0);
  });

  it('lists every gate on the supported build as observed or open, never both', () => {
    const supported = supportedBuild(ledger);
    const observed = supported.observed.map((entry) => entry.gate);
    const open = supported.open.map((entry) => entry.gate);
    expect([...observed, ...open].sort()).toEqual([...catalogue].sort());
  });

  it('uses only catalogued gate names and no duplicates within a build', () => {
    for (const build of ledger.builds) {
      const names = [...build.observed, ...build.open].map((entry) => entry.gate);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(catalogue.has(name), `${build.label}: ${name}`).toBe(true);
    }
  });

  it('cites a committed evidence path for every observation, or explains why none exists', async () => {
    for (const build of ledger.builds) {
      expect(build.recorded_on.length).toBeGreaterThan(0);
      if (build.archive_sha256 !== undefined) expect(build.archive_sha256).toMatch(SHA256);
      if (build.candidate_sha256 !== undefined) expect(build.candidate_sha256).toMatch(SHA256);
      if (build.evidence !== null) expect(await exists(build.evidence), `${build.label}: ${build.evidence}`).toBe(true);
      for (const entry of build.observed) {
        expect(entry.result.length).toBeGreaterThan(0);
        expect(entry.note.length).toBeGreaterThan(0);
        if (entry.evidence === null) continue;
        expect(entry.evidence.startsWith('research/evidence/'), `${build.label}: ${entry.gate}`).toBe(true);
        expect(await exists(entry.evidence), `${build.label}: ${entry.evidence}`).toBe(true);
      }
      for (const entry of build.open) expect(entry.why.length, `${build.label}: ${entry.gate}`).toBeGreaterThan(0);
    }
  });
});

describe('acceptance report', () => {
  const checks = [{ name: 'cli-version', status: 'PASS', detail: '2.2.0' }];
  const generatedAt = '2026-10-28T00:00:00.000Z';

  it('carries the deterministic checks and the supported build\'s open gates deterministically', () => {
    const report = buildAcceptanceReport({ ledger, checks, generatedAt });
    expect(report.deterministic_checks).toBe(checks);
    expect(report.generated_at).toBe(generatedAt);
    expect(report.supported_release).toBe(ledger.supported_release);
    expect(report.open_gates.map((gate) => gate.name)).toEqual(supportedBuild(ledger).open.map((entry) => entry.gate));
    for (const gate of report.open_gates) expect(gate.reason.length).toBeGreaterThan(0);
    expect(report.builds.map((build) => build.label)).toEqual(ledger.builds.map((build) => build.label));
    expect(report.builds[0]?.observed).toEqual(ledger.builds[0]?.observed.map((entry) => entry.gate));
    expect(report.builds[0]?.open).toEqual(ledger.builds[0]?.open.map((entry) => entry.gate));
    expect(JSON.stringify(buildAcceptanceReport({ ledger, checks, generatedAt }))).toBe(JSON.stringify(report));
    expect(report).not.toHaveProperty('verified_release_gates');
  });

  it('refuses a ledger of another schema or without the supported build', () => {
    expect(() => buildAcceptanceReport({ ledger: { ...ledger, schema_version: 1 }, checks, generatedAt })).toThrow(/schema_version/);
    expect(() => buildAcceptanceReport({ ledger: { ...ledger, supported_release: '0.0.0' }, checks, generatedAt })).toThrow(/supported release/);
  });
});
