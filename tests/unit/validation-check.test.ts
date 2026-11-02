import { mkdtemp, writeFile, readFile, mkdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { prepareValidation } from '../../src/validation/workspace.js';
import { checkNodeTests } from '../../src/validation/check.js';

async function fixture(code: string) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'validation-check-')));
  const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'test.mjs'), code);
  const git = (args: string[]) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
  const patch = path.join(root, 'empty.patch'); await writeFile(patch, '', { mode: 0o644 });
  const directory = path.join(root, 'validation');
  await prepareValidation({ source, base: git(['rev-parse', 'HEAD']), patchFile: patch, output: directory, install: false });
  return { directory, output: path.join(root, 'result.json'), validationId: 'tests', tests: ['test.mjs'] };
}

describe('fixed coordinator node-test profile', () => {
  it('runs owned candidate tests and emits an export-compatible hash-bound manifest', async () => {
    const f = await fixture("import test from 'node:test'; import assert from 'node:assert/strict'; test('value',()=>assert.equal(1,1));");
    const result = await checkNodeTests(f) as { validations: Array<{ status: string }> };
    expect(result.validations[0]?.status).toBe('passed');
    const report = JSON.parse(await readFile(f.output, 'utf8'));
    expect(Object.keys(report).sort()).toEqual(['patch_sha256', 'schema_version', 'validations']);
    expect(JSON.parse(await readFile(f.output + '.evidence.json', 'utf8')).profile.kind).toBe('node-test');
  });
  it('retains failed diagnostics and sanitizes the validation path', async () => {
    const f = await fixture("throw new Error('fixture failure');");
    const result = await checkNodeTests(f) as { validations: Array<{ status: string }> };
    expect(result.validations[0]?.status).toBe('failed');
    const evidence = await readFile(f.output + '.evidence.json', 'utf8');
    expect(evidence).toContain('fixture failure'); expect(evidence).not.toContain(f.directory);
  });
  it('bounds timeout and output without running a shell', async () => {
    const f = await fixture('setInterval(()=>{},100);');
    expect(await checkNodeTests({ ...f, timeoutSeconds: 1 })).toMatchObject({ reason: 'timeout' });
    const g = await fixture("process.stdout.write('x'.repeat(300000));");
    expect(await checkNodeTests(g)).toMatchObject({ reason: 'output-limit' });
  });
  it('rejects mutated copies and option-shaped test paths before execution', async () => {
    const f = await fixture('');
    await expect(checkNodeTests({ ...f, tests: ['--eval.js'] })).rejects.toThrow();
    await writeFile(path.join(f.directory, 'candidate', 'test.mjs'), "throw new Error('must not run');");
    await expect(checkNodeTests(f)).rejects.toThrow('changed');
  });
  it('bounds completion when a detached descendant holds inherited pipes open', async () => {
    const f = await fixture("import {spawn} from 'node:child_process'; const c=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{detached:true,stdio:['ignore',process.stdout,process.stderr]}); console.log('owned-descendant='+c.pid); process.exit(0);");
    const started = Date.now();
    try {
      expect(await checkNodeTests({ ...f, timeoutSeconds: 1 })).toMatchObject({ reason: expect.stringMatching(/^timeout(?:-cleanup-unverified)?$/) });
      expect(Date.now() - started).toBeLessThan(6000);
    } finally {
      const evidence = JSON.parse(await readFile(f.output + '.evidence.json', 'utf8'));
      const pid = /owned-descendant=(\d+)/.exec(evidence.diagnostic)?.[1];
      if (pid) { try { process.kill(-Number(pid), 'SIGKILL'); } catch {} }
    }
  });

  it('refuses existing report destinations before project code executes', async () => {
    const f = await fixture("import {writeFileSync} from 'node:fs'; writeFileSync('executed-marker','yes');");
    await writeFile(f.output,'existing');
    await expect(checkNodeTests(f)).rejects.toThrow('already exists');
    await expect(readFile(path.join(f.directory,'candidate','executed-marker'))).rejects.toMatchObject({code:'ENOENT'});
    expect(await readFile(f.output,'utf8')).toBe('existing');
  });
  it('filters credentials from the child and redacts known sentinels across output chunks', async () => {
    const value = ['opaque','fixture','credential','value'].join('-');
    const f = await fixture("process.stdout.write("+JSON.stringify(value.slice(0,12))+"); process.stdout.write("+JSON.stringify(value.slice(12))+"); if(process.env.MISTRAL_API_KEY) throw new Error('credential inherited');");
    const prior = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_API_KEY = value;
    try {
      expect(await checkNodeTests(f)).toMatchObject({reason:'exit-0'});
      const evidence = await readFile(f.output+'.evidence.json','utf8');
      expect(evidence).not.toContain(value); expect(evidence).toContain('[REDACTED]');
    } finally { if(prior===undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY=prior; }
  });

});
