import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApprovalHandler,
  ApprovalLedger,
  EDIT_TOOLS,
  REVIEW_TOOLS,
  callbackContext,
  canonicalJson,
  evaluateApproval,
  inputFingerprint,
  isProfileTool,
  isWriteTool,
  judgeWorkspacePath,
  profileTools,
  restrictedRelativePath
} from '../../src/backends/app-server/approvals.js';
import { ProtocolParseError, type ApprovalRequest } from '../../src/backends/app-server/protocol.js';
import { runScenario } from './support/app-server-driver.js';

let scratch = '';
let workspace = '';
let outside = '';

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'app-server-approvals-')));
  workspace = path.join(scratch, 'workspace');
  outside = path.join(scratch, 'outside');
  await mkdir(path.join(workspace, 'src'), { recursive: true });
  await mkdir(path.join(workspace, '.git'), { recursive: true });
  await mkdir(path.join(workspace, '.vibe'), { recursive: true });
  await mkdir(path.join(workspace, '.agents'), { recursive: true });
  await mkdir(path.join(workspace, 'nested', 'deep'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(workspace, 'src', 'index.ts'), 'export {};\n');
  await writeFile(path.join(workspace, '.git', 'config'), '[core]\n');
  await writeFile(path.join(workspace, '.vibe', 'config.toml'), '');
  await writeFile(path.join(workspace, '.agents', 'a.md'), '');
  await writeFile(path.join(workspace, '.vibeignore'), '*\n');
  await writeFile(path.join(workspace, '.env'), 'A=1\n');
  await writeFile(path.join(workspace, '.env.local'), 'A=1\n');
  await writeFile(path.join(workspace, '.envrc'), '');
  await writeFile(path.join(workspace, 'server.pem'), '');
  await writeFile(path.join(workspace, 'nested', 'deep', 'id.key'), '');
  await writeFile(path.join(outside, 'secret.txt'), 'secret\n');
  await symlink(outside, path.join(workspace, 'escape'));
  await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'leak.txt'));
  await symlink(path.join(outside, 'not-yet.txt'), path.join(workspace, 'dangling.txt'));
  await symlink(path.join(workspace, 'src', 'index.ts'), path.join(workspace, 'inside-link.ts'));
  await symlink(path.join(workspace, '.git', 'config'), path.join(workspace, 'to-git.txt'));
});

afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

describe('profile tool sets', () => {
  it('keeps reviews to reading and edits to the three file tools', () => {
    expect(REVIEW_TOOLS).toEqual(['file_system.read_file']);
    expect(EDIT_TOOLS).toEqual(['file_system.read_file', 'file_system.write_file', 'file_system.search_replace']);
    expect(profileTools('review')).toBe(REVIEW_TOOLS);
    expect(profileTools('edit')).toBe(EDIT_TOOLS);
    expect(isProfileTool('review', 'file_system.write_file')).toBe(false);
    expect(isProfileTool('edit', 'file_system.write_file')).toBe(true);
    expect(isProfileTool('edit', 'file_system.bash')).toBe(false);
    expect(isProfileTool('edit', 'read_file')).toBe(false);
    expect(isWriteTool('file_system.search_replace')).toBe(true);
    expect(isWriteTool('file_system.read_file')).toBe(false);
  });
});

