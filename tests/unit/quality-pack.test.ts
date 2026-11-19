import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectNodeTests } from '../../src/acceptance/node-test.js';
import { acceptanceContractSchema } from '../../src/acceptance/schema.js';
import { editStartSchema, reviewStartSchema } from '../../src/mcp/schemas.js';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');
const pack = path.join(repo, 'scripts', 'quality-pack');
const script = path.join(repo, 'scripts', 'quality-pack.mjs');
const grantFields = { authorization_id: true, attempt_id: true, readiness_receipt: true } as const;
const roots: string[] = [];

interface Task { task: string; id: string; operation: 'review' | 'edit'; acceptance_contract?: unknown; allowed_write_paths?: string[]; context_files?: string[]; expected?: { pattern: string }[] }

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
    expect(all.map((task) => task.id).sort()).toEqual(['edit-reserve-all', 'edit-shipping', 'edit-stock-export', 'review-stock', 'review-total']);
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

    const working = 'Working\n\nInput 1: 1000 cents with a 10% discount\n- tax: 20% of 900 = 180; code percentOf(1000, 20) = 200\n\nInput 2: 5000 cents\n- shipping: 5000 > 5000 is false, so 499';
    await writeFile(answer, `${findings}\n\n${working}\n\n${cases}\n`);
    expect(JSON.parse((await exec(process.execPath, command)).stdout)).toMatchObject({ passed: true });

    await writeFile(answer, `${findings}\n\n${cases}\n\n${cases}\n`);
    await expect(exec(process.execPath, command)).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('Expected exactly one input section with Expected and Actual lines, found 2')
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

const stockExportModule = `import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function stockCsv(stock) {
  const rows = [...stock.entries()].sort(([left], [right]) => (left < right ? -1 : 1)).map(([sku, entry]) => \`\${sku},\${entry.available},\${entry.reserved}\`);
  return ['sku,available,reserved', ...rows].map((line) => \`\${line}\\n\`).join('');
}

export function writeStockExport(stock, { outDir }) {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'stock.csv');
  writeFileSync(file, stockCsv(stock));
  return file;
}
`;

const stockExportCommand = `function exportStock(args) {
  const { values, positionals } = parseArgs({ args, options: { 'out-dir': { type: 'string' } }, allowPositionals: true });
  const [stockFile] = positionals;
  if (!stockFile) fail('orders export: a stock file is required');
  const outDir = values['out-dir'];
  if (!outDir) fail('orders export: --out-dir is required');
  process.stdout.write(\`wrote \${writeStockExport(readStockFile(stockFile), { outDir })}\\n\`);
}

const commands = { available, export: exportStock };`;

const stockExportTests = `import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockCsv } from '../src/stock-export.mjs';
import { createStock, reserve } from '../src/inventory.mjs';

const cliPath = fileURLToPath(new URL('../bin/orders.mjs', import.meta.url));

function exportIn(args) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'stock-export-'));
  try {
    writeFileSync(path.join(directory, 'stock.json'), '{"apple": 5}');
    const run = spawnSync(process.execPath, [cliPath, 'export', ...args(directory)], { encoding: 'utf8' });
    return { run, csv: run.status === 0 ? readFileSync(path.join(directory, 'out', 'stock.csv'), 'utf8') : '' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('stockCsv shows a reservation', () => {
  const stock = createStock([['apple', 5]]);
  reserve(stock, 'apple', 2);
  assert.equal(stockCsv(stock), 'sku,available,reserved\\napple,3,2\\n');
});

test('export writes stock.csv', () => {
  assert.equal(exportIn((directory) => [path.join(directory, 'stock.json'), '--out-dir', path.join(directory, 'out')]).csv, 'sku,available,reserved\\napple,5,0\\n');
});

test('export needs --out-dir', () => {
  assert.equal(exportIn((directory) => [path.join(directory, 'stock.json')]).run.stderr, 'orders export: --out-dir is required\\n');
});

test('export needs a stock file', () => {
  assert.equal(exportIn(() => ['--out-dir', 'out']).run.stderr, 'orders export: a stock file is required\\n');
});
`;

