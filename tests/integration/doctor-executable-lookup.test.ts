import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { runDoctor } from '../../src/diagnostics/doctor.js';

const dirs: string[] = [];
const savedCwd = process.cwd();
const savedPath = process.env.PATH;
const savedHome = process.env.VIBE_SUPERVISOR_HOME;

afterEach(async () => {
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env.VIBE_SUPERVISOR_HOME; else process.env.VIBE_SUPERVISOR_HOME = savedHome;
  if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-doctor-lookup-')));
  dirs.push(dir);
  process.env.VIBE_SUPERVISOR_HOME = path.join(dir, 'data');
  return dir;
}

async function marker(dir: string, name: string): Promise<string> {
  const file = path.join(dir, name);
  const hit = path.join(dir, `${name}.hit`);
  await writeFile(file, `#!/bin/sh\necho hit > ${JSON.stringify(hit)}\necho "vibe 0.0.0"\n`);
  await chmod(file, 0o755);
  return hit;
}

describe('doctor executable lookup', () => {
  it('never resolves a bare configured name against the current directory', async () => {
    const dir = await tempDir();
    const empty = path.join(dir, 'empty'); await mkdir(empty);
    const hit = await marker(dir, 'vibe-app-server');
    process.chdir(dir);
    process.env.PATH = empty;
    const report = await runDoctor({ ...DEFAULT_CONFIG, paths: { vibeAppServer: 'vibe-app-server' } });
    expect(report.checks.find((check) => check.name === 'vibe')).toMatchObject({ ok: false, message: expect.stringContaining('not found') });
    expect(existsSync(hit)).toBe(false);
  });

  it('resolves a bare configured name through PATH', async () => {
    const dir = await tempDir();
    const bin = path.join(dir, 'bin'); await mkdir(bin);
    const hit = await marker(bin, 'vibe-app-server');
    process.env.PATH = bin;
    const report = await runDoctor({ ...DEFAULT_CONFIG, paths: { vibeAppServer: 'vibe-app-server' } });
    expect(report.checks.find((check) => check.name === 'vibe')?.message).not.toContain('not found');
    expect(existsSync(hit)).toBe(false);
  });

  it('rejects a relative configured path with a separator without executing it', async () => {
    const dir = await tempDir();
    const hit = await marker(dir, 'vibe-app-server');
    process.chdir(dir);
    const report = await runDoctor({ ...DEFAULT_CONFIG, paths: { vibeAppServer: './vibe-app-server' } });
    expect(report.checks.find((check) => check.name === 'vibe')).toMatchObject({ ok: false, message: expect.stringContaining('relative') });
    expect(existsSync(hit)).toBe(false);
  });

  it('uses an absolute configured path directly', async () => {
    const dir = await tempDir();
    const hit = await marker(dir, 'vibe-app-server');
    const report = await runDoctor({ ...DEFAULT_CONFIG, paths: { vibeAppServer: path.join(dir, 'vibe-app-server') } });
    expect(report.checks.find((check) => check.name === 'vibe')).toMatchObject({ ok: false, message: expect.stringContaining('verification failed') });
    expect(existsSync(hit)).toBe(false);
  });

  it('accepts a home-relative workspace root', async () => {
    const dir = await tempDir();
    const home = path.join(dir, 'home'); await mkdir(path.join(home, 'project'), { recursive: true });
    const savedHomeVar = process.env.HOME;
    process.env.HOME = home;
    try {
      const report = await runDoctor({ ...DEFAULT_CONFIG, allowedWorkspaceRoots: ['~/project'], paths: { vibeAppServer: 'vibe-app-server' } });
      expect(report.checks.find((check) => check.name === 'workspace-roots')).toMatchObject({ ok: true, message: expect.stringContaining('1/1') });
    } finally { if (savedHomeVar === undefined) delete process.env.HOME; else process.env.HOME = savedHomeVar; }
  });
});
