import { readFileSync } from 'node:fs';
import { createStock } from './inventory.mjs';

export function readStockFile(file) {
  return createStock(Object.entries(JSON.parse(readFileSync(file, 'utf8'))));
}