async function stockExportPatch(root: string, name: string, change: (files: { cli: string; tests: string }) => { cli: string; tests: string }): Promise<string> {
  const fixture = path.join(root, name);
  await exec(process.execPath, [script, 'create', fixture]);
  const cliFile = path.join(fixture, 'bin', 'orders.mjs');
  const original = await readFile(cliFile, 'utf8');
  const reference = {
    cli: original
      .replace("import { readStockFile } from '../src/stock-file.mjs';", "import { readStockFile } from '../src/stock-file.mjs';\nimport { writeStockExport } from '../src/stock-export.mjs';")
      .replace('const commands = { available };', stockExportCommand),
    tests: stockExportTests
  };
  const files = change(reference);
  await writeFile(cliFile, files.cli);
  await writeFile(path.join(fixture, 'src', 'stock-export.mjs'), stockExportModule);
  await writeFile(path.join(fixture, 'tests', 'stock-export.test.mjs'), files.tests);
  const packageFile = path.join(fixture, 'package.json');
  await writeFile(packageFile, (await readFile(packageFile, 'utf8')).replace('"test": "node --test"', '"test": "node --test",\n    "export-stock": "node bin/orders.mjs export"'));
  await exec('git', ['add', '--intent-to-add', '--', 'src/stock-export.mjs', 'tests/stock-export.test.mjs'], { cwd: fixture });
  const patch = path.join(root, `${name}.patch`);
  await writeFile(patch, (await exec('git', ['diff'], { cwd: fixture })).stdout);
  return patch;
}

async function checkStockExport(patch: string): Promise<{ passed: boolean; checks: { id: string; passed: boolean; detail: string }[] }> {
  const run = await exec(process.execPath, [script, 'check', 'edit-stock-export', '--patch', patch]).catch((error: { stdout: string }) => error);
  return JSON.parse(run.stdout) as { passed: boolean; checks: { id: string; passed: boolean; detail: string }[] };
}

describe('quality pack stock export edit', () => {
  it('passes a working patch and fails the flag-key, temporary-directory and whitespace slips by behaviour', async () => {
    const root = await scratch();
    const reference = await checkStockExport(await stockExportPatch(root, 'reference', (files) => files));
    expect(reference).toMatchObject({ passed: true, checks: expect.arrayContaining([{ id: 'all-tests-pass', passed: true, detail: '19 passed, 0 failed' }]) });

    const slips = {
      'flag-key': (files: { cli: string; tests: string }) => ({ ...files, cli: files.cli.replace("values['out-dir']", 'values.outDir') }),
      'mkdtemp-prefix': (files: { cli: string; tests: string }) => ({ ...files, tests: files.tests.replace("mkdtempSync(path.join(os.tmpdir(), 'stock-export-'))", 'mkdtempSync()') }),
      'trailing-whitespace': (files: { cli: string; tests: string }) => ({ ...files, tests: files.tests.replace("import test from 'node:test';", "import test from 'node:test';  ") })
    };
    const expectedFailures = {
      'flag-key': 'export --out-dir <directory> creates the directory and writes stock.csv',
      'mkdtemp-prefix': 'the worker tests run and pass on their own',
      'trailing-whitespace': 'the changed files have no trailing whitespace'
    };
    for (const [name, slip] of Object.entries(slips)) {
      const result = await checkStockExport(await stockExportPatch(root, name, slip));
      expect(result.passed, name).toBe(false);
      expect(result.checks.filter((item) => !item.passed).map((item) => item.id), name).toEqual(['all-tests-pass']);
      expect(result.checks.find((item) => item.id === 'all-tests-pass')?.detail, name).toContain(expectedFailures[name as keyof typeof expectedFailures]);
    }
  }, 60_000);

  it('gives an empty patch a verdict instead of an error', async () => {
    const patch = path.join(await scratch(), 'empty.patch');
    await writeFile(patch, '');
    const result = await checkStockExport(patch);
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.id === 'required-paths-changed')).toMatchObject({ passed: false, detail: 'not changed: bin/orders.mjs, src/stock-export.mjs, tests/stock-export.test.mjs, package.json' });
  });
});

const reviewFindings = 'src/cart.mjs calculates tax from gross. In shippingFor, subtotalCents > FREE_SHIPPING_FROM_CENTS excludes equality at 5000.';
const reviewForm = [
  'Input 1: 1000 cents with a 10% discount\nExpected: tax 180, shipping 499, total 1579\nActual: tax 200, shipping 499, total 1599',
  'Input 2: 5000 cents with no discount\nExpected: tax 1000, shipping 0, total 6000\nActual: tax 1000, shipping 499, total 6499',
  'Input 3: 6000 cents with a 50% discount\nExpected: tax 600, shipping 0, total 3600\nActual: tax 1200, shipping 0, total 4200'
].join('\n\n');

