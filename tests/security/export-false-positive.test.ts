import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportDirtySnapshot } from '../../src/git/worktree.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function repoWith(content: string): Promise<{ dir: string; repo: string }> {
  const dir = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-export-')));
  dirs.push(dir);
  const repo = path.join(dir, 'repo'); await mkdir(repo);
  const run = (args: string[]) => { const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); };
  run(['init', '-q']); run(['config', 'user.email', 'test@example.invalid']); run(['config', 'user.name', 'Test']);
  await writeFile(path.join(repo, 'auth.ts'), content); run(['add', 'auth.ts']); run(['commit', '-qm', 'base']);
  return { dir, repo };
}

const base = ['interface Credentials {', '  password: string;', '  secret: SecretString,', '  count: number;', '}', ''].join('\n');

describe('exportDirtySnapshot credential check', () => {
  it('exports a patch whose context and changed lines merely look like credential declarations', async () => {
    const { dir, repo } = await repoWith(base);
    await writeFile(path.join(repo, 'auth.ts'), base.replace('count: number;', 'count: number;\n  password: string;\n') + 'const secret = process.env.SECRET;\n');
    const exported = await exportDirtySnapshot(repo, path.join(dir, 'artifacts'));
    await expect(readFile(exported.patchPath, 'utf8')).resolves.toContain('+const secret = process.env.SECRET;');
  });

  it.each([
    ['quoted password', 'const password = "hunter2hunter2";\n'],
    ['api key prefix', 'const api_key = "sk' + '-abcdefghijklmnopqrstuvwx";\n'],
    ['github token', 'const t = "gh' + 'p_abcdefghijklmnopqrstuvwxyz0123456789";\n'],
    ['pem block', '-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf\n-----END RSA PRIVATE KEY-----\n'],
  ])('refuses an added %s and keeps the files', async (_name, addition) => {
    const { dir, repo } = await repoWith(base);
    await writeFile(path.join(repo, 'auth.ts'), base + addition);
    await expect(exportDirtySnapshot(repo, path.join(dir, 'artifacts'))).rejects.toMatchObject({ code: 'VSUP_ARTIFACT_ERROR' });
    await expect(readFile(path.join(repo, 'auth.ts'), 'utf8')).resolves.toBe(base + addition);
  });
});
