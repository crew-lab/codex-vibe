import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { buildChildEnvironment } from '../security/environment.js';

export class BoundedCollector {
  private data = Buffer.alloc(0);
  truncated = false;
  constructor(readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('maxBytes must be a non-negative integer');
  }
  push(chunk: Uint8Array): void {
    const bytes = Buffer.from(chunk);
    const remaining = this.maxBytes - this.data.length;
    if (bytes.length > remaining) this.truncated = true;
    if (remaining > 0) this.data = Buffer.concat([this.data, bytes.subarray(0, remaining)]);
  }
  toBuffer(): Buffer { return Buffer.from(this.data); }
  toString(encoding: BufferEncoding = 'utf8'): string { return this.data.toString(encoding); }
}

export interface ManagedProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  forwardEnv?: readonly string[];
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  stdio?: SpawnOptions['stdio'];
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onLimit?: (stream: 'stdout' | 'stderr') => void;
}

export interface ManagedProcess {
  child: ChildProcess;
  stdout: BoundedCollector;
  stderr: BoundedCollector;
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /**
   * True when group signaling was denied and only the direct child was signaled.
   * Callers must report group/grandchild cleanup as unverified when this is true.
   */
  readonly groupTerminationDegraded: boolean;
  terminate(graceMs?: number): Promise<void>;
}

/** Spawn executable + argv directly; shell parsing is deliberately unavailable. */
export function spawnManaged(executable: string, args: readonly string[], options: ManagedProcessOptions): ManagedProcess {
  if (!executable || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new TypeError('Expected executable and argument array');
  const stdout = new BoundedCollector(options.maxStdoutBytes ?? 2 * 1024 * 1024);
  const stderr = new BoundedCollector(options.maxStderrBytes ?? 2 * 1024 * 1024);
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  let limitTriggered = false;
  let groupTerminationDegraded = false;
  const child = spawn(executable, [...args], {
    cwd: options.cwd,
    env: buildChildEnvironment(options.env ?? process.env, options.forwardEnv),
    shell: false,
    detached: process.platform !== 'win32',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (data: Buffer) => {
    stdout.push(data);
    // Protocol consumers may need byte-faithful stdout. They must redact parsed payloads before persistence.
    options.onStdout?.(stdoutDecoder.write(data));
    if (stdout.truncated && !limitTriggered) { limitTriggered = true; options.onLimit?.('stdout'); void terminate().catch(() => {}); }
  });
  child.stderr?.on('data', (data: Buffer) => {
    stderr.push(data);
    options.onStderr?.(stderrDecoder.write(data));
    if (stderr.truncated && !limitTriggered) { limitTriggered = true; options.onLimit?.('stderr'); void terminate().catch(() => {}); }
  });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const outTail = stdoutDecoder.end(); const errTail = stderrDecoder.end();
      if (outTail) options.onStdout?.(outTail);
      if (errTail) options.onStderr?.(errTail);
      resolve({ code, signal });
    });
  });
  let terminating: Promise<void> | undefined;
  const terminate = (graceMs = 5000): Promise<void> => {
    if (terminating) return terminating;
    terminating = (async () => {
      let directKillError: unknown;
      const killGroup = (signal: NodeJS.Signals): void => {
        if (!child.pid) return;
        try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ESRCH') return;
          if (process.platform !== 'win32' && code === 'EPERM') {
            // Sandboxes can deny killpg while still allowing signaling the spawned child.
            // Never probe or signal another PID: this fallback only targets child.pid.
            groupTerminationDegraded = true;
            try {
              const sent = child.kill(signal);
              if (!sent && child.exitCode === null && child.signalCode === null) directKillError = new Error('child.kill returned false');
            }
            catch (directError) {
              if ((directError as NodeJS.ErrnoException).code !== 'ESRCH') directKillError = directError;
            }
            return;
          }
          throw error;
        }
      };
      const waitBounded = async (ms: number): Promise<boolean> => {
        let timer: NodeJS.Timeout | undefined;
        const completed = await Promise.race([
          done.then(() => true, () => true),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
        ]);
        if (timer) clearTimeout(timer);
        return completed;
      };
      killGroup('SIGTERM');
      await waitBounded(Math.max(0, Math.min(graceMs, 60_000)));
      // The direct child may exit while grandchildren remain in its process group.
      killGroup('SIGKILL');
      const completed = await waitBounded(1500);
      if (!completed) {
        const detail = directKillError instanceof Error ? ` Direct-child signal failed: ${directKillError.message}` : '';
        throw new Error(`Managed process did not close within the termination deadline.${groupTerminationDegraded ? ' Process-group cleanup is unverified because only the direct child could be signaled.' : ''}${detail}`);
      }
    })();
    return terminating;
  };
  return { child, stdout, stderr, get groupTerminationDegraded() { return groupTerminationDegraded; }, done, terminate };
}
