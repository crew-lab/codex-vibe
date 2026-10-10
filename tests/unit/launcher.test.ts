import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildVibeLaunch, classifyStartFailure, PROMPT_FILE_ENV, PROMPT_FILE_NAME, rateLimitFailure } from '../../src/backends/launcher.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';

const TASK = 'task-canary-never-in-argv-7c1d';
let scratch = '';
let vibe = '';
let profile: VibeChildProfile;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'launcher-test-')));
  vibe = path.join(scratch, 'vibe');
  await writeFile(vibe, '#!/usr/bin/env python3\n');
  await chmod(vibe, 0o755);
  profile = { env: { PATH: process.env.PATH ?? '' } } as unknown as VibeChildProfile;
});
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

describe('buildVibeLaunch prompt handoff', () => {
  it('writes the prompt to an owner-only file in the run directory and keeps it out of argv', async () => {
    const launch = await buildVibeLaunch(vibe, ['--agent', 'plan'], profile, scratch, { promptText: TASK });
    expect(JSON.stringify([launch.command, ...launch.args])).not.toContain(TASK);
    expect(launch.args).not.toContain('--prompt');
    const promptFile = launch.env[PROMPT_FILE_ENV];
    expect(promptFile).toBe(path.join(scratch, PROMPT_FILE_NAME));
    const info = await stat(promptFile as string);
    expect(info.mode & 0o777).toBe(0o600);
    expect(await readFile(promptFile as string, 'utf8')).toBe(TASK);
    expect(JSON.stringify(Object.entries(launch.env).filter(([key]) => key !== PROMPT_FILE_ENV))).not.toContain(TASK);
  });

  it('always hands a programmatic task through the private prompt file', async () => {
    const launch = await buildVibeLaunch(vibe, [], profile, scratch);
    expect(launch.env[PROMPT_FILE_ENV]).toBeUndefined();
    await buildVibeLaunch(vibe, [], profile, scratch, { promptText: TASK });
    expect(launch.env.VIBE_SUPERVISOR_ENTRYPOINT).toBeUndefined();
  });

  it('refuses to overwrite an existing prompt file', async () => {
    await buildVibeLaunch(vibe, [], profile, scratch, { promptText: TASK });
    await expect(buildVibeLaunch(vibe, [], profile, scratch, { promptText: 'other' })).rejects.toThrow();
  });
});

describe('rate limit classification', () => {
  it.each([
    'HTTP 429 Too Many Requests',
    'Rate limit exceeded (429): too many requests',
    'status code: 429',
    'API error 429',
    'Too many requests, retry later'
  ])('recognizes %s', (text) => {
    expect(rateLimitFailure(text)).toMatchObject({ code: 'VSUP_RATE_LIMITED', retryable: true });
  });

  it.each(['processed 4290 files', 'exit code 1', 'Unauthorized (401): missing api key', 'line 1429 failed', 'x-ratelimit-limit: 100', 'Retrying after rate limit in 5s', 'rate-limited by the provider', ''])('ignores %s', (text) => {
    expect(rateLimitFailure(text)).toBeUndefined();
  });

  it('reads a 401 before any rate-limit text', async () => {
    expect(await classifyStartFailure('vibe', new Error('boom'), 'HTTP 401 Unauthorized\nx-ratelimit-limit: 100')).toMatchObject({ code: 'VSUP_AUTH_REQUIRED' });
  });

  it('reports a missing interpreter even when stderr mentions a 429', async () => {
    const orphan = path.join(scratch, 'orphan-vibe');
    await writeFile(orphan, '#!/nonexistent/interpreter\n');
    await chmod(orphan, 0o755);
    const failure = await classifyStartFailure(orphan, Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), 'HTTP 429 Too Many Requests');
    expect(failure).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND', details: { interpreter_missing: true, interpreter: '/nonexistent/interpreter' } });
  });

  it('reports a missing executable even when stderr mentions a 429', async () => {
    const failure = await classifyStartFailure(path.join(scratch, 'absent'), Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), 'HTTP 429 Too Many Requests');
    expect(failure).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND' });
  });

  it('classifies a start failure whose stderr reports a rate limit', async () => {
    expect(await classifyStartFailure('vibe', new Error('boom'), 'error: HTTP 429 Too Many Requests')).toMatchObject({ code: 'VSUP_RATE_LIMITED', retryable: true });
  });
});
