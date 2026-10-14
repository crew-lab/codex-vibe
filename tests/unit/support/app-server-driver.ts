import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RunMode } from '../../../src/contracts.js';
import { ApprovalHandler, type ApprovalVerdict } from '../../../src/backends/app-server/approvals.js';
import { EventProcessor, auditSessionHistory, type EventSignal, type HistoryAudit } from '../../../src/backends/app-server/events.js';
import { JsonRpcClient } from '../../../src/backends/app-server/jsonrpc.js';
import { mapOutcome, type RunOutcome, type SupervisorCondition } from '../../../src/backends/app-server/outcome.js';
import {
  buildCallbackResult,
  buildConfigModelWrite,
  buildInitialize,
  buildInitialized,
  buildRuntimeRead,
  buildSessionHistoryList,
  buildSessionRead,
  buildSessionReadyWait,
  buildSessionStart,
  buildTurnInterrupt,
  buildTurnStart,
  parseHistoryListResult,
  parseRuntimeReadResult,
  parseSessionReadResult,
  parseSessionStartResult,
  parseTurnStartResult,
  type AgentStats,
  type ApprovalRequest,
  type Turn
} from '../../../src/backends/app-server/protocol.js';
import { UsageTracker, type BudgetCeilings, type UsageSummary } from '../../../src/backends/app-server/usage.js';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const fixture = path.join(root, 'tests', 'fixtures', 'fake-vibe-app-server.mjs');
const scenarioDirectory = path.join(root, 'tests', 'fixtures', 'app-server-scenarios');

type Json = Record<string, unknown>;

export interface DriverOptions {
  scenario: string | Json;
  mode?: RunMode;
  deadlineMs?: number;
  evaluate?: (request: ApprovalRequest) => Promise<ApprovalVerdict>;
  ceilings?: BudgetCeilings;
  conditions?: SupervisorCondition[];
  secrets?: string[];
  timeoutMs?: number;
}

export interface DriverResult {
  workspace: string;
  signals: EventSignal[];
  turn: Turn | null;
  outcome: RunOutcome;
  processor: EventProcessor;
  handler: ApprovalHandler;
  usage: UsageTracker;
  usageUpdates: UsageSummary[];
  baseline: AgentStats;
  finalStats: AgentStats;
  audit: HistoryAudit;
  interrupts: number;
  resynced: boolean;
  fixtureLog: Json[];
}

