import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const savedPath = process.env.PATH;

afterEach(async () => {
  if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-launcher-errors-')); roots.push(root);
  const source = path.join(root, 'source'); const data = path.join(root, 'data');
  await mkdir(source);
  return { root, source, data };
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function failedRun(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: 'review', cwd: source, wait_seconds: 0 });
  const until = Date.now() + 5_000;
  let status = await manager.status({ run_id: started.run_id });
  while (!['failed', 'cancelled', 'completed'].includes(String(status.state)) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    status = await manager.status({ run_id: started.run_id });
  }
  return status;
}

describe('programmatic launcher errors identify missing runtime components', () => {
  it('reports an absolute shebang interpreter that does not exist', async () => {
    const { root, source, data } = await makeRoot();
    const script = path.join(root, 'vibe');
    await writeExecutable(script, '#!/nonexistent/dir/python3\n');
    const config = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], paths: { vibe: script } };
    const backend = new ProgrammaticBackend(config);
    const probe = await backend.probe();
    expect(probe.available).toBe(false);
    expect(probe.details).toMatchObject({ interpreter_missing: true, interpreter: '/nonexistent/dir/python3' });
    expect(probe.details?.executable_missing).toBeUndefined();
    const manager = new RunManager(config, data, [backend]);
    try {
      const status = await failedRun(manager, source);
      expect(status.error).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND', message: expect.stringContaining('/nonexistent/dir/python3') });
      expect(JSON.stringify(status.error)).toMatch(/interpreter/i);
    } finally { await manager.shutdown(); }
  });

  it('reports a python3 interpreter that is not on PATH', async () => {
    const { root, source, data } = await makeRoot();
    const script = path.join(root, 'vibe');
    await writeExecutable(script, '#!/usr/bin/env python3\n');
    const empty = path.join(root, 'empty-path'); await mkdir(empty);
    process.env.PATH = empty;
    const config = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], paths: { vibe: script } };
    const backend = new ProgrammaticBackend(config);
    const probe = await backend.probe();
    expect(probe.available).toBe(false);
    expect(probe.details?.executable_missing).toBeUndefined();
    const manager = new RunManager(config, data, [backend]);
    try {
      expect((await failedRun(manager, source)).error).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND', message: expect.stringContaining('python3') });
    } finally { await manager.shutdown(); }
  });

  it('reports a configured Vibe executable that does not exist', async () => {
    const { root, source, data } = await makeRoot();
    const missing = path.join(root, 'no-such-vibe');
    const config = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], paths: { vibe: missing } };
    const backend = new ProgrammaticBackend(config);
    const probe = await backend.probe();
    expect(probe.details).toMatchObject({ executable_missing: true });
    const manager = new RunManager(config, data, [backend]);
    try { expect((await failedRun(manager, source)).error).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND' }); }
    finally { await manager.shutdown(); }
  });
});
