import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LISTING_LIMITS, buildWorkspaceListing, eligibleListingPaths, formatListing } from '../../src/backends/app-server/workspace-listing.js';

const scratch: string[] = [];

function repository(files: Record<string, string>, options: { stage?: readonly string[] } = {}): string {
  const root = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'app-server-listing-'))), 'workspace');
  scratch.push(path.dirname(root));
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  if (options.stage && options.stage.length > 0) execFileSync('git', ['add', '--', ...options.stage], { cwd: root, stdio: 'ignore' });
  return root;
}

afterEach(() => { for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const buffer = (...paths: string[]): Buffer => Buffer.from(`${paths.join('\0')}\0`);

describe('eligibleListingPaths', () => {
  it('drops reserved, secret, unsafe and duplicate paths and sorts the rest', () => {
    const listed = eligibleListingPaths(buffer(
      'src/b.ts', 'src/a.ts', 'src/a.ts', '.env', 'config/.env.local', 'a/.git/config', '.vibe/x', '.agents/y', '.vibeignore', 'keys/id.pem', 'keys/id.key', 'tls.p12', 'tls.pfx', '.envrc',
      'bad\nname.ts', 'tab\tname.ts', 'esc\u001b[0m.ts', 'nul\u0085.ts', 'line sep.ts', 'broken�.ts', '/abs/path.ts', '../up.ts', 'a/../b.ts', './dot.ts', 'ok name.ts', ''
    ));
    expect(listed).toEqual(['ok name.ts', 'src/a.ts', 'src/b.ts']);
  });

  it('keeps names that only look like secrets', () => {
    expect(eligibleListingPaths(buffer('environment.ts', 'src/keyboard.ts', 'pem.md', 'envrc/readme.md'))).toEqual(['environment.ts', 'envrc/readme.md', 'pem.md', 'src/keyboard.ts']);
  });
});

describe('excluded globs in the listing', () => {
  const paths = ['a.ts', 'infra/prod.tfvars', 'prod.tfvars', 'fixtures/private/a.json', 'fixtures/public/b.json', 'dumps/full.sql', 'dumps/nested/full.sql', 'src/index.ts'];

  it('drops excluded paths and leaves look-alikes', () => {
    expect(eligibleListingPaths(buffer(...paths), ['*.tfvars', 'fixtures/private/**', 'dumps/*.sql'])).toEqual(['a.ts', 'dumps/nested/full.sql', 'fixtures/public/b.json', 'src/index.ts']);
    expect(eligibleListingPaths(buffer(...paths), [])).toEqual([...paths].sort());
    expect(eligibleListingPaths(buffer(...paths))).toEqual([...paths].sort());
  });

  it('does not count excluded files as eligible or include them in the text', async () => {
    const root = repository({ 'src/index.ts': 'a', 'prod.tfvars': 'secret', 'infra/prod.tfvars': 'secret', 'fixtures/private/a.json': 'real data', 'README.md': 'd' });
    const listing = await buildWorkspaceListing(root, {}, ['*.tfvars', 'fixtures/private/**']);
    expect(listing.text?.split('\n')).toEqual(['Workspace files (paths relative to the workspace root):', '- README.md', '- src/index.ts']);
    expect(listing).toMatchObject({ included: 2, eligible: 2, truncated: false });
    expect(listing.text).not.toContain('tfvars');
    expect(listing.text).not.toContain('fixtures');
    const unfiltered = await buildWorkspaceListing(root);
    expect(unfiltered).toMatchObject({ included: 5, eligible: 5 });
  });

  it('reports no listing when every file is excluded', async () => {
    const root = repository({ 'a.tfvars': 'x' });
    expect(await buildWorkspaceListing(root, {}, ['*.tfvars'])).toEqual({ text: null, included: 0, eligible: 0, truncated: false, unavailable: null });
  });
});

describe('formatListing', () => {
  const limits = { maxFiles: 3, maxBytes: 10_000 };

  it('lists every path under a heading when nothing is cut', () => {
    expect(formatListing(['a', 'b'], limits)).toEqual({
      text: 'Workspace files (paths relative to the workspace root):\n- a\n- b',
      included: 2, eligible: 2, truncated: false, unavailable: null
    });
  });

  it('cuts at the file count and says how many files are missing', () => {
    const listing = formatListing(['a', 'b', 'c', 'd', 'e'], limits);
    expect(listing).toMatchObject({ included: 3, eligible: 5, truncated: true });
    expect(listing.text?.split('\n').slice(-2)).toEqual(['- c', '[Listing truncated: 2 more files not shown; the limit is 3 files or 10000 bytes.]']);
    expect(formatListing(['a', 'b', 'c', 'd'], limits).text).toContain('1 more file not shown');
  });

  it('cuts at the byte budget, counting multibyte names in bytes', () => {
    const heading = 'Workspace files (paths relative to the workspace root):';
    const budget = Buffer.byteLength(heading) + 1 + Buffer.byteLength('- ééé') + 1 + 2;
    const listing = formatListing(['ééé', 'ééé2'], { maxFiles: 100, maxBytes: budget });
    expect(listing).toMatchObject({ included: 1, eligible: 2, truncated: true });
    expect(listing.text).toContain('- ééé\n[Listing truncated: 1 more file not shown; the limit is 100 files or');
  });

  it('still reports truncation when not even one path fits, and yields nothing for no paths', () => {
    const none = formatListing(['a-very-long-name.ts'], { maxFiles: 5, maxBytes: 20 });
    expect(none).toMatchObject({ included: 0, eligible: 1, truncated: true });
    expect(none.text).toContain('[Listing truncated: 1 more file not shown');
    expect(formatListing([], limits)).toEqual({ text: null, included: 0, eligible: 0, truncated: false, unavailable: null });
  });
});

describe('buildWorkspaceListing', () => {
  it('lists tracked and untracked files from the workspace root, without ignored, reserved or secret ones', async () => {
    const root = repository({
      'src/index.ts': 'a',
      'src/util/helper.ts': 'b',
      'docs/guide.md': 'c',
      'README.md': 'd',
      '.gitignore': 'ignored.log\n',
      'ignored.log': 'noise',
      '.env': 'A=1',
      'config/.env.production': 'A=1',
      'keys/server.pem': 'x',
      '.vibeignore': '*',
      '.vibe/config.toml': '',
      '.agents/a.md': ''
    }, { stage: ['src/index.ts', 'README.md'] });
    const listing = await buildWorkspaceListing(root);

    expect(listing.unavailable).toBeNull();
    expect(listing.truncated).toBe(false);
    expect(listing.text?.split('\n')).toEqual([
      'Workspace files (paths relative to the workspace root):',
      '- .gitignore', '- README.md', '- docs/guide.md', '- src/index.ts', '- src/util/helper.ts'
    ]);
    expect(listing).toMatchObject({ included: 5, eligible: 5 });
  });

  it('lists only the files under a workspace that sits inside a larger repository', async () => {
    const root = repository({ 'top.ts': 'a', 'packages/app/main.ts': 'b', 'packages/app/lib/util.ts': 'c', 'packages/other/skip.ts': 'd' });
    const listing = await buildWorkspaceListing(path.join(root, 'packages', 'app'));
    expect(listing.text?.split('\n').slice(1)).toEqual(['- lib/util.ts', '- main.ts']);
  });

  it('truncates by file count and by bytes with an explicit line', async () => {
    const files = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`file-${index}.ts`, 'x']));
    const root = repository(files);
    const byCount = await buildWorkspaceListing(root, { maxFiles: 4 });
    expect(byCount).toMatchObject({ included: 4, eligible: 6, truncated: true });
    expect(byCount.text?.endsWith('[Listing truncated: 2 more files not shown; the limit is 4 files or 32768 bytes.]')).toBe(true);
    const byBytes = await buildWorkspaceListing(root, { maxBytes: 100 });
    expect(byBytes.truncated).toBe(true);
    expect(byBytes.included).toBeLessThan(6);
    expect(Buffer.byteLength(byBytes.text ?? '')).toBeLessThan(100 + 140);
  });

  it('reports a directory that is not a repository, a missing directory and an output cap', async () => {
    const plain = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'app-server-listing-plain-'))));
    scratch.push(plain);
    const notRepository = await buildWorkspaceListing(plain);
    expect(notRepository).toEqual({ text: null, included: 0, eligible: 0, truncated: false, unavailable: 'not_repository' });
    expect((await buildWorkspaceListing(path.join(plain, 'missing'))).unavailable).toBe('failed');
    const root = repository({ 'a/very/long/path/name/one.ts': 'x', 'a/very/long/path/name/two.ts': 'x' });
    expect((await buildWorkspaceListing(root, { maxGitOutputBytes: 16 })).unavailable).toBe('output_limit');
  });

  it('yields no text for an empty repository', async () => {
    expect(await buildWorkspaceListing(repository({}))).toEqual({ text: null, included: 0, eligible: 0, truncated: false, unavailable: null });
  });

  it('uses bounded defaults', () => {
    expect(DEFAULT_LISTING_LIMITS).toEqual({ maxFiles: 1000, maxBytes: 32768, timeoutMs: 10_000, maxGitOutputBytes: 8 * 1024 * 1024 });
  });

  it('skips file names that would break the prompt format', async () => {
    const root = repository({ 'normal.ts': 'x', 'two\nlines.ts': 'x' });
    const listing = await buildWorkspaceListing(root);
    expect(listing.text?.split('\n')).toEqual(['Workspace files (paths relative to the workspace root):', '- normal.ts']);
  });
});
