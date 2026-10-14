import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');
const distRoot = process.env.VIBE_SUPERVISOR_TEST_DIST ?? path.join(repo, 'dist');
const cli = path.join(distRoot, 'cli.js');
const canonicalTmp = await realpath(tmpdir());
const DEADLINE_MS = 10_000;

type Reply = { run_id?: string; state?: string; error?: unknown };
type Box = Awaited<ReturnType<typeof sandbox>>;
type Server = Awaited<ReturnType<typeof launch>>;
type Mode = 'plain' | 'isolated';
type Kind = 'review' | 'edit';
type Disconnect = 'client-close' | 'sigterm';

const scratch: string[] = [];
const strays = new Set<number>();

afterEach(async () => {
  for (const pid of strays) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  strays.clear();
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (pid: number): boolean => { try { process.kill(-pid, 0); return true; } catch { return false; } };
const exists = (file: string) => stat(file).then(() => true, () => false);

async function until(condition: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await exec('git', args, { cwd })).stdout;
}

async function sandbox() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-disconnect-')); scratch.push(parent);
  const workspace = path.join(parent, 'workspace'); const data = path.join(parent, 'data'); const fake = path.join(parent, 'fake');
  await mkdir(workspace); await mkdir(data, { mode: 0o700 }); await mkdir(fake);
  await writeFile(path.join(workspace, 'a.js'), 'console.log(1);\n');
  await git(workspace, ['init', '-q']);
  await git(workspace, ['add', 'a.js']);
  await git(workspace, ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init']);

  const workerRecord = path.join(fake, 'worker.json');
  const interpreter = path.join(fake, 'fake-python');
  await writeFile(interpreter, [
    `#!${process.execPath}`,
    "const fs = require('node:fs'); const cp = require('node:child_process');",
    "if (!String(process.argv[2]).endsWith('vibe_supervisor_launcher.py')) { process.stdout.write('vibe 2.26.1\\n'); process.exit(0); }",
    "const grandchild = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    `fs.writeFileSync(${JSON.stringify(workerRecord)}, JSON.stringify({ pid: process.pid, grandchild: grandchild.pid }));`,
    'setInterval(() => {}, 1000);',
    ''
  ].join('\n'));
  await chmod(interpreter, 0o755);
  const vibe = path.join(fake, 'vibe');
  await writeFile(vibe, `#!${interpreter}\n`);
  await chmod(vibe, 0o755);

  await writeFile(path.join(data, 'config.toml'), `version = 1\nbackend = "programmatic"\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[paths]\nvibe = ${JSON.stringify(vibe)}\n`, { mode: 0o600 });
  return { parent, workspace, data, workerRecord };
}

async function launch(box: Box, mode: Mode) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'serve', '--stdio', ...(mode === 'isolated' ? ['--isolated'] : [])],
    stderr: 'pipe',
    env: { ...(process.env as Record<string, string>), VIBE_SUPERVISOR_HOME: box.data }
  });
  const stderr: string[] = [];
  transport.stderr?.on('data', (chunk: Buffer) => { stderr.push(chunk.toString()); });
  const client = new Client({ name: 'active-disconnect-test', version: '1.0.0' });
  await client.connect(transport);
  const pid = transport.pid as number;
  strays.add(pid);
  const closeInput = () => { (transport as unknown as { _process?: { stdin?: { end(): void } | null } })._process?.stdin?.end(); };
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }, { timeout: 20_000 });
    const text = (result.content as { type: string; text?: string }[]).find((part) => part.type === 'text')?.text ?? '{}';
    return (result.structuredContent ?? JSON.parse(text)) as Reply & Record<string, unknown>;
  };
  return { client, pid, stderr, call, closeInput };
}

async function readWorker(box: Box): Promise<{ pid: number; grandchild: number } | undefined> {
  try { return JSON.parse(await readFile(box.workerRecord, 'utf8')) as { pid: number; grandchild: number }; } catch { return undefined; }
}

async function startActiveRun(server: Server, box: Box, kind: Kind) {
  const begun = await server.call(kind === 'edit' ? 'vibe_edit_start' : 'vibe_review_start', { task: 'hold until killed', cwd: box.workspace, wait_seconds: 0 });
  const runId = begun.run_id as string;
  expect(runId, JSON.stringify(begun)).toBeTruthy();
  let state: Reply = {};
  const running = await until(async () => {
    state = await server.call('vibe_status', { run_id: runId, after_seq: 0, wait_seconds: 1 });
    return state.state === 'running' && (await readWorker(box)) !== undefined;
  }, DEADLINE_MS);
  expect(running, `worker never became active: ${JSON.stringify(state)}`).toBe(true);
  const worker = (await readWorker(box))!;
  expect(alive(worker.pid)).toBe(true);
  expect(alive(worker.grandchild)).toBe(true);
  expect(groupAlive(worker.pid)).toBe(true);
  return { runId, worker };
}

