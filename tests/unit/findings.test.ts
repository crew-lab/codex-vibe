import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractFindingsJsonBlock, validateFindings } from '../../src/core/findings.js';
import type { WorkspaceSnapshot } from '../../src/core/workspace-snapshot.js';
import { workspaceAnchors } from '../../src/security/globs.js';

describe('extractFindingsJsonBlock', () => {
  it('extracts findings from a fenced json code block', () => {
    const text = `Here is my review:\n\n\`\`\`json\n{\n  "version": 1,\n  "findings": [\n    {\n      "ruleId": "security/no-eval",\n      "message": "eval is dangerous",\n      "location": { "path": "src/index.ts", "startLine": 10 },\n      "severity": "error"\n    }\n  ]\n}\n\`\`\`\n`;
    const extracted = extractFindingsJsonBlock(text);
    expect(extracted).not.toBeNull();
    expect(extracted?.findings).toHaveLength(1);
    expect(extracted?.findings[0]).toMatchObject({
      ruleId: 'security/no-eval',
      message: 'eval is dangerous'
    });
  });

  it('selects the last code block when multiple blocks exist', () => {
    const text = `
Example snippet:
\`\`\`json
{ "example": true }
\`\`\`

Final findings:
\`\`\`json
{
  "version": 1,
  "findings": [
    {
      "ruleId": "lint/style",
      "message": "trailing whitespace",
      "location": { "path": "src/main.ts", "startLine": 5 },
      "severity": "info"
    }
  ]
}
\`\`\`
`;
    const extracted = extractFindingsJsonBlock(text);
    expect(extracted).not.toBeNull();
    expect(extracted?.findings).toHaveLength(1);
    expect(extracted?.findings[0]).toMatchObject({
      ruleId: 'lint/style'
    });
  });

  it('extracts findings from top-level json array in a code block', () => {
    const text = `\`\`\`json\n[\n  {\n    "ruleId": "bug/null-deref",\n    "message": "Potential null dereference",\n    "location": { "path": "src/util.ts", "startLine": 20 }\n  }\n]\n\`\`\``;
    const extracted = extractFindingsJsonBlock(text);
    expect(extracted).not.toBeNull();
    expect(extracted?.findings).toHaveLength(1);
    expect(extracted?.findings[0]).toMatchObject({
      ruleId: 'bug/null-deref'
    });
  });

  it('falls back to trailing JSON object with findings key', () => {
    const text = `No code block was used. {"version": 1, "findings": [{"ruleId": "r1", "message": "msg", "location": {"path": "a.ts", "startLine": 1}}]}`;
    const extracted = extractFindingsJsonBlock(text);
    expect(extracted).not.toBeNull();
    expect(extracted?.findings).toHaveLength(1);
    expect(extracted?.findings[0]).toMatchObject({ ruleId: 'r1' });
  });

  it('returns null when no valid findings json block exists', () => {
    expect(extractFindingsJsonBlock('')).toBeNull();
    expect(extractFindingsJsonBlock('Everything looks clean and well-structured.')).toBeNull();
    expect(extractFindingsJsonBlock('```json\n{ "invalid": true }\n```')).toBeNull();
  });
});

