# Orders

Prices are integer cents.

## Order total

1. The subtotal is the sum of `unitCents * quantity` over the lines.
2. A discount code is a percentage taken off the subtotal, before tax.
3. Tax is 20% of the discounted subtotal, rounded to the nearest cent.
4. Shipping is free when the subtotal, before discount and tax, is at least 5000 cents; otherwise it is 499 cents.
5. The total is the discounted subtotal plus tax plus shipping.

## Stock

- `reserve(stock, sku, quantity)` moves `quantity` from available to reserved. It throws `RangeError` when fewer are available and `UnknownSkuError` for an unknown SKU, and changes nothing when it throws.
- `release(stock, sku, quantity)` moves `quantity` from reserved back to available. It throws `RangeError` when more than the reserved quantity is released and `UnknownSkuError` for an unknown SKU, and changes nothing when it throws.