async function disconnect(server: Server, how: Disconnect): Promise<number> {
  const began = Date.now();
  if (how === 'client-close') server.closeInput();
  else process.kill(server.pid, 'SIGTERM');
  const exited = await until(() => !alive(server.pid), DEADLINE_MS);
  expect(exited, `server ${server.pid} still alive after ${how}; stderr: ${server.stderr.join('')}`).toBe(true);
  strays.delete(server.pid);
  await server.client.close().catch(() => undefined);
  return Date.now() - began;
}

async function findRunDirectory(box: Box, runId: string): Promise<string | undefined> {
  const roots = [box.data];
  const sessions = path.join(box.data, 'mcp-sessions');
  if (await exists(sessions)) for (const name of await readdir(sessions)) roots.push(path.join(sessions, name));
  for (const root of roots) {
    const candidate = path.join(root, 'runs', runId);
    if (await exists(path.join(candidate, 'meta.json'))) return candidate;
  }
  return undefined;
}

async function locks(box: Box): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.name === 'supervisor.lock') found.push(full);
      else if (entry.isDirectory() && depth < 2) await walk(full, depth + 1);
    }
  };
  await walk(box.data, 0);
  return found;
}

const worktreeCount = async (box: Box) => (await git(box.workspace, ['worktree', 'list', '--porcelain'])).split('\n').filter((line) => line.startsWith('worktree ')).length - 1;

describe.each<Mode>(['plain', 'isolated'])('active disconnect with a blocking fake Vibe (%s)', (mode) => {
  describe.each<Kind>(['review', 'edit'])('%s run', (kind) => {
    it.each<Disconnect>(['client-close', 'sigterm'])('%s ends the server, the worker process group, the lock and the run record', async (how) => {
      const box = await sandbox();
      const first = await launch(box, mode);
      const { runId, worker } = await startActiveRun(first, box, kind);
      if (kind === 'edit') expect(await worktreeCount(box)).toBe(1);

      const elapsed = await disconnect(first, how);
      expect(elapsed).toBeLessThan(DEADLINE_MS);

      expect(await until(() => !alive(worker.pid) && !alive(worker.grandchild) && !groupAlive(worker.pid), DEADLINE_MS), 'worker process group survived').toBe(true);
      expect(await until(async () => (await locks(box)).length === 0 || !(await exists((await locks(box))[0] as string)), DEADLINE_MS)).toBe(true);

      const directory = await findRunDirectory(box, runId);
      expect(directory, 'run record missing').toBeDefined();
      const saved = JSON.parse(await readFile(path.join(directory!, 'meta.json'), 'utf8')) as { state: string; worktree?: { path: string }; error?: { code?: string; message?: string } };
      expect(saved.state, JSON.stringify(saved)).toBe('failed');
      expect(saved.error?.message).toMatch(/will not be resumed or replayed/);
      if (kind === 'edit') {
        expect(await worktreeCount(box), 'interrupted edit worktree must be retained for the coordinator').toBe(1);
        const listed = await git(box.workspace, ['worktree', 'list', '--porcelain']);
        expect(listed).toContain(`worktree ${saved.worktree?.path}`);
      }

      const second = await launch(box, mode);
      try {
        const status = await second.call('vibe_status', { run_id: runId, after_seq: 0, wait_seconds: 0 });
        expect(status.state, JSON.stringify(status)).toBe('failed');
        expect(await readWorker(box)).toEqual(worker);
        expect(alive(worker.pid)).toBe(false);
        expect(await worktreeCount(box)).toBe(kind === 'edit' ? 1 : 0);
        const closed = await second.call('vibe_close', { run_id: runId, cleanup_worktree: true });
        expect(closed.error, JSON.stringify(closed)).toBeUndefined();
        expect(await worktreeCount(box), 'worktree leaked after vibe_close').toBe(0);
        if (saved.worktree) expect(await exists(saved.worktree.path)).toBe(false);
      } finally {
        await second.client.close().catch(() => undefined);
        await until(() => !alive(second.pid), DEADLINE_MS);
      }
    }, 90_000);
  });
});
