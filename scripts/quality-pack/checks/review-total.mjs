import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CASES = [
  { unitCents: 1000, quantity: 1, discountPercent: 10, expected: [180, 499, 1579] },
  { unitCents: 2500, quantity: 2, discountPercent: 0, expected: [1000, 0, 6000] },
  { unitCents: 3000, quantity: 2, discountPercent: 50, expected: [600, 0, 3600] }
];

function checkValues(id, section, values, reference) {
  const line = new RegExp(`^${section}: tax (\\d+), shipping (\\d+), total (\\d+)$`, 'gim');
  const matches = [...values.matchAll(line)];
  const match = matches.length === 1 ? matches[0] : undefined;
  const reported = match?.slice(1).map(Number);
  return {
    id: `${id}-${section.toLowerCase()}`,
    passed: reported?.every((value, index) => value === reference[index]) ?? false,
    detail: `tax, shipping, total: reported ${reported?.join(', ') ?? 'missing, malformed or duplicated'}; verified ${reference.join(', ')}`
  };
}

export async function checkOrderTotalCases(project, answer) {
  const scratch = await mkdtemp(path.join(await realpath(os.tmpdir()), 'quality-review-total-'));
  try {
    await cp(project, scratch, { recursive: true });
    const { orderTotal, shippingFor } = await import(pathToFileURL(path.join(scratch, 'src/cart.mjs')).href);
    const sections = answer.replaceAll('\r\n', '\n').split(/^Input (\d+):[^\n]*$/im);
    return CASES.flatMap(({ unitCents, quantity, discountPercent, expected }, index) => {
      const id = `input-${index + 1}`;
      const rows = sections.filter((section, part) => part % 2 === 0 && part > 0 && sections[part - 1] === String(index + 1) && /^(Expected|Actual):/im.test(section));
      if (rows.length !== 1) return [{ id, passed: false, detail: `Expected exactly one input section with Expected and Actual lines, found ${rows.length}` }];
      const gross = unitCents * quantity;
      const discounted = gross - Math.round(gross * discountPercent / 100);
      const shipping = shippingFor(gross);
      const total = orderTotal([{ unitCents, quantity }], discountPercent);
      const actual = [total - discounted - shipping, shipping, total];
      return [checkValues(id, 'Expected', rows[0], expected), checkValues(id, 'Actual', rows[0], actual)];
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
