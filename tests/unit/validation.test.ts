import { chmod, mkdir, mkdtemp, lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { prepareValidation, cleanValidation, lockfileNeedsUnsupportedProfile } from '../../src/validation/workspace.js';
import { validationCommand } from '../../src/cli/validation.js';
it.each([false,true])('creates independent copies and safely cleans up (offline install=%s)',async(install)=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'validation-fixture-')));
 try{
  const realManager=await realpath(execFileSync('/usr/bin/which',['npm'],{encoding:'utf8'}).trim());
  const version=install?execFileSync(realManager,['--version'],{encoding:'utf8'}).trim():'1.2.3';
  const source=path.join(root,'source');await mkdir(source);
  const git=(...args:string[])=>execFileSync('git',args,{cwd:source,encoding:'utf8'});
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  await writeFile(path.join(source,'package.json'),JSON.stringify({name:'fixture',version:'0.1.0',packageManager:`npm@${version}`,scripts:{postinstall:'exit 99'}}));
  await writeFile(path.join(source,'package-lock.json'),JSON.stringify({name:'fixture',version:'0.1.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'0.1.0'}}}));await writeFile(path.join(source,'page.txt'),'baseline\n');git('add','.');git('commit','-qm','fixture');
  const base=git('rev-parse','HEAD').trim();await writeFile(path.join(source,'page.txt'),'candidate\n');
  const patch=path.join(root,'patch');await writeFile(patch,git('diff','--binary'),{mode:0o644});await chmod(patch,0o644);
  const manager=path.join(root,'npm');await writeFile(manager,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.2.3; else exit 99; fi\n');await chmod(manager,0o700);
  const cache=path.join(root,'offline-cache');await mkdir(path.join(cache,'_cacache'),{recursive:true});
  const output=path.join(root,'validation');
  expect(await prepareValidation({source,base,patchFile:patch,output,manager:install?realManager:manager,install,cache})).toMatchObject({status:'prepared',dependencies:install?'installed':'not-requested'});
  expect(await readFile(path.join(output,'baseline','page.txt'),'utf8')).toBe('baseline\n');
  expect(await readFile(path.join(output,'candidate','page.txt'),'utf8')).toBe('candidate\n');
  expect(await readFile(path.join(source,'page.txt'),'utf8')).toBe('candidate\n');
  expect((await lstat(patch)).mode & 0o777).toBe(0o644);
  expect(await readFile(patch,'utf8')).toBe(git('diff','--binary'));
  await writeFile(path.join(output,'candidate','page.txt'),'changed after validation');
  await expect(cleanValidation(output)).rejects.toThrow(/retained/);
  await writeFile(path.join(output,'candidate','page.txt'),'candidate\n');
  expect(await cleanValidation(output)).toMatchObject({status:'removed'});
 }finally{await rm(root,{recursive:true,force:true});}
},30_000);

it('accepts a pnpm 9 lockfile whose settings mention excludeLinksFromLockfile', () => {
  const lock = "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    dependencies:\n      ms:\n        specifier: 2.1.3\n        version: 2.1.3\n";
  expect(lockfileNeedsUnsupportedProfile(lock)).toBe(false);
});

it.each([
  ['a file dependency', '      local:\n        specifier: file:../local\n'],
  ['a link dependency', '      local:\n        specifier: link:../local\n'],
  ['a workspace dependency', '      sibling:\n        specifier: workspace:*\n'],
  ['a git dependency', '"resolved": "git+https://example.invalid/repo.git"'],
  ['a package that requires a build', '  native@0.1.0:\n    requiresBuild: true\n'],
  ['an npm package with an install script', '"hasInstallScript": true']
])('blocks a lockfile with %s', (_name, lock) => {
  expect(lockfileNeedsUnsupportedProfile(lock)).toBe(true);
});


it.each(['package-free', 'no-lock'])('prepares %s copies without running a manager and preserves cleanup safeguards',async(fixture)=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'validation-copy-')));
 try{
  const source=path.join(root,'source');await mkdir(source);
  const git=(...args:string[])=>execFileSync('git',args,{cwd:source,encoding:'utf8'});
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  if(fixture==='no-lock')await writeFile(path.join(source,'package.json'),JSON.stringify({name:'fixture',packageManager:'npm@1.2.3'}));
  await writeFile(path.join(source,'page.txt'),'baseline\n');git('add','.');git('commit','-qm','fixture');
  const base=git('rev-parse','HEAD').trim();await writeFile(path.join(source,'page.txt'),'candidate\n');
  const patch=path.join(root,'patch');await writeFile(patch,git('diff','--binary'),{mode:0o600});
  const output=path.join(root,'validation');const marker=path.join(root,'manager-ran');const manager=path.join(root,'manager');
  await writeFile(manager,`#!/bin/sh\ntouch "${marker}"\nexit 1\n`);await chmod(manager,0o700);
  const args=['prepare','--source',source,'--base',base,'--patch',patch,'--out',output,'--no-install'];
  if(fixture==='no-lock')args.push('--manager',manager);
  expect(await validationCommand(args)).toMatchObject({status:'prepared',dependencies:'not-requested'});
  await expect(readFile(marker)).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(path.join(output,'baseline','page.txt'),'utf8')).toBe('baseline\n');
  expect(await readFile(path.join(output,'candidate','page.txt'),'utf8')).toBe('candidate\n');
  await writeFile(path.join(output,'extra'),'tamper');await expect(cleanValidation(output)).rejects.toThrow(/retained/);
  await rm(path.join(output,'extra'));expect(await cleanValidation(output)).toMatchObject({status:'removed'});
  await expect(validationCommand(['prepare','--source',source,'--base',base,'--patch',patch,'--out',path.join(root,'missing-manager')])).rejects.toThrow(/Missing --manager/);
  await expect(prepareValidation({source,base,patchFile:patch,output:path.join(root,'install'),manager,install:true})).rejects.toThrow(/blocked/);
  await expect(readFile(marker)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
},30_000);

