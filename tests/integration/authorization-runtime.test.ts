import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { authorizeWithNode } from '../../src/cli/task-runtime.js';

const exec = promisify(execFile);
const roots: string[] = [];
const dist = process.env.VIBE_SUPERVISOR_TEST_DIST!;
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('authorization Node selection', () => {
  it('rejects PATH lookup and control characters before invoking a command', async () => {
    await expect(authorizeWithNode('node', [])).rejects.toThrow('absolute Node executable');
    await expect(authorizeWithNode('/invalid\nnode', [])).rejects.toThrow('absolute Node executable');
  });

  it('keeps the current runtime without subprocess dispatch', async () => {
    expect(await authorizeWithNode(process.execPath, ['authorize', '--invalid'])).toBeUndefined();
  });

  it('does not mint a grant if the selected executable is missing', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-runtime-missing-'))); roots.push(root);
    await expect(authorizeWithNode(path.join(root, 'missing-node'), ['authorize'])).rejects.toThrow();
  });

  it.skipIf(!process.env.VIBE_SUPERVISOR_TEST_OTHER_NODE)('binds grants to the selected server runtime across Node versions and preserves one-use consumption', async () => {
    const other = await realpath(process.env.VIBE_SUPERVISOR_TEST_OTHER_NODE!);
    expect(other).not.toBe(await realpath(process.execPath));
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-runtime-grant-'))); roots.push(root);
    const workspace = path.join(root, 'workspace'); await mkdir(workspace);
    await writeFile(path.join(workspace, 'note.txt'), 'fixture\n');
    const state = path.join(root, 'state'); await mkdir(state, { mode: 0o700 });
    const config = path.join(state, 'config.toml');
    const configText = `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[paths]\nvibe_pin_manifest = ${JSON.stringify(path.join(state, 'pin.json'))}\n`;
    await writeFile(config, configText, { mode: 0o600 });
    const request = path.join(root, 'request.json');
    await writeFile(request, JSON.stringify({ operation: 'review', request: { task: 'inspect fixture', cwd: workspace, max_turns: 1, timeout_seconds: 30 } }), { mode: 0o600 });
    const args = [path.join(dist, 'cli.js'), 'task', 'authorize', '--request', request, '--config', config, '--owner-reference', 'offline-runtime-regression', '--expires-at', new Date(Date.now() + 60_000).toISOString()];
    const plain = JSON.parse((await exec(process.execPath, args)).stdout);
    const selected = JSON.parse((await exec(process.execPath, [...args, '--runtime-node', other])).stdout);
    const direct = JSON.parse((await exec(other, args)).stdout);
    expect(selected.request_sha256).toBe(direct.request_sha256);
    expect(plain.request_sha256).not.toBe(selected.request_sha256);
    expect(await readFile(config, 'utf8')).toBe(configText);
    const script = `
      import { DispatchGrants } from ${JSON.stringify(path.join(dist, 'core/dispatch-grants.js'))};
      import { randomUUID } from 'node:crypto';
      import { readFile } from 'node:fs/promises';
      const store = new DispatchGrants(${JSON.stringify(path.join(state, 'dispatch-grants'))});
      const grants = ${JSON.stringify({ plain, selected })};
      const selectedRecord = JSON.parse(await readFile(${JSON.stringify(path.join(state, 'dispatch-grants', `${selected.authorization_id}.json`))}, 'utf8'));
      const result = [];
      for (const grant of [grants.plain, grants.selected, grants.selected]) {
        try { await store.consume({ authorizationId: grant.authorization_id, attemptId: grant.attempt_id, requestSha256: grants.selected.request_sha256, binding: selectedRecord.binding, runId: randomUUID() }); result.push('consumed'); }
        catch (error) { result.push({code:error.code,differing_fields:error.details?.differing_fields}); }
      }
      console.log(JSON.stringify(result));
    `;
    const consumed = JSON.parse((await exec(other, ['--input-type=module', '-e', script])).stdout);
    expect(consumed).toEqual([{code:'VSUP_AUTHORIZATION_INVALID',differing_fields:['node_executable','node_version']}, 'consumed', {code:'VSUP_ATTEMPT_CONSUMED'}]);
  });
});
