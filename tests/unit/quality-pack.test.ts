import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { acceptanceContractSchema } from '../../src/acceptance/schema.js';
import { editStartSchema, reviewStartSchema } from '../../src/mcp/schemas.js';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');
const pack = path.join(repo, 'scripts', 'quality-pack');
const script = path.join(repo, 'scripts', 'quality-pack.mjs');
const grantFields = { authorization_id: true, attempt_id: true, readiness_receipt: true } as const;
const roots: string[] = [];

interface Task { id: string; operation: 'review' | 'edit'; acceptance_contract?: unknown; allowed_write_paths?: string[]; context_files?: string[]; expected?: { pattern: string }[] }

async function scratch(): Promise<string> {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'quality-pack-test-'));
  roots.push(root);
  return root;
}

async function tasks(): Promise<Task[]> {
  const names = (await readdir(path.join(pack, 'tasks'))).filter((name) => name.endsWith('.json'));
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(pack, 'tasks', name), 'utf8')) as Task));
}

async function nodeTest(cwd: string, targets: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await exec(process.execPath, ['--test', ...targets], { cwd, timeout: 30_000 });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: String((error as { stdout?: string }).stdout ?? error) };
  }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('quality pack', () => {
  it('writes a start request for every task that the start schemas accept', async () => {
    const fixture = path.join(await scratch(), 'orders');
    const created = JSON.parse((await exec(process.execPath, [script, 'create', fixture])).stdout) as { base_commit: string };
    expect(created.base_commit).toMatch(/^[0-9a-f]{40}$/);
    const all = await tasks();
    expect(all.map((task) => task.id).sort()).toEqual(['edit-reserve-all', 'edit-shipping', 'review-stock', 'review-total']);
    for (const task of all) {
      const { stdout } = await exec(process.execPath, [script, 'request', task.id, '--cwd', fixture]);
      const document = JSON.parse(stdout) as { operation: string; request: Record<string, unknown> };
      expect(document.operation).toBe(task.operation);
      const schema = task.operation === 'edit' ? editStartSchema.omit(grantFields) : reviewStartSchema.omit(grantFields);
      expect(schema.safeParse(document.request).success, task.id).toBe(true);
      if (task.operation === 'edit') {
        expect(acceptanceContractSchema.safeParse(task.acceptance_contract).success, task.id).toBe(true);
        expect(document.request.base_ref).toBe(created.base_commit);
      } else {
        expect(task.expected?.length, task.id).toBeGreaterThan(0);
        for (const expected of task.expected ?? []) expect(() => new RegExp(expected.pattern, 'i')).not.toThrow();
      }
    }
  });

  it('ships a project whose own tests pass and whose hidden edit checks fail until the task is done', async () => {
    const copy = path.join(await scratch(), 'project');
    await cp(path.join(pack, 'project'), copy, { recursive: true });
    expect((await nodeTest(copy, ['tests/'])).ok).toBe(true);
    await mkdir(path.join(copy, 'quality-check'));
    for (const task of (await tasks()).filter((candidate) => candidate.operation === 'edit')) {
      await cp(path.join(pack, 'checks', `${task.id}.test.mjs`), path.join(copy, 'quality-check', `${task.id}.test.mjs`));
      expect((await nodeTest(copy, [`quality-check/${task.id}.test.mjs`])).ok, task.id).toBe(false);
    }
  });
});
