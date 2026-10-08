import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
const distRoot = process.env.VIBE_SUPERVISOR_DIST_DIR || process.env.VIBE_SUPERVISOR_TEST_DIST || path.join(root, 'dist');
const load = (file) => import(pathToFileURL(path.join(distRoot, file)).href);
const { getDataDir, loadConfig } = await load('config/config.js');
const { RunManager } = await load('core/run-manager.js');
const { startMcpStdio } = await load('mcp/server.js');

const logFile = process.env.FAKE_EVENT_LOG;
const record = (operation, details = {}) => {
  if (logFile) appendFileSync(logFile, `${JSON.stringify({ operation, pid: process.pid, at: Date.now(), ...details })}\n`);
};

const CANCELLED = Symbol('cancelled');
const REQUEST = {
  requestId: 'fake-request-1',
  kind: 'permission',
  title: 'Read a file',
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
  ],
};

class FakeBackend {
  constructor(kind) {
    this.kind = kind;
    this.supportsContinue = kind === 'acp';
    this.sessions = new Map();
    this.starts = 0;
  }

  modeFor(start) {
    const mode = process.env[`FAKE_MODE_${this.kind.toUpperCase()}`] || process.env.FAKE_MODE || 'normal';
    const only = Number(process.env.FAKE_ONLY_NTH || 0);
    return only > 0 && only !== start ? 'normal' : mode;
  }

  delay() {
    return Number(process.env.FAKE_DELAY_MS || 25);
  }

  async probe() {
    return { available: true, backend: this.kind, supportsContinue: this.supportsContinue, supportsPermissionResponse: this.supportsContinue };
  }