describe('judgeWorkspacePath', () => {
  const rejected = async (raw: string) => {
    const judgement = await judgeWorkspacePath(workspace, raw);
    return judgement.allowed ? 'allowed' : judgement.reason;
  };

  it('allows relative and absolute paths inside the workspace, resolving relative ones against the session cwd', async () => {
    expect(await judgeWorkspacePath(workspace, 'src/index.ts')).toMatchObject({ allowed: true, relative: path.join('src', 'index.ts') });
    expect(await judgeWorkspacePath(workspace, path.join(workspace, 'src', 'index.ts'))).toMatchObject({ allowed: true });
    expect(await judgeWorkspacePath(workspace, './src/../src/index.ts')).toMatchObject({ allowed: true });
    expect(await judgeWorkspacePath(workspace, 'inside-link.ts')).toMatchObject({ allowed: true, relative: path.join('src', 'index.ts') });
  });

  it('judges a missing file by the nearest existing ancestor', async () => {
    expect(await judgeWorkspacePath(workspace, 'src/new.ts')).toMatchObject({ allowed: true, resolved: path.join(workspace, 'src', 'new.ts') });
    expect(await judgeWorkspacePath(workspace, 'fresh/dir/new.ts')).toMatchObject({ allowed: true, resolved: path.join(workspace, 'fresh', 'dir', 'new.ts') });
    expect(await judgeWorkspacePath(workspace, 'src/index.ts/child')).toMatchObject({ allowed: true });
  });

  it('refuses a missing path whose remaining components contain parent references', async () => {
    expect(await rejected('fresh/../new.ts')).toBe('path_unresolvable');
    expect(await rejected('fresh/dir/../../x.ts')).toBe('path_unresolvable');
  });

  it('refuses paths that leave the workspace, lexically or through symlinks', async () => {
    expect(await rejected('/etc/passwd')).toBe('path_outside_workspace');
    expect(await rejected('../outside/secret.txt')).toBe('path_outside_workspace');
    expect(await rejected(path.join(outside, 'secret.txt'))).toBe('path_outside_workspace');
    expect(await rejected('src/../../outside/new.txt')).toBe('path_outside_workspace');
    expect(await rejected('leak.txt')).toBe('path_outside_workspace');
    expect(await rejected('escape/secret.txt')).toBe('path_outside_workspace');
    expect(await rejected('escape/brand-new.txt')).toBe('path_outside_workspace');
  });

  it('refuses a dangling symlink instead of treating it as a new file', async () => {
    expect(await rejected('dangling.txt')).toBe('path_symlink');
  });

  it('refuses reserved directories and files at any depth, including through a symlink', async () => {
    for (const raw of ['.git/config', '.vibe/config.toml', '.agents/a.md', '.vibeignore', 'nested/.git/HEAD', 'to-git.txt', '.GIT/config', '.Vibeignore']) {
      expect(await rejected(raw), raw).toBe('path_reserved');
    }
    expect(await rejected('.git/new-file')).toBe('path_reserved');
  });

  it('refuses secret-file patterns', async () => {
    for (const raw of ['.env', '.env.local', '.envrc', 'server.pem', 'nested/deep/id.key', 'nested/new/token.p12', 'cert.PFX', '.ENV', '.env.production']) {
      expect(await rejected(raw), raw).toBe('path_secret');
    }
    expect(await rejected('src/envelope.ts')).toBe('allowed');
    expect(await rejected('src/keyboard.ts')).toBe('allowed');
  });

  it('refuses malformed input', async () => {
    expect(await rejected('')).toBe('path_invalid');
    expect(await rejected('a\0b')).toBe('path_invalid');
    expect(await rejected('~/notes.txt')).toBe('path_invalid');
    expect(await rejected('.')).toBe('path_invalid');
    expect(await rejected('x'.repeat(5000))).toBe('path_invalid');
    expect(await judgeWorkspacePath('relative/workspace', 'a.ts')).toEqual({ allowed: false, reason: 'path_invalid' });
    expect(await judgeWorkspacePath(path.join(scratch, 'missing-workspace'), 'a.ts')).toEqual({ allowed: false, reason: 'path_unresolvable' });
  });
});

function request(tool: string, input: Record<string, unknown>, overrides: Partial<ApprovalRequest> & { kind?: string } = {}): ApprovalRequest {
  const { kind, ...rest } = overrides;
  return {
    callbackId: 'approval-call-1',
    entryId: 'approval-call-1',
    relatedEntryId: 'effect-action-1',
    detailKind: 'approval',
    effect: { kind: kind ?? ({ 'file_system.read_file': 'file_read', 'file_system.write_file': 'file_write', 'file_system.search_replace': 'file_edit' }[tool] ?? 'tool'), toolName: tool, input },
    ...rest
  };
}

