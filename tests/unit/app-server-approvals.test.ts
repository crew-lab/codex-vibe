import { mkdtemp, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { ApprovalPolicy } from '../../src/backends/app-server/approvals.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(mode: 'review' | 'edit' = 'review') {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-approval-'))); roots.push(root);
  await writeFile(path.join(root, 'file.txt'), 'fixture');
  const policy = new ApprovalPolicy(root, mode, 'session', 'turn');
  const detail = { kind: 'file_read', toolName: 'file_system.read_file', input: { filePath: 'file.txt' } };
  const entry = { type: 'effect', id: 'effect', sessionId: 'session', turnId: 'turn', detail, state: { status: 'blocked', callbackId: 'callback' } };
  const callback = { type: 'callback', id: 'entry', callbackId: 'callback', sessionId: 'session', turnId: 'turn', state: { status: 'open' }, detail: { kind: 'approval', effect: detail, choices: ['approve', 'deny'], relatedEntryId: 'effect' } };
  return { root, policy, detail, entry, callback };
}
describe('live invocation approval correlation', () => {
  it('approves one safe invocation only after its linked effect is validated', async () => {
    const f = await fixture(); f.policy.record(f.entry);
    expect((await f.policy.decide(f.callback)).output).toEqual({ type: 'approval', decision: { type: 'approve' }, feedback: null });
    expect((await f.policy.decide(f.callback)).approved).toBe(false);
  });
  it('approves the unified running-effect shape without inventing a callbackId field', async () => {
    const f = await fixture();
    f.policy.record({ ...f.entry, state: { status: 'running' } });
    expect((await f.policy.decide(f.callback)).approved).toBe(true);
  });
  it.each([undefined, null, ''])('denies a callback without an explicit effect link (%s)', async relatedEntryId => {
    const f = await fixture(); f.policy.record({ ...f.entry, state: { status: 'running' } });
    const callback = { ...f.callback, detail: { ...f.callback.detail, relatedEntryId } };
    expect((await f.policy.decide(callback)).approved).toBe(false);
  });
  it.each(['failed', 'cancelled', 'skipped'])('denies a callback linked to a terminal %s effect', async status => {
    const f = await fixture(); f.policy.record({ ...f.entry, state: { status, decision: 'skip' } });
    expect((await f.policy.decide(f.callback)).approved).toBe(false);
  });
  it('denies an uncorrelated or ambiguous callback', async () => {
    const f = await fixture(); expect((await f.policy.decide(f.callback)).approved).toBe(false);
    const g = await fixture(); g.policy.record(g.entry); g.policy.record({ ...g.entry, id: 'another' });
    g.callback.detail.relatedEntryId = '';
    expect((await g.policy.decide(g.callback)).approved).toBe(false);
  });
  it.each(['sessionId', 'turnId'] as const)('denies a foreign %s', async key => {
    const f = await fixture(); f.policy.record(f.entry); f.callback[key] = 'foreign';
    expect((await f.policy.decide(f.callback)).approved).toBe(false);
  });
  it('refuses persistent-only choices without inventing an approval', async () => {
    const f = await fixture(); f.policy.record(f.entry); f.callback.detail.choices = ['approve_permanently'];
    expect(await f.policy.decide(f.callback)).toMatchObject({ approved: false, error: { message: 'No supported denial choice offered.' } });
  });
  it('denies secret and symlink paths', async () => {
    for (const file of ['.env', 'escape']) {
      const f = await fixture(); await writeFile(path.join(f.root, '.env'), 'secret');
      await symlink(path.join(f.root, 'file.txt'), path.join(f.root, 'escape'));
      f.detail.input.filePath = file; f.policy.record(f.entry);
      expect((await f.policy.decide(f.callback)).approved).toBe(false);
    }
  });
  it('denies review writes and detects execution despite that denial', async () => {
    const f = await fixture(); f.detail.kind = 'file_write'; f.detail.toolName = 'file_system.write_file';
    Object.assign(f.detail.input, { content: 'modified' }); f.policy.record(f.entry);
    expect((await f.policy.decide(f.callback)).approved).toBe(false);
    expect(() => f.policy.record({ ...f.entry, state: { status: 'completed', decision: 'execute' } })).toThrow();
  });
  it('allows a scoped edit write but rejects altered arguments after approval', async () => {
    const f = await fixture('edit'); f.detail.kind = 'file_write'; f.detail.toolName = 'write_file';
    Object.assign(f.detail.input, { content: 'new' }); f.policy.record(f.entry);
    expect((await f.policy.decide(f.callback)).approved).toBe(true);
    f.detail.input.filePath = 'different.txt';
    expect(() => f.policy.record(f.entry)).toThrow();
  });
  it('denies shell routes and every grant after stop', async () => {
    const f = await fixture(); f.detail.toolName = 'bash'; f.policy.record(f.entry);
    expect((await f.policy.decide(f.callback)).approved).toBe(false);
    const g = await fixture(); g.policy.record(g.entry); g.policy.stop();
    expect((await g.policy.decide(g.callback)).approved).toBe(false);
  });
  it('uses the actual MCP route and validates its arguments', async () => {
    const f = await fixture();
    const detail = { kind: 'tool', toolName: 'mcp_supervisor_search.grep', input: { pattern: 'fixture', path: '.' } };
    f.policy.record({ ...f.entry, detail });
    expect((await f.policy.decide({ ...f.callback, detail: { ...f.callback.detail, effect: detail } })).approved).toBe(true);
  });
});
