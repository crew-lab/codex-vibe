/** Fixture evidence only. Does not claim or exercise real conformance. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function writeFakePreparation(configPath: string): Promise<void> {
  const dist=process.env.VIBE_SUPERVISOR_TEST_DIST!;
  const evidence=await import(pathToFileURL(path.join(dist,'preparation/evidence.js')).href);
  const {loadResolvedConfig}=await import(pathToFileURL(path.join(dist,'config/config.js')).href);
  const {digest}=await import(pathToFileURL(path.join(dist,'acceptance/schema.js')).href);
  const {config}=await loadResolvedConfig({configPath});
  const report=Buffer.from(JSON.stringify({fixture:true,hosted_acceptance:'unverified'}));
  const directory=path.join(path.dirname(evidence.receiptPath(config)),'preparation-reports');await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(path.join(directory,`${digest(report)}.json`),report,{mode:0o600});
  await writeFile(evidence.receiptPath(config),JSON.stringify({schema_version:1,result:'passed',identity:await evidence.preparationIdentity(config),checked_at:new Date().toISOString(),report_sha256:digest(report)}),{mode:0o600});
}
