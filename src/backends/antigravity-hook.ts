import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ApprovalLedgerEntry,
  ApprovalLedgerSnapshot,
  RunMode,
  ToolCallCounts
} from '../contracts.js';
import { MAX_APPROVAL_LEDGER_RECORDS } from '../contracts.js';
import { createPrivateDir } from '../security/paths.js';
import {
  canonicalJson,
  judgeWorkspacePath,
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

const PATH_KEYS = [
  'AbsolutePath',
  'TargetFile',
  'DirectoryPath',
  'SearchPath',
  'SearchDirectory',
  'path',
  'file_path',
  'target_file',
  'directory'
] as const;

export interface EvaluateAntigravityToolCallResult {
  decision: 'allow' | 'deny';
  reason: string | null;
  entry: ApprovalLedgerEntry;
  hookResponse: { decision: 'allow' } | { decision: 'deny'; reason: string };
}

export async function evaluateAntigravityToolCall(
  options: {
    mode: RunMode;
    workerWorkspace: string;
    excludedAnchors?: readonly ExclusionSpec[];
  },
  payload: unknown
): Promise<EvaluateAntigravityToolCallResult> {
  let raw: unknown = payload;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
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
      return {
        decision: 'deny',
        reason: 'policy_error',
        entry,
        hookResponse: { decision: 'deny', reason: 'policy_error' }
      };
    }
  }

  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const toolCall = (obj.toolCall && typeof obj.toolCall === 'object' && !Array.isArray(obj.toolCall))
    ? (obj.toolCall as Record<string, unknown>)
    : undefined;
  const toolNameRaw = toolCall?.name ?? obj.tool_name ?? obj.name ?? obj.tool;
  const toolName = typeof toolNameRaw === 'string' ? toolNameRaw : '';
  const rawArgs = toolCall?.args ?? obj.tool_input ?? obj.args ?? obj.input;
  const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs))
    ? (rawArgs as Record<string, unknown>)
    : {};
  const stepIdx = obj.stepIdx ?? obj.step_index ?? obj.turnId ?? obj.turn_id;
  const turnId = stepIdx !== undefined && stepIdx !== null ? String(stepIdx) : null;

  const allowedTools = options.mode === 'edit' ? EDIT_ALLOWED_TOOLS : REVIEW_ALLOWED_TOOLS;
  if (!(allowedTools as readonly string[]).includes(toolName)) {
    const fingerprint = createHash('sha256').update(canonicalJson({ tool: toolName, args })).digest('hex');
    const entry: ApprovalLedgerEntry = {
      callbackId: `agy-hook-${randomUUID()}`,
      relatedEntryId: null,
      turnId,
      tool: toolName || null,
      path: null,
      fingerprint,
      decision: 'deny',
      reason: 'tool_not_in_profile'
    };
    return {
      decision: 'deny',
      reason: 'tool_not_in_profile',
      entry,
      hookResponse: { decision: 'deny', reason: 'tool_not_in_profile' }
    };
  }

  const candidatePaths: string[] = [];
  for (const key of PATH_KEYS) {
    const val = args[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      candidatePaths.push(val.trim());
    }
  }

  const isDirectoryReadTool = ['list_dir', 'find_by_name', 'grep_search'].includes(toolName);
  if (candidatePaths.length === 0) {
    if (isDirectoryReadTool) {
      candidatePaths.push(options.workerWorkspace);
    } else {
      const fingerprint = createHash('sha256').update(canonicalJson({ tool: toolName, args })).digest('hex');
      const entry: ApprovalLedgerEntry = {
        callbackId: `agy-hook-${randomUUID()}`,
        relatedEntryId: null,
        turnId,
        tool: toolName,
        path: null,
        fingerprint,
        decision: 'deny',
        reason: 'missing_file_path'
      };
      return {
        decision: 'deny',
        reason: 'missing_file_path',
        entry,
        hookResponse: { decision: 'deny', reason: 'missing_file_path' }
      };
    }
  }

  let realWorkspace: string;
  try {
    realWorkspace = await realpath(options.workerWorkspace);
  } catch {
    const fingerprint = createHash('sha256').update(canonicalJson({ tool: toolName, args })).digest('hex');
    const entry: ApprovalLedgerEntry = {
      callbackId: `agy-hook-${randomUUID()}`,
      relatedEntryId: null,
      turnId,
      tool: toolName,
      path: candidatePaths[0] ?? null,
      fingerprint,
      decision: 'deny',
      reason: 'path_unresolvable'
    };
    return {
      decision: 'deny',
      reason: 'path_unresolvable',
      entry,
      hookResponse: { decision: 'deny', reason: 'path_unresolvable' }
    };
  }

  for (const candidatePath of candidatePaths) {
    const rawSegments = candidatePath.split(/[\\/]+/).filter(Boolean);
    if (rawSegments.some((s) => s.toLowerCase() === '.gemini')) {
      const fingerprint = createHash('sha256').update(canonicalJson({ tool: toolName, args })).digest('hex');
      const entry: ApprovalLedgerEntry = {
        callbackId: `agy-hook-${randomUUID()}`,
        relatedEntryId: null,
        turnId,
        tool: toolName,
        path: candidatePath.slice(0, 512),
        fingerprint,
        decision: 'deny',
        reason: 'path_reserved'
      };
      return {
        decision: 'deny',
        reason: 'path_reserved',
        entry,
        hookResponse: { decision: 'deny', reason: 'path_reserved' }
      };
    }

    const absolute = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(options.workerWorkspace, candidatePath);
    let resolved: string | null = null;
    try {
      resolved = await realpath(absolute);
    } catch {
      // Handled by judgeWorkspacePath
    }

    if (resolved !== null && resolved === realWorkspace && isDirectoryReadTool) {
      continue;
    }

    const judgement = await judgeWorkspacePath(options.workerWorkspace, candidatePath, options.excludedAnchors ?? []);
    if (!judgement.allowed) {
      const fingerprint = createHash('sha256').update(canonicalJson({ tool: toolName, args })).digest('hex');
      const entry: ApprovalLedgerEntry = {
        callbackId: `agy-hook-${randomUUID()}`,
        relatedEntryId: null,
        turnId,
        tool: toolName,
        path: candidatePath.slice(0, 512),
        fingerprint,
        decision: 'deny',
        reason: judgement.reason
      };
      return {
        decision: 'deny',
        reason: judgement.reason,
        entry,
        hookResponse: { decision: 'deny', reason: judgement.reason }
      };
    }

    const relSegments = judgement.relative.split(path.sep).filter(Boolean);
    if (relSegments.some((s) => s.toLowerCase() === '.gemini')) {
      const fingerprint = createHash('sha256').update(canonicalJson({ tool: toolName, args })).digest('hex');
      const entry: ApprovalLedgerEntry = {
        callbackId: `agy-hook-${randomUUID()}`,
        relatedEntryId: null,
        turnId,
        tool: toolName,
        path: candidatePath.slice(0, 512),
        fingerprint,
        decision: 'deny',
        reason: 'path_reserved'
      };
      return {
        decision: 'deny',
        reason: 'path_reserved',
        entry,
        hookResponse: { decision: 'deny', reason: 'path_reserved' }
      };
    }
  }

  const fingerprint = createHash('sha256').update(canonicalJson({ tool: toolName, args })).digest('hex');
  const recordedPath = candidatePaths[0] ? candidatePaths[0].slice(0, 512) : null;
  const entry: ApprovalLedgerEntry = {
    callbackId: `agy-hook-${randomUUID()}`,
    relatedEntryId: null,
    turnId,
    tool: toolName,
    path: recordedPath,
    fingerprint,
    decision: 'approve',
    reason: null
  };
  return {
    decision: 'allow',
    reason: null,
    entry,
    hookResponse: { decision: 'allow' }
  };
}

