import { execFile } from 'node:child_process';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { buildChildEnvironment, setupHeadlessBrowserNeutralizer } from '../../src/security/environment.js';

const execFileAsync = promisify(execFile);

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

  it('sets up headless browser neutralizer shims that reject launches with sanitized stderr without leaking arguments', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'vsup-neutralizer-test-'));
    try {
      const binDir = path.join(tempDir, '.bin');
      const returned = await setupHeadlessBrowserNeutralizer(binDir);
      expect(returned).toBe(binDir);

      const openStat = await lstat(path.join(binDir, 'open'));
      expect(openStat.mode & 0o777).toBe(0o700);

      const sensitiveUrl = 'https://accounts.google.com/o/oauth2/auth?token=super-secret-12345&state=oauth-state';

      for (const launcher of ['open', 'xdg-open']) {
        const launcherScript = path.join(binDir, launcher);
        let thrownError: (Error & { code?: number; stderr?: string }) | undefined;
        try {
          await execFileAsync(launcherScript, [sensitiveUrl]);
        } catch (error) {
          thrownError = error as Error & { code?: number; stderr?: string };
        }

        expect(thrownError).toBeDefined();
        expect(thrownError.code).toBe(1);
        expect(thrownError.stderr).toBe(`[vibe-supervisor] Blocked unauthorized headless browser launch attempt: ${launcher}\n`);
        expect(thrownError.stderr).not.toContain('super-secret');
        expect(thrownError.stderr).not.toContain('oauth2');
        expect(thrownError.stderr).not.toContain('https');
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('intercepts launcher invocations resolved via PATH with sanitized rejection', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'vsup-path-test-'));
    try {
      const binDir = path.join(tempDir, '.bin');
      await setupHeadlessBrowserNeutralizer(binDir);
      const sensitiveUrl = 'https://accounts.google.com/o/oauth2/auth?token=super-secret-12345&state=oauth-state';

      for (const launcher of ['open', 'xdg-open']) {
        let thrownError: (Error & { code?: number; stderr?: string }) | undefined;
        try {
          await execFileAsync(launcher, [sensitiveUrl], {
            env: {
              PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`
            }
          });
        } catch (error) {
          thrownError = error as Error & { code?: number; stderr?: string };
        }

        expect(thrownError).toBeDefined();
        expect(thrownError?.code).toBe(1);
        expect(thrownError?.stderr).toBe(`[vibe-supervisor] Blocked unauthorized headless browser launch attempt: ${launcher}\n`);
        expect(thrownError?.stderr).not.toContain('super-secret');
        expect(thrownError?.stderr).not.toContain('oauth2');
        expect(thrownError?.stderr).not.toContain('https');
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
