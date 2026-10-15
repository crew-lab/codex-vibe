import { createPrivateDir, createPrivateFile } from '../security/paths.js';
import path from 'node:path';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { loadResolvedConfig } from '../config/config.js';
import { candidateIdentity, packageRoot, preparationIdentity, receiptPath } from '../preparation/evidence.js';
import { digest } from '../acceptance/schema.js';
import { readOwnedFile } from '../reporting/private-files.js';
import { atomicWriteJson } from '../persistence/atomic.js';
const manifestSchema = z.object({schema_version:z.literal(1),version:z.string(),candidate_sha256:z.string().regex(/^[a-f0-9]{64}$/),script_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function prepareCommand(args: string[]): Promise<unknown> {
  if(args[0] !== 'check') throw new Error('Usage: prepare check --kit <directory> --config <file>');
  const values = new Map<string,string>();
  for(let i=1;i<args.length;i+=2){ const key=args[i]!;const value=args[i+1];if(!['--kit','--config'].includes(key)||!value||values.has(key))throw new Error('Invalid preparation arguments');values.set(key,value); }
  if(!values.has('--kit')||!values.has('--config'))throw new Error('Kit and config are required');
  const kit=await realpath(values.get('--kit')!);
  const manifest=manifestSchema.parse(JSON.parse(await readFile(path.join(kit,'manifest.json'),'utf8')));
  const candidate=await candidateIdentity();
  const script=path.join(kit,'v2-conformance-check.mjs');
  const scriptHash=digest(await readFile(script));
  if(manifest.candidate_sha256!==candidate || scriptHash!==manifest.script_sha256 || scriptHash!==digest(await readFile(path.join(packageRoot,'scripts/v2-conformance-check.mjs'))))throw new Error('Preparation kit does not match installed candidate');
  const resolved=await loadResolvedConfig({configPath:values.get('--config')!,requirePinManifest:true});
  const identity=await preparationIdentity(resolved.config,candidate);
  const temporary=await realpath(await mkdtemp(path.join(tmpdir(),'vsup-preparation-')));
  const output=path.join(temporary,'conformance.json');
  try {
    const argv=[script,'--dist',path.join(packageRoot,'dist'),'--config',resolved.configPath,'--manifest',resolved.config.paths!.vibePinManifest!,'--placeholder-key','--observe-network','--output',output];
    const reports = path.join(path.dirname(receiptPath(resolved.config)), 'preparation-reports');
    await createPrivateDir(reports);
    const started = Buffer.from(JSON.stringify({ result: 'incomplete', stage: 'no-inference-check-started', checked_at: new Date().toISOString() })+'\n');
    await createPrivateFile(path.join(reports, `${digest(started)}.json`), started, 'wx');
    await atomicWriteJson(receiptPath(resolved.config), {schema_version:1,result:'failed',identity,checked_at:new Date().toISOString(),report_sha256:digest(started)});
    const status=await new Promise<number>((resolve,reject)=>{const child=spawn(process.execPath,argv,{stdio:['ignore','ignore','inherit'],env:{PATH:process.env.PATH,HOME:temporary,TMPDIR:temporary},timeout:180_000});child.once('error',reject);child.once('close',code=>resolve(code??1));});
    const bytes=await readOwnedFile(output,4*1024*1024);
    const report=JSON.parse(bytes.toString('utf8')) as {result?:string;network_observation?:{verdict?:string}};
    const current=await loadResolvedConfig({configPath:resolved.configPath,requirePinManifest:true});
    if(await preparationIdentity(current.config)!==identity)throw new Error('Candidate or configuration changed during check');
    const passed=status===0&&report.result==='pass'&&report.network_observation?.verdict==='none-observed-control-validated';
    const savedReport = path.join(reports, `${digest(bytes)}.json`);
    try { await createPrivateFile(savedReport, bytes, 'wx'); } catch(error) { if((error as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await readOwnedFile(savedReport)) !== digest(bytes)) throw error; }
    await atomicWriteJson(receiptPath(resolved.config),{schema_version:1,result:passed?'passed':'failed',identity,checked_at:new Date().toISOString(),report_sha256:digest(bytes)});
    return {status:passed?'passed':'failed',candidate_sha256:candidate,hosted_acceptance:'unverified',report_sha256:digest(bytes)};
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
