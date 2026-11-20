import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { SupervisorConfig } from '../contracts.js';
import { canonical, digest } from '../acceptance/schema.js';
import { getDataDir } from '../config/config.js';
import { resolveExecutableFile } from '../security/executable.js';
import { readOwnedFile } from '../reporting/private-files.js';
import { APP_VERSION } from '../version.js';
import { bootBoundSettings } from '../config/policy.js';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export interface PreparationStatus { status: 'passed' | 'failed' | 'missing' | 'stale'; candidate_sha256: string | null; version: string; reason: string }
export const preparationStatusSchema = z.object({status:z.enum(['passed','failed','missing','stale']),candidate_sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),version:z.string().max(128),reason:z.string().max(1000)}).strict();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const componentsSchema = z.object({ candidate: sha256Schema, pin: sha256Schema, node_major: sha256Schema, policy: sha256Schema }).strict();
export type PreparationComponents = z.infer<typeof componentsSchema>;
const componentLabels: Record<keyof PreparationComponents, string> = { candidate: 'candidate', pin: 'pin', node_major: 'Node major version', policy: 'policy' };
export type PreparationComponentName = keyof PreparationComponents;
export type PreparationOrigin = 'manual' | 'automatic';
const MAX_SETTING_NAMES = 20;
const MAX_SETTING_NAME_CHARS = 64;
const settingNamesSchema = z.object({ names: z.array(z.string().min(1).max(MAX_SETTING_NAME_CHARS)).min(1).max(MAX_SETTING_NAMES), total: z.number().int().positive() }).strict();
const settingsChangeSchema = z.object({ added: settingNamesSchema.optional(), removed: settingNamesSchema.optional() }).strict();
export type SettingsChange = z.infer<typeof settingsChangeSchema>;
const receiptSchema = z.object({ schema_version: z.literal(1), result: z.enum(['passed','failed']), identity: z.string().regex(/^[a-f0-9]{64}$/), checked_at: z.string().datetime(), report_sha256: z.string().regex(/^[a-f0-9]{64}$/), components: componentsSchema.optional(), origin: z.enum(['manual','automatic']).optional(), previous_worker_version: z.string().min(1).max(64).optional(), worker_version: z.string().min(1).max(64).optional(), baseline_report_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), settings_change: settingsChangeSchema.optional() }).strict();
type PreparationReceipt = z.infer<typeof receiptSchema>;
export interface PreparationProvenance { origin?: PreparationOrigin | undefined; previousWorkerVersion?: string | undefined; workerVersion?: string | undefined }
export function receiptProvenance(provenance: PreparationProvenance): Pick<PreparationReceipt, 'origin' | 'previous_worker_version' | 'worker_version'> {
  return receiptSchema.pick({ origin: true, previous_worker_version: true, worker_version: true }).parse({ ...(provenance.origin ? { origin: provenance.origin } : {}), ...(provenance.previousWorkerVersion ? { previous_worker_version: provenance.previousWorkerVersion } : {}), ...(provenance.workerVersion ? { worker_version: provenance.workerVersion.slice(0, 64) } : {}) });
}
export interface PreparationFacts {
  status: PreparationStatus;
  changed: PreparationComponentName[] | null;
  interrupted: boolean;
  origin?: PreparationOrigin;
  previous_worker_version?: string;
  worker_version?: string;
  checked_at?: string;
  settings_change?: SettingsChange;
}
export interface SettingsBaseline { reportSha256: string; keys: string[] }
export function effectiveTopLevelKeys(report: unknown): string[] | null {
  const runs = (report as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(runs)) return null;
  const keys = new Set<string>();
  let observed = false;
  for (const run of runs) {
    const item = run as { role?: unknown; observed?: { effective_top_level_keys?: unknown } | null } | null;
    const listed = item?.role === 'subject' ? item.observed?.effective_top_level_keys : undefined;
    if (!Array.isArray(listed)) continue;
    observed = true;
    for (const key of listed) if (typeof key === 'string' && key.length > 0) keys.add(key);
  }
  return observed ? [...keys].sort() : null;
}
function settingNames(keys: readonly string[]): SettingsChange['added'] {
  if (keys.length === 0) return undefined;
  return { names: keys.slice(0, MAX_SETTING_NAMES).map((key) => key.replace(/[^\x20-\x7e]/g, '?').slice(0, MAX_SETTING_NAME_CHARS)), total: keys.length };
}
export function settingsChange(before: readonly string[], after: readonly string[]): SettingsChange | undefined {
  const previous = new Set(before);
  const current = new Set(after);
  const added = settingNames([...current].filter((key) => !previous.has(key)).sort());
  const removed = settingNames([...previous].filter((key) => !current.has(key)).sort());
  if (!added && !removed) return undefined;
  return settingsChangeSchema.parse({ ...(added ? { added } : {}), ...(removed ? { removed } : {}) });
}
async function savedReportKeys(reports: string, sha256: string): Promise<string[] | null> {
  const bytes = await readOwnedFile(path.join(reports, `${sha256}.json`), 4*1024*1024).catch(() => null);
  if (!bytes || digest(bytes) !== sha256) return null;
  try { return effectiveTopLevelKeys(JSON.parse(bytes.toString('utf8'))); } catch { return null; }
}
export async function settingsBaseline(receiptFile: string): Promise<SettingsBaseline | null> {
  try {
    const receipt = receiptSchema.parse(JSON.parse((await readOwnedFile(receiptFile, 16*1024)).toString('utf8')));
    const reports = path.join(path.dirname(receiptFile), 'preparation-reports');
    for (const sha256 of [receipt.report_sha256, receipt.baseline_report_sha256]) {
      if (!sha256) continue;
      const keys = await savedReportKeys(reports, sha256);
      if (keys) return { reportSha256: sha256, keys };
    }
    return null;
  } catch { return null; }
}
export async function candidateIdentity(root = packageRoot): Promise<string> {
  const files: [string,string][] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(path.join(root,directory), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const relative = path.posix.join(directory,entry.name);
      if (entry.isSymbolicLink()) throw new Error('Linked candidate file');
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) files.push([relative,digest(await readFile(path.join(root,relative)))]);
    }
  };
  await walk('dist'); await walk('schemas');
  for (const file of ['package.json','scripts/v2-conformance-check.mjs']) files.push([file,digest(await readFile(path.join(root,file)))]);
  return digest(canonical(files));
}

