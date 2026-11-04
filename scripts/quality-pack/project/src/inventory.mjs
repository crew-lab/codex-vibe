import { UnknownSkuError } from './errors.mjs';

export function createStock(entries) {
  return new Map(entries.map(([sku, available]) => [sku, { available, reserved: 0 }]));
}

function entryFor(stock, sku) {
  const entry = stock.get(sku);
  if (!entry) throw new UnknownSkuError(sku);
  return entry;
}

export function reserve(stock, sku, quantity) {
  const entry = entryFor(stock, sku);
  if (quantity > entry.available) throw new RangeError(`only ${entry.available} of ${sku} available`);
  entry.available -= quantity;
  entry.reserved += quantity;
}

export function release(stock, sku, quantity) {
  const entry = entryFor(stock, sku);
  if (quantity > entry.reserved) throw new RangeError(`only ${entry.reserved} of ${sku} reserved`);
  entry.reserved -= quantity;
  entry.available += quantity;
}
