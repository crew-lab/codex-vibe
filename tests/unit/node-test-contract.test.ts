import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureVerification, verifySaved } from '../../src/acceptance/verify.js';
import { inspectNodeTests } from '../../src/acceptance/node-test.js';
import { acceptanceContractSchema } from '../../src/acceptance/schema.js';

const prefix = `import test from 'node:test'; import assert from 'node:assert/strict';`;
describe('node:test structural contract', () => {
  it.each([
    `import test from 'node:test'; import assert from 'node:assert/strict'; test('boundary', () => { assert.equal(100, 100); });`,
    `import {test as run} from 'node:test'; import {strict as check} from 'node:assert'; run('boundary', () => { check.equal(100, 100); });`,
    `import {it} from 'node:test'; import {strictEqual as eq} from 'node:assert'; it('boundary', () => { eq(100, 100); });`,
    `import * as runner from 'node:test'; import * as check from 'node:assert/strict'; runner.test('boundary', () => { check.deepEqual([100], [100]); });`,
    `import test from 'node:test'; import assert from 'node:assert'; await test('boundary', async () => { assert.strictEqual(100, 100); });`,
    `import test from 'node:test'; import assert from 'node:assert'; test('boundary', () => assert.strict.equal(100,100));`
  ])('accepts genuine named cases and equivalent strict imports: %s', (source) => {
    expect(inspectNodeTests(source, 1)).toMatchObject({ passed: true, cases: 1 });
  });
  it.each([
    `import assert from 'node:assert'; assert.strictEqual(100, 100);`,
    `const text = "test('boundary', () => assert.strictEqual(100,100))";`,
    `${prefix} // test('boundary', () => assert.equal(100,100))`,
    `import assert from 'node:assert/strict'; test('boundary', () => assert.equal(100,100));`,
    `${prefix} function helper(test) { test('boundary', () => assert.equal(100,100)); }`,
    `${prefix} test('boundary', (assert) => assert.equal(100,100));`,
    `${prefix} test('boundary', () => { const assert = {equal(){}}; assert.equal(100,100); });`,
    `${prefix} test('boundary', () => { function neverCalled() { assert.equal(100,100); } });`,
    `${prefix} test('', () => assert.equal(100,100));`,
    `${prefix} test('boundary', {skip:true}, () => assert.equal(100,100));`,
    `${prefix} test.skip('boundary', () => assert.equal(100,100));`,
    `import test from 'node:test'; import assert from 'node:assert'; test('boundary', () => assert.equal(1, '1'));`,
    `${prefix} test('boundary', () => {`,
    `${prefix} test('boundary', () => { const value = 100; });`,
    `import test from 'node:test'; import * as assert from 'node:assert/strict'; test('boundary', () => assert(100));`,
    `${prefix} test('boundary', () => { class Hidden { check(){ assert.equal(100,100); } } });`
  ])('rejects observed and misleading structures: %s', (source) => {
    expect(inspectNodeTests(source, 1).passed).toBe(false);
  });
  it('requires enough cases and an assertion in every recognized case', () => {
    expect(inspectNodeTests(`${prefix} test('one', () => assert.equal(1,1));`, 2)).toMatchObject({passed:false,cases:1});
    expect(inspectNodeTests(`${prefix} test('one', () => assert.equal(1,1)); test('two', () => {});`, 1).passed).toBe(false);
  });
  it('bounds schema counts and hashes the structured requirement', () => {
    const contract = {schema_version:1, allowed_changed_paths:['check.test.mjs'], checks:[{id:'framework',kind:'node_test',path:'check.test.mjs',min_cases:5}]};
    expect(acceptanceContractSchema.parse(contract).checks[0]).toMatchObject({kind:'node_test',min_cases:5});
    for (const min_cases of [0,101,1.5]) expect(acceptanceContractSchema.safeParse({...contract,checks:[{...contract.checks[0],min_cases}]}).success).toBe(false);
  });
});


describe('node:test exported artifact verification', () => {
  it('rejects original top-level assertions and preserves verification independently of worker mutations', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'node-test-contract-')));
    const git = (...args: string[]): string => execFileSync('git', args, {cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']});
    try {
      git('init'); git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture');
      await writeFile(path.join(root,'check.test.mjs'),''); git('add','.'); git('commit','-m','fixture');
      const base = git('rev-parse','HEAD').trim();
      const contract = acceptanceContractSchema.parse({schema_version:1,allowed_changed_paths:['check.test.mjs'],checks:[{id:'framework',kind:'node_test',path:'check.test.mjs',min_cases:1}]});
      for (const [name, text, expected] of [
        ['original', `import assert from 'node:assert'; assert.strictEqual(100,100);`, 'failed'],
        ['repaired', `${prefix} test('boundary', () => assert.equal(100,100));`, 'passed']
      ] as const) {
        await writeFile(path.join(root,'check.test.mjs'),text);
        const patch = Buffer.from(git('diff','--binary'));
        const directory = path.join(root,name); await mkdir(path.join(directory,'artifacts'),{recursive:true,mode:0o700});
        await writeFile(path.join(directory,'artifacts','diff.patch'),patch,{mode:0o600});
        const captured = await captureVerification({directory,source:root,base,patch,contract,executionState:'completed',stopReason:'end_turn',maxBytes:1024*1024});
        expect(captured.status).toBe(expected);
        expect(captured.checks.find(check => check.id === 'framework')).toMatchObject({status:expected});
        await writeFile(path.join(root,'check.test.mjs'),'worker changed after export');
        expect((await verifySaved(directory,contract,1024*1024)).status).toBe(expected);
        expect(await readFile(path.join(root,'check.test.mjs'),'utf8')).toBe('worker changed after export');
      }
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