const PRE_TOOL_HOOK_SCRIPT = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.join(__dirname, 'hook-policy.json');

const REVIEW_ALLOWED_TOOLS = ['view_file', 'read_file', 'list_dir', 'find_by_name', 'grep_search'];
const EDIT_ALLOWED_TOOLS = [
  ...REVIEW_ALLOWED_TOOLS,
  'write_to_file', 'write_file', 'replace_file_content', 'multi_replace_file_content', 'edit_file', 'edit'
];

const RESERVED_DIRECTORIES = ['.git', '.vibe', '.agents', '.gemini'];
const RESERVED_FILES = ['.vibeignore'];
const SENSITIVE_FILE_PATTERNS = ['.env', '.env.*', '.envrc', '.envrc.*', '*.pem', '*.key', '*.p12', '*.pfx'];

const PATH_KEYS = [
  'AbsolutePath', 'TargetFile', 'DirectoryPath', 'SearchPath', 'SearchDirectory',
  'path', 'file_path', 'target_file', 'directory'
];

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

function recordAndExit(policy, entryData) {
  const entry = {
    callbackId: 'agy-hook-' + crypto.randomUUID(),
    relatedEntryId: null,
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
    // Ignore ledger write failure
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
  for await (const chunk of process.stdin) {
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
  const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) ? rawArgs : {};
  const stepIdx = obj.stepIdx ?? obj.step_index ?? obj.turnId ?? obj.turn_id;
  const turnId = stepIdx !== undefined && stepIdx !== null ? String(stepIdx) : null;

  const allowedTools = policy.mode === 'edit' ? EDIT_ALLOWED_TOOLS : REVIEW_ALLOWED_TOOLS;
  if (!allowedTools.includes(toolName)) {
    return recordAndExit(policy, {
      turnId,
      tool: toolName || null,
      path: null,
      fingerprint: computeFingerprint(toolName, args),
      decision: 'deny',
      reason: 'tool_not_in_profile'
    });
  }

  const candidatePaths = [];
  for (const key of PATH_KEYS) {
    const val = args[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      candidatePaths.push(val.trim());
    }
  }

  const isDirectoryReadTool = ['list_dir', 'find_by_name', 'grep_search'].includes(toolName);
  if (candidatePaths.length === 0) {
    if (isDirectoryReadTool) {
      candidatePaths.push(policy.workerWorkspace);
    } else {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: null,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: 'missing_file_path'
      });
    }
  }

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
    });
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
      });
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
      });
    }

    const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(policy.workerWorkspace, rawPath);
    let resolved = null;
    try {
      resolved = await fs.promises.realpath(absolute);
    } catch {
      // Handled by locate
    }

    if (resolved !== null && resolved === root && isDirectoryReadTool) {
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
      });
    }

    if (!isPathWithinRoot(root, located.resolved)) {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: 'path_outside_workspace'
      });
    }

    if (located.resolved === root && isDirectoryReadTool) {
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
      });
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
      });
    }

    if (isExcluded(relative.split(path.sep)) || (lexicalSegments.length > 0 && isExcluded(lexicalSegments))) {
      return recordAndExit(policy, {
        turnId,
        tool: toolName,
        path: rawPath,
        fingerprint: computeFingerprint(toolName, args),
        decision: 'deny',
        reason: 'path_excluded'
      });
    }
  }

  return recordAndExit(policy, {
    turnId,
    tool: toolName,
    path: candidatePaths[0] || null,
    fingerprint: computeFingerprint(toolName, args),
    decision: 'approve',
    reason: null
  });
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
  await writeFile(path.join(cliDir, 'hooks.json'), hooksJsonContent, { mode: 0o600 });
}

export async function readAntigravityHookLedger(
  childHome: string,
  envelopeDeniedActions: ReadonlyArray<{ tool: string; reason: string; path?: string }>,
  streamExecutedCount: number
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
      } catch {
        // Skip unparseable line
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Ignore reading failure for ledger
    }
  }

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

  const approvedHookEntries = hookEntries.filter((e) => e.decision === 'approve');
  const deniedHookEntries = hookEntries.filter((e) => e.decision === 'deny');

  const toolCalls: ToolCallCounts = {
    executed: Math.max(approvedHookEntries.length, streamExecutedCount),
    deniedByHandler: deniedHookEntries.length,
    deniedByPolicy: envelopeDeniedActions.length
  };

  return { approvals, toolCalls, hookEntries };
}
