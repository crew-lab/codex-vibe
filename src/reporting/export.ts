import { elapsed, reportUsage, thinkingProvenance } from './telemetry.js';
import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { RunRecord } from '../contracts.js';
import { MAX_APPROVAL_LEDGER_RECORDS } from '../contracts.js';
import { pinToWire, runFromWire } from '../core/serialization.js';
import { sanitizeForPersistence } from '../persistence/atomic.js';
import { environmentSecrets, patchContainsCredential } from '../security/redaction.js';
import { contractDigest, digest, validationSchema, verificationSummary } from '../acceptance/schema.js';
import { verifySaved } from '../acceptance/verify.js';
import { assertOwnedDirectory, readOwnedFile } from './private-files.js';

const uuid = z.string().uuid({ version: 'v4' });
const ledgerText = z.string().max(4096).nullable();
const approvalLedgerSchema = z.object({
  schema_version: z.literal(1), run_id: uuid, truncated: z.boolean(),
  records: z.array(z.object({ callback_id: z.string().min(1).max(4096), related_entry_id: ledgerText, turn_id: ledgerText, tool: ledgerText, path: ledgerText, fingerprint: ledgerText, decision: z.enum(['approve', 'deny']), reason: ledgerText }).strict()).max(MAX_APPROVAL_LEDGER_RECORDS)
}).strict();
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const validationManifest = z.object({ schema_version: z.literal(1), patch_sha256: z.string().regex(/^[a-f0-9]{64}$/), validations: z.array(validationSchema).max(100) }).strict();
export function publicValue(value: unknown): unknown {
  const walk=(input:unknown):unknown=>{
    if(typeof input==='string')return path.isAbsolute(input)?'<private-path>':input.replace(/(^|[\s(='"])(\/(?!\/)[^\s"'`,;)\]}]+)/g,'$1<private-path>');
    if(Array.isArray(input))return input.map(walk);
    if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).map(([key,child])=>[key,walk(child)]));
    return input;
  };
  return walk(sanitizeForPersistence(value));
}

export async function locateSavedRun(dataDir: string, runId: string): Promise<string> {
  uuid.parse(runId); await assertOwnedDirectory(dataDir);
  const candidates: string[] = [];
  const inspect = async (home: string): Promise<void> => {
    await assertOwnedDirectory(home);
    const directory = path.join(home, 'runs', runId);
    try { await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await assertOwnedDirectory(path.join(home, 'runs')); await assertOwnedDirectory(directory);
    const record = runFromWire(JSON.parse((await readOwnedFile(path.join(directory, 'meta.json'), 1024 * 1024)).toString('utf8')));
    if (record.runId !== runId) throw new Error('Run identity mismatch');
    candidates.push(directory);
  };
  await inspect(dataDir);
  const sessions = path.join(dataDir, 'mcp-sessions');
  try {
    await assertOwnedDirectory(sessions); const entries = await readdir(sessions);
    if (entries.length > 128) throw new Error('Too many isolated sessions');
    for (const name of entries.filter((entry) => /^session-[A-Za-z0-9]{6}$/.test(entry))) await inspect(path.join(sessions, name));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (candidates.length !== 1) throw new Error(candidates.length ? 'Ambiguous saved run' : 'Run not found');
  return candidates[0]!;
}

export const OUTSIDE_WORKSPACE = '<outside-workspace>';

function workspaceRelative(candidate: string, workspaces: readonly string[]): string | undefined {
  for (const workspace of workspaces) {
    const relative = path.relative(workspace, path.resolve(candidate));
    if (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
  }
  return undefined;
}

export function exportedLedgerPath(raw: string | null, workspaces: readonly string[]): string | null {
  if (raw === null) return null;
  let candidate = raw;
  if (/^file:/i.test(candidate)) {
    try { candidate = fileURLToPath(candidate); } catch { return OUTSIDE_WORKSPACE; }
  }
  if (candidate.includes('\0') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate) || candidate.startsWith('~') || candidate.startsWith('\\')) return OUTSIDE_WORKSPACE;
  if (path.isAbsolute(candidate)) return workspaceRelative(candidate, workspaces) ?? OUTSIDE_WORKSPACE;
  const segments = candidate.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) return OUTSIDE_WORKSPACE;
  return segments.join('/');
}

function exportedLedger(ledger: z.infer<typeof approvalLedgerSchema>, record: RunRecord): z.infer<typeof approvalLedgerSchema> {
  const workspaces = [...new Set([record.workerWorkspace, record.worktree?.path, record.sourceWorkspace].filter((value): value is string => typeof value === 'string' && path.isAbsolute(value)))];
  return { ...ledger, records: ledger.records.map((entry) => ({ ...entry, path: exportedLedgerPath(entry.path, workspaces) })) };
}

async function approvalLedger(directory: string, record: RunRecord): Promise<{ ledger: z.infer<typeof approvalLedgerSchema>; sha256: string } | undefined> {
  const file = path.join(directory, 'artifacts', 'approvals.json');
  const listed = record.result?.artifacts?.find((item) => item.name === 'approvals.json');
  try { await lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (listed) throw new Error('The approval ledger listed in the run artifacts is missing');
    return undefined;
  }
  const bytes = await readOwnedFile(file, MAX_LEDGER_BYTES);
  if (!listed || listed.sha256 !== digest(bytes)) throw new Error('Approval ledger does not match the saved artifact digest');
  const ledger = approvalLedgerSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (ledger.run_id !== record.runId) throw new Error('Approval ledger belongs to another run');
  return { ledger, sha256: digest(bytes) };
}

async function diagnosticProjection(directory: string, record: RunRecord): Promise<{ events: unknown[]; counts: Record<string, number>; complete: boolean; gaps: number }> {
  try {
    const bytes = await readOwnedFile(path.join(directory, 'events.ndjson'), record.limits.maxEventBytes);
    const events: unknown[] = []; const counts: Record<string, number> = Object.create(null) as Record<string, number>;
    let previous = 0; let gaps = 0;
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
      const e = JSON.parse(line) as Record<string, unknown>; const data = e.data && typeof e.data === 'object' ? e.data as Record<string, unknown> : {};
      if (typeof e.seq !== 'number' || e.seq !== previous + 1) gaps++;
      if (typeof e.seq === 'number') previous = e.seq;
      const name = typeof data.name === 'string' ? data.name.slice(0, 100) : 'unknown';
      const outcome = typeof data.outcome === 'string' ? data.outcome.slice(0, 100) : 'unknown';
      const type = typeof e.type === 'string' ? e.type.slice(0, 100) : 'unknown';
      const key = `${type}:${name}:${outcome}`; counts[key] = (counts[key] ?? 0) + 1;
      if (events.length < 10_000) events.push({ seq: e.seq, timestamp: e.timestamp, type, severity: e.severity, name, outcome,
        ...(typeof data.reason === 'string' ? { reason: data.reason.slice(0, 100) } : {}),
        ...(data.reason === 'reasoning_observation' ? {
          ...(Number.isSafeInteger(data.streamed_entries) && (data.streamed_entries as number) >= 0 ? { streamed_entries: data.streamed_entries } : {}),
          ...(data.history_entries === null || (Number.isSafeInteger(data.history_entries) && (data.history_entries as number) >= 0) ? { history_entries: data.history_entries } : {}),
          ...(typeof data.history_audited === 'boolean' ? { history_audited: data.history_audited } : {})
        } : {})
      });
    }
    return { events, counts, complete: events.length === previous && gaps === 0, gaps };
  } catch { return { events: [], counts: {}, complete: false, gaps: 0 }; }
}

export async function exportReport(options: { directory: string; output: string; include?: readonly ('patch' | 'events')[]; validationFile?: string; verifyOnly?: boolean }): Promise<Record<string, unknown>> {
  await assertOwnedDirectory(options.directory);
  const record = runFromWire(JSON.parse((await readOwnedFile(path.join(options.directory, 'meta.json'), 1024 * 1024)).toString('utf8')));
  if (!['awaiting_validation', 'completed', 'failed', 'cancelled', 'closed'].includes(record.state)) throw new Error('Only audited candidates and settled runs may be exported');
  const verification = await verifySaved(options.directory, record.acceptanceContract, record.limits.maxArtifactBytes);
  const patchArtifact = record.result?.artifacts?.find((item) => item.name === 'diff.patch');
  const diagnostics = await diagnosticProjection(options.directory, record);
  const approvals = await approvalLedger(options.directory, record);
  const observations = record.modelObservations ?? [];
  const requestedModels = observations.map((observation) => observation.requested_model);
  const modelRequestIsProven = observations.length > 0 && observations.every((observation) => typeof observation.requested_model === 'string' && observation.requested_model_source === 'explicit-selection');
  const requestedModel = modelRequestIsProven && requestedModels.every((value) => value === requestedModels[0]) ? requestedModels[0]! : null;
  const exportedApprovals = approvals ? Buffer.from(JSON.stringify(publicValue(exportedLedger(approvals.ledger, record)), null, 2) + '\n') : undefined;
  let external: unknown = null;
  if (options.validationFile) {
    const manifest = validationManifest.parse(JSON.parse((await readOwnedFile(options.validationFile, 256 * 1024)).toString('utf8')));
    if (manifest.patch_sha256 !== patchArtifact?.sha256) throw new Error('External validation refers to another patch');
    if (new Set(manifest.validations.map((item) => item.id)).size !== manifest.validations.length) throw new Error('Duplicate validation IDs');
    external = { source: 'coordinator-reported', ...manifest };
  }
  const assessments = record.assessments ?? [];
  const currentAssessment = record.sessionMode === 'correctable'
    ? assessments.find((item) => item.candidate_revision === record.candidateRevision && item.patch_sha256 === record.candidatePatchSha256)
    : assessments.at(-1);
  const report = publicValue({
    schema_version: 1, report_version: 2, run_id: record.runId, supervisor_version: record.supervisorVersion ?? null, mode: record.mode,
    ...(record.mode === 'review' ? { context_file_count: record.contextFileCount ?? null } : {}),
    execution: { state: verification.execution_state ?? record.executionState ?? (record.state === 'closed' ? 'unknown' : record.state), stop_reason: record.result?.stopReason ?? null },
    verification: verificationSummary(verification), assessment: currentAssessment?.decision ?? 'unassessed', assessments,
    provenance: { ...(record.dispatch ? { dispatch: record.dispatch } : {}), task_sha256: record.taskSha256, base_commit: verification.base_commit ?? record.worktree?.baseRef ?? null, patch_sha256: patchArtifact?.sha256 ?? null, contract_sha256: record.acceptanceContract ? contractDigest(record.acceptanceContract) : null, policy_revision: record.policyRevision ?? null },
    timestamps: { created: record.createdAt, launched: record.launchedAt ?? null, started: record.startedAt ?? null, finished: record.finishedAt ?? null },
    preparation: record.preparation ?? {status:"unknown"},
    models: {
      observations,
      display_labels: observations.map((observation) => ({ session_model: observation.session_model, alias: observation.alias, reported_name: observation.reported_name ?? null })),
      requested_model: { value: requestedModel, source: requestedModel === null ? 'unavailable' : 'explicit-selection' },
      thinking: thinkingProvenance(observations),
      provider: null,
      underlying_model: null,
      unavailable_reason: "Runtime-reported model names, aliases and thinking are labels only; provider and underlying weights remain unverified."
    },
    durations_ms: { inference: null, finalization: null, preparation: elapsed(record.createdAt, record.launchedAt), startup: elapsed(record.launchedAt, record.startedAt), execution_and_finalization: elapsed(record.startedAt, record.finishedAt), total: elapsed(record.createdAt, record.finishedAt) },
    ...(record.pin ? { pin: pinToWire(record.pin) } : {}),
    ...(approvals && exportedApprovals ? { approvals: { file: 'approvals.json', source_sha256: approvals.sha256, exported_sha256: digest(exportedApprovals), records: approvals.ledger.records.length, truncated: approvals.ledger.truncated } } : {}),
    usage: reportUsage(record.usage), limits: record.limits, warnings: record.result?.warnings ?? [], error: record.error ?? null,
    cleanup: record.cleanup ?? { worktree: 'unknown', reason: 'Cleanup evidence was not recorded or the run has not settled' }, external_validation: external
  }) as Record<string, unknown>;
  const files: Record<string, Buffer> = {
    'report.json': Buffer.from(JSON.stringify(report, null, 2) + '\n'),
    'checks.json': Buffer.from(JSON.stringify(publicValue(verification), null, 2) + '\n'),
    'diagnostics.json': Buffer.from(JSON.stringify(publicValue({ complete: diagnostics.complete, sequence_gaps: diagnostics.gaps, counts: diagnostics.counts }), null, 2) + '\n')
  };
  files['REPORT.md'] = Buffer.from(`# Vibe run ${record.runId}\n\nExecution: ${String((report.execution as Record<string, unknown>).state)} / ${record.result?.stopReason ?? 'unknown'}.\nAutomated verification: ${verification.status}. Coordinator assessment: ${String(report.assessment)}.\n\nSee report.json, checks.json and diagnostics.json. External validations are coordinator-reported. Missing metrics remain unknown. This bundle does not claim hosted or release acceptance.\n`);
  if (exportedApprovals) files['approvals.json'] = exportedApprovals;
  if (options.include?.includes('patch')) {
    if (!patchArtifact || path.resolve(patchArtifact.path) !== path.join(options.directory, 'artifacts', 'diff.patch')) throw new Error('No trusted patch artifact');
    const patch = await readOwnedFile(patchArtifact.path, record.limits.maxArtifactBytes);
    if (digest(patch) !== patchArtifact.sha256 || patchContainsCredential(patch.toString('utf8'), environmentSecrets())) throw new Error('Patch inclusion refused; bytes are never redacted');
    files['changes.patch'] = patch;
  }
  if (options.include?.includes('events')) files['events.json'] = Buffer.from(JSON.stringify(publicValue(diagnostics.events), null, 2) + '\n');
  const sums = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${digest(bytes)}  ${name}`).join('\n') + '\n';
  files.SHA256SUMS = Buffer.from(sums);
  if (Object.values(files).reduce((total, bytes) => total + bytes.length, 0) > record.limits.maxArtifactBytes) throw new Error('Report exceeds artifact budget');
  const destination = path.resolve(options.output); await assertOwnedDirectory(path.dirname(destination));
  try { await lstat(destination); throw new Error('Output already exists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = path.join(path.dirname(destination), `.report-${randomUUID()}`); await mkdir(staging, { mode: 0o700 });
  try {
    for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(staging, name), bytes, { mode: 0o600, flag: 'wx' });
    await mkdir(destination, { mode: 0o700 });
    for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(destination, name), bytes, { mode: 0o600, flag: 'wx' });
  } finally { await rm(staging, { recursive: true, force: true }); }
  return { run_id: record.runId, verification: verification.status, output: destination, files: Object.keys(files), ...(options.verifyOnly ? { operation: 'verify' } : {}) };
}
