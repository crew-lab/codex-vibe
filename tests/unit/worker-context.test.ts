import { describe, expect, it } from 'vitest';
import { workerRules, type WorkerKind } from '../../src/core/worker-context.js';
import type { RunMode } from '../../src/contracts.js';

const workers: WorkerKind[] = ['vibe', 'agy'];
const modes: RunMode[] = ['review', 'edit'];

describe('worker rules', () => {
  it('stays short and states the no-execution boundary for every worker and mode', () => {
    for (const worker of workers) for (const mode of modes) {
      const rules = workerRules(worker, mode);
      expect(Buffer.byteLength(rules)).toBeLessThan(2_000);
      expect(rules).toContain('no shell');
      expect(rules).toContain('You cannot run code, tests, a compiler or a linter.');
      expect(rules).toMatch(/stop/);
      expect(rules.split('\n').every((line) => line.trim() === line && line.length > 0)).toBe(true);
    }
  });

  it('names Vibe tools and their limits, and leaves agy tool names to agy', () => {
    expect(workerRules('vibe', 'review')).toContain('Tools: read_file only.');
    expect(workerRules('vibe', 'review')).toContain('2,000 lines or 64,000 bytes');
    expect(workerRules('vibe', 'review')).toContain('given a directory below the workspace root it lists the entries, but the root itself cannot be listed');
    expect(workerRules('vibe', 'review')).toContain('A path may be absolute or relative to the workspace root.');
    expect(workerRules('vibe', 'review')).not.toContain('write_file');
    expect(workerRules('vibe', 'edit')).toContain('Tools: read_file, write_file and edit.');
    expect(workerRules('vibe', 'edit')).toContain('old_string, which must be copied exactly');
    expect(workerRules('agy', 'review')).not.toContain('read_file');
    expect(workerRules('agy', 'review')).toContain('text search');
    expect(workerRules('agy', 'review')).toContain('Writes are refused.');
    expect(workerRules('agy', 'edit')).toContain('file write and replace');
  });

  it('carries the edit hygiene that rejected good patches, only for edits', () => {
    for (const worker of workers) {
      const edit = workerRules(worker, 'edit');
      expect(edit).toContain('Add no code comments unless the task asks for them.');
      expect(edit).toContain('Leave no trailing whitespace');
      expect(edit).toContain('narrowed before use');
      expect(workerRules(worker, 'review')).not.toContain('trailing whitespace');
      expect(workerRules(worker, 'review')).toContain('"No defect found in the inspected scope" is a valid answer');
    }
  });
});
