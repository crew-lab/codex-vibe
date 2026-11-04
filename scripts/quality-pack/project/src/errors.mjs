export class UnknownSkuError extends Error {
  constructor(sku) {
    super(`unknown SKU ${sku}`);
    this.name = 'UnknownSkuError';
    this.sku = sku;
  }
}
