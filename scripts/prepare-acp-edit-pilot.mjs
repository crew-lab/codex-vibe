// Offline preparation only. Never launches Vibe or changes an allowlist.
import {mkdir,mkdtemp,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {APP_VERSION} from '../dist/version.js';
const requested=process.argv[2];
if(!requested||!path.isAbsolute(requested))throw new Error('Provide an existing absolute parent directory under an allowed workspace root.');
const parent=await realpath(requested);
const root=await mkdtemp(path.join(parent,'acp-edit-pilot-'));
await mkdir(path.join(root,'.agents','skills','canary'),{recursive:true});
await writeFile(path.join(root,'.agents','skills','canary','SKILL.md'),'---\nname: pilot-canary\ndescription: Project discovery isolation marker\n---\nPILOT_PROJECT_DISCOVERY_CANARY\n');
await writeFile(path.join(root,'AGENTS.md'),'PILOT_PROJECT_INSTRUCTIONS_CANARY\n');
await writeFile(path.join(root,'calc.py'),'def add(a: int, b: int) -> int:\n    """Compute result."""\n    return a - b\n');
const git=(args)=>execFileSync('git',args,{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git(['-c','init.templateDir=','init','--quiet']);git(['add','calc.py','AGENTS.md','.agents']);
git(['-c','user.name=Supervisor test fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Disposable ACP edit pilot baseline']);
const base=git(['rev-parse','HEAD']);
const plan={status:'PREPARED_NOT_RUN',expectedServerVersion:APP_VERSION,cwd:root,base_ref:base,max_turns:12,timeout_seconds:240,wait_seconds:30,sourceMustRemainUnchanged:true,
 task:'You own calc.py in this detached test worktree. You share the codebase; preserve all other files. Read calc.py once, fix add(a,b) to return the sum for all integer inputs, and keep its current docstring. Modify only calc.py. Do not search, run shell checks, commit, apply or push. Do not create scratch files. Finish with a short final answer. The coordinator runs checks independently.',
 correction:'Keep the verified addition behavior. In calc.py only, change the docstring to "Return the sum of two integers." Preserve all other files. Read calc.py at most once, do not search or run checks, and finish with a short final answer.',
 expectedTools:['vibe_close','vibe_continue','vibe_edit_start','vibe_respond','vibe_result','vibe_review_start','vibe_status']};
await writeFile(path.join(root,'..',`${path.basename(root)}-plan.json`),JSON.stringify(plan,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({status:plan.status,cwd:root,base_ref:base,plan:path.join(parent,`${path.basename(root)}-plan.json`)}));
