import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ApprovalLedgerEntry,
  ApprovalLedgerSnapshot,
  RunMode,
  ToolCallCounts
} from '../contracts.js';
import { MAX_APPROVAL_LEDGER_RECORDS, supervisorError } from '../contracts.js';
import { createPrivateDir } from '../security/paths.js';
import {
  anchorsOf,
  canonicalJson,
  createExcludedMatcher,
  judgeWorkspacePath,
  restrictedSegment,
  type ExclusionSpec
} from './app-server/approvals.js';

export const REVIEW_ALLOWED_TOOLS = [
  'view_file',
  'read_file',
  'list_dir',
  'find_by_name',
  'grep_search'
] as const;

export const EDIT_ALLOWED_TOOLS = [
  ...REVIEW_ALLOWED_TOOLS,
  'write_to_file',
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
  'edit_file',
  'edit'
] as const;

export const TOOL_PATH_KEYS: Readonly<Record<string, readonly string[]>> = {
  view_file: ['AbsolutePath', 'path', 'file_path'],
  read_file: ['path', 'file_path', 'AbsolutePath', 'target_file'],
  list_dir: ['DirectoryPath', 'path', 'directory'],
  find_by_name: ['SearchDirectory', 'DirectoryPath', 'path', 'directory'],
  grep_search: ['SearchPath', 'SearchDirectory', 'path', 'directory'],
  write_to_file: ['TargetFile', 'path', 'file_path'],
  write_file: ['path', 'file_path', 'TargetFile'],
  replace_file_content: ['TargetFile', 'path', 'file_path'],
  multi_replace_file_content: ['TargetFile', 'path', 'file_path'],
  edit_file: ['target_file', 'TargetFile', 'path', 'file_path'],
  edit: ['path', 'file_path', 'TargetFile']
};

export const PATH_LIKE_ARGUMENT = /(?:path|paths|file|files|filename|filenames|dir|dirs|directory|directories|folder|folders|uri|cwd|root|location)$/i;
export const MAX_TOOL_ARGUMENT_CHARS = 1_048_576;
export const MAX_HOOK_INPUT_BYTES = 4 * 1_048_576;

export type ToolPathArguments =
  | { readable: true; args: Record<string, unknown>; paths: string[] }
  | { readable: false; args: unknown; reason: 'missing_file_path' | 'path_argument_unreadable' };

