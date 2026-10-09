import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
    const hit = await marker(dir, 'vibe');
    process.chdir(dir);
    process.env.PATH = empty;
    const report = await runDoctor({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe: 'vibe' } });
    expect(report.checks.find((check) => check.name === 'vibe')).toMatchObject({ ok: false, message: expect.stringContaining('not found') });
    expect(existsSync(hit)).toBe(false);
  });

  it('resolves a bare configured name through PATH', async () => {
    const dir = await tempDir();
    const bin = path.join(dir, 'bin'); await mkdir(bin);
    const hit = await marker(bin, 'vibe');
    process.env.PATH = bin;
    const report = await runDoctor({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe: 'vibe' } });
    expect(report.checks.find((check) => check.name === 'vibe')?.message).not.toContain('not found');
    await expect(readFile(hit, 'utf8')).resolves.toContain('hit');
  });

  it('rejects a relative configured path with a separator without executing it', async () => {
    const dir = await tempDir();
    const hit = await marker(dir, 'vibe');
    process.chdir(dir);
    const report = await runDoctor({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe: './vibe', vibeAcp: 'sub/vibe-acp' } });
    expect(report.checks.find((check) => check.name === 'vibe')).toMatchObject({ ok: false, message: expect.stringContaining('relative') });
    expect(report.checks.find((check) => check.name === 'vibe-acp')).toMatchObject({ ok: false, message: expect.stringContaining('relative') });
    expect(existsSync(hit)).toBe(false);
  });

  it('uses an absolute configured path directly', async () => {
    const dir = await tempDir();
    const hit = await marker(dir, 'vibe');
    const report = await runDoctor({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe: path.join(dir, 'vibe') } });
    expect(report.checks.find((check) => check.name === 'vibe')?.version).toContain('0.0.0');
    expect(existsSync(hit)).toBe(true);
  });
});
