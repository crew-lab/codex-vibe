#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readStockFile } from '../src/stock-file.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function available(args) {
  const { values, positionals } = parseArgs({ args, options: { sku: { type: 'string' } }, allowPositionals: true });
  const [stockFile] = positionals;
  if (!stockFile) fail('orders available: a stock file is required');
  if (!values.sku) fail('orders available: --sku is required');
  const entry = readStockFile(stockFile).get(values.sku);
  if (!entry) fail(`orders available: unknown SKU ${values.sku}`);
  process.stdout.write(`${entry.available}\n`);
}

const commands = { available };
const [name, ...rest] = process.argv.slice(2);
const command = commands[name];
if (!command) fail(`usage: orders <${Object.keys(commands).join('|')}> ...`);
command(rest);
