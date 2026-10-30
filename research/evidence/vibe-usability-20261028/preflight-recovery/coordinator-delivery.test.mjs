import { test } from 'node:test'
import { strictEqual } from 'node:assert'
import { qualifiesForFreeDelivery } from './delivery.mjs'

test('99 does not qualify', () => {
  strictEqual(qualifiesForFreeDelivery(99), false)
})

test('99.99 does not qualify', () => {
  strictEqual(qualifiesForFreeDelivery(99.99), false)
})

test('100 qualifies', () => {
  strictEqual(qualifiesForFreeDelivery(100), true)
})

test('100.01 qualifies', () => {
  strictEqual(qualifiesForFreeDelivery(100.01), true)
})

test('101 qualifies', () => {
  strictEqual(qualifiesForFreeDelivery(101), true)
})