export function parseToolArguments(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (value === undefined || value === null) return {};
  if (typeof value === 'string') {
    if (value.length > MAX_TOOL_ARGUMENT_CHARS) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pathKeysOf(tool: string): readonly string[] {
  return Object.prototype.hasOwnProperty.call(TOOL_PATH_KEYS, tool) ? TOOL_PATH_KEYS[tool]! : [];
}

export function readToolPathArguments(tool: string, raw: unknown): ToolPathArguments {
  const args = parseToolArguments(raw);
  if (!args) return { readable: false, args: raw, reason: 'path_argument_unreadable' };
  const known = pathKeysOf(tool);
  for (const [key, value] of Object.entries(args)) {
    if (known.includes(key)) {
      if (typeof value !== 'string' || value.trim().length === 0) return { readable: false, args, reason: 'path_argument_unreadable' };
    } else if (PATH_LIKE_ARGUMENT.test(key.replace(/[^A-Za-z0-9]/g, '')) && typeof value !== 'boolean' && typeof value !== 'number' && value !== null) {
      return { readable: false, args, reason: 'path_argument_unreadable' };
    }
  }
  const paths = known.flatMap((key) => (typeof args[key] === 'string' ? [(args[key] as string).trim()] : []));
  if (paths.length === 0) return { readable: false, args, reason: 'missing_file_path' };
  return { readable: true, args, paths };
}

export function primaryToolPath(tool: string, args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  for (const key of pathKeysOf(tool)) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function toolCallFingerprint(tool: string, args: unknown): string | null {
  try {
    return createHash('sha256').update(canonicalJson({ tool, args })).digest('hex');
  } catch {
    return null;
  }
}

export interface StreamExecutedCall {
  callId?: string | null;
  turnId?: string | null;
  tool: string;
  args?: Record<string, unknown> | null;
  path?: string | null;
  fingerprint?: string | null;
}

export interface DirectoryVerificationResult {
  allowed: boolean;
  reason?: 'path_invalid' | 'path_unresolvable' | 'path_outside_workspace' | 'path_reserved' | 'path_secret' | 'path_excluded' | 'path_symlink';
}

export async function verifyDirectoryDescendants(
  resolvedDir: string,
  realWorkspace: string,
  excludedAnchors: readonly ExclusionSpec[] = [],
  isRecursive: boolean
): Promise<DirectoryVerificationResult> {
  const relDir = path.relative(realWorkspace, resolvedDir);
  if (relDir.startsWith('..') || path.isAbsolute(relDir)) {
    return { allowed: false, reason: 'path_outside_workspace' };
  }
  const dirSegments = relDir === '' ? [] : relDir.split(path.sep).filter(Boolean);
  const loweredDirSegments = dirSegments.map((s) => s.toLowerCase());

  if (relDir === '') {
    if (isRecursive) {
      if (excludedAnchors.length > 0) {
        return { allowed: false, reason: 'path_excluded' };
      }
      return { allowed: false, reason: 'path_reserved' };
    }
    if (excludedAnchors.length > 0) {
      return { allowed: false, reason: 'path_excluded' };
    }
    const isExcluded = createExcludedMatcher(excludedAnchors);
    try {
      const entries = await readdir(resolvedDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isSymbolicLink()) return { allowed: false, reason: 'path_symlink' };
        const childRelParts = [ent.name];
        const restricted = restrictedSegment(childRelParts);
        if (restricted) return { allowed: false, reason: restricted };
        if (isExcluded(childRelParts)) return { allowed: false, reason: 'path_excluded' };
      }
    } catch {
      return { allowed: false, reason: 'path_unresolvable' };
    }
    return { allowed: true };
  }

  if (isRecursive && excludedAnchors.length > 0) {
    const anchors = anchorsOf(excludedAnchors);
    for (const anchor of anchors) {
      const anchorPrefixLower = anchor.prefix.map((s) => s.toLowerCase());
      if (
        anchorPrefixLower.length > loweredDirSegments.length &&
        loweredDirSegments.every((s, i) => s === anchorPrefixLower[i])
      ) {
        return { allowed: false, reason: 'path_excluded' };
      }
      for (const glob of anchor.globs) {
        const globParts = glob.toLowerCase().split('/').filter(Boolean);
        if (anchorPrefixLower.length === 0) {
          if (
            globParts.length > loweredDirSegments.length &&
            loweredDirSegments.every((s, i) => s === globParts[i])
          ) {
            return { allowed: false, reason: 'path_excluded' };
          }
        }
      }
    }
  }

  const isExcluded = createExcludedMatcher(excludedAnchors);
  const maxDepth = isRecursive ? 4 : 1;
  const maxEntries = 500;
  const deadlineMs = Date.now() + 2000;
  let totalEntries = 0;

  interface StackItem {
    dir: string;
    relParts: string[];
    depth: number;
  }
  const stack: StackItem[] = [{ dir: resolvedDir, relParts: dirSegments, depth: 0 }];

  while (stack.length > 0) {
    if (Date.now() > deadlineMs) {
      return { allowed: false, reason: 'path_invalid' };
    }
    const current = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      return { allowed: false, reason: 'path_unresolvable' };
    }

    for (const ent of entries) {
      totalEntries += 1;
      if (totalEntries > maxEntries) {
        return { allowed: false, reason: 'path_invalid' };
      }
      if (ent.isSymbolicLink()) {
        return { allowed: false, reason: 'path_symlink' };
      }

      const childRelParts = [...current.relParts, ent.name];
      const restricted = restrictedSegment(childRelParts);
      if (restricted) {
        return { allowed: false, reason: restricted };
      }

      if (isExcluded(childRelParts)) {
        return { allowed: false, reason: 'path_excluded' };
      }

      if (ent.isDirectory()) {
        if (current.depth + 1 > maxDepth) {
          if (isRecursive) {
            return { allowed: false, reason: 'path_invalid' };
          }
        } else if (isRecursive) {
          stack.push({
            dir: path.join(current.dir, ent.name),
            relParts: childRelParts,
            depth: current.depth + 1
          });
        }
      } else if (!ent.isFile()) {
        return { allowed: false, reason: 'path_invalid' };
      }
    }
  }

  if (isRecursive) {
    return { allowed: false, reason: 'path_invalid' };
  }

  return { allowed: true };
}

export interface EvaluateAntigravityToolCallResult {
  decision: 'allow' | 'deny';
  reason: string | null;
  entry: ApprovalLedgerEntry;
  hookResponse: { decision: 'allow' } | { decision: 'deny'; reason: string };
}

export interface AntigravityPreToolHookOptions {
  mode: RunMode;
  workerWorkspace: string;
  excludedAnchors?: readonly ExclusionSpec[];
  maxTurns?: number;
  maxModelCalls?: number;
}

function policyErrorResult(): EvaluateAntigravityToolCallResult {
  const entry: ApprovalLedgerEntry = {
    callbackId: `agy-hook-${randomUUID()}`,
    relatedEntryId: null,
    turnId: null,
    tool: null,
    path: null,
    fingerprint: null,
    decision: 'deny',
    reason: 'policy_error'
  };
  return { decision: 'deny', reason: 'policy_error', entry, hookResponse: { decision: 'deny', reason: 'policy_error' } };
}

export async function evaluateAntigravityToolCall(
  options: AntigravityPreToolHookOptions,
  payload: unknown
): Promise<EvaluateAntigravityToolCallResult> {
  let raw: unknown = payload;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw) > MAX_HOOK_INPUT_BYTES) return policyErrorResult();
    try {
      raw = JSON.parse(raw);
    } catch {
      return policyErrorResult();
    }
  }

  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const toolCall = (obj.toolCall && typeof obj.toolCall === 'object' && !Array.isArray(obj.toolCall))
    ? (obj.toolCall as Record<string, unknown>)
    : undefined;
  const toolNameRaw = toolCall?.name ?? obj.tool_name ?? obj.name ?? obj.tool;
  const toolName = typeof toolNameRaw === 'string' ? toolNameRaw : '';
  const rawArgs = toolCall?.args ?? obj.tool_input ?? obj.args ?? obj.input;
  const rawCallId = toolCall?.id ?? toolCall?.call_id ?? obj.id ?? obj.call_id ?? obj.callId;
  const callId = typeof rawCallId === 'string' && rawCallId.trim().length > 0 ? rawCallId.trim() : null;
  const stepIdx = obj.stepIdx ?? obj.step_index ?? obj.turnId ?? obj.turn_id;
  const turnId = stepIdx !== undefined && stepIdx !== null ? String(stepIdx) : null;
  const numericStepIdx = typeof stepIdx === 'number' && Number.isFinite(stepIdx) ? Math.trunc(stepIdx) : undefined;
  const fingerprint = toolCallFingerprint(toolName, parseToolArguments(rawArgs) ?? rawArgs ?? null);

  const decide = (reason: string | null, recordedPath: string | null, tool: string | null = toolName): EvaluateAntigravityToolCallResult => {
    const entry: ApprovalLedgerEntry = {
      callbackId: callId ? `agy-call-${callId}` : `agy-hook-${randomUUID()}`,
      relatedEntryId: callId,
      turnId,
      tool,
      path: recordedPath === null ? null : recordedPath.slice(0, 512),
      fingerprint,
      decision: reason === null ? 'approve' : 'deny',
      reason
    };
    return reason === null
      ? { decision: 'allow', reason: null, entry, hookResponse: { decision: 'allow' } }
      : { decision: 'deny', reason, entry, hookResponse: { decision: 'deny', reason } };
  };

  if (
    numericStepIdx !== undefined &&
    ((options.maxTurns !== undefined && numericStepIdx > options.maxTurns) ||
      (options.maxModelCalls !== undefined && numericStepIdx > options.maxModelCalls))
  ) {
    return decide('turn_limit_exceeded', null, toolName || null);
  }

  const allowedTools = options.mode === 'edit' ? EDIT_ALLOWED_TOOLS : REVIEW_ALLOWED_TOOLS;
  if (!(allowedTools as readonly string[]).includes(toolName)) {
    return decide('tool_not_in_profile', null, toolName || null);
  }

  const pathArguments = readToolPathArguments(toolName, rawArgs);
  if (!pathArguments.readable) return decide(pathArguments.reason, null);
  const candidatePaths = pathArguments.paths;

  const isDirectoryReadTool = ['list_dir', 'find_by_name', 'grep_search'].includes(toolName);
  const isRecursiveTool = ['find_by_name', 'grep_search'].includes(toolName);

  let realWorkspace: string;
  try {
    realWorkspace = await realpath(options.workerWorkspace);
  } catch {
    return decide('path_unresolvable', candidatePaths[0] ?? null);
  }

  for (const candidatePath of candidatePaths) {
    if (candidatePath.length === 0 || candidatePath.length > 4096 || candidatePath.includes('\0') || candidatePath.startsWith('~')) {
      return decide('path_invalid', candidatePath);
    }

    const rawSegments = candidatePath.split(/[\\/]+/).filter(Boolean);
    if (rawSegments.some((s) => s.toLowerCase() === '.gemini')) {
      return decide('path_reserved', candidatePath);
    }

    const absolute = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(options.workerWorkspace, candidatePath);
    let resolved: string | null = null;
    try {
      resolved = await realpath(absolute);
    } catch {
      resolved = null;
    }

    if (resolved !== null && resolved === realWorkspace && isDirectoryReadTool) {
      const dirVerification = await verifyDirectoryDescendants(resolved, realWorkspace, options.excludedAnchors ?? [], isRecursiveTool);
      if (!dirVerification.allowed) return decide(dirVerification.reason ?? 'path_excluded', candidatePath);
      continue;
    }

    const judgement = await judgeWorkspacePath(options.workerWorkspace, candidatePath, options.excludedAnchors ?? []);
    if (!judgement.allowed) return decide(judgement.reason, candidatePath);

    if (isDirectoryReadTool) {
      let stats: import('node:fs').Stats;
      try {
        stats = await lstat(judgement.resolved);
      } catch {
        return decide('path_unresolvable', candidatePath);
      }
      if (!stats.isDirectory()) return decide('path_invalid', candidatePath);
      const dirVerification = await verifyDirectoryDescendants(judgement.resolved, realWorkspace, options.excludedAnchors ?? [], isRecursiveTool);
      if (!dirVerification.allowed) return decide(dirVerification.reason ?? 'path_excluded', candidatePath);
    } else {
      const stats = await lstat(judgement.resolved).catch(() => null);
      if (stats && stats.isDirectory()) return decide('path_invalid', candidatePath);
    }

    const relSegments = judgement.relative.split(path.sep).filter(Boolean);
    if (relSegments.some((s) => s.toLowerCase() === '.gemini')) {
      return decide('path_reserved', candidatePath);
    }
  }

  return decide(null, candidatePaths[0] ?? null);
}

