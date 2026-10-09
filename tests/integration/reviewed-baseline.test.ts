import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
process.env.VIBE_SUPERVISOR_DIST_DIR ??= process.env.VIBE_SUPERVISOR_TEST_DIST;
const { digest, prepareReviewedBaseline } = await import('../../scripts/prepare-reviewed-baseline.mjs');
const exec=promisify(execFile);const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function setup(){
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'baseline-test-'));roots.push(root);const source=path.join(root,'source'),parent=path.join(root,'output');await mkdir(source,{mode:0o700});await mkdir(parent,{mode:0o700});
 const git=async(...args:string[])=>(await exec('git',['-C',source,...args])).stdout;
 await git('-c','init.templateDir=','init','--quiet');await writeFile(path.join(source,'a.txt'),'old\n');await writeFile(path.join(source,'delete.txt'),'gone\n');await git('add','.');await git('-c','user.name=Fixture','-c','user.email=f@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','base');
 const base=(await git('rev-parse','HEAD')).trim();await writeFile(path.join(source,'a.txt'),'reviewed\n');await writeFile(path.join(source,'new.txt'),'new\n');await rm(path.join(source,'delete.txt'));
 const input={source,baseRef:base,outputParent:parent,entries:[{path:'a.txt',operation:'replace',baseSha256:digest(Buffer.from('old\n')),reviewedSha256:digest(Buffer.from('reviewed\n')),mode:'100644'},{path:'new.txt',operation:'add',baseSha256:null,reviewedSha256:digest(Buffer.from('new\n')),mode:'100644'},{path:'delete.txt',operation:'delete',baseSha256:digest(Buffer.from('gone\n')),reviewedSha256:null}]};
 return {root,source,parent,git,input};
}
describe('reviewed baseline preparation',()=>{
 it('dry-runs and creates exact reviewed snapshots without source/index/ref changes',async()=>{
  const {root,source,parent,git,input}=await setup();const index=await readFile(path.join(source,'.git/index'));const status=await git('status','--porcelain');const ref=await git('rev-parse','HEAD');
  expect((await prepareReviewedBaseline(input,[root])).status).toBe('validated_dry_run');
  const result=await prepareReviewedBaseline(input,[root],true);const repo=result.source_workspace as string;
  expect(await readFile(path.join(repo,'a.txt'),'utf8')).toBe('reviewed\n');expect(await readFile(path.join(repo,'new.txt'),'utf8')).toBe('new\n');await expect(readFile(path.join(repo,'delete.txt'))).rejects.toThrow();
  expect(await readFile(path.join(source,'.git/index'))).toEqual(index);expect(await git('status','--porcelain')).toBe(status);expect(await git('rev-parse','HEAD')).toBe(ref);
  const manifest=JSON.parse(await readFile(result.manifest_path as string,'utf8'));expect(manifest.original_base).toBe(input.baseRef);expect(path.dirname(path.dirname(repo))).toBe(parent);
 });
 it('ignores an inherited external index during snapshot staging',async()=>{
  const {root,source,input}=await setup();const file=path.join(source,'.git/index');const before=await readFile(file);
  const previous=process.env.GIT_INDEX_FILE;process.env.GIT_INDEX_FILE=file;
  try {expect((await prepareReviewedBaseline(input,[root],true)).status).toBe('prepared');expect(await readFile(file)).toEqual(before);}
  finally {if(previous===undefined)delete process.env.GIT_INDEX_FILE;else process.env.GIT_INDEX_FILE=previous;}
 });
 it.each(['.env','../escape','.agents/x','AGENTS.md','x.key','x\\y'])('rejects unsafe overlay %s',async(name)=>{const {root,input}=await setup();input.entries[0]!.path=name;await expect(prepareReviewedBaseline(input,[root],true)).rejects.toThrow();});
 it('refuses stale hashes, binary overlays, symlinks and out-of-root parents',async()=>{
  const {root,input,source}=await setup();input.entries[0]!.reviewedSha256='0'.repeat(64);await expect(prepareReviewedBaseline(input,[root])).rejects.toThrow();
  await writeFile(path.join(source,'a.txt'),Buffer.from([0,1]));input.entries[0]!.reviewedSha256=digest(Buffer.from([0,1]));await expect(prepareReviewedBaseline(input,[root])).rejects.toThrow();
  await rm(path.join(source,'a.txt'));await symlink(path.join(source,'new.txt'),path.join(source,'a.txt'));await expect(prepareReviewedBaseline(input,[root])).rejects.toThrow();
  await expect(prepareReviewedBaseline({...input,outputParent:'/private/tmp'},[source])).rejects.toThrow();
 });
 it('rejects ignored overlays, source Git filters and case collisions',async()=>{
  const {root,input,source,git}=await setup();await writeFile(path.join(source,'.gitignore'),'new.txt\n');await expect(prepareReviewedBaseline(input,[root])).rejects.toThrow();await rm(path.join(source,'.gitignore'));
  await git('config','filter.hostile.clean','false');await expect(prepareReviewedBaseline(input,[root])).rejects.toThrow();await git('config','--unset','filter.hostile.clean');
  input.entries.push({...input.entries[1]!,path:'NEW.txt'});await expect(prepareReviewedBaseline(input,[root])).rejects.toThrow();
 });
 it('refuses executable-mode mismatch and credential content',async()=>{
  const {root,input,source}=await setup();await chmod(path.join(source,'a.txt'),0o700);await expect(prepareReviewedBaseline(input,[root])).rejects.toThrow();await chmod(path.join(source,'a.txt'),0o600);
  const content='token = "'+'sk-'+'A'.repeat(30)+'"\n';await writeFile(path.join(source,'a.txt'),content);input.entries[0]!.reviewedSha256=digest(Buffer.from(content));await expect(prepareReviewedBaseline(input,[root])).rejects.toThrow();
 });
});
