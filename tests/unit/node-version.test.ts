import { describe, expect, it } from 'vitest';
import { nodeVersionAtLeast } from '../../src/runtime/node-version.js';
import { nodeRuntimeCheck } from '../../src/diagnostics/doctor.js';

describe('minimum Node engine check', () => {
  it('enforces the declared 20.19.0 floor across minor and major versions', () => {
    expect(nodeVersionAtLeast('20.18.9', '20.19.0')).toBe(false);
    expect(nodeVersionAtLeast('20.19.0', '20.19')).toBe(true);
    expect(nodeVersionAtLeast('20.18.9', '20.19')).toBe(false);
    expect(nodeVersionAtLeast('20.19.0', '20.19.0')).toBe(true);
    expect(nodeVersionAtLeast('20.19.1', '20.19.0')).toBe(true);
    expect(nodeVersionAtLeast('21.0.0', '20.19.0')).toBe(true);
    expect(nodeVersionAtLeast('19.99.99', '20.19.0')).toBe(false);
  });

  it('rejects malformed version strings rather than treating them as supported', () => {
    expect(nodeVersionAtLeast('20.19', '20.19.0')).toBe(false);
    expect(nodeVersionAtLeast('unknown', '20.19.0')).toBe(false);
  });

  it('makes doctor enforce the same declared minimum', () => {
    expect(nodeRuntimeCheck('20.18.9')).toMatchObject({ ok: false, message: 'Node.js 20.19.0 or newer is required.' });
    expect(nodeRuntimeCheck('20.19.0')).toMatchObject({ ok: true, message: 'Supported Node.js runtime (20.19.0 or newer).' });
    expect(nodeRuntimeCheck('24.21.0').ok).toBe(true);
  });
});
