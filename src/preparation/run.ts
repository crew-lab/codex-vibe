import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest } from '../acceptance/schema.js';
import type { SupervisorConfig } from '../contracts.js';
import { atomicWriteJson } from '../persistence/atomic.js';
import { publicValue } from '../reporting/export.js';
import { readOwnedFile } from '../reporting/private-files.js';
import { createPrivateDir, createPrivateFile } from '../security/paths.js';
import { runAntigravityPreparationCheck, type PreparedReceiptIdentity } from './antigravity-prepare.js';
import { candidateIdentity, packageRoot, preparationComponents, preparationIdentity, receiptPath, receiptProvenance, type PreparationOrigin, type PreparationProvenance } from './evidence.js';

export type { PreparedReceiptIdentity } from './antigravity-prepare.js';

const MAX_REPORTED_FINDINGS = 20;
const MAX_FINDING_MESSAGE = 600;
const CONFORMANCE_TIMEOUT_MS = 180_000;
const CONFORMANCE_KILL_GRACE_MS = 5_000;

export interface ReportedFinding { code: string; message: string }

export function failingFindings(report: unknown): ReportedFinding[] {
  const findings = (report as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(findings)) return [];
  const failing: ReportedFinding[] = [];
  for (const entry of findings) {
    if (failing.length >= MAX_REPORTED_FINDINGS) break;
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as { level?: unknown; severity?: unknown; code?: unknown; id?: unknown; message?: unknown };
    const code = item.code ?? item.id;
    if ((item.level ?? item.severity) !== 'fail' || typeof code !== 'string' || typeof item.message !== 'string') continue;
    failing.push(publicValue({ code, message: item.message.slice(0, MAX_FINDING_MESSAGE) }) as ReportedFinding);
  }
  return failing;
}

export interface RunPreparationInput {
  config: SupervisorConfig;
  configPath: string;
  dataDir: string;
  stderr: 'inherit' | 'ignore';
  signal?: AbortSignal | undefined;
  origin?: PreparationOrigin | undefined;
  previousWorkerVersion?: string | undefined;
  beforeFinalReceipt?: ((written: PreparedReceiptIdentity) => Promise<void>) | undefined;
  conformanceScript?: string | undefined;
}

export interface PreparationResult {
  status: 'passed' | 'failed';
  candidate_sha256: string;
  hosted_acceptance: 'unverified';
  report_sha256: string;
  report_path: string;
  findings: ReportedFinding[];
}

export async function runPreparation(input: RunPreparationInput): Promise<PreparationResult> {
  input.signal?.throwIfAborted();
  const provenance: PreparationProvenance = { origin: input.origin, previousWorkerVersion: input.previousWorkerVersion };
  if (input.config.backend === 'antigravity') {
    const out = await runAntigravityPreparationCheck(input.config, {
      dataDir: input.dataDir,
      provenance,
      signal: input.signal,
      beforeFinalReceipt: input.beforeFinalReceipt
    });
    return { status: out.status, candidate_sha256: out.candidate_sha256, hosted_acceptance: out.hosted_acceptance, report_sha256: out.report_sha256, report_path: out.report_path, findings: failingFindings(out.report) };
  }
  return runVibePreparation(input, provenance);
}

async function runVibePreparation(input: RunPreparationInput, provenance: PreparationProvenance): Promise<PreparationResult> {
  const { config, signal } = input;
  const manifest = config.paths?.vibePinManifest;
  if (!manifest) throw new Error('Pin manifest required');
  const candidate = await candidateIdentity();
  const identity = await preparationIdentity(config, candidate);
  const components = await preparationComponents(config, candidate);
  const facts = receiptProvenance(provenance);
  const receipt = receiptPath(config, input.dataDir);
  const script = input.conformanceScript ?? path.join(packageRoot, 'scripts/v2-conformance-check.mjs');
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-preparation-')));
  const output = path.join(temporary, 'conformance.json');
  try {
    const argv = [script, '--dist', path.join(packageRoot, 'dist'), '--config', input.configPath, '--manifest', manifest, '--placeholder-key', '--observe-network', '--output', output];
    const reports = path.join(path.dirname(receipt), 'preparation-reports');
    await createPrivateDir(reports);
    const started = Buffer.from(JSON.stringify({ result: 'incomplete', stage: 'no-inference-check-started', checked_at: new Date().toISOString() }) + '\n');
    await createPrivateFile(path.join(reports, `${digest(started)}.json`), started, 'wx');
    await atomicWriteJson(receipt, { schema_version: 1, result: 'failed', identity, checked_at: new Date().toISOString(), report_sha256: digest(started), components, ...facts });
    const status = await runConformanceChild(argv, temporary, input.stderr, signal);
    signal?.throwIfAborted();
    const bytes = await readOwnedFile(output, 4 * 1024 * 1024);
    const report = JSON.parse(bytes.toString('utf8')) as { result?: string; network_observation?: { verdict?: string } };
    await input.beforeFinalReceipt?.({ identity, candidate });
    signal?.throwIfAborted();
    const passed = status === 0 && report.result === 'pass' && report.network_observation?.verdict === 'none-observed-control-validated';
    const savedReport = path.join(reports, `${digest(bytes)}.json`);
    try { await createPrivateFile(savedReport, bytes, 'wx'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await readOwnedFile(savedReport)) !== digest(bytes)) throw error; }
    await atomicWriteJson(receipt, { schema_version: 1, result: passed ? 'passed' : 'failed', identity, checked_at: new Date().toISOString(), report_sha256: digest(bytes), components, ...facts });
    return { status: passed ? 'passed' : 'failed', candidate_sha256: candidate, hosted_acceptance: 'unverified', report_sha256: digest(bytes), report_path: savedReport, findings: failingFindings(report) };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

function runConformanceChild(argv: string[], home: string, stderr: 'inherit' | 'ignore', signal: AbortSignal | undefined): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, argv, { stdio: ['ignore', 'ignore', stderr], env: { PATH: process.env.PATH, HOME: home, TMPDIR: home }, timeout: CONFORMANCE_TIMEOUT_MS });
    let escalation: NodeJS.Timeout | undefined;
    const abort = (): void => {
      child.kill('SIGTERM');
      escalation = setTimeout(() => { child.kill('SIGKILL'); }, CONFORMANCE_KILL_GRACE_MS);
      escalation.unref();
    };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => { clearTimeout(escalation); signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', (code) => {
      clearTimeout(escalation);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason); else resolve(code ?? 1);
    });
  });
}
