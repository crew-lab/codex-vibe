import { describe, expect, it } from 'vitest';
import { buildChildEnvironment } from '../../src/security/environment.js';

describe('child environment filtering', () => {
  it('forwards only the allowlisted names and LC_* and marks the child', () => {
    const child = buildChildEnvironment({ HOME: '/real-home', PATH: '/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: '/tmp', MISTRAL_API_KEY: 'key', UNRELATED_USER_STATE: 'x', VIBE_SUPERVISOR_ORIGINAL_HOME: '/attacker/supplied', VIBE_HOME: '/user/vibe' });
    expect(Object.keys(child).sort()).toEqual(['HOME', 'LANG', 'LC_ALL', 'MISTRAL_API_KEY', 'PATH', 'TMPDIR', 'VIBE_SUPERVISOR_CHILD']);
    expect(child.VIBE_SUPERVISOR_CHILD).toBe('1');
  });

  it('adds only explicitly named extra variables', () => {
    const child = buildChildEnvironment({ PATH: '/bin', EXTRA_ONE: '1', EXTRA_TWO: '2' }, ['EXTRA_ONE']);
    expect(child.EXTRA_ONE).toBe('1');
    expect(child.EXTRA_TWO).toBeUndefined();
  });
});
