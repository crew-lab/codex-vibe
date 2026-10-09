import {readFile,lstat} from 'node:fs/promises';
import {loadConfig} from '../dist/config/config.js';
import {prepareReviewedBaseline} from '../dist/git/reviewed-baseline.js';
const [manifest,flag,...extra]=process.argv.slice(2);
if(!manifest||(flag!==undefined&&flag!=='--create')||extra.length)throw new Error('Usage: prepare-reviewed-baseline.mjs manifest.json [--create]. Default: dry-run. --create writes a disposable snapshot repository with local commits, never source refs.');
const st=await lstat(manifest);if(!st.isFile()||st.isSymbolicLink()||st.size>1024*1024)throw new Error('Unsafe manifest');
const config=await loadConfig();
try { const report=await prepareReviewedBaseline(JSON.parse(await readFile(manifest,'utf8')),config.allowedWorkspaceRoots,flag==='--create');console.log(JSON.stringify(report,null,2)); }
catch { console.error('Baseline preparation refused; inspect selected paths/hashes and private owned output, without changing source or allowlists.');process.exitCode=1; }
