import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import type {
  BackendCapabilities, BackendRespondInput, BackendRunHandle, RunRecord,
  StartRunInput, SupervisorBackend, BackendCallbacks
} from '../contracts.js';
import { supervisorError } from '../contracts.js';
import type { SupervisorConfig } from '../contracts.js';
import { spawnManaged } from '../process/managed.js';
import { assertNoProjectVibeExtensions, createVibeChildProfile } from './profile.js';
import { buildVibeLaunch, classifyFailureText, classifyStartFailure, describeMissing, removePromptFile, spawned, stderrTailText, versionMismatchOnStderr } from './launcher.js';
import type { VibeLaunch } from './launcher.js';
import { SUPPORTED_VIBE } from './pinned.js';
import { environmentSecrets, redactSecrets, StreamingRedactor } from '../security/redaction.js';
import { reportBackgroundFailure } from '../diagnostics/background.js';

const execFileAsync = promisify(execFile);
const NO_FINAL_MESSAGE_WARNING = 'Vibe produced no final message.';

interface ProgrammaticHandle extends BackendRunHandle {
  opaque: { process: ReturnType<typeof spawnManaged>; done: boolean; home: string; vibeHome: string; summary: string };
}

function executable(config: SupervisorConfig): string {
  return config.paths?.vibe ?? 'vibe';
}

function parsedVersion(stdout: string, stderr: string): string | undefined {
  const text = `${stdout}\n${stderr}`;
  return text.match(/\bvibe\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1];
}

export class ProgrammaticBackend implements SupervisorBackend {
  readonly kind = 'programmatic' as const;
  readonly supportsContinue = false;
  constructor(private readonly config: SupervisorConfig) {}