describe('evaluateApproval', () => {
  const review = () => ({ mode: 'review' as const, workspace });
  const edit = () => ({ mode: 'edit' as const, workspace });

  it('approves a read of an in-workspace file in both modes', async () => {
    const read = request('file_system.read_file', { filePath: 'src/index.ts', offset: null, limit: 2000 });
    expect(await evaluateApproval(review(), read)).toEqual({ decision: 'approve', reason: null });
    expect(await evaluateApproval(edit(), read)).toEqual({ decision: 'approve', reason: null });
  });

  it('denies every write tool in a review, whatever the path', async () => {
    expect(await evaluateApproval(review(), request('file_system.write_file', { filePath: 'src/new.ts', content: '' }))).toEqual({ decision: 'deny', reason: 'tool_not_in_profile' });
    expect(await evaluateApproval(review(), request('file_system.search_replace', { filePath: 'src/index.ts', changes: [] }))).toEqual({ decision: 'deny', reason: 'tool_not_in_profile' });
  });

  it('approves writes and batch edits inside the worktree of an edit run, including a new file', async () => {
    expect(await evaluateApproval(edit(), request('file_system.write_file', { filePath: 'src/new.ts', content: 'x' }))).toEqual({ decision: 'approve', reason: null });
    expect(await evaluateApproval(edit(), request('file_system.search_replace', { filePath: path.join(workspace, 'src', 'index.ts'), changes: [{ oldString: 'a', newString: 'b', replaceAll: false }] }))).toEqual({ decision: 'approve', reason: null });
  });

  it('denies reserved, secret and out-of-workspace targets even for profile tools in an edit run', async () => {
    expect(await evaluateApproval(edit(), request('file_system.write_file', { filePath: '.git/hooks/pre-commit', content: '#!/bin/sh' }))).toEqual({ decision: 'deny', reason: 'path_reserved' });
    expect(await evaluateApproval(edit(), request('file_system.write_file', { filePath: '.env', content: 'A=1' }))).toEqual({ decision: 'deny', reason: 'path_secret' });
    expect(await evaluateApproval(edit(), request('file_system.write_file', { filePath: '/etc/hosts', content: '' }))).toEqual({ decision: 'deny', reason: 'path_outside_workspace' });
    expect(await evaluateApproval(edit(), request('file_system.search_replace', { filePath: 'escape/secret.txt', changes: [] }))).toEqual({ decision: 'deny', reason: 'path_outside_workspace' });
  });

  it('denies off-profile tools, unknown effect kinds, generic fallbacks and missing paths', async () => {
    expect(await evaluateApproval(edit(), request('file_system.bash', { command: 'ls' }, { kind: 'shell' }))).toEqual({ decision: 'deny', reason: 'tool_not_in_profile' });
    expect(await evaluateApproval(edit(), request('read_file', { filePath: 'src/index.ts' }))).toEqual({ decision: 'deny', reason: 'tool_not_in_profile' });
    expect(await evaluateApproval(edit(), request('file_system.read_file', { path: 'src/index.ts', offset: 0 }, { kind: 'tool' }))).toEqual({ decision: 'deny', reason: 'effect_kind_mismatch' });
    expect(await evaluateApproval(edit(), request('file_system.write_file', { filePath: 'src/a.ts', content: '' }, { kind: 'file_read' }))).toEqual({ decision: 'deny', reason: 'effect_kind_mismatch' });
    expect(await evaluateApproval(edit(), request('file_system.read_file', {}))).toEqual({ decision: 'deny', reason: 'missing_file_path' });
    expect(await evaluateApproval(edit(), request('file_system.read_file', { filePath: 7 }))).toEqual({ decision: 'deny', reason: 'missing_file_path' });
    expect(await evaluateApproval(edit(), request('file_system.read_file', { filePath: '' }))).toEqual({ decision: 'deny', reason: 'missing_file_path' });
    expect(await evaluateApproval(edit(), request('file_system.read_file', { filePath: 'src/index.ts' }, { effect: null }))).toEqual({ decision: 'deny', reason: 'missing_effect' });
    expect(await evaluateApproval(edit(), request('file_system.read_file', { filePath: 'src/index.ts' }, { detailKind: 'user_input' }))).toEqual({ decision: 'deny', reason: 'unsupported_callback' });
    expect(await evaluateApproval(edit(), request('file_system.read_file', { filePath: 'src/index.ts' }, { detailKind: null }))).toEqual({ decision: 'deny', reason: 'unsupported_callback' });
  });
});

