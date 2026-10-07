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
    const launch = await buildVibeLaunch(vibe, 'programmatic', ['--agent', 'plan'], profile, scratch, { promptText: TASK });
    expect(JSON.stringify([launch.command, ...launch.args])).not.toContain(TASK);
    expect(launch.args).not.toContain('--prompt');
    const promptFile = launch.env[PROMPT_FILE_ENV];
    expect(promptFile).toBe(path.join(scratch, PROMPT_FILE_NAME));
    const info = await stat(promptFile as string);
    expect(info.mode & 0o777).toBe(0o600);
    expect(await readFile(promptFile as string, 'utf8')).toBe(TASK);
    expect(JSON.stringify(Object.entries(launch.env).filter(([key]) => key !== PROMPT_FILE_ENV))).not.toContain(TASK);
  });

  it('does not create a prompt file for ACP and refuses one', async () => {
    const launch = await buildVibeLaunch(vibe, 'acp', [], profile, scratch);
    expect(launch.env[PROMPT_FILE_ENV]).toBeUndefined();
    await expect(buildVibeLaunch(vibe, 'acp', [], profile, scratch, { promptText: TASK })).rejects.toThrow(/programmatic/);
  });

  it('refuses to overwrite an existing prompt file', async () => {
    await buildVibeLaunch(vibe, 'programmatic', [], profile, scratch, { promptText: TASK });
    await expect(buildVibeLaunch(vibe, 'programmatic', [], profile, scratch, { promptText: 'other' })).rejects.toThrow();
  });
});

describe('rate limit classification', () => {
  it.each([
    'HTTP 429 Too Many Requests',
    'Rate limit exceeded (429): too many requests',
    'status code: 429',
    'API error 429',
    'rate-limited by the provider',
    'Too many requests, retry later'
  ])('recognizes %s', (text) => {
    expect(rateLimitFailure(text)).toMatchObject({ code: 'VSUP_RATE_LIMITED', retryable: true });
  });

  it.each(['processed 4290 files', 'exit code 1', 'Unauthorized (401): missing api key', 'line 1429 failed', ''])('ignores %s', (text) => {
    expect(rateLimitFailure(text)).toBeUndefined();
  });

  it('classifies a start failure whose stderr reports a rate limit', async () => {
    expect(await classifyStartFailure('acp', 'vibe-acp', new Error('boom'), 'error: HTTP 429 Too Many Requests')).toMatchObject({ code: 'VSUP_RATE_LIMITED', retryable: true });
  });
});
