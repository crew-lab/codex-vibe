import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { acceptanceContractSchema, contractDigest, digest } from '../../src/acceptance/schema.js';
import { captureVerification, verifySaved } from '../../src/acceptance/verify.js';
import { publicValue } from '../../src/reporting/export.js';

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