describe('validateFindings', () => {
  let workspace: string;
  const mockSnapshot: WorkspaceSnapshot = {
    sha256: '00'.repeat(32),
    manifest: new Map([
      ['src/index.ts', { kind: 'F', sha256: '11'.repeat(32) }],
      ['src/main.ts', { kind: 'F', sha256: '22'.repeat(32) }],
      ['README.md', { kind: 'F', sha256: '33'.repeat(32) }]
    ])
  };

  beforeEach(async () => {
    workspace = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-findings-test-')));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('accepts valid finding and computes deterministic ID and summary', async () => {
    const rawFindings = [
      {
        ruleId: 'typescript/strict-boolean',
        message: 'Avoid truthiness check on object',
        location: { path: 'src/index.ts', startLine: 15, endLine: 16, startColumn: 3, endColumn: 20 },
        severity: 'warning'
      },
      {
        ruleId: 'security/sql-injection',
        message: 'Unsanitized input in query',
        location: { path: 'src/main.ts', startLine: 42 },
        severity: 'error'
      }
    ];

    const result = await validateFindings({
      rawFindings,
      workspace,
      snapshot: mockSnapshot
    });

    expect(result.version).toBe(1);
    expect(result.findings).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);

    const first = result.findings[0]!;
    expect(first.id).toMatch(/^[0-9a-f]{16}$/);
    expect(first.ruleId).toBe('typescript/strict-boolean');
    expect(first.location).toEqual({
      path: 'src/index.ts',
      startLine: 15,
      endLine: 16,
      startColumn: 3,
      endColumn: 20
    });
    expect(first.severity).toBe('warning');

    const second = result.findings[1]!;
    expect(second.severity).toBe('error');

    expect(result.summary).toEqual({
      total: 2,
      errors: 1,
      warnings: 1,
      info: 0,
      hints: 0,
      rejected: 0
    });
  });

  it('rejects finding when file does not exist in snapshot', async () => {
    const rawFindings = [
      {
        ruleId: 'missing/file',
        message: 'File was deleted or never existed',
        location: { path: 'src/nonexistent.ts', startLine: 1 },
        severity: 'error'
      }
    ];

    const result = await validateFindings({
      rawFindings,
      workspace,
      snapshot: mockSnapshot
    });

    expect(result.findings).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      reason: 'file_not_found',
      raw: rawFindings[0]
    });
    expect(result.summary.rejected).toBe(1);
  });

  it('rejects finding with endLine < startLine', async () => {
    const rawFindings = [
      {
        ruleId: 'bounds/invalid',
        message: 'inverted line numbers',
        location: { path: 'src/index.ts', startLine: 10, endLine: 5 }
      }
    ];

    const result = await validateFindings({
      rawFindings,
      workspace,
      snapshot: mockSnapshot
    });

    expect(result.findings).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('line_out_of_bounds');
  });

  it('rejects malformed finding objects with schema_invalid', async () => {
    const rawFindings = [
      null,
      'a string finding',
      { ruleId: 'missing/message', location: { path: 'src/index.ts', startLine: 1 } },
      { message: 'missing location' },
      { message: 'invalid location startLine', location: { path: 'src/index.ts', startLine: 0 } },
      { message: 'negative startLine', location: { path: 'src/index.ts', startLine: -5 } }
    ];

    const result = await validateFindings({
      rawFindings,
      workspace,
      snapshot: mockSnapshot
    });

    expect(result.findings).toHaveLength(0);
    expect(result.rejected).toHaveLength(6);
    for (const r of result.rejected) {
      expect(r.reason).toBe('schema_invalid');
    }
  });

  it('rejects reserved, secret, excluded, and outside workspace paths', async () => {
    const exclusions = workspaceAnchors([{ root: workspace, globs: ['ignored/**'] }], workspace);
    const rawFindings = [
      { message: 'secret leak', location: { path: '.env', startLine: 1 } },
      { message: 'git config', location: { path: '.git/config', startLine: 1 } },
      { message: 'gemini internals', location: { path: '.gemini/settings.json', startLine: 1 } },
      { message: 'excluded dir', location: { path: 'ignored/temp.ts', startLine: 1 } },
      { message: 'outside workspace', location: { path: '../outside.txt', startLine: 1 } }
    ];

    const result = await validateFindings({
      rawFindings,
      workspace,
      snapshot: undefined,
      excluded: exclusions
    });

    expect(result.findings).toHaveLength(0);
    expect(result.rejected).toHaveLength(5);
    const reasons = result.rejected.map((r) => r.reason);
    expect(reasons).toContain('path_secret');
    expect(reasons).toContain('path_reserved');
    expect(reasons).toContain('path_excluded');
    expect(reasons).toContain('path_outside_workspace');
  });
});
