import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ mutate: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    return new Proxy(handle, { get(target, property) {
      if (property === 'read') return async (...readArgs: Parameters<typeof target.read>) => {
        const result = await target.read(...readArgs);
        if (state.mutate) { state.mutate = false; await actual.writeFile(args[0], 'mutated'); }
        return result;
      };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
});
import { readInputFile } from '../../src/reporting/private-files.js';

it('rejects mutation after reading begins', async () => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'intake-race-'));
  try {
    const file = path.join(root, 'input'); await writeFile(file, 'initial');
    state.mutate = true;
    await expect(readInputFile(file, 100, 'patch')).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT', details: { role: 'patch', reason: 'changed' } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
