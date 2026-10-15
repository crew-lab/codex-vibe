import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_CONFIG } from '../unit/support/test-config.js';
import { RunManager } from '../../src/core/run-manager.js';
import { AppServerBackend } from '../../src/backends/app-server.js';
import { ResolvedCredential, type CredentialResolution } from '../../src/backends/app-server/credentials.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
const savedPath = process.env.PATH;

afterEach(async () => {
  if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-launcher-errors-')); roots.push(root);
  const source = path.join(root, 'source'); const data = path.join(root, 'data');
  await mkdir(source);
  return { root, source, data };
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function failedRun(manager: RunManager, source: string) {
  const started = await manager.reviewStart({ task: 'review', cwd: source, wait_seconds: 0 });
  const until = Date.now() + 5_000;
  let status = await manager.status({ run_id: started.run_id });
  while (!['failed', 'cancelled', 'completed'].includes(String(status.state)) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    status = await manager.status({ run_id: started.run_id });
  }
  return status;
}

describe('app-server start errors identify missing runtime components', () => {
  const injected = {
    preparation: { check: async () => ({ status: "passed" as const, candidate_sha256: null, version: "fixture", reason: "Fake ACP fixture evidence only" }) }, pin: { verify: async () => undefined },
    resolveCredential: async (): Promise<CredentialResolution> => ({ status: 'environment', detail: '', credential: new ResolvedCredential('labels-credential-abcdefghijklmnop') })
  };

  it('reports an absolute shebang interpreter that does not exist', async () => {
    const { root, source, data } = await makeRoot();
    const script = path.join(root, 'vibe-app-server');
    await writeExecutable(script, '#!/nonexistent/dir/python3\n');
    const config = { ...TEST_CONFIG, allowedWorkspaceRoots: [source], paths: { ...TEST_CONFIG.paths, appServer: script } };
    const manager = new RunManager(config, data, [new AppServerBackend(config, injected)]);
    try {
      const status = await failedRun(manager, source);
      expect(status.error).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND', message: expect.stringContaining('/nonexistent/dir/python3') });
      expect(JSON.stringify(status.error)).toMatch(/interpreter/i);
    } finally { await manager.shutdown(); }
  });

  it('reports a configured app-server executable that does not exist', async () => {
    const { root, source, data } = await makeRoot();
    const config = { ...TEST_CONFIG, allowedWorkspaceRoots: [source], paths: { ...TEST_CONFIG.paths, appServer: path.join(root, 'no-such-vibe-app-server') } };
    const manager = new RunManager(config, data, [new AppServerBackend(config)]);
    try { expect((await failedRun(manager, source)).error).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND' }); }
    finally { await manager.shutdown(); }
  });

  it('reports a bare vibe name that is not on PATH', async () => {
    const { root, source, data } = await makeRoot();
    const empty = path.join(root, 'empty-path'); await mkdir(empty);
    process.env.PATH = empty;
    const config = { ...TEST_CONFIG, allowedWorkspaceRoots: [source], paths: { ...TEST_CONFIG.paths, vibe: 'vibe' } };
    const manager = new RunManager(config, data, [new AppServerBackend(config)]);
    try { expect((await failedRun(manager, source)).error).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND' }); }
    finally { await manager.shutdown(); }
  });
});
