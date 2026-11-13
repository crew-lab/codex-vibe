import { describe, expect, it } from 'vitest';
import { isSupportedVibeVersion, selectedVibeVersion } from '../../src/backends/app-server/supported-vibe.js';

describe('minimum Vibe version policy', () => {
  it.each(['3.1.2', '3.1.3', '3.1.4', '3.2.0', '3.10.0', '4.0.0', '10.0.0'])('accepts stable version %s', (version) => {
    expect(isSupportedVibeVersion(version)).toBe(true);
    expect(selectedVibeVersion(version)).toBe(version);
  });

  it.each(['2.99.99', '3.0.2', '3.1.0', '3.1.1', '3.1.2rc1', '3.1.2-beta', '3.1.4rc1', '3.1.4+local', '3.0', '03.0.4', 'latest', '', '3.1.4\n'])('rejects unsupported version %s', (version) => {
    expect(isSupportedVibeVersion(version)).toBe(false);
    expect(() => selectedVibeVersion(version)).toThrow();
  });

  it('compares numeric components and permits an explicit higher minimum', () => {
    expect(selectedVibeVersion(undefined)).toBe('3.1.2');
    expect(isSupportedVibeVersion('3.10.0', '3.9.0')).toBe(true);
    expect(isSupportedVibeVersion('3.1.4', '3.2.0')).toBe(false);
    expect(isSupportedVibeVersion('4.0.0', '3.2.0')).toBe(true);
    expect(isSupportedVibeVersion('3.1.4', 'garbage')).toBe(false);
  });
});
