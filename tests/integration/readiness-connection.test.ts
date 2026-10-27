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
    const client = new Client({ name: 'readiness-test', version: '0.0.1' }); clients.push(client);
    await client.connect(transport);
    const check = async (workspace: string) => JSON.parse(text(await client.callTool({ name: 'vibe_status', arguments: { workspace, operation: 'review' } }))) as Record<string, unknown> & { blockers: { code: string }[] };

    const before = await check(second);
    expect(before.supervisor_runtime).toEqual({ node: process.version, executable: await realpath(process.execPath), platform: process.platform, arch: process.arch });
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
    const refused = await client.callTool({ name: 'vibe_review_start', arguments: { task: 'review', cwd: second, readiness_receipt: altered, authorization_id: '123e4567-e89b-42d3-a456-426614174001', attempt_id: '123e4567-e89b-42d3-a456-426614174002' } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('VSUP_READINESS_RECEIPT_INVALID');
    const both = await client.callTool({ name: 'vibe_status', arguments: { run_id: '123e4567-e89b-42d3-a456-426614174000', workspace: second, operation: 'review' } });
    expect(both.isError).toBe(true);
    expect(await stat(marker).then(() => true, () => false)).toBe(false);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['vibe_close', 'vibe_edit_start', 'vibe_result', 'vibe_review_start', 'vibe_status']);
  });

  it('locates preparation receipt in selected nondefault config directory over --isolated stdio connection and refuses stale evidence', async () => {
    const parent = await mkdtemp(path.join(canonicalTmp, 'vsup-prep-readiness-')); scratch.push(parent);
    const customConfigDir = path.join(parent, 'custom-config');
    const workspace = path.join(parent, 'workspace');
    await mkdir(customConfigDir, { mode: 0o700 });
    await mkdir(workspace, { mode: 0o700 });
    await exec('git', ['init', '-b', 'main', workspace]);
    await exec('git', ['config', 'user.name', 'Test User'], { cwd: workspace });
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace });
    await writeFile(path.join(workspace, 'file.txt'), 'hello\n');
    await exec('git', ['add', '.'], { cwd: workspace });
    await exec('git', ['commit', '-m', 'initial'], { cwd: workspace });

    const mockAgy = path.join(parent, 'mock-agy.sh');
    await writeFile(mockAgy, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('1.4.0');
  process.exit(0);
}
const promptIdx = args.indexOf('-p');
const promptVal = promptIdx >= 0 ? args[promptIdx + 1] : '';
if (promptVal === '/config' || promptVal === '/hooks' || promptVal === '/permissions' || promptVal === '/skills' || promptVal === '/agents') {
  const settingsPath = path.join(process.env.HOME || '', '.gemini', 'antigravity-cli', 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  const hooksPath = path.join(process.env.HOME || '', '.gemini', 'config', 'hooks.json');
  const hooks = fs.existsSync(hooksPath) ? JSON.parse(fs.readFileSync(hooksPath, 'utf8')) : {};
  if (promptVal === '/config') {
    console.log(JSON.stringify({ status: 'SUCCESS', command: { name: 'config', data: { config: settings } } }));
  } else if (promptVal === '/hooks') {
    console.log(JSON.stringify({ status: 'SUCCESS', command: { name: 'hooks', data: { hooks: Object.keys(hooks).map((name) => ({ name, enabled: true, events: [{ event: 'PreToolUse', matcher: '*', count: 1 }] })) } } }));
  } else if (promptVal === '/permissions') {
    const perms = settings.permissions || { allow: [], deny: [] };
    console.log(JSON.stringify({ status: 'SUCCESS', command: { name: 'permissions', data: { permissions: [{ scope: 'global', allow: perms.allow, deny: perms.deny }] } } }));
  } else if (promptVal === '/skills') {
    console.log(JSON.stringify({ status: 'SUCCESS', command: { name: 'skills', data: { skills: [] } } }));
  } else if (promptVal === '/agents') {
    console.log(JSON.stringify({ status: 'SUCCESS', command: { name: 'agents', data: { agents: [] } } }));
  }
  process.exit(0);
}
const probe = require('node:child_process').spawnSync(process.execPath, [${JSON.stringify(path.join(repo, 'tests', 'fixtures', 'fake-agy.mjs'))}, ...args], { stdio: 'inherit' });
process.exit(probe.status ?? 1);
`, { mode: 0o755 });

    const configPath = path.join(customConfigDir, 'config.toml');
    await writeFile(configPath, `version = 1
allowed_workspace_roots = [${JSON.stringify(workspace)}]
backend = "antigravity"
[experimental]
antigravity = true
[paths]
antigravity = ${JSON.stringify(mockAgy)}
`, { mode: 0o600 });

    // Prepare once in the nondefault config directory
    const kitDir = path.join(parent, 'kit');
    await mkdir(kitDir, { mode: 0o700 });
    const { candidateIdentity } = await import('../../src/preparation/evidence.js');
    const { digest } = await import('../../src/acceptance/schema.js');
    const installedRoot = path.dirname(path.dirname(cli));
    const candidate = await candidateIdentity(installedRoot);
    const scriptContent = await readFile(path.join(repo, 'scripts/v2-conformance-check.mjs'));
    const scriptHash = digest(scriptContent);
    await writeFile(path.join(kitDir, 'v2-conformance-check.mjs'), scriptContent);
    await writeFile(path.join(kitDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      version: '2.1.0',
      candidate_sha256: candidate,
      script_sha256: scriptHash
    }));

    const prepResult = await exec(process.execPath, [cli, 'prepare', 'check', '--config', configPath, '--kit', kitDir]);
    expect(JSON.parse(prepResult.stdout.trim())).toMatchObject({ status: 'passed' });

    const receiptFile = path.join(customConfigDir, 'preparation-receipt.json');
    expect(await stat(receiptFile).then(() => true, () => false)).toBe(true);

    // Launch server over isolated stdio connection with --config pointing to the custom config
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'serve', '--stdio', '--config', configPath, '--isolated'],
      env: process.env as Record<string, string>,
      stderr: 'pipe'
    });
    const client = new Client({ name: 'isolated-prep-readiness-test', version: '0.0.1' });
    clients.push(client);
    await client.connect(transport);

    const check = async (operation: 'review' | 'edit') =>
      JSON.parse(text(await client.callTool({ name: 'vibe_status', arguments: { workspace, operation } }))) as Record<string, unknown> & {
        eligible: boolean;
        workspace_eligible: boolean;
        preparation: { status: string; candidate_sha256?: string };
        blockers: { code: string }[];
      };

    // Review readiness must find the receipt in customConfigDir and pass
    const reviewReady = await check('review');
    expect(reviewReady.preparation.status).toBe('passed');
    expect(reviewReady.workspace_eligible).toBe(true);
    expect(reviewReady.eligible).toBe(true);
    expect(reviewReady.blockers).toEqual([]);

    // Edit readiness must find the receipt in customConfigDir and pass
    const editReady = await check('edit');
    expect(editReady.preparation.status).toBe('passed');
    expect(editReady.workspace_eligible).toBe(true);
    expect(editReady.eligible).toBe(true);
    expect(editReady.blockers).toEqual([]);

    // Stale evidence refusal: corrupt the receipt identity
    const receiptData = JSON.parse(await readFile(receiptFile, 'utf8'));
    receiptData.identity = '0'.repeat(64);
    await writeFile(receiptFile, JSON.stringify(receiptData));

    const staleReady = await check('review');
    expect(staleReady.eligible).toBe(false);
    expect(staleReady.preparation.status).toBe('stale');
    expect(staleReady.blockers.map((b) => b.code)).toContain('VSUP_INVALID_STATE');

    // Missing receipt refusal
    await rm(receiptFile);
    const missingReady = await check('review');
    expect(missingReady.eligible).toBe(false);
    expect(missingReady.preparation.status).toBe('missing');
    expect(missingReady.blockers.map((b) => b.code)).toContain('VSUP_INVALID_STATE');
  });
});
