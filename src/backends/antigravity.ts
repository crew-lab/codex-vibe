import { execFile } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import type {
  BackendCapabilities, BackendRunHandle, BackendStartResult,
  StartRunInput, SupervisorBackend, BackendCallbacks, RuntimeCheck, UsageState
} from '../contracts.js';
import { supervisorError, type SupervisorConfig } from '../contracts.js';
import { candidateIdentity, type PreparationStatus } from '../preparation/evidence.js';
import { spawnManaged } from '../process/managed.js';
import { assertNoProjectAntigravityExtensions, assertNoProjectVibeExtensions } from '../security/workspace-guard.js';
import { redactSecrets, StreamingRedactor } from '../security/redaction.js';
import { buildChildEnvironment } from '../security/environment.js';
import { createPrivateDir } from '../security/paths.js';
import { APP_VERSION } from '../version.js';
import { buildWorkspaceListing } from './app-server/workspace-listing.js';
import { anchoredDenylistPatterns, denylistAnchors, workspaceAnchors, type DenylistAnchor } from '../security/globs.js';
import {
  EDIT_ALLOWED_TOOLS,
  readAntigravityHookLedger,
  REVIEW_ALLOWED_TOOLS,
  writeAntigravityPreToolHook
} from './antigravity-hook.js';

const execFileAsync = promisify(execFile);

const DENIED_TOOLS = [
  'run_command', 'bash', 'shell', 'read_url', 'read_url_content',
  'search_web', 'read_browser_page', 'open_browser_url', 'mcp(*)'
] as const;

const RESERVED_AND_SECRET_GLOBS = [
  '.git/**', '.vibe/**', '.gemini/**', '.agents/**', '.env*', '*.pem', '*.key', '*.p12', '*.pfx'
] as const;

export interface AntigravityHandle extends BackendRunHandle {
  opaque: {
    process: ReturnType<typeof spawnManaged>;
    done: boolean;
    workerWorkspace: string;
    mode: 'review' | 'edit';
    latestSummary: string;
    childHome: string;
    childTmp: string;
  };
}

interface ParsedEnvelopeMeta {
  status?: string;
  usage?: UsageState;
  deniedActions: Array<{ tool: string; reason: string; path?: string }>;
  numToolCalls?: number;
  toolCalls?: unknown;
  type?: string;
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
  if (typeof obj.response === 'string') return obj.response;
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
  visit(obj.content ?? obj.message ?? obj.chunks ?? obj.delta ?? obj.response);
  return parts.join('');
}

function extractEnvelopeMeta(entry: unknown): ParsedEnvelopeMeta {
  const meta: ParsedEnvelopeMeta = { deniedActions: [] };
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return meta;
  const obj = entry as Record<string, unknown>;
  if (typeof obj.status === 'string') meta.status = obj.status.toUpperCase();
  if (typeof obj.type === 'string') meta.type = obj.type;

  if (typeof obj.num_tool_calls === 'number' && Number.isFinite(obj.num_tool_calls) && obj.num_tool_calls >= 0) {
    meta.numToolCalls = Math.trunc(obj.num_tool_calls);
  }
  if (Array.isArray(obj.tool_calls) || (typeof obj.tool_calls === 'number' && Number.isFinite(obj.tool_calls) && obj.tool_calls >= 0)) {
    meta.toolCalls = obj.tool_calls;
  }

  const numTurns = typeof obj.num_turns === 'number' && Number.isFinite(obj.num_turns) && obj.num_turns >= 0
    ? Math.trunc(obj.num_turns)
    : undefined;
  const rawUsage = obj.usage && typeof obj.usage === 'object' && !Array.isArray(obj.usage)
    ? (obj.usage as Record<string, unknown>)
    : undefined;

  if (rawUsage || numTurns !== undefined) {
    const intOrUndefined = (val: unknown): number | undefined =>
      typeof val === 'number' && Number.isFinite(val) && val >= 0 ? Math.trunc(val) : undefined;
    const promptTokens = intOrUndefined(rawUsage?.prompt_tokens ?? rawUsage?.input_tokens);
    const completionTokens = intOrUndefined(rawUsage?.completion_tokens ?? rawUsage?.output_tokens);
    const totalTokens = intOrUndefined(rawUsage?.total_tokens ?? rawUsage?.tokens_used)
      ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
    const cachedTokens = intOrUndefined(rawUsage?.cached_tokens);
    const usage: UsageState = {
      ...(totalTokens !== undefined ? { tokensUsed: totalTokens } : {}),
      ...(promptTokens !== undefined ? { promptTokens } : {}),
      ...(completionTokens !== undefined ? { completionTokens } : {}),
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      ...(numTurns !== undefined ? { modelCalls: numTurns } : {})
    };
    if (Object.keys(usage).length > 0) meta.usage = usage;
  }

  if (Array.isArray(obj.denied_actions)) {
    for (const item of obj.denied_actions) {
      if (typeof item === 'string' && item.trim()) {
        meta.deniedActions.push({ tool: item.trim(), reason: 'denied_by_headless_policy' });
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const tool = typeof record.tool === 'string' ? record.tool : typeof record.name === 'string' ? record.name : 'tool';
        const reason = typeof record.reason === 'string' ? record.reason : 'denied_by_headless_policy';
        const targetPath = typeof record.path === 'string' ? record.path : undefined;
        meta.deniedActions.push({ tool, reason, ...(targetPath ? { path: targetPath } : {}) });
      }
    }
  }
  return meta;
}

