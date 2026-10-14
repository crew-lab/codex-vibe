import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReaperStartError, startReaper } from '../../src/process/reaper.js';

const run = promisify(execFile);
const WORKER_SOURCE = "const c = require('child_process').spawn('sleep', ['120'], { stdio: 'ignore' }); require('fs').writeFileSync(process.argv[1], String(c.pid)); setInterval(() => {}, 1000);";
const dist = process.env.VIBE_SUPERVISOR_TEST_DIST ?? path.resolve(import.meta.dirname, '../../dist');

let scratch = '';
const groups: number[] = [];

beforeEach(async () => { scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'reaper-test-'))); });
afterEach(async () => {
  for (const group of groups.splice(0)) { try { process.kill(-group, 'SIGKILL'); } catch { void 0; } }
  await rm(scratch, { recursive: true, force: true });
});

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (pid: number): boolean => alive(-pid);

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function startWorker(): Promise<{ child: ChildProcess; pid: number; grandchild: number }> {
  const marker = path.join(scratch, `grandchild-${groups.length}`);
  const child = spawn(process.execPath, ['-e', WORKER_SOURCE, marker], { detached: true, stdio: 'ignore' });
  const pid = child.pid as number;
  groups.push(pid);
  await waitFor(async () => { try { return (await readFile(marker, 'utf8')).length > 0; } catch { return false; } });
  return { child, pid, grandchild: Number(await readFile(marker, 'utf8')) };
}

describe('process reaper', () => {
  it('runs in its own process group', async () => {
    const worker = await startWorker();
    const reaper = await startReaper({ workerPid: worker.pid, deadlineAtMs: Date.now() + 60_000 });
    const { stdout } = await run('ps', ['-o', 'pgid=', '-p', String(reaper.pid)]);
    expect(Number(stdout.trim())).toBe(reaper.pid);
    expect(reaper.pid).not.toBe(process.pid);
    await reaper.stop();
  });

  it('kills the whole worker group when the recorded deadline passes', async () => {
    const worker = await startWorker();
    const reaper = await startReaper({ workerPid: worker.pid, deadlineAtMs: Date.now() + 400, pollMs: 50, graceMs: 200 });
    const outcome = await reaper.done;
    expect(outcome).toEqual({ reason: 'deadline', killed: true, verified: true });
    await waitFor(() => !groupAlive(worker.pid));
    expect(alive(worker.grandchild)).toBe(false);
    expect(await reaper.stop()).toEqual(outcome);
    expect(alive(reaper.pid)).toBe(false);
  });

  it('escalates to SIGKILL when the worker ignores SIGTERM', async () => {
    const marker = path.join(scratch, 'stubborn-ready');
    const source = `process.on('SIGTERM', () => {}); require('fs').writeFileSync(process.argv[1], 'x'); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['-e', source, marker], { detached: true, stdio: 'ignore' });
    const pid = child.pid as number;
    groups.push(pid);
    await waitFor(async () => { try { await readFile(marker); return true; } catch { return false; } });
    const reaper = await startReaper({ workerPid: pid, deadlineAtMs: Date.now() + 200, pollMs: 50, graceMs: 300 });
    expect(await reaper.done).toEqual({ reason: 'deadline', killed: true, verified: true });
    await waitFor(() => !groupAlive(pid));
  });

  it('leaves the worker alone and exits when stopped on clean completion', async () => {
    const worker = await startWorker();
    const reaper = await startReaper({ workerPid: worker.pid, deadlineAtMs: Date.now() + 60_000, pollMs: 50 });
    const outcome = await reaper.stop();
    expect(outcome).toEqual({ reason: 'stopped', killed: false, verified: true });
    await waitFor(() => !alive(reaper.pid));
    expect(groupAlive(worker.pid)).toBe(true);
    expect(alive(worker.grandchild)).toBe(true);
    expect(await reaper.stop()).toEqual(outcome);
  });

  it('exits without signaling when the worker group is already gone', async () => {
    const worker = await startWorker();
    const reaper = await startReaper({ workerPid: worker.pid, deadlineAtMs: Date.now() + 60_000, pollMs: 50 });
    process.kill(-worker.pid, 'SIGKILL');
    await waitFor(() => !groupAlive(worker.pid));
    expect(await reaper.done).toEqual({ reason: 'group-gone', killed: false, verified: true });
  });

  it('kills the worker group when the supervisor is killed', async () => {
    const helper = path.join(scratch, 'supervisor.mjs');
    await writeFile(helper, `
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { startReaper } = await import(pathToFileURL(path.join(process.argv[2], 'process', 'reaper.js')).href);
const worker = spawn(process.execPath, ['-e', process.argv[3], process.argv[4]], { detached: true, stdio: 'ignore' });
const reaper = await startReaper({ workerPid: worker.pid, deadlineAtMs: Date.now() + 120000, pollMs: 50, graceMs: 200 });
process.stdout.write(JSON.stringify({ worker: worker.pid, reaper: reaper.pid }) + '\\n');
setInterval(() => {}, 1000);
`);
    const marker = path.join(scratch, 'supervised-grandchild');
    const supervisor = spawn(process.execPath, [helper, dist, WORKER_SOURCE, marker], { stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    supervisor.stdout.on('data', (text: Buffer) => { output += text.toString(); });
    await waitFor(() => output.includes('\n') && output.includes('reaper'));
    const { worker, reaper } = JSON.parse(output) as { worker: number; reaper: number };
    groups.push(worker, reaper);
    await waitFor(async () => { try { return (await readFile(marker, 'utf8')).length > 0; } catch { return false; } });
    const grandchild = Number(await readFile(marker, 'utf8'));
    expect(groupAlive(worker)).toBe(true);
    supervisor.kill('SIGKILL');
    await waitFor(() => !groupAlive(worker) && !alive(grandchild));
    await waitFor(() => !alive(reaper));
  });

  it('rejects unsafe pids and deadlines before spawning anything', async () => {
    const deadlineAtMs = Date.now() + 1000;
    for (const workerPid of [0, 1, -5, 1.5, Number.NaN, process.pid]) {
      await expect(startReaper({ workerPid, deadlineAtMs })).rejects.toThrow(RangeError);
    }
    await expect(startReaper({ workerPid: 4242, deadlineAtMs, supervisorPid: 4242 })).rejects.toThrow(RangeError);
    await expect(startReaper({ workerPid: 4242, deadlineAtMs: 0 })).rejects.toThrow(RangeError);
    await expect(startReaper({ workerPid: 4242, deadlineAtMs, pollMs: 1 })).rejects.toThrow(RangeError);
    await expect(startReaper({ workerPid: 4242, deadlineAtMs, graceMs: -1 })).rejects.toThrow(RangeError);
  });

  it('reports a start failure with a typed error and leaves no reaper behind', async () => {
    const worker = await startWorker();
    await expect(startReaper({ workerPid: worker.pid, deadlineAtMs: Date.now() + 60_000, executable: '/usr/bin/false' })).rejects.toBeInstanceOf(ReaperStartError);
    await expect(startReaper({ workerPid: worker.pid, deadlineAtMs: Date.now() + 60_000, executable: path.join(scratch, 'absent') })).rejects.toMatchObject({ code: 'VSUP_INTERNAL' });
    expect(groupAlive(worker.pid)).toBe(true);
  });
});