async function exportDirectory(root: string, id: string, files: Record<string, string>, taskHash?: string): Promise<string> {
  const definition = (await tasks()).find((candidate) => candidate.id === id) as Task;
  const directory = path.join(root, `export-${id}`);
  await mkdir(directory);
  const report = {
    supervisor_version: '2.3.0', backend: 'app-server', pin: { vibe_version: '3.0.2' },
    answer_present: true, execution: { state: 'completed', stop_reason: 'end_turn' },
    provenance: { task_sha256: taskHash ?? createHash('sha256').update(definition.task).digest('hex'), base_commit: '/private/should/not/leak' },
    models: { thinking: { requested: { value: 'high', source: 'supervisor-session-config' }, status: 'matched', observations: [{ observed_at: 'x', value: 'high', source: 'runtime/read' }] } },
    usage: { promptTokens: 100, completionTokens: 20, modelCalls: 3, toolCalls: { executed: 4, deniedByHandler: 0, deniedByPolicy: 0 } },
    context_reads: { named: 1, read: ['README.md'], unread: [], extra: [] }
  };
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content);
  const sums = ['report.json', ...Object.keys(files)].map((name) => `${createHash('sha256').update(readFileSync(path.join(directory, name))).digest('hex')}  ${name}`).join('\n');
  await writeFile(path.join(directory, 'SHA256SUMS'), `${sums}\n`);
  return directory;
}

describe('quality pack record', () => {
  it('turns a matching review export into one small record and refuses to overwrite it', async () => {
    const root = await scratch();
    const answer = `${reviewFindings}\n\n${reviewForm}\n`;
    const directory = await exportDirectory(root, 'review-total', { 'answer.txt': answer });
    const out = path.join(root, 'record.json');
    const { stdout } = await exec(process.execPath, [script, 'record', 'review-total', '--export', directory, '--out', out]);
    const record = JSON.parse(stdout) as Record<string, unknown>;
    expect(record).toMatchObject({
      task: 'review-total', task_hash_matched: true, passed: true, answer, stop_reason: 'end_turn', execution_state: 'completed', answer_present: true,
      usage: { prompt_tokens: 100, completion_tokens: 20, model_calls: 3, tool_calls: { executed: 4, deniedByHandler: 0, deniedByPolicy: 0 } },
      thinking: { requested: 'high', status: 'matched', observed: ['high'] },
      supervisor_version: '2.3.0', worker: { backend: 'app-server', version: '3.0.2' },
      context_reads: { named: 1, read: ['README.md'], unread: [], extra: [] }
    });
    expect((record.checks as { id: string; detail: string }[]).map((item) => item.id)).toEqual(expect.arrayContaining(['tax-on-undiscounted', 'threshold-at-5000', 'cites-file', 'input-1-expected']));
    expect(JSON.stringify(record)).not.toContain('/private/should/not/leak');
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(record);
    await expect(exec(process.execPath, [script, 'record', 'review-total', '--export', directory, '--out', out])).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('already exists') });
  });

  it('refuses an answer that is not the one listed in the bundle sums', async () => {
    const root = await scratch();
    const directory = await exportDirectory(root, 'review-total', { 'answer.txt': `${reviewFindings}\n\n${reviewForm}\n` });
    await writeFile(path.join(directory, 'answer.txt'), 'answer from another run\n');
    await expect(exec(process.execPath, [script, 'record', 'review-total', '--export', directory])).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('does not match its hash in SHA256SUMS') });
    await writeFile(path.join(directory, 'SHA256SUMS'), '');
    await expect(exec(process.execPath, [script, 'record', 'review-total', '--export', directory])).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('is not listed in SHA256SUMS') });
  });

  it('refuses an export made from another task and names the mismatch', async () => {
    const root = await scratch();
    const directory = await exportDirectory(root, 'review-total', { 'answer.txt': reviewFindings }, 'ab'.repeat(32));
    await expect(exec(process.execPath, [script, 'record', 'review-total', '--export', directory])).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringMatching(/task hash abababababab does not match task review-total/)
    });
    await expect(exec(process.execPath, [script, 'record', 'review-stock', '--export', directory])).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('does not match task review-stock') });
  });

  it('checks an edit export through its patch', async () => {
    const root = await scratch();
    const fixture = path.join(root, 'orders');
    await exec(process.execPath, [script, 'create', fixture]);
    const cart = path.join(fixture, 'src', 'cart.mjs');
    await writeFile(cart, (await readFile(cart, 'utf8')).replace('subtotalCents > FREE_SHIPPING_FROM_CENTS', 'subtotalCents >= FREE_SHIPPING_FROM_CENTS'));
    const added = path.join(fixture, 'tests', 'shipping.test.mjs');
    await writeFile(added, "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { shippingFor } from '../src/cart.mjs';\ntest('free at the threshold', () => assert.equal(shippingFor(5000), 0));\n");
    await exec('git', ['add', '--intent-to-add', '--', 'tests/shipping.test.mjs'], { cwd: fixture });
    const patch = (await exec('git', ['diff'], { cwd: fixture })).stdout;
    const directory = await exportDirectory(root, 'edit-shipping', { 'changes.patch': patch });
    const record = JSON.parse((await exec(process.execPath, [script, 'record', 'edit-shipping', '--export', directory])).stdout) as { passed: boolean; checks: { id: string; passed: boolean }[]; answer?: string };
    expect(record.passed).toBe(true);
    expect(record.checks.map((item) => item.id)).toEqual(['only-allowed-paths', 'required-paths-changed', 'all-tests-pass']);
    expect(record).not.toHaveProperty('answer');
  });
});

