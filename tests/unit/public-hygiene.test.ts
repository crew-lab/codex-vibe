import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..');
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);

const GENERIC_HOME_NAMES = new Set(['example', 'me', 'person', 'private', 'someone', 'you', 'user', 'runner']);
const HOME_PATH = /(?:\/Users|\/home)\/([A-Za-z0-9._-]+)/g;
const MACHINE_TEMP_PATH = /\/(?:private\/)?var\/folders\/[A-Za-z0-9_+-]{2}\//;
const SOURCE_DIRECTORIES = ['src/', 'scripts/', 'bin/'];
const SOURCE_FILE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const TOOL_DIRECTIVE = /^\/[/*]\s*(?:eslint-|@ts-|#!|#region|#endregion|istanbul |c8 |v8 |Deprecated:|@vitest-environment|global |@license)|^\/\/\/\s*<reference /;

const LEGACY_COMMENT_BUDGET = new Map<string, number>([
  ['scripts/disconnect-observer.mjs', 2],
  ['scripts/smoke-install.mjs', 2],
  ['src/config/config.ts', 6],
  ['src/contracts.ts', 3],
  ['src/core/isolated-run-router.ts', 7],
  ['src/core/run-manager.ts', 8],
  ['src/diagnostics/doctor.ts', 1],
  ['src/git/worktree.ts', 5],
  ['src/mcp/server.ts', 1],
  ['src/mcp/tools.ts', 2],
  ['src/persistence/ndjson.ts', 1],
  ['src/process/managed.ts', 11],
  ['src/runtime/node-version.ts', 1],
  ['src/security/environment.ts', 1],
  ['src/security/paths.ts', 3],
  ['src/security/redaction.ts', 2]
]);

function textOf(file: string): string | undefined {
  if (!lstatSync(path.join(repo, file)).isFile()) return undefined;
  const bytes = readFileSync(path.join(repo, file));
  return bytes.includes(0) ? undefined : bytes.toString('utf8');
}

function machinePaths(text: string): string[] {
  const homes = [...text.matchAll(HOME_PATH)].filter((match) => !GENERIC_HOME_NAMES.has(match[1]!)).map((match) => match[0]);
  const temporary = MACHINE_TEMP_PATH.test(text) ? ['/var/folders/...'] : [];
  return [...homes, ...temporary];
}

function comments(text: string): string[] {
  const source = ts.createSourceFile('scanned.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ranges = new Map<number, ts.CommentRange>();
  const collect = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) ranges.set(range.pos, range);
    for (const child of node.getChildren(source)) collect(child);
  };
  collect(source);
  return [...ranges.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((range) => text.slice(range.pos, range.end))
    .filter((comment) => !TOOL_DIRECTIVE.test(comment))
    .map((comment) => comment.slice(0, 80));
}

describe('public repository hygiene', () => {
  it('commits no machine-specific home or temporary paths', () => {
    const offenders = trackedFiles.flatMap((file) => {
      if (file === 'tests/unit/public-hygiene.test.ts') return [];
      const text = textOf(file);
      return text === undefined ? [] : machinePaths(text).map((found) => `${file}: ${found}`);
    });
    expect(offenders, 'Replace machine paths with placeholders such as <target-home>').toEqual([]);
  });

  it('adds no source comments beyond the legacy budget, which only shrinks', () => {
    const drift = trackedFiles
      .filter((file) => SOURCE_DIRECTORIES.some((directory) => file.startsWith(directory)) && SOURCE_FILE.test(file))
      .flatMap((file) => {
        const found = comments(textOf(file) ?? '');
        const budget = LEGACY_COMMENT_BUDGET.get(file) ?? 0;
        if (found.length > budget) return [`${file}: new comment(s); name things instead, or move the explanation to docs/: ${found.join(' | ')}`];
        if (found.length < budget) return [`${file}: ${budget - found.length} comment(s) removed; lower LEGACY_COMMENT_BUDGET to ${found.length}`];
        return [];
      });
    expect(drift).toEqual([]);
  });

  it('flags the shapes these checks exist for', () => {
    expect(machinePaths('see /Users/alice/src/project and /home/bob/x')).toEqual(['/Users/alice', '/home/bob']);
    expect(machinePaths('a generic /Users/example/repo')).toEqual([]);
    expect(machinePaths('tmp /var/folders/ab/xyz')).toEqual(['/var/folders/...']);
    expect(comments('try { run(); } catch {\n  // ignore\n}\n')).toEqual(['// ignore']);
    expect(comments('// eslint-disable-next-line no-console\nconst a = "// not a comment";\n')).toEqual([]);
  });
});
