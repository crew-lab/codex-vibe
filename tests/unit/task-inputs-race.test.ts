import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ target: '', maxRead: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    return new Proxy(handle, { get(target, property) {
      if (property === 'read') return async (...readArgs: Parameters<typeof target.read>) => {
        if (args[0] === state.target) {
          state.target = '';
          state.maxRead = (readArgs[0] as Buffer).length;
          await actual.writeFile(args[0], Buffer.alloc(256 * 1024, 65));
        }
        return target.read(...readArgs);
      };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
});
import { MAX_TASK_INPUT_BYTES, prepareTaskInputs } from '../../src/preparation/task-inputs.js';

it('bounds source reads and rejects growth after the opened stat', async () => {
  const parent = await mkdtemp(path.join(await realpath(tmpdir()), 'task-input-race-'));
  try {
    const source = path.join(parent, 'source'); await mkdir(source);
    const git = (args: string[]): string => {
      const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', source, ...args], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    git(['init', '-q']);
    const file = path.join(source, 'input.txt'); await writeFile(file, 'initial');
    git(['add', 'input.txt']); git(['commit', '-q', '-m', 'initial']);
    const base = git(['rev-parse', 'HEAD']);
    state.target = file;
    await expect(prepareTaskInputs({ source, base, files: ['input.txt'], output: path.join(parent, 'prepared'), allowedRoots: [source] })).rejects.toMatchObject({ code: 'VSUP_INVALID_ARGUMENT', details: { role: 'prepared_inputs', reason: 'source_changed' } });
    expect(state.maxRead).toBeGreaterThan(0);
    expect(state.maxRead).toBeLessThanOrEqual(MAX_TASK_INPUT_BYTES + 1);
  } finally { state.target = ''; await rm(parent, { recursive: true, force: true }); }
});
