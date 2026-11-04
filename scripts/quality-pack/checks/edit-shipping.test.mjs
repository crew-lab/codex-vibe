import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTotal, shippingFor } from '../src/cart.mjs';

test('just below the threshold pays shipping', () => {
  assert.equal(shippingFor(4999), 499);
});

test('exactly the threshold ships free', () => {
  assert.equal(shippingFor(5000), 0);
});

test('above the threshold ships free', () => {
  assert.equal(shippingFor(5001), 0);
});

test('an order of exactly 5000 cents ships free', () => {
  assert.equal(orderTotal([{ unitCents: 2500, quantity: 2 }]), 5000 + 1000);
});
