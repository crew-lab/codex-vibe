import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildVibeLaunch } from '../../src/backends/launcher.js';
import { createVibeChildProfile } from '../../src/backends/profile.js';
import { buildChildEnvironment, ORIGINAL_HOME_ENV } from '../../src/security/environment.js';
import type { StartRunInput } from '../../src/contracts.js';

let scratch = '';
let realHome = '';
const saved = { HOME: process.env.HOME, ORIGINAL: process.env[ORIGINAL_HOME_ENV], OTHER: process.env.UNRELATED_USER_STATE };

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'original-home-test-')));
  realHome = path.join(scratch, 'real-home');
  await mkdir(realHome);
  process.env.HOME = realHome;
  process.env.UNRELATED_USER_STATE = 'unrelated-user-state-canary';
  process.env[ORIGINAL_HOME_ENV] = '/attacker/supplied';
});
afterEach(async () => {
  for (const [key, value] of [['HOME', saved.HOME], [ORIGINAL_HOME_ENV, saved.ORIGINAL], ['UNRELATED_USER_STATE', saved.OTHER]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(scratch, { recursive: true, force: true });
});

function input(runDirectory: string, workspace: string): StartRunInput {
  return {
    runId: '00000000-0000-4000-8000-000000000000', mode: 'review', task: 'task', cwd: workspace, workerWorkspace: workspace, runDirectory,
    limits: { maxTurns: 2, timeoutSeconds: 30, maxTranscriptBytes: 1024, maxEventBytes: 1024, maxArtifactBytes: 1024 },
  };
}

describe('original HOME handoff to the launcher shim', () => {
  it('carries the real HOME in exactly one variable while the child HOME stays private', async () => {
    const runDirectory = path.join(scratch, 'run');
    const workspace = path.join(scratch, 'workspace');
    await mkdir(runDirectory); await mkdir(workspace);
    const vibe = path.join(scratch, 'vibe');
    await writeFile(vibe, '#!/usr/bin/env python3\n');
    await chmod(vibe, 0o755);
    const profile = await createVibeChildProfile(input(runDirectory, workspace), 'review', { forwardOriginalHome: true });
    const launch = await buildVibeLaunch(vibe, [], profile, runDirectory);
    expect(launch.env[ORIGINAL_HOME_ENV]).toBe(realHome);
    expect(launch.env.HOME).toBe(path.join(runDirectory, 'child-home'));
    expect(launch.env.VIBE_HOME).toBe(path.join(runDirectory, 'vibe-home'));
    expect(Object.entries(launch.env).filter(([, value]) => value === realHome).map(([key]) => key)).toEqual([ORIGINAL_HOME_ENV]);
    expect(launch.env.UNRELATED_USER_STATE).toBeUndefined();
    expect(JSON.stringify([launch.command, ...launch.args])).not.toContain(realHome);
  });

  it('omits the original-HOME variable unless the caller is a real run', async () => {
    const runDirectory = path.join(scratch, 'run');
    const workspace = path.join(scratch, 'workspace');
    await mkdir(runDirectory); await mkdir(workspace);
    const profile = await createVibeChildProfile(input(runDirectory, workspace), 'review');
    expect(profile.env[ORIGINAL_HOME_ENV]).toBeUndefined();
    expect(Object.values(profile.env)).not.toContain(realHome);
  });

  it('does not forward the original-HOME variable or other user state from the ambient environment', () => {
    const child = buildChildEnvironment({ HOME: realHome, PATH: '/bin', [ORIGINAL_HOME_ENV]: '/attacker/supplied', UNRELATED_USER_STATE: 'x' });
    expect(child[ORIGINAL_HOME_ENV]).toBeUndefined();
    expect(child.UNRELATED_USER_STATE).toBeUndefined();
  });
});
