import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type {
  BackendCapabilities, BackendRunHandle, BackendStartResult,
  StartRunInput, SupervisorBackend, BackendCallbacks, RuntimeCheck
} from '../contracts.js';
import { supervisorError, type SupervisorConfig } from '../contracts.js';
import { spawnManaged } from '../process/managed.js';
import { assertNoProjectVibeExtensions } from '../security/workspace-guard.js';
import { redactSecrets, StreamingRedactor } from '../security/redaction.js';
import { buildChildEnvironment } from '../security/environment.js';
import { createPrivateDir } from '../security/paths.js';

const execFileAsync = promisify(execFile);

export interface AntigravityHandle extends BackendRunHandle {
  opaque: {
    process: ReturnType<typeof spawnManaged>;
    done: boolean;
    workerWorkspace: string;
    mode: 'review' | 'edit';
    latestSummary: string;
  };
}

function executable(config: SupervisorConfig): string {
  return config.paths?.antigravity ?? 'agy';
}

function parseVersion(stdout: string, stderr: string): string | undefined {
  const text = `${stdout}\n${stderr}`;
  const match = text.match(/\b(?:antigravity|agy)\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)
    ?? text.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
  return match?.[1] ?? (text.trim() ? text.trim().split(/\r?\n/)[0] : undefined);
}

function cleanPrivateFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanPrivateFields);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(reasoning|thought|chain_?of_?thought)/i.test(key)) continue;
    if (key === 'type' && typeof item === 'string' && /thought|reasoning/i.test(item)) return undefined;
    const cleaned = cleanPrivateFields(item);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function extractTextFromStreamEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  const cleaned = cleanPrivateFields(entry);
  if (!cleaned || typeof cleaned !== 'object') return '';
  const obj = cleaned as Record<string, unknown>;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.message === 'string') return obj.message;

  const parts: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') { parts.push(value); return; }
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text);
    else if (typeof record.content === 'string') parts.push(record.content);
    else for (const [key, item] of Object.entries(record)) {
      if (!/^(reasoning|thought)/i.test(key)) visit(item);
    }
  };
  visit(obj.content ?? obj.message ?? obj.chunks ?? obj.delta);
  return parts.join('');
}

function createStreamOutputParser(onText: (text: string) => Promise<void>, maxLineBytes: number) {
  let pending = '';
  return {
    async push(chunk: string): Promise<void> {
      pending += chunk;
      if (Buffer.byteLength(pending) > maxLineBytes) {
        pending = '';
        throw new Error('Antigravity streaming output line exceeds configured event limit');
      }
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line) continue;
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          // Fallback: If not valid JSON, treat raw text line as direct output
          await onText(line);
          continue;
        }
        const text = extractTextFromStreamEntry(entry);
        if (text) await onText(text);
      }
    },
    async flush(): Promise<void> {
      const remaining = pending.trim();
      pending = '';
      if (!remaining) return;
      try {
        const entry = JSON.parse(remaining);
        const text = extractTextFromStreamEntry(entry);
        if (text) await onText(text);
      } catch {
        await onText(remaining);
      }
    }
  };
}

export class AntigravityBackend implements SupervisorBackend {
  readonly kind = 'antigravity' as const;

  constructor(private readonly config: SupervisorConfig) {}

  async probe(): Promise<BackendCapabilities> {
    const cmd = executable(this.config);
    try {
      const result = await execFileAsync(cmd, ['--version'], {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        windowsHide: true
      });
      const version = parseVersion(result.stdout, result.stderr);
      return {
        available: true,
        backend: this.kind,
        executable: cmd,
        ...(version ? { version } : {}),
        details: { version: version ?? 'detected' }
      };
    } catch (error) {
      return {
        available: false,
        backend: this.kind,
        executable: cmd,
        details: { error: String(error) }
      };
    }
  }

  async runtimeCheck(): Promise<RuntimeCheck> {
    const cmd = executable(this.config);
    const capabilities = await this.probe();
    return {
      executable: cmd,
      resolved_executable: capabilities.available ? cmd : null,
      executable_found: capabilities.available,
      pinned_version: capabilities.version ?? 'unknown',
      version_verified: false,
      note: 'Antigravity CLI (agy) execution backend.'
    };
  }

  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    const capabilities = await this.probe();
    if (!capabilities.available) {
      throw supervisorError('VSUP_ANTIGRAVITY_NOT_FOUND', 'Antigravity CLI (agy) is unavailable or could not be probed.', capabilities.details);
    }

    await assertNoProjectVibeExtensions(input.cwd);
    await assertNoProjectVibeExtensions(input.workerWorkspace);

