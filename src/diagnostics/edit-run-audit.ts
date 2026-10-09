import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isPathWithinRoot } from '../security/paths.js';
const object = z.record(z.string(), z.unknown());
const messageSchema = z.object({role:z.enum(['user','assistant','tool','system']),content:z.unknown().optional(),tool_call_id:z.string().optional(),tool_calls:z.array(z.object({id:z.string().min(1),function:z.object({name:z.string().min(1),arguments:z.unknown().optional()})})).nullable().optional()}).passthrough();
type Message = z.infer<typeof messageSchema>;
type RecordValue = Record<string, unknown>;
const names = ['read_file','grep','write_file','edit','bash'] as const;
const permitted = new Set<string>(['read_file','grep','write_file','edit']);
export async function privateAuditRead(file: string): Promise<string> {
  if (path.resolve(file) !== file) throw new Error('unsafe_path');
  let current = path.parse(file).root;
  const ancestors: {file:string;ino:number;dev:number;ctimeMs:number}[] = [];
  for (const part of file.slice(current.length).split(path.sep)) {
    current = path.join(current, part); const st = await lstat(current);
    if (st.isSymbolicLink()) throw new Error('unsafe_path');
    if(current!==file){
      const stickyRoot=st.uid===0&&(st.mode&0o1000)!==0;
      if(!st.isDirectory()||![0,process.getuid?.()].includes(st.uid)||(st.mode&0o022&&!stickyRoot))throw new Error('unsafe_parent');
      ancestors.push({file:current,ino:st.ino,dev:st.dev,ctimeMs:st.ctimeMs});
    }
  }
  const before = await lstat(file);
  if (!before.isFile() || before.uid !== process.getuid?.() || before.mode & 0o077 || before.nlink !== 1 || before.size > 8*1024*1024) throw new Error('unsafe_record');
  const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened=await h.stat(); if(opened.ino!==before.ino||opened.dev!==before.dev)throw new Error('changed_record');
    const bytes=await h.readFile(); const after=await h.stat(); const current=await lstat(file);
    if(after.size!==before.size||bytes.length!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.ino!==before.ino||current.dev!==before.dev)throw new Error('changed_record');
    for(const parent of ancestors){const st=await lstat(parent.file);if(st.isSymbolicLink()||st.ino!==parent.ino||st.dev!==parent.dev||st.ctimeMs!==parent.ctimeMs)throw new Error('changed_parent');}
    if(await realpath(file)!==file)throw new Error('changed_parent');
    return bytes.toString('utf8');
  } finally {await h.close();}
}
export function summarizeEditRun(messages: unknown[], events: unknown[], workerRoot: string, declaredFiles?: readonly string[]): RecordValue {
  const parsed: Message[] = messages.map(m=>messageSchema.parse(m));
  const calls=new Map<string,{name:string;args:unknown;round:number}>(); const results=new Map<string,string>();
  const failedUpdates: string[]=[];const policyDenied=new Set<string>();let round=0;let final=false;let policyDenialEvents=0;
  for(const m of parsed){
    if(m.role==='user'){round++;final=false;}
    if(m.role==='assistant'){
      if(m.tool_calls?.length){final=false;for(const c of m.tool_calls){if(calls.has(c.id))throw new Error('duplicate_call_id');calls.set(c.id,{name:c.function.name,args:c.function.arguments,round});}}
      else if(typeof m.content==='string'&&m.content.trim()&&!m.content.includes('<vibe_stop_event>'))final=true;
    }
    if(m.role==='tool'){
      if(!m.tool_call_id||!calls.has(m.tool_call_id)||results.has(m.tool_call_id))throw new Error('uncorrelated_result');
      if(typeof m.content!=='string')throw new Error('unsupported_result');results.set(m.tool_call_id,m.content);
    }
  }
  for(const value of events){
    const e=object.parse(value);const d=object.parse(e.data);
    if((e.type==='tool_call'||e.type==='tool_call_update')&&d.status==='failed'){
      if(typeof d.toolCallId!=='string'||!calls.has(d.toolCallId))throw new Error('uncorrelated_failure');failedUpdates.push(d.toolCallId);
    }
    if(e.type==='permission_denied_by_policy'||e.type==='permission_denied'){
      policyDenialEvents++;
      const deniedId=typeof d.toolCallId==='string'?d.toolCallId:d.tool_call_id;
      if(typeof deniedId==='string'&&calls.has(deniedId))policyDenied.add(deniedId);
    }
  }
  const failedIds=new Set(failedUpdates);
  const counts:Record<string,number>=Object.fromEntries([...names,'other'].map(n=>[n,0]));
  const roundCounts:Record<string,number>={};const failures:Record<string,number>={};let scope: 'within_declared_arguments'|'outside_declared_arguments'|'unverified'=declaredFiles?'within_declared_arguments':'unverified';
  for(const [id,c] of calls){
    const name=names.includes(c.name as typeof names[number])?c.name:'other';counts[name]=(counts[name]??0)+1;roundCounts[String(c.round)]=(roundCounts[String(c.round)]??0)+1;
    if(declaredFiles&&!permitted.has(c.name)&&!failedIds.has(id))scope='outside_declared_arguments';
    if(declaredFiles&&['write_file','edit'].includes(c.name)){
      let args=c.args;if(typeof args==='string')try{args=JSON.parse(args);}catch{args=undefined;}
      const obj=object.safeParse(args);const candidate=obj.success?(obj.data.path??obj.data.file_path):undefined;
      if(typeof candidate!=='string'){if(scope!=='outside_declared_arguments')scope='unverified';}else {const target=path.resolve(workerRoot,candidate);if(!isPathWithinRoot(workerRoot,target)||!declaredFiles.includes(path.relative(workerRoot,target).split(path.sep).join('/')))scope='outside_declared_arguments';}
    }
    if(policyDenied.has(id)){failures.policy_denied=(failures.policy_denied??0)+1;continue;}
    const rawText=results.get(id);
    const prefix=`<tool_error>${c.name} failed: `; const unavailablePrefix=`<tool_error>${c.name}: `;
    const text=rawText?.startsWith(prefix)&&rawText.endsWith('</tool_error>')?rawText.slice(prefix.length,-13):rawText?.startsWith(unavailablePrefix)&&rawText.endsWith('</tool_error>')?rawText.slice(unavailablePrefix.length,-13):undefined;
    const failed=failedIds.has(id);
    let kind: string | undefined;
    if(failed&&!permitted.has(c.name)&&text?.startsWith(`Unknown tool '${c.name}'`))kind='unavailable_tool';
    else if(failed){
      if(!text)kind='unknown';
      else if(/^File not found at:/i.test(text))kind='missing_file';
      else if(/^String to replace not found in file\./.test(text))kind='edit_no_match';
      else if(/^Found \d+ matches of the string to replace, but replace_all is false\./.test(text))kind='edit_ambiguous_match';
      else kind='other';
    }
    if(kind)failures[kind]=(failures[kind]??0)+1;
  }
  const outOfScope=declaredFiles!==undefined&&scope!=='within_declared_arguments';
  return {status:outOfScope||[...calls.keys()].some(id=>!results.has(id))?'unverified':'validated',assistant_messages:parsed.filter(m=>m.role==='assistant').length,unique_tool_calls:calls.size,tool_counts:counts,failed_updates:failedUpdates.length,unique_failed_calls:new Set(failedUpdates).size,failure_classes:failures,round_tool_calls:roundCounts,final_answer:final,declared_scope:'unverified',argument_scope:scope,policy_denial_events:policyDenialEvents,unresolved_calls:[...calls.keys()].filter(id=>!results.has(id)).length};
}
export async function auditEditRun(home: string, runId: string, declaredFiles?: readonly string[]): Promise<RecordValue> {
  try {
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId)||await realpath(home)!==home)throw new Error('unsafe_path');
    const root=path.join(home,'runs',runId);const meta=object.parse(JSON.parse(await privateAuditRead(path.join(root,'meta.json'))));
    if(!['completed','failed','cancelled','closed'].includes(String(meta.state))||meta.backend!=='acp'||meta.mode!=='edit'||meta.run_id!==runId||typeof meta.worker_workspace!=='string')throw new Error('unsettled_or_unsupported');
    const sessions=path.join(root,'vibe-home','sessions');const st=await lstat(sessions);
    if(!st.isDirectory()||st.isSymbolicLink()||st.mode&0o077||st.uid!==process.getuid?.())throw new Error('unsafe_record');
    const dirs=(await readdir(sessions)).filter(n=>n!=='active');if(dirs.length!==1||!/^session_[A-Za-z0-9_-]+$/.test(dirs[0]!))throw new Error('ambiguous_session');
    const lines=(text:string):unknown[]=>{if(text&&!text.endsWith('\n'))throw new Error('incomplete_record');return text.trim()?text.trim().split('\n').map(l=>JSON.parse(l)):[];};
    const messages=lines(await privateAuditRead(path.join(sessions,dirs[0]!,'messages.jsonl')));
    const events=lines(await privateAuditRead(path.join(root,'events.ndjson')));
    const processRecord=object.safeParse(meta.process);if(!processRecord.success||processRecord.data.version!=='2.25.8')throw new Error('unsupported_vibe');
    const result=object.safeParse(meta.result);
    return {...summarizeEditRun(messages,events,meta.worker_workspace,declaredFiles),supervisor_version:typeof meta.supervisor_version==='string'&&meta.supervisor_version.length<=128&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(meta.supervisor_version)?meta.supervisor_version:null,stop_reason:result.success&&['end_turn','max_turn_requests','cancelled'].includes(String(result.data.stop_reason))?result.data.stop_reason:null};
  } catch {return {status:'unverified',reason:'unsafe_incomplete_or_unsupported_evidence'};}
}
