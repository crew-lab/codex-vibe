import test from 'node:test';
import assert from 'node:assert/strict';
import { createStock, reserve, reserveAll } from '../src/inventory.mjs';
import { InsufficientStockError, UnknownSkuError } from '../src/errors.mjs';

const snapshot = (stock) => JSON.stringify([...stock.entries()]);

test('reserves every item when all are available', () => {
  const stock = createStock([['apple', 5], ['pear', 3]]);
  reserveAll(stock, [{ sku: 'apple', quantity: 2 }, { sku: 'pear', quantity: 3 }]);
  assert.deepEqual(stock.get('apple'), { available: 3, reserved: 2 });
  assert.deepEqual(stock.get('pear'), { available: 0, reserved: 3 });
});

test('a shortage on a later item changes nothing', () => {
  const stock = createStock([['apple', 5], ['pear', 1]]);
  const before = snapshot(stock);
  assert.throws(() => reserveAll(stock, [{ sku: 'apple', quantity: 2 }, { sku: 'pear', quantity: 2 }]), (error) => error instanceof InsufficientStockError && error.sku === 'pear');
  assert.equal(snapshot(stock), before);
});

test('an unknown SKU changes nothing', () => {
  const stock = createStock([['apple', 5]]);
  const before = snapshot(stock);
  assert.throws(() => reserveAll(stock, [{ sku: 'apple', quantity: 1 }, { sku: 'plum', quantity: 1 }]), UnknownSkuError);
  assert.equal(snapshot(stock), before);
});

test('repeated SKUs are counted together', () => {
  const stock = createStock([['apple', 3]]);
  const before = snapshot(stock);
  assert.throws(() => reserveAll(stock, [{ sku: 'apple', quantity: 2 }, { sku: 'apple', quantity: 2 }]), InsufficientStockError);
  assert.equal(snapshot(stock), before);
});

test('InsufficientStockError is an Error with its name', () => {
  const error = new InsufficientStockError('apple');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'InsufficientStockError');
  assert.equal(error.sku, 'apple');
});

test('reserve keeps its RangeError for a single shortage', () => {
  assert.throws(() => reserve(createStock([['apple', 1]]), 'apple', 2), RangeError);
});