    const childHome = path.join(input.runDirectory, 'antigravity-home');
    await createPrivateDir(childHome);

    const childEnv = buildChildEnvironment(process.env, [
      'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTIGRAVITY_API_KEY', 'ANTIGRAVITY_HOME'
    ]);
    childEnv.HOME = childHome;

    const mode = input.mode === 'review' ? 'plan' : 'accept-edits';
    const contextPrefix = (input.contextFiles ?? []).map((file) => `Approved context path: ${file}`).join('\n');
    const prompt = contextPrefix ? `${contextPrefix}\n\nTask:\n${input.task}` : input.task;

    const args = [
      '-p', prompt,
      '--mode', mode,
      '--output-format', 'stream-json',
      '--cwd', input.workerWorkspace,
      '--dangerously-skip-permissions',
    ];

    let latestSummary = '';
    let outputChain = Promise.resolve();
    let stderrChain = Promise.resolve();

    const chunks = createStreamOutputParser(async (text) => {
      const redacted = redactSecrets(text);
      latestSummary = (latestSummary ? `${latestSummary}\n${redacted}` : redacted).slice(-input.limits.maxTranscriptBytes);
      await callbacks.onEvent({ source: 'antigravity', type: 'message', severity: 'info', data: { text: `${redacted}\n` } });
    }, input.limits.maxEventBytes);

    const stderrRedactor = new StreamingRedactor();
    let outputLimited = false;
    let parserFailed = false;

    const cmd = executable(this.config);
    const child = spawnManaged(cmd, args, {
      cwd: input.workerWorkspace,
      env: childEnv,
      forwardEnv: Object.keys(childEnv),
      maxStdoutBytes: input.limits.maxTranscriptBytes,
      maxStderrBytes: input.limits.maxEventBytes,
      onLimit: (stream) => {
        outputLimited = true;
        if (stream === 'stdout') {
          void callbacks.onState('failed', {
            error: supervisorError('VSUP_OUTPUT_LIMIT', 'Antigravity output exceeded the configured transcript limit.')
          });
        }
      },
      onStdout: (chunk) => {
        outputChain = outputChain.then(() => chunks.push(chunk)).catch(async (error: unknown) => {
          if (!parserFailed) {
            parserFailed = true;
            await callbacks.onState('failed', {
              error: supervisorError('VSUP_OUTPUT_LIMIT', redactSecrets(String(error)))
            });
          }
          await child.terminate();
        });
      },
      onStderr: (chunk) => {
        const text = stderrRedactor.push(chunk);
        if (text) {
          stderrChain = stderrChain.then(() => callbacks.onEvent({
            source: 'antigravity', type: 'diagnostic', severity: 'warning', data: { text }
          })).then(() => undefined).catch(() => undefined);
        }
      }
    });

    const opaque = {
      process: child,
      done: false,
      workerWorkspace: input.workerWorkspace,
      mode: input.mode,
      get latestSummary() { return latestSummary; }
    };
    const handle: AntigravityHandle = { runId: input.runId, backend: this.kind, opaque };
    const processRecord = {
      ...(child.child.pid === undefined ? {} : { pid: child.child.pid }),
      executable: cmd,
      ...(capabilities.version ? { version: capabilities.version } : {})
    };

    await callbacks.onState('running', { process: processRecord });

    void child.done.then(async ({ code, signal }) => {
      opaque.done = true;
      if (outputLimited || parserFailed) return;
      if (code === 0) {
        await outputChain;
        await stderrChain;
        await chunks.flush();
        const diagnosticTail = stderrRedactor.flush();
        if (diagnosticTail) {
          await stderrChain.then(() => callbacks.onEvent({
            source: 'antigravity', type: 'diagnostic', severity: 'warning', data: { text: diagnosticTail }
          }));
        }
        await callbacks.onState('completed', {
          result: { stopReason: 'end_turn', summary: opaque.latestSummary || 'Antigravity run completed.' }
        });
      } else {
        await callbacks.onState('failed', {
          error: supervisorError('VSUP_BACKEND_CRASHED', `Antigravity exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`)
        });
      }
    }).catch(async (error: unknown) => {
      opaque.done = true;
      await callbacks.onState('failed', {
        error: supervisorError('VSUP_BACKEND_CRASHED', redactSecrets(String(error)))
      });
    });

    return { handle, initialState: 'running' as const, process: processRecord };
  }

  async cancel(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as AntigravityHandle['opaque'];
    await state.process.terminate();
  }

  async close(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as AntigravityHandle['opaque'];
    if (!state.done) await state.process.terminate();
  }

  async terminateNow(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as AntigravityHandle['opaque'];
    await state.process.terminate();
  }
}
