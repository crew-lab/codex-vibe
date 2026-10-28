import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import { authorizeWithReturnedCommand } from '../support/authorize-cli.js';
import { writeFakePreparation } from '../unit/support/fake-preparation.js';
import { makeLaunchableFakeVibe } from '../unit/support/launchable-fake-vibe.js';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');
const distRoot = process.env.VIBE_SUPERVISOR_TEST_DIST ?? path.join(repo, 'dist');
const cli = path.join(distRoot, 'cli.js');
const canonicalTmp = await realpath(tmpdir());
const scratch: string[] = [];
const clients: Client[] = [];

type TaskAuthorize = { argv: string[]; command: string; expires_at: string; request_template: { operation: 'review' | 'edit'; request: Record<string, unknown> } };
type Readiness = Record<string, unknown> & { eligible: boolean; readiness_receipt?: string; task_authorize: TaskAuthorize | null; supervisor_runtime: { executable: string } };

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text?: string }[]).find((part) => part.type === 'text')?.text ?? '';
}

async function sandbox() {
  const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-task-authorize-')); scratch.push(parent);
  const workspace = path.join(parent, 'workspace'); const data = path.join(parent, 'data'); const fake = path.join(parent, 'fake');
  await mkdir(workspace); await mkdir(data, { mode: 0o700 }); await mkdir(fake);
  await writeFile(path.join(workspace, 'a.js'), 'console.log(1);\n');
  await exec('git', ['init', '-q'], { cwd: workspace });
  await exec('git', ['add', 'a.js'], { cwd: workspace });
  await exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init'], { cwd: workspace });
  const launchable = await makeLaunchableFakeVibe(fake, { scenario: { name: 'answer', steps: [{ op: 'say', text: 'No defect found in the inspected scope.' }] } });
  const config = path.join(data, 'config.toml');
  await writeFile(config, `version = 1\nallowed_workspace_roots = [${JSON.stringify(workspace)}]\n[paths]\nvibe = ${JSON.stringify(launchable.vibe)}\nvibe_pin_manifest = ${JSON.stringify(launchable.manifest)}\n`, { mode: 0o600 });
  await writeFakePreparation(config);
  return { workspace, data, config };
}

async function connect(box: Awaited<ReturnType<typeof sandbox>>) {
  const credential = ['task', 'authorize', 'fixture', 'credential', 'abcdefghijklmnop'].join('-');
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'serve', '--stdio', '--isolated', '--config', box.config], stderr: 'pipe', env: { ...(process.env as Record<string, string>), VIBE_SUPERVISOR_HOME: box.data, MISTRAL_API_KEY: credential } });
  const client = new Client({ name: 'task-authorize-test', version: '0.0.1' }); clients.push(client);
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }, { timeout: 20_000 });
    return { isError: result.isError === true, body: JSON.parse(text(result)) as Record<string, unknown> };
  };
  return { call, credential };
}

describe('the task authorize command returned by readiness', () => {
  it('registers a grant that the same server accepts for the templated request, and refuses one bound to another task by name', async () => {
    const box = await sandbox();
    const server = await connect(box);
    const readiness = (await server.call('vibe_status', { workspace: box.workspace, operation: 'review' })).body as Readiness;
    expect(readiness.eligible, JSON.stringify(readiness.blockers)).toBe(true);
    const block = readiness.task_authorize!;
    expect(block.argv[0]).toBe(readiness.supervisor_runtime.executable);
    expect(block.argv[1]).toBe(cli);
    expect(block.argv.slice(2, 4)).toEqual(['task', 'authorize']);
    expect(block.argv[block.argv.indexOf('--config') + 1]).toBe(box.config);
    expect(block.argv).not.toContain('--runtime-node');
    expect(JSON.stringify(block)).not.toContain(server.credential);
    expect(JSON.stringify(block)).not.toContain(readiness.readiness_receipt!);
    expect(block.request_template).toEqual({ operation: 'review', request: { cwd: box.workspace, context_files: [] } });

    const request = { ...block.request_template.request, task: 'Read only a.js. Question: does it log exactly once?' };
    const grant = await authorizeWithReturnedCommand(block.argv, block.request_template.operation, request, 'owner-instruction-7');
    expect(grant.expires_at).toBe(block.expires_at);

    const otherGrant = await authorizeWithReturnedCommand(block.argv, 'review', { ...request, task: 'A different task.' });
    const refused = await server.call('vibe_review_start', { ...request, authorization_id: otherGrant.authorization_id, attempt_id: otherGrant.attempt_id, readiness_receipt: readiness.readiness_receipt });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', details: { differing_fields: ['task'] } });

    const started = await server.call('vibe_review_start', { ...request, authorization_id: grant.authorization_id, attempt_id: grant.attempt_id, readiness_receipt: readiness.readiness_receipt, wait_seconds: 20 });
    expect(started.isError, JSON.stringify(started.body)).toBe(false);
    expect(started.body).toMatchObject({ run_id: expect.any(String), mode: 'review' });

    const replay = await server.call('vibe_review_start', { ...request, authorization_id: grant.authorization_id, attempt_id: grant.attempt_id });
    expect(replay.isError).toBe(true);
    expect(String((replay.body.error as { code: string }).code)).toMatch(/^VSUP_(ATTEMPT_CONSUMED|LIMIT_EXCEEDED)$/);

    const closed = await server.call('vibe_close', { run_id: started.body.run_id });
    expect(closed.isError, JSON.stringify(closed.body)).toBe(false);
  }, 60_000);

  it('templates an edit with the checked base_ref', async () => {
    const box = await sandbox();
    const server = await connect(box);
    const readiness = (await server.call('vibe_status', { workspace: box.workspace, operation: 'edit', base_ref: 'HEAD' })).body as Readiness;
    expect(readiness.task_authorize!.request_template).toEqual({ operation: 'edit', request: { cwd: box.workspace, base_ref: 'HEAD' } });
    expect(readiness.task_authorize!.argv[1]).toBe(cli);
  });
});
