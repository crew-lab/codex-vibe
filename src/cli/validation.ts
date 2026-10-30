import { checkNodeTests } from '../validation/check.js';
import { prepareValidation, cleanValidation } from '../validation/workspace.js';
export async function validationCommand(args:string[]):Promise<unknown>{
 if(args[0]==='check'){
  const values=new Map<string,string>();
  for(let i=1;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--dir','--tests','--out','--id','--timeout-seconds'].includes(key)||!value||value.startsWith('--')||values.has(key))throw new Error('Invalid validation check arguments');values.set(key,value);}
  for(const key of ['--dir','--tests','--out','--id'])if(!values.has(key))throw new Error(`Missing ${key}`);
  return checkNodeTests({directory:values.get('--dir')!,tests:values.get('--tests')!.split(','),output:values.get('--out')!,validationId:values.get('--id')!,...(values.has('--timeout-seconds')?{timeoutSeconds:Number(values.get('--timeout-seconds'))}:{})});
 }
 if(args[0]==='clean'&&args.length===2)return cleanValidation(args[1]!);
 if(args[0]!=='prepare')throw new Error('Usage: validation prepare --source <root> --base <commit> --patch <file> --out <directory> [--manager <executable>] [--cache <populated-cache>] [--no-install] | validation clean <directory>');
 const values=new Map<string,string>();let install=true;
 for(let i=1;i<args.length;i++){
  const key=args[i]!;if(key==='--no-install'&&install){install=false;continue;}
  const value=args[++i];if(!['--source','--base','--patch','--out','--manager','--cache'].includes(key)||!value||value.startsWith('--')||values.has(key))throw new Error('Invalid validation arguments');values.set(key,value);
 }
 for(const key of ['--source','--base','--patch','--out',...(install?['--manager']:[])])if(!values.has(key))throw new Error(`Missing ${key}`);
 return prepareValidation({source:values.get('--source')!,base:values.get('--base')!,patchFile:values.get('--patch')!,output:values.get('--out')!,install,...(values.has('--manager')?{manager:values.get('--manager')!}:{}),...(values.has('--cache')?{cache:values.get('--cache')!}:{})});
}