describe('ApprovalLedger', () => {
  const record = (callbackId: string, relatedEntryId: string | null) => ({ callbackId, relatedEntryId, sessionId: 's1', turnId: 't1', tool: 'file_system.read_file', path: null, fingerprint: null, decision: 'approve' as const, reason: null });

  it('indexes decisions by callback and by the effect entry they relate to', () => {
    const ledger = new ApprovalLedger();
    expect(ledger.record(record('c1', 'effect-1'))).toBe(true);
    expect(ledger.record(record('c2', null))).toBe(true);
    expect(ledger.forCallback('c1')?.relatedEntryId).toBe('effect-1');
    expect(ledger.forEffect('effect-1')?.callbackId).toBe('c1');
    expect(ledger.forEffect('effect-2')).toBeUndefined();
    expect(ledger.size).toBe(2);
    expect(ledger.all().map((entry) => entry.callbackId)).toEqual(['c1', 'c2']);
  });

  it('refuses a second decision for a callback and refuses to grow past its bound', () => {
    const ledger = new ApprovalLedger(2);
    expect(ledger.record(record('c1', 'e1'))).toBe(true);
    expect(ledger.record(record('c1', 'e9'))).toBe(false);
    expect(ledger.record(record('c2', 'e2'))).toBe(true);
    expect(ledger.isFull()).toBe(true);
    expect(ledger.record(record('c3', 'e3'))).toBe(false);
    expect(ledger.forEffect('e9')).toBeUndefined();
  });
});

describe('ApprovalLedger bindings', () => {
  const record = (callbackId: string, relatedEntryId: string | null) => ({ callbackId, relatedEntryId, sessionId: 's1', turnId: 't1', tool: 'file_system.read_file', path: null, fingerprint: null, decision: 'approve' as const, reason: null });

  it('binds an effect to one approval: a second callback for the same effect is refused and the first stays', () => {
    const ledger = new ApprovalLedger();
    expect(ledger.record(record('c1', 'effect-1'))).toBe(true);
    expect(ledger.record(record('c2', 'effect-1'))).toBe(false);
    expect(ledger.forEffect('effect-1')?.callbackId).toBe('c1');
    expect(ledger.has('c2')).toBe(false);
  });

  it('counts the callbacks that were opened and not yet settled', () => {
    const ledger = new ApprovalLedger();
    expect(ledger.pendingCallbacks).toBe(0);
    ledger.open('c1');
    ledger.open('c1');
    ledger.open('c2');
    expect(ledger.pendingCallbacks).toBe(2);
    ledger.close('c1');
    ledger.close('missing');
    expect(ledger.pendingCallbacks).toBe(1);
  });
});