function createStreamOutputParser(
  onEntry: (payload: { text?: string; meta: ParsedEnvelopeMeta }) => Promise<void>,
  maxLineBytes: number
) {
  let pending = '';
  const handleLine = async (line: string): Promise<void> => {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      await onEntry({ text: line, meta: { deniedActions: [] } });
      return;
    }
    const text = extractTextFromStreamEntry(entry);
    const meta = extractEnvelopeMeta(entry);
    if (
      text ||
      meta.status ||
      meta.usage ||
      meta.deniedActions.length > 0 ||
      meta.numToolCalls !== undefined ||
      meta.toolCalls !== undefined ||
      meta.type === 'tool_use' ||
      meta.type === 'tool_call'
    ) {
      await onEntry({ ...(text ? { text } : {}), meta });
    }
  };
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
        await handleLine(line);
      }
    },
    async flush(): Promise<void> {
      const remaining = pending.trim();
      pending = '';
      if (!remaining) return;
      await handleLine(remaining);
    }
  };
}

async function writeIsolatedSettings(
  childHome: string,
  mode: 'review' | 'edit',
  denylist: readonly DenylistAnchor[] = []
): Promise<void> {
  const geminiDir = path.join(childHome, '.gemini');
  const cliDir = path.join(geminiDir, 'antigravity-cli');
  await createPrivateDir(geminiDir);
  await createPrivateDir(cliDir);

  const relativeGlobs = denylist.flatMap((anchor) =>
    anchor.globs.flatMap((glob) => {
      const rel = anchor.prefix.length > 0 ? `${anchor.prefix.join('/')}/${glob}` : glob;
      return rel.startsWith('**/') ? [rel] : [rel, `**/${rel}`];
    })
  );

  const denyPatterns = [
    ...DENIED_TOOLS,
    ...RESERVED_AND_SECRET_GLOBS,
    ...denylist.flatMap(anchoredDenylistPatterns),
    ...relativeGlobs
  ];

  const settings = {
    toolPermission: 'strict',
    enableTerminalSandbox: true,
    allowNonWorkspaceAccess: false,
    permissions: {
      allow: mode === 'review' ? [...REVIEW_ALLOWED_TOOLS] : [...EDIT_ALLOWED_TOOLS],
      deny: [...new Set(denyPatterns)]
    }
  };
  await writeFile(path.join(cliDir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
}

async function cleanupPrivateDirectories(childHome: string, childTmp: string): Promise<void> {
  await Promise.allSettled([
    rm(childHome, { recursive: true, force: true, maxRetries: 2 }),
    rm(childTmp, { recursive: true, force: true, maxRetries: 2 })
  ]);
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

  async preparationCheck(): Promise<PreparationStatus> {
    try {
      const candidate = await candidateIdentity();
      return {
        status: 'passed',
        candidate_sha256: candidate,
        version: APP_VERSION,
        reason: 'Antigravity CLI execution backend candidate identity verified; hosted acceptance remains separate'
      };
    } catch {
      return {
        status: 'missing',
        candidate_sha256: null,
        version: APP_VERSION,
        reason: 'Candidate identity could not be computed'
      };
    }
  }

  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    const capabilities = await this.probe();
    if (!capabilities.available) {
      throw supervisorError('VSUP_ANTIGRAVITY_NOT_FOUND', 'Antigravity CLI (agy) is unavailable or could not be probed.', capabilities.details);
    }

    await assertNoProjectVibeExtensions(input.cwd);
    await assertNoProjectVibeExtensions(input.workerWorkspace);
    await assertNoProjectAntigravityExtensions(input.cwd);
    await assertNoProjectAntigravityExtensions(input.workerWorkspace);

    const childHome = path.join(input.runDirectory, 'antigravity-home');
    const childTmp = path.join(input.runDirectory, 'antigravity-tmp');
    await createPrivateDir(childHome);
    await createPrivateDir(childTmp);

    const anchors = workspaceAnchors(input.exclusions ?? [], input.cwd);
    const denylist = denylistAnchors(input.exclusions ?? [], input.cwd, input.workerWorkspace);

    await writeIsolatedSettings(childHome, input.mode, denylist);
    await writeAntigravityPreToolHook(childHome, {
      mode: input.mode,
      workerWorkspace: input.workerWorkspace,
      excludedAnchors: anchors
    });

    const childEnv = buildChildEnvironment(process.env, [
      'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTIGRAVITY_API_KEY', 'ANTIGRAVITY_HOME'
    ]);
    childEnv.HOME = childHome;
    childEnv.TMPDIR = childTmp;

    const mode = input.mode === 'review' ? 'plan' : 'accept-edits';
    const listing = input.mode === 'review' ? await buildWorkspaceListing(input.workerWorkspace, {}, anchors) : null;
    const contextPrefix = (input.contextFiles ?? []).map((file) => `Approved context path: ${file}`).join('\n');
    const prefixParts = [listing?.text ?? null, contextPrefix].filter((part): part is string => Boolean(part && part.length > 0));
    const prompt = prefixParts.length > 0 ? `${prefixParts.join('\n\n')}\n\nTask:\n${input.task}` : input.task;

    const args = [
      '-p', prompt,
      '--mode', mode,
      '--output-format', 'stream-json',
      '--disable-slash-commands',
      '--sandbox',
      '--print-timeout', `${input.limits.timeoutSeconds}s`
    ];

    let latestSummary = '';
    let latestUsage: UsageState | undefined;
    let envelopeStatus: string | undefined;
    let outputChain = Promise.resolve();
    let stderrChain = Promise.resolve();
    let streamExecutedCalls = 0;
    let streamToolUseEvents = 0;
    const allDeniedActions: Array<{ tool: string; reason: string; path?: string }> = [];

    const chunks = createStreamOutputParser(async ({ text, meta }) => {
      if (meta.status) envelopeStatus = meta.status;
      if (meta.usage) latestUsage = { ...latestUsage, ...meta.usage };
      if (meta.numToolCalls !== undefined) {
        streamExecutedCalls = Math.max(streamExecutedCalls, meta.numToolCalls);
      }
      if (Array.isArray(meta.toolCalls)) {
        streamExecutedCalls = Math.max(streamExecutedCalls, meta.toolCalls.length);
      } else if (typeof meta.toolCalls === 'number') {
        streamExecutedCalls = Math.max(streamExecutedCalls, Math.trunc(meta.toolCalls));
      }
      if (meta.type === 'tool_use' || meta.type === 'tool_call') {
        streamToolUseEvents += 1;
        streamExecutedCalls = Math.max(streamExecutedCalls, streamToolUseEvents);
      }
      for (const denied of meta.deniedActions) {
        allDeniedActions.push(denied);
        await callbacks.onEvent({
          source: 'antigravity',
          type: 'tool_denied',
          severity: 'warning',
          data: {
            tool: redactSecrets(denied.tool),
            reason: redactSecrets(denied.reason),
            ...(denied.path ? { path: redactSecrets(denied.path) } : {})
          }
        });
      }
      if (text) {
        const redacted = redactSecrets(text);
        latestSummary = (latestSummary ? `${latestSummary}\n${redacted}` : redacted).slice(-input.limits.maxTranscriptBytes);
        await callbacks.onEvent({ source: 'antigravity', type: 'message', severity: 'info', data: { text: `${redacted}\n` } });
      }
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
        callbacks.onActivity?.('antigravity:stdout');
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
        callbacks.onActivity?.('antigravity:stderr');
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
      childHome,
      childTmp,
      get latestSummary() { return latestSummary; }
    };
    const handle: AntigravityHandle = { runId: input.runId, backend: this.kind, opaque };
    callbacks.onSpawn?.(handle);
    const processRecord = {
      ...(child.child.pid === undefined ? {} : { pid: child.child.pid }),
      executable: cmd,
      ...(capabilities.version ? { version: capabilities.version } : {})
    };

    await callbacks.onState('running', { process: processRecord });

    void child.done.then(async ({ code, signal }) => {
      opaque.done = true;
      try {
        if (outputLimited || parserFailed) return;
        await outputChain;
        await stderrChain;
        await chunks.flush();
        const diagnosticTail = stderrRedactor.flush();
        if (diagnosticTail) {
          await stderrChain.then(() => callbacks.onEvent({
            source: 'antigravity', type: 'diagnostic', severity: 'warning', data: { text: diagnosticTail }
          }));
        }

        const { approvals, toolCalls, hookEntries } = await readAntigravityHookLedger(
          childHome,
          allDeniedActions,
          streamExecutedCalls
        );

        for (const entry of hookEntries) {
          if (entry.decision === 'approve') {
            await callbacks.onEvent({
              source: 'antigravity',
              type: 'tool_call',
              severity: 'info',
              data: {
                tool: redactSecrets(entry.tool ?? 'tool'),
                ...(entry.path ? { path: redactSecrets(entry.path) } : {})
              }
            });
          } else {
            await callbacks.onEvent({
              source: 'antigravity',
              type: 'tool_denied',
              severity: 'warning',
              data: {
                tool: redactSecrets(entry.tool ?? 'tool'),
                reason: redactSecrets(entry.reason ?? 'denied'),
                ...(entry.path ? { path: redactSecrets(entry.path) } : {})
              }
            });
          }
        }

        const finalUsage: UsageState = { ...(latestUsage ?? {}), toolCalls };

        if (code === 0 && (envelopeStatus === 'ERROR' || envelopeStatus === 'INVALID')) {
          await callbacks.onState('failed', {
            usage: finalUsage,
            approvals,
            error: supervisorError('VSUP_ANTIGRAVITY_EXEC_FAILED', `Antigravity reported terminal envelope status ${envelopeStatus}.`)
          });
        } else if (code === 0 && (envelopeStatus === 'CANCELED' || envelopeStatus === 'INTERRUPTED')) {
          await callbacks.onState('cancelled', {
            usage: finalUsage,
            approvals
          });
        } else if (code === 0) {
          await callbacks.onState('completed', {
            usage: finalUsage,
            approvals,
            result: { stopReason: 'end_turn', summary: opaque.latestSummary || 'Antigravity run completed.' }
          });
        } else {
          await callbacks.onState('failed', {
            usage: finalUsage,
            approvals,
            error: supervisorError('VSUP_BACKEND_CRASHED', `Antigravity exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`)
          });
        }
      } finally {
        await cleanupPrivateDirectories(childHome, childTmp);
      }
    }).catch(async (error: unknown) => {
      opaque.done = true;
      try {
        const { approvals, toolCalls } = await readAntigravityHookLedger(
          childHome,
          allDeniedActions,
          streamExecutedCalls
        ).catch(() => ({
          approvals: { records: [], truncated: false },
          toolCalls: { executed: streamExecutedCalls, deniedByHandler: 0, deniedByPolicy: allDeniedActions.length },
          hookEntries: []
        }));
        await cleanupPrivateDirectories(childHome, childTmp);
        await callbacks.onState('failed', {
          usage: { ...(latestUsage ?? {}), toolCalls },
          approvals,
          error: supervisorError('VSUP_BACKEND_CRASHED', redactSecrets(String(error)))
        });
      } catch {
        await cleanupPrivateDirectories(childHome, childTmp);
        await callbacks.onState('failed', {
          error: supervisorError('VSUP_BACKEND_CRASHED', redactSecrets(String(error)))
        });
      }
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
    await cleanupPrivateDirectories(state.childHome, state.childTmp);
  }

  async terminateNow(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as AntigravityHandle['opaque'];
    await state.process.terminate();
  }
}