  async probe(): Promise<BackendCapabilities> {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibe-supervisor-probe-')));
    let secrets: string[] = [];
    try {
      const profile = await createVibeChildProfile({
        runId: 'probe', mode: 'review', task: '', cwd: root, workerWorkspace: root,
        runDirectory: root, limits: { timeoutSeconds: 15, maxTurns: 1, maxEventBytes: 4096, maxTranscriptBytes: 4096, maxArtifactBytes: 4096 }
      }, 'review');
      secrets = environmentSecrets(profile.env);
      const result = await execFileAsync(executable(this.config), ['--version'], {
        cwd: root, env: profile.env, timeout: 15_000, maxBuffer: 64 * 1024, windowsHide: true
      });
      const version = parsedVersion(result.stdout, result.stderr);
      return {
        available: version === SUPPORTED_VIBE,
        backend: this.kind,
        executable: executable(this.config),
        ...(version ? { version } : {}),
        supportsContinue: false,
        supportsPermissionResponse: false,
        details: { ...(version ? { detected_version: version } : {}), reason: version === SUPPORTED_VIBE ? 'Exact tested Vibe build detected' : `Requires exactly Vibe ${SUPPORTED_VIBE}` }
      };
    } catch (error) {
      const missing = await describeMissing(executable(this.config), error);
      return { available: false, backend: this.kind, executable: executable(this.config), supportsContinue: false, supportsPermissionResponse: false, details: { ...missing, reason: missing.interpreter_missing ? `The interpreter for the vibe launcher${typeof missing.interpreter === 'string' ? ` (${missing.interpreter})` : ''} was not found.` : 'The Vibe version probe failed.', error: redactSecrets(String(error), secrets) } };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  async start(input: StartRunInput, callbacks: BackendCallbacks) {
    await assertNoProjectVibeExtensions(input.cwd);
    await assertNoProjectVibeExtensions(input.workerWorkspace);
    const profile = await createVibeChildProfile(input, input.mode, { forwardOriginalHome: true });
    profile.env.VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS = String(input.limits.timeoutSeconds);
    const agent = input.mode === 'review' ? 'plan' : 'accept-edits';
    const toolNames = input.mode === 'review' ? ['read_file', 'grep'] : ['read_file', 'grep', 'write_file', 'edit'];
    const contextPrefix = (input.contextFiles ?? []).map((file) => `Approved context path: ${file}`).join('\n');
    const prompt = contextPrefix ? `${contextPrefix}\n\nTask:\n${input.task}` : input.task;
    const args = ['--agent', agent, '--max-turns', String(input.limits.maxTurns), '--output', 'streaming', '--legacy-harness'];
    for (const tool of toolNames) args.push('--enabled-tools', tool);
    let latestSummary = '';
    let outputChain = Promise.resolve();
    let stderrChain = Promise.resolve();
    const chunks = createStreamingOutputParser(async (text) => {
      const redacted = redactSecrets(text, environmentSecrets(profile.env));
      latestSummary = redacted.slice(-input.limits.maxTranscriptBytes);
      await callbacks.onEvent({ source: 'vibe', type: 'message', severity: 'info', data: { text: `${redacted}\n` } });
    }, input.limits.maxEventBytes, () => callbacks.onActivity?.('stdout'));
    const stderrRedactor = new StreamingRedactor(environmentSecrets(profile.env));
    let outputLimited = false;
    let parserFailed = false;
    const discardPromptFile = async (): Promise<void> => {
      if (await removePromptFile(input.runDirectory) === 'refused') {
        await callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text: 'The task prompt file was not a regular file inside the run directory and was left in place.' } });
      }
    };
    let launch: VibeLaunch;
    let child: ReturnType<typeof spawnManaged>;
    try {
      launch = await buildVibeLaunch(executable(this.config), 'programmatic', args, profile, input.runDirectory, { promptText: prompt });
      child = spawnManaged(launch.command, launch.args, {
        cwd: input.workerWorkspace, env: launch.env,
        forwardEnv: Object.keys(launch.env),
        maxStdoutBytes: input.limits.maxTranscriptBytes,
        maxStderrBytes: input.limits.maxEventBytes,
        onLimit: (stream) => {
          outputLimited = true;
          const message = stream === 'stdout' ? 'Vibe programmatic output exceeded the configured transcript limit.' : 'Vibe programmatic diagnostics exceeded the configured event limit.';
          Promise.resolve(callbacks.onState('failed', { error: supervisorError('VSUP_OUTPUT_LIMIT', message) })).catch((error: unknown) => reportBackgroundFailure('programmatic-output-limit', error));
        },
        onStdout: (chunk) => { outputChain = outputChain.then(() => chunks.push(chunk)).catch(async (error: unknown) => {
          if (!parserFailed) { parserFailed = true; await callbacks.onState('failed', { error: supervisorError('VSUP_OUTPUT_LIMIT', redactSecrets(String(error), environmentSecrets(profile.env))) }); }
          await child.terminate();
        }); },
        onStderr: (chunk) => {
          callbacks.onActivity?.('stderr');
          const text = stderrRedactor.push(chunk);
          if (text) stderrChain = stderrChain.then(() => callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text } })).then(() => undefined).catch(() => undefined);
        }
      });
      try { await spawned(child); }
      catch (error) { child.done.catch(() => undefined); throw error; }
    } catch (error) {
      await discardPromptFile().catch(() => undefined);
      throw await classifyStartFailure(this.kind, executable(this.config), error);
    }
    const opaque = { process: child, done: false, home: profile.home, vibeHome: profile.vibeHome, get summary() { return latestSummary; } };
    const handle: ProgrammaticHandle = { runId: input.runId, backend: this.kind, opaque };
    callbacks.onSpawn?.(handle);
    const processRecord = { ...(child.child.pid === undefined ? {} : { pid: child.child.pid }), executable: launch.command, version: SUPPORTED_VIBE };
    await callbacks.onState('running', { process: processRecord });
    child.done.then(async ({ code, signal }) => {
      opaque.done = true;
      await discardPromptFile();
      await outputChain;
      await stderrChain;
      if (outputLimited || parserFailed) return;
      await chunks.flush();
      const diagnosticTail = stderrRedactor.flush();
      if (diagnosticTail) await callbacks.onEvent({ source: 'supervisor', type: 'diagnostic', severity: 'warning', data: { text: diagnosticTail } });
      const stderrText = redactSecrets(child.stderr.toString(), environmentSecrets(profile.env));
      const turnLimitMarker = `<vibe_stop_event>Turn limit of ${input.limits.maxTurns} reached</vibe_stop_event>`;
      const reachedTurnLimit = code === 1 && !signal && opaque.summary.trim() === turnLimitMarker && stderrText.trim() === turnLimitMarker;
      if (code === 0 || reachedTurnLimit) {
        await callbacks.onState('completed', { result: {
          stopReason: reachedTurnLimit ? 'max_turn_requests' : 'end_turn',
          summary: reachedTurnLimit ? '' : opaque.summary,
          ...(!reachedTurnLimit && !opaque.summary.trim() ? { warnings: [NO_FINAL_MESSAGE_WARNING] } : {})
        } });
      } else {
        const exitMessage = `Vibe exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`;
        const failure = versionMismatchOnStderr(this.kind, stderrText) ?? classifyFailureText(stderrTailText(stderrText), 'VSUP_BACKEND_CRASHED', exitMessage);
        await callbacks.onState('failed', { error: failure });
      }
    }).catch(async (error: unknown) => {
      opaque.done = true;
      await discardPromptFile().catch(() => undefined);
      await callbacks.onState('failed', { error: supervisorError('VSUP_BACKEND_CRASHED', redactSecrets(String(error))) });
    }).catch((error: unknown) => reportBackgroundFailure('programmatic-exit', error));
    return { handle, initialState: 'running' as const, process: processRecord };
  }

  async continue(_handle: BackendRunHandle, _message: string): Promise<void> {
    throw supervisorError('VSUP_SESSION_NOT_RESUMABLE', 'The programmatic Vibe command cannot continue an ACP session.');
  }
  async respond(_handle: BackendRunHandle, _response: BackendRespondInput): Promise<void> {
    throw supervisorError('VSUP_INVALID_STATE', 'The programmatic Vibe command has no interactive permission or elicitation channel.');
  }
  async cancel(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as ProgrammaticHandle['opaque'];
    await state.process.terminate();
  }
  async close(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as ProgrammaticHandle['opaque'];
    if (!state.done) await state.process.terminate();
    // Retain the private Vibe home until supervisor retention cleanup so
    // filtered native session records remain available for diagnosis/recovery.
  }
  async recover(_record: RunRecord, _callbacks: BackendCallbacks): Promise<BackendRunHandle | undefined> { return undefined; }
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