it('reads legacy copy-only manifests during cleanup',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'validation-legacy-')));
 try{
  const source=path.join(root,'source');await mkdir(source);
  const git=(...args:string[])=>execFileSync('git',args,{cwd:source,encoding:'utf8'});
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  await writeFile(path.join(source,'file'),'x');git('add','.');git('commit','-qm','fixture');
  const patch=path.join(root,'patch');await writeFile(patch,'',{mode:0o600});const output=path.join(root,'out');
  await prepareValidation({source,base:git('rev-parse','HEAD').trim(),patchFile:patch,output,install:false});
  const file=path.join(output,'manifest.json');const manifest=JSON.parse(await readFile(file,'utf8')) as Record<string,unknown>;
  manifest.manager={kind:'npm',version:'1.2.3',executable:'/legacy/npm'};
  manifest.lockfiles=[{workspace:'baseline',path:'package-lock.json',sha256:'a'.repeat(64)},{workspace:'candidate',path:'package-lock.json',sha256:'b'.repeat(64)}];
  await writeFile(file,JSON.stringify(manifest));expect(await cleanValidation(output)).toMatchObject({status:'removed'});
 }finally{await rm(root,{recursive:true,force:true});}
},30_000);


it('requires the exact manager pin, supported lockfile and offline cache for installation',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'validation-install-')));
 try{
  const source=path.join(root,'source');await mkdir(source);
  const git=(...args:string[])=>execFileSync('git',args,{cwd:source,encoding:'utf8'});
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  await writeFile(path.join(source,'package.json'),JSON.stringify({name:'fixture',packageManager:'npm@1.2.3'}));
  await writeFile(path.join(source,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{}}));git('add','.');git('commit','-qm','fixture');
  const base=git('rev-parse','HEAD').trim();const patch=path.join(root,'patch');await writeFile(patch,'',{mode:0o600});
  const manager=path.join(root,'manager');await writeFile(manager,'#!/bin/sh\necho 1.2.3\n');await chmod(manager,0o700);
  await expect(prepareValidation({source,base,patchFile:patch,output:path.join(root,'no-cache'),manager,install:true})).rejects.toThrow(/Populated offline cache required/);
  await writeFile(manager,'#!/bin/sh\necho 2.0.0\n');
  await expect(prepareValidation({source,base,patchFile:patch,output:path.join(root,'wrong-manager'),manager,install:true})).rejects.toThrow(/does not match exact project pin/);
  await writeFile(path.join(source,'package-lock.json'),'file:../local');git('add','.');git('commit','-qm','unsupported');
  await expect(prepareValidation({source,base:git('rev-parse','HEAD').trim(),patchFile:patch,output:path.join(root,'unsupported'),manager,install:true})).rejects.toThrow(/unsupported local dependencies/);
 }finally{await rm(root,{recursive:true,force:true});}
},30_000);
