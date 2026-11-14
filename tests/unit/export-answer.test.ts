import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '../../src/contracts.js';
import { runToWire } from '../../src/core/serialization.js';
import { exportReport } from '../../src/reporting/export.js';

const RUN_ID = '3c9e6a51-2f4d-4b8e-9a17-5d6c7b8a9f01';
const HASH = 'ab'.repeat(32);
const roots: string[] = [];

async function savedRun(options: { summary?: string; contextReads?: unknown; answerPresent?: boolean }): Promise<{ root: string; directory: string }> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'answer-bundle-')));
  roots.push(root);
  const directory = path.join(root, 'run');
  await mkdir(path.join(directory, 'artifacts'), { recursive: true, mode: 0o700 });
  const record: RunRecord = {
    schemaVersion: 1, runId: RUN_ID, backend: 'app-server', mode: 'review', state: 'closed', executionState: 'completed',
    sourceWorkspace: '/work/project', workerWorkspace: '/work/project', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:09.000Z', taskSha256: HASH,
    limits: { timeoutSeconds: 180, maxTurns: 12, maxEventBytes: 52428800, maxTranscriptBytes: 10485760, maxArtifactBytes: 104857600 },
    usage: { promptTokens: 10, completionTokens: 5, modelCalls: 2, toolCalls: { executed: 3, deniedByHandler: 0, deniedByPolicy: 1 } },
    result: { stopReason: 'end_turn', artifacts: [], ...(options.summary === undefined ? {} : { summary: options.summary }) }
  };
  const wire = runToWire(record) as Record<string, unknown>;
  if (options.contextReads !== undefined) wire.result = { ...(wire.result as object), context_reads: options.contextReads };
  if (options.answerPresent !== undefined) wire.result = { ...(wire.result as object), answer_present: options.answerPresent };
  await writeFile(path.join(directory, 'meta.json'), JSON.stringify(wire), { mode: 0o600 });
  return { root, directory };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('runs export --include answer', () => {
  it('does not write the answer unless asked', async () => {
    const { root, directory } = await savedRun({ summary: 'Input 1: ok' });
    const result = await exportReport({ directory, output: path.join(root, 'bundle') });
    expect(result.files).not.toContain('answer.txt');
    expect(await readdir(path.join(root, 'bundle'))).not.toContain('answer.txt');
  });

  it('writes the final answer, sanitized and listed in the checksums', async () => {
    const { root, directory } = await savedRun({ answerPresent: true, summary: 'Finding: src/cart.mjs\nopened /Users/person/private/orders/src/cart.mjs' });
    const output = path.join(root, 'bundle');
    const result = await exportReport({ directory, output, include: ['answer'] });
    expect(result.files).toContain('answer.txt');
    const answer = await readFile(path.join(output, 'answer.txt'), 'utf8');
    expect(answer).toContain('Finding: src/cart.mjs');
    expect(answer).not.toContain('/Users/person');
    expect(await readFile(path.join(output, 'SHA256SUMS'), 'utf8')).toContain('  answer.txt');
  });

  it('refuses an answer that carries a credential and leaves no bundle', async () => {
    const { root, directory } = await savedRun({ answerPresent: true, summary: 'api_key = "sk' + '-abcdefghijklmnopqrstuvwx"' });
    const output = path.join(root, 'bundle');
    await expect(exportReport({ directory, output, include: ['answer'] })).rejects.toThrow('Answer inclusion refused');
    expect(await readdir(root)).not.toContain('bundle');
  });

  it('refuses a supervisor-written summary and a record that does not say', async () => {
    const written = await savedRun({ answerPresent: false, summary: 'The run ended before a final answer.' });
    await expect(exportReport({ directory: written.directory, output: path.join(written.root, 'bundle'), include: ['answer'] })).rejects.toThrow('The run has no worker answer');
    const older = await savedRun({ summary: 'Input 1: ok' });
    await expect(exportReport({ directory: older.directory, output: path.join(older.root, 'bundle'), include: ['answer'] })).rejects.toThrow('The run has no worker answer');
  });

  it('carries context_reads and tool-call counts into the report when the run has them', async () => {
    const reads = { named: 1, read: ['README.md'], unread: [], extra: ['src/money.mjs'] };
    const { root, directory } = await savedRun({ summary: 'x', contextReads: reads });
    const output = path.join(root, 'bundle');
    await exportReport({ directory, output });
    const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8')) as Record<string, unknown>;
    expect(report.context_reads).toEqual(reads);
    expect((report.usage as Record<string, unknown>).toolCalls).toEqual({ executed: 3, deniedByHandler: 0, deniedByPolicy: 1 });
    expect(report.backend).toBe('app-server');
  });

  it('omits context_reads when the run has none', async () => {
    const { root, directory } = await savedRun({ summary: 'x' });
    const output = path.join(root, 'bundle');
    await exportReport({ directory, output });
    expect(JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'))).not.toHaveProperty('context_reads');
  });
});
