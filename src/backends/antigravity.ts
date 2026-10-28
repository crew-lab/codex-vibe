import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { digest } from '../acceptance/schema.js';
import type {
  BackendCapabilities, BackendRunHandle, BackendStartResult, PinIdentity,
  StartRunInput, SupervisorBackend, BackendCallbacks, RuntimeCheck, UsageState, SupervisorError
} from '../contracts.js';
import { supervisorError, type SupervisorConfig } from '../contracts.js';
import { checkPreparation, type PreparationStatus } from '../preparation/evidence.js';
import { spawnManaged } from '../process/managed.js';
import { startReaper, type ReaperHandle } from '../process/reaper.js';
import { assertNoProjectAntigravityExtensions, assertNoProjectVibeExtensions } from '../security/workspace-guard.js';
import {
  environmentSecrets,
  googleCredentialSecrets,
  redactSecrets,
  StreamingRedactor
} from '../security/redaction.js';
import { resolveExecutableFile } from '../security/executable.js';
import { setupHeadlessBrowserNeutralizer } from '../security/environment.js';
import { createPrivateDir } from '../security/paths.js';
import { turnBackstop } from './app-server/usage.js';
import { buildWorkspaceListing } from './app-server/workspace-listing.js';
import { FINDINGS_OUTPUT_CONTRACT } from '../core/findings.js';
import { anchoredDenylistPatterns, denylistAnchors, workspaceAnchors, type DenylistAnchor } from '../security/globs.js';
import {
  parseToolArguments,
  primaryToolPath,
  readAntigravityHookLedger,
  toolCallFingerprint,
  writeAntigravityPreToolHook,
  type StreamExecutedCall
} from './antigravity-hook.js';

const execFileAsync = promisify(execFile);

export const SUPPORTED_ANTIGRAVITY_VERSIONS = ['1.4.0', '1.4.3', '1.4.4', '1.4.7', '1.4.8'] as const;
export type SupportedAntigravityVersion = (typeof SUPPORTED_ANTIGRAVITY_VERSIONS)[number];
export const SUPPORTED_ANTIGRAVITY_VERSION = '1.4.8';

export const ALLOWED_ANTIGRAVITY_BUILTIN_SKILLS = [
  'agy-customizations',
  'antigravity_guide',
  'automation',
  'generative_ui',
  'migrate-workflows',
  'permissioned-github',
  'plugin',
  'run-workflow',
  'ui-plugin-navigation'
] as const;

export function onlyAllowedAntigravityBuiltinSkills(value: readonly unknown[]): boolean {
  const seen = new Set<string>();
  return value.every((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const skill = entry as Record<string, unknown>;
    if (typeof skill.name !== 'string' || !(ALLOWED_ANTIGRAVITY_BUILTIN_SKILLS as readonly string[]).includes(skill.name) || seen.has(skill.name)) return false;
    seen.add(skill.name);
    return skill.builtin === true;
  });
}

export function isSupportedAntigravityVersion(version: string | null | undefined): version is SupportedAntigravityVersion {
  return typeof version === 'string' && (SUPPORTED_ANTIGRAVITY_VERSIONS as readonly string[]).includes(version);
}

export function selectAntigravityApiKey(source: NodeJS.ProcessEnv = process.env): string | undefined {
  const gemini = source.GEMINI_API_KEY?.trim();
  if (gemini) return gemini;
  const google = source.GOOGLE_API_KEY?.trim();
  if (google) return google;
  const antigravity = source.ANTIGRAVITY_API_KEY?.trim();
  if (antigravity) return antigravity;
  return undefined;
}

export function antigravityChildEnvironment(
  source: NodeJS.ProcessEnv,
  childHome: string,
  childTmp: string,
  neutralizerBinDir?: string,
  selectedApiKey?: string
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  if (source.PATH !== undefined) env.PATH = source.PATH;
  if (source.LANG !== undefined) env.LANG = source.LANG;
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('LC_') && value !== undefined) env[key] = value;
  }
  const effectiveApiKey = selectedApiKey?.trim() || selectAntigravityApiKey(source);
  if (effectiveApiKey) {
    env.GEMINI_API_KEY = effectiveApiKey;
    env.GOOGLE_API_KEY = effectiveApiKey;
  }
  if (neutralizerBinDir) {
    env.PATH = `${neutralizerBinDir}${path.delimiter}${source.PATH ?? ''}`;
  }
  env.HOME = childHome;
  env.TMPDIR = childTmp;
  env.AGY_CLI_OSC7501 = 'off';
  env.BROWSER = 'false';
  return env;
}

const VERSION_PROBE_TIMEOUT_MS = 10_000;
const NATURAL_EXIT_TERMINATION_ATTEMPTS = 4;
const VERSION_PROBE_MAX_BYTES = 64 * 1024;

export interface AntigravityBackendOptions {
  preparation?: {
    check: (config: SupervisorConfig, dataDir?: string) => Promise<PreparationStatus>;
  };
  dataDir?: string;
  expectedExecutableSha256?: string | undefined;
}

const UNIFIED_TOOL_DENIES = [
  'command(*)',
  'mcp(*)',
  'read_url(*)',
  'execute_url(*)'
] as const;

const RESERVED_AND_SECRET_GLOBS = [
  '.git/**',
  '**/.git/**',
  '.vibe/**',
  '**/.vibe/**',
  '.gemini/**',
  '**/.gemini/**',
  '.agents/**',
  '**/.agents/**',
  '.vibeignore',
  '**/.vibeignore',
  '.env*',
  '**/.env*',
  '*.pem',
  '**/*.pem',
  '*.key',
  '**/*.key',
  '*.p12',
  '**/*.p12',
  '*.pfx',
  '**/*.pfx'
] as const;

