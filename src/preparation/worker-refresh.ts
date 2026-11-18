import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../acceptance/schema.js';
import type { BackendKind, SupervisorConfig, SupervisorError, WorkerPinTarget } from '../contracts.js';
import { supervisorError } from '../contracts.js';
import type { OwnerLock } from '../core/owner-lock.js';
import { generatePinManifest, loadPinManifest, locateEnvironment, PinCheckError, type PinGenerateOptions, type PinManifest } from '../backends/app-server/pin.js';
import { replacePinManifest, type PinReplacement } from '../backends/app-server/pin-replace.js';
import { receiptPath, type PreparationComponentName, type PreparationFacts } from './evidence.js';
import { acquirePreparationLock } from './lock.js';
import { runPreparation, type PreparationResult, type ReportedFinding, type RunPreparationInput } from './run.js';

export type RefreshAction = 'none' | 'repin' | 'prepare';
export type RefreshStage = 'pinning' | 'preparing' | 'locked' | 'install_unsettled';
export type RefreshHold = 'stopping' | 'boot_drift' | 'no_config_path' | 'busy';

export interface RefreshObservation {
  backend: BackendKind;
  pinReason: string | null;
  facts: PreparationFacts | null;
}

export interface RefreshConditions {
  stopping: boolean;
  bootDrift: readonly string[];
  configPath: string | null;
  busy: boolean;
}

const PREPARE_ONLY_COMPONENTS: ReadonlySet<PreparationComponentName> = new Set<PreparationComponentName>(['pin', 'policy', 'node_major']);
const UNSETTLED_PIN_REASONS: ReadonlySet<string> = new Set(['dist-info-missing', 'dist-info-ambiguous', 'record-unhashed', 'record-hash-mismatch', 'file-missing']);
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 16 * 1024;
const PREVIOUS_BINARY_PREFIX = 'sha256:';
const PREVIOUS_BINARY_DIGITS = 12;

export function decideRefresh(observed: RefreshObservation): RefreshAction {
  if (observed.pinReason !== null) return observed.backend === 'app-server' && observed.pinReason === 'manifest-version-mismatch' ? 'repin' : 'none';
  const facts = observed.facts;
  if (!facts) return 'none';
  if (facts.interrupted) return 'prepare';
  if (facts.status.status !== 'stale' || !facts.changed || facts.changed.length === 0) return 'none';
  return facts.changed.every((component) => PREPARE_ONLY_COMPONENTS.has(component)) ? 'prepare' : 'none';
}

export function refreshHold(conditions: RefreshConditions): RefreshHold | null {
  if (conditions.stopping) return 'stopping';
  if (conditions.bootDrift.length > 0) return 'boot_drift';
  if (!conditions.configPath) return 'no_config_path';
  if (conditions.busy) return 'busy';
  return null;
}

export function isUnsettledPinReason(reason: string): boolean {
  return UNSETTLED_PIN_REASONS.has(reason);
}

export function previousBinaryLabel(pinSha256: string): string {
  return `${PREVIOUS_BINARY_PREFIX}${pinSha256.slice(0, PREVIOUS_BINARY_DIGITS)}`;
}

export function workerDisplayName(backend: BackendKind): string {
  return backend === 'antigravity' ? 'Antigravity CLI' : 'Vibe';
}

export function refreshWarning(backend: BackendKind, from: string, to: string | null): string {
  const target = to ?? (backend === 'antigravity' ? 'the installed binary' : 'the installed version');
  const source = backend === 'antigravity' && from.startsWith(PREVIOUS_BINARY_PREFIX) ? `(previous binary ${from})` : from;
  return `${workerDisplayName(backend)} ${source} -> ${target} was refreshed automatically; no-inference preparation passed; hosted quality has not been re-run on this version.`;
}

export async function installIdentity(target: WorkerPinTarget): Promise<string | null> {
  try {
    const located = await locateEnvironment(target.executable, target.minimumVersion);
    const record = path.join(located.distInfo, 'RECORD');
    if ((await stat(record)).size > MAX_RECORD_BYTES) return null;
    return `${located.version}:${digest(await readFile(record))}`;
  } catch { return null; }
}

async function manifestVersion(manifestPath: string): Promise<string | undefined> {
  try { return (await loadPinManifest(manifestPath)).version; }
  catch { return undefined; }
}

async function receiptPinComponent(config: SupervisorConfig, dataDir: string): Promise<string | undefined> {
  try {
    const file = receiptPath(config, dataDir);
    if ((await stat(file)).size > MAX_RECEIPT_BYTES) return undefined;
    const pin = (JSON.parse((await readFile(file)).toString('utf8')) as { components?: { pin?: unknown } } | null)?.components?.pin;
    return typeof pin === 'string' && /^[a-f0-9]{64}$/.test(pin) ? pin : undefined;
  } catch { return undefined; }
}

export function pinFailureError(error: PinCheckError): SupervisorError {
  return supervisorError(error.code, error.message.slice(0, 500), { reason: error.reason, ...error.details });
}

