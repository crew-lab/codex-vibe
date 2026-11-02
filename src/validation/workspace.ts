import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest, canonical } from '../acceptance/schema.js';
import { readInputFile, readOwnedFile, assertOwnedDirectory } from '../reporting/private-files.js';
import { resolveBaseCommit, resolveGitRoot } from '../git/worktree.js';
import { createPrivateDir } from '../security/paths.js';

const manifestSchema = z.object({schema_version:z.literal(1),owner:z.literal('vibe-supervisor-validation'),id:z.string().uuid(),root:z.string(),device:z.number(),inode:z.number(),base_commit:z.string().regex(/^[a-f0-9]{40,64}$/),patch_sha256:z.string().regex(/^[a-f0-9]{64}$/),node:z.string(),manager:z.object({kind:z.enum(['npm','pnpm']),version:z.string(),executable:z.string()}).optional(),lockfiles:z.array(z.object({workspace:z.enum(['baseline','candidate']),path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).refine(items=>items.length===0||items.length===2),tree_sha256:z.string().regex(/^[a-f0-9]{64}$/),dependencies:z.enum(['installed','not-requested']),created_at:z.string().datetime()}).strict().refine(manifest=>manifest.dependencies!=='installed'||(manifest.manager!==undefined&&manifest.lockfiles.length===2));
const MAX_FILES=200_000, MAX_BYTES=2*1024*1024*1024;
function env(root:string):NodeJS.ProcessEnv{return {PATH:process.env.PATH,HOME:path.join(root,'home'),TMPDIR:path.join(root,'tmp'),CI:'true',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null',GIT_CONFIG_KEY_1:'protocol.file.allow',GIT_CONFIG_VALUE_1:'always',GIT_CONFIG_KEY_2:'core.fsmonitor',GIT_CONFIG_VALUE_2:'false',GIT_TERMINAL_PROMPT:'0',npm_config_userconfig:path.join(root,'home','user.npmrc'),npm_config_globalconfig:path.join(root,'home','global.npmrc'),npm_config_update_notifier:'false',npm_config_ignore_scripts:'true',npm_config_offline:'true',COREPACK_ENABLE_NETWORK:'0',COREPACK_ENABLE_DOWNLOAD_PROMPT:'0'};}
async function run(command:string,args:string[],cwd:string,root:string,input?:Buffer):Promise<string>{
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env:env(root),stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    let size=0;let stdout='';let stopped=false;let killTimer:NodeJS.Timeout|undefined;
    const signal=(value:NodeJS.Signals):void=>{if(!child.pid)return;try{process.kill(process.platform==='win32'?child.pid:-child.pid,value);}catch{}};
    const stop=():void=>{if(stopped)return;stopped=true;signal('SIGTERM');killTimer=setTimeout(()=>signal('SIGKILL'),1000);killTimer.unref();};
    const timer=setTimeout(stop,120_000);timer.unref();
    const collect=(bytes:Buffer,output:boolean):void=>{size+=bytes.length;if(size>1024*1024)stop();else if(output)stdout+=bytes.toString('utf8');};
    child.stdout.on('data',(bytes:Buffer)=>collect(bytes,true));child.stderr.on('data',(bytes:Buffer)=>collect(bytes,false));
    const clear=():void=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);};
    child.once('error',error=>{clear();reject(error);});
    child.once('close',code=>{clear();if(code===0&&!stopped)resolve(stdout);else reject(new Error(`Validation preparation command failed (${path.basename(command)}, ${code}); no automatic network fallback. Raw child output is not persisted.`));});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export async function validationFingerprint(root:string):Promise<string>{
  const entries:[string,string][]=[];let total=0;let count=0;const deadline=Date.now()+120_000;const links=new Map<string,{expected:number;seen:number}>();
  const walk=async(directory:string):Promise<void>=>{
    for(const name of (await readdir(path.join(root,directory))).sort()){
      const relative=path.join(directory,name);if(relative==='manifest.json')continue;
      if(Date.now()>deadline)throw new Error('Validation inspection deadline exceeded');
      if(++count>MAX_FILES)throw new Error('Validation file limit exceeded');
      const file=path.join(root,relative);const info=await lstat(file);
      if(typeof process.getuid==='function'&&info.uid!==process.getuid())throw new Error('Foreign validation file');
      if(info.isSymbolicLink()){
        const resolved=await realpath(file);if(!resolved.startsWith(path.join(root,relative.split(path.sep)[0]!)+path.sep))throw new Error('External dependency or source symlink');
        entries.push([relative,`link:${path.relative(root,resolved)}`]);
      }else if(info.isDirectory()) {entries.push([relative,'directory']);await walk(relative);}
      else if(info.isFile()){const key=`${info.dev}:${info.ino}`;const link=links.get(key)??{expected:info.nlink,seen:0};link.seen++;links.set(key,link);total+=info.size;if(total>MAX_BYTES||info.size>128*1024*1024)throw new Error('Validation byte limit exceeded');entries.push([relative,`${info.mode & 0o777}:${digest(await readFile(file))}`]);}
      else throw new Error('Unsupported validation filesystem entry');
    }
  };await walk('');if([...links.values()].some(link=>link.expected!==link.seen))throw new Error('External hardlink retained');return digest(canonical(entries));
}
export function lockfileNeedsUnsupportedProfile(lock:string):boolean{
  return /(?<![A-Za-z0-9_-])(?:git\+|git@|file:|link:|workspace:)/.test(lock)||/\b(?:hasInstallScript|requiresBuild)\b/.test(lock);
}

async function assertProject(directory:string):Promise<{manager:string;lockfile:string}>{
  for(const name of ['.npmrc','.pnpmfile.cjs','pnpmfile.cjs','pnpm-workspace.yaml','.yarnrc','.yarnrc.yml']){
    try{await lstat(path.join(directory,name));throw new Error(`Project configuration ${name} needs an explicitly supported preparation profile`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  for (const name of ['package.json', 'package-lock.json', 'pnpm-lock.yaml']) {
    try { const info = await lstat(path.join(directory,name)); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Linked or unsupported project manifest'); } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || name === 'package.json') throw error; }
  }
  const pkg=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8')) as {packageManager?:unknown;dependencies?:Record<string,string>;devDependencies?:Record<string,string>;workspaces?:unknown};
  if(typeof pkg.packageManager!=='string'||!/^(npm|pnpm)@\d+\.\d+\.\d+$/.test(pkg.packageManager)||pkg.workspaces)throw new Error('Exact npm/pnpm packageManager pin required; workspace hooks are unsupported');
  for(const spec of Object.values({...pkg.dependencies,...pkg.devDependencies}))if(/^(?:file:|link:|workspace:|git|https?:|ssh:|github:)/.test(spec))throw new Error('Non-registry dependency needs a supported offline profile');
  const kind=pkg.packageManager.split('@')[0]!;const lockfile=kind==='npm'?'package-lock.json':'pnpm-lock.yaml';
  const lock=await readFile(path.join(directory,lockfile),'utf8');
  if(lockfileNeedsUnsupportedProfile(lock))throw new Error('Lockfile requires unsupported local dependencies or build scripts');
  return {manager:pkg.packageManager,lockfile};
}
export async function prepareValidation(options:{source:string;base:string;patchFile:string;output:string;manager?:string;cache?:string;install:boolean}):Promise<unknown>{
  const source=await resolveGitRoot(options.source);const base=await resolveBaseCommit(source,options.base);
  if(base!==options.base)throw new Error('An immutable full base commit is required');
  const patch=await readInputFile(options.patchFile,16*1024*1024,'patch');
  const output=path.resolve(options.output);await assertOwnedDirectory(path.dirname(output));
  if(output===source||source.startsWith(output+path.sep)||output.startsWith(source+path.sep))throw new Error('Validation must be outside the source checkout');
  await mkdir(output,{mode:0o700});
  const id=randomUUID();
  try{
    for(const name of ['home','tmp','cache'])await createPrivateDir(path.join(output,name));
    for (const name of ['user.npmrc','global.npmrc']) await writeFile(path.join(output,'home',name),'',{mode:0o600,flag:'wx'});
    let managerInfo:{kind:'npm'|'pnpm';version:string;executable:string}|undefined;
    const profiles:{manager:string;lockfile:string}[]=[];
    for(const name of ['baseline','candidate']){
      const directory=path.join(output,name);
      await run('git',['clone','--no-local','--no-checkout','--',source,directory],output,output);
      await run('git',['checkout','--detach',base],directory,output);
      if(name==='candidate'&&patch.length)await run('git',['apply','--binary','--whitespace=nowarn','-'],directory,output,patch);
      if(options.install)profiles.push(await assertProject(directory));
    }
    if(options.install){
      if(!options.manager||!path.isAbsolute(options.manager))throw new Error('Absolute manager path required');
      const manager=await realpath(options.manager);const executable=await lstat(manager);if(!executable.isFile()||!(executable.mode&constants.S_IXUSR))throw new Error('Absolute executable manager required');
      const version=(await run(manager,['--version'],output,output)).trim();
      const kind=profiles[0]!.manager.split('@')[0] as 'npm'|'pnpm';
      if(profiles.some(profile=>profile.manager!==`${kind}@${version}`))throw new Error('Manager binary does not match exact project pin');
      managerInfo={kind,version,executable:manager};
      if(!options.cache)throw new Error('Populated offline cache required');
      const cache=await realpath(options.cache);const sourceCache=kind==='npm'?path.join(cache,'_cacache'):cache;
      let copiedBytes=0,copiedFiles=0;
      await cp(sourceCache,path.join(output,'cache',kind==='npm'?'_cacache':'store'),{recursive:true,dereference:false,force:false,errorOnExist:true,filter:async file=>{const info=await lstat(file);if(info.isFile()){copiedBytes+=info.size;if(copiedBytes>MAX_BYTES)throw new Error("Cache exceeds copy budget");}if(++copiedFiles>MAX_FILES)throw new Error("Cache exceeds file budget");return true;}});
      await validationFingerprint(output);
      for(const name of ['baseline','candidate']){
        const args=kind==='npm'?['ci','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(output,'cache')]:['install','--offline','--frozen-lockfile','--ignore-scripts','--config.ignore-pnpmfile=true','--config.side-effects-cache=false','--store-dir',path.join(output,'cache','store')];
        await run(manager,args,path.join(output,name),output);
      }
    }
    const info=await lstat(output);
    const manifest=manifestSchema.parse({schema_version:1,owner:'vibe-supervisor-validation',id,root:output,device:info.dev,inode:info.ino,base_commit:base,patch_sha256:digest(patch),node:process.version,...(managerInfo?{manager:managerInfo}:{}),lockfiles:await Promise.all(profiles.map(async (profile,index)=>({workspace:index===0?"baseline":"candidate",path:profile.lockfile,sha256:digest(await readFile(path.join(output,index===0?"baseline":"candidate",profile.lockfile)))}))),tree_sha256:await validationFingerprint(output),dependencies:options.install?'installed':'not-requested',created_at:new Date().toISOString()});
    await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
    return {status:'prepared',root:output,base_commit:base,patch_sha256:digest(patch),dependencies:manifest.dependencies,project_checks:'not-run'};
  }catch(error){
    throw new Error(`Validation preparation blocked; retained ${output}. ${error instanceof Error?error.message:'Unknown error'}`);
  }
}
export async function cleanValidation(root:string):Promise<unknown>{
  await assertOwnedDirectory(root);
  const manifest=manifestSchema.parse(JSON.parse((await readOwnedFile(path.join(root,'manifest.json'),16*1024)).toString('utf8')));
  const info=await lstat(root);
  if(manifest.root!==root||manifest.device!==info.dev||manifest.inode!==info.ino||await validationFingerprint(root)!==manifest.tree_sha256)throw new Error('Validation ownership or content changed; retained for inspection');
  await rm(root,{recursive:true,force:false});return {status:'removed',id:manifest.id};
}