describe('quality pack prompt', () => {
  it('prints the worker rules and the task prompt for a review task', async () => {
    const definition = (await tasks()).find((candidate) => candidate.id === 'review-total') as Task;
    const { stdout } = await exec(process.execPath, [script, 'prompt', 'review-total']);
    expect(stdout).toContain('=== Worker rules (vibe, review) ===');
    expect(stdout).toContain('Tools: read_file only.');
    expect(stdout).toContain('=== Task prompt ===');
    for (const file of definition.context_files ?? []) expect(stdout).toContain(`Approved context path: ${file}`);
    expect(stdout).toContain(definition.task);
    expect((await exec(process.execPath, [script, 'prompt', 'review-total', '--worker', 'agy'])).stdout).toContain('=== Worker rules (agy, review) ===');
  });

  it('prints the stock export edit brief with what the coordinator observed and the answer form', async () => {
    const definition = (await tasks()).find((candidate) => candidate.id === 'edit-stock-export') as Task;
    const { stdout } = await exec(process.execPath, [script, 'prompt', 'edit-stock-export']);
    expect(stdout).toContain('=== Worker rules (vibe, edit) ===');
    expect(stdout).toContain(definition.task);
    expect(definition.task).toContain('Observed before the change:');
    expect(definition.task).toContain('You cannot run anything');
    expect(definition.task).toMatch(/Final answer, in this form[^\n]*\nChanged: <path>[^\n]*\nScratch files: <none, or their paths>$/);
    expect(definition).not.toHaveProperty('max_turns');
    expect(definition).not.toHaveProperty('timeout_seconds');
    expect(inspectNodeTests(stockExportTests, 4)).toMatchObject({ passed: true, cases: 4 });
  });
});

describe('quality pack check details', () => {
  it('quotes the nearest line when an Expected or Actual line is malformed, and says when a file is not cited', async () => {
    const answer = path.join(await scratch(), 'review.txt');
    const malformed = reviewForm.replace('Expected: tax 180, shipping 499, total 1579', 'Expected: tax is 180 and shipping is 499');
    await writeFile(answer, `${reviewFindings}\n\n${malformed}\n`);
    const failed = await exec(process.execPath, [script, 'check', 'review-total', '--answer', answer]).catch((error: { stdout: string }) => error);
    const result = JSON.parse((failed as { stdout: string }).stdout) as { checks: { id: string; passed: boolean; detail: string }[] };
    expect(result.checks.find((item) => item.id === 'input-1-expected')).toMatchObject({ passed: false, detail: expect.stringContaining('nearest line: Expected: tax is 180 and shipping is 499') });

    await writeFile(answer, 'The shippingFor strict comparison subtotalCents > FREE_SHIPPING_FROM_CENTS and tax computed from gross are wrong.');
    const uncited = await exec(process.execPath, [script, 'check', 'review-total', '--answer', answer, '--findings-only']).catch((error: { stdout: string }) => error);
    const checks = (JSON.parse((uncited as { stdout: string }).stdout) as { checks: { id: string; passed: boolean; detail: string }[] }).checks;
    expect(checks.find((item) => item.id === 'cites-file')).toMatchObject({ passed: false, detail: 'src/cart.mjs was not found in the answer' });
  });
});
