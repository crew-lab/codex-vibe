import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { SupervisorConfig } from '../contracts.js';
import { canonical, digest } from '../acceptance/schema.js';
import { executableSearchPath, getDataDir } from '../config/config.js';
import { readOwnedFile } from '../reporting/private-files.js';
import { APP_VERSION } from '../version.js';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export interface PreparationStatus { status: 'passed' | 'failed' | 'missing' | 'stale'; candidate_sha256: string | null; version: string; reason: string }
export const preparationStatusSchema = z.object({status:z.enum(['passed','failed','missing','stale']),candidate_sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),version:z.string().max(128),reason:z.string().max(1000)}).strict();
const receiptSchema = z.object({ schema_version: z.literal(1), result: z.enum(['passed','failed']), identity: z.string().regex(/^[a-f0-9]{64}$/), checked_at: z.string().datetime(), report_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
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

async function resolveAntigravityBinaryPath(cmd: string): Promise<string> {
  if (path.isAbsolute(cmd)) return realpath(cmd);
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of executableSearchPath()) {
    for (const ext of extensions) {
      try {
        return await realpath(path.join(directory, `${cmd}${ext}`));
      } catch {
        // continue searching PATH
      }
    }
  }
  throw new Error(`Antigravity executable not found: ${cmd}`);
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
  throw new Error('Absolute pin manifest required');
}
export async function preparationIdentity(config: SupervisorConfig, candidate?: string): Promise<string> {
  candidate ??= await candidateIdentity();
  const policy = { ...config, allowedWorkspaceRoots: [] };
  if (config.backend === 'antigravity') {
    const resolvedBinary = await resolveAntigravityBinaryPath(config.paths?.antigravity ?? 'agy');
    const pinSha256 = digest(await readFile(resolvedBinary));
    return digest(canonical({ backend: 'antigravity', candidate, pin_sha256: pinSha256, policy, platform: process.platform, arch: process.arch, node: process.version }));
  }
  const pin = config.paths?.vibePinManifest;
  if (!pin) throw new Error('Pin manifest required');
  return digest(canonical({ candidate, pin_sha256: digest(await readOwnedFile(await realpath(pin), 4*1024*1024)), policy, platform: process.platform, arch: process.arch, node: process.version }));
}
export async function checkPreparation(config: SupervisorConfig, dataDirOverride?: string): Promise<PreparationStatus> {
  let candidate: string | null = null;
  try {
    candidate = await candidateIdentity();
    const identity = await preparationIdentity(config,candidate);
    const targetReceiptPath = receiptPath(config, dataDirOverride);
    const receipt = receiptSchema.parse(JSON.parse((await readOwnedFile(targetReceiptPath,16*1024)).toString('utf8')));
    if (digest(await readOwnedFile(path.join(path.dirname(targetReceiptPath), 'preparation-reports', `${receipt.report_sha256}.json`), 4*1024*1024)) !== receipt.report_sha256) throw new Error('Preparation report changed');
    if (receipt.identity !== identity) return {status:'stale',candidate_sha256:candidate,version:APP_VERSION,reason:'Candidate, pin, runtime or policy changed'};
    return {status:receipt.result,candidate_sha256:candidate,version:APP_VERSION,reason:'Version-matched no-inference evidence; hosted acceptance remains separate'};
  } catch(error) { return {status:(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'stale',candidate_sha256:candidate,version:APP_VERSION,reason:'No usable matching preparation receipt'}; }
}