  session(runId, callbacks, input, turn, mode) {
    const timers = new Set();
    const session = { runId, callbacks, input, turn, mode, timers, cancelled: false, waiter: undefined };
    session.sleep = (milliseconds) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { timers.delete(timer); if (session.cancelled) reject(CANCELLED); else resolve(); }, milliseconds);
      timers.add(timer);
    });
    this.sessions.set(runId, session);
    return session;
  }

  async start(input, callbacks) {
    this.starts += 1;
    const start = this.starts;
    const mode = this.modeFor(start);
    record('start', { runId: input.runId, mode: input.mode, behavior: mode, start, timeoutSeconds: input.limits.timeoutSeconds });
    if (mode === 'exit') process.exit(3);
    if (mode === 'leak' && process.env.FAKE_LEAK_PID_FILE) {
      const leaked = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', 'vibe-fake-leaked-child'], { detached: true, stdio: 'ignore' });
      leaked.unref();
      writeFileSync(process.env.FAKE_LEAK_PID_FILE, String(leaked.pid));
    }
    if (process.env.VIBE_SUPERVISOR_DIAGNOSTICS === '1' && process.env.FAKE_DIAGNOSTICS_MODE) {
      const file = path.join(input.runDirectory, 'worker-diagnostics.json');
      if (process.env.FAKE_DIAGNOSTICS_MODE === 'symlink') symlinkSync(logFile, file);
      else writeFileSync(file, JSON.stringify({ schema_version: 1, stages: [{ stage: 'launch', elapsed_ms: 1 }], snapshots: [], locals: 'PRIVATE-FIXTURE-CANARY' }), { mode: 0o600 });
    }
    const session = this.session(input.runId, callbacks, input, 0, mode);
    setTimeout(() => { void this.play(session); }, 10);
    return {
      handle: { runId: input.runId, backend: this.kind, opaque: {} },
      initialState: 'running',
      ...(this.kind === 'acp' ? { acp: { sessionId: `fake-session-${input.runId}`, capabilities: { loadSession: true } } } : {}),
    };
  }

  async play(session) {
    session.turn += 1;
    if (session.input.runDirectory) {
      const auditMode = process.env.FAKE_AUDIT_MODE;
      const directory = path.join(session.input.runDirectory, 'vibe-home', 'sessions', 'session_fixture');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, 'messages.jsonl');
      const calls = Array.from({ length: auditMode === 'reads' ? 4 : 1 }, () => ({ function: { name: 'read_file', arguments: 'PRIVATE-FIXTURE-CANARY' } }));
      if (auditMode === 'searches') calls.push(...Array.from({ length: 3 }, () => ({ function: { name: 'grep' } })));
      if (auditMode !== 'unavailable') {
        if (auditMode === 'unsafe') { try { symlinkSync(logFile, file); } catch {} }
        else writeFileSync(file, [JSON.stringify({ role: 'assistant', tool_calls: calls }), ...(auditMode === 'missing-final' ? [] : [JSON.stringify({ role: 'assistant', content: 'No defect found in the inspected file; remaining files were not reviewed.' })])].join('\n') + '\n', { mode: 0o600 });
      }
    }
    const turn = session.turn;
    const { callbacks, mode } = session;
    const steps = mode === 'slow' ? 8 : 3;
    try {
      if (mode === 'silent') return;
      for (let step = 1; step <= steps; step += 1) {
        await session.sleep(step === 1 ? 20 : this.delay());
        await callbacks.onEvent({ source: this.kind === 'acp' ? 'acp' : 'vibe', type: 'tool_call', severity: 'info', data: { title: `Read file ${step}`, kind: 'read', status: 'completed' } });
        if (step === 1 && turn === 1 && mode === 'crash') {
          await callbacks.onState('failed', { error: { code: 'VSUP_BACKEND_CRASHED', message: 'The fake backend crashed.', remediation: 'Retry.', retryable: false } });
          return;
        }
        if (step === 1 && turn === 1 && mode === 'permission' && this.kind === 'acp') {
          await new Promise((resolve) => { session.waiter = resolve; void callbacks.onPendingRequest({ ...REQUEST, tool: { kind: 'read', locations: [session.input.workerWorkspace] } }); });
          await session.sleep(120);
        }
      }
      if (session.input.mode === 'edit') writeFileSync(path.join(session.input.workerWorkspace, session.input.task?.match(/named (soak-note-[0-9]+\.txt)/)?.[1] ?? session.input.task?.match(/In the file ([^,]+),/)?.[1] ?? `soak-fake-${turn}.txt`), `fake edit ${turn}\n`);
      await callbacks.onEvent({ source: this.kind === 'acp' ? 'acp' : 'vibe', type: 'agent_message', severity: 'info', data: { text: `Fake review turn ${turn} finished.\n` } });
      await callbacks.onState('completed', {
        result: { stopReason: 'end_turn', summary: `Fake summary for turn ${turn}.` },
        usage: { tokensUsed: 100 * turn, contextSize: 1000, cost: { amount: 0.01 * turn, currency: 'USD', authoritative: false } },
      });
    } catch (error) {
      if (error !== CANCELLED) throw error;
    }
  }

  async continue(handle, message) {
    const session = this.sessions.get(handle.runId);
    record('continue', { runId: handle.runId, messageChars: message.length });
    if (!session) throw Object.assign(new Error('No fake session.'), { code: 'VSUP_SESSION_NOT_RESUMABLE' });
    session.cancelled = false;
    setTimeout(() => { void this.play(session); }, 10);
  }

  async respond(handle, response) {
    record('respond', { runId: handle.runId, optionId: response.optionId, action: response.action });
    const session = this.sessions.get(handle.runId);
    session?.waiter?.();
  }

  async cancel(handle) {
    record('cancel', { runId: handle.runId });
    const session = this.sessions.get(handle.runId);
    if (!session) return;
    session.cancelled = true;
    for (const timer of session.timers) clearTimeout(timer);
    session.timers.clear();
    session.waiter?.();
    await session.callbacks.onState('cancelled');
  }

  async close(handle) {
    record('close', { runId: handle.runId });
    const session = this.sessions.get(handle.runId);
    if (!session) return;
    session.cancelled = true;
    for (const timer of session.timers) clearTimeout(timer);
    session.timers.clear();
    session.waiter?.();
  }

  async recover(runRecord, callbacks) {
    record('recover', { runId: runRecord.runId, hasSession: Boolean(runRecord.acp?.sessionId) });
    if (!runRecord.acp?.sessionId) return undefined;
    this.session(runRecord.runId, callbacks, { mode: runRecord.mode, workerWorkspace: runRecord.workerWorkspace, runDirectory: path.join(dataDir, 'runs', runRecord.runId) }, 1, 'normal');
    return { runId: runRecord.runId, backend: this.kind, opaque: {} };
  }
}

const config = await loadConfig({ createDataDir: true });
const dataDir = config.paths?.dataDir ?? getDataDir();
const backend = new FakeBackend(config.backend === 'programmatic' ? 'programmatic' : 'acp');
const manager = new RunManager(config, dataDir, [backend]);
await manager.initialize();
const handle = startMcpStdio(manager, { config, onError: (message) => process.stderr.write(`${message}\n`) });
manager.startAutomaticRetention();

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await handle.close().catch(() => {});
  await manager.shutdown().catch((error) => process.stderr.write(`Shutdown failed: ${String(error?.message)}\n`));
  process.exit(0);
};
process.stdin.once('end', () => { void close(); });
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
