import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFakePreparation } from '../unit/support/fake-preparation.js';
import { makeLaunchableFakeVibe } from '../unit/support/launchable-fake-vibe.js';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');
const cli = path.join(process.env.VIBE_SUPERVISOR_TEST_DIST ?? path.join(repo, 'dist'), 'cli.js');
const scratch: string[] = [];
const clients: Client[] = [];

type Readiness = { eligible: boolean; readiness_receipt: string; task_authorize: { argv: string[] } };
type Grant = { authorization_id: string; attempt_id: string; start_request: Record<string, unknown> };

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-start-payload-')); scratch.push(root);
  const workspace = path.join(root, 'workspace'); const data = path.join(root, 'data'); const fake = path.join(root, 'fake');
  await mkdir(workspace); await mkdir(data, { mode: 0o700 }); await mkdir(fake);
  await writeFile(path.join(workspace, 'a.js'), 'export const value = 1;\n');
  await exec('git', ['init', '-q'], { cwd: workspace });
  await exec('git', ['add', 'a.js'], { cwd: workspace });
  await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: workspace });
  const base = (await exec('git', ['rev-parse', 'HEAD'], { cwd: workspace })).stdout.trim();
  const launchable = await makeLaunchableFakeVibe(fake, { scenario: { name: 'answer', steps: [{ op: 'say', text: 'No files changed.' }] } });
  const config = path.join(data, 'config.toml');
  await writeFile(config, `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[paths]\nvibe = ${JSON.stringify(launchable.vibe)}\nvibe_pin_manifest = ${JSON.stringify(launchable.manifest)}\n`, { mode: 0o600 });
  await writeFakePreparation(config);
  const credential = ['start', 'payload', 'fixture', 'abcdefghijklmnop'].join('-');
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'serve', '--stdio', '--isolated', '--config', config], stderr: 'pipe', env: { ...(process.env as Record<string, string>), VIBE_SUPERVISOR_HOME: data, MISTRAL_API_KEY: credential } });
  const client = new Client({ name: 'start-payload-test', version: '0.0.1' }); clients.push(client); await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args }, { timeout: 20_000 });
    const content = response.content as { type: string; text?: string }[];
    return { isError: response.isError === true, body: JSON.parse(content.find((part) => part.type === 'text')?.text ?? '{}') as Record<string, unknown> };
  };
  const ready = async () => (await call('vibe_status', { workspace, operation: 'edit', base_ref: base })).body as unknown as Readiness;
  const authorize = async (readiness: Readiness, request: Record<string, unknown>) => {
    const file = path.join(root, 'request.json');
    await writeFile(file, JSON.stringify({ operation: 'edit', request }), { mode: 0o644 });
    const filled = readiness.task_authorize.argv.map((word) => word === '<private-request-file>' ? file : word === '<owner-reference>' ? 'deterministic-payload-test' : word);
    const [command, ...args] = filled;
    return JSON.parse((await exec(command!, args)).stdout) as Grant;
  };
  return { workspace, base, call, ready, authorize };
}

describe('canonical task authorize start payload', () => {
  it('forwards the complete frozen edit request and rejects changed contract or write scope before consuming its grant', async () => {
    const box = await fixture(); const readiness = await box.ready(); expect(readiness.eligible).toBe(true);
    const contract = {
      schema_version: 1, allowed_changed_paths: ['a.js', 'a.test.mjs'], required_changed_paths: ['a.js'],
      checks: [{ id: 'framework', kind: 'node_test', path: 'a.test.mjs', min_cases: 3 }], required_validations: ['behavior']
    };
    const request = { cwd: box.workspace, base_ref: box.base, task: 'fix it', acceptance_contract: contract, allowed_write_paths: ['a.js', 'a.test.mjs'], max_turns: 9, timeout_seconds: 60, wait_seconds: 1 };
    const grant = await box.authorize(readiness, request);
    expect(grant.start_request).toEqual({ ...request, authorization_id: grant.authorization_id, attempt_id: grant.attempt_id });
    const differentContract = { ...contract, checks: [{ ...contract.checks[0], min_cases: 4 }] };
    const refusedContract = await box.call('vibe_edit_start', { ...grant.start_request, acceptance_contract: differentContract, readiness_receipt: readiness.readiness_receipt });
    expect(refusedContract.isError).toBe(true);
    expect(refusedContract.body.error).toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', details: { differing_fields: ['acceptance_contract'] } });
    const refusedScope = await box.call('vibe_edit_start', { ...grant.start_request, allowed_write_paths: ['a.js'], readiness_receipt: readiness.readiness_receipt });
    expect(refusedScope.isError).toBe(true);
    expect(refusedScope.body.error).toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', details: { differing_fields: ['allowed_write_paths'] } });
    const fresh = await box.ready();
    const started = await box.call('vibe_edit_start', { ...grant.start_request, readiness_receipt: fresh.readiness_receipt, wait_seconds: 1 });
    expect(started.isError, JSON.stringify(started.body)).toBe(false);
    expect(started.body).toMatchObject({ mode: 'edit', run_id: expect.any(String), base_commit: box.base });
    const closed = await box.call('vibe_close', { run_id: started.body.run_id }); expect(closed.isError).toBe(false);
  }, 60_000);

  it('refuses stale readiness transport data and invalid wait values before returning a start payload', async () => {
    const box = await fixture(); const readiness = await box.ready();
    const request = { cwd: box.workspace, base_ref: box.base, task: 'fix it' };
    await expect(box.authorize(readiness, { ...request, readiness_receipt: 'stale-transport-data' })).rejects.toThrow();
    await expect(box.authorize(readiness, { ...request, wait_seconds: 'invalid-wait' })).rejects.toThrow();
    const grant = await box.authorize(readiness, request);
    expect(grant.start_request).toEqual({ ...request, wait_seconds: 0, authorization_id: grant.authorization_id, attempt_id: grant.attempt_id });
    expect(grant.start_request).not.toHaveProperty('readiness_receipt');
  }, 60_000);

});