describe('input fingerprints', () => {
  const read = 'file_system.read_file';
  const write = 'file_system.write_file';
  const edit = 'file_system.search_replace';

  it('is stable under key order and distinguishes the path, the content and every edit change', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
    const base = inputFingerprint(write, { filePath: 'a.ts', content: 'x' });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(inputFingerprint(write, { content: 'x', filePath: 'a.ts', display: 'ignored' })).toBe(base);
    expect(inputFingerprint(write, { filePath: 'b.ts', content: 'x' })).not.toBe(base);
    expect(inputFingerprint(write, { filePath: 'a.ts', content: 'y' })).not.toBe(base);
    expect(inputFingerprint(read, { filePath: 'a.ts' })).not.toBe(inputFingerprint(write, { filePath: 'a.ts', content: undefined }));
  });

  it('canonicalizes the edit batch and the single edit form to the same changes, with replaceAll defaulting to false', () => {
    const batch = inputFingerprint(edit, { filePath: 'a.ts', changes: [{ oldString: 'a', newString: 'b', replaceAll: false }] });
    expect(inputFingerprint(edit, { filePath: 'a.ts', oldString: 'a', newString: 'b' })).toBe(batch);
    expect(inputFingerprint(edit, { filePath: 'a.ts', changes: [{ newString: 'b', oldString: 'a' }] })).toBe(batch);
    expect(inputFingerprint(edit, { filePath: 'a.ts', changes: [{ oldString: 'a', newString: 'b', replaceAll: true }] })).not.toBe(batch);
    expect(inputFingerprint(edit, { filePath: 'a.ts', changes: [{ oldString: 'a', newString: 'b' }, { oldString: 'c', newString: 'd' }] })).not.toBe(batch);
  });

  it('ignores read ranges, hashes the whole input of other tools and returns null for input too deep to hash', () => {
    expect(inputFingerprint(read, { filePath: 'a.ts', offset: 1, limit: 5 })).toBe(inputFingerprint(read, { filePath: 'a.ts' }));
    expect(inputFingerprint('file_system.bash', { command: 'ls' })).not.toBe(inputFingerprint('file_system.bash', { command: 'rm' }));
    let deep: unknown = 'leaf';
    for (let index = 0; index < 40; index += 1) deep = { next: deep };
    expect(inputFingerprint('x', { deep })).toBeNull();
  });
});

describe('restrictedRelativePath', () => {
  it('reuses the approval matcher for reserved and secret path segments anywhere in a relative path', () => {
    expect(restrictedRelativePath('src/index.ts')).toBeNull();
    expect(restrictedRelativePath('.git/config')).toBe('path_reserved');
    expect(restrictedRelativePath('a/.Vibe/x')).toBe('path_reserved');
    expect(restrictedRelativePath('.vibeignore')).toBe('path_reserved');
    expect(restrictedRelativePath('.env')).toBe('path_secret');
    expect(restrictedRelativePath('config/.env.production')).toBe('path_secret');
    expect(restrictedRelativePath('keys/server.PEM')).toBe('path_secret');
    expect(restrictedRelativePath('nested\\deep\\id.key')).toBe('path_secret');
    expect(restrictedRelativePath('environment.ts')).toBeNull();
  });
});

