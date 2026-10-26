import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonical, contractDigest, digest, type AcceptanceContract } from '../acceptance/schema.js';
import { supervisorError, type RunLimits, type RunMode, type SupervisorConfig } from '../contracts.js';
import { candidateIdentity } from '../preparation/evidence.js';
import { resolveContextFile } from '../security/paths.js';
import { contentDigest } from './workspace-snapshot.js';

export interface DispatchBindingInput {
  config: SupervisorConfig;
  policyRevision: string;
  mode: RunMode;
  workspace: string;
  task: string;
  baseCommit?: string;
  contextFiles: readonly string[];
  output?: 'text' | 'findings';
  acceptanceContract?: AcceptanceContract;
  preparedManifestSha256?: string;
  allowedWritePaths?: readonly string[];
  limits: RunLimits;
}

export async function dispatchDigest(input: DispatchBindingInput): Promise<string> {
  const context: Array<{ path: string; sha256: string }> = [];
  for (const file of input.contextFiles) {
    const resolved = await resolveContextFile(input.workspace, file);
    context.push({ path: path.relative(input.workspace, resolved), sha256: digest(await readFile(resolved)) });
  }
  const pinPath = input.config.paths?.vibePinManifest;
  let pinSha256: string | null = null;
  if (pinPath) {
    try { pinSha256 = digest(await readFile(pinPath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let reviewSnapshot: string | null = null;
  if (input.mode === 'review') {
    try { reviewSnapshot = await contentDigest(input.workspace); }
    catch { throw Object.assign(new Error('The workspace cannot be bound to this dispatch.'), supervisorError('VSUP_AUTHORIZATION_INVALID', 'The workspace cannot be bound to this dispatch.')); }
  }
  return digest(canonical({
    schema_version: 3,
    candidate_sha256: await candidateIdentity(),
    runtime: { node: process.version, executable: await realpath(process.execPath), platform: process.platform, arch: process.arch, pin_sha256: pinSha256 },
    policy_revision: input.policyRevision,
    backend: input.config.backend ?? 'app-server',
    operation: input.mode,
    workspace: input.workspace,
    task_sha256: digest(input.task),
    base_commit: input.baseCommit ?? null,
    review_content_sha256: reviewSnapshot,
    context,
    output: input.output ?? 'text',
    contract_sha256: input.acceptanceContract ? contractDigest(input.acceptanceContract) : null,
    prepared_manifest_sha256: input.preparedManifestSha256 ?? null,
    allowed_write_paths: input.allowedWritePaths ?? null,
    limits: input.limits
  }));
}
