import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { prepareValidation, cleanValidation, lockfileNeedsUnsupportedProfile } from '../../src/validation/workspace.js';
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
  const patch=path.join(root,'patch');await writeFile(patch,git('diff','--binary'),{mode:0o600});
  const manager=path.join(root,'npm');await writeFile(manager,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.2.3; else exit 99; fi\n');await chmod(manager,0o700);
  const cache=path.join(root,'offline-cache');await mkdir(path.join(cache,'_cacache'),{recursive:true});
  const output=path.join(root,'validation');
  expect(await prepareValidation({source,base,patchFile:patch,output,manager:install?realManager:manager,install,cache})).toMatchObject({status:'prepared',dependencies:install?'installed':'not-requested'});
  expect(await readFile(path.join(output,'baseline','page.txt'),'utf8')).toBe('baseline\n');
  expect(await readFile(path.join(output,'candidate','page.txt'),'utf8')).toBe('candidate\n');
  expect(await readFile(path.join(source,'page.txt'),'utf8')).toBe('candidate\n');
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
