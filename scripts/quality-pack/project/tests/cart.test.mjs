import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTotal, subtotal } from '../src/cart.mjs';

test('subtotal multiplies unit price by quantity', () => {
  assert.equal(subtotal([{ unitCents: 250, quantity: 2 }, { unitCents: 100, quantity: 1 }]), 600);
});

test('a small order pays tax and shipping', () => {
  assert.equal(orderTotal([{ unitCents: 1000, quantity: 1 }]), 1000 + 200 + 499);
});

test('a large order ships free', () => {
  assert.equal(orderTotal([{ unitCents: 3000, quantity: 2 }]), 6000 + 1200);
});
