import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..', '..');
const cli = path.join(process.env.VIBE_SUPERVISOR_TEST_DIST ?? path.join(repo, 'dist'), 'cli.js');
const canonicalTmp = await realpath(tmpdir());
const scratch: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text?: string }[]).find((part) => part.type === 'text')?.text ?? '';
}

describe('workspace readiness over a real --isolated stdio connection', () => {
  it('rereads the originally selected config, not the session snapshot, and never launches Vibe', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-readiness-')); scratch.push(parent);
    const data = path.join(parent, 'data'); const first = path.join(parent, 'first'); const second = path.join(parent, 'second');
    await mkdir(data, { mode: 0o700 }); await mkdir(first); await mkdir(second);
    const marker = path.join(parent, 'vibe-was-launched');
    const vibe = path.join(parent, 'vibe');
    const appServer = path.join(parent, 'vibe-app-server');
    for (const executable of [vibe, appServer]) {
      await writeFile(executable, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
      await chmod(executable, 0o755);
    }
    const configPath = path.join(data, 'config.toml');
    await writeFile(configPath, `version = 1\nallowed_workspace_roots = [${JSON.stringify(first)}]\n[paths]\nvibe = ${JSON.stringify(vibe)}\nvibe_pin_manifest = ${JSON.stringify(path.join(parent, 'vibe-pin-manifest.json'))}\n`, { mode: 0o600 });
    const env = { ...(process.env as Record<string, string>), VIBE_SUPERVISOR_HOME: data };

    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'serve', '--stdio', '--isolated'], env, stderr: 'pipe' });
    const client = new Client({ name: 'readiness-test', version: '1.0.0' }); clients.push(client);
    await client.connect(transport);
    const check = async (workspace: string) => JSON.parse(text(await client.callTool({ name: 'vibe_status', arguments: { workspace, operation: 'review' } }))) as Record<string, unknown> & { blockers: { code: string }[] };

    const before = await check(second);
    expect(before).toMatchObject({ eligible: false, policy_path: configPath, server_version: expect.any(String), session_id: expect.stringMatching(/^session-/) });
    expect(before.blockers.map((blocker) => blocker.code)).toEqual(['VSUP_WORKSPACE_INVALID', 'VSUP_INVALID_STATE']);
    const session = path.join(data, 'mcp-sessions', String(before.session_id));
    const snapshot = await readFile(path.join(session, 'config.toml'), 'utf8');

    await exec(process.execPath, [cli, 'allow', '--config', configPath, second], { env });
    const after = await check(second);
    expect(after).toMatchObject({ workspace_eligible: true, eligible: false, workspace: second, policy_path: configPath, session_id: before.session_id, server_instance_id: before.server_instance_id, runtime: { executable_found: true, version_verified: false } });
    expect(after.policy_revision).not.toBe(before.policy_revision);
    expect(await readFile(path.join(session, 'config.toml'), 'utf8')).toBe(snapshot);

    const altered = `${String(after.readiness_receipt).slice(0, -1)}${String(after.readiness_receipt).endsWith('A') ? 'B' : 'A'}`;
    const refused = await client.callTool({ name: 'vibe_review_start', arguments: { task: 'review', cwd: second, readiness_receipt: altered } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('VSUP_READINESS_RECEIPT_INVALID');
    const both = await client.callTool({ name: 'vibe_status', arguments: { run_id: '123e4567-e89b-42d3-a456-426614174000', workspace: second, operation: 'review' } });
    expect(both.isError).toBe(true);
    expect(await stat(marker).then(() => true, () => false)).toBe(false);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['vibe_close', 'vibe_edit_start', 'vibe_result', 'vibe_review_start', 'vibe_status']);
  });
});
