import { execSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AntigravityBackend, type AntigravityHandle } from '../../src/backends/antigravity.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import type { BackendCallbacks, StartRunInput, SupervisorError, UsageState } from '../../src/contracts.js';
import { exportReport, OUTSIDE_WORKSPACE } from '../../src/reporting/export.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-antigravity-test-'));
  roots.push(root);
  return root;
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function waitFor<T>(read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

describe('AntigravityBackend', () => {
  it('probes executable version, runtimeCheck, and preparationCheck', async () => {
    const root = await makeRoot();
    const counter = path.join(root, 'count');
    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo x >> "${counter}"
  echo "agy 1.3.1 (antigravity-darwin-arm64)"
  exit 0
fi
exit 1
`);

    const backend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: script }
    });

    const probeResult = await backend.probe();
    expect(probeResult.available).toBe(true);
    expect(probeResult.backend).toBe('antigravity');
    expect(probeResult.version).toBe('1.3.1');

    const runtimeCheck = await backend.runtimeCheck();
    expect(runtimeCheck.executable_found).toBe(true);
    expect(runtimeCheck.pinned_version).toBe('1.3.1');

    const prep = await backend.preparationCheck();
    expect(['passed', 'missing']).toContain(prep.status);
  });

  it('reports unavailable when executable does not exist', async () => {
    const backend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: '/nonexistent/path/to/agy' }
    });

    const probeResult = await backend.probe();
    expect(probeResult.available).toBe(false);
    expect(probeResult.backend).toBe('antigravity');

    const runtimeCheck = await backend.runtimeCheck();
    expect(runtimeCheck.executable_found).toBe(false);
  });

  it('runs a review task with --mode plan, isolated settings.json, envelope parsing, secret redaction, and cleanup', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const runDir = path.join(root, 'run');
    await mkdir(workspace);
    await mkdir(runDir);
    await writeFile(path.join(workspace, 'sample.ts'), 'export const x = 1;\n');

    const script = path.join(root, 'mock-agy.sh');
    const recordedArgsFile = path.join(root, 'recorded-args.json');
    const recordedSettingsFile = path.join(root, 'recorded-settings.json');

    await writeExecutable(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('agy 1.3.1');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(recordedArgsFile)}, JSON.stringify(args));
const settingsPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'settings.json');
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, ${JSON.stringify(recordedSettingsFile)});
}
console.log(JSON.stringify({ type: 'message', role: 'assistant', text: 'Analyzing repository... ' }));
console.log(JSON.stringify({ type: 'thought', reasoning: 'Internal private reasoning that must not leak' }));
console.log(JSON.stringify({
  status: 'SUCCESS',
  response: 'Bearer secret_token_1234567890abcdef is used.',
  num_turns: 2,
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  denied_actions: [{ tool: 'run_command', reason: 'sandbox_denied' }]
}));
process.exit(0);
`);

    const backend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: script }
    });

    const events: Array<Parameters<BackendCallbacks['onEvent']>[0]> = [];
    let finalState: string | undefined;
    let finalSummary: string | undefined;
    let finalUsage: UsageState | undefined;

    const callbacks: BackendCallbacks = {
      onEvent(event) { events.push(event); },
      onState(state, update) {
        finalState = state;
        if (update?.result?.summary) finalSummary = update.result.summary;
        if (update?.usage) finalUsage = update.usage;
      }
    };

    const input: StartRunInput = {
      runId: '11111111-2222-4333-8444-555555555555',
      mode: 'review',
      task: 'Review the security module',
      cwd: workspace,
      workerWorkspace: workspace,
      runDirectory: runDir,
      contextFiles: ['sample.ts'],
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    expect(result.initialState).toBe('running');

    await (result.handle as AntigravityHandle).opaque.process.done;
    await waitFor(() => finalState, (state) => state === 'completed');

    expect(finalState).toBe('completed');
    expect(finalSummary).toContain('Analyzing repository');
    expect(finalSummary).toContain('[REDACTED]');
    expect(finalSummary).not.toContain('secret_token');
    expect(finalSummary).not.toContain('Internal private reasoning');
    expect(finalUsage).toEqual({
      tokensUsed: 150,
      promptTokens: 120,
      completionTokens: 30,
      modelCalls: 2,
      toolCalls: { executed: 0, deniedByHandler: 0, deniedByPolicy: 1 }
    });

    const deniedEvents = events.filter((e) => e.type === 'tool_denied');
    expect(deniedEvents).toHaveLength(1);
    expect(deniedEvents[0]?.data).toMatchObject({ tool: 'run_command', reason: 'sandbox_denied' });

    const recordedArgs = JSON.parse(await readFile(recordedArgsFile, 'utf8')) as string[];
    expect(recordedArgs).toContain('--mode');
    expect(recordedArgs).toContain('plan');
    expect(recordedArgs).toContain('--output-format');
    expect(recordedArgs).toContain('stream-json');
    expect(recordedArgs).toContain('--disable-slash-commands');
    expect(recordedArgs).toContain('--sandbox');
    expect(recordedArgs).toContain('--print-timeout');
    expect(recordedArgs).toContain('30s');
    expect(recordedArgs).not.toContain('--cwd');
    expect(recordedArgs).not.toContain('--dangerously-skip-permissions');
    // Prompt includes the workspace file listing for review mode
    expect(recordedArgs[1]).toContain('sample.ts');

    const settings = JSON.parse(await readFile(recordedSettingsFile, 'utf8'));
    expect(settings.toolPermission).toBe('strict');
    expect(settings.allowNonWorkspaceAccess).toBe(false);
    expect(settings.enableTerminalSandbox).toBe(true);
    expect(settings.permissions.allow).toContain('read_file');
    expect(settings.permissions.allow).not.toContain('write_file');
    expect(settings.permissions.deny).toContain('run_command');

    // Verify private childHome and childTmp were cleaned up after completion
    await expect(lstat(path.join(runDir, 'antigravity-home'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(runDir, 'antigravity-tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('runs an edit task with --mode accept-edits and write tools in isolated settings', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const runDir = path.join(root, 'run');
    await mkdir(workspace);
    await mkdir(runDir);

    const script = path.join(root, 'mock-agy.sh');
    const recordedArgsFile = path.join(root, 'recorded-args.json');
    const recordedSettingsFile = path.join(root, 'recorded-settings.json');

    await writeExecutable(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('agy 1.3.1');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(recordedArgsFile)}, JSON.stringify(args));
const settingsPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'settings.json');
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, ${JSON.stringify(recordedSettingsFile)});
}
console.log(JSON.stringify({ status: 'SUCCESS', response: 'Edit applied.' }));
process.exit(0);
`);

    const backend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: script }
    });

    const callbacks: BackendCallbacks = {
      onEvent() {},
      onState() {}
    };

    const input: StartRunInput = {
      runId: '22222222-3333-4444-8555-666666666666',
      mode: 'edit',
      task: 'Fix the bug in add.js',
      cwd: workspace,
      workerWorkspace: workspace,
      runDirectory: runDir,
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;

    const recordedArgs = JSON.parse(await readFile(recordedArgsFile, 'utf8'));
    expect(recordedArgs).toContain('--mode');
    expect(recordedArgs).toContain('accept-edits');

    const settings = JSON.parse(await readFile(recordedSettingsFile, 'utf8'));
    expect(settings.permissions.allow).toContain('write_file');
    expect(settings.permissions.allow).toContain('edit_file');
  });

  it('fails closed when envelope status is ERROR even if exit code is 0, or on non-zero exit', async () => {
    const root = await makeRoot();
    const script = path.join(root, 'mock-agy.sh');

    await writeExecutable(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('agy 1.3.1');
  process.exit(0);
}
console.log(JSON.stringify({ status: 'ERROR', response: 'Control request rejected' }));
process.exit(0);
`);

    const backend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: script }
    });

    let failedState: string | undefined;
    let failureError: SupervisorError | undefined;

    const callbacks: BackendCallbacks = {
      onEvent() {},
      onState(state, update) {
        if (state === 'failed') {
          failedState = state;
          failureError = update?.error;
        }
      }
    };

    const input: StartRunInput = {
      runId: '33333333-4444-4555-8666-777777777777',
      mode: 'review',
      task: 'Check envelope error',
      cwd: root,
      workerWorkspace: root,
      runDirectory: root,
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;
    await waitFor(() => failedState, (state) => state === 'failed');

    expect(failedState).toBe('failed');
    expect(failureError?.code).toBe('VSUP_ANTIGRAVITY_EXEC_FAILED');
    expect(failureError?.message).toContain('ERROR');
  });

  it('rejects workspaces containing untrusted .gemini or .agents/hooks.json', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(path.join(workspace, '.agents'), { recursive: true });
    await writeFile(path.join(workspace, '.agents', 'hooks.json'), '{}');

    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/bin/sh
echo "agy 1.3.1"
exit 0
`);

    const backend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: script }
    });

    const input: StartRunInput = {
      runId: '44444444-5555-4666-8777-888888888888',
      mode: 'review',
      task: 'Should reject workspace hooks',
      cwd: workspace,
      workerWorkspace: workspace,
      runDirectory: root,
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    await expect(backend.start(input, { onEvent() {}, onState() {} })).rejects.toThrow(/\.agents\/hooks\.json/);
  });

  it('integrates with RunManager when backend="antigravity" is configured', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const dataDir = path.join(root, 'data');
    await writeFile(path.join(root, 'mock-agy.sh'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('agy 1.3.1');
  process.exit(0);
}
console.log(JSON.stringify({ status: 'SUCCESS', response: 'All security checks verified.' }));
process.exit(0);
`);
    const script = path.join(root, 'mock-agy.sh');
    await chmod(script, 0o755);

    await mkdir(workspace);
    await writeFile(path.join(workspace, 'index.js'), 'console.log("hello");\n');

    const config = {
      ...DEFAULT_CONFIG,
      backend: 'antigravity' as const,
      allowedWorkspaceRoots: [workspace],
      paths: { antigravity: script }
    };

    const manager = new RunManager(config, dataDir);
    await manager.initialize();

    const start = await manager.reviewStart({
      task: 'Verify workspace',
      cwd: workspace,
      wait_seconds: 5
    });

    expect(start.backend).toBe('antigravity');
    expect(start.state).toBe('completed');

    const result = await manager.result({ run_id: start.run_id });
    expect(result.backend).toBe('antigravity');
    expect(result.state).toBe('completed');
    expect(result.summary).toContain('All security checks verified.');

    await manager.shutdown();
  });

  it('filters excluded files from review prompt workspace listing and populates settings.json permissions.deny', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const runDir = path.join(root, 'run');
    await mkdir(workspace);
    await mkdir(runDir);

    await writeFile(path.join(workspace, 'sample.ts'), 'export const x = 1;\n');
    await writeFile(path.join(workspace, 'secret.txt'), 'SUPER_SECRET=123\n');
    execSync('git init && git config user.name "Test" && git config user.email "test@example.com" && git add .', {
      cwd: workspace,
      stdio: 'ignore'
    });

    const script = path.join(root, 'mock-agy.sh');
    const recordedArgsFile = path.join(root, 'recorded-args.json');
    const recordedSettingsFile = path.join(root, 'recorded-settings.json');

    await writeExecutable(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('agy 1.3.1');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(recordedArgsFile)}, JSON.stringify(args));
const settingsPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'settings.json');
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, ${JSON.stringify(recordedSettingsFile)});
}
console.log(JSON.stringify({ status: 'SUCCESS', response: 'ok' }));
process.exit(0);
`);

    const backend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: script }
    });

    const callbacks: BackendCallbacks = {
      onEvent() {},
      onState() {}
    };

    const input: StartRunInput = {
      runId: '55555555-6666-4777-8888-999999999999',
      mode: 'review',
      task: 'Review files with exclusions',
      cwd: workspace,
      workerWorkspace: workspace,
      runDirectory: runDir,
      exclusions: [{ root: workspace, globs: ['secret.txt'] }],
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;

    const recordedArgs = JSON.parse(await readFile(recordedArgsFile, 'utf8')) as string[];
    const prompt = recordedArgs[1] ?? '';
    expect(prompt).toContain('sample.ts');
    expect(prompt).not.toContain('secret.txt');

    const settings = JSON.parse(await readFile(recordedSettingsFile, 'utf8'));
    expect(settings.permissions.deny).toContain('secret.txt');
    expect(settings.permissions.deny).toContain(`${workspace}/secret.txt`);
    expect(settings.permissions.deny).toContain('.git/**');
    expect(settings.permissions.deny).toContain('.gemini/**');
    expect(settings.permissions.deny).toContain('.env*');
  });

  it('pre-tool hook invoked via hooks.json approves valid reads and denies excluded, outside, reserved, and unprofiled tools', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const runDir = path.join(root, 'run');
    await mkdir(workspace);
    await mkdir(runDir);

    await writeFile(path.join(workspace, 'sample.ts'), 'export const a = 1;\n');
    await writeFile(path.join(workspace, 'secret.txt'), 'secret data\n');
    const hookResultsFile = path.join(root, 'hook-results.json');

    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('agy 1.3.1');
  process.exit(0);
}
const hooksJsonPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'hooks.json');
const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
const hookCommand = hooksConfig['supervisor-policy-gate'].PreToolUse[0].hooks[0].command;

const testCalls = [
  { name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, 'sample.ts'))} } },
  { name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, 'secret.txt'))} } },
  { name: 'read_file', args: { path: '/outside/workspace/file.txt' } },
  { name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, '.gemini', 'config.json'))} } },
  { name: 'write_file', args: { path: ${JSON.stringify(path.join(workspace, 'sample.ts'))}, content: 'illegal' } }
];

const results = [];
for (let i = 0; i < testCalls.length; i++) {
  const call = testCalls[i];
  const payload = JSON.stringify({
    toolCall: { name: call.name, args: call.args },
    stepIdx: i + 1,
    conversationId: 'conv-123'
  });
  try {
    const out = execSync(hookCommand, { input: payload, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
    results.push(JSON.parse(out.trim()));
  } catch (err) {
    results.push({ error: String(err) });
  }
}
fs.writeFileSync(${JSON.stringify(hookResultsFile)}, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ status: 'SUCCESS', response: 'Executed all hook test calls.' }));
process.exit(0);
`);

    const backend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: script }
    });

    const events: Array<Parameters<BackendCallbacks['onEvent']>[0]> = [];
    let finalState: string | undefined;
    let finalUsage: UsageState | undefined;

    const callbacks: BackendCallbacks = {
      onEvent(e) { events.push(e); },
      onState(state, update) {
        finalState = state;
        if (update?.usage) finalUsage = update.usage;
      }
    };

    const input: StartRunInput = {
      runId: '66666666-7777-4888-8999-000000000000',
      mode: 'review',
      task: 'Verify hook checks',
      cwd: workspace,
      workerWorkspace: workspace,
      runDirectory: runDir,
      exclusions: [{ root: workspace, globs: ['secret.txt'] }],
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;
    await waitFor(() => finalState, (state) => state === 'completed');

    const hookResults = JSON.parse(await readFile(hookResultsFile, 'utf8'));
    expect(hookResults).toHaveLength(5);
    expect(hookResults[0]).toEqual({ decision: 'allow' });
    expect(hookResults[1]).toEqual({ decision: 'deny', reason: 'path_excluded' });
    expect(hookResults[2]).toEqual({ decision: 'deny', reason: 'path_outside_workspace' });
    expect(hookResults[3]).toEqual({ decision: 'deny', reason: 'path_reserved' });
    expect(hookResults[4]).toEqual({ decision: 'deny', reason: 'tool_not_in_profile' });

    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0]?.data).toMatchObject({ tool: 'read_file' });

    const toolDeniedEvents = events.filter((e) => e.type === 'tool_denied');
    expect(toolDeniedEvents).toHaveLength(4);
    expect(toolDeniedEvents.map((e) => e.data.reason)).toEqual([
      'path_excluded',
      'path_outside_workspace',
      'path_reserved',
      'tool_not_in_profile'
    ]);

    expect(finalUsage?.toolCalls).toEqual({
      executed: 1,
      deniedByHandler: 4,
      deniedByPolicy: 0
    });
  });

  it('integrates RunManager with exportReport to write approvals.json, populate tool_calls, and redact out-of-workspace paths', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const dataDir = path.join(root, 'data');
    await mkdir(workspace);
    await mkdir(dataDir);

    await writeFile(path.join(workspace, 'sample.txt'), 'hello from workspace\n');

    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('agy 1.3.1');
  process.exit(0);
}
const hooksJsonPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'hooks.json');
const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
const hookCommand = hooksConfig['supervisor-policy-gate'].PreToolUse[0].hooks[0].command;

