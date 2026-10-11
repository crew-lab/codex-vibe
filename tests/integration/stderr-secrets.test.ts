import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';
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

describe('Vibe version-probe diagnostics do not persist credentials', () => {
  it('redacts the provider key from programmatic probe errors and doctor output', async () => {
    process.env.MISTRAL_API_KEY = KEY;
    const root = await makeRoot();
    const vibe = path.join(root, 'vibe');
    await writeExecutable(vibe, `#!/usr/bin/env python3\nimport os, sys\nprint('fatal: rejected credential ' + os.environ.get('MISTRAL_API_KEY', ''), file=sys.stderr)\nraise SystemExit(17)\n`);
    const config = { ...DEFAULT_CONFIG, paths: { vibe } };
    const probe = await new ProgrammaticBackend(config).probe();
    expect(probe.available).toBe(false);
    expect(String(probe.details?.error)).toContain('rejected credential');
    expect(JSON.stringify(probe)).not.toContain(KEY);

    const report = await runDoctor(config);
    expect(JSON.stringify(report)).not.toContain(KEY);
  }, 30_000);
});