function extractAssistantText(entry: unknown): string {
  const cleaned = cleanPrivateFields(entry);
  if (!cleaned || typeof cleaned !== 'object') return '';
  const obj = cleaned as Record<string, unknown>;
  const role = obj.role ?? obj.speaker;
  if (role !== 'assistant' && role !== 'agent') return '';
  if (typeof obj.text === 'string') return obj.text;
  const parts: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text);
    else for (const [key, item] of Object.entries(record)) if (!/^(reasoning|thought)/i.test(key)) visit(item);
  };
  visit(obj.content ?? obj.message ?? obj.chunks);
  return parts.join('');
}

function createStreamingOutputParser(onAssistantText: (text: string) => Promise<void>, maxLineBytes: number, onLine: () => void = () => undefined) {
  let pending = '';
  return {
    async push(chunk: string): Promise<void> {
      pending += chunk;
      if (Buffer.byteLength(pending) > maxLineBytes) { pending = ''; throw new Error('Vibe streaming output line exceeds configured event limit'); }
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
        if (!line) continue;
        onLine();
        let entry: unknown;
        try { entry = JSON.parse(line); } catch { continue; }
        const text = extractAssistantText(entry);
        if (text) await onAssistantText(text);
      }
    },
    async flush(): Promise<void> {
      if (!pending.trim()) return;
      let entry: unknown;
      try { entry = JSON.parse(pending); } catch { pending = ''; return; }
      pending = '';
      const text = extractAssistantText(entry);
      if (text) await onAssistantText(text);
    }
  };
}
