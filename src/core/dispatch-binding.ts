import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonical, contractDigest, digest, type AcceptanceContract } from '../acceptance/schema.js';
import { supervisorError, type RunLimits, type RunMode, type SupervisorConfig } from '../contracts.js';
import { candidateIdentity } from '../preparation/evidence.js';
import { resolveContextFile } from '../security/paths.js';
import { contentDigest } from './workspace-snapshot.js';

export const DISPATCH_BINDING_FIELDS = ['candidate', 'node_version', 'node_executable', 'platform', 'pin_manifest', 'policy', 'backend', 'operation', 'workspace', 'task', 'base_commit', 'review_content', 'context_files', 'output', 'acceptance_contract', 'prepared_inputs', 'limits'] as const;
export type DispatchBindingField = typeof DISPATCH_BINDING_FIELDS[number];
const SERVER_RUNTIME_BINDING_FIELDS: ReadonlySet<string> = new Set(['candidate', 'node_version', 'node_executable', 'platform', 'pin_manifest', 'policy', 'backend']);
export interface DispatchBinding { requestSha256: string; fields: Record<DispatchBindingField, string> }

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
  limits: RunLimits;
}

export async function dispatchBinding(input: DispatchBindingInput): Promise<DispatchBinding> {
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
  const values: Record<DispatchBindingField, unknown> = {
    candidate: await candidateIdentity(),
    node_version: process.version,
    node_executable: await realpath(process.execPath),
    platform: `${process.platform}-${process.arch}`,
    pin_manifest: pinSha256,
    policy: input.policyRevision,
    backend: input.config.backend ?? 'app-server',
    operation: input.mode,
    workspace: input.workspace,
    task: digest(input.task),
    base_commit: input.baseCommit ?? null,
    review_content: reviewSnapshot,
    context_files: context,
    output: input.output ?? 'text',
    acceptance_contract: input.acceptanceContract ? contractDigest(input.acceptanceContract) : null,
    prepared_inputs: input.preparedManifestSha256 ?? null,
    limits: input.limits
  };
  const fields = Object.fromEntries(DISPATCH_BINDING_FIELDS.map((field) => [field, digest(canonical(values[field]))])) as Record<DispatchBindingField, string>;
  return { requestSha256: digest(canonical({ schema_version: 3, fields })), fields };
}

export function bindingMismatchError(registered: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>, subject: string): Error {
  const differing = [...new Set([...Object.keys(registered), ...Object.keys(current)])].filter((field) => registered[field] !== current[field]).sort();
  const runtimeHint = differing.some((field) => SERVER_RUNTIME_BINDING_FIELDS.has(field)) ? ' Run task authorize with the same vibe-supervisor install, Node executable and --config as the MCP server.' : '';
  const message = `${subject} in: ${differing.join(', ')}.${runtimeHint}`;
  return Object.assign(new Error(message), supervisorError('VSUP_AUTHORIZATION_INVALID', message, { differing_fields: differing }));
}
