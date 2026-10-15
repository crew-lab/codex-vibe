import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { candidateIdentity, preparationIdentity, receiptPath } from '../../src/preparation/evidence.js';
import { TEST_CONFIG } from './support/test-config.js';
import { elapsed } from '../../src/reporting/telemetry.js';
it('binds the candidate to distribution bytes and configuration while allowing roots-only changes', async () => {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'prep-identity-')));
  try {
    for(const dir of ['dist','schemas','scripts']) await mkdir(path.join(root,dir),{mode:0o700});
    for(const file of ['package.json','dist/cli.js','schemas/run.json','scripts/v2-conformance-check.mjs']) await writeFile(path.join(root,file),'fixture',{mode:0o600});
    const before=await candidateIdentity(root);
    await writeFile(path.join(root,'dist/cli.js'),'changed',{mode:0o600});
    expect(await candidateIdentity(root)).not.toBe(before);
    const pin=path.join(root,'pin.json');await writeFile(pin,'fixture',{mode:0o600});
    const config={...TEST_CONFIG,paths:{vibePinManifest:pin}};
    const identity=await preparationIdentity(config,before);
    expect(await preparationIdentity({...config,allowedWorkspaceRoots:['/another/task']},before)).toBe(identity);
    expect(await preparationIdentity({...config,limits:{...config.limits,maxTurnsEdit:99}},before)).not.toBe(identity);
    expect(await preparationIdentity(config,'a'.repeat(64))).not.toBe(identity);
    expect(receiptPath(config)).toBe(path.join(root,'preparation-receipt.json'));
  } finally {await rm(root,{recursive:true,force:true});}
});
it('keeps unavailable and inconsistent phase durations unknown',()=>{
  expect(elapsed(undefined,new Date().toISOString())).toBeNull();
  expect(elapsed('2026-10-15T10:00:01Z','2026-10-15T10:00:00Z')).toBeNull();
  expect(elapsed('2026-10-15T10:00:00Z','2026-10-15T10:00:01Z')).toBe(1000);
});
