import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceptanceContractSchema, contractDigest, digest } from '../../src/acceptance/schema.js';
import { RunManager } from '../../src/core/run-manager.js';
import { TEST_CONFIG } from './support/test-config.js';
import { turnBackstop } from '../../src/backends/app-server/usage.js';
import { captureVerification } from '../../src/acceptance/verify.js';
import { runToWire } from '../../src/core/serialization.js';
import type { RunRecord } from '../../src/contracts.js';
import { prepareTaskRepair, reserveRepairAuthorization } from '../../src/preparation/task-repair.js';

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'task-repair-')));
  await chmod(root, 0o700);
  const source = path.join(root, 'source');
  await mkdir(source, { mode: 0o700 });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(source, 'file.txt'), 'original\n'); git('add', '.'); git('commit', '-qm', 'fixture');
  const base = git('rev-parse', 'HEAD').trim();
  await writeFile(path.join(source, 'file.txt'), 'candidate\n');
  const patch = Buffer.from(git('diff', '--binary'));
  const dataDir = path.join(root, 'data'); await mkdir(dataDir, { mode: 0o700 }); await mkdir(path.join(dataDir, 'runs'), { mode: 0o700 });
  const contract = acceptanceContractSchema.parse({ schema_version: 1, allowed_changed_paths: ['file.txt'], checks: [{ id: 'exists', kind: 'file_exists', path: 'file.txt' }], required_validations: ['behavior'] });
  const original = { operation: 'edit' as const, request: { cwd: source, base_ref: base, task: 'Fix it.', acceptance_contract: contract, allowed_write_paths: ['file.txt'], max_turns: 10, timeout_seconds: 60, wait_seconds: 0 } };
  async function saveRun(task: string, runId = randomUUID()) {
    const directory = path.join(dataDir, 'runs', runId); await mkdir(directory, { mode: 0o700 }); await mkdir(path.join(directory, 'artifacts'), { mode: 0o700 });
    await writeFile(path.join(directory, 'artifacts', 'diff.patch'), patch, { mode: 0o600 });
    const verification = await captureVerification({ directory, source, base, patch, contract, executionState: 'completed', stopReason: 'end_turn', maxBytes: 1024 * 1024 });
    const record: RunRecord = { schemaVersion: 1, runId, backend: 'app-server', mode: 'edit', state: 'closed', executionState: 'completed', sourceWorkspace: source, workerWorkspace: source, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskSha256: digest(task), acceptanceContract: contract, allowedWritePaths: ['file.txt'], limits: { maxModelCalls: turnBackstop(10), maxTurns: 10, timeoutSeconds: 60, maxArtifactBytes: 1024 * 1024, maxEventBytes: 1024 * 1024, maxTranscriptBytes: 1024 * 1024 }, verification, result: { stopReason: 'end_turn', summary: 'done', warnings: [], changedFiles: ['file.txt'], artifacts: [{ name: 'diff.patch', path: path.join(directory, 'artifacts', 'diff.patch'), sha256: digest(patch), bytes: patch.length, mediaType: 'text/x-diff' }] }, assessments: [{ decision: 'rejected', reason: 'behavior failed', patch_sha256: digest(patch), contract_sha256: contractDigest(contract), validations: [{ id: 'behavior', status: 'failed' }], assessed_at: new Date().toISOString() }] };
    await writeFile(path.join(directory, 'meta.json'), JSON.stringify(runToWire(record)), { mode: 0o600 });
    return { runId, directory, record };
  }
  const saved = await saveRun(original.request.task);
  const requestFile = path.join(root, 'request.json'); await writeFile(requestFile, JSON.stringify(original), { mode: 0o644 });
  return { root, source, base, patch, dataDir, contract, original, requestFile, saveRun, ...saved };
}

