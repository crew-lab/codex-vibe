import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createVibeChildProfile } from '<private-supervisor-home>/1.0.1-rc.1/node_modules/vibe-supervisor/dist/backends/profile.js';
const samples=[];
for(let repeat=0;repeat<3;repeat++) for(const mode of ['review','edit']) for(const variant of repeat%2 ? ['diagnostics','guard','baseline'] : ['baseline','guard','diagnostics']) {
 const dir=await realpath(await mkdtemp('/private/tmp/vsup-perf-'));
 const root=dir+'/workspace',runDirectory=dir+'/run';
 await mkdir(root,{mode:0o700});await mkdir(runDirectory,{mode:0o700});await mkdir(dir+'/diagnostics',{mode:0o700});await mkdir(root+'/.github/workflows',{recursive:true});
 await writeFile(root+'/.github/workflows/rollback.yml','name: local-benchmark\nsteps: []\n');
 const input={runId:'offline-performance',mode,task:'',cwd:root,workerWorkspace:root,runDirectory,limits:{timeoutSeconds:30,maxTurns:1,maxEventBytes:4096,maxTranscriptBytes:4096,maxArtifactBytes:65536}};
 const profile=await createVibeChildProfile(input,mode);const env={...profile.env};delete env.MISTRAL_API_KEY;
 const prefix=variant==='baseline'?'v1.0.0':'1.0.1-rc.1';
 const shim='<private-supervisor-home>/'+prefix+'/node_modules/vibe-supervisor/dist/backends/runtime/vibe_supervisor_launcher.py';
 const result=spawnSync('<vibe-tool-env>/bin/python',['/private/tmp/vsup_perf_probe.py',root,shim,variant],{env,cwd:root,encoding:'utf8',timeout:30000,maxBuffer:128*1024});
 if(result.status!==0)throw new Error('Offline probe failed: '+result.stderr);
 samples.push({...JSON.parse(result.stdout),repeat});
}
await writeFile('<supervisor-repository>/tmp/rc1-performance-audit/samples.json',JSON.stringify({platform:'darwin arm64',vibe:'2.26.1',python:'3.12.13',samples,hostedInference:false},null,2)+'\n');
process.stdout.write(JSON.stringify({samples:samples.length,reads:samples.reduce((a,s)=>a+s.successful_reads,0),providerRequests:0})+'\n');
