// Coordinator scope input describes tool arguments, never candidate acceptance.
import path from 'node:path';
import { loadConfig } from '../config/config.js';
import { prepareReviewedBaseline } from '../git/reviewed-baseline.js';
import { auditEditRun, privateAuditRead } from '../diagnostics/edit-run-audit.js';
export async function baselineCommand(args: string[]): Promise<unknown> {
  const [sub,file,flag,...extra]=args;
  if(sub!=='prepare'||!file||(flag!==undefined&&flag!=='--create')||extra.length)throw new Error('Usage: baseline prepare manifest.json [--create]; default dry-run, creation makes disposable local snapshot commits only.');
  try {const config=await loadConfig();return await prepareReviewedBaseline(JSON.parse(await privateAuditRead(path.resolve(file))),config.allowedWorkspaceRoots,flag==='--create');}
  catch {throw new Error('Baseline preparation refused; source and allowlists are preserved. Check selected paths/hashes and owned private output.');}
}
export async function auditEditCommand(args: string[]): Promise<unknown> {
  const [home,id,flag,file,...extra]=args;
  if(!home||!id||extra.length)throw new Error('Usage: audit-edit canonical-private-home run-id [--files /absolute/private/scope.json]');
  if(flag!==undefined&&flag!=='--files')throw new Error('Usage: audit-edit canonical-private-home run-id [--files /absolute/private/scope.json]');
  if(flag==='--files'){
    if(!file||!path.isAbsolute(file))throw new Error('Usage: audit-edit canonical-private-home run-id [--files /absolute/private/scope.json]');
    let scope: string[];
    try {scope=JSON.parse(await privateAuditRead(file));}catch{throw new Error('Scope input rejected.');}
    if(!Array.isArray(scope)||scope.length===0||scope.length>64)throw new Error('Scope input rejected.');
    const seen=new Set<string>();
    for(const p of scope){
      if(typeof p!=='string'||p.length>1024||seen.has(p))throw new Error('Scope input rejected.');
      seen.add(p);
      if(p.includes('\\')||/^\s|[\x00-\x1f\x7f]|:|^-.+/.test(p))throw new Error('Scope input rejected.');
      const parts=p.split('/');
      for(const part of parts){
        if(part===''||part==='.'||part==='..'||part.startsWith('-'))throw new Error('Scope input rejected.');
      }
      if(path.isAbsolute(p))throw new Error('Scope input rejected.');
    }
    return await auditEditRun(path.resolve(home),id,scope);
  }
  return await auditEditRun(path.resolve(home),id);
}
