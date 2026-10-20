import { execSync } from 'node:child_process';
import { appendFile, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AntigravityBackend,
  SUPPORTED_ANTIGRAVITY_VERSION,
  type AntigravityBackendOptions,
  type AntigravityHandle
} from '../../src/backends/antigravity.js';
import { evaluateAntigravityToolCall, readAntigravityHookLedger } from '../../src/backends/antigravity-hook.js';
import * as reaperModule from '../../src/process/reaper.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import type { BackendCallbacks, StartRunInput, SupervisorError, UsageState } from '../../src/contracts.js';
import { runDoctor } from '../../src/diagnostics/doctor.js';
import { runAntigravityPreparationCheck } from '../../src/preparation/antigravity-prepare.js';
import { AGY_PROBE_PROMPT } from '../../src/preparation/antigravity-probes.js';
import { exportReport, OUTSIDE_WORKSPACE } from '../../src/reporting/export.js';
import { APP_VERSION } from '../../src/version.js';

const canonicalTmp = await realpath(tmpdir());
const fakeAgyFixture = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-agy.mjs');
const delegateAgyProbes = `if (promptVal === ${JSON.stringify(AGY_PROBE_PROMPT)}) {
  const probe = require('node:child_process').spawnSync(process.execPath, [${JSON.stringify(fakeAgyFixture)}, ...args], { stdio: 'inherit' });
  process.exit(probe.status ?? 1);
}`;
const roots: string[] = [];

const passedPreparation: AntigravityBackendOptions = {
  preparation: {
    check: async () => ({
      status: 'passed',
      candidate_sha256: 'a'.repeat(64),
      version: APP_VERSION,
      reason: 'test'
    })
  }
};

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

