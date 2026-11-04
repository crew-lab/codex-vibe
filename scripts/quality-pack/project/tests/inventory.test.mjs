import test from 'node:test';
import assert from 'node:assert/strict';
import { createStock, release, reserve } from '../src/inventory.mjs';
import { UnknownSkuError } from '../src/errors.mjs';

test('reserve moves stock from available to reserved', () => {
  const stock = createStock([['apple', 5]]);
  reserve(stock, 'apple', 2);
  assert.deepEqual(stock.get('apple'), { available: 3, reserved: 2 });
});

test('release refuses more than was reserved', () => {
  const stock = createStock([['apple', 5]]);
  reserve(stock, 'apple', 1);
  assert.throws(() => release(stock, 'apple', 2), RangeError);
  assert.deepEqual(stock.get('apple'), { available: 4, reserved: 1 });
});

test('an unknown SKU is refused', () => {
  assert.throws(() => reserve(createStock([]), 'pear', 1), UnknownSkuError);
});