export interface WorkerRefreshDependencies {
  acquireLock(config: SupervisorConfig, dataDir: string): Promise<OwnerLock>;
  generatePinManifest(options: PinGenerateOptions): Promise<PinManifest>;
  replacePinManifest(manifestPath: string, manifest: PinManifest): Promise<PinReplacement>;
  runPreparation(input: RunPreparationInput): Promise<PreparationResult>;
}

export const defaultWorkerRefreshDependencies: WorkerRefreshDependencies = {
  acquireLock: (config, dataDir) => acquirePreparationLock(config, dataDir),
  generatePinManifest: (options) => generatePinManifest(options),
  replacePinManifest: (manifestPath, manifest) => replacePinManifest(manifestPath, manifest),
  runPreparation: (input) => runPreparation(input)
};

export interface WorkerRefreshPlan {
  backend: BackendKind;
  config: SupervisorConfig;
  configPath: string;
  dataDir: string;
  signal: AbortSignal;
  pinTarget?: WorkerPinTarget | undefined;
  workerVersion(): Promise<string | null>;
  assess(): Promise<{ action: RefreshAction; facts: PreparationFacts | null }>;
  onStage(stage: 'pinning' | 'preparing', from: string | undefined, to: string | undefined): void;
}

export type RefreshOutcome =
  | { kind: 'not_needed' }
  | { kind: 'install_unsettled'; reason: string; from?: string | undefined; to?: string | undefined }
  | { kind: 'pin_failed'; error: SupervisorError; identity: string | null; from?: string | undefined; to?: string | undefined }
  | { kind: 'prepared'; passed: boolean; repinned: boolean; from?: string | undefined; to?: string | undefined; reportPath: string; findings: ReportedFinding[] }
  | { kind: 'aborted' }
  | { kind: 'failed'; error: SupervisorError };

export async function runWorkerRefresh(plan: WorkerRefreshPlan, lock: OwnerLock, dependencies: WorkerRefreshDependencies = defaultWorkerRefreshDependencies): Promise<RefreshOutcome> {
  const { signal } = plan;
  try {
    signal.throwIfAborted();
    const { action, facts } = await plan.assess();
    if (action === 'none') return { kind: 'not_needed' };
    let from = facts?.previous_worker_version;
    let to = (await plan.workerVersion()) ?? undefined;
    let repinned = false;
    if (action === 'repin') {
      const target = plan.pinTarget;
      if (!target) return { kind: 'failed', error: supervisorError('VSUP_VIBE_VERSION_UNSUPPORTED', 'The Vibe pin target is not available, so the manifest cannot be refreshed.', { reason: 'manifest-unreadable' }) };
      from = await manifestVersion(target.manifestPath);
      plan.onStage('pinning', from, to);
      const identity = await installIdentity(target);
      let manifest: PinManifest;
      try { manifest = await dependencies.generatePinManifest({ executable: target.executable, expectedVersion: target.minimumVersion, requireRecordHashes: true, signal }); }
      catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof PinCheckError)) throw error;
        if (isUnsettledPinReason(error.reason)) return { kind: 'install_unsettled', reason: error.reason, from, to };
        return { kind: 'pin_failed', error: pinFailureError(error), identity, from, to };
      }
      signal.throwIfAborted();
      to = manifest.version;
      const replaced = await dependencies.replacePinManifest(target.manifestPath, manifest);
      from = replaced.previousVersion ?? from;
      repinned = true;
    } else if (plan.backend === 'antigravity' && facts?.changed?.includes('pin')) {
      const previous = await receiptPinComponent(plan.config, plan.dataDir);
      if (previous) from = previousBinaryLabel(previous);
    }
    plan.onStage('preparing', from, to);
    signal.throwIfAborted();
    const result = await dependencies.runPreparation({ config: plan.config, configPath: plan.configPath, dataDir: plan.dataDir, stderr: 'ignore', signal, origin: 'automatic', previousWorkerVersion: from });
    return { kind: 'prepared', passed: result.status === 'passed', repinned, from, to, reportPath: result.report_path, findings: result.findings };
  } catch (error) {
    if (signal.aborted) return { kind: 'aborted' };
    const failure = error instanceof PinCheckError ? pinFailureError(error) : supervisorError('VSUP_INTERNAL', `The worker refresh failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
    return { kind: 'failed', error: failure };
  } finally {
    await lock.release().catch(() => undefined);
  }
}

export function refreshSummary(backend: BackendKind, outcome: RefreshOutcome): string | undefined {
  const name = workerDisplayName(backend);
  const span = (from?: string, to?: string): string => from || to ? `${name} ${from ?? 'unknown'} -> ${to ?? 'unknown'}` : name;
  switch (outcome.kind) {
    case 'prepared': return `${span(outcome.from, outcome.to)}: ${outcome.repinned ? 're-pinned, ' : ''}preparation ${outcome.passed ? 'passed' : 'failed'}`;
    case 'install_unsettled': return `${span(outcome.from, outcome.to)}: install still changing (${outcome.reason}); will retry at the next readiness check`;
    case 'pin_failed': return `${span(outcome.from, outcome.to)}: re-pin refused (${String(outcome.error.details?.reason ?? outcome.error.code)})`;
    case 'failed': return `${name} refresh failed (${outcome.error.code})`;
    case 'aborted': return `${name} refresh stopped by shutdown; the next server retries it`;
    default: return undefined;
  }
}