describe('bounded fresh-run repair preparation', () => {
  it('generates a private complete request with bound failure data and never starts or grants', async () => {
    const f = await fixture();
    try {
      const output = path.join(f.root, 'repair.json');
      const result = await prepareTaskRepair({ dataDir: f.dataDir, runId: f.runId, requestFile: f.requestFile, output, maxCorrections: 2 });
      expect(result).toMatchObject({ root_run_id: f.runId, correction: 1, max_corrections: 2, predecessor_patch_sha256: digest(f.patch) });
      const generated = JSON.parse(await readFile(output, 'utf8')) as typeof f.original;
      expect(generated.request).toMatchObject({ cwd: f.source, base_ref: f.base, acceptance_contract: f.contract, allowed_write_paths: ['file.txt'], max_turns: 10, timeout_seconds: 60 });
      expect(generated.request.task).toContain('coordinator-validation-failed'); expect(generated.request.task).toContain('untrusted diagnostic data'); expect(generated.request.task).toContain('previous patch has not been applied');
      expect((await lstat(output)).mode & 0o777).toBe(0o600);
      await expect(lstat(path.join(f.dataDir, 'dispatch-grants'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path.join(f.directory, 'artifacts', 'diff.patch'))).toEqual(f.patch);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('prevents concurrent forks and budget changes, carries descendants and exhausts the fixed budget', async () => {
    const f = await fixture();
    try {
      const options = { dataDir: f.dataDir, runId: f.runId, requestFile: f.requestFile, maxCorrections: 2 as const };
      const results = await Promise.allSettled([prepareTaskRepair({ ...options, output: path.join(f.root, 'one.json') }), prepareTaskRepair({ ...options, output: path.join(f.root, 'two.json') })]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const first = results.find(result => result.status === 'fulfilled')!;
      if (first.status !== 'fulfilled') throw new Error('missing result');
      const doc = JSON.parse(await readFile(first.value.request_file, 'utf8')) as typeof f.original;
      const secondRun = await f.saveRun(doc.request.task);
      await expect(prepareTaskRepair({ dataDir: f.dataDir, runId: secondRun.runId, requestFile: first.value.request_file, output: path.join(f.root, 'reset.json'), maxCorrections: 1 })).rejects.toThrow(/budget.*frozen/);
      const second = await prepareTaskRepair({ dataDir: f.dataDir, runId: secondRun.runId, requestFile: first.value.request_file, output: path.join(f.root, 'second.json'), maxCorrections: 2 });
      expect(second).toMatchObject({ correction: 2, root_run_id: f.runId });
      const next = JSON.parse(await readFile(second.request_file, 'utf8')) as typeof f.original;
      const thirdRun = await f.saveRun(next.request.task);
      await expect(prepareTaskRepair({ dataDir: f.dataDir, runId: thirdRun.runId, requestFile: second.request_file, output: path.join(f.root, 'third.json'), maxCorrections: 2 })).rejects.toThrow(/exhausted/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it.each(['task', 'scope', 'base', 'contract', 'limits', 'patch', 'assessment', 'state'])('rejects changed %s before preparing output', async (change) => {
    const f = await fixture();
    try {
      if (change === 'task') f.original.request.task = 'different';
      if (change === 'scope') f.original.request.allowed_write_paths = ['other.txt'];
      if (change === 'base') f.original.request.base_ref = 'HEAD';
      if (change === 'contract') f.original.request.acceptance_contract.required_validations = ['other'];
      if (change === 'limits') f.original.request.max_turns = 11;
      await writeFile(f.requestFile, JSON.stringify(f.original));
      if (change === 'patch') await writeFile(path.join(f.directory, 'artifacts', 'diff.patch'), 'tampered');
      if (change === 'assessment') f.record.assessments![0]!.decision = 'accepted';
      if (change === 'state') f.record.state = 'completed';
      if (change === 'assessment' || change === 'state') await writeFile(path.join(f.directory, 'meta.json'), JSON.stringify(runToWire(f.record)));
      await expect(prepareTaskRepair({ dataDir: f.dataDir, runId: f.runId, requestFile: f.requestFile, output: path.join(f.root, 'out.json'), maxCorrections: 2 })).rejects.toThrow();
      await expect(lstat(path.join(f.root, 'out.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('keeps independent projects with identical terse task text in separate lineages', async () => {
    const first = await fixture();
    const second = await fixture();
    try {
      await prepareTaskRepair({ dataDir: first.dataDir, runId: first.runId, requestFile: first.requestFile, output: path.join(first.root, 'repair.json'), maxCorrections: 1 });
      await cp(second.directory, path.join(first.dataDir, 'runs', second.runId), { recursive: true });
      const prepared = await prepareTaskRepair({ dataDir: first.dataDir, runId: second.runId, requestFile: second.requestFile, output: path.join(second.root, 'repair.json'), maxCorrections: 2 });
      expect(prepared).toMatchObject({ root_run_id: second.runId, correction: 1, max_corrections: 2 });
    } finally {
      await rm(first.root, { recursive: true, force: true });
      await rm(second.root, { recursive: true, force: true });
    }
  });

  it('does not reset budget by submitting another run with the original task digest', async () => {
    const f = await fixture();
    try {
      await prepareTaskRepair({ dataDir: f.dataDir, runId: f.runId, requestFile: f.requestFile, output: path.join(f.root, 'first.json'), maxCorrections: 1 });
      const duplicate = await f.saveRun(f.original.request.task);
      await expect(prepareTaskRepair({ dataDir: f.dataDir, runId: duplicate.runId, requestFile: f.requestFile, output: path.join(f.root, 'reset.json'), maxCorrections: 2 })).rejects.toThrow(/budget.*frozen/);
      await expect(prepareTaskRepair({ dataDir: f.dataDir, runId: duplicate.runId, requestFile: f.requestFile, output: path.join(f.root, 'fork.json'), maxCorrections: 1 })).rejects.toThrow(/already reserved/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('refuses repair based only on an unrelated advisory validation failure', async () => {
    const f = await fixture();
    try {
      f.record.assessments![0]!.validations = [{ id: 'advisory-style', status: 'failed' }];
      await writeFile(path.join(f.directory, 'meta.json'), JSON.stringify(runToWire(f.record)));
      await expect(prepareTaskRepair({ dataDir: f.dataDir, runId: f.runId, requestFile: f.requestFile, output: path.join(f.root, 'out.json'), maxCorrections: 2 })).rejects.toThrow(/at least one/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('refuses credential-bearing patch feedback including unchanged context', async () => {
    const f = await fixture();
    const previous = process.env.MISTRAL_API_KEY;
    const sentinel = ['fixture', 'private', 'sentinel'].join('-');
    process.env.MISTRAL_API_KEY = sentinel;
    try {
      await writeFile(path.join(f.directory, 'artifacts', 'diff.patch'), `${f.patch.toString('utf8')} ${sentinel}\n`);
      await expect(prepareTaskRepair({ dataDir: f.dataDir, runId: f.runId, requestFile: f.requestFile, output: path.join(f.root, 'out.json'), maxCorrections: 2 })).rejects.toThrow(/cannot be included safely/);
      await expect(lstat(path.join(f.dataDir, 'task-repairs'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (previous === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = previous;
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('retains a spent reservation after an output-write failure', async () => {
    const f = await fixture();
    try {
      const output = path.join(f.root, 'exists.json'); await writeFile(output, 'original');
      const options = { dataDir: f.dataDir, runId: f.runId, requestFile: f.requestFile, output, maxCorrections: 1 as const };
      await expect(prepareTaskRepair(options)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(output, 'utf8')).toBe('original');
      await expect(prepareTaskRepair({ ...options, output: path.join(f.root, 'retry.json') })).rejects.toThrow(/already reserved/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  it('durably permits only one grant reservation per generated correction and refuses original replay', async () => {
    const f = await fixture();
    try {
      const input = { dataDir: f.dataDir, task: f.original.request.task, workspace: f.source, baseCommit: f.base, acceptanceContract: f.contract, allowedWritePaths: ['file.txt'], limits: f.record.limits };
      await reserveRepairAuthorization(input);
      const result = await prepareTaskRepair({ dataDir: f.dataDir, runId: f.runId, requestFile: f.requestFile, output: path.join(f.root,'repair.json'), maxCorrections: 2 });
      const document = JSON.parse(await readFile(result.request_file,'utf8'));
      await expect(reserveRepairAuthorization(input)).rejects.toMatchObject({code:'VSUP_AUTHORIZATION_INVALID'});
      const correction = { ...input, task: document.request.task };
      await expect(reserveRepairAuthorization({ ...correction, limits: {...correction.limits, maxTurns: 11} })).rejects.toMatchObject({code:'VSUP_AUTHORIZATION_INVALID'});
      const results = await Promise.allSettled([reserveRepairAuthorization(correction),reserveRepairAuthorization(correction)]);
      expect(results.filter(value=>value.status==='fulfilled')).toHaveLength(1);
      await expect(reserveRepairAuthorization(correction)).rejects.toMatchObject({code:'VSUP_AUTHORIZATION_INVALID'});
    } finally { await rm(f.root, {recursive:true,force:true}); }
  });

  it('enforces the correction reservation at real administrative grant issuance', async () => {
    const f = await fixture();
    const config = { ...TEST_CONFIG, allowedWorkspaceRoots: [f.source], limits: {...TEST_CONFIG.limits, maxArtifactBytes:f.record.limits.maxArtifactBytes, maxEventBytes:f.record.limits.maxEventBytes, maxTranscriptBytes:f.record.limits.maxTranscriptBytes} };
    const manager = new RunManager(config, f.dataDir, [], undefined, {usageDataDir:f.dataDir});
    try {
      const result = await prepareTaskRepair({dataDir:f.dataDir,runId:f.runId,requestFile:f.requestFile,output:path.join(f.root,'repair.json'),maxCorrections:1});
      const {request} = JSON.parse(await readFile(result.request_file,'utf8'));
      await expect(manager.authorizeDispatch('edit',request,'owner','invalid')).rejects.toMatchObject({code:'VSUP_AUTHORIZATION_INVALID'});
      const expiry = new Date(Date.now()+60000).toISOString();
      const {acceptance_contract: omitted, ...withoutContract} = request;
      expect(omitted).toBeDefined();
      await expect(manager.authorizeDispatch('edit',withoutContract,'owner',expiry)).rejects.toMatchObject({code:'VSUP_AUTHORIZATION_INVALID'});
      await expect(manager.authorizeDispatch('edit',{...withoutContract,allowed_write_paths:['other.txt'],max_turns:11},'owner',expiry)).rejects.toMatchObject({code:'VSUP_AUTHORIZATION_INVALID'});
      expect(await manager.authorizeDispatch('edit',request,'owner',expiry)).toHaveProperty('authorization_id');
      await expect(manager.authorizeDispatch('edit',withoutContract,'owner',expiry)).rejects.toMatchObject({code:'VSUP_AUTHORIZATION_INVALID'});
      await expect(manager.authorizeDispatch('edit',request,'owner',expiry)).rejects.toMatchObject({code:'VSUP_AUTHORIZATION_INVALID'});
    } finally { await manager.shutdown(); await rm(f.root,{recursive:true,force:true}); }
  });

  it('renders actionable frozen framework requirements after untrusted failed-patch feedback', async () => {
    const f = await fixture();
    try {
      f.contract.checks.push({id:'framework',kind:'node_test',path:'file.txt',min_cases:5});
      const failed = await f.saveRun(f.original.request.task);
      await writeFile(f.requestFile,JSON.stringify(f.original));
      const result = await prepareTaskRepair({dataDir:f.dataDir,runId:failed.runId,requestFile:f.requestFile,output:path.join(f.root,'actionable.json'),maxCorrections:2});
      const generated = JSON.parse(await readFile(result.request_file,'utf8'));
      expect(generated.request.task).toContain('node-test-insufficient-cases');
      expect(generated.request.task).toContain('node:test');
      expect(generated.request.task.lastIndexOf('Supervisor repair requirements')).toBeGreaterThan(generated.request.task.lastIndexOf('prior_patch_utf8'));
      expect(generated.request.acceptance_contract).toEqual(f.contract);
    } finally { await rm(f.root,{recursive:true,force:true}); }
  });

});
