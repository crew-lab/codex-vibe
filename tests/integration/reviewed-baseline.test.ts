import { afterEach, describe, expect, it } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
process.env.VIBE_SUPERVISOR_DIST_DIR ??= process.env.VIBE_SUPERVISOR_TEST_DIST;
const { digest, prepareReviewedBaseline, baselineCommand, BaselinePreparationError } = await import('../../scripts/prepare-reviewed-baseline.mjs');
const exec=promisify(execFile);const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function setup(template?:string){
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'baseline-test-'));roots.push(root);const source=path.join(root,'source'),parent=path.join(root,'output');await mkdir(source,{mode:0o700});await mkdir(parent,{mode:0o700});
 const git=async(...args:string[])=>(await exec('git',['-C',source,...args])).stdout;
 await git('-c','init.templateDir=','init','--quiet');await writeFile(path.join(source,'a.txt'),'old\n');await writeFile(path.join(source,'delete.txt'),'gone\n');if(template!==undefined)await writeFile(path.join(source,'.env.example'),template);await git('add','.');await git('-c','user.name=Fixture','-c','user.email=f@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','base');
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
 it('allows only the exact hash-bound root .env.example template in dry-run and created snapshots',async()=>{
  const template='# Public placeholders\nAPI_KEY=\nSERVICE_TOKEN=${SERVICE_TOKEN}\nPASSWORD=<PASSWORD>\nAPP_MODE=development\n';
  const {root,parent,source,git,input}=await setup(template);const expected=digest(Buffer.from(template));input.publicTemplates=[{path:'.env.example',sha256:expected}];
  const beforeIndex=await readFile(path.join(source,'.git/index'));const beforeStatus=await git('status','--porcelain');const beforeRef=await git('rev-parse','HEAD');
  const dry=await prepareReviewedBaseline(input,[root]);expect(dry.status).toBe('validated_dry_run');expect(dry.public_templates).toEqual([{path:'.env.example',sha256:expected,opted_in:true}]);expect(await readdir(parent)).toEqual([]);
  const result=await prepareReviewedBaseline(input,[root],true);const repo=result.source_workspace as string;expect(await readFile(path.join(repo,'.env.example'),'utf8')).toBe(template);expect(result.public_templates).toEqual([{path:'.env.example',sha256:expected,opted_in:true}]);
  expect(await readFile(path.join(source,'.git/index'))).toEqual(beforeIndex);expect(await git('status','--porcelain')).toBe(beforeStatus);expect(await git('rev-parse','HEAD')).toBe(beforeRef);
 });
 it.each(['file-to-directory','directory-to-file'] as const)('creates exact %s transitions independent of manifest order',async(transition)=>{
  const {root,source,parent,git,input}=await setup();
  if(transition==='file-to-directory')await writeFile(path.join(source,'x'),'file\n');
  else{await mkdir(path.join(source,'x','a'),{recursive:true});await writeFile(path.join(source,'x','a','b'),'child\n');}
  await git('add','-A');await git('-c','user.name=Fixture','-c','user.email=f@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','transition base');
  const base=(await git('rev-parse','HEAD')).trim();let expectedFile:string;let entries:typeof input.entries;
  if(transition==='file-to-directory'){
   await rm(path.join(source,'x'));await mkdir(path.join(source,'x'));expectedFile='child\n';await writeFile(path.join(source,'x','child'),expectedFile);
   entries=[{path:'x/child',operation:'add',baseSha256:null,reviewedSha256:digest(Buffer.from(expectedFile)),mode:'100644'},{path:'x',operation:'delete',baseSha256:digest(Buffer.from('file\n')),reviewedSha256:null}];
  }else{
   await rm(path.join(source,'x'),{recursive:true});expectedFile='file\n';await writeFile(path.join(source,'x'),expectedFile);
   entries=[{path:'x',operation:'add',baseSha256:null,reviewedSha256:digest(Buffer.from(expectedFile)),mode:'100644'},{path:'x/a/b',operation:'delete',baseSha256:digest(Buffer.from('child\n')),reviewedSha256:null}];
  }
  const selected={...input,baseRef:base,entries};const beforeIndex=await readFile(path.join(source,'.git/index'));const beforeStatus=await git('status','--porcelain');const beforeRef=await git('rev-parse','HEAD');
  const result=await prepareReviewedBaseline(selected,[root],true);const repo=result.source_workspace as string;
  if(transition==='file-to-directory'){await expect(readFile(path.join(repo,'x'))).rejects.toThrow();expect(await readFile(path.join(repo,'x','child'),'utf8')).toBe(expectedFile);}else{await expect(readFile(path.join(repo,'x','a','b'))).rejects.toThrow();await expect(lstat(path.join(repo,'x','a'))).rejects.toThrow();expect(await readFile(path.join(repo,'x'),'utf8')).toBe(expectedFile);}
  expect(await readFile(path.join(source,'.git/index'))).toEqual(beforeIndex);expect(await git('status','--porcelain')).toBe(beforeStatus);expect(await git('rev-parse','HEAD')).toBe(beforeRef);expect(await readdir(parent)).toHaveLength(1);
 });
 it('binds template opt-in to effective reviewed bytes and rechecks dotenv syntax',async()=>{
  const base='# reviewed base\nAPI_KEY=\n';const reviewed='# reviewed effective\nAPI_KEY=YOUR_API_KEY\n';
  const {root,source,input}=await setup(base);await writeFile(path.join(source,'.env.example'),reviewed);input.entries.push({path:'.env.example',operation:'replace',baseSha256:digest(Buffer.from(base)),reviewedSha256:digest(Buffer.from(reviewed)),mode:'100644'});
  input.publicTemplates=[{path:'.env.example',sha256:digest(Buffer.from(base))}];await expect(prepareReviewedBaseline(input,[root])).rejects.toMatchObject({code:'VSBASE_HASH_MISMATCH',stage:'hash'});
  input.publicTemplates=[{path:'.env.example',sha256:digest(Buffer.from(reviewed))}];expect((await prepareReviewedBaseline(input,[root])).status).toBe('validated_dry_run');
  const unsafe='# effective credential\nAPI_KEY=abc\n';await writeFile(path.join(source,'.env.example'),unsafe);input.entries.at(-1)!.reviewedSha256=digest(Buffer.from(unsafe));input.publicTemplates=[{path:'.env.example',sha256:digest(Buffer.from(unsafe))}];
  await expect(prepareReviewedBaseline(input,[root])).rejects.toMatchObject({code:'VSBASE_SENSITIVE_CONTENT_REFUSED',stage:'sensitive_content'});
 });
 it('rejects hash mismatch, arbitrary credential values, command substitution, other env files and real .env files',async()=>{
  const safe='API_KEY=YOUR_API_KEY\n';const {root,source,input,parent}=await setup(safe);input.publicTemplates=[{path:'.env.example',sha256:'a'.repeat(64)}];
  await expect(prepareReviewedBaseline(input,[root])).rejects.toMatchObject({code:'VSBASE_HASH_MISMATCH',stage:'hash'});expect(await readdir(parent)).toEqual([]);
  const malicious=['API_KEY=example\n','API_KEY=weak\n','APP_MODE=$(curl bad)\n','export API_KEY=\n','DATABASE_URL=postgres://user:password@db:5432/app\n','REDIS_URL=redis://:credential@host\n','APP_NAME=randomblob123456\n','PASSWORD=<replace-me>\n','# DATABASE_URL=postgres://user:password@db:5432/app\n'];
  const templateEntry={path:'.env.example',operation:'replace' as const,baseSha256:digest(Buffer.from(safe)),reviewedSha256:digest(Buffer.from(safe)),mode:'100644' as const};input.entries.push(templateEntry);
  for(const body of malicious){await writeFile(path.join(source,'.env.example'),body);templateEntry.reviewedSha256=digest(Buffer.from(body));input.publicTemplates=[{path:'.env.example',sha256:digest(Buffer.from(body))}];await expect(prepareReviewedBaseline(input,[root])).rejects.toMatchObject({code:'VSBASE_SENSITIVE_CONTENT_REFUSED',stage:'sensitive_content'});}
  input.publicTemplates=undefined;input.entries[0]!.path='.env.local';await expect(prepareReviewedBaseline(input,[root])).rejects.toMatchObject({code:'VSBASE_SENSITIVE_FILENAME_REFUSED',stage:'sensitive_filename'});
  input.entries[0]!.path='.env.example.local';await expect(prepareReviewedBaseline(input,[root])).rejects.toMatchObject({code:'VSBASE_SENSITIVE_FILENAME_REFUSED',stage:'sensitive_filename'});
  await writeFile(path.join(source,'.env'),'VALUE=\n');await gitIndex(source);const base=(await exec('git',['-C',source,'rev-parse','HEAD'])).stdout.trim();input.baseRef=base;await expect(prepareReviewedBaseline(input,[root])).rejects.toMatchObject({code:'VSBASE_SENSITIVE_FILENAME_REFUSED',stage:'sensitive_filename'});
 });
 it('returns sanitized stable diagnostics for schema, path and unexpected failures',async()=>{
  const {root,input,parent}=await setup();
  await expect(prepareReviewedBaseline({...input,unexpected:'secret-value'},[root])).rejects.toMatchObject({code:'VSBASE_SCHEMA_INVALID',stage:'schema'});
  const link=path.join(root,'linked-output');await symlink(parent,link);await expect(prepareReviewedBaseline({...input,outputParent:link},[root])).rejects.toMatchObject({code:'VSBASE_PATH_REFUSED',stage:'path'});
  input.entries[0]!.reviewedSha256='0'.repeat(64);await expect(prepareReviewedBaseline(input,[root],true)).rejects.toMatchObject({code:'VSBASE_HASH_MISMATCH',stage:'hash'});expect(await readdir(parent)).toEqual([]);
 });
 it('returns a sanitized config code through the CLI API without retaining config details',async()=>{
  const {root}=await setup();const home=path.join(root,'config-home');await mkdir(home,{mode:0o700});await writeFile(path.join(home,'config.toml'),'this is invalid toml = [');const previous=process.env.VIBE_SUPERVISOR_HOME;process.env.VIBE_SUPERVISOR_HOME=home;
  try{
   await expect(baselineCommand(['manifest.json'])).rejects.toMatchObject({code:'VSBASE_CONFIG_INVALID',stage:'config'});
   try{await exec('node',[path.resolve('scripts/prepare-reviewed-baseline.mjs'),'manifest.json'],{cwd:root,env:process.env});throw new Error('CLI unexpectedly succeeded');}
   catch(error){const failure=error as {stderr?:string;stdout?:string};expect(failure.stdout).toBe('');expect(JSON.parse(failure.stderr??'')).toMatchObject({status:'preparation_failed',code:'VSBASE_CONFIG_INVALID',stage:'config',source_preserved:true});expect(failure.stderr).not.toContain(home);}
  }finally{if(previous===undefined)delete process.env.VIBE_SUPERVISOR_HOME;else process.env.VIBE_SUPERVISOR_HOME=previous;}
  expect(new BaselinePreparationError('unexpected').message).not.toContain(home);
 });
 it('runs the documented CLI dry-run and create flows with a private config and manifest',async()=>{
  const {root,source,parent,git,input}=await setup();const home=path.join(root,'cli-home');await mkdir(home,{mode:0o700});const configPath=path.join(home,'config.toml');const config=`version = 1\nallowed_workspace_roots = [${JSON.stringify(root)}]\n`;
  await writeFile(configPath,config,{mode:0o600});await chmod(configPath,0o600);const manifest=path.join(root,'review.json');await writeFile(manifest,JSON.stringify(input),{mode:0o600});await chmod(manifest,0o600);
  const index=await readFile(path.join(source,'.git/index'));const status=await git('status','--porcelain');const ref=await git('rev-parse','HEAD');const configHash=digest(await readFile(configPath));const cli=path.resolve('scripts/prepare-reviewed-baseline.mjs');const env={...process.env,VIBE_SUPERVISOR_HOME:home};
  const dry=await exec('node',[cli,manifest],{cwd:root,env});const dryResult=JSON.parse(dry.stdout);expect(dry.stderr).toBe('');expect(dryResult.status).toBe('validated_dry_run');expect(await readdir(parent)).toEqual([]);
  const created=await exec('node',[cli,manifest,'--create'],{cwd:root,env});const createResult=JSON.parse(created.stdout);expect(created.stderr).toBe('');expect(createResult.status).toBe('prepared');expect(await readFile(createResult.manifest_path,'utf8')).toContain('"status": "prepared"');
  expect(await readFile(path.join(source,'.git/index'))).toEqual(index);expect(await git('status','--porcelain')).toBe(status);expect(await git('rev-parse','HEAD')).toBe(ref);expect(digest(await readFile(configPath))).toBe(configHash);expect(await readFile(configPath,'utf8')).toBe(config);
 });
 it('writes a private sanitized failure receipt after a controlled late source hash change',async()=>{
  const {root,source,parent,input}=await setup();const bin=path.join(root,'bin');await mkdir(bin,{mode:0o700});const realGit=(await exec('which',['git'])).stdout.trim();const shim=path.join(bin,'git');
  const mutation='late-source-mutation-'+String(Date.now());const shimSource=`#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');const {writeFileSync}=require('node:fs');const realGit=${JSON.stringify(realGit)};const sourceFile=${JSON.stringify(path.join(source,'a.txt'))};const args=process.argv.slice(2);const result=spawnSync(realGit,args,{stdio:'inherit',env:process.env});if(result.status===0&&args.join(' ').includes('Declared original baseline'))writeFileSync(sourceFile,${JSON.stringify(mutation+'\n')});process.exit(result.status??1);\n`;
  await writeFile(shim,shimSource,{mode:0o700});await chmod(shim,0o700);const previousPath=process.env.PATH;const beforeIndex=await readFile(path.join(source,'.git/index'));const beforeRef=(await exec('git',['-C',source,'rev-parse','HEAD'])).stdout.trim();
  try{
   process.env.PATH=`${bin}${path.delimiter}${previousPath??''}`;let failure:Record<string,unknown>|undefined;try{await prepareReviewedBaseline(input,[root],true);}catch(error){failure=error as Record<string,unknown>;}
   expect(failure).toMatchObject({code:'VSBASE_HASH_MISMATCH',stage:'hash'});const outputId=String(failure?.retained_output_id);expect(outputId).toMatch(/^reviewed-baseline-/);
   const output=path.join(parent,outputId);const receipt=path.join(output,'failure.json');const report=JSON.parse(await readFile(receipt,'utf8'));
   expect(report).toEqual({status:'preparation_failed',source_preserved:true,code:'VSBASE_HASH_MISMATCH',stage:'hash',retained_output_id:outputId});expect(JSON.stringify(report)).not.toContain(source);expect(JSON.stringify(report)).not.toContain(mutation);
   const info=await lstat(receipt);expect(info.isFile()).toBe(true);expect(info.uid).toBe(process.getuid?.());expect(info.mode&0o077).toBe(0);
   expect(await readFile(path.join(source,'a.txt'),'utf8')).toBe(mutation+'\n');expect(await readFile(path.join(source,'.git/index'))).toEqual(beforeIndex);expect((await exec('git',['-C',source,'rev-parse','HEAD'])).stdout.trim()).toBe(beforeRef);
  }finally{if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;}
 });
});

async function gitIndex(source:string){await exec('git',['-C',source,'add','--force','--','.env']);await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=f@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','add real env']);}
