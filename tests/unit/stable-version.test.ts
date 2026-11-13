import { describe, expect, it } from 'vitest';
import { isStableVersionAtLeast } from '../../src/core/stable-version.js';

describe('stable version floor', () => {
  it('accepts the floor and any stable release above it', () => {
    for (const version of ['1.5.8', '1.5.9', '1.5.10', '1.6.0', '2.0.0', '10.0.0']) expect(isStableVersionAtLeast(version, '1.5.8')).toBe(true);
  });

  it('refuses releases below the floor, pre-releases and anything that is not a plain version', () => {
    for (const version of ['1.5.7', '1.4.9', '0.9.9', '1.5.8-beta', '1.5.8+build', 'v1.5.8', ' 1.5.8', '1.5.8 ', '1.5', '1.5.8.1', '01.5.8', '', 'latest', '9'.repeat(80)]) expect(isStableVersionAtLeast(version, '1.5.8')).toBe(false);
    expect(isStableVersionAtLeast('1.5.8', 'latest')).toBe(false);
  });
});