export function receiptPath(config: SupervisorConfig, dataDirOverride?: string): string {
  if (config.backend === 'antigravity') {
    const dir = dataDirOverride ?? getDataDir();
    if (!path.isAbsolute(dir)) throw new Error('Absolute data directory required');
    return path.join(dir, 'preparation-receipt.json');
  }
  if (config.paths?.vibePinManifest && path.isAbsolute(config.paths.vibePinManifest)) {
    return path.join(path.dirname(config.paths.vibePinManifest), 'preparation-receipt.json');
  }
  if (dataDirOverride && path.isAbsolute(dataDirOverride)) {
    return path.join(dataDirOverride, 'preparation-receipt.json');
  }
  throw new Error('Absolute pin manifest required');
}
export function nodeMajor(version: string = process.versions.node): string {
  return version.replace(/^v/, '').split('.')[0] ?? version;
}

export async function preparationIdentity(config: SupervisorConfig, candidate?: string, nodeVersion: string = process.versions.node): Promise<string> {
  candidate ??= await candidateIdentity();
  const policy = bootBoundSettings(config);
  if (config.backend === 'antigravity') {
    const resolvedBinary = await resolveExecutableFile(config.paths?.antigravity ?? 'agy');
    const pinSha256 = digest(await readFile(resolvedBinary));
    return digest(canonical({ backend: 'antigravity', candidate, pin_sha256: pinSha256, policy, platform: process.platform, arch: process.arch, node_major: nodeMajor(nodeVersion) }));
  }
  const pin = config.paths?.vibePinManifest;
  if (!pin) throw new Error('Pin manifest required');
  return digest(canonical({ candidate, pin_sha256: digest(await readOwnedFile(await realpath(pin), 4*1024*1024)), policy, platform: process.platform, arch: process.arch, node_major: nodeMajor(nodeVersion) }));
}
export async function preparationComponents(config: SupervisorConfig, candidate?: string, nodeVersion: string = process.versions.node): Promise<PreparationComponents> {
  candidate ??= await candidateIdentity();
  const pinFile = config.backend === 'antigravity'
    ? await readFile(await resolveExecutableFile(config.paths?.antigravity ?? 'agy'))
    : await readOwnedFile(await realpath(requiredPin(config)), 4*1024*1024);
  return { candidate, pin: digest(pinFile), node_major: digest(nodeMajor(nodeVersion)), policy: digest(canonical(bootBoundSettings(config))) };
}
function requiredPin(config: SupervisorConfig): string {
  const pin = config.paths?.vibePinManifest;
  if (!pin) throw new Error('Pin manifest required');
  return pin;
}
function changedComponents(receipt: PreparationReceipt, current: PreparationComponents | null): PreparationComponentName[] | null {
  if (!receipt.components || !current) return null;
  const changed = (Object.keys(componentLabels) as PreparationComponentName[]).filter((key) => receipt.components![key] !== current[key]);
  return changed.length === 0 ? null : changed;
}
function staleReason(result: PreparationReceipt['result'], changed: PreparationComponentName[] | null): string {
  const had = `the stale receipt had ${result}`;
  if (!changed) return `Candidate, pin, runtime or policy changed; ${had}`;
  return `${changed.map((key) => componentLabels[key]).join(', ')} changed since the last check; ${had}; run prepare check again`;
}
function isIncompleteReport(bytes: Buffer): boolean {
  try { return (JSON.parse(bytes.toString('utf8')) as { result?: unknown } | null)?.result === 'incomplete'; }
  catch { return false; }
}
function receiptFacts(receipt: PreparationReceipt): Pick<PreparationFacts, 'origin' | 'previous_worker_version' | 'worker_version' | 'checked_at' | 'settings_change'> {
  return { ...(receipt.origin ? { origin: receipt.origin } : {}), ...(receipt.previous_worker_version ? { previous_worker_version: receipt.previous_worker_version } : {}), ...(receipt.worker_version ? { worker_version: receipt.worker_version } : {}), checked_at: receipt.checked_at, ...(receipt.settings_change ? { settings_change: receipt.settings_change } : {}) };
}
export async function readPreparationFacts(config: SupervisorConfig, dataDirOverride?: string): Promise<PreparationFacts> {
  let candidate: string | null = null;
  try {
    candidate = await candidateIdentity();
    const identity = await preparationIdentity(config,candidate);
    const targetReceiptPath = receiptPath(config, dataDirOverride);
    const receipt = receiptSchema.parse(JSON.parse((await readOwnedFile(targetReceiptPath,16*1024)).toString('utf8')));
    const facts = receiptFacts(receipt);
    const reportFile = path.join(path.dirname(targetReceiptPath), 'preparation-reports', `${receipt.report_sha256}.json`);
    const report = await readOwnedFile(reportFile, 4*1024*1024).then((bytes) => digest(bytes) === receipt.report_sha256 ? bytes : null, () => null);
    if (!report) return {status:{status:'stale',candidate_sha256:candidate,version:APP_VERSION,reason:'The receipt exists but its saved preparation report is missing or changed; run prepare check again'},changed:null,interrupted:false,...facts};
    if (receipt.identity !== identity) {
      const current = receipt.components ? await preparationComponents(config, candidate).catch(() => null) : null;
      const changed = changedComponents(receipt, current);
      return {status:{status:'stale',candidate_sha256:candidate,version:APP_VERSION,reason:staleReason(receipt.result,changed)},changed,interrupted:false,...facts};
    }
    return {status:{status:receipt.result,candidate_sha256:candidate,version:APP_VERSION,reason:'Version-matched no-inference evidence; hosted acceptance remains separate'},changed:null,interrupted:receipt.result === 'failed' && isIncompleteReport(report),...facts};
  } catch(error) {
    const failure = error as NodeJS.ErrnoException & { details?: { reason?: string } };
    const missing = failure.code === 'ENOENT' || (failure.code === 'VSUP_ARTIFACT_ERROR' && failure.details?.reason === 'missing');
    return {status:{status:missing ? 'missing' : 'stale',candidate_sha256:candidate,version:APP_VERSION,reason:'No usable matching preparation receipt'},changed:null,interrupted:false};
  }
}
export async function checkPreparation(config: SupervisorConfig, dataDirOverride?: string): Promise<PreparationStatus> {
  return (await readPreparationFacts(config, dataDirOverride)).status;
}