describe('AntigravityBackend (agy 1.4.0)', () => {
  it('probes executable version 1.4.0, binary sha256, runtimeCheck, requires preparation receipt by default, and rejects unsupported versions', async () => {
    const root = await makeRoot();
    const counter = path.join(root, 'count');
    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo x >> "${counter}"
  echo "${SUPPORTED_ANTIGRAVITY_VERSION}"
  exit 0
fi
exit 1
`);

    const prevHome = process.env.VIBE_SUPERVISOR_HOME;
    process.env.VIBE_SUPERVISOR_HOME = path.join(root, 'unprepared-home');
    try {
      const backend = new AntigravityBackend({
        ...DEFAULT_CONFIG,
        backend: 'antigravity',
        paths: { antigravity: script }
      });

      const probeResult = await backend.probe();
      expect(probeResult.available).toBe(true);
      expect(probeResult.backend).toBe('antigravity');
      expect(probeResult.version).toBe('1.4.0');
      expect(typeof probeResult.details?.sha256).toBe('string');

      const runtimeCheck = await backend.runtimeCheck();
      expect(runtimeCheck.executable_found).toBe(true);
      expect(runtimeCheck.pinned_version).toBe('1.4.0');
      expect(runtimeCheck.version_verified).toBe(false);

      // Without preparation-receipt.json, preparationCheck MUST return missing (never fallback to passed)
      const prep = await backend.preparationCheck();
      expect(prep.status).toBe('missing');

      await expect(
        backend.start(
          {
            runId: '00000000-1111-4222-8333-444444444444',
            mode: 'review',
            task: 'Must fail without preparation receipt',
            cwd: root,
            workerWorkspace: root,
            runDirectory: root,
            exclusions: [],
            limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
          },
          { onEvent() {}, onState() {} }
        )
      ).rejects.toMatchObject({
        code: 'VSUP_INVALID_STATE',
        details: { preparation: { status: 'missing' } }
      });
    } finally {
      if (prevHome === undefined) delete process.env.VIBE_SUPERVISOR_HOME;
      else process.env.VIBE_SUPERVISOR_HOME = prevHome;
    }

    // Unsupported version fails closed
    const wrongScript = path.join(root, 'mock-agy-old.sh');
    await writeExecutable(wrongScript, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "1.3.1"
  exit 0
fi
exit 1
`);
    const wrongBackend = new AntigravityBackend({
      ...DEFAULT_CONFIG,
      backend: 'antigravity',
      paths: { antigravity: wrongScript }
    });
    const wrongProbe = await wrongBackend.probe();
    expect(wrongProbe.available).toBe(false);
    expect(wrongProbe.details?.code).toBe('VSUP_VIBE_VERSION_UNSUPPORTED');
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

  it('runs a review task with agy 1.4.0 stream-json envelopes, unified settings.json rules, secret redaction, cleanup, and distinguishes turns from modelCalls', async () => {
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
  console.log('1.4.0');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(recordedArgsFile)}, JSON.stringify(args));
const settingsPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'settings.json');
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, ${JSON.stringify(recordedSettingsFile)});
}
const hooksJsonPath = path.join(process.env.HOME, '.gemini', 'config', 'hooks.json');
if (fs.existsSync(hooksJsonPath)) {
  const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
  const hookCommand = hooksConfig['supervisor-policy-gate']?.PreToolUse?.[0]?.hooks?.[0]?.command;
  if (hookCommand) {
    const { execSync } = require('node:child_process');
    execSync(hookCommand, {
      input: JSON.stringify({
        toolCall: { name: 'view_file', args: { AbsolutePath: path.join(process.cwd(), 'sample.ts') } },
        stepIdx: 1,
        conversationId: 'conv-1'
      }),
      stdio: ['pipe', 'pipe', 'inherit']
    });
  }
}
console.log(JSON.stringify({
  event: 'init',
  conversation_id: 'conv-1',
  init: { cwd: process.cwd(), tools: ['view_file', 'list_dir', 'sed_file', 'notebook_edit'], permission_mode: 'strict' }
}));
console.log(JSON.stringify({
  event: 'step_update',
  step_update: { conversation_id: 'conv-1', step_index: 1, state: 'DONE', step_type: 'view_file', tool_name: 'view_file', args: { AbsolutePath: path.join(process.cwd(), 'sample.ts') } }
}));
console.log(JSON.stringify({
  event: 'step_update',
  step_update: { conversation_id: 'conv-1', step_index: 2, state: 'DONE', step_type: 'planner_response', content: 'Reviewing sample.ts...' }
}));
console.log(JSON.stringify({
  event: 'result',
  result: {
    conversation_id: 'conv-1',
    status: 'SUCCESS',
    response: 'Analyzing repository... Bearer secret_token_1234567890abcdef is used.',
    num_turns: 2,
    usage: { input_tokens: 120, output_tokens: 30, thinking_tokens: 15, cache_read_tokens: 40, total_tokens: 150 },
    denied_actions: [{ tool: 'run_command', reason: 'sandbox_denied' }]
  }
}));
process.exit(0);
`);

    const backend = new AntigravityBackend(
      {
        ...DEFAULT_CONFIG,
        backend: 'antigravity',
        paths: { antigravity: script }
      },
      passedPreparation
    );

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
      exclusions: [],
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
    // Note: num_turns is 2, while planner_response model call steps is 1 -> modelCalls is 1 (distinguished from num_turns!)
    expect(finalUsage).toEqual({
      tokensUsed: 150,
      promptTokens: 120,
      completionTokens: 30,
      cachedTokens: 40,
      modelCalls: 1,
      toolCalls: { executed: 1, deniedByHandler: 0, deniedByPolicy: 1 }
    });

    const deniedEvents = events.filter((e) => e.type === 'tool_denied');
    expect(deniedEvents).toHaveLength(1);
    expect(deniedEvents[0]?.data).toMatchObject({ tool: 'run_command', reason: 'sandbox_denied' });

    const reasoningDiag = events.find((e) => e.type === 'diagnostic' && e.data?.reason === 'reasoning_observation');
    expect(reasoningDiag?.data).toMatchObject({
      reason: 'reasoning_observation',
      streamed_entries: 1,
      history_entries: null,
      history_audited: false
    });

    const recordedArgs = JSON.parse(await readFile(recordedArgsFile, 'utf8')) as string[];
    // Review mode omits --mode plan so --disable-slash-commands does not emit a warning in agy 1.4.0
    expect(recordedArgs).not.toContain('--mode');
    expect(recordedArgs).toContain('--output-format');
    expect(recordedArgs).toContain('stream-json');
    expect(recordedArgs).toContain('--disable-slash-commands');
    expect(recordedArgs).toContain('--sandbox');
    expect(recordedArgs).toContain('--print-timeout');
    expect(recordedArgs).toContain('30s');
    expect(recordedArgs[1]).toContain('sample.ts');

    const settings = JSON.parse(await readFile(recordedSettingsFile, 'utf8'));
    expect(settings.toolPermission).toBe('strict');
    expect(settings.allowNonWorkspaceAccess).toBe(false);
    expect(settings.enableTerminalSandbox).toBe(true);
    expect(settings.permissions.allow).toContain(`read_file(${workspace})`);
    expect(settings.permissions.allow).toContain(`read_file(${workspace}/**)`);
    expect(settings.permissions.allow).not.toContain(`write_file(${workspace})`);
    expect(settings.permissions.deny).toContain('command(*)');
    expect(settings.permissions.deny).toContain('mcp(*)');
    expect(settings.permissions.deny).toContain('read_url(*)');
    expect(settings.permissions.deny).toContain('execute_url(*)');
    expect(settings.permissions.deny).toContain('write_file(*)');

    await backend.close(result.handle);

    // Verify private childHome and childTmp were cleaned up after completion
    await expect(lstat(path.join(runDir, 'antigravity-home'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(runDir, 'antigravity-tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('runs an edit task with --mode accept-edits and write_file unified rules in isolated settings', async () => {
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
  console.log('1.4.0');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(recordedArgsFile)}, JSON.stringify(args));
const settingsPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'settings.json');
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, ${JSON.stringify(recordedSettingsFile)});
}
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Edit applied.' } }));
process.exit(0);
`);

    const backend = new AntigravityBackend(
      {
        ...DEFAULT_CONFIG,
        backend: 'antigravity',
        paths: { antigravity: script }
      },
      passedPreparation
    );

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
      exclusions: [],
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;

    const recordedArgs = JSON.parse(await readFile(recordedArgsFile, 'utf8'));
    expect(recordedArgs).toContain('--mode');
    expect(recordedArgs).toContain('accept-edits');

    const settings = JSON.parse(await readFile(recordedSettingsFile, 'utf8'));
    expect(settings.permissions.allow).toContain(`write_file(${workspace})`);
    expect(settings.permissions.allow).toContain(`write_file(${workspace}/**)`);
    expect(settings.permissions.deny).not.toContain('write_file(*)');
  });

  it('fails closed when nested result.status is ERROR even if exit code is 0, and rejects unsupported ceilings (maxCostUsd, maxTokens) before dispatch', async () => {
    const root = await makeRoot();
    const script = path.join(root, 'mock-agy.sh');

    await writeExecutable(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('1.4.0');
  process.exit(0);
}
console.log(JSON.stringify({
  event: 'result',
  result: { status: 'ERROR', error: 'print-timeout exceeded (2s)', response: '' }
}));
process.exit(0);
`);

    const backend = new AntigravityBackend(
      {
        ...DEFAULT_CONFIG,
        backend: 'antigravity',
        paths: { antigravity: script }
      },
      passedPreparation
    );

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
      exclusions: [],
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;
    await waitFor(() => failedState, (state) => state === 'failed');

    expect(failedState).toBe('failed');
    expect(failureError?.code).toBe('VSUP_ANTIGRAVITY_EXEC_FAILED');
    expect(failureError?.message).toContain('print-timeout exceeded');

    // Verify maxCostUsd is rejected before dispatch with price_unavailable
    await expect(
      backend.start(
        {
          ...input,
          runId: '33333333-4444-4555-8666-777777777778',
          limits: { ...input.limits, maxCostUsd: 1.5 }
        },
        { onEvent() {}, onState() {} }
      )
    ).rejects.toMatchObject({
      code: 'VSUP_BACKEND_ERROR',
      details: { reason: 'price_unavailable', ceiling_usd: 1.5 }
    });

    // Verify maxTokens is rejected before dispatch with token_ceiling_unsupported
    await expect(
      backend.start(
        {
          ...input,
          runId: '33333333-4444-4555-8666-777777777779',
          limits: { ...input.limits, maxTokens: 5000 }
        },
        { onEvent() {}, onState() {} }
      )
    ).rejects.toMatchObject({
      code: 'VSUP_BACKEND_ERROR',
      details: { reason: 'token_ceiling_unsupported', ceiling_tokens: 5000 }
    });
  });

  it('enforces turn and model-call limits during execution and terminates the worker immediately upon breach', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const runDir = path.join(root, 'run');
    await mkdir(workspace);
    await mkdir(runDir);

    const script = path.join(root, 'mock-agy-loop.sh');
    await writeExecutable(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('1.4.0');
  process.exit(0);
}
console.log(JSON.stringify({
  event: 'step_update',
  step_update: { conversation_id: 'conv-loop', step_index: 1, state: 'DONE', step_type: 'planner_response', content: 'Step 1' }
}));
console.log(JSON.stringify({
  event: 'step_update',
  step_update: { conversation_id: 'conv-loop', step_index: 2, state: 'DONE', step_type: 'planner_response', content: 'Step 2' }
}));
console.log(JSON.stringify({
  event: 'step_update',
  step_update: { conversation_id: 'conv-loop', step_index: 3, state: 'DONE', step_type: 'planner_response', content: 'Step 3 exceeds maxTurns=2' }
}));
// Hang so only mid-execution termination settles the process promptly
setTimeout(() => process.exit(0), 30000);
`);

    const backend = new AntigravityBackend(
      {
        ...DEFAULT_CONFIG,
        backend: 'antigravity',
        paths: { antigravity: script }
      },
      passedPreparation
    );

    const events: Array<Parameters<BackendCallbacks['onEvent']>[0]> = [];
    let finalState: string | undefined;
    let stopReason: string | undefined;
    let finalUsage: UsageState | undefined;

    const callbacks: BackendCallbacks = {
      onEvent(e) { events.push(e); },
      onState(state, update) {
        finalState = state;
        if (update?.result?.stopReason) stopReason = update.result.stopReason;
        if (update?.usage) finalUsage = update.usage;
      }
    };

    const result = await backend.start(
      {
        runId: '34343434-4444-4555-8666-777777777777',
        mode: 'review',
        task: 'Test live execution limit enforcement',
        cwd: workspace,
        workerWorkspace: workspace,
        runDirectory: runDir,
        exclusions: [],
        limits: {
          timeoutSeconds: 30,
          maxTurns: 2,
          maxModelCalls: 3,
          maxEventBytes: 10240,
          maxTranscriptBytes: 10240,
          maxArtifactBytes: 10240
        }
      },
      callbacks
    );

    await (result.handle as AntigravityHandle).opaque.process.done;
    await waitFor(() => finalState, (state) => state === 'completed');

    expect(finalState).toBe('completed');
    expect(stopReason).toBe('turn_limit');
    expect(finalUsage?.modelCalls).toBe(3);
    const limitEvent = events.find((e) => e.type === 'diagnostic' && e.data?.reason === 'limit_enforced_during_execution');
    expect(limitEvent?.data).toMatchObject({
      reason: 'limit_enforced_during_execution',
      limit: 'turn_limit',
      observed_turns: 3,
      max_turns: 2
    });
  });

  it('rejects workspaces containing untrusted .gemini or .agents/hooks.json', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(path.join(workspace, '.agents'), { recursive: true });
    await writeFile(path.join(workspace, '.agents', 'hooks.json'), '{}');

    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/bin/sh
echo "1.4.0"
exit 0
`);

    const backend = new AntigravityBackend(
      {
        ...DEFAULT_CONFIG,
        backend: 'antigravity',
        paths: { antigravity: script }
      },
      passedPreparation
    );

    const input: StartRunInput = {
      runId: '44444444-5555-4666-8777-888888888888',
      mode: 'review',
      task: 'Should reject workspace hooks',
      cwd: workspace,
      workerWorkspace: workspace,
      runDirectory: root,
      exclusions: [],
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    await expect(backend.start(input, { onEvent() {}, onState() {} })).rejects.toThrow(/\.agents\/hooks\.json/);
  });

  it('filters excluded files from review prompt workspace listing and populates unified settings.json permissions.deny', async () => {
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
  console.log('1.4.0');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(recordedArgsFile)}, JSON.stringify(args));
const settingsPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'settings.json');
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, ${JSON.stringify(recordedSettingsFile)});
}
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'ok' } }));
process.exit(0);
`);

    const backend = new AntigravityBackend(
      {
        ...DEFAULT_CONFIG,
        backend: 'antigravity',
        paths: { antigravity: script }
      },
      passedPreparation
    );

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
    expect(settings.permissions.deny).toContain('read_file(secret.txt)');
    expect(settings.permissions.deny).toContain(`read_file(${workspace}/secret.txt)`);
    expect(settings.permissions.deny).toContain('read_file(.git/**)');
    expect(settings.permissions.deny).toContain('read_file(.gemini/**)');
    expect(settings.permissions.deny).toContain('read_file(.env*)');
  });

  it('pre-tool hook invoked via .gemini/config/hooks.json approves valid reads and denies excluded, outside, reserved, unprofiled tools, and turn limits', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const runDir = path.join(root, 'run');
    await mkdir(workspace);
    await mkdir(runDir);

    await writeFile(path.join(workspace, 'sample.ts'), 'export const a = 1;\n');
    await writeFile(path.join(workspace, 'secret.txt'), 'secret data\n');
    const cleanDir = path.join(workspace, 'clean');
    await mkdir(cleanDir, { recursive: true });
    await writeFile(path.join(cleanDir, 'file.txt'), 'hello');
    const hookResultsFile = path.join(root, 'hook-results.json');

    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('1.4.0');
  process.exit(0);
}
const hooksJsonPath = path.join(process.env.HOME, '.gemini', 'config', 'hooks.json');
const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
const hookCommand = hooksConfig['supervisor-policy-gate'].PreToolUse[0].hooks[0].command;

const testCalls = [
  { name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, 'sample.ts'))} }, stepIdx: 1 },
  { name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, 'secret.txt'))} }, stepIdx: 2 },
  { name: 'read_file', args: { path: '/outside/workspace/file.txt' }, stepIdx: 3 },
  { name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, '.gemini', 'config.json'))} }, stepIdx: 4 },
  { name: 'write_file', args: { path: ${JSON.stringify(path.join(workspace, 'sample.ts'))}, content: 'illegal' }, stepIdx: 5 },
  { name: 'find_by_name', args: { DirectoryPath: ${JSON.stringify(cleanDir)} }, stepIdx: 1 },
  { name: 'grep_search', args: { SearchDirectory: ${JSON.stringify(cleanDir)} }, stepIdx: 1 },
  { name: 'list_dir', args: { DirectoryPath: ${JSON.stringify(cleanDir)} }, stepIdx: 1 },
  { name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, 'sample.ts'))} }, stepIdx: 9 }
];

const results = [];
for (let i = 0; i < testCalls.length; i++) {
  const call = testCalls[i];
  const payload = JSON.stringify({
    toolCall: { name: call.name, args: call.args },
    stepIdx: call.stepIdx,
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
console.log(JSON.stringify({
  event: 'step_update',
  step_update: { step_index: 1, state: 'DONE', step_type: 'tool_call', tool_name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, 'sample.ts'))} } }
}));
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Executed all hook test calls.' } }));
process.exit(0);
`);

    const backend = new AntigravityBackend(
      {
        ...DEFAULT_CONFIG,
        backend: 'antigravity',
        paths: { antigravity: script }
      },
      passedPreparation
    );

    const events: Array<Parameters<BackendCallbacks['onEvent']>[0]> = [];
    let finalState: string | undefined;
    let finalUsage: UsageState | undefined;
    let stopReason: string | undefined;

    const callbacks: BackendCallbacks = {
      onEvent(e) { events.push(e); },
      onState(state, update) {
        finalState = state;
        if (update?.usage) finalUsage = update.usage;
        if (update?.result?.stopReason) stopReason = update.result.stopReason;
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
      limits: { timeoutSeconds: 30, maxTurns: 8, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;
    await waitFor(() => finalState, (state) => state === 'completed');

    const hookResults = JSON.parse(await readFile(hookResultsFile, 'utf8'));
    expect(hookResults).toHaveLength(9);
    expect(hookResults[0]).toEqual({ decision: 'allow' });
    expect(hookResults[1]).toEqual({ decision: 'deny', reason: 'path_excluded' });
    expect(hookResults[2]).toEqual({ decision: 'deny', reason: 'path_outside_workspace' });
    expect(hookResults[3]).toEqual({ decision: 'deny', reason: 'path_reserved' });
    expect(hookResults[4]).toEqual({ decision: 'deny', reason: 'tool_not_in_profile' });
    expect(hookResults[5]).toEqual({ decision: 'deny', reason: 'path_invalid' });
    expect(hookResults[6]).toEqual({ decision: 'deny', reason: 'path_invalid' });
    expect(hookResults[7]).toEqual({ decision: 'allow' });
    expect(hookResults[8]).toEqual({ decision: 'deny', reason: 'turn_limit_exceeded' });

    expect(stopReason).toBe('turn_limit');

    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents).toHaveLength(2);
    expect(toolCallEvents[0]?.data).toMatchObject({ tool: 'read_file' });
    expect(toolCallEvents[1]?.data).toMatchObject({ tool: 'list_dir' });

    const toolDeniedEvents = events.filter((e) => e.type === 'tool_denied');
    expect(toolDeniedEvents).toHaveLength(7);
    expect(toolDeniedEvents.map((e) => e.data.reason)).toEqual([
      'path_excluded',
      'path_outside_workspace',
      'path_reserved',
      'tool_not_in_profile',
      'path_invalid',
      'path_invalid',
      'turn_limit_exceeded'
    ]);

    expect(finalUsage?.toolCalls).toEqual({
      executed: 1,
      deniedByHandler: 7,
      deniedByPolicy: 0
    });
  });

  it('integrates RunManager with mandatory preparation, exportReport, approvals.json, pin identity, reasoning_observation, and redacts out-of-workspace paths', async () => {
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
  console.log('1.4.0');
  process.exit(0);
}
// Support zero-inference slash commands during runAntigravityPreparationCheck
const promptIdx = args.indexOf('-p');
const promptVal = promptIdx >= 0 ? args[promptIdx + 1] : '';
if (promptVal === '/config' || promptVal === '/hooks' || promptVal === '/permissions' || promptVal === '/skills' || promptVal === '/agents') {
  const settingsPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  const hooksPath = path.join(process.env.HOME, '.gemini', 'config', 'hooks.json');
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
${delegateAgyProbes}

const hooksJsonPath = path.join(process.env.HOME, '.gemini', 'config', 'hooks.json');
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

console.log(JSON.stringify({
  event: 'step_update',
  step_update: { step_index: 1, state: 'DONE', step_type: 'tool_call', tool_name: 'read_file', args: { path: ${JSON.stringify(path.join(workspace, 'sample.txt'))} } }
}));
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Completed e2e run with approvals.' } }));
process.exit(0);
`);

    const prevHome = process.env.VIBE_SUPERVISOR_HOME;
    process.env.VIBE_SUPERVISOR_HOME = dataDir;
    try {
      const config = {
        ...DEFAULT_CONFIG,
        backend: 'antigravity' as const,
        allowedWorkspaceRoots: [workspace],
        paths: { antigravity: script }
      };

      // Write mandatory preparation receipt first
      const prepCheck = await runAntigravityPreparationCheck(config, { dataDir });
      expect(prepCheck.status).toBe('passed');

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
      const exportResult = await exportReport({ directory: runDir, output: exportBundle, include: ['events'] });
      expect(exportResult.files).toContain('approvals.json');
      expect(exportResult.files).toContain('events.json');

      const exportedReport = JSON.parse(await readFile(path.join(exportBundle, 'report.json'), 'utf8'));
      expect(exportedReport.pin).toMatchObject({ vibe_version: '1.4.0' });

      const exportedApprovals = JSON.parse(await readFile(path.join(exportBundle, 'approvals.json'), 'utf8'));
      expect(exportedApprovals.records).toHaveLength(2);
      expect(exportedApprovals.records[0].path).toBe('sample.txt');
      expect(exportedApprovals.records[1].path).toBe(OUTSIDE_WORKSPACE);

      await manager.shutdown();
    } finally {
      if (prevHome === undefined) delete process.env.VIBE_SUPERVISOR_HOME;
      else process.env.VIBE_SUPERVISOR_HOME = prevHome;
    }
  });

  it('fails closed when slash commands exit nonzero (Finding 1 / exit-42 probe regression)', async () => {
    const root = await makeRoot();
    const dataDir = path.join(root, 'data');
    await mkdir(dataDir, { recursive: true });

    const script = path.join(root, 'mock-agy-exit42.sh');
    await writeExecutable(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('1.4.0');
  process.exit(0);
}
// Reproduce the exit-42 probe from independent review
process.exit(42);
`);

    const config = {
      ...DEFAULT_CONFIG,
      backend: 'antigravity' as const,
      allowedWorkspaceRoots: [root],
      paths: { antigravity: script }
    };

    const prepOut = await runAntigravityPreparationCheck(config, { dataDir });
    expect(prepOut.status).toBe('failed');
    expect(prepOut.report.result).toBe('fail');
    expect(prepOut.report.profiles.review.cli_readback_passed).toBe(false);
    expect(prepOut.report.profiles.edit.cli_readback_passed).toBe(false);
    expect(prepOut.report.findings.some((f) => f.code.includes('cli_readback'))).toBe(true);
  });

  it('executes runAntigravityPreparationCheck and runDoctor with zero model inference when slash commands succeed', async () => {
    const root = await makeRoot();
    const dataDir = path.join(root, 'data');
    await mkdir(dataDir, { recursive: true });

    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/usr/bin/env node
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
  const settingsPath = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  const hooksPath = path.join(process.env.HOME, '.gemini', 'config', 'hooks.json');
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
${delegateAgyProbes}
process.exit(1);
`);

    const config = {
      ...DEFAULT_CONFIG,
      backend: 'antigravity' as const,
      allowedWorkspaceRoots: [root],
      paths: { antigravity: script }
    };

    const prepOut = await runAntigravityPreparationCheck(config, { dataDir });
    expect(prepOut.status).toBe('passed');
    expect(prepOut.report.result).toBe('pass');
    expect(prepOut.report.profiles.review.settings_valid).toBe(true);
    expect(prepOut.report.profiles.review.hooks_valid).toBe(true);
    expect(prepOut.report.profiles.review.cli_readback_passed).toBe(true);
    expect(prepOut.report.profiles.review.synthetic_checks_passed).toBe(true);
    expect(prepOut.report.profiles.review.ledger_entries).toBe(6);
    expect(prepOut.report.profiles.edit.settings_valid).toBe(true);
    expect(prepOut.report.profiles.edit.hooks_valid).toBe(true);
    expect(prepOut.report.profiles.edit.cli_readback_passed).toBe(true);
    expect(prepOut.report.profiles.edit.synthetic_checks_passed).toBe(true);
    expect(prepOut.report.profiles.edit.ledger_entries).toBe(6);
    expect(prepOut.report.network_observation.verdict).toBe('none-observed-control-validated');

    const doctorReport = await runDoctor(config, { dataDir });
    expect(doctorReport.ok).toBe(true);
    expect(doctorReport.provenance.backend).toBe('antigravity');
    const agyCheck = doctorReport.checks.find((c) => c.name === 'antigravity');
    expect(agyCheck?.ok).toBe(true);
    expect(agyCheck?.version).toBe('1.4.0');
    expect(agyCheck?.message).toContain('sha256:');
  });

  it('fails launch and cleans up when reaper startup fails', async () => {
    const root = await makeRoot();
    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "1.4.0"; exit 0; fi
sleep 10
`);

    const backend = new AntigravityBackend(
      { ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } },
      passedPreparation
    );

    const spy = vi.spyOn(reaperModule, 'startReaper').mockRejectedValueOnce(new Error('Simulated reaper start failure'));
    try {
      await expect(
        backend.start(
          {
            runId: '22222222-3333-4444-5555-666666666666',
            runDirectory: path.join(root, 'run'),
            mode: 'review',
            task: 'test reaper failure',
            cwd: root,
            workerWorkspace: root,
            exclusions: [],
            limits: { timeoutSeconds: 10, maxTurns: 5, maxEventBytes: 1024, maxTranscriptBytes: 1024, maxArtifactBytes: 1024 }
          },
          { onEvent() {}, onState() {} }
        )
      ).rejects.toMatchObject({
        code: 'VSUP_INTERNAL',
        message: expect.stringContaining('Failed to start process reaper')
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects execution when binary digest drifts before spawn', async () => {
    const root = await makeRoot();
    const script = path.join(root, 'tamper-agy.sh');
    await writeExecutable(script, `#!/bin/sh
echo "1.4.0"
exit 0
`);

    const backend = new AntigravityBackend(
      { ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } },
      passedPreparation
    );

    // Probe records the initial digest
    await backend.probe();
    // Tamper with binary content before start
    await appendFile(script, '# tampered bytes\n');

    await expect(
      backend.start(
        {
          runId: '33333333-4444-5555-6666-777777777777',
          runDirectory: path.join(root, 'run'),
          mode: 'review',
          task: 'test tamper check',
          cwd: root,
          workerWorkspace: root,
          exclusions: [],
          limits: { timeoutSeconds: 10, maxTurns: 5, maxEventBytes: 1024, maxTranscriptBytes: 1024, maxArtifactBytes: 1024 }
        },
        { onEvent() {}, onState() {} }
      )
    ).rejects.toMatchObject({
      code: 'VSUP_ANTIGRAVITY_EXEC_FAILED',
      message: expect.stringContaining('binary digest changed')
    });
  });

  it('fails closed when process exits 0 without SUCCESS status in terminal envelope', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const script = path.join(root, 'mock-no-success.sh');
    await writeExecutable(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('1.4.0');
  process.exit(0);
}
// Exit 0 with non-SUCCESS terminal status
console.log(JSON.stringify({ event: 'result', result: { status: 'UNKNOWN_STATUS', response: 'Completed without success' } }));
process.exit(0);
`);

    const backend = new AntigravityBackend(
      { ...DEFAULT_CONFIG, backend: 'antigravity', paths: { antigravity: script } },
      passedPreparation
    );

    let finalState: string | undefined;
    let finalError: unknown;
    const callbacks: BackendCallbacks = {
      onEvent() {},
      onState(state, update) {
        finalState = state;
        if (update && 'error' in update) finalError = update.error;
      }
    };

    const result = await backend.start(
      {
        runId: '44444444-5555-6666-7777-888888888888',
        runDirectory: path.join(root, 'run'),
        mode: 'review',
        task: 'test absent success status',
        cwd: workspace,
        workerWorkspace: workspace,
        exclusions: [],
        limits: { timeoutSeconds: 10, maxTurns: 5, maxEventBytes: 1024, maxTranscriptBytes: 1024, maxArtifactBytes: 1024 }
      },
      callbacks
    );

    await (result.handle as AntigravityHandle).opaque.process.done;
    await waitFor(() => finalState, (state) => state === 'failed');

    expect(finalState).toBe('failed');
    expect(finalError).toMatchObject({
      code: 'VSUP_ANTIGRAVITY_EXEC_FAILED',
      message: expect.stringContaining('without validated terminal SUCCESS status')
    });
  });

  it('denies directory read and search at root when excludedAnchors exist', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(path.join(workspace, 'sub'), { recursive: true });
    const excludedAnchors = [{ root: workspace, glob: 'sub/**' }];

    const evalResult = await evaluateAntigravityToolCall(
      {
        mode: 'review',
        workerWorkspace: workspace,
        excludedAnchors
      },
      {
        toolCall: {
          name: 'list_dir',
          args: { DirectoryPath: workspace }
        },
        stepIdx: 1
      }
    );

    expect(evalResult.decision).toBe('deny');
    expect(evalResult.reason).toBe('path_excluded');
  });

  it('fails closed when hook ledger has corrupted JSON lines', async () => {
    const root = await makeRoot();
    const home = path.join(root, 'home');
    const cliDir = path.join(home, '.gemini', 'antigravity-cli');
    await mkdir(cliDir, { recursive: true });
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), '{ malformed json line\n');

    await expect(
      readAntigravityHookLedger(home, [], 0)
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('Corrupted approval ledger entry')
    });
  });

  it('fails closed when stream executed tool calls but hook ledger is missing audit records', async () => {
    const root = await makeRoot();
    const home = path.join(root, 'home');
    const cliDir = path.join(home, '.gemini', 'antigravity-cli');
    await mkdir(cliDir, { recursive: true });
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), '');

    await expect(
      readAntigravityHookLedger(home, [], 2)
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('Audit unavailable')
    });
  });

  it('strictly correlates executed calls to hook approvals and rejects duplicates, mismatches, and unmatched counts', async () => {
    const root = await makeRoot();
    const home = path.join(root, 'home');
    const cliDir = path.join(home, '.gemini', 'antigravity-cli');
    await mkdir(cliDir, { recursive: true });

    const approval1 = {
      callbackId: 'agy-call-1',
      relatedEntryId: 'call-1',
      turnId: '1',
      tool: 'read_file',
      path: 'sample.ts',
      fingerprint: 'fp-sample',
      decision: 'approve',
      reason: null
    };
    const approval2 = {
      callbackId: 'agy-call-2',
      relatedEntryId: 'call-2',
      turnId: '2',
      tool: 'read_file',
      path: 'sample.ts',
      fingerprint: 'fp-sample',
      decision: 'approve',
      reason: null
    };

    // 1. Hook ledger has 1 approval, but stream executed 2 identical calls -> fails (duplicate usage)
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), JSON.stringify(approval1) + '\n');
    await expect(
      readAntigravityHookLedger(home, [], 2, [
        { tool: 'read_file', callId: 'call-1', path: 'sample.ts', fingerprint: 'fp-sample' },
        { tool: 'read_file', callId: 'call-2', path: 'sample.ts', fingerprint: 'fp-sample' }
      ])
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('Audit mismatch')
    });

    // 2. Hook ledger has 2 approvals for identical calls, stream executed 2 identical calls -> succeeds
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), JSON.stringify(approval1) + '\n' + JSON.stringify(approval2) + '\n');
    const twoCallsResult = await readAntigravityHookLedger(home, [], 2, [
      { tool: 'read_file', callId: 'call-1', path: 'sample.ts', fingerprint: 'fp-sample' },
      { tool: 'read_file', callId: 'call-2', path: 'sample.ts', fingerprint: 'fp-sample' }
    ]);
    expect(twoCallsResult.toolCalls.executed).toBe(2);

    // 3. Tool mismatch rejection: callId matches, but tool name differs
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), JSON.stringify(approval1) + '\n');
    await expect(
      readAntigravityHookLedger(home, [], 1, [
        { tool: 'write_file', callId: 'call-1', path: 'sample.ts', fingerprint: 'fp-sample' }
      ])
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('does not match approved tool')
    });

    // 4. Arguments / fingerprint mismatch rejection
    await expect(
      readAntigravityHookLedger(home, [], 1, [
        { tool: 'read_file', callId: 'call-1', path: 'sample.ts', fingerprint: 'different-fp' }
      ])
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('arguments fingerprint does not match approved fingerprint')
    });

    // 5. Differing call ID and arguments fingerprint on same path -> rejects without falling back to path matching
    await writeFile(
      path.join(cliDir, 'hook-ledger.jsonl'),
      JSON.stringify({
        callbackId: 'agy-call-approved',
        relatedEntryId: 'approved-id',
        turnId: '1',
        tool: 'write_file',
        path: 'same.txt',
        fingerprint: 'fp-approved',
        decision: 'approve',
        reason: null
      }) + '\n'
    );
    await expect(
      readAntigravityHookLedger(home, [], 1, [
        { tool: 'write_file', callId: 'different-id', path: 'same.txt', fingerprint: 'fp-different' }
      ])
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('no unused approval in hook ledger matches this call ID')
    });

    // 6. Missing fingerprint when call ID is also missing -> rejects fail-closed
    await expect(
      readAntigravityHookLedger(home, [], 1, [
        { tool: 'write_file', callId: null, path: 'same.txt', fingerprint: null }
      ])
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('lacks both call ID and canonical arguments fingerprint')
    });

    // 7. Conflicting repeated IDs in execution stream against single approval -> rejects
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), JSON.stringify(approval1) + '\n');
    await expect(
      readAntigravityHookLedger(home, [], 2, [
        { tool: 'read_file', callId: 'call-1', path: 'sample.ts', fingerprint: 'fp-sample' },
        { tool: 'read_file', callId: 'call-1', path: 'sample.ts', fingerprint: 'fp-sample' }
      ])
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('Audit mismatch')
    });

    // 8. Identical repeated calls without call IDs matching by canonical fingerprint -> succeeds
    await writeFile(
      path.join(cliDir, 'hook-ledger.jsonl'),
      JSON.stringify({
        callbackId: 'agy-hook-1',
        relatedEntryId: null,
        turnId: '1',
        tool: 'read_file',
        path: 'sample.ts',
        fingerprint: 'fp-sample',
        decision: 'approve',
        reason: null
      }) + '\n' +
      JSON.stringify({
        callbackId: 'agy-hook-2',
        relatedEntryId: null,
        turnId: '2',
        tool: 'read_file',
        path: 'sample.ts',
        fingerprint: 'fp-sample',
        decision: 'approve',
        reason: null
      }) + '\n'
    );
    const fingerprintRepeatResult = await readAntigravityHookLedger(home, [], 2, [
      { tool: 'read_file', callId: null, path: 'sample.ts', fingerprint: 'fp-sample' },
      { tool: 'read_file', callId: null, path: 'sample.ts', fingerprint: 'fp-sample' }
    ]);
    expect(fingerprintRepeatResult.toolCalls.executed).toBe(2);

    // 9. Path mismatch when callId matches -> rejects
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), JSON.stringify(approval1) + '\n');
    await expect(
      readAntigravityHookLedger(home, [], 1, [
        { tool: 'read_file', callId: 'call-1', path: 'other.ts', fingerprint: 'fp-sample' }
      ])
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining("does not match approved path 'sample.ts'")
    });

    // 10. Unmatched effect: stream reports 2 calls executed, but only 1 call record was provided
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), JSON.stringify(approval1) + '\n' + JSON.stringify(approval2) + '\n');
    await expect(
      readAntigravityHookLedger(home, [], 2, [
        { tool: 'read_file', callId: 'call-1', path: 'sample.ts', fingerprint: 'fp-sample' }
      ])
    ).rejects.toMatchObject({
      code: 'VSUP_INTERNAL',
      message: expect.stringContaining('only 1 call records with identifiers were received')
    });

    // 11. Approval alone must NOT count as execution: hook ledger recorded 2 approvals, but 0 calls executed
    await writeFile(path.join(cliDir, 'hook-ledger.jsonl'), JSON.stringify(approval1) + '\n' + JSON.stringify(approval2) + '\n');
    const zeroExecResult = await readAntigravityHookLedger(home, [], 0, []);
    expect(zeroExecResult.toolCalls.executed).toBe(0);
    expect(zeroExecResult.approvals.records).toHaveLength(2);
  });

  it('enforces recursive-search boundaries on workspace root, subdirectories, symlinks, depth, and secrets', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace, { recursive: true });

    // Create subdirectories
    const srcDir = path.join(workspace, 'src');
    const secretSubDir = path.join(srcDir, 'secrets');
    await mkdir(secretSubDir, { recursive: true });
    await writeFile(path.join(secretSubDir, 'token.key'), 'secret-key');
    await writeFile(path.join(srcDir, 'index.ts'), 'console.log("hello");');

    // 1. Recursive search at workspace root when exclusions exist -> path_excluded
    const rootExclEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [{ root: workspace, globs: ['src/secrets/**'] }] },
      { toolCall: { name: 'grep_search', args: { SearchDirectory: workspace } } }
    );
    expect(rootExclEval.decision).toBe('deny');
    expect(rootExclEval.reason).toBe('path_excluded');

    // 2. Recursive search at workspace root when NO exclusions exist -> path_reserved (cannot constrain away from .git/.gemini)
    const rootNoExclEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'find_by_name', args: { DirectoryPath: workspace } } }
    );
    expect(rootNoExclEval.decision).toBe('deny');
    expect(rootNoExclEval.reason).toBe('path_reserved');

    // 3. Shallow list_dir at workspace root without exclusions -> allowed
    const rootListDirEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'list_dir', args: { DirectoryPath: workspace } } }
    );
    expect(rootListDirEval.decision).toBe('allow');

    // 4. Recursive search on subdirectory with nested exclusion -> path_excluded
    const subExclEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [{ root: workspace, globs: ['src/secrets/**'] }] },
      { toolCall: { name: 'find_by_name', args: { DirectoryPath: srcDir } } }
    );
    expect(subExclEval.decision).toBe('deny');
    expect(subExclEval.reason).toBe('path_excluded');

    // 5. Recursive search on subdirectory containing secret file -> path_secret
    const subSecretEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'grep_search', args: { SearchDirectory: srcDir } } }
    );
    expect(subSecretEval.decision).toBe('deny');
    expect(subSecretEval.reason).toBe('path_secret');

    // 6. Subdirectory with symlink -> path_symlink
    const cleanDir = path.join(workspace, 'clean');
    await mkdir(cleanDir, { recursive: true });
    await writeFile(path.join(cleanDir, 'file.txt'), 'hello');
    const symlinkDir = path.join(workspace, 'symlink-dir');
    await mkdir(symlinkDir, { recursive: true });
    await symlink(path.join(cleanDir, 'file.txt'), path.join(symlinkDir, 'link.txt'));

    const symlinkEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'find_by_name', args: { DirectoryPath: symlinkDir } } }
    );
    expect(symlinkEval.decision).toBe('deny');
    expect(symlinkEval.reason).toBe('path_symlink');

    // 7. Subdirectory exceeding depth 4 -> path_invalid
    const deepDir = path.join(workspace, 'd1', 'd2', 'd3', 'd4', 'd5', 'd6');
    await mkdir(deepDir, { recursive: true });
    await writeFile(path.join(deepDir, 'deep.txt'), 'deep');
    const deepEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'find_by_name', args: { DirectoryPath: path.join(workspace, 'd1') } } }
    );
    expect(deepEval.decision).toBe('deny');
    expect(deepEval.reason).toBe('path_invalid');

    // 8. File tool called on a directory -> path_invalid
    const readFileDirEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'read_file', args: { path: cleanDir } } }
    );
    expect(readFileDirEval.decision).toBe('deny');
    expect(readFileDirEval.reason).toBe('path_invalid');

    // 9. Recursive operations on clean subdirectory -> denied as path_invalid (unconstrained traversal)
    const cleanFindEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'find_by_name', args: { DirectoryPath: cleanDir } } }
    );
    expect(cleanFindEval.decision).toBe('deny');
    expect(cleanFindEval.reason).toBe('path_invalid');

    const cleanGrepEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'grep_search', args: { SearchDirectory: cleanDir } } }
    );
    expect(cleanGrepEval.decision).toBe('deny');
    expect(cleanGrepEval.reason).toBe('path_invalid');

    // 10. Shallow list_dir on clean subdirectory -> allowed
    const cleanListEval = await evaluateAntigravityToolCall(
      { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] },
      { toolCall: { name: 'list_dir', args: { DirectoryPath: cleanDir } } }
    );
    expect(cleanListEval.decision).toBe('allow');
    expect(cleanListEval.reason).toBeNull();
  });

  it('synchronizes process termination, reaper shutdown, and private directory cleanup via backend.close', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const runDir = path.join(root, 'run');
    await mkdir(workspace);
    await mkdir(runDir);

    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('1.4.0');
  process.exit(0);
}
console.log(JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Completed task.' }] } }));
console.log(JSON.stringify({ type: 'result', status: 'SUCCESS', num_turns: 1 }));
process.exit(0);
`);

    const backend = new AntigravityBackend(
      {
        backend: 'antigravity',
        allowed_workspace_roots: [workspace],
        paths: { antigravity: script },
        experimental: { antigravity: true }
      } as unknown as SupervisorConfig,
      passedPreparation
    );

    let finalState: string | undefined;
    const callbacks: BackendCallbacks = {
      onEvent() {},
      onState(state) {
        finalState = state;
      }
    };

    const input: StartRunInput = {
      runId: '33333333-4444-5555-8666-777777777777',
      mode: 'review',
      task: 'Review synchronization contract',
      cwd: workspace,
      workerWorkspace: workspace,
      runDirectory: runDir,
      exclusions: [],
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    const handle = result.handle as AntigravityHandle;

    await handle.opaque.process.done;
    await waitFor(() => finalState, (state) => state === 'completed');

    await backend.close(result.handle);

    await expect(lstat(path.join(runDir, 'antigravity-home'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(runDir, 'antigravity-tmp'))).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(backend.close(result.handle)).resolves.toBeUndefined();
  });
});