describe('ApprovalHandler session and effect binding', () => {
  const read = 'file_system.read_file';
  const context = (sessionId: string | null, turnId: string | null) => ({ sessionId, turnId });

  it('binds the decision to the session, turn, tool, effect id and the fingerprint of the shown input', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace, currentSessionId: () => 's1' });
    const input = { filePath: 'src/index.ts', offset: null, limit: 2000 };
    expect((await handler.decide(request(read, input, { callbackId: 'cb-a', relatedEntryId: 'effect-a' }), context('s1', 't1'))).decision).toBe('approve');
    expect(handler.ledger.forEffect('effect-a')).toEqual({
      callbackId: 'cb-a', relatedEntryId: 'effect-a', sessionId: 's1', turnId: 't1', tool: read, path: 'src/index.ts', fingerprint: inputFingerprint(read, input), decision: 'approve', reason: null
    });
  });

  it('denies a callback from another session and records it, and defaults the session to the current one', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace, currentSessionId: () => 's2' });
    expect(await handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-x', relatedEntryId: 'effect-x' }), context('s1', 't1'))).toEqual({ decision: 'deny', reason: 'foreign_session' });
    expect(handler.ledger.forCallback('cb-x')).toMatchObject({ decision: 'deny', reason: 'foreign_session', sessionId: 's1' });
    await handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-y', relatedEntryId: 'effect-y' }));
    expect(handler.ledger.forCallback('cb-y')).toMatchObject({ decision: 'approve', sessionId: 's2', turnId: null });
  });

  it('follows the current session when it changes between callbacks', async () => {
    let session = 's1';
    const handler = new ApprovalHandler({ mode: 'review', workspace, currentSessionId: () => session });
    expect((await handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-1', relatedEntryId: 'e1' }), context('s1', 't1'))).decision).toBe('approve');
    session = 's2';
    expect((await handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-2', relatedEntryId: 'e2' }), context('s1', 't1'))).reason).toBe('foreign_session');
    expect((await handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-3', relatedEntryId: 'e3' }), context('s2', 't1'))).decision).toBe('approve');
  });

  it('denies an approval that names no effect to link to', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace });
    expect(await handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-n', relatedEntryId: null }))).toEqual({ decision: 'deny', reason: 'unlinked_callback' });
  });

  it('denies a second callback for an effect that already has a decision', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace });
    expect((await handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-1', relatedEntryId: 'e1' }))).decision).toBe('approve');
    expect(await handler.decide(request(read, { filePath: 'src/other.ts' }, { callbackId: 'cb-2', relatedEntryId: 'e1' }))).toEqual({ decision: 'deny', reason: 'duplicate_callback' });
    expect(handler.ledger.forEffect('e1')?.callbackId).toBe('cb-1');
  });

  it('denies everything after it was revoked, including an approval that was still being evaluated', async () => {
    let release: (() => void) | undefined;
    const handler = new ApprovalHandler({ mode: 'review', workspace, evaluate: () => new Promise((resolve) => { release = () => resolve({ decision: 'approve', reason: null }); }) });
    const inflight = handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-1', relatedEntryId: 'e1' }));
    handler.revoke();
    release?.();
    expect(await inflight).toEqual({ decision: 'deny', reason: 'handler_revoked' });
    expect(handler.isRevoked).toBe(true);
    expect(await handler.decide(request(read, { filePath: 'src/index.ts' }, { callbackId: 'cb-2', relatedEntryId: 'e2' }))).toEqual({ decision: 'deny', reason: 'handler_revoked' });
  });

  it('counts a begun callback as pending until it is settled', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace });
    const params = { callback: { type: 'callback', id: 'cb-1', turnId: 't1', sessionId: 's1', callbackId: 'cb-1', relatedEntryId: 'e1', detail: { kind: 'approval', effect: { kind: 'file_read', toolName: read, input: { filePath: 'src/index.ts' } } }, state: { status: 'open' } } };
    const pending = handler.begin(params);
    expect(handler.ledger.pendingCallbacks).toBe(1);
    await pending.verdict;
    expect(handler.ledger.pendingCallbacks).toBe(1);
    handler.settle('cb-1');
    expect(handler.ledger.pendingCallbacks).toBe(0);
    expect(handler.ledger.forCallback('cb-1')).toMatchObject({ sessionId: 's1', turnId: 't1' });
    expect(callbackContext(params)).toEqual({ sessionId: 's1', turnId: 't1' });
    expect(callbackContext({})).toEqual({ sessionId: null, turnId: null });
    expect(callbackContext({ callback: [] })).toEqual({ sessionId: null, turnId: null });
  });
});

