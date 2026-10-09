import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BackendCallbacks, BackendStartResult, PendingRequest, RunRecord, StartRunInput } from '../../src/contracts.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { SCHEMA_VERSION } from '../../src/contracts.js';
import { AcpBackend } from '../../src/backends/acp.js';
import type { VibeChildProfile } from '../../src/backends/profile.js';
import type { VibeLaunch } from '../../src/backends/launcher.js';

const fixture = fileURLToPath(new URL('../fixtures/fake-acp.mjs', import.meta.url));
const canonicalTmp = await realpath(tmpdir());

class FakeAcpBackend extends AcpBackend {
  constructor(private readonly testMode = 'normal', dataDir?: string, allowedWorkspaceRoots: string[] = []) { super({ ...DEFAULT_CONFIG, backend: 'acp', allowedWorkspaceRoots, paths: { vibeAcp: 'fake-acp' } }, dataDir); }
  protected override executable(): string { return 'fake-acp'; }
  protected override async buildLaunch(_args: readonly string[], profile: VibeChildProfile, _runDirectory: string): Promise<VibeLaunch> {
    return {
      command: process.execPath,
      args: [fixture],
      env: { ...profile.env, FAKE_ACP_CASE: this.testMode, FAKE_FILE_PATH: this.filePath }
    };
  }
  filePath = '';
  override async probe() {
    return { available: true, backend: 'acp' as const, executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
}

function makeInput(root: string, runId = crypto.randomUUID()): StartRunInput {
  const workspace = path.join(root, 'workspace'); const runDirectory = path.join(root, 'run', runId);
  return { runId, mode: 'review', task: 'Inspect the workspace', cwd: workspace, workerWorkspace: workspace, runDirectory, limits: { timeoutSeconds: 30, maxTurns: 5, maxEventBytes: 1_000_000, maxTranscriptBytes: 1_000_000, maxArtifactBytes: 1_000_000 } };
}

async function createRoot() {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-fake-acp-'));
  const input = makeInput(root);
  await mkdir(input.cwd, { recursive: true }); await mkdir(input.runDirectory, { recursive: true });
  return { root, input };
}

function callbacks(events: unknown[], states: string[], onPendingRequest?: (pending: PendingRequest) => void, results: unknown[] = []): BackendCallbacks {
  return {
    onEvent: (event) => { events.push(event); },
    onPendingRequest: (request) => { if (request) onPendingRequest?.(request); },
    onState: (state, update) => { states.push(state); if (state === 'completed') results.push(update?.result); }
  };
}

async function waitForState(states: string[], target: string): Promise<void> {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    if (states.includes(target)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`ACP backend did not report ${target}`);
}

describe('ACP backend subprocess contract', () => {
  it('completes 100 independent initialized prompt turns without leaking private reasoning', async () => {
    const { root } = await createRoot();
    try {
      for (let index = 0; index < 100; index += 1) {
        const input = makeInput(root);
        await mkdir(input.runDirectory, { recursive: true });
        const backend = new FakeAcpBackend('soak'); const events: unknown[] = []; const states: string[] = [];
        const started = await backend.start(input, callbacks(events, states));
        await waitForState(states, 'completed');
        await backend.close(started.handle);
        const serialized = JSON.stringify(events);
        if (serialized.includes('PRIVATE_THOUGHT_MUST_NOT_ESCAPE')) throw new Error('ACP reasoning leaked into event callbacks');
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('ignores unknown notifications, strips thought updates, and preserves ordinary messages', async () => {
    const { root, input } = await createRoot(); const backend = new FakeAcpBackend(); const events: unknown[] = []; const states: string[] = [];
    try {
      const started = await backend.start(input, callbacks(events, states));
      await waitForState(states, 'completed');
      await backend.close(started.handle);
      const json = JSON.stringify(events);
      expect(json).toContain('reply-1');
      expect(json).not.toContain('PRIVATE_THOUGHT_MUST_NOT_ESCAPE');
      expect(json).not.toContain('unknown_test_notification');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('correlates permission request IDs and returns only the explicitly selected offered option', async () => {
    const { root, input } = await createRoot(); const backend = new FakeAcpBackend('permission'); backend.filePath = path.join(input.cwd, 'source.txt');
    const events: unknown[] = []; const states: string[] = []; let pendingResolve!: (request: PendingRequest) => void;
    const pendingPromise = new Promise<PendingRequest>((resolve) => { pendingResolve = resolve; });
    try {
      const started = await backend.start(input, callbacks(events, states, pendingResolve));
      const pending = await pendingPromise;
      expect(pending).toMatchObject({ kind: 'permission', requestId: 'permission-request-1', tool: { kind: 'read', locations: [backend.filePath] } });
      await backend.respond(started.handle, { requestId: pending.requestId, kind: 'permission', optionId: 'allow-once' });
      await waitForState(states, 'completed');
      await expect(backend.respond(started.handle, { requestId: 'wrong-id', kind: 'permission', optionId: 'allow-once' })).rejects.toMatchObject({ code: 'VSUP_REQUEST_EXPIRED' });
      await backend.close(started.handle);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  async function runElicitation(answer: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) {
    const { root, input } = await createRoot(); const backend = new FakeAcpBackend('elicitation');
    const events: unknown[] = []; const states: string[] = []; const results: unknown[] = []; let pendingResolve!: (request: PendingRequest) => void;
    const pendingPromise = new Promise<PendingRequest>((resolve) => { pendingResolve = resolve; });
    try {
      const started = await backend.start(input, callbacks(events, states, pendingResolve, results));
      const pending = await pendingPromise;
      expect(pending).toMatchObject({ requestId: 'elicitation-request-1', kind: 'elicitation', schema: { type: 'object' } });
      await backend.respond(started.handle, { requestId: pending.requestId, kind: 'elicitation', ...answer });
      await waitForState(states, 'completed');
      await expect(backend.respond(started.handle, { requestId: pending.requestId, kind: 'elicitation', ...answer })).rejects.toMatchObject({ code: 'VSUP_REQUEST_EXPIRED' });
      await backend.close(started.handle);
      return { results, json: JSON.stringify(events) };
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  it('continues the turn after an accepted schema-valid elicitation and expires the request afterward', async () => {
    const { results, json } = await runElicitation({ action: 'accept', content: { confirm: true } });
    expect(results).toEqual([{ stopReason: 'end_turn' }]);
    expect(json).toContain('reply-1');
  });

  it('ends the turn cancelled when the elicitation is declined', async () => {
    const { results, json } = await runElicitation({ action: 'decline' });
    expect(results).toEqual([{ stopReason: 'cancelled' }]);
    expect(json).not.toContain('reply-1');
  });

  it('ends the turn cancelled when the elicitation is answered with cancel', async () => {
    const { results, json } = await runElicitation({ action: 'cancel' });
    expect(results).toEqual([{ stopReason: 'cancelled' }]);
    expect(json).not.toContain('reply-1');
  });

  it('accepts continuation on the same ACP session as a distinct prompt turn', async () => {
    const { root, input } = await createRoot(); const backend = new FakeAcpBackend(); const events: unknown[] = []; const states: string[] = [];
    try {
      const started = await backend.start(input, callbacks(events, states));
      await waitForState(states, 'completed');
      const firstCompletedCount = states.filter((state) => state === 'completed').length;
      await backend.continue(started.handle, 'Continue with one more check');
      const until = Date.now() + 5_000;
      while (Date.now() < until && states.filter((state) => state === 'completed').length <= firstCompletedCount) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(states.filter((state) => state === 'completed').length).toBe(firstCompletedCount + 1);
      expect(JSON.stringify(events)).toContain('reply-2');
      await backend.close(started.handle);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('loads a persisted session without replaying its original task', async () => {
    const { root, input } = await createRoot();
    const dataDir = path.join(root, 'data');
    const runDirectory = path.join(dataDir, 'runs', input.runId);
    const home = path.join(runDirectory, 'child-home'); const vibeHome = path.join(runDirectory, 'vibe-home');
    await mkdir(home, { recursive: true }); await mkdir(vibeHome, { recursive: true });
    const backend = new FakeAcpBackend('load', dataDir, [input.cwd]); const events: unknown[] = []; const states: string[] = [];
    const record: RunRecord = {
      schemaVersion: SCHEMA_VERSION, runId: input.runId, backend: 'acp', mode: 'review', state: 'recoverable',
      sourceWorkspace: input.cwd, workerWorkspace: input.workerWorkspace, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskSha256: 'a'.repeat(64),
      limits: input.limits, acp: { protocolVersion: 1, sessionId: 'fake-session-1', capabilities: { loadSession: true }, runDirectory, home, vibeHome, profileMode: 'review' }
    };
    try {
      const recovered = await backend.recover(record, callbacks(events, states));
      expect(recovered).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(states).toEqual([]);
      expect(events).toEqual([]);
      await backend.continue(recovered!, 'Only send this continuation');
      await waitForState(states, 'completed');
      expect(JSON.stringify(events)).toContain('reply-1');
      expect(JSON.stringify(events)).not.toContain('Inspect the workspace');
      await backend.close(recovered!);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['broken-json', 'early-exit', 'wrong-protocol', 'wrong-mode'])(`fails closed for %s`, async (mode) => {
    const { root, input } = await createRoot(); const backend = new FakeAcpBackend(mode); const events: unknown[] = []; const states: string[] = [];
    try {
      await expect(backend.start(input, callbacks(events, states))).rejects.toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(states.every((state) => state !== 'completed')).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('cancels the active process and completes promptly without waiting for a prompt response', async () => {
    const { root, input } = await createRoot(); const backend = new FakeAcpBackend(); const events: unknown[] = []; const states: string[] = [];
    try {
      const started: BackendStartResult = await backend.start(input, callbacks(events, states));
      await backend.cancel(started.handle);
      expect(states).not.toContain('completed');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
