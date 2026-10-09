import {afterEach,describe,expect,it} from 'vitest';
import {chmod,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
process.env.VIBE_SUPERVISOR_DIST_DIR ??= process.env.VIBE_SUPERVISOR_TEST_DIST;
const {auditEditCommand}=await import('../../scripts/audit-edit-run.mjs');
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function scope(value:unknown){const root=await mkdtemp('/private/tmp/audit-scope-test-');roots.push(root);const file=path.join(root,'scope.json');await writeFile(file,JSON.stringify(value),{mode:0o600});return file;}
const unverified={status:'unverified',reason:'unsafe_incomplete_or_unsupported_evidence'};
describe('audit script private scope input',()=>{
 it('audits without a scope file',async()=>{expect(await auditEditCommand(['/private/tmp','run-id'])).toEqual(unverified);});
 it('accepts explicit unique normalized paths',async()=>{const file=await scope(['src/a.ts','b.py']);expect(await auditEditCommand(['/private/tmp','run-id','--files',file])).toEqual(unverified);});
 it.each([[],null,{},['a','a'],[4],['/a'],['../a'],['a/./b'],['a//b'],['a\\b'],['a:b'],['-a'],['-'],['a/-b'],['a\u0000b'],['a\u007fb'],['a'.repeat(1025)],Array.from({length:65},(_,i)=>`a${i}`)])('refuses malformed scopes',async(value)=>{const file=await scope(value);await expect(auditEditCommand(['/private/tmp','run-id','--files',file])).rejects.toThrow('Scope input rejected.');});
 it('refuses malformed JSON, links, public records and relative filenames',async()=>{const file=await scope(['a']);await writeFile(file,'{"private-canary":');await expect(auditEditCommand(['/private/tmp','run-id','--files',file])).rejects.not.toThrow('private-canary');await writeFile(file,'["a"]');await chmod(file,0o644);await expect(auditEditCommand(['/private/tmp','run-id','--files',file])).rejects.toThrow();await chmod(file,0o600);const link=file+'.link';await symlink(file,link);await expect(auditEditCommand(['/private/tmp','run-id','--files',link])).rejects.toThrow();await expect(auditEditCommand(['/private/tmp','run-id','--files','relative.json'])).rejects.toThrow();});
 it.each([['/private/tmp','id','--other','x'],['/private/tmp','id','--files'],['/private/tmp','id','--files','x','extra']])('rejects unknown/incomplete/extra arguments',async(args)=>{await expect(auditEditCommand(args)).rejects.toThrow();});
});
