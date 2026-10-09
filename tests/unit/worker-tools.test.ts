import {afterEach,describe,expect,it,vi} from 'vitest';
import {chmod,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
vi.mock('../../src/diagnostics/edit-run-audit.js',async(importOriginal)=>{const actual=await importOriginal<typeof import('../../src/diagnostics/edit-run-audit.js')>();return {...actual,auditEditRun:vi.fn(async()=>({status:'unverified'}))};});
import {auditEditRun} from '../../src/diagnostics/edit-run-audit.js';
import {auditEditCommand} from '../../src/cli/worker-tools.js';
const roots:string[]=[];
afterEach(async()=>{vi.clearAllMocks();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function scope(value:unknown){const root=await mkdtemp('/private/tmp/audit-scope-test-');roots.push(root);const file=path.join(root,'scope.json');await writeFile(file,JSON.stringify(value),{mode:0o600});return file;}
describe('audit CLI private scope input',()=>{
 it('preserves existing two-argument behavior',async()=>{await auditEditCommand(['/private/tmp','run-id']);expect(auditEditRun).toHaveBeenCalledWith('/private/tmp','run-id');});
 it('passes explicit unique normalized paths without claiming candidate acceptance',async()=>{const file=await scope(['src/a.ts','b.py']);expect(await auditEditCommand(['/private/tmp','run-id','--files',file])).toEqual({status:'unverified'});expect(auditEditRun).toHaveBeenCalledWith('/private/tmp','run-id',['src/a.ts','b.py']);});
 it.each([[],null,{},['a','a'],[4],['/a'],['../a'],['a/./b'],['a//b'],['a\\b'],['a:b'],['-a'],['-'],['a/-b'],['a\u0000b'],['a\u007fb'],['a'.repeat(1025)],Array.from({length:65},(_,i)=>`a${i}`)])('refuses malformed scopes without auditing',async(value)=>{const file=await scope(value);await expect(auditEditCommand(['/private/tmp','run-id','--files',file])).rejects.toThrow();expect(auditEditRun).not.toHaveBeenCalled();});
 it('refuses malformed JSON, links, public records and relative filenames',async()=>{const file=await scope(['a']);await writeFile(file,'{"private-canary":');await expect(auditEditCommand(['/private/tmp','run-id','--files',file])).rejects.not.toThrow('private-canary');await writeFile(file,'["a"]');await chmod(file,0o644);await expect(auditEditCommand(['/private/tmp','run-id','--files',file])).rejects.toThrow();await chmod(file,0o600);const link=file+'.link';await symlink(file,link);await expect(auditEditCommand(['/private/tmp','run-id','--files',link])).rejects.toThrow();await expect(auditEditCommand(['/private/tmp','run-id','--files','relative.json'])).rejects.toThrow();expect(auditEditRun).not.toHaveBeenCalled();});
 it.each([['/private/tmp','id','--other','x'],['/private/tmp','id','--files'],['/private/tmp','id','--files','x','extra']])('rejects unknown/incomplete/extra arguments',async(args)=>{await expect(auditEditCommand(args)).rejects.toThrow();expect(auditEditRun).not.toHaveBeenCalled();});
});
