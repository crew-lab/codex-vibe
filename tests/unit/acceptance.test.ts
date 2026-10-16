import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, it, expect } from 'vitest';
import { acceptanceContractSchema, contractDigest, digest } from '../../src/acceptance/schema.js';
import { captureVerification, verifySaved } from '../../src/acceptance/verify.js';
import { exportReport, publicValue } from '../../src/reporting/export.js';
import type { ApprovalLedgerSnapshot, RunRecord } from '../../src/contracts.js';
import { approvalsToWire, runToWire } from '../../src/core/serialization.js';

describe('artifact acceptance', () => {
  it('checks exact exported contents independently of summaries and detects later tampering', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'acceptance-')));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    try {
      git('init'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
      await writeFile(path.join(root, 'page.txt'), 'Old introduction\n'); git('add', '.'); git('commit', '-m', 'fixture');
      const base = git('rev-parse', 'HEAD').trim();
      await writeFile(path.join(root, 'page.txt'), 'New introduction. Developing BMS practice.\n');
      const patch = Buffer.from(git('diff', '--binary'));
      const directory = path.join(root, 'run'); await mkdir(directory, { mode: 0o700 });
      await mkdir(path.join(directory, 'artifacts'), { mode: 0o700 });
      await writeFile(path.join(directory, 'artifacts', 'diff.patch'), patch, { mode: 0o600 });
      const contract = acceptanceContractSchema.parse({ schema_version: 1, allowed_changed_paths: ['page.txt'], required_changed_paths: ['page.txt'], checks: [{ id: 'disclosure', kind: 'text_contains', path: 'page.txt', value: 'Developing BMS practice.' }, {id:'exists',kind:'file_exists',path:'page.txt'}, {id:'absent',kind:'file_absent',path:'missing.txt'}, {id:'negative',kind:'text_not_contains',path:'page.txt',value:'Unsupported claim'}, {id:'hash',kind:'file_sha256',path:'page.txt',value:digest('New introduction. Developing BMS practice.\n')}] });
      expect(contractDigest(contract)).toMatch(/^[a-f0-9]{64}$/);
      const result = await captureVerification({ directory, source: root, base, patch, contract, executionState: 'completed', stopReason: 'end_turn', maxBytes: 1024 * 1024 });
      expect(result.status).toBe('passed');
      for (const [name, raw, state, expected] of [
        ['missing-disclosure', {...contract, checks:[{id:'required',kind:'text_contains',path:'page.txt',value:'MISSING DISCLOSURE'}]}, 'completed', 'failed'],
        ['scope', {...contract, allowed_changed_paths:['other.txt'], required_changed_paths:[]}, 'completed', 'failed'],
        ['execution', contract, 'failed', 'incomplete']
      ] as const) {
        const separate = path.join(root,name); await mkdir(separate,{mode:0o700}); await mkdir(path.join(separate,'artifacts'),{mode:0o700});
        await writeFile(path.join(separate,'artifacts','diff.patch'),patch,{mode:0o600});
        expect((await captureVerification({directory:separate,source:root,base,patch,contract:acceptanceContractSchema.parse(raw),executionState:state,stopReason:'end_turn',maxBytes:1024*1024})).status).toBe(expected);
      }
      await writeFile(path.join(root, 'page.txt'), 'Worker directory subsequently changed');
      expect((await verifySaved(directory, contract, 1024 * 1024)).status).toBe('passed');
      await writeFile(path.join(directory, 'artifacts', 'diff.patch'), Buffer.concat([patch, Buffer.from('tamper')]));
      expect((await verifySaved(directory, contract, 1024 * 1024)).status).toBe('incomplete');
      expect(await readFile(path.join(root, 'page.txt'), 'utf8')).toBe('Worker directory subsequently changed');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('rejects unsafe paths and duplicate check identities', () => {
    const base = { schema_version: 1, allowed_changed_paths: ['page.txt'], checks: [{ id: 'same', kind: 'file_exists', path: 'page.txt' }] };
    expect(acceptanceContractSchema.safeParse({ ...base, allowed_changed_paths: ['../escape'] }).success).toBe(false);
    expect(acceptanceContractSchema.safeParse({ ...base, checks: [...base.checks, ...base.checks] }).success).toBe(false);
  });
  it('omits private absolute paths from public values', () => {
    expect(JSON.stringify(publicValue({ path: '/Users/person/private/run', message: 'at /private/tmp/task' }))).not.toContain('/Users/person');
  });
});

