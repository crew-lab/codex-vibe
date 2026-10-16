import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AntigravityBackend, type AntigravityHandle } from '../../src/backends/antigravity.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { RunManager } from '../../src/core/run-manager.js';
import type { BackendCallbacks, StartRunInput, SupervisorError } from '../../src/contracts.js';

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
  it('probes executable version and handles availability', async () => {
    const root = await makeRoot();
    const counter = path.join(root, 'count');
    const script = path.join(root, 'mock-agy.sh');
    await writeExecutable(script, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo x >> "${counter}"
  echo "agy 1.25.0 (antigravity-darwin-arm64)"
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
    expect(probeResult.version).toBe('1.25.0');

    const runtimeCheck = await backend.runtimeCheck();
    expect(runtimeCheck.executable_found).toBe(true);
    expect(runtimeCheck.pinned_version).toBe('1.25.0');
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

  it('runs a review task with --mode plan, stream-json parsing, and secret redaction', async () => {
    const root = await makeRoot();
    const script = path.join(root, 'mock-agy.sh');
    const recordedArgsFile = path.join(root, 'recorded-args.json');

    await writeExecutable(script, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('antigravity 2.1.0');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(recordedArgsFile)}, JSON.stringify(args));
console.log(JSON.stringify({ type: 'message', role: 'assistant', text: 'Analyzing repository... ' }));
console.log(JSON.stringify({ type: 'thought', reasoning: 'Internal private reasoning that must not leak' }));
console.log(JSON.stringify({ type: 'message', role: 'assistant', text: 'Bearer secret_token_1234567890abcdef is used.' }));
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

    const callbacks: BackendCallbacks = {
      onEvent(event) { events.push(event); },
      onState(state, update) {
        finalState = state;
        if (update?.result?.summary) finalSummary = update.result.summary;
      }
    };

    const input: StartRunInput = {
      runId: '11111111-2222-4333-8444-555555555555',
      mode: 'review',
      task: 'Review the security module',
      cwd: root,
      workerWorkspace: root,
      runDirectory: root,
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

    const recordedArgs = JSON.parse(await readFile(recordedArgsFile, 'utf8'));
    expect(recordedArgs).toContain('--mode');
    expect(recordedArgs).toContain('plan');
    expect(recordedArgs).toContain('--output-format');
    expect(recordedArgs).toContain('stream-json');
    expect(recordedArgs).toContain('--dangerously-skip-permissions');
  });

  it('runs an edit task with --mode accept-edits', async () => {
    const root = await makeRoot();
    const script = path.join(root, 'mock-agy.sh');
    const recordedArgsFile = path.join(root, 'recorded-args.json');

    await writeExecutable(script, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('antigravity 2.1.0');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(recordedArgsFile)}, JSON.stringify(args));
console.log(JSON.stringify({ type: 'message', role: 'assistant', text: 'Edit applied.' }));
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
      cwd: root,
      workerWorkspace: root,
      runDirectory: root,
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;

    const recordedArgs = JSON.parse(await readFile(recordedArgsFile, 'utf8'));
    expect(recordedArgs).toContain('--mode');
    expect(recordedArgs).toContain('accept-edits');
  });

  it('reports failure when the child process exits with non-zero code', async () => {
    const root = await makeRoot();
    const script = path.join(root, 'mock-agy.sh');

    await writeExecutable(script, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "antigravity 2.1.0"
  exit 0
fi
echo "Fatal crash in antigravity engine" >&2
exit 42
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
      task: 'Check review crash',
      cwd: root,
      workerWorkspace: root,
      runDirectory: root,
      limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 10240, maxTranscriptBytes: 10240, maxArtifactBytes: 10240 }
    };

    const result = await backend.start(input, callbacks);
    await (result.handle as AntigravityHandle).opaque.process.done;

    expect(failedState).toBe('failed');
    expect(failureError?.code).toBe('VSUP_BACKEND_CRASHED');
    expect(failureError?.message).toContain('exited with code 42');
  });

  it('integrates with RunManager when backend="antigravity" is configured', async () => {
    const root = await makeRoot();
    const workspace = path.join(root, 'workspace');
    const dataDir = path.join(root, 'data');
    await writeFile(path.join(root, 'mock-agy.sh'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('antigravity 2.1.0');
  process.exit(0);
}
console.log(JSON.stringify({ type: 'message', role: 'assistant', text: 'All security checks verified.' }));
process.exit(0);
`);
    const script = path.join(root, 'mock-agy.sh');
    await chmod(script, 0o755);

    const { mkdir } = await import('node:fs/promises');
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
});
