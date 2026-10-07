import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..');
const skipped = new Set(['node_modules', '.git', 'dist', 'release', 'coverage', '.claude']);

async function markdownFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await markdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(absolute);
  }
  return found;
}

function slug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}

async function anchors(file: string): Promise<Set<string>> {
  const text = await readFile(file, 'utf8');
  const found = new Set<string>();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const heading = !fenced && /^#{1,6}\s+(.*)$/.exec(line);
    if (heading?.[1]) found.add(slug(heading[1].replace(/`/g, '')));
  }
  return found;
}

function linksOf(text: string): string[] {
  const withoutFences = text.replace(/```[\s\S]*?```/g, '');
  return [...withoutFences.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? '');
}

describe('Markdown links', () => {
  it('resolve to existing files and headings', async () => {
    const broken: string[] = [];
    for (const file of await markdownFiles(repo)) {
      for (const link of linksOf(await readFile(file, 'utf8'))) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
        const [target = '', fragment] = link.split('#');
        const resolved = target ? path.resolve(path.dirname(file), target) : file;
        const info = await stat(resolved).catch(() => undefined);
        if (!info) { broken.push(`${path.relative(repo, file)} -> ${link}`); continue; }
        if (fragment && info.isFile() && resolved.endsWith('.md') && !(await anchors(resolved)).has(fragment)) broken.push(`${path.relative(repo, file)} -> ${link}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