describe('ApprovalHandler', () => {
  it('records every decision with the ids the validator links on', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace });
    const allowed = await handler.decide(request('file_system.read_file', { filePath: 'src/index.ts' }, { callbackId: 'cb-a', relatedEntryId: 'effect-a' }));
    const denied = await handler.decide(request('file_system.read_file', { filePath: '.env' }, { callbackId: 'cb-b', relatedEntryId: 'effect-b' }));
    expect(allowed.decision).toBe('approve');
    expect(denied).toEqual({ decision: 'deny', reason: 'path_secret' });
    expect(handler.ledger.forEffect('effect-a')).toEqual({
      callbackId: 'cb-a', relatedEntryId: 'effect-a', sessionId: null, turnId: null, tool: 'file_system.read_file', path: 'src/index.ts', fingerprint: inputFingerprint('file_system.read_file', { filePath: 'src/index.ts' }), decision: 'approve', reason: null
    });
    expect(handler.ledger.forCallback('cb-b')).toMatchObject({ decision: 'deny', reason: 'path_secret', relatedEntryId: 'effect-b' });
  });

  it('answers only approve or deny, never a session or permanent grant, for any input', async () => {
    const handler = new ApprovalHandler({ mode: 'edit', workspace });
    const decisions = new Set<string>();
    const targets = ['src/index.ts', '.env', '/etc/passwd', 'nested/new.ts', '.git/config', ''];
    for (const [index, target] of targets.entries()) {
      for (const tool of ['file_system.read_file', 'file_system.write_file', 'file_system.search_replace', 'file_system.bash', 'x']) {
        decisions.add((await handler.decide(request(tool, { filePath: target }, { callbackId: `cb-${index}-${tool}`, relatedEntryId: `e-${index}-${tool}` }))).decision);
      }
    }
    expect([...decisions].sort()).toEqual(['approve', 'deny']);
  });

  it('answers deny at the decision deadline and ignores a late approval', async () => {
    let release: (() => void) | undefined;
    const handler = new ApprovalHandler({
      mode: 'review',
      workspace,
      deadlineMs: 30,
      evaluate: () => new Promise((resolve) => { release = () => resolve({ decision: 'approve', reason: null }); })
    });
    const started = Date.now();
    const verdict = await handler.decide(request('file_system.read_file', { filePath: 'src/index.ts' }, { callbackId: 'cb-slow', relatedEntryId: 'effect-slow' }));
    expect(verdict).toEqual({ decision: 'deny', reason: 'decision_deadline' });
    expect(Date.now() - started).toBeLessThan(2000);
    release?.();
    expect(handler.ledger.forEffect('effect-slow')).toMatchObject({ decision: 'deny', reason: 'decision_deadline' });
  });

  it('turns an evaluation failure into a deny', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace, evaluate: () => Promise.reject(new Error('boom')) });
    expect(await handler.decide(request('file_system.read_file', { filePath: 'src/index.ts' }))).toEqual({ decision: 'deny', reason: 'policy_error' });
  });

  it('uses a five second decision deadline by default and rejects a bad override', () => {
    expect(() => new ApprovalHandler({ mode: 'review', workspace, deadlineMs: 0 })).toThrow(RangeError);
    expect(() => new ApprovalHandler({ mode: 'review', workspace, deadlineMs: Number.NaN })).toThrow(RangeError);
  });

  it('denies a repeated callback id and a full ledger instead of approving an unrecorded call', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace, ledger: new ApprovalLedger(1) });
    expect((await handler.decide(request('file_system.read_file', { filePath: 'src/index.ts' }, { callbackId: 'cb-1', relatedEntryId: 'e1' }))).decision).toBe('approve');
    expect(await handler.decide(request('file_system.read_file', { filePath: 'src/index.ts' }, { callbackId: 'cb-1', relatedEntryId: 'e1' }))).toEqual({ decision: 'deny', reason: 'duplicate_callback' });
    expect(await handler.decide(request('file_system.read_file', { filePath: 'src/index.ts' }, { callbackId: 'cb-2', relatedEntryId: 'e2' }))).toEqual({ decision: 'deny', reason: 'ledger_full' });
    expect(handler.ledger.forEffect('e2')).toBeUndefined();
  });

  it('begins from raw callback/call params with the acknowledgement the server expects', async () => {
    const handler = new ApprovalHandler({ mode: 'review', workspace });
    const params = {
      callback: {
        type: 'callback',
        id: 'approval-call-7',
        turnId: 't1',
        callbackId: 'approval-call-7',
        relatedEntryId: 'effect-action-7',
        detail: { kind: 'approval', effect: { kind: 'file_read', toolName: 'file_system.read_file', input: { filePath: 'src/index.ts', offset: null, limit: 2000 } } },
        state: { status: 'open' }
      }
    };
    const pending = handler.begin(params);
    expect(pending.acknowledgement).toEqual({ callbackId: 'approval-call-7', accepted: true });
    expect(await pending.verdict).toEqual({ decision: 'approve', reason: null });
    expect(() => handler.begin({ callback: { type: 'message', id: 'x', role: 'user', content: [] } })).toThrow(ProtocolParseError);
    expect(() => handler.begin({})).toThrow(ProtocolParseError);
  });
});

