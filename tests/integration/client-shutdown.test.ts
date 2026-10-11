import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');
const server = path.join(repo, 'tests', 'fixtures', 'fake-programmatic-supervisor-server.mjs');
const canonicalTmp = await realpath(tmpdir());
type Reply = { run_id?: string; state?: string; error?: unknown };
const DEADLINE_MS = 5000;
const scratch: string[] = [];
const strays = new Set<number>();

afterEach(async () => {
  for (const pid of strays) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  strays.clear();
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const exists = (file: string) => stat(file).then(() => true, () => false);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

async function until(condition: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
}

async function sandbox() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-shutdown-')); scratch.push(parent);
  const workspace = path.join(parent, 'workspace'); const data = path.join(parent, 'data');
  await mkdir(workspace); await mkdir(data, { mode: 0o700 });
  await writeFile(path.join(workspace, 'a.js'), 'console.log(1);\n');
  await git(workspace, ['init', '-q']);
  await git(workspace, ['add', 'a.js']);
  await git(workspace, ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init']);
  const config = path.join(data, 'config.toml');
  await writeFile(config, `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n`, { mode: 0o600 });
  return { parent, workspace, data, config };
}

async function launch(box: Awaited<ReturnType<typeof sandbox>>, mode = 'exit') {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [server], stderr: 'pipe',
    env: { ...(process.env as Record<string, string>), VIBE_SUPERVISOR_HOME: box.data, FAKE_PROCESS_MODE: mode, ...(process.env.VIBE_SUPERVISOR_TEST_DIST ? { VIBE_SUPERVISOR_TEST_DIST: process.env.VIBE_SUPERVISOR_TEST_DIST } : {}) },
  });
  const stderr: string[] = [];
  transport.stderr?.on('data', (chunk: Buffer) => { stderr.push(chunk.toString()); });
  const client = new Client({ name: 'client-shutdown-test', version: '1.0.0' });
  await client.connect(transport);
  const pid = transport.pid as number;
  strays.add(pid);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }, { timeout: 20_000 });
    const text = (result.content as { type: string; text?: string }[]).find((part) => part.type === 'text')?.text ?? '{}';
    return (result.structuredContent ?? JSON.parse(text)) as Reply;
  };
  return { client, pid, stderr, call };
}

async function workerPid(box: Awaited<ReturnType<typeof sandbox>>, runId: string): Promise<number | undefined> {
  const file = path.join(box.data, 'runs', runId, 'fake-worker.pid');
  try { return Number(await readFile(file, 'utf8')); } catch { return undefined; }
}

async function settled(call: (name: string, args: Record<string, unknown>) => Promise<Reply>, runId: string, states: string[]) {
  let last: Reply = {};
  await until(async () => { last = await call('vibe_status', { run_id: runId, after_seq: 0, wait_seconds: 1 }); return states.includes(last.state ?? ''); }, 15_000);
  return last;
}

async function closeWithin(started: Awaited<ReturnType<typeof launch>>) {
  const began = Date.now();
  const closed = await Promise.race([started.client.close().then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DEADLINE_MS))]);
  const exited = await until(() => !alive(started.pid), DEADLINE_MS);
  return { closed, exited, elapsed: Date.now() - began };
}

async function residue(box: Awaited<ReturnType<typeof sandbox>>, worker: number) {
  const settledWorker = await until(() => !alive(worker), DEADLINE_MS);
  return {
    settledWorker,
    lockPresent: await exists(path.join(box.data, 'supervisor.lock')),
    worktrees: (await git(box.workspace, ['worktree', 'list', '--porcelain'])).split('\n').filter((line) => line.startsWith('worktree ')).length - 1,
  };
}

const settleFor = async (box: Awaited<ReturnType<typeof sandbox>>) => {
  await until(async () => !(await exists(path.join(box.data, 'supervisor.lock'))), DEADLINE_MS);
};

describe('official MCP client shutdown', () => {
  it('completes one task, closes it, then EOF exits the server and settles owned resources', async () => {
    const box = await sandbox(); const started = await launch(box);
    const begun = await started.call('vibe_review_start', { task: 'review', cwd: box.workspace, wait_seconds: 10 });
    const runId = begun.run_id as string;
    const completed = await settled(started.call, runId, ['completed', 'failed']);
    expect(completed.state, JSON.stringify(completed)).toBe('completed');
    const worker = await workerPid(box, runId);
    expect(worker).toBeDefined();
    expect(alive(worker!)).toBe(false);
    const closedRun = await started.call('vibe_close', { run_id: runId });
    expect(closedRun.error).toBeUndefined();
    const outcome = await closeWithin(started);
    expect(outcome).toMatchObject({ closed: true, exited: true });
    expect(alive(started.pid)).toBe(false);
    await settleFor(box);
    expect(await residue(box, worker!)).toMatchObject({ settledWorker: true, lockPresent: false, worktrees: 0 });
  }, 60_000);

  it('client.close while a run is active exits the server and terminates the owned Vibe process', async () => {
    const box = await sandbox(); const started = await launch(box, 'hold');
    const begun = await started.call('vibe_review_start', { task: 'review', cwd: box.workspace });
    const runId = begun.run_id as string;
    expect(await until(async () => (await workerPid(box, runId)) !== undefined, 10_000)).toBe(true);
    const running = await started.call('vibe_status', { run_id: runId, after_seq: 0, wait_seconds: 0 });
    expect(['running', 'starting']).toContain(running.state);
    const worker = (await workerPid(box, runId))!;
    expect(alive(worker)).toBe(true);
    const outcome = await closeWithin(started);
    expect(outcome).toMatchObject({ closed: true, exited: true });
    expect(alive(started.pid)).toBe(false);
    await settleFor(box);
    expect(await residue(box, worker)).toMatchObject({ settledWorker: true, lockPresent: false, worktrees: 0 });
    const meta = JSON.parse(await readFile(path.join(box.data, 'runs', runId, 'meta.json'), 'utf8')) as { state: string };
    expect(['cancelled', 'failed']).toContain(meta.state);
  }, 60_000);

  it('SIGINT exits the server and terminates the owned Vibe process', async () => {
    const box = await sandbox(); const started = await launch(box, 'hold');
    const begun = await started.call('vibe_review_start', { task: 'review', cwd: box.workspace, wait_seconds: 0 });
    const runId = begun.run_id as string;
    expect(await until(async () => (await workerPid(box, runId)) !== undefined, 10_000)).toBe(true);
    const worker = (await workerPid(box, runId))!;
    expect(alive(worker)).toBe(true);
    process.kill(started.pid, 'SIGINT');
    const exited = await until(() => !alive(started.pid), DEADLINE_MS);
    await started.client.close().catch(() => undefined);
    expect(exited).toBe(true);
    strays.delete(started.pid);
    await settleFor(box);
    expect(await residue(box, worker)).toMatchObject({ settledWorker: true, lockPresent: false, worktrees: 0 });
    const meta = JSON.parse(await readFile(path.join(box.data, 'runs', runId, 'meta.json'), 'utf8')) as { state: string };
    expect(['cancelled', 'failed']).toContain(meta.state);
  }, 60_000);
});
