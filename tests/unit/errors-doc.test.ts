import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { REMEDIATION } from '../../src/contracts.js';
import { MEANINGS, errorsDocPath, renderErrorsDoc } from '../../scripts/errors-doc.mjs';

describe('docs/errors.md', () => {
  it('has a meaning for every error code and no stray ones', () => {
    expect(Object.keys(MEANINGS).sort()).toEqual(Object.keys(REMEDIATION).sort());
  });

  it('matches the codes and remedies in the source', async () => {
    const current = await readFile(errorsDocPath, 'utf8');
    expect(current).toBe(renderErrorsDoc(REMEDIATION));
  });
});
