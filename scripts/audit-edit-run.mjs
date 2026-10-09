import {auditEditRun} from '../dist/diagnostics/edit-run-audit.js';
const [home,runId,...extra]=process.argv.slice(2);if(!home||!runId||extra.length)throw new Error('Usage: audit-edit-run.mjs canonical-private-home run-id');
const report=await auditEditRun(home,runId);console.log(JSON.stringify(report,null,2));if(report.status!=='validated')process.exitCode=1;
