import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const { auditReview } = await import(pathToFileURL(path.resolve('scripts/soak-review-audit.mjs')).href);
const runId = '11111111-1111-4111-8111-111111111111';

describe('private review audit', () => {
  it.each([
    { messages: [{ role: 'assistant', content: 'Earlier final answer' }, { role: 'user', content: 'Continue' }], code: 'final_answer_missing' },
    { messages: [{ role: 'assistant', tool_calls: [{ function: { name: 'write_file', arguments: 'SECRET-CANARY' } }] }], code: 'task_bounds' },
    { messages: [{ role: 'assistant', content: '<vibe_stop_event>Turn limit reached</vibe_stop_event>' }], code: 'final_answer_missing' },
  ])('rejects incomplete or unexpected native activity without retaining content', async ({ messages, code }) => {
    const home = await mkdtemp(path.join(tmpdir(), 'vsup-audit-'));
    const canonical = await import('node:fs/promises').then((fs) => fs.realpath(home));
    try {
      const directory = path.join(canonical, 'runs', runId, 'vibe-home', 'sessions', 'session_test');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, 'messages.jsonl'), messages.map((message) => JSON.stringify(message)).join('\n') + '\n', { mode: 0o600 });
      const result = await auditReview(canonical, runId, { reads: 3, searches: 2, requireFinal: true });
      expect(result.violations).toContain(code);
      expect(JSON.stringify(result)).not.toContain('SECRET-CANARY');
      expect(JSON.stringify(result)).not.toContain('Earlier final answer');
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
