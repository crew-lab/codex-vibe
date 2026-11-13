import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { acceptanceContractSchema } from '../../src/acceptance/schema.js';
import { editStartSchema, reviewStartSchema } from '../../src/mcp/schemas.js';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');
const pack = path.join(repo, 'scripts', 'quality-pack');
const script = path.join(repo, 'scripts', 'quality-pack.mjs');
const grantFields = { authorization_id: true, attempt_id: true, readiness_receipt: true } as const;
const roots: string[] = [];

interface Task { id: string; operation: 'review' | 'edit'; acceptance_contract?: unknown; allowed_write_paths?: string[]; context_files?: string[]; expected?: { pattern: string }[] }

async function scratch(): Promise<string> {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'quality-pack-test-'));
  roots.push(root);
  return root;
}

async function tasks(): Promise<Task[]> {
  const names = (await readdir(path.join(pack, 'tasks'))).filter((name) => name.endsWith('.json'));
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(pack, 'tasks', name), 'utf8')) as Task));
}

async function nodeTest(cwd: string, targets: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await exec(process.execPath, ['--test', '--test-reporter=tap', ...targets], { cwd, timeout: 30_000 });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: String((error as { stdout?: string }).stdout ?? error) };
  }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('quality pack', () => {
  it('writes a start request for every task that the start schemas accept', async () => {
    const fixture = path.join(await scratch(), 'orders');
    const created = JSON.parse((await exec(process.execPath, [script, 'create', fixture])).stdout) as { base_commit: string };
    expect(created.base_commit).toMatch(/^[0-9a-f]{40}$/);
    const all = await tasks();
    expect(all.map((task) => task.id).sort()).toEqual(['edit-reserve-all', 'edit-shipping', 'review-stock', 'review-total']);
    for (const task of all) {
      const { stdout } = await exec(process.execPath, [script, 'request', task.id, '--cwd', fixture]);
      const document = JSON.parse(stdout) as { operation: string; request: Record<string, unknown> };
      expect(document.operation).toBe(task.operation);
      const schema = task.operation === 'edit' ? editStartSchema.omit(grantFields) : reviewStartSchema.omit(grantFields);
      expect(schema.safeParse(document.request).success, task.id).toBe(true);
      if (task.operation === 'edit') {
        expect(acceptanceContractSchema.safeParse(task.acceptance_contract).success, task.id).toBe(true);
        expect(document.request.base_ref).toBe(created.base_commit);
      } else {
        expect(task.expected?.length, task.id).toBeGreaterThan(0);
        for (const expected of task.expected ?? []) expect(() => new RegExp(expected.pattern, 'i')).not.toThrow();
      }
    }
  });

  it('checks review totals against the fixture even when the findings contain the expected keywords', async () => {
    const answer = path.join(await scratch(), 'review.txt');
    const findings = 'src/cart.mjs calculates tax from gross. In shippingFor, subtotalCents > FREE_SHIPPING_FROM_CENTS excludes equality at 5000.';
    const cases = [
      'Input 1: 1000 cents with a 10% discount\nExpected: tax 180, shipping 499, total 1579\nActual: tax 200, shipping 499, total 1599',
      'Input 2: 5000 cents with no discount\nExpected: tax 1000, shipping 0, total 6000\nActual: tax 1000, shipping 499, total 6499',
      'Input 3: 6000 cents with a 50% discount\nExpected: tax 600, shipping 0, total 3600\nActual: tax 1200, shipping 0, total 4200'
    ].join('\n\n');
    const command = [script, 'check', 'review-total', '--answer', answer];

    await writeFile(answer, `${findings}\n\n${cases}\n`);
    expect(JSON.parse((await exec(process.execPath, command)).stdout)).toMatchObject({ passed: true });

    await writeFile(answer, `src/cart.mjs calculates tax from gross. Passing gross to shippingFor causes a 499 charge at 5000.\n\n${cases}\n`);
    await expect(exec(process.execPath, command)).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"id": "threshold-at-5000",\n      "passed": false')
    });

    await writeFile(answer, `${findings}\n\n${cases.replace('Actual: tax 1000, shipping 499, total 6499', 'Actual: tax 1000, shipping 0, total 6000')}\n`);
    await expect(exec(process.execPath, command)).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"id": "input-2-actual",\n      "passed": false')
    });

    await writeFile(answer, findings);
    await expect(exec(process.execPath, command)).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse((await exec(process.execPath, [...command, '--findings-only'])).stdout)).toMatchObject({ passed: true });
  });

  it('ships a project whose own tests pass and whose hidden edit checks fail until the task is done', async () => {
    const copy = path.join(await scratch(), 'project');
    await cp(path.join(pack, 'project'), copy, { recursive: true });
    const ownTests = (await readdir(path.join(copy, 'tests'))).filter((name) => name.endsWith('.test.mjs')).map((name) => `tests/${name}`);
    expect(ownTests.length).toBeGreaterThan(0);
    expect((await nodeTest(copy, ownTests)).ok).toBe(true);
    await mkdir(path.join(copy, 'quality-check'));
    for (const task of (await tasks()).filter((candidate) => candidate.operation === 'edit')) {
      await cp(path.join(pack, 'checks', `${task.id}.test.mjs`), path.join(copy, 'quality-check', `${task.id}.test.mjs`));
      const hidden = await nodeTest(copy, [`quality-check/${task.id}.test.mjs`]);
      expect(hidden.ok, task.id).toBe(false);
      expect(hidden.output, task.id).toMatch(/^# fail [1-9]/m);
    }
  });

  it('runs a new test file added by the edit patch', async () => {
    const root = await scratch();
    const fixture = path.join(root, 'orders');
    const patch = path.join(root, 'shipping.patch');
    await exec(process.execPath, [script, 'create', fixture]);
    const cart = path.join(fixture, 'src', 'cart.mjs');
    await writeFile(cart, (await readFile(cart, 'utf8')).replace('subtotalCents > FREE_SHIPPING_FROM_CENTS', 'subtotalCents >= FREE_SHIPPING_FROM_CENTS'));
    const shipping = path.join(fixture, 'tests', 'shipping.test.mjs');
    const testName = 'runs the test added by the patch';
    const passingTest = [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { shippingFor } from '../src/cart.mjs';",
      `test('${testName}', () => assert.equal(shippingFor(5000), 0));`,
      ''
    ].join('\n');
    await writeFile(shipping, passingTest);
    await exec('git', ['add', '--intent-to-add', '--', 'tests/shipping.test.mjs'], { cwd: fixture });
    const command = [script, 'check', 'edit-shipping', '--patch', patch];
    await writeFile(patch, (await exec('git', ['diff'], { cwd: fixture })).stdout);
    expect(JSON.parse((await exec(process.execPath, command)).stdout)).toMatchObject({
      passed: true,
      checks: expect.arrayContaining([{ id: 'all-tests-pass', passed: true, detail: '11 passed, 0 failed' }])
    });

    await writeFile(shipping, passingTest.replace('shippingFor(5000), 0', 'shippingFor(5000), 499'));
    await writeFile(patch, (await exec('git', ['diff'], { cwd: fixture })).stdout);
    await expect(exec(process.execPath, command)).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining(`10 passed, 1 failed: ${testName}`)
    });
  });
});
