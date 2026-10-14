import { spawn } from 'node:child_process';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';

export type ReaperReason = 'stopped' | 'deadline' | 'supervisor-gone' | 'group-gone' | 'crashed';

export interface ReaperOutcome {
  reason: ReaperReason;
  killed: boolean;
  verified: boolean;
}

export interface ReaperOptions {
  workerPid: number;
  deadlineAtMs: number;
  supervisorPid?: number;
  pollMs?: number;
  graceMs?: number;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  executable?: string;
  cwd?: string;
}

export interface ReaperHandle {
  readonly pid: number;
  readonly done: Promise<ReaperOutcome>;
  stop(): Promise<ReaperOutcome>;
}

export class ReaperStartError extends Error {
  readonly code = 'VSUP_INTERNAL';
  constructor(message: string) {
    super(message);
    this.name = 'ReaperStartError';
  }
}

const DEFAULT_POLL_MS = 250;
const DEFAULT_GRACE_MS = 2000;
const DEFAULT_STARTUP_TIMEOUT_MS = 5000;
const DEFAULT_STOP_TIMEOUT_MS = 3000;
const MAX_GRACE_MS = 60_000;
const MAX_OUTCOME_LINE_BYTES = 1024;

export const REAPER_SOURCE = `
const [supervisorPid, targetPid, deadlineAtMs, pollMs, graceMs] = process.argv.slice(1).map(Number);
const target = process.platform === 'win32' ? targetPid : -targetPid;
const exists = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const signal = (name) => { try { process.kill(target, name); } catch {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitGone = async (ms) => {
  const end = Date.now() + ms;
  while (exists(target)) {
    if (Date.now() >= end) return false;
    await sleep(25);
  }
  return true;
};
let settled = false;
let poll;
process.stdout.on('error', () => {});
const report = (reason, killed, verified) => {
  clearInterval(poll);
  process.stdout.write(JSON.stringify({ reason, killed, verified }) + '\\n', () => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
const reap = async (reason) => {
  if (settled) return;
  settled = true;
  signal('SIGTERM');
  let gone = await waitGone(graceMs);
  if (!gone) {
    signal('SIGKILL');
    gone = await waitGone(2000);
  }
  report(reason, true, gone);
};
const finish = (reason) => {
  if (settled) return;
  settled = true;
  report(reason, false, true);
};
const tick = () => {
  if (settled) return;
  if (!exists(target)) return finish('group-gone');
  if (process.ppid !== supervisorPid || !exists(supervisorPid)) return void reap('supervisor-gone');
  if (Date.now() >= deadlineAtMs) return void reap('deadline');
};
let received = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  received = (received + chunk).slice(-16);
  if (received.includes('stop')) finish('stopped');
});
process.stdin.on('end', () => { void reap('supervisor-gone'); });
process.stdin.on('error', () => { void reap('supervisor-gone'); });
poll = setInterval(tick, pollMs);
setTimeout(tick, Math.min(Math.max(0, deadlineAtMs - Date.now()), 2147483647));
process.stdout.write('ready\\n');
tick();
`;

function integerOption(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

function parseOutcome(line: string): ReaperOutcome | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { reason, killed, verified } = parsed as Record<string, unknown>;
  if (reason !== 'stopped' && reason !== 'deadline' && reason !== 'supervisor-gone' && reason !== 'group-gone') return undefined;
  if (typeof killed !== 'boolean' || typeof verified !== 'boolean') return undefined;
  return { reason, killed, verified };
}

export async function startReaper(options: ReaperOptions): Promise<ReaperHandle> {
  const supervisorPid = options.supervisorPid ?? process.pid;
  const workerPid = integerOption('workerPid', options.workerPid, 2, 2 ** 31 - 1);
  if (workerPid === process.pid || workerPid === supervisorPid) throw new RangeError('workerPid must not be the supervisor');
  integerOption('supervisorPid', supervisorPid, 2, 2 ** 31 - 1);
  if (!Number.isSafeInteger(options.deadlineAtMs) || options.deadlineAtMs <= 0) throw new RangeError('deadlineAtMs must be a positive epoch millisecond integer');
  const pollMs = integerOption('pollMs', options.pollMs ?? DEFAULT_POLL_MS, 10, 60_000);
  const graceMs = integerOption('graceMs', options.graceMs ?? DEFAULT_GRACE_MS, 0, MAX_GRACE_MS);
  const startupTimeoutMs = integerOption('startupTimeoutMs', options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS, 100, 60_000);
  const stopTimeoutMs = integerOption('stopTimeoutMs', options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS, 100, 60_000);

  const child = spawn(options.executable ?? process.execPath, [
    '-e', REAPER_SOURCE, String(supervisorPid), String(workerPid), String(options.deadlineAtMs), String(pollMs), String(graceMs),
  ], {
    cwd: options.cwd ?? tmpdir(),
    env: {},
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const reaperPid = child.pid;
  child.stdin.on('error', () => {});

  let outcome: ReaperOutcome | undefined;
  let ready = false;
  let pending = '';
  let markReady: () => void = () => {};
  const readySignal = new Promise<void>((resolve) => { markReady = resolve; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (text: string) => {
    pending += text;
    if (pending.length > MAX_OUTCOME_LINE_BYTES * 4) pending = pending.slice(-MAX_OUTCOME_LINE_BYTES * 4);
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!ready && line === 'ready') { ready = true; markReady(); continue; }
      const parsed = parseOutcome(line);
      if (parsed) outcome = parsed;
    }
  });
  let exited = false;
  const done = new Promise<ReaperOutcome>((resolve) => {
    const settle = (): void => { exited = true; markReady(); resolve(outcome ?? { reason: 'crashed', killed: false, verified: false }); };
    child.once('error', settle);
    child.once('close', settle);
  });

  let startupTimer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => { startupTimer = setTimeout(() => resolve('timeout'), startupTimeoutMs); });
  await Promise.race([readySignal, timedOut]);
  if (startupTimer) clearTimeout(startupTimer);
  if (!ready || reaperPid === undefined || exited) {
    if (!exited) { try { child.kill('SIGKILL'); } catch { } }
    await done;
    throw new ReaperStartError('The process reaper did not start; the worker is not protected and must be terminated.');
  }

  child.unref();
  (child.stdin as Socket).unref();
  (child.stdout as Socket).unref();

  let stopping: Promise<ReaperOutcome> | undefined;
  const stop = (): Promise<ReaperOutcome> => {
    stopping ??= (async () => {
      try { child.stdin.end('stop\n'); } catch { }
      let timer: NodeJS.Timeout | undefined;
      const limit = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), stopTimeoutMs); });
      const first = await Promise.race([done, limit]);
      if (timer) clearTimeout(timer);
      if (first === 'timeout') {
        try { child.kill('SIGKILL'); } catch { }
        return done;
      }
      return first;
    })();
    return stopping;
  };

  return { pid: reaperPid, done, stop };
}
