import { percentOf, sum } from './money.mjs';

export const FREE_SHIPPING_FROM_CENTS = 5000;
export const SHIPPING_CENTS = 499;
export const TAX_PERCENT = 20;

export function subtotal(lines) {
  return sum(lines.map((line) => line.unitCents * line.quantity));
}

export function shippingFor(subtotalCents) {
  return subtotalCents > FREE_SHIPPING_FROM_CENTS ? 0 : SHIPPING_CENTS;
}

export function orderTotal(lines, discountPercent = 0) {
  const gross = subtotal(lines);
  const discounted = gross - percentOf(gross, discountPercent);
  const tax = percentOf(gross, TAX_PERCENT);
  return discounted + tax + shippingFor(gross);
}