// Call 1: valid in-workspace file
execSync(hookCommand, {
  input: JSON.stringify({
    toolCall: { name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, 'sample.txt'))} } },
    stepIdx: 1
  }),
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'inherit']
});

// Call 2: outside-workspace path
execSync(hookCommand, {
  input: JSON.stringify({
    toolCall: { name: 'read_file', args: { path: '/outside/workspace/secret.key' } },
    stepIdx: 2
  }),
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'inherit']
});

console.log(JSON.stringify({ status: 'SUCCESS', response: 'Completed e2e run with approvals.' }));
process.exit(0);
`);

    const config = {
      ...DEFAULT_CONFIG,
      backend: 'antigravity' as const,
      allowedWorkspaceRoots: [workspace],
      paths: { antigravity: script }
    };

    const manager = new RunManager(config, dataDir);
    await manager.initialize();

    const start = await manager.reviewStart({
      task: 'E2E export test',
      cwd: workspace,
      wait_seconds: 5
    });

    expect(start.backend).toBe('antigravity');
    expect(start.state).toBe('completed');

    const runDir = path.join(dataDir, 'runs', start.run_id);
    const approvalsPath = path.join(runDir, 'artifacts', 'approvals.json');
    const approvalsContent = JSON.parse(await readFile(approvalsPath, 'utf8'));
    expect(approvalsContent.run_id).toBe(start.run_id);
    expect(approvalsContent.records).toHaveLength(2);
    expect(approvalsContent.records[0]).toMatchObject({ decision: 'approve' });
    expect(approvalsContent.records[1]).toMatchObject({ decision: 'deny' });

    const result = await manager.result({ run_id: start.run_id, detail: 'full' });
    expect((result.usage as Record<string, unknown> | undefined)?.tool_calls).toEqual({
      executed: 1,
      denied_by_handler: 1,
      denied_by_policy: 0
    });

    const exportBundle = path.join(root, 'exported-bundle');
    const exportResult = await exportReport({ directory: runDir, output: exportBundle });
    expect(exportResult.files).toContain('approvals.json');

    const exportedApprovals = JSON.parse(await readFile(path.join(exportBundle, 'approvals.json'), 'utf8'));
    expect(exportedApprovals.records).toHaveLength(2);
    expect(exportedApprovals.records[0].path).toBe('sample.txt');
    expect(exportedApprovals.records[1].path).toBe(OUTSIDE_WORKSPACE);

    await manager.shutdown();
  });
});