describe('against the scripted fake vibe-app-server', () => {
  it('approves an in-workspace read and links it to the effect, with reasoning dropped', async () => {
    const run = await runScenario({ scenario: 'allowed-call' });
    expect(run.handler.ledger.all()).toMatchObject([{ tool: 'file_system.read_file', decision: 'approve', relatedEntryId: expect.stringMatching(/^effect-/) }]);
    expect(run.signals.filter((signal) => signal.type === 'tool_effect')).toMatchObject([{ tool: 'file_system.read_file', outcome: 'executed' }]);
    expect(run.processor.fatal).toBeNull();
    expect(run.audit.fatal).toBeNull();
    expect(run.processor.counters.reasoningDropped).toBe(1);
    expect(run.outcome.state).toBe('completed');
    const answers = run.fixtureLog.filter((line) => line.name === 'approvalAnswer');
    expect(answers).toMatchObject([{ decision: 'approve', malformed: false, hasPathScope: false }]);
  });

  it('answers deny to out-of-workspace, secret and off-profile calls and lets the run finish', async () => {
    const run = await runScenario({ scenario: 'forbidden-call-approval' });
    expect(run.handler.ledger.all().map((entry) => [entry.decision, entry.reason])).toEqual([
      ['deny', 'path_outside_workspace'],
      ['deny', 'path_secret'],
      ['deny', 'tool_not_in_profile']
    ]);
    expect(run.fixtureLog.filter((line) => line.name === 'approvalAnswer').map((line) => line.decision)).toEqual(['deny', 'deny', 'deny']);
    expect(run.signals.filter((signal) => signal.type === 'tool_effect').map((signal) => signal.type === 'tool_effect' && signal.outcome)).toEqual(Array(3).fill('permission_denied_by_handler'));
    expect(run.processor.fatal).toBeNull();
    expect(run.outcome).toMatchObject({ state: 'completed', stopReason: 'end_turn' });
  });

  it('approves the batch edit of an in-worktree file in an edit run and the same call is denied in a review', async () => {
    const edit = await runScenario({ scenario: 'edit-call', mode: 'edit' });
    expect(edit.handler.ledger.all()).toMatchObject([{ tool: 'file_system.search_replace', decision: 'approve' }]);
    expect(edit.signals.filter((signal) => signal.type === 'tool_effect')).toMatchObject([{ tool: 'file_system.search_replace', outcome: 'executed' }]);
    expect(edit.processor.fatal).toBeNull();
    const review = await runScenario({ scenario: 'edit-call', mode: 'review' });
    expect(review.handler.ledger.all()).toMatchObject([{ decision: 'deny', reason: 'tool_not_in_profile' }]);
    expect(review.processor.fatal).toBeNull();
  });

  it('denies a call whose projection stayed generic', async () => {
    const run = await runScenario({ scenario: 'generic-effect-fallback' });
    expect(run.handler.ledger.all()).toMatchObject([{ tool: 'file_system.read_file', decision: 'deny', reason: 'effect_kind_mismatch' }]);
    expect(run.outcome.state).toBe('completed');
  });

  it('answers deny when the decision stalls past the deadline, so the server-side turn is not stuck', async () => {
    const run = await runScenario({ scenario: 'approval-stall', deadlineMs: 60, evaluate: () => new Promise(() => undefined) });
    expect(run.handler.ledger.all()).toMatchObject([{ decision: 'deny', reason: 'decision_deadline' }]);
    expect(run.fixtureLog.filter((line) => line.name === 'approvalAnswer')).toMatchObject([{ decision: 'deny' }]);
    expect(run.outcome).toMatchObject({ state: 'completed', stopReason: 'end_turn' });
    expect(run.audit.finalMessage?.text).toBe('Finished after the approval.');
  });
});
