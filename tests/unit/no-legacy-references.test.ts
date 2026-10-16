import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..');
const SUPPORTED_VIBE = '2.26.1';
const SELF = 'tests/unit/no-legacy-references.test.ts';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git']);
const SCANNED_DIRECTORIES = ['src', 'tests', 'scripts', 'skills', 'examples', 'schemas', 'docs'];
const SCANNED_ROOT_FILES = ['README.md', 'SECURITY.md', 'CHANGELOG.md', 'AGENTS.md', 'Handoff.md'];
const CHANGELOG_START = /^## 2\.0\.\d+\b/;

const VIBE_VERSION = /\bvibe\b[ \t:=@-]*(?:(?:version|release|tag|v)[ \t:=@-]*)?v?(\d+(?:\.\d+)+)/gi;

function foreignVibeVersions(text: string): string[] {
  return [...text.matchAll(VIBE_VERSION)].map((match) => match[1]!).filter((version) => version !== SUPPORTED_VIBE);
}

interface Forbidden { name: string; test: (line: string) => boolean }

const literal = (value: string): Forbidden => ({ name: value, test: (line) => line.includes(value) });
const pattern = (name: string, expression: RegExp): Forbidden => ({ name, test: (line) => expression.test(line) });

const FORBIDDEN: Forbidden[] = [
  literal('legacy-harness'),
  literal('vibe -p'),
  literal('Python launcher'),
  literal('vibe_supervisor_launcher'),
  literal('release/1.0'),
  pattern('1.0.1', /(?<![\d.])1\.0\.1(?!\d)/),
  pattern('1.0.0', /(?<![\d.])1\.0\.0(?!\d)/),
  pattern('rc.<digit>', /\brc\.\d/),
  literal('docs/history'),
  literal('docs/reviews'),
  pattern('v1-', /\bv1-/),
  literal('programmatic'),
  { name: `a Vibe version other than ${SUPPORTED_VIBE}`, test: (line) => foreignVibeVersions(line).length > 0 }
];

interface Exception { file: string; name: string; line: string; reason: string }

const EXCEPTIONS: Exception[] = [
  {
    file: 'src/backends/app-server/protocol.ts',
    name: 'programmatic',
    line: "export const CLIENT_ENTRYPOINT = 'programmatic';",
    reason: "the clientInfo entrypoint value is part of Vibe's wire protocol, not project history"
  },
  {
    file: 'docs/compatibility.md',
    name: 'programmatic',
    line: '| `harness/core/src/core/features/programmatic_tool_calling/execution.rs` | `181795b9211b36ad075fb55a069882f466902f067b2bd86fb8d03d6f345ce4f8` |',
    reason: 'a Vibe 2.26.1 source path in the hashed source basis, not project history'
  },
  {
    file: 'docs/compatibility.md',
    name: 'programmatic',
    line: '| `vibe/cli/programmatic.py` | `a938d2440ff5599fa1c48f131c8d6d1ac336aec8cd496c1f8a7caa85c92bbbc1` |',
    reason: 'a Vibe 2.26.1 source path in the hashed source basis, not project history'
  }
];

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(repo, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...await walk(relative));
    } else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function exists(directory: string): Promise<boolean> {
  try { await readdir(path.join(repo, directory)); return true; } catch { return false; }
}

async function scannedFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const directory of SCANNED_DIRECTORIES) if (await exists(directory)) files.push(...await walk(directory));
  files.push(...SCANNED_ROOT_FILES);
  return files.filter((file) => file !== SELF).sort();
}

function linesToCheck(file: string, text: string): { number: number; text: string }[] {
  const lines = text.split('\n').map((line, index) => ({ number: index + 1, text: line }));
  if (file !== 'CHANGELOG.md') return lines;
  const start = lines.findIndex((line) => CHANGELOG_START.test(line.text));
  return start < 0 ? lines : lines.slice(start);
}

function isAllowed(file: string, name: string, line: string): boolean {
  return EXCEPTIONS.some((exception) => exception.file === file && exception.name === name && line.trim() === exception.line);
}

describe('no references to other versions or to development history', () => {
  it('finds no forbidden text in source, tests, scripts, skills, examples, schemas, docs or the root documents', async () => {
    const hits: string[] = [];
    for (const file of await scannedFiles()) {
      const text = await readFile(path.join(repo, file), 'utf8');
      for (const line of linesToCheck(file, text)) {
        for (const forbidden of FORBIDDEN) {
          if (forbidden.test(line.text) && !isAllowed(file, forbidden.name, line.text)) hits.push(`${file}:${line.number}: ${forbidden.name}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('keeps each exception in place with a stated reason', async () => {
    for (const exception of EXCEPTIONS) {
      expect(exception.reason.length).toBeGreaterThan(0);
      const text = await readFile(path.join(repo, exception.file), 'utf8');
      expect(text.split('\n').map((line) => line.trim())).toContain(exception.line);
    }
  });

  it('allows no other programmatic text in the protocol file', async () => {
    const text = await readFile(path.join(repo, 'src/backends/app-server/protocol.ts'), 'utf8');
    expect(text.split('\n').filter((line) => line.includes('programmatic'))).toEqual(["export const CLIENT_ENTRYPOINT = 'programmatic';"]);
  });
});

describe('foreign Vibe version detection', () => {
  it.each([
    ['Vibe 2.27.0', ['2.27.0']],
    ['vibe 2.26.0 is not supported', ['2.26.0']],
    ['Vibe v2.25.1', ['2.25.1']],
    ['Vibe version 2.26', ['2.26']],
    ['Vibe release 3.0.0', ['3.0.0']],
    ['vibe@2.30.0', ['2.30.0']],
    ['vibe-2.26.0', ['2.26.0']],
    ['Vibe: 2.26.10', ['2.26.10']],
    ['Vibe 2.26.1 and Vibe 2.27.0', ['2.27.0']]
  ])('flags %s', (text, expected) => {
    expect(foreignVibeVersions(text)).toEqual(expected);
  });

  it.each([
    'Vibe 2.26.1',
    'vibe 2.26.1.',
    'Vibe version 2.26.1',
    'Node 20.19.0 and Vibe 2.26.1',
    'Vibe needs Node 20.19.0',
    'Vibe, then 2.27.0',
    'npm 10.8.2',
    'vibe-supervisor 2.0.1',
    'vibe-supervisor@2.0.1',
    'vibe_review_start 1.2.3',
    'mistral_vibe-2.26.0.dist-info',
    'vibe.public-session-state/v1',
    '@modelcontextprotocol/server 2.3.0',
    'TypeScript 5.9.3',
    'Vibe\n2.27.0'
  ])('does not flag %s', (text) => {
    expect(foreignVibeVersions(text)).toEqual([]);
  });
});
