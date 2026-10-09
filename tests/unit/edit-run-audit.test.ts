import { describe, expect, it } from 'vitest';
import { auditEditRun, summarizeEditRun } from '../../src/diagnostics/edit-run-audit.js';
const call=(id:string,name='edit',args:unknown={path:'a.py'})=>({id,function:{name,arguments:args}});
const assistant=(...calls:ReturnType<typeof call>[])=>({role:'assistant',tool_calls:calls});
const result=(id:string,text:string)=>({role:'tool',tool_call_id:id,content:text});
const failure=(id:string)=>({type:'tool_call_update',data:{toolCallId:id,status:'failed'}});
describe('edit evidence audit',()=>{
 it('distinguishes messages, unique calls, duplicate failure updates and unavailable tools without leaking text',()=>{
  const messages=[{role:'user',content:'task'},assistant(call('1'),call('2','bash')),result('1','<tool_error>edit failed: String to replace not found in file.\nString: private-input</tool_error>'),result('2',"<tool_error>bash: Unknown tool 'bash'</tool_error>"),{role:'assistant',content:'Done'}];
  const r=summarizeEditRun(messages,[failure('1'),failure('1'),failure('2')],'/worker',['a.py']);
  expect(r).toMatchObject({assistant_messages:2,unique_tool_calls:2,failed_updates:3,unique_failed_calls:2,failure_classes:{edit_no_match:1,unavailable_tool:1},final_answer:true,declared_scope:'unverified',argument_scope:'within_declared_arguments'});
  expect(JSON.stringify(r)).not.toContain('private-input');
 });
 it('does not classify successful file text as errors or equate unknown tool with policy denial',()=>{
  const r=summarizeEditRun([assistant(call('1','read_file')),result('1',"<tool_error>read_file failed: File not found at: private</tool_error>")],[], '/worker');expect(r.failure_classes).toEqual({});
 });
 it('classifies missing files and ambiguous matches only with failed status and known wrappers',()=>{
  const r=summarizeEditRun([assistant(call('1','read_file'),call('2')),result('1','<tool_error>read_file failed: File not found at: private</tool_error>'),result('2','<tool_error>edit failed: Found 3 matches of the string to replace, but replace_all is false.</tool_error>')],[failure('1'),failure('2')],'/worker');expect(r.failure_classes).toEqual({missing_file:1,edit_ambiguous_match:1});
 });
 it('rejects duplicate ids and uncorrelated updates',()=>{
  expect(()=>summarizeEditRun([assistant(call('1'),call('1'))],[],'/worker')).toThrow();expect(()=>summarizeEditRun([],[failure('missing')],'/worker')).toThrow();
 });
 it('reports incomplete calls as unverified and detects out-of-scope writes',()=>{
  expect(summarizeEditRun([assistant(call('1'))],[],'/worker').status).toBe('unverified');
  const r=summarizeEditRun([assistant(call('1','write_file',{path:'../outside'})),result('1','ok')],[],'/worker',['a.py']);expect(r.argument_scope).toBe('outside_declared_arguments');
 });
 it('counts separate rounds and requires a final answer in the latest round',()=>{
  const r=summarizeEditRun([{role:'user'},assistant(call('1')),result('1','ok'),{role:'assistant',content:'Done'},{role:'user'},assistant(call('2')),result('2','ok')],[],'/worker');expect(r).toMatchObject({round_tool_calls:{'1':1,'2':1},final_answer:false});
 });
 it('counts uncorrelated policy requests without assigning a tool-call cause',()=>{
  const r=summarizeEditRun([assistant(call('1')),result('1','ok')],[{type:'permission_denied_by_policy',data:{request_id:'request-1',reason:'private'}}],'/worker',['a.py']);
  expect(r).toMatchObject({policy_denial_events:1,failure_classes:{},declared_scope:'unverified'});
 });
 it('fails closed on unavailable and unsafe evidence',async()=>{expect(await auditEditRun('/private/tmp','bad')).toMatchObject({status:'unverified'});});
});
describe('edit evidence audit verdict',()=>{
 it('does not validate a run whose writes fall outside the declared files',()=>{
  const r=summarizeEditRun([assistant(call('1','edit',{path:'b.py'})),result('1','ok')],[],'/worker',['a.py']);
  expect(r).toMatchObject({status:'unverified',argument_scope:'outside_declared_arguments'});
 });
 it('treats a successful call to a tool other than read, search or file edits as out of scope',()=>{
  const r=summarizeEditRun([assistant(call('1','bash',{command:'true'})),result('1','ok')],[],'/worker',['a.py']);
  expect(r).toMatchObject({status:'unverified',argument_scope:'outside_declared_arguments'});
 });
 it('validates a complete run that stays within the declared files',()=>{
  expect(summarizeEditRun([assistant(call('1')),result('1','ok')],[],'/worker',['a.py']).status).toBe('validated');
 });
 it('links a backend permission denial to its tool call',()=>{
  const r=summarizeEditRun([assistant(call('1')),result('1','denied')],[{type:'permission_denied',data:{toolCallId:'1',reason:'private'}}],'/worker');
  expect(r).toMatchObject({policy_denial_events:1,failure_classes:{policy_denied:1}});
 });
});
