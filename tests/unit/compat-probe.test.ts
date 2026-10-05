import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..', '..');
const script = path.join(repo, 'scripts', 'compat-probe.mjs');
const SECRET = 'compat-probe-env-canary-9f3a1c';
let scratch = '';

interface Report { checks: Array<{ name: string; status: string; detail: string }>; executables: Record<string, string | null> }

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, MISTRAL_API_KEY: SECRET, COMPAT_PROBE_CANARY: SECRET },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
function statusOf(report: Report, name: string): string | undefined { return report.checks.find((entry) => entry.name === name)?.status; }

beforeAll(async () => {
  try { await access(path.join(repo, 'dist', 'backends', 'acp.js')); }
  catch { spawnSync('npm', ['run', 'build'], { cwd: repo, encoding: 'utf8', timeout: 180_000 }); }
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'compat-probe-test-')));
}, 240_000);

afterAll(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

describe('compat-probe script', () => {
  it('prints help', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--vibe-acp');
    expect(result.stdout).toContain('--out');
  });

  it('fails check 1 with valid JSON, skips dependents, marks manual checks, and leaks no environment values', () => {
    const result = run(['--vibe', path.join(scratch, 'missing-vibe'), '--vibe-acp', path.join(scratch, 'missing-vibe-acp')]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as Report;
    expect(statusOf(report, 'vibe_cli_version')).toBe('FAIL');
    for (const name of ['acp_initialize', 'acp_load_session_advertised', 'launcher_logger_fixture']) expect(statusOf(report, name)).toBe('SKIPPED');
    for (const name of ['tool_path_resolver', 'effective_tool_inventory', 'hosted_inference']) expect(statusOf(report, name)).toBe('MANUAL');
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  });

  it('fails closed when the ACP peer reports a different version', async () => {
    const vibe = path.join(scratch, 'vibe');
    const vibeAcp = path.join(scratch, 'vibe-acp');
    const python = path.join(scratch, 'fake-python');
    await writeFile(vibe, '#!/bin/sh\necho "vibe 2.25.8"\n');
    await writeFile(vibeAcp, '#!/usr/bin/env python3\n');
    await writeFile(python, [
      '#!/bin/sh',
      'read line || exit 1',
      'id=$(printf "%s" "$line" | sed -n \'s/.*"id":\\([0-9]*\\).*/\\1/p\')',
      'printf \'{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentInfo":{"name":"vibe","version":"9.9.9"},"agentCapabilities":{"loadSession":false}}}\\n\' "$id"',
      'sleep 30',
      '',
    ].join('\n'));
    await Promise.all([vibe, vibeAcp, python].map((file) => chmod(file, 0o755)));
    const result = run(['--vibe', vibe, '--vibe-acp', vibeAcp, '--python', python]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as Report;
    expect(statusOf(report, 'vibe_cli_version')).toBe('PASS');
    expect(statusOf(report, 'acp_initialize')).toBe('FAIL');
    expect(statusOf(report, 'acp_load_session_advertised')).toBe('SKIPPED');
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  }, 90_000);
});
