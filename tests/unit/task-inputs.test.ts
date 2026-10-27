import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, link, writeFile, chmod, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareTaskInputs, taskInputManifestSchema, verifyTaskInputs } from '../../src/preparation/task-inputs.js';

const roots: string[] = [];
const prep = (options: { source: string; base: string; files: readonly string[]; output: string; outputPaths?: readonly string[]; exclusions?: readonly { root: string; globs: readonly string[] }[] }) => prepareTaskInputs({ ...options, allowedRoots: [options.source] });
const verify = (directory: string, source: string, exclusions: readonly { root: string; globs: readonly string[] }[] = [], files?: readonly string[]) => verifyTaskInputs(directory, { allowedRoots: [source], exclusions }, files);
async function fixture(): Promise<{ parent: string; source: string; base: string }> {
  const parent = await mkdtemp(path.join(await realpath(tmpdir()), 'task-inputs-')); roots.push(parent);
  const source = path.join(parent, 'source'); await mkdir(source);
  const git = (args: string[]): string => {
    const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', source, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  await writeFile(path.join(source, 'tracked.txt'), 'committed\n');
  await writeFile(path.join(source, 'clean.txt'), 'clean committed context\n');
  git(['add', 'tracked.txt', 'clean.txt']); git(['commit', '-q', '-m', 'initial']);
  const base = git(['rev-parse', 'HEAD']);
  return { parent, source: await realpath(source), base };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('prepared task inputs', () => {
  it('reports ignored inputs, contract permissions and output placement together without creating a bundle', async () => {
    const { source, base } = await fixture();
    await writeFile(path.join(source, '.gitignore'), 'ignored.txt\n');
    await writeFile(path.join(source, 'ignored.txt'), 'private diagnostic input');
    const contract = path.join(source, 'contract.json');
    await writeFile(contract, '{}', { mode: 0o644 });
    const output = path.join(source, 'prepared');
    let message = '';
    try { await prepareTaskInputs({ source, base, files: ['ignored.txt'], output, contractFile: contract, allowedRoots: [source] }); }
    catch (error) { message = (error as Error).message; }
    expect(message).toContain('outside source checkout');
    expect(message).toContain('mode 0600');
    expect(message).toContain('ignored or absent from Git discovery: ignored.txt');
    await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(source, 'ignored.txt'), 'utf8')).toBe('private diagnostic input');
  });

  it('copies committed, dirty, and untracked bytes exactly and leaves source unchanged', async () => {
    const { parent, source, base } = await fixture();
    await writeFile(path.join(source, 'tracked.txt'), 'dirty overlay\n');
    await writeFile(path.join(source, 'new.txt'), 'untracked input\n');
    const before = [await readFile(path.join(source, 'clean.txt')), await readFile(path.join(source, 'tracked.txt')), await readFile(path.join(source, 'new.txt'))];
    const output = path.join(parent, 'prepared');
    const prepared = await prep({ source, base, files: ['clean.txt', 'tracked.txt', 'new.txt'], outputPaths: ['tracked.txt'], output });
    expect(prepared).toMatchObject({ status: 'prepared', files: 3, token_count: null });
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')) as { files: Array<{ path: string; provenance: string }>; allowed_output_paths: string[] };
    expect(manifest.files.map((file) => file.provenance)).toEqual(['committed', 'dirty-tracked', 'untracked']);
    expect(await readFile(path.join(output, 'context', 'clean.txt'))).toEqual(before[0]);
    expect(manifest.allowed_output_paths).toEqual(['tracked.txt']);
    expect(await readFile(path.join(output, 'context', 'tracked.txt'))).toEqual(before[1]);
    expect(await readFile(path.join(output, 'context', 'new.txt'))).toEqual(before[2]);
    expect(await verify(output, source)).toMatchObject({ status: 'verified', files: 3, bytes: before.reduce((sum, bytes) => sum + bytes.length, 0), token_count: null });
    expect(await readFile(path.join(source, 'tracked.txt'))).toEqual(before[1]);
  });

  it('rejects stale same-length source bytes', async () => {
    const { parent, source, base } = await fixture(); const output = path.join(parent, 'prepared');
    await prep({ source, base, files: ['tracked.txt'], output });
    await writeFile(path.join(source, 'tracked.txt'), 'change---\n');
    await expect(verify(output, source)).rejects.toThrow('Required source changed');
  });

  it('requires the selected source to remain allowed at verification', async () => {
    const { parent, source, base } = await fixture(); const output = path.join(parent, 'prepared');
    await prep({ source, base, files: ['tracked.txt'], output });
    await expect(verifyTaskInputs(output, { allowedRoots: [], exclusions: [] })).rejects.toThrow();
  });

  it('refuses excluded files and symlinks in source paths', async () => {
    const { parent, source, base } = await fixture();
    await mkdir(path.join(source, 'excluded'));
    await writeFile(path.join(source, 'excluded', 'private.txt'), 'not context');
    await expect(prepareTaskInputs({ source, base, files: ['excluded/private.txt'], output: path.join(parent, 'excluded-out'), allowedRoots: [source], exclusions: [{ root: source, globs: ['excluded/**'] }] })).rejects.toThrow('path_excluded');
    await symlink('tracked.txt', path.join(source, 'linked.txt'));
    await expect(prep({ source, base, files: ['linked.txt'], output: path.join(parent, 'linked-out') })).rejects.toThrow('Linked source path');
    await link(path.join(source, 'tracked.txt'), path.join(source, 'hardlinked.txt'));
    await expect(prep({ source, base, files: ['hardlinked.txt'], output: path.join(parent, 'hardlinked-out') })).rejects.toThrow('Unsafe or oversized source file');
    const alias = path.join(parent, 'source-alias'); await symlink(source, alias);
    await expect(prepareTaskInputs({ source: alias, base, files: ['tracked.txt'], output: path.join(parent, 'alias-out'), allowedRoots: [source] })).rejects.toThrow();
  });

  it('rejects duplicate manifest paths', () => {
    const baseManifest = { schema_version: 1, owner: 'vibe-supervisor-task-inputs', source: '/work/repo', base_commit: 'a'.repeat(40), files: [{ path: 'one.txt', sha256: 'b'.repeat(64), bytes: 0, provenance: 'committed' }], dirty_overlay_sha256: 'c'.repeat(64), allowed_output_paths: ['one.txt'], contract_sha256: null, policy_sha256: 'd'.repeat(64), total_files: 1, total_bytes: 0, token_count: null, manifest_sha256: 'e'.repeat(64) };
    expect(() => taskInputManifestSchema.parse({ ...baseManifest, files: [...baseManifest.files, ...baseManifest.files], total_files: 1 })).toThrow();
  });

  it('rejects reserved and secret path names using the tool policy', async () => {
    const { parent, source, base } = await fixture();
    await mkdir(path.join(source, 'nested', '.ssh'), { recursive: true });
    for (const file of ['.vibeignore', '.env', '.env.local', 'nested/.env.production', 'nested/.ssh/id_rsa']) await writeFile(path.join(source, file), 'selected text\n');
    for (const file of ['.vibeignore', '.env', '.env.local', 'nested/.env.production', 'nested/.ssh/id_rsa']) await expect(prep({ source, base, files: [file], output: path.join(parent, `out-${file.replaceAll('/', '-')}`) })).rejects.toThrow();
  });

  it('requires an owner-private output parent and refuses changed prepared bytes', async () => {
    const { parent, source, base } = await fixture();
    const unsafe = path.join(parent, 'unsafe'); await mkdir(unsafe); await chmod(unsafe, 0o777);
    await expect(prep({ source, base, files: ['tracked.txt'], output: path.join(unsafe, 'prepared') })).rejects.toThrow('Output parent must exist, be canonical, owned by the current user and mode 0700');
    const output = path.join(parent, 'prepared'); await prep({ source, base, files: ['tracked.txt'], output });
    const copy = path.join(output, 'context', 'tracked.txt'); await chmod(copy, 0o600); await writeFile(copy, 'tampered\n');
    await expect(verify(output, source)).rejects.toThrow('Prepared context bytes changed');
    expect((await lstat(output)).mode & 0o077).toBe(0);
  });

  it('refuses a symlink substituted into the prepared context tree', async () => {
    const { parent, source, base } = await fixture();
    const output = path.join(parent, 'prepared'); await prep({ source, base, files: ['tracked.txt'], output });
    const copy = path.join(output, 'context', 'tracked.txt'); await rm(copy); await symlink(path.join(source, 'tracked.txt'), copy);
    await expect(verify(output, source)).rejects.toThrow('Unsafe prepared context path');
  });
});
