import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { loadResolvedConfig } from '../config/config.js';
import { isOwnerLockContention } from '../core/owner-lock.js';
import { candidateIdentity, packageRoot, preparationIdentity } from '../preparation/evidence.js';
import { acquirePreparationLock, preparationRunningMessage } from '../preparation/lock.js';
import { runPreparation, type PreparationResult } from '../preparation/run.js';
import { digest } from '../acceptance/schema.js';
export { failingFindings, type ReportedFinding } from '../preparation/run.js';
const manifestSchema = z.object({schema_version:z.literal(1),version:z.string(),candidate_sha256:z.string().regex(/^[a-f0-9]{64}$/),script_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function prepareCommand(args: string[]): Promise<PreparationResult> {
  if(args[0] !== 'check') throw new Error('Usage: prepare check --kit <directory> --config <file>');
  const values = new Map<string,string>();
  for(let i=1;i<args.length;i+=2){ const key=args[i]!;const value=args[i+1];if(!['--kit','--config'].includes(key)||!value||values.has(key))throw new Error('Invalid preparation arguments');values.set(key,value); }
  if(!values.has('--config') || !values.has('--kit'))throw new Error('Kit and config are required');
  const candidate=await candidateIdentity();
  const kit=await realpath(values.get('--kit')!);
  const manifest=manifestSchema.parse(JSON.parse(await readFile(path.join(kit,'manifest.json'),'utf8')));
  const script=path.join(kit,'v2-conformance-check.mjs');
  const scriptHash=digest(await readFile(script));
  if(manifest.candidate_sha256!==candidate || scriptHash!==manifest.script_sha256 || scriptHash!==digest(await readFile(path.join(packageRoot,'scripts/v2-conformance-check.mjs'))))throw new Error('Preparation kit does not match installed candidate');
  const preliminary=await loadResolvedConfig({configPath:values.get('--config')!,requirePinManifest:false});
  const antigravity = preliminary.config.backend === 'antigravity';
  const resolved = antigravity ? preliminary : await loadResolvedConfig({configPath:values.get('--config')!,requirePinManifest:true});
  const requirePinManifest = !antigravity;
  const beforeFinalReceipt = async (written: { identity: string; candidate: string }): Promise<void> => {
    const current = await loadResolvedConfig({ configPath: resolved.configPath, requirePinManifest });
    const changed = antigravity
      ? await preparationIdentity(current.config, written.candidate) !== await preparationIdentity(resolved.config, written.candidate)
      : await preparationIdentity(current.config) !== written.identity;
    if (changed) throw new Error('Candidate or configuration changed during check');
  };
  const lock = await acquirePreparationLock(resolved.config, resolved.dataDir).catch((error: unknown) => {
    throw isOwnerLockContention(error) ? new Error(preparationRunningMessage(error)) : error;
  });
  try {
    return await runPreparation({ config: resolved.config, configPath: resolved.configPath, dataDir: resolved.dataDir, stderr: 'inherit', conformanceScript: script, beforeFinalReceipt });
  } finally { await lock.release(); }
}