describe('audit bundle approval ledger and pin', () => {
  const RUN_ID = '3c9e6a51-2f4d-4b8e-9a17-5d6c7b8a9f01';
  const HASH = 'ab'.repeat(32);
  const OTHER_HASH = 'cd'.repeat(32);
  const roots: string[] = [];

  const snapshot: ApprovalLedgerSnapshot = {
    truncated: false,
    records: [
      { callbackId: 'cb-1', relatedEntryId: 'entry-1', turnId: 'turn-1', tool: 'file_system.read_file', path: 'src/limit.mjs', fingerprint: HASH, decision: 'approve', reason: null },
      { callbackId: 'cb-2', relatedEntryId: 'entry-2', turnId: 'turn-1', tool: 'file_system.write_file', path: 'src/other.mjs', fingerprint: null, decision: 'deny', reason: 'not permitted in /Users/person/private/checkout' }
    ]
  };

  async function savedRun(options: { ledger?: ApprovalLedgerSnapshot; pin?: boolean }): Promise<{ root: string; directory: string }> {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'bundle-'))); roots.push(root);
    const directory = path.join(root, 'run');
    await mkdir(path.join(directory, 'artifacts'), { recursive: true, mode: 0o700 });
    const artifacts: NonNullable<RunRecord['result']>['artifacts'] = [];
    if (options.ledger) {
      const bytes = Buffer.from(JSON.stringify(approvalsToWire(RUN_ID, options.ledger), null, 2) + '\n');
      await writeFile(path.join(directory, 'artifacts', 'approvals.json'), bytes, { mode: 0o600 });
      artifacts.push({ name: 'approvals.json', path: path.join(directory, 'artifacts', 'approvals.json'), sha256: digest(bytes), bytes: bytes.length, mediaType: 'application/json' });
    }
    const record: RunRecord = {
      schemaVersion: 1, runId: RUN_ID, backend: 'app-server', mode: 'review', state: 'closed', executionState: 'completed',
      sourceWorkspace: '/work/project', workerWorkspace: '/work/project', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:09.000Z', taskSha256: HASH,
      limits: { timeoutSeconds: 180, maxTurns: 12, maxEventBytes: 52428800, maxTranscriptBytes: 10485760, maxArtifactBytes: 104857600 },
      result: { stopReason: 'end_turn', artifacts },
      ...(options.pin ? { pin: { vibeVersion: '2.26.1', manifestSha256: HASH, recordSha256: OTHER_HASH } } : {})
    };
    await writeFile(path.join(directory, 'meta.json'), JSON.stringify(runToWire(record)), { mode: 0o600 });
    return { root, directory };
  }

  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it('exports the ledger and pin with the ledger digest in the manifest and no machine path', async () => {
    const { root, directory } = await savedRun({ ledger: snapshot, pin: true });
    const output = path.join(root, 'bundle');
    const result = await exportReport({ directory, output });
    expect(result.files).toEqual(expect.arrayContaining(['approvals.json', 'report.json', 'SHA256SUMS']));
    const ledger = await readFile(path.join(output, 'approvals.json'));
    expect(JSON.parse(ledger.toString('utf8'))).toMatchObject({ run_id: RUN_ID, truncated: false, records: [{ callback_id: 'cb-1', decision: 'approve' }, { callback_id: 'cb-2', decision: 'deny' }] });
    expect(ledger.toString('utf8')).not.toContain('/Users/person');
    expect(await readFile(path.join(output, 'SHA256SUMS'), 'utf8')).toContain(`${digest(ledger)}  approvals.json`);
    const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8')) as Record<string, unknown>;
    expect(report.pin).toEqual({ vibe_version: '2.26.1', manifest_sha256: HASH, record_sha256: OTHER_HASH });
    expect(report.approvals).toMatchObject({ file: 'approvals.json', records: 2, truncated: false });
    expect(result.files).not.toContain('transcript.md');
  });

  it('keeps an absent ledger and an absent pin absent', async () => {
    const { root, directory } = await savedRun({});
    const output = path.join(root, 'bundle');
    const result = await exportReport({ directory, output });
    expect(result.files).not.toContain('approvals.json');
    const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8')) as Record<string, unknown>;
    expect(report).not.toHaveProperty('approvals');
    expect(report).not.toHaveProperty('pin');
  });

  it('records a truncated ledger as truncated', async () => {
    const { root, directory } = await savedRun({ ledger: { ...snapshot, truncated: true } });
    const output = path.join(root, 'bundle');
    await exportReport({ directory, output });
    expect(JSON.parse(await readFile(path.join(output, 'approvals.json'), 'utf8'))).toMatchObject({ truncated: true });
  });

  it('refuses a ledger whose bytes no longer match the saved artifact digest', async () => {
    const { root, directory } = await savedRun({ ledger: snapshot });
    await writeFile(path.join(directory, 'artifacts', 'approvals.json'), '{"schema_version":1}', { mode: 0o600 });
    await expect(exportReport({ directory, output: path.join(root, 'bundle') })).rejects.toThrow('Approval ledger does not match');
  });

  it('refuses a ledger the run record does not list', async () => {
    const { root, directory } = await savedRun({});
    await writeFile(path.join(directory, 'artifacts', 'approvals.json'), '{"schema_version":1}', { mode: 0o600 });
    await expect(exportReport({ directory, output: path.join(root, 'bundle') })).rejects.toThrow('Approval ledger does not match');
  });
});