const PRE_TOOL_HOOK_SCRIPT = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.join(__dirname, 'hook-policy.json');

const REVIEW_ALLOWED_TOOLS = ${JSON.stringify(REVIEW_ALLOWED_TOOLS)};
const EDIT_ALLOWED_TOOLS = ${JSON.stringify(EDIT_ALLOWED_TOOLS)};

const RESERVED_DIRECTORIES = ['.git', '.vibe', '.agents', '.gemini'];
const RESERVED_FILES = ['.vibeignore'];
const SENSITIVE_FILE_PATTERNS = ['.env', '.env.*', '.envrc', '.envrc.*', '*.pem', '*.key', '*.p12', '*.pfx'];

const TOOL_PATH_KEYS = ${JSON.stringify(TOOL_PATH_KEYS)};
const PATH_LIKE_ARGUMENT = new RegExp(${JSON.stringify(PATH_LIKE_ARGUMENT.source)}, ${JSON.stringify(PATH_LIKE_ARGUMENT.flags)});
const MAX_TOOL_ARGUMENT_CHARS = ${MAX_TOOL_ARGUMENT_CHARS};
const MAX_HOOK_INPUT_BYTES = ${MAX_HOOK_INPUT_BYTES};

function parseToolArguments(raw) {
  let value = raw;
  if (value === undefined || value === null) return {};
  if (typeof value === 'string') {
    if (value.length > MAX_TOOL_ARGUMENT_CHARS) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function pathKeysOf(tool) {
  return Object.prototype.hasOwnProperty.call(TOOL_PATH_KEYS, tool) ? TOOL_PATH_KEYS[tool] : [];
}

function readToolPathArguments(tool, raw) {
  const args = parseToolArguments(raw);
  if (!args) return { readable: false, args: raw, reason: 'path_argument_unreadable' };
  const known = pathKeysOf(tool);
  for (const [key, value] of Object.entries(args)) {
    if (known.includes(key)) {
      if (typeof value !== 'string' || value.trim().length === 0) return { readable: false, args, reason: 'path_argument_unreadable' };
    } else if (PATH_LIKE_ARGUMENT.test(key.replace(/[^A-Za-z0-9]/g, '')) && typeof value !== 'boolean' && typeof value !== 'number' && value !== null) {
      return { readable: false, args, reason: 'path_argument_unreadable' };
    }
  }
  const paths = known.flatMap((key) => (typeof args[key] === 'string' ? [args[key].trim()] : []));
  if (paths.length === 0) return { readable: false, args, reason: 'missing_file_path' };
  return { readable: true, args, paths };
}

const GLOBSTAR = '**';

function compileSegment(pattern) {
  const pieces = pattern.toLowerCase().split('*');
  const first = pieces[0] ?? '';
  if (pieces.length === 1) return (segment) => segment === first;
  const last = pieces[pieces.length - 1] ?? '';
  const middle = pieces.slice(1, -1).filter((piece) => piece !== '');
  const minimum = first.length + last.length + middle.reduce((total, piece) => total + piece.length, 0);
  return (segment) => {
    if (segment.length < minimum || !segment.startsWith(first) || !segment.endsWith(last)) return false;
    const end = segment.length - last.length;
    let position = first.length;
    for (const piece of middle) {
      const found = segment.indexOf(piece, position);
      if (found < 0 || found + piece.length > end) return false;
      position = found + piece.length;
    }
    return true;
  };
}

function compileGlob(glob) {
  const parts = glob.split('/');
  return { parts: parts.map((part) => (part === GLOBSTAR ? GLOBSTAR : compileSegment(part))), anywhere: parts.length === 1 };
}

function withEmptyGlobstars(parts, states) {
  const closed = new Set();
  for (const start of states) {
    let index = start;
    closed.add(index);
    while (index < parts.length && parts[index] === GLOBSTAR) {
      index += 1;
      closed.add(index);
    }
  }
  return closed;
}

function step(parts, states, segment) {
  const next = new Set();
  for (const index of withEmptyGlobstars(parts, states)) {
    if (index >= parts.length) continue;
    const part = parts[index];
    if (part === GLOBSTAR) next.add(index);
    else if (part(segment)) next.add(index + 1);
  }
  return next;
}

function advance(parts, segments) {
  let states = new Set([0]);
  for (const segment of segments) {
    states = step(parts, states, segment);
    if (states.size === 0) break;
  }
  return states;
}

function matchesWhole(parts, segments) {
  return withEmptyGlobstars(parts, advance(parts, segments)).has(parts.length);
}

function matchesGlob(glob, lowered) {
  if (glob.anywhere) return lowered.some((segment) => matchesWhole(glob.parts, [segment]));
  return matchesWhole(glob.parts, lowered);
}

function anchorsOf(specs) {
  const plain = specs.filter((spec) => typeof spec === 'string');
  const anchored = specs.filter((spec) => spec && typeof spec === 'object');
  return plain.length === 0 ? anchored : [{ prefix: [], globs: plain }, ...anchored];
}

function createExcludedMatcher(specs) {
  const compiled = anchorsOf(specs || [])
    .filter((anchor) => Array.isArray(anchor.globs) && anchor.globs.length > 0)
    .map((anchor) => ({
      prefix: (anchor.prefix || []).map((segment) => segment.toLowerCase()),
      globs: anchor.globs.map(compileGlob)
    }));
  if (compiled.length === 0) return () => false;
  return (segments) => {
    const lowered = segments.map((segment) => segment.toLowerCase());
    return compiled.some((anchor) => {
      const full = anchor.prefix.length === 0 ? lowered : [...anchor.prefix, ...lowered];
      return anchor.globs.some((glob) => matchesGlob(glob, full));
    });
  };
}

const SENSITIVE_MATCHERS = SENSITIVE_FILE_PATTERNS.map(compileSegment);
const RESERVED_NAMES = new Set([...RESERVED_DIRECTORIES, ...RESERVED_FILES].map((name) => name.toLowerCase()));

function restrictedSegment(segments) {
  const lowered = segments.map((segment) => segment.toLowerCase());
  for (const segment of lowered) if (RESERVED_NAMES.has(segment)) return 'path_reserved';
  for (const segment of lowered) if (SENSITIVE_MATCHERS.some((matches) => matches(segment))) return 'path_secret';
  return null;
}

function isPathWithinRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function locate(absolute) {
  try {
    return { resolved: await fs.promises.realpath(absolute) };
  } catch (error) {
    const code = error?.code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') return { reason: 'path_unresolvable' };
  }
  const { root } = path.parse(absolute);
  const parts = absolute.slice(root.length).split(/[\\\\/]+/).filter((part) => part !== '' && part !== '.');
  for (let keep = parts.length - 1; keep >= 0; keep -= 1) {
    let real;
    try {
      real = await fs.promises.realpath(\`\${root}\${parts.slice(0, keep).join(path.sep)}\`);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      return { reason: 'path_unresolvable' };
    }
    const remainder = parts.slice(keep);
    if (remainder.includes('..')) return { reason: 'path_unresolvable' };
    try {
      await fs.promises.lstat(path.join(real, remainder[0] ?? ''));
      return { reason: 'path_symlink' };
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') return { reason: 'path_unresolvable' };
    }
    return { resolved: path.join(real, ...remainder) };
  }
  return { reason: 'path_unresolvable' };
}

async function verifyDirectoryDescendants(resolvedDir, realWorkspace, excludedAnchors, isRecursive) {
  const relDir = path.relative(realWorkspace, resolvedDir);
  if (relDir.startsWith('..') || path.isAbsolute(relDir)) {
    return { allowed: false, reason: 'path_outside_workspace' };
  }
  const dirSegments = relDir === '' ? [] : relDir.split(path.sep).filter(Boolean);
  const loweredDirSegments = dirSegments.map((s) => s.toLowerCase());

  if (relDir === '') {
    if (isRecursive) {
      if (Array.isArray(excludedAnchors) && excludedAnchors.length > 0) {
        return { allowed: false, reason: 'path_excluded' };
      }
      return { allowed: false, reason: 'path_reserved' };
    }
    if (Array.isArray(excludedAnchors) && excludedAnchors.length > 0) {
      return { allowed: false, reason: 'path_excluded' };
    }
    const isExcluded = createExcludedMatcher(excludedAnchors || []);
    try {
      const entries = await fs.promises.readdir(resolvedDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isSymbolicLink()) return { allowed: false, reason: 'path_symlink' };
        const childRelParts = [ent.name];
        const restricted = restrictedSegment(childRelParts);
        if (restricted) return { allowed: false, reason: restricted };
        if (isExcluded(childRelParts)) return { allowed: false, reason: 'path_excluded' };
      }
    } catch {
      return { allowed: false, reason: 'path_unresolvable' };
    }
    return { allowed: true };
  }

  if (isRecursive && Array.isArray(excludedAnchors) && excludedAnchors.length > 0) {
    const anchors = anchorsOf(excludedAnchors);
    for (const anchor of anchors) {
      const anchorPrefixLower = (anchor.prefix || []).map((s) => s.toLowerCase());
      if (
        anchorPrefixLower.length > loweredDirSegments.length &&
        loweredDirSegments.every((s, i) => s === anchorPrefixLower[i])
      ) {
        return { allowed: false, reason: 'path_excluded' };
      }
      for (const glob of (anchor.globs || [])) {
        const globParts = glob.toLowerCase().split('/').filter(Boolean);
        if (anchorPrefixLower.length === 0) {
          if (
            globParts.length > loweredDirSegments.length &&
            loweredDirSegments.every((s, i) => s === globParts[i])
          ) {
            return { allowed: false, reason: 'path_excluded' };
          }
        }
      }
    }
  }

  const isExcluded = createExcludedMatcher(excludedAnchors || []);
  const maxDepth = isRecursive ? 4 : 1;
  const maxEntries = 500;
  const deadlineMs = Date.now() + 2000;
  let totalEntries = 0;

  const stack = [{ dir: resolvedDir, relParts: dirSegments, depth: 0 }];
  while (stack.length > 0) {
    if (Date.now() > deadlineMs) {
      return { allowed: false, reason: 'path_invalid' };
    }
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
    } catch {
      return { allowed: false, reason: 'path_unresolvable' };
    }

    for (const ent of entries) {
      totalEntries += 1;
      if (totalEntries > maxEntries) {
        return { allowed: false, reason: 'path_invalid' };
      }
      if (ent.isSymbolicLink()) {
        return { allowed: false, reason: 'path_symlink' };
      }

      const childRelParts = [...current.relParts, ent.name];
      const restricted = restrictedSegment(childRelParts);
      if (restricted) {
        return { allowed: false, reason: restricted };
      }

      if (isExcluded(childRelParts)) {
        return { allowed: false, reason: 'path_excluded' };
      }

      if (ent.isDirectory()) {
        if (current.depth + 1 > maxDepth) {
          if (isRecursive) {
            return { allowed: false, reason: 'path_invalid' };
          }
        } else if (isRecursive) {
          stack.push({
            dir: path.join(current.dir, ent.name),
            relParts: childRelParts,
            depth: current.depth + 1
          });
        }
      } else if (!ent.isFile()) {
        return { allowed: false, reason: 'path_invalid' };
      }
    }
  }

  if (isRecursive) {
    return { allowed: false, reason: 'path_invalid' };
  }

  return { allowed: true };
}

function canonicalize(value, depth) {
  if (depth > 32) throw new RangeError('input is nested too deeply');
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key], depth + 1);
    return sorted;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value, 0)) ?? 'null';
}

function computeFingerprint(tool, args) {
  try {
    return crypto.createHash('sha256').update(canonicalJson({ tool, args })).digest('hex');
  } catch {
    return null;
  }
}

function recordAndExit(policy, entryData, callId) {
  const entry = {
    callbackId: callId ? ('agy-call-' + callId) : ('agy-hook-' + crypto.randomUUID()),
    relatedEntryId: callId || null,
    turnId: entryData.turnId,
    tool: entryData.tool,
    path: entryData.path ? entryData.path.slice(0, 512) : null,
    fingerprint: entryData.fingerprint,
    decision: entryData.decision,
    reason: entryData.reason
  };
  try {
    fs.mkdirSync(path.dirname(policy.ledgerPath), { recursive: true });
    fs.appendFileSync(policy.ledgerPath, JSON.stringify(entry) + '\\n', 'utf8');
  } catch {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'policy_error' }) + '\\n');
    process.exit(0);
  }
  if (entryData.decision === 'approve') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\\n');
  } else {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: entryData.reason }) + '\\n');
  }
  process.exit(0);
}

async function main() {
  let policy;
  try {
    policy = JSON.parse(await fs.promises.readFile(policyPath, 'utf8'));
  } catch {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'policy_error' }) + '\\n');
    process.exit(0);
  }

  const chunks = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += chunk.length;
    if (inputBytes > MAX_HOOK_INPUT_BYTES) {
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'policy_error' }) + '\\n');
      process.exit(0);
    }
    chunks.push(chunk);
  }
  const inputStr = Buffer.concat(chunks).toString('utf8');
  let payload;
  try {
    payload = JSON.parse(inputStr);
  } catch {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'policy_error' }) + '\\n');
    process.exit(0);
  }

  const obj = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const toolCall = (obj.toolCall && typeof obj.toolCall === 'object' && !Array.isArray(obj.toolCall)) ? obj.toolCall : undefined;
  const toolNameRaw = toolCall?.name ?? obj.tool_name ?? obj.name ?? obj.tool;
  const toolName = typeof toolNameRaw === 'string' ? toolNameRaw : '';
  const rawArgs = toolCall?.args ?? obj.tool_input ?? obj.args ?? obj.input;
  const args = parseToolArguments(rawArgs) ?? rawArgs ?? null;
  const rawCallId = toolCall?.id ?? toolCall?.call_id ?? obj.id ?? obj.call_id ?? obj.callId;
  const callId = typeof rawCallId === 'string' && rawCallId.trim().length > 0 ? rawCallId.trim() : null;
  const stepIdx = obj.stepIdx ?? obj.step_index ?? obj.turnId ?? obj.turn_id;
  const turnId = stepIdx !== undefined && stepIdx !== null ? String(stepIdx) : null;
  const numericStepIdx = typeof stepIdx === 'number' && Number.isFinite(stepIdx) ? Math.trunc(stepIdx) : undefined;

  let priorCalls = 0;
  try {
    const existingLedger = await fs.promises.readFile(policy.ledgerPath, 'utf8');
    priorCalls = existingLedger.split('\\n').filter((line) => line.trim().length > 0).length;
  } catch {
    priorCalls = 0;
  }
  const currentCallNumber = priorCalls + 1;
  const maxTurns = typeof policy.maxTurns === 'number' && Number.isFinite(policy.maxTurns) ? policy.maxTurns : undefined;
  const maxModelCalls = typeof policy.maxModelCalls === 'number' && Number.isFinite(policy.maxModelCalls) ? policy.maxModelCalls : undefined;

  if (
    (maxTurns !== undefined && ((numericStepIdx !== undefined && numericStepIdx > maxTurns) || currentCallNumber > maxTurns)) ||
    (maxModelCalls !== undefined && ((numericStepIdx !== undefined && numericStepIdx > maxModelCalls) || currentCallNumber > maxModelCalls))
  ) {
    return recordAndExit(policy, {
      turnId,
      tool: toolName || null,
      path: null,
      fingerprint: computeFingerprint(toolName, args),
      decision: 'deny',
      reason: 'turn_limit_exceeded'
    }, callId);
  }

  const allowedTools = policy.mode === 'edit' ? EDIT_ALLOWED_TOOLS : REVIEW_ALLOWED_TOOLS;
  if (!allowedTools.includes(toolName)) {
    return recordAndExit(policy, {
      turnId,
      tool: toolName || null,
      path: null,
      fingerprint: computeFingerprint(toolName, args),
      decision: 'deny',
      reason: 'tool_not_in_profile'
    }, callId);
  }

  const pathArguments = readToolPathArguments(toolName, rawArgs);
  if (!pathArguments.readable) {
    return recordAndExit(policy, {
      turnId,
      tool: toolName,
      path: null,
      fingerprint: computeFingerprint(toolName, args),
      decision: 'deny',
      reason: pathArguments.reason
    }, callId);
  }
  const candidatePaths = pathArguments.paths;

  const isDirectoryReadTool = ['list_dir', 'find_by_name', 'grep_search'].includes(toolName);
  const isRecursiveTool = ['find_by_name', 'grep_search'].includes(toolName);

  let root;
  try {
    root = await fs.promises.realpath(policy.workerWorkspace);
  } catch {
    return recordAndExit(policy, {
      turnId,
      tool: toolName,
      path: candidatePaths[0] || null,
      fingerprint: computeFingerprint(toolName, args),
      decision: 'deny',
      reason: 'path_unresolvable'
    }, callId);
  }

  const isExcluded = createExcludedMatcher(policy.excludedAnchors || []);

  for (const rawPath of candidatePaths) {
    if (rawPath.length === 0 || rawPath.length > 4096 || rawPath.includes('\\0') || rawPath.startsWith('~')) {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: 'path_invalid'
      }, callId);
    }

    const rawSegments = rawPath.split(/[\\\\/]+/).filter(Boolean);
    if (rawSegments.some((s) => s.toLowerCase() === '.gemini')) {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: 'path_reserved'
      }, callId);
    }

    const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(policy.workerWorkspace, rawPath);
    let resolved = null;
    try {
      resolved = await fs.promises.realpath(absolute);
    } catch {
      resolved = null;
    }

    if (resolved !== null && resolved === root && isDirectoryReadTool) {
      const dirVerification = await verifyDirectoryDescendants(resolved, root, policy.excludedAnchors || [], isRecursiveTool);
      if (!dirVerification.allowed) {
        return recordAndExit(policy, {
          turnId,
          tool: toolName,
          path: rawPath,
          fingerprint: computeFingerprint(toolName, args),
          decision: 'deny',
          reason: dirVerification.reason || 'path_excluded'
        }, callId);
      }
      continue;
    }

    const located = await locate(absolute);
    if ('reason' in located) {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: located.reason
      }, callId);
    }

    if (!isPathWithinRoot(root, located.resolved)) {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: 'path_outside_workspace'
      }, callId);
    }

    if (located.resolved === root && isDirectoryReadTool) {
      const dirVerification = await verifyDirectoryDescendants(located.resolved, root, policy.excludedAnchors || [], isRecursiveTool);
      if (!dirVerification.allowed) {
        return recordAndExit(policy, {
          turnId,
          tool: toolName,
          path: rawPath,
          fingerprint: computeFingerprint(toolName, args),
          decision: 'deny',
          reason: dirVerification.reason || 'path_excluded'
        }, callId);
      }
      continue;
    }

    const relative = path.relative(root, located.resolved);
    if (relative === '') {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: 'path_invalid'
      }, callId);
    }

    const lexical = path.relative(policy.workerWorkspace, path.resolve(absolute));
    const lexicalSegments = lexical === '' || lexical.startsWith('..') || path.isAbsolute(lexical) ? [] : lexical.split(path.sep);
    const restricted = restrictedSegment([...relative.split(path.sep), ...lexicalSegments]);
    if (restricted) {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: restricted
      }, callId);
    }

    if (isExcluded(relative.split(path.sep)) || (lexicalSegments.length > 0 && isExcluded(lexicalSegments))) {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: 'path_excluded'
      }, callId);
    }

    if (isDirectoryReadTool) {
      let stats = null;
      try {
        stats = await fs.promises.lstat(located.resolved);
      } catch {
        return recordAndExit(policy, {
          turnId,
          tool: toolName,
          path: rawPath,
          fingerprint: computeFingerprint(toolName, args),
          decision: 'deny',
          reason: 'path_unresolvable'
        }, callId);
      }
      if (!stats.isDirectory()) {
        return recordAndExit(policy, {
          turnId,
          tool: toolName,
          path: rawPath,
          fingerprint: computeFingerprint(toolName, args),
          decision: 'deny',
          reason: 'path_invalid'
        }, callId);
      }
      const dirVerification = await verifyDirectoryDescendants(located.resolved, root, policy.excludedAnchors || [], isRecursiveTool);
      if (!dirVerification.allowed) {
        return recordAndExit(policy, {
          turnId,
          tool: toolName,
          path: rawPath,
          fingerprint: computeFingerprint(toolName, args),
          decision: 'deny',
          reason: dirVerification.reason || 'path_excluded'
        }, callId);
      }
    } else {
      let stats = null;
      try {
        stats = await fs.promises.lstat(located.resolved);
      } catch {
        stats = null;
      }
      if (stats && stats.isDirectory()) {
        return recordAndExit(policy, {
          turnId,
          tool: toolName,
          path: rawPath,
          fingerprint: computeFingerprint(toolName, args),
          decision: 'deny',
          reason: 'path_invalid'
        }, callId);
      }
    }
  }

  return recordAndExit(policy, {
    turnId,
    tool: toolName,
    path: candidatePaths[0] || null,
    fingerprint: computeFingerprint(toolName, args),
    decision: 'approve',
    reason: null
  }, callId);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'policy_error' }) + '\\n');
  process.exit(0);
});
`;

export async function writeAntigravityPreToolHook(
  childHome: string,
  options: {
    mode: RunMode;
    workerWorkspace: string;
    excludedAnchors: readonly ExclusionSpec[];
    maxTurns?: number;
    maxModelCalls?: number;
  }
): Promise<void> {
  const geminiDir = path.join(childHome, '.gemini');
  const cliDir = path.join(geminiDir, 'antigravity-cli');
  const configDir = path.join(geminiDir, 'config');
  await createPrivateDir(geminiDir);
  await createPrivateDir(cliDir);
  await createPrivateDir(configDir);

  const ledgerPath = path.join(cliDir, 'hook-ledger.jsonl');
  const policy = {
    mode: options.mode,
    workerWorkspace: options.workerWorkspace,
    excludedAnchors: options.excludedAnchors,
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
    ...(options.maxModelCalls !== undefined ? { maxModelCalls: options.maxModelCalls } : {}),
    ledgerPath
  };
  await writeFile(path.join(cliDir, 'hook-policy.json'), JSON.stringify(policy, null, 2) + '\n', { mode: 0o600 });

  const hookScriptPath = path.join(cliDir, 'pre-tool-hook.mjs');
  await writeFile(hookScriptPath, PRE_TOOL_HOOK_SCRIPT, { mode: 0o700 });

  const hooksConfig = {
    'supervisor-policy-gate': {
      enabled: true,
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `"${process.execPath}" "${hookScriptPath}"`,
              timeout: 5
            }
          ]
        }
      ]
    }
  };
  const hooksJsonContent = JSON.stringify(hooksConfig, null, 2) + '\n';
  await writeFile(path.join(configDir, 'hooks.json'), hooksJsonContent, { mode: 0o600 });
}

export async function readAntigravityHookLedger(
  childHome: string,
  envelopeDeniedActions: ReadonlyArray<{ tool: string; reason: string; path?: string }>,
  streamExecutedCount: number,
  executedCalls: ReadonlyArray<StreamExecutedCall> = []
): Promise<{
  approvals: ApprovalLedgerSnapshot;
  toolCalls: ToolCallCounts;
  hookEntries: ApprovalLedgerEntry[];
}> {
  const ledgerPath = path.join(childHome, '.gemini', 'antigravity-cli', 'hook-ledger.jsonl');
  const hookEntries: ApprovalLedgerEntry[] = [];
  try {
    const content = await readFile(ledgerPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as ApprovalLedgerEntry;
        hookEntries.push(parsed);
      } catch (err) {
        throw supervisorError('VSUP_INTERNAL', `Corrupted approval ledger entry in hook ledger: ${String(err)}`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error && typeof error === 'object' && 'code' in error && 'remediation' in error) throw error;
      throw supervisorError('VSUP_INTERNAL', `Failed to read hook audit ledger: ${String(error)}`);
    }
  }

  const approvedHookEntries = hookEntries.filter((e) => e.decision === 'approve');
  if (streamExecutedCount > 0 && approvedHookEntries.length === 0) {
    throw supervisorError(
      'VSUP_INTERNAL',
      `Audit unavailable: stream recorded ${streamExecutedCount} executed tool calls, but hook ledger recorded ${approvedHookEntries.length} approved entries.`
    );
  }

  if (streamExecutedCount > approvedHookEntries.length) {
    throw supervisorError(
      'VSUP_INTERNAL',
      `Audit mismatch: stream recorded ${streamExecutedCount} executed tool calls, exceeding the ${approvedHookEntries.length} hook approvals recorded.`
    );
  }

  if (streamExecutedCount > executedCalls.length) {
    throw supervisorError(
      'VSUP_INTERNAL',
      `Audit mismatch: stream reported ${streamExecutedCount} executed tool calls, but only ${executedCalls.length} call records with identifiers were received.`
    );
  }

  if (executedCalls.length > approvedHookEntries.length) {
    throw supervisorError(
      'VSUP_INTERNAL',
      `Audit mismatch: received ${executedCalls.length} executed tool calls, exceeding ${approvedHookEntries.length} approved entries.`
    );
  }

  const unusedApprovalIndices = new Set<number>(approvedHookEntries.map((_, i) => i));

  for (const call of executedCalls) {
    let matchedIdx: number | null = null;

    if (call.callId) {
      for (const idx of unusedApprovalIndices) {
        const approval = approvedHookEntries[idx]!;
        if (approval.relatedEntryId === call.callId) {
          if (approval.tool !== call.tool) {
            throw supervisorError(
              'VSUP_INTERNAL',
              `Audit mismatch: call ID '${call.callId}' tool '${call.tool}' does not match approved tool '${approval.tool}'.`
            );
          }
          if (call.fingerprint && approval.fingerprint && approval.fingerprint !== call.fingerprint) {
            throw supervisorError(
              'VSUP_INTERNAL',
              `Audit mismatch: call ID '${call.callId}' arguments fingerprint does not match approved fingerprint.`
            );
          }
          if (call.path && approval.path && approval.path !== call.path) {
            throw supervisorError(
              'VSUP_INTERNAL',
              `Audit mismatch: call ID '${call.callId}' path '${call.path}' does not match approved path '${approval.path}'.`
            );
          }
          matchedIdx = idx;
          break;
        }
      }

      if (matchedIdx === null) {
        throw supervisorError(
          'VSUP_INTERNAL',
          `Audit mismatch: executed tool call '${call.tool}' has call ID '${call.callId}', but no unused approval in hook ledger matches this call ID.`
        );
      }
    } else {
      if (!call.fingerprint) {
        throw supervisorError(
          'VSUP_INTERNAL',
          `Audit mismatch: executed tool call '${call.tool}' lacks both call ID and canonical arguments fingerprint.`
        );
      }

      for (const idx of unusedApprovalIndices) {
        const approval = approvedHookEntries[idx]!;
        if (approval.relatedEntryId && executedCalls.some((c) => c.callId === approval.relatedEntryId)) {
          continue;
        }
        if (approval.tool === call.tool && approval.fingerprint === call.fingerprint) {
          if (call.path && approval.path && approval.path !== call.path) {
            continue;
          }
          matchedIdx = idx;
          break;
        }
      }

      if (matchedIdx === null) {
        throw supervisorError(
          'VSUP_INTERNAL',
          `Audit mismatch: executed tool call '${call.tool}' (fingerprint: ${call.fingerprint}, path: ${call.path ?? 'none'}) has no matching unused approval in hook ledger.`
        );
      }
    }

    unusedApprovalIndices.delete(matchedIdx);
  }

  const executedCount = executedCalls.length > 0 ? (approvedHookEntries.length - unusedApprovalIndices.size) : (streamExecutedCount > 0 ? streamExecutedCount : 0);

  const envelopeEntries: ApprovalLedgerEntry[] = envelopeDeniedActions.map((item) => ({
    callbackId: `agy-policy-${randomUUID()}`,
    relatedEntryId: null,
    turnId: null,
    tool: item.tool ?? null,
    path: item.path ? item.path.slice(0, 512) : null,
    fingerprint: null,
    decision: 'deny',
    reason: item.reason ?? 'denied_by_headless_policy'
  }));

  const allRecords = [...hookEntries, ...envelopeEntries];
  const truncated = allRecords.length > MAX_APPROVAL_LEDGER_RECORDS;
  const records = allRecords.slice(0, MAX_APPROVAL_LEDGER_RECORDS);
  const approvals: ApprovalLedgerSnapshot = { records, truncated };

  const deniedHookEntries = hookEntries.filter((e) => e.decision === 'deny');

  const toolCalls: ToolCallCounts = {
    executed: executedCount,
    deniedByHandler: deniedHookEntries.length,
    deniedByPolicy: envelopeDeniedActions.length
  };

  return { approvals, toolCalls, hookEntries };
}