export async function runScenario(options: DriverOptions): Promise<DriverResult> {
  const workDirectory = mkdtempSync(path.join(tmpdir(), 'app-server-driver-'));
  const workspace = path.join(realpathSync(workDirectory), 'workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(workspace, '.env'), 'TOKEN=not-a-secret\n');
  const mode = options.mode ?? 'review';
  const scenarioFile = path.join(workDirectory, 'scenario.json');
  const scenario = typeof options.scenario === 'string' ? JSON.parse(readFileSync(path.join(scenarioDirectory, `${options.scenario}.json`), 'utf8')) as Json : options.scenario;
  const logFile = path.join(workDirectory, 'fixture-log.jsonl');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  const child = spawn(process.execPath, [fixture, '--scenario', scenarioFile], {
    env: { PATH: process.env.PATH ?? '', HOME: workDirectory, TMPDIR: workDirectory, FAKE_VIBE_LOG: logFile },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.on('error', () => undefined);
  child.stderr.resume();
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); });

  const signals: EventSignal[] = [];
  const usageUpdates: UsageSummary[] = [];
  const background: Promise<unknown>[] = [];
  let interrupts = 0;
  let resynced = false;
  let sessionId = '';
  let turnId = '';
  let processor!: EventProcessor;
  let usage!: UsageTracker;
  let completedTurn: Turn | null = null;
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });

  const handler = new ApprovalHandler({ mode, workspace, ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }), ...(options.evaluate ? { evaluate: options.evaluate } : {}) });

  const client = new JsonRpcClient({
    input: child.stdout,
    output: child.stdin,
    onNotification: (method, params) => {
      for (const signal of processor.handle(method, params).signals) onSignal(signal);
    }
  });

  const call = (spec: { method: string; params: Json }) => client.request(spec.method, spec.params);

  const interrupt = (): void => {
    if (interrupts > 0 || turnId === '') return;
    interrupts += 1;
    const spec = buildTurnInterrupt(sessionId, turnId);
    background.push(call(spec).catch(() => undefined));
  };

  function onSignal(signal: EventSignal): void {
    signals.push(signal);
    if (signal.type === 'turn_completed') { completedTurn = signal.turn; resolveCompletion(); }
    else if (signal.type === 'stats') {
      const update = usage.update(signal.stats, signal.contextWindow);
      usageUpdates.push(update.summary);
      if (update.breach) interrupt();
    } else if (signal.type === 'fatal') interrupt();
    else if (signal.type === 'watermark_gap') {
      interrupt();
      background.push((async () => {
        const read = parseSessionReadResult(await call(buildSessionRead(sessionId, { history: { limit: 500 } })));
        resynced = true;
        for (const next of processor.resync(read.state).signals) onSignal(next);
        const latest = read.state.turns.at(-1);
        if (latest && latest.status !== 'in_progress') { completedTurn = latest; resolveCompletion(); }
      })());
    }
  }

  client.setRequestHandler('callback/call', (params) => {
    const pending = handler.begin(params);
    setImmediate(() => {
      background.push(pending.verdict.then((verdict) => {
        const spec = buildCallbackResult(sessionId, pending.callbackId, verdict.decision);
        return call(spec).catch(() => undefined);
      }));
    });
    return pending.acknowledgement;
  });

  const timeout = setTimeout(() => resolveCompletion(), options.timeoutMs ?? 8000);
  try {
    await call(buildInitialize({ name: 'vibe-supervisor', version: '2.0.0' }));
    const initialized = buildInitialized();
    client.notify(initialized.method, initialized.params);
    const started = parseSessionStartResult(await call(buildSessionStart({ cwd: workspace, agent: 'supervisor-profile', enabledTools: mode === 'edit' ? ['read_file', 'write_file', 'edit'] : ['read_file'], maxTurns: 20 })));
    sessionId = started.state.session.id;
    processor = new EventProcessor({ sessionId, watermark: started.state.eventId, mode, ledger: handler.ledger, ...(options.secrets ? { secrets: options.secrets } : {}) });
    processor.seed(started.state.history);
    await call(buildSessionReadyWait(sessionId));
    const baselineRuntime = parseRuntimeReadResult(await call(buildRuntimeRead(sessionId)));
    const baseline = baselineRuntime.runtime.stats;
    usage = new UsageTracker(baseline, options.ceilings);
    await call(buildConfigModelWrite(sessionId, { reasoningEffort: 'off' }));
    const turnStart = parseTurnStartResult(await call(buildTurnStart(sessionId, 'Review the repository.')));
    turnId = turnStart.turn.id;
    processor.advanceWatermark(turnStart.lastEventId);
    await completion;
    await Promise.all(background);
    const finalStats = parseRuntimeReadResult(await call(buildRuntimeRead(sessionId))).runtime.stats;
    const audit = await auditSessionHistory(async (page) => parseHistoryListResult(await call(buildSessionHistoryList(sessionId, page))), { mode, ledger: handler.ledger, ...(options.secrets ? { secrets: options.secrets } : {}) });
    const conditions: SupervisorCondition[] = [...(options.conditions ?? [])];
    const fatal = processor.fatal ?? audit.fatal;
    if (fatal) conditions.push({ kind: 'unsafe_event', fatal });
    const outcome = mapOutcome({ turn: completedTurn, conditions, hasFinalMessage: audit.finalMessage !== null });
    await client.closeInput();
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    const fixtureLog = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Json);
    return { workspace, signals, turn: completedTurn, outcome, processor, handler, usage, usageUpdates, baseline, finalStats, audit, interrupts, resynced, fixtureLog };
  } finally {
    clearTimeout(timeout);
    client.dispose();
    child.kill('SIGKILL');
    rmSync(workDirectory, { recursive: true, force: true });
  }
}
