import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { AcpBackend } from '../../src/backends/acp.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';
import { RunManager } from '../../src/core/run-manager.js';
import { runDoctor } from '../../src/diagnostics/doctor.js';

const canonicalTmp = await realpath(tmpdir());
const KEY = 'q7Zk2mXp9WvLc4Nb8RtYs1DfGh3JaE6u';
const roots: string[] = [];
const savedKey = process.env.MISTRAL_API_KEY;

afterEach(async () => {
  if (savedKey === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = savedKey;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-stderr-secret-')); roots.push(root);
  return root;
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function fakeVibeAcp(root: string, pythonBody: string): Promise<string> {
  const python = path.join(root, 'fake-python');
  await writeExecutable(python, `#!/bin/sh\n${pythonBody}\n`);
  const script = path.join(root, 'vibe-acp');
  await writeExecutable(script, `#!${python}\n`);
  return script;
}

async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(entry.parentPath ?? directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(full)); else found.push(full);
  }
  return found;
}

async function expectKeyAbsent(label: string, key: string, values: unknown[], directory?: string): Promise<void> {
  for (const value of values) expect(JSON.stringify(value), label).not.toContain(key);
  if (!directory) return;
  for (const file of await filesUnder(directory)) {
    if (file.endsWith('.py')) continue;
    let text: string;
    try { text = await readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    expect(text, `${label}: ${file}`).not.toContain(key);
  }
}

const bearerText = `${'p'.repeat(500)} Bearer ${KEY}\n${'q'.repeat(1001)}`;

describe('stderr tails never carry a secret', () => {
  it('redacts a bare 32-character key from the environment in the ACP probe, the run error, meta.json, events and doctor', async () => {
    process.env.MISTRAL_API_KEY = KEY;
    const root = await makeRoot();
    const source = path.join(root, 'source'); const data = path.join(root, 'data'); await mkdir(source);
    const script = await fakeVibeAcp(root, 'printf "fatal: cannot authenticate with %s during init\\n" "$MISTRAL_API_KEY" >&2\nexit 17');
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source], paths: { vibeAcp: script } };
    const probe = await new AcpBackend(config, data).probe();
    expect(probe.available).toBe(false);
    expect(probe.details?.stderr_tail).toEqual(expect.stringContaining('fatal: cannot authenticate'));
    await expectKeyAbsent('probe', KEY, [probe]);

    const manager = new RunManager(config, data, [new AcpBackend(config, data)]);
    try {
      const started = await manager.reviewStart({ task: 'review', cwd: source });
      const status = await manager.status({ run_id: started.run_id, wait_seconds: 0 });
      const failed = status.state === 'failed' ? status : await new Promise<Record<string, unknown>>((resolve) => { const poll = setInterval(() => { manager.status({ run_id: started.run_id }).then((value) => { if (value.state === 'failed') { clearInterval(poll); resolve(value); } }); }, 20); });
      expect(failed.error).toMatchObject({ code: 'VSUP_ACP_INIT_FAILED', details: { stderr_tail: expect.stringContaining('fatal: cannot authenticate') } });
      await expectKeyAbsent('run', KEY, [failed, await manager.result({ run_id: started.run_id })], data);
    } finally { await manager.shutdown(); }

    const report = await runDoctor(config);
    expect(report.checks.find((check) => check.name === 'acp-initialize')?.stderr_tail).toEqual(expect.stringContaining('fatal: cannot authenticate'));
    await expectKeyAbsent('doctor', KEY, [report]);
  }, 30_000);

  it('redacts a key whose 1 KiB cut lands inside the Bearer token', async () => {
    delete process.env.MISTRAL_API_KEY;
    const root = await makeRoot();
    const source = path.join(root, 'source'); const data = path.join(root, 'data'); await mkdir(source);
    const text = path.join(root, 'stderr.txt');
    await writeFile(text, bearerText);
    expect(bearerText.length - 1024).toBeGreaterThan(501 + 'Bearer '.length);
    expect(bearerText.length - 1024).toBeLessThan(501 + 'Bearer '.length + KEY.length);
    const script = await fakeVibeAcp(root, `cat ${JSON.stringify(text)} >&2\nexit 17`);
    const config = { ...DEFAULT_CONFIG, backend: 'acp' as const, allowedWorkspaceRoots: [source], paths: { vibeAcp: script } };
    const probe = await new AcpBackend(config, data).probe();
    expect(probe.available).toBe(false);
    expect(probe.details?.stderr_tail).toEqual(expect.stringContaining('qqqq'));
    expect(String(probe.details?.stderr_tail).length).toBeLessThanOrEqual(1024);
    await expectKeyAbsent('probe', KEY.slice(10), [probe]);
    const report = await runDoctor(config);
    await expectKeyAbsent('doctor', KEY.slice(10), [report]);
  }, 30_000);

  it('redacts the environment key from the programmatic probe error', async () => {
    process.env.MISTRAL_API_KEY = KEY;
    const root = await makeRoot();
    const vibe = path.join(root, 'vibe');
    await writeExecutable(vibe, '#!/bin/sh\necho "fatal: rejected credential $MISTRAL_API_KEY" >&2\nexit 1\n');
    const probe = await new ProgrammaticBackend({ ...DEFAULT_CONFIG, backend: 'programmatic', paths: { vibe } }).probe();
    expect(probe.available).toBe(false);
    expect(String(probe.details?.error)).toContain('rejected credential');
    await expectKeyAbsent('programmatic probe', KEY, [probe]);
  }, 30_000);
});