export interface AntigravityHandle extends BackendRunHandle {
  opaque: {
    process: ReturnType<typeof spawnManaged>;
    reaper: ReaperHandle | undefined;
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
  error?: string;
  usage?: UsageState;
  numTurns?: number;
  stepIdx?: number;
  isModelCallStep?: boolean;
  thinkingTokens?: number;
  deniedActions: Array<{ tool: string; reason: string; path?: string }>;
  numToolCalls?: number;
  toolCalls?: unknown;
  executedCalls: StreamExecutedCall[];
  type?: string;
  thoughtObserved?: boolean;
}

function executable(config: SupervisorConfig): string {
  return config.paths?.antigravity ?? 'agy';
}

export function parseAntigravityVersion(stdout: string, stderr: string): string | undefined {
  const text = `${stdout}\n${stderr}`;
  const match = text.match(/\b(?:antigravity|agy)\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)
    ?? text.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
  return match?.[1] ?? (text.trim() ? text.trim().split(/\r?\n/)[0] : undefined);
}

export async function resolveAntigravityExecutable(configuredCommand: string): Promise<{
  resolvedPath: string | null;
  sha256: string | null;
  version: string | null;
  error?: string;
}> {
  let candidatePath: string;
  try {
    candidatePath = await resolveExecutableFile(configuredCommand);
  } catch (error) {
    return { resolvedPath: null, sha256: null, version: null, error: error instanceof Error ? error.message : String(error) };
  }

  let sha256: string | null = null;
  try {
    const bytes = await readFile(candidatePath);
    sha256 = createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    return { resolvedPath: candidatePath, sha256: null, version: null, error: String(error) };
  }

  try {
    const result = await probeAntigravityVersion(candidatePath);
    const version = parseAntigravityVersion(result.stdout, result.stderr) ?? null;
    return { resolvedPath: candidatePath, sha256, version };
  } catch (error) {
    return { resolvedPath: candidatePath, sha256, version: null, error: String(error) };
  }
}

async function probeAntigravityVersion(resolvedExecutable: string): Promise<{ stdout: string; stderr: string }> {
  const probeHome = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vsup-agy-version-')));
  try {
    const neutralizerBin = await setupHeadlessBrowserNeutralizer(path.join(probeHome, '.bin'));
    const env: NodeJS.ProcessEnv = {
      HOME: probeHome,
      TMPDIR: probeHome,
      AGY_CLI_OSC7501: 'off',
      BROWSER: 'false',
      NO_COLOR: '1',
      PATH: `${neutralizerBin}${path.delimiter}${process.env.PATH ?? ''}`
    };
    const result = await execFileAsync(resolvedExecutable, ['--version'], {
      cwd: probeHome,
      env,
      timeout: VERSION_PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: VERSION_PROBE_MAX_BYTES,
      windowsHide: true
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } finally {
    await rm(probeHome, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  }
}

const VISIBLE_STEP_TYPES: ReadonlySet<string> = new Set(['planner_response', 'assistant_message', 'message']);
const VISIBLE_TEXT_KEYS = ['text', 'response', 'content', 'message'] as const;
const TEXT_BEARING_KEY = /^(?:text|response|content|message|delta|chunks?|parts?|output|summary|thoughts?|reasoning|thinking)$/i;
const PRIVATE_KEY = /^(?:reasoning|thought|chain_?of_?thought|thinking)/i;
const MAX_TEXT_SCAN_DEPTH = 8;

export interface StreamEntryText {
  text: string;
  withheld: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function carriesText(value: unknown, depth = 0): boolean {
  if (depth > MAX_TEXT_SCAN_DEPTH) return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => carriesText(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    (TEXT_BEARING_KEY.test(key) || PRIVATE_KEY.test(key) || typeof item === 'object') && carriesText(item, depth + 1));
}

function privateTextPresent(record: Record<string, unknown>): boolean {
  return Object.entries(record).some(([key, item]) => PRIVATE_KEY.test(key) && carriesText(item));
}

function visibleText(record: Record<string, unknown>): StreamEntryText {
  let withheld = privateTextPresent(record);
  for (const key of VISIBLE_TEXT_KEYS) {
    const value = record[key];
    if (typeof value === 'string') return { text: value, withheld };
    if (!Array.isArray(value)) continue;
    const parts: string[] = [];
    for (const part of value) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
      else if (carriesText(part)) withheld = true;
    }
    return { text: parts.join(''), withheld };
  }
  return { text: '', withheld };
}

export function classifyStreamEntry(entry: unknown): StreamEntryText {
  if (!isRecord(entry)) return { text: '', withheld: carriesText(entry) };
  if (entry.event === 'init') return { text: '', withheld: false };
  if (entry.event === 'step_update' && isRecord(entry.step_update)) {
    const step = entry.step_update;
    if (typeof step.step_type === 'string' && VISIBLE_STEP_TYPES.has(step.step_type)) return visibleText(step);
    if (typeof step.tool_name === 'string' && step.tool_name.trim()) return { text: '', withheld: false };
    return { text: '', withheld: carriesText(step) };
  }
  if (entry.event === 'result' && isRecord(entry.result)) {
    const result = entry.result;
    const text = typeof result.response === 'string' ? result.response : typeof result.text === 'string' ? result.text : '';
    return { text, withheld: privateTextPresent(result) };
  }
  if (entry.event === undefined && (entry.type === 'tool_use' || entry.type === 'tool_call')) return { text: '', withheld: false };
  return { text: '', withheld: carriesText(entry) };
}

export function extractTextFromStreamEntry(entry: unknown): string {
  return classifyStreamEntry(entry).text;
}

export function extractEnvelopeMeta(entry: unknown): ParsedEnvelopeMeta {
  const meta: ParsedEnvelopeMeta = { deniedActions: [], executedCalls: [] };
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return meta;
  const top = entry as Record<string, unknown>;

  const parseCallObj = (item: Record<string, unknown>, defaultTurnId: string | null): StreamExecutedCall | null => {
    const rawTool = item.tool_name ?? item.name ?? item.tool;
    if (typeof rawTool !== 'string' || !rawTool.trim()) return null;
    const tool = rawTool.trim();
    const rawCallId = item.call_id ?? item.id ?? item.callId;
    const callId = typeof rawCallId === 'string' && rawCallId.trim() ? rawCallId.trim() : null;
    const rawTurn = item.step_index ?? item.turnId ?? item.turn_id;
    const turnId = rawTurn !== undefined && rawTurn !== null ? String(rawTurn) : defaultTurnId;
    const rawArgs = item.args ?? item.tool_input ?? item.input;
    const args = rawArgs === undefined || rawArgs === null ? null : parseToolArguments(rawArgs);
    const fingerprint = args ? toolCallFingerprint(tool, args) : null;
    return { tool, callId, turnId, args, path: primaryToolPath(tool, args), fingerprint };
  };

  if (typeof top.type === 'string' && /thought|reasoning/i.test(top.type)) {
    meta.thoughtObserved = true;
  }
  if ('reasoning' in top || 'thought' in top) {
    meta.thoughtObserved = true;
  }

  if (top.event === 'step_update' && top.step_update && typeof top.step_update === 'object' && !Array.isArray(top.step_update)) {
    const step = top.step_update as Record<string, unknown>;
    const stepType = typeof step.step_type === 'string' ? step.step_type : undefined;
    if (typeof step.step_index === 'number' && Number.isFinite(step.step_index) && step.step_index >= 0) {
      meta.stepIdx = Math.trunc(step.step_index);
    }
    if (stepType && /thought|reasoning/i.test(stepType)) {
      meta.thoughtObserved = true;
    }
    if (stepType === 'planner_response' || stepType === 'assistant_message' || stepType === 'model_call') {
      if (step.state === undefined || step.state === 'DONE') {
        meta.isModelCallStep = true;
      }
    }
    if (typeof step.tool_name === 'string' && step.tool_name.trim().length > 0 && (step.state === 'DONE' || step.state === 'COMPLETED' || step.state === undefined)) {
      meta.type = 'tool_call';
      const call = parseCallObj(step, meta.stepIdx !== undefined ? String(meta.stepIdx) : null);
      if (call) meta.executedCalls.push(call);
    } else if (stepType) {
      meta.type = stepType;
    }
    if (Array.isArray(step.tool_calls)) {
      for (const c of step.tool_calls) {
        if (c && typeof c === 'object' && !Array.isArray(c)) {
          const call = parseCallObj(c as Record<string, unknown>, meta.stepIdx !== undefined ? String(meta.stepIdx) : null);
          if (call) meta.executedCalls.push(call);
        }
      }
    }
  }

  const obj = (top.event === 'result' && top.result && typeof top.result === 'object' && !Array.isArray(top.result))
    ? (top.result as Record<string, unknown>)
    : top;

  if (typeof obj.status === 'string') meta.status = obj.status.toUpperCase();
  if (typeof obj.error === 'string' && obj.error.trim().length > 0) meta.error = obj.error.trim();
  if (!meta.type && typeof obj.type === 'string') meta.type = obj.type;

  if (Array.isArray(obj.tool_calls)) {
    for (const c of obj.tool_calls) {
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const call = parseCallObj(c as Record<string, unknown>, null);
        if (call) meta.executedCalls.push(call);
      }
    }
  }

  if ((top.type === 'tool_use' || top.type === 'tool_call') && meta.executedCalls.length === 0) {
    const call = parseCallObj(top, meta.stepIdx !== undefined ? String(meta.stepIdx) : null);
    if (call) meta.executedCalls.push(call);
  }

  if (typeof obj.num_tool_calls === 'number' && Number.isFinite(obj.num_tool_calls) && obj.num_tool_calls >= 0) {
    meta.numToolCalls = Math.trunc(obj.num_tool_calls);
  }
  if (Array.isArray(obj.tool_calls) || (typeof obj.tool_calls === 'number' && Number.isFinite(obj.tool_calls) && obj.tool_calls >= 0)) {
    meta.toolCalls = obj.tool_calls;
  }

  const numTurns = typeof obj.num_turns === 'number' && Number.isFinite(obj.num_turns) && obj.num_turns >= 0
    ? Math.trunc(obj.num_turns)
    : undefined;
  if (numTurns !== undefined) {
    meta.numTurns = numTurns;
  }
  const explicitModelCalls = typeof obj.model_calls === 'number' && Number.isFinite(obj.model_calls) && obj.model_calls >= 0
    ? Math.trunc(obj.model_calls)
    : typeof obj.num_model_calls === 'number' && Number.isFinite(obj.num_model_calls) && obj.num_model_calls >= 0
      ? Math.trunc(obj.num_model_calls)
      : undefined;

  const rawUsage = obj.usage && typeof obj.usage === 'object' && !Array.isArray(obj.usage)
    ? (obj.usage as Record<string, unknown>)
    : undefined;

  if (rawUsage || explicitModelCalls !== undefined) {
    const intOrUndefined = (val: unknown): number | undefined =>
      typeof val === 'number' && Number.isFinite(val) && val >= 0 ? Math.trunc(val) : undefined;
    const promptTokens = intOrUndefined(rawUsage?.prompt_tokens ?? rawUsage?.input_tokens);
    const completionTokens = intOrUndefined(rawUsage?.completion_tokens ?? rawUsage?.output_tokens);
    const thinkingTokens = intOrUndefined(rawUsage?.thinking_tokens);
    if (thinkingTokens !== undefined && thinkingTokens > 0) {
      meta.thinkingTokens = thinkingTokens;
      meta.thoughtObserved = true;
    }
    const totalTokens = intOrUndefined(rawUsage?.total_tokens ?? rawUsage?.tokens_used)
      ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
    const cachedTokens = intOrUndefined(rawUsage?.cached_tokens ?? rawUsage?.cache_read_tokens);
    const usageModelCalls = intOrUndefined(rawUsage?.model_calls) ?? explicitModelCalls;
    const usage: UsageState = {
      ...(totalTokens !== undefined ? { tokensUsed: totalTokens } : {}),
      ...(promptTokens !== undefined ? { promptTokens } : {}),
      ...(completionTokens !== undefined ? { completionTokens } : {}),
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      ...(usageModelCalls !== undefined ? { modelCalls: usageModelCalls } : {})
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
  onEntry: (payload: { text?: string; withheld: boolean; meta: ParsedEnvelopeMeta }) => Promise<void>,
  maxLineBytes: number
) {
  let pending = '';
  const handleLine = async (line: string): Promise<void> => {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      await onEntry({ withheld: true, meta: { deniedActions: [], executedCalls: [] } });
      return;
    }
    const { text, withheld } = classifyStreamEntry(entry);
    const meta = extractEnvelopeMeta(entry);
    if (
      text ||
      withheld ||
      meta.status ||
      meta.error ||
      meta.usage ||
      meta.numTurns !== undefined ||
      meta.stepIdx !== undefined ||
      meta.isModelCallStep ||
      meta.thoughtObserved ||
      meta.deniedActions.length > 0 ||
      meta.numToolCalls !== undefined ||
      meta.toolCalls !== undefined ||
      meta.type === 'tool_use' ||
      meta.type === 'tool_call'
    ) {
      await onEntry({ ...(text ? { text } : {}), withheld, meta });
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

export async function writeIsolatedSettings(
  childHome: string,
  mode: 'review' | 'edit',
  workerWorkspace: string,
  denylist: readonly DenylistAnchor[] = [],
  options: { modelProvider?: 'gemini' } = {}
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

  const allProtectedGlobs = [
    ...RESERVED_AND_SECRET_GLOBS,
    ...denylist.flatMap(anchoredDenylistPatterns),
    ...relativeGlobs
  ];

  const allowRules = mode === 'review'
    ? [
        `read_file(${workerWorkspace})`,
        `read_file(${workerWorkspace}/**)`,
        `view_file(${workerWorkspace})`,
        `view_file(${workerWorkspace}/**)`
      ]
    : [
        `read_file(${workerWorkspace})`,
        `read_file(${workerWorkspace}/**)`,
        `view_file(${workerWorkspace})`,
        `view_file(${workerWorkspace}/**)`,
        `write_file(${workerWorkspace})`,
        `write_file(${workerWorkspace}/**)`,
        `write_to_file(${workerWorkspace})`,
        `write_to_file(${workerWorkspace}/**)`
      ];

  const denyRules = [
    ...UNIFIED_TOOL_DENIES,
    ...(mode === 'review' ? ['write_file(*)', 'write_to_file(*)'] : []),
    ...allProtectedGlobs.flatMap((glob) => [
      `read_file(${glob})`,
      `view_file(${glob})`,
      `write_file(${glob})`,
      `write_to_file(${glob})`
    ])
  ];

  const settings = {
    ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
    toolPermission: 'strict',
    enableTerminalSandbox: true,
    allowNonWorkspaceAccess: false,
    permissions: {
      allow: [...new Set(allowRules)],
      deny: [...new Set(denyRules)]
    }
  };
  await writeFile(path.join(cliDir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
}

export async function cleanupPrivateDirectories(
  childHome: string,
  childTmp: string
): Promise<{ cleaned: boolean; retained: string[] }> {
  const retained: string[] = [];
  await Promise.allSettled([
    rm(childHome, { recursive: true, force: true, maxRetries: 2 }),
    rm(childTmp, { recursive: true, force: true, maxRetries: 2 })
  ]);
  for (const dir of [childHome, childTmp]) {
    const info = await lstat(dir).catch(() => null);
    if (info) retained.push(path.basename(dir));
  }
  return { cleaned: retained.length === 0, retained };
}

export class AntigravityBackend implements SupervisorBackend {
  readonly kind = 'antigravity' as const;
  private probedSha256?: string | undefined;

  constructor(
    private readonly config: SupervisorConfig,
    private readonly options: AntigravityBackendOptions = {}
  ) {}

  async probe(): Promise<BackendCapabilities> {
    const cmd = executable(this.config);
    const resolved = await resolveAntigravityExecutable(cmd);
    if (!resolved.resolvedPath || !resolved.version) {
      return {
        available: false,
        backend: this.kind,
        executable: cmd,
        details: { error: resolved.error ?? 'Antigravity CLI (agy) could not be resolved or probed.' }
      };
    }
    this.probedSha256 = resolved.sha256 ?? undefined;
    if (!resolved.version || !isSupportedAntigravityVersion(resolved.version)) {
      return {
        available: false,
        backend: this.kind,
        executable: resolved.resolvedPath,
        version: resolved.version,
        details: {
          code: 'VSUP_VIBE_VERSION_UNSUPPORTED',
          error: `Unsupported Antigravity CLI version ${resolved.version}; supported versions: ${SUPPORTED_ANTIGRAVITY_VERSIONS.join(', ')}.`,
          expected_version: SUPPORTED_ANTIGRAVITY_VERSIONS.join(', '),
          actual_version: resolved.version
        }
      };
    }
    return {
      available: true,
      backend: this.kind,
      executable: resolved.resolvedPath,
      version: resolved.version,
      details: {
        version: resolved.version,
        executable: resolved.resolvedPath,
        ...(resolved.sha256 ? { sha256: resolved.sha256 } : {})
      }
    };
  }

  async runtimeCheck(): Promise<RuntimeCheck> {
    const cmd = executable(this.config);
    const resolved = await resolveAntigravityExecutable(cmd);
    this.probedSha256 = resolved.sha256 ?? undefined;
    const versionVerified = Boolean(resolved.version && isSupportedAntigravityVersion(resolved.version));
    const pinnedVersion = versionVerified && resolved.version ? resolved.version : SUPPORTED_ANTIGRAVITY_VERSION;
    return {
      executable: cmd,
      resolved_executable: resolved.resolvedPath,
      executable_found: Boolean(resolved.resolvedPath && versionVerified),
      pinned_version: pinnedVersion,
      version_verified: false,
      note: `Antigravity CLI (agy) execution backend pinned to ${SUPPORTED_ANTIGRAVITY_VERSIONS.join(', ')}${resolved.sha256 ? ` (sha256: ${resolved.sha256})` : ''}.`
    };
  }

  async preparationCheck(): Promise<PreparationStatus> {
    return (this.options.preparation?.check ?? checkPreparation)(this.config, this.options.dataDir);
  }

  async start(input: StartRunInput, callbacks: BackendCallbacks): Promise<BackendStartResult> {
    const apiKey = selectAntigravityApiKey(process.env);
    if (!apiKey) {
      throw supervisorError(
        'VSUP_BACKEND_ERROR',
        'Antigravity backend requires GEMINI_API_KEY, GOOGLE_API_KEY or ANTIGRAVITY_API_KEY in the environment for headless execution.',
        { reason: 'missing_gemini_api_key' }
      );
    }

    const cmd = executable(this.config);
    const resolved = await resolveAntigravityExecutable(cmd);
    if (!resolved.resolvedPath || !resolved.version) {
      throw supervisorError('VSUP_ANTIGRAVITY_NOT_FOUND', 'Antigravity CLI (agy) is unavailable or could not be probed.', {
        executable: cmd,
        ...(resolved.error ? { error: resolved.error } : {})
      });
    }
    if (!isSupportedAntigravityVersion(resolved.version)) {
      throw supervisorError(
        'VSUP_VIBE_VERSION_UNSUPPORTED',
        `Antigravity CLI version ${resolved.version} is not supported; exact version in [${SUPPORTED_ANTIGRAVITY_VERSIONS.join(', ')}] is required.`,
        { expected_version: SUPPORTED_ANTIGRAVITY_VERSIONS.join(', '), actual_version: resolved.version }
      );
    }
    const executablePath = resolved.resolvedPath;

    const binaryDigest = digest(await readFile(executablePath));
    const expectedDigest = this.options.expectedExecutableSha256 ?? this.probedSha256;
    if (expectedDigest && binaryDigest !== expectedDigest) {
      throw supervisorError(
        'VSUP_ANTIGRAVITY_EXEC_FAILED',
        `Antigravity binary digest changed between resolution and execution (expected ${expectedDigest}, got ${binaryDigest}).`,
        { reason: 'binary_digest_drift' }
      );
    }
    if (resolved.sha256 && binaryDigest !== resolved.sha256) {
      throw supervisorError(
        'VSUP_ANTIGRAVITY_EXEC_FAILED',
        `Antigravity binary digest changed between resolution and execution (expected ${resolved.sha256}, got ${binaryDigest}).`,
        { reason: 'binary_digest_drift' }
      );
    }
    this.probedSha256 = binaryDigest;

    const preparation = await this.preparationCheck();
    if (preparation.status !== 'passed') {
      throw supervisorError('VSUP_INVALID_STATE', 'Matching candidate conformance is required before dispatch. Run prepare check with the version-matched kit.', { preparation });
    }

    if (input.limits.maxCostUsd !== undefined || this.config.limits?.maxCostUsd !== undefined) {
      const ceiling = input.limits.maxCostUsd ?? this.config.limits?.maxCostUsd;
      throw supervisorError(
        'VSUP_BACKEND_ERROR',
        'Antigravity CLI does not report USD pricing in headless stream-json output, so max_cost_usd cannot be enforced.',
        { reason: 'price_unavailable', ceiling_usd: ceiling }
      );
    }

    if (input.limits.maxTokens !== undefined || this.config.limits?.maxTokens !== undefined) {
      const ceiling = input.limits.maxTokens ?? this.config.limits?.maxTokens;
      throw supervisorError(
        'VSUP_BACKEND_ERROR',
        'Antigravity CLI only reports token usage in the terminal result envelope after execution, so max_tokens cannot be enforced during execution.',
        { reason: 'token_ceiling_unsupported', ceiling_tokens: ceiling }
      );
    }

    await assertNoProjectVibeExtensions(input.cwd);
    await assertNoProjectVibeExtensions(input.workerWorkspace);
    await assertNoProjectAntigravityExtensions(input.cwd);
    await assertNoProjectAntigravityExtensions(input.workerWorkspace);

    const baseDir = input.runDirectory ?? path.join(await realpath(os.tmpdir()), `vsup-run-${input.runId}`);
    const childHome = path.join(baseDir, 'antigravity-home');
    const childTmp = path.join(baseDir, 'antigravity-tmp');
    await createPrivateDir(childHome);
    await createPrivateDir(childTmp);

    const neutralizerBin = await setupHeadlessBrowserNeutralizer(path.join(childHome, '.bin'));
    const childEnv = antigravityChildEnvironment(process.env, childHome, childTmp, neutralizerBin, apiKey);

    const anchors = workspaceAnchors(input.exclusions ?? [], input.cwd);
    const denylist = denylistAnchors(input.exclusions ?? [], input.cwd, input.workerWorkspace);
    const maxTurns = input.limits.maxTurns;
    const maxModelCalls = input.limits.maxModelCalls ?? turnBackstop(maxTurns);

    const sentinels = [...googleCredentialSecrets(childEnv), ...environmentSecrets(process.env)];
    const redact = (text: string): string => redactSecrets(text, sentinels);

    await writeIsolatedSettings(
      childHome,
      input.mode,
      input.workerWorkspace,
      denylist,
      { modelProvider: 'gemini' }
    );
    await writeAntigravityPreToolHook(childHome, {
      mode: input.mode,
      workerWorkspace: input.workerWorkspace,
      excludedAnchors: anchors,
      maxTurns,
      maxModelCalls
    });

    const listing = input.mode === 'review' ? await buildWorkspaceListing(input.workerWorkspace, {}, anchors) : null;
    const contextPrefix = (input.contextFiles ?? []).map((file) => `Approved context path: ${file}`).join('\n');
    const prefixParts = [listing?.text ?? null, contextPrefix].filter((part): part is string => Boolean(part && part.length > 0));
    let prompt = prefixParts.length > 0 ? `${prefixParts.join('\n\n')}\n\nTask:\n${input.task}` : input.task;
    if (input.mode === 'review' && input.output === 'findings') {
      prompt = `${prompt}\n\n${FINDINGS_OUTPUT_CONTRACT}`;
    }

    const args = [
      '-p', prompt,
      ...(input.mode === 'edit' ? ['--mode', 'accept-edits'] : []),
      '--output-format', 'stream-json',
      '--disable-slash-commands',
      '--sandbox',
      '--print-timeout', `${input.limits.timeoutSeconds}s`
    ];

    let latestSummary = '';
    let latestUsage: UsageState | undefined;
    let envelopeStatus: string | undefined;
    let envelopeError: string | undefined;
    let outputChain = Promise.resolve();
    let stderrChain = Promise.resolve();
    let streamExecutedCalls = 0;
    let streamToolUseEvents = 0;
    let observedTurns = 0;
    let observedModelCalls = 0;
    let limitStopReason: 'turn_limit' | 'token_limit' | undefined;
    let reasoningObservedCount = 0;
    let withheldTextCount = 0;
    const allDeniedActions: Array<{ tool: string; reason: string; path?: string }> = [];
    const allExecutedCalls: StreamExecutedCall[] = [];
    const childBox: { current?: ReturnType<typeof spawnManaged> } = {};

    const chunks = createStreamOutputParser(async ({ text, withheld, meta }) => {
      if (meta.status) envelopeStatus = meta.status;
      if (meta.error) envelopeError = meta.error;
      if (meta.thoughtObserved || withheld) reasoningObservedCount += 1;
      if (withheld) withheldTextCount += 1;
      if (meta.isModelCallStep) observedModelCalls += 1;
      if (meta.stepIdx !== undefined) observedTurns = Math.max(observedTurns, meta.stepIdx);
      if (meta.numTurns !== undefined) observedTurns = Math.max(observedTurns, meta.numTurns);
      if (meta.usage) {
        if (meta.usage.modelCalls !== undefined && meta.usage.modelCalls !== null) {
          observedModelCalls = Math.max(observedModelCalls, meta.usage.modelCalls);
        }
        latestUsage = { ...latestUsage, ...meta.usage };
      }
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
        observedTurns = Math.max(observedTurns, streamToolUseEvents);
      }
      for (const call of meta.executedCalls) {
        if (call.callId && allExecutedCalls.some((c) => c.callId && c.callId === call.callId)) {
          continue;
        }
        allExecutedCalls.push(call);
      }
      if (allExecutedCalls.length > 0) {
        streamExecutedCalls = Math.max(streamExecutedCalls, allExecutedCalls.length);
      }
      for (const denied of meta.deniedActions) {
        allDeniedActions.push(denied);
        await callbacks.onEvent({
          source: 'antigravity',
          type: 'tool_denied',
          severity: 'warning',
          data: {
            tool: redact(denied.tool),
            reason: redact(denied.reason),
            ...(denied.path ? { path: redact(denied.path) } : {})
          }
        });
      }
      if (text) {
        const redacted = redact(text);
        latestSummary = (latestSummary ? `${latestSummary}\n${redacted}` : redacted).slice(-input.limits.maxTranscriptBytes);
        await callbacks.onEvent({ source: 'antigravity', type: 'message', severity: 'info', data: { text: `${redacted}\n` } });
      }
      if (!limitStopReason && (observedTurns > maxTurns || observedModelCalls > maxModelCalls)) {
        limitStopReason = 'turn_limit';
        await callbacks.onEvent({
          source: 'supervisor',
          type: 'diagnostic',
          severity: 'warning',
          data: {
            reason: 'limit_enforced_during_execution',
            limit: 'turn_limit',
            observed_turns: observedTurns,
            max_turns: maxTurns,
            observed_model_calls: observedModelCalls,
            max_model_calls: maxModelCalls
          }
        });
        void childBox.current?.terminate().catch(() => undefined);
      }
    }, input.limits.maxEventBytes);

    const stderrRedactor = new StreamingRedactor(sentinels);
    let outputLimited = false;
    let parserFailed = false;

    const launchDigest = await readFile(executablePath).then(digest, () => null);
    if (launchDigest !== binaryDigest) {
      await cleanupPrivateDirectories(childHome, childTmp);
      throw supervisorError(
        'VSUP_ANTIGRAVITY_EXEC_FAILED',
        `Antigravity binary digest changed before launch (expected ${binaryDigest}, got ${launchDigest ?? 'unreadable'}).`,
        { reason: 'binary_digest_drift' }
      );
    }

    const child = spawnManaged(executablePath, args, {
      cwd: input.workerWorkspace,
      exactEnv: childEnv,
      maxStdoutBytes: input.limits.maxTranscriptBytes,
      maxStderrBytes: input.limits.maxEventBytes,
      onLimit: (stream) => {
        outputLimited = true;
        void callbacks.onState('failed', {
          error: supervisorError(
            'VSUP_OUTPUT_LIMIT',
            stream === 'stdout'
              ? 'Antigravity output exceeded the configured transcript limit.'
              : 'Antigravity diagnostic output exceeded the configured event limit.',
            { stream }
          )
        });
      },
      onStdout: (chunk) => {
        callbacks.onActivity?.('antigravity:stdout');
        outputChain = outputChain.then(() => chunks.push(chunk)).catch(async (error: unknown) => {
          if (!parserFailed) {
            parserFailed = true;
            await callbacks.onState('failed', {
              error: supervisorError('VSUP_OUTPUT_LIMIT', redact(String(error)))
            });
          }
          await child.terminate().catch(() => undefined);
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
    childBox.current = child;

    const deadlineAtMs = Date.now() + input.limits.timeoutSeconds * 1000 + 15_000;
    if (child.child.pid === undefined) {
      await child.terminate().catch(() => undefined);
      await cleanupPrivateDirectories(childHome, childTmp);
      throw supervisorError('VSUP_INTERNAL', 'Failed to retrieve child process PID for reaper registration.');
    }
    let reaper: Awaited<ReturnType<typeof startReaper>>;
    try {
      reaper = await startReaper({ workerPid: child.child.pid, deadlineAtMs });
    } catch (reaperError) {
      await child.terminate().catch(() => undefined);
      await cleanupPrivateDirectories(childHome, childTmp);
      throw supervisorError('VSUP_INTERNAL', `Failed to start process reaper: ${reaperError instanceof Error ? reaperError.message : String(reaperError)}`);
    }

    const opaque: AntigravityHandle['opaque'] = {
      process: child,
      reaper,
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
      executable: executablePath,
      version: resolved.version
    };
    const pin: PinIdentity = {
      vibeVersion: resolved.version,
      manifestSha256: binaryDigest,
      recordSha256: binaryDigest
    };

    await callbacks.onState('running', {
      preparation,
      process: processRecord,
      pin
    });

    const reportRetained = async (): Promise<void> => {
      const cleanup = await cleanupPrivateDirectories(childHome, childTmp);
      if (!cleanup.cleaned) {
        await callbacks.onEvent({
          source: 'supervisor',
          type: 'diagnostic',
          severity: 'warning',
          data: {
            reason: 'private_directories_retained',
            retained: cleanup.retained
          }
        });
      }
    };

    void child.done.then(async ({ code, signal }) => {
      opaque.done = true;
      let terminationError: unknown;
      for (let attempt = 0; attempt < NATURAL_EXIT_TERMINATION_ATTEMPTS; attempt += 1) {
        try {
          await child.terminate();
          terminationError = undefined;
          break;
        } catch (error) {
          terminationError = error;
        }
      }
      if (terminationError !== undefined) {
        await callbacks.onEvent({
          source: 'supervisor',
          type: 'diagnostic',
          severity: 'error',
          data: {
            reason: 'termination_unverified',
            text: redact(terminationError instanceof Error ? terminationError.message : String(terminationError))
          }
        });
        if (!outputLimited && !parserFailed) {
          await callbacks.onState('failed', {
            error: supervisorError(
              'VSUP_BACKEND_ERROR',
              'The Antigravity process group termination could not be verified; the run keeps its handle so cleanup can be retried.',
              { reason: 'termination_unverified' }
            )
          });
        }
        return;
      }
      try {
        if (opaque.reaper) {
          const reaperOutcome = await opaque.reaper.stop().catch(() => undefined);
          opaque.reaper = undefined;
          if (reaperOutcome && (reaperOutcome.reason === 'deadline' || reaperOutcome.reason === 'supervisor-gone')) {
            await callbacks.onEvent({
              source: 'supervisor',
              type: 'diagnostic',
              severity: 'warning',
              data: {
                text: `The process reaper ended the worker (${reaperOutcome.reason}).`,
                reason: 'reaper_fired'
              }
            });
          }
        }
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
          streamExecutedCalls,
          allExecutedCalls
        );

        for (const entry of hookEntries) {
          if (entry.decision === 'approve') {
            await callbacks.onEvent({
              source: 'antigravity',
              type: 'tool_call',
              severity: 'info',
              data: {
                tool: redact(entry.tool ?? 'tool'),
                ...(entry.path ? { path: redact(entry.path) } : {})
              }
            });
          } else {
            if (entry.reason === 'turn_limit_exceeded') {
              limitStopReason ??= 'turn_limit';
            }
            await callbacks.onEvent({
              source: 'antigravity',
              type: 'tool_denied',
              severity: 'warning',
              data: {
                tool: redact(entry.tool ?? 'tool'),
                reason: redact(entry.reason ?? 'denied'),
                ...(entry.path ? { path: redact(entry.path) } : {})
              }
            });
          }
        }

        await callbacks.onEvent({
          source: 'supervisor',
          type: 'diagnostic',
          severity: 'info',
          data: {
            reason: 'reasoning_observation',
            streamed_entries: reasoningObservedCount,
            withheld_text_entries: withheldTextCount,
            history_entries: null,
            history_audited: false
          }
        });

        const resolvedModelCalls = latestUsage?.modelCalls !== undefined
          ? latestUsage.modelCalls
          : observedModelCalls > 0
            ? observedModelCalls
            : null;
        const finalUsage: UsageState = {
          ...(latestUsage ?? {}),
          ...(resolvedModelCalls !== null || latestUsage !== undefined ? { modelCalls: resolvedModelCalls } : {}),
          toolCalls
        };

        if (limitStopReason) {
          await callbacks.onState('completed', {
            usage: finalUsage,
            approvals,
            result: { stopReason: limitStopReason, summary: opaque.latestSummary || 'Antigravity run stopped at configured limit.' }
          });
        } else if (code === 0 && (envelopeStatus === 'ERROR' || envelopeStatus === 'INVALID')) {
          const detail = envelopeError ? `: ${redact(envelopeError).slice(0, 300)}` : '';
          await callbacks.onState('failed', {
            usage: finalUsage,
            approvals,
            error: supervisorError('VSUP_ANTIGRAVITY_EXEC_FAILED', `Antigravity reported terminal envelope status ${envelopeStatus}${detail}.`)
          });
        } else if (code === 0 && (envelopeStatus === 'CANCELED' || envelopeStatus === 'INTERRUPTED')) {
          await callbacks.onState('cancelled', {
            usage: finalUsage,
            approvals
          });
        } else if (code === 0 && envelopeStatus === 'SUCCESS') {
          await callbacks.onState('completed', {
            usage: finalUsage,
            approvals,
            result: { stopReason: 'end_turn', summary: opaque.latestSummary || 'Antigravity run completed.' }
          });
        } else if (code === 0) {
          await callbacks.onState('failed', {
            usage: finalUsage,
            approvals,
            error: supervisorError('VSUP_ANTIGRAVITY_EXEC_FAILED', `Antigravity exited 0 without validated terminal SUCCESS status (status: ${envelopeStatus ?? 'absent'}).`)
          });
        } else {
          await callbacks.onState('failed', {
            usage: finalUsage,
            approvals,
            error: supervisorError('VSUP_BACKEND_CRASHED', `Antigravity exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`)
          });
        }
      } finally {
        await reportRetained();
      }
    }).catch(async (error: unknown) => {
      opaque.done = true;
      const errObj = (error && typeof error === 'object' && 'code' in error && 'remediation' in error)
        ? (error as SupervisorError)
        : supervisorError('VSUP_BACKEND_CRASHED', redact(String(error)));
      try {
        if (opaque.reaper) {
          await opaque.reaper.stop().catch(() => undefined);
          opaque.reaper = undefined;
        }
        const { approvals, toolCalls } = await readAntigravityHookLedger(
          childHome,
          allDeniedActions,
          streamExecutedCalls,
          allExecutedCalls
        ).catch(() => ({
          approvals: { records: [], truncated: false },
          toolCalls: { executed: allExecutedCalls.length, deniedByHandler: 0, deniedByPolicy: allDeniedActions.length },
          hookEntries: []
        }));
        await reportRetained();
        await callbacks.onState('failed', {
          usage: { ...(latestUsage ?? {}), toolCalls },
          approvals,
          error: errObj
        });
      } catch {
        await reportRetained();
        await callbacks.onState('failed', {
          error: errObj
        });
      }
    });

    return { handle, initialState: 'running' as const, process: processRecord };
  }

  async cancel(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as AntigravityHandle['opaque'];
    await state.process.terminate();
    if (state.reaper) {
      await state.reaper.stop().catch(() => undefined);
      state.reaper = undefined;
    }
  }

  async close(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as AntigravityHandle['opaque'];
    await state.process.terminate();
    if (state.reaper) {
      await state.reaper.stop().catch(() => undefined);
      state.reaper = undefined;
    }
    await cleanupPrivateDirectories(state.childHome, state.childTmp);
  }

  async terminateNow(handle: BackendRunHandle): Promise<void> {
    const state = handle.opaque as AntigravityHandle['opaque'];
    await state.process.terminate();
    if (state.reaper) {
      await state.reaper.stop().catch(() => undefined);
      state.reaper = undefined;
    }
  }
}
