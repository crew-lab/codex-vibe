import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin', 'orders.mjs');
const changedFiles = ['bin/orders.mjs', 'src/stock-export.mjs', 'tests/stock-export.test.mjs', 'package.json'];
const expectedCsv = 'sku,available,reserved\napple,5,0\npear,3,0\n';

function withStockFile(callback) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'stock-export-check-'));
  try {
    const stockFile = path.join(directory, 'stock.json');
    writeFileSync(stockFile, '{"pear": 3, "apple": 5}\n');
    return callback(directory, stockFile);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function orders(args, command = [cli]) {
  return spawnSync(process.execPath, [...command, ...args], { cwd: root, encoding: 'utf8' });
}

test('stockCsv lists SKUs in order with available and reserved counts', async () => {
  const { stockCsv } = await import('../src/stock-export.mjs');
  const { createStock, reserve } = await import('../src/inventory.mjs');
  const stock = createStock([['pear', 3], ['apple', 5]]);
  reserve(stock, 'apple', 2);
  assert.equal(stockCsv(stock), 'sku,available,reserved\napple,3,2\npear,3,0\n');
});

test('export --out-dir <directory> creates the directory and writes stock.csv', () => {
  withStockFile((directory, stockFile) => {
    const outDir = path.join(directory, 'reports', 'today');
    const run = orders(['export', stockFile, '--out-dir', outDir]);
    assert.equal(run.stderr, '');
    assert.equal(run.status, 0);
    assert.equal(run.stdout, `wrote ${path.join(outDir, 'stock.csv')}\n`);
    assert.equal(readFileSync(path.join(outDir, 'stock.csv'), 'utf8'), expectedCsv);
  });
});

test('export --out-dir=<directory> is the same flag', () => {
  withStockFile((directory, stockFile) => {
    const outDir = path.join(directory, 'out');
    const run = orders(['export', stockFile, `--out-dir=${outDir}`]);
    assert.equal(run.stderr, '');
    assert.equal(run.status, 0);
    assert.equal(readFileSync(path.join(outDir, 'stock.csv'), 'utf8'), expectedCsv);
  });
});

test('export without --out-dir fails with the documented message and writes nothing', () => {
  withStockFile((directory, stockFile) => {
    const run = orders(['export', stockFile]);
    assert.equal(run.status, 2);
    assert.equal(run.stderr, 'orders export: --out-dir is required\n');
    assert.equal(run.stdout, '');
    assert.equal(existsSync(path.join(root, 'stock.csv')), false);
  });
});

test('export without a stock file fails with the documented message first', () => {
  withStockFile((directory) => {
    const outDir = path.join(directory, 'out');
    const run = orders(['export', '--out-dir', outDir]);
    assert.equal(run.status, 2);
    assert.equal(run.stderr, 'orders export: a stock file is required\n');
    assert.equal(existsSync(outDir), false);
    assert.equal(orders(['export']).stderr, 'orders export: a stock file is required\n');
  });
});

test('the export-stock package script runs the export command and the test script is kept', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(scripts.test, 'node --test');
  assert.equal(scripts['export-stock'], 'node bin/orders.mjs export');
  const [program, ...scriptArgs] = scripts['export-stock'].split(' ');
  assert.equal(program, 'node');
  withStockFile((directory, stockFile) => {
    const outDir = path.join(directory, 'out');
    const run = orders([stockFile, '--out-dir', outDir], scriptArgs);
    assert.equal(run.stderr, '');
    assert.equal(run.status, 0);
    assert.equal(readFileSync(path.join(outDir, 'stock.csv'), 'utf8'), expectedCsv);
  });
});

test('the available command keeps its behaviour', () => {
  withStockFile((directory, stockFile) => {
    const run = orders(['available', stockFile, '--sku', 'apple']);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '5\n');
    assert.equal(orders(['available', stockFile]).stderr, 'orders available: --sku is required\n');
  });
});

test('the worker tests run and pass on their own', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/stock-export.test.mjs'], { cwd: root, encoding: 'utf8', env, timeout: 20_000 });
  const output = `${run.stdout}\n${run.stderr}`;
  const passed = Number(/^# pass (\d+)$/m.exec(output)?.[1] ?? 0);
  const failed = Number(/^# fail (\d+)$/m.exec(output)?.[1] ?? -1);
  const failures = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]);
  assert.equal(failed, 0, `tests/stock-export.test.mjs failed: ${failures.join('; ') || output.slice(-600)}`);
  assert.equal(run.status, 0);
  assert.ok(passed >= 4, `tests/stock-export.test.mjs passed ${passed} tests; at least 4 are required`);
});

test('the changed files have no trailing whitespace', () => {
  const offenders = changedFiles.flatMap((file) => {
    const target = path.join(root, file);
    if (!existsSync(target)) return [`${file}: missing`];
    return readFileSync(target, 'utf8').split('\n').flatMap((line, index) => (/[ \t\r]+$/.test(line) ? [`${file}:${index + 1}`] : []));
  });
  assert.deepEqual(offenders, []);
});
