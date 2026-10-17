import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { FindingsArtifact } from '../../contracts.js';
import { supervisorError } from '../../contracts.js';
import { readOwnedFile } from '../../reporting/private-files.js';
import { convertFindingsToSarif } from '../../core/sarif.js';
import { fail } from '../fail.js';
import { locateListedRun, resolveDataDir, validRunId } from '../runs.js';
import type { RunsInvocation } from '../runs.js';

export const MAX_FINDINGS_BYTES = 10 * 1024 * 1024;
const USAGE = 'Usage: vibe-supervisor runs [--config <path>] sarif <run-id> [--output <file> | --out <file>]';

export interface SarifCliOptions {
  runId: string;
  outputPath?: string;
}

export function parseSarifOptions(invocation: RunsInvocation): SarifCliOptions {
  const { positional } = invocation;
  const runId = positional[1];
  if (!runId || !validRunId(runId)) {
    fail('runs sarif requires a valid run UUID.', 2);
  }

  let outputPath: string | undefined;
  const seen = new Set<string>();

  for (let index = 2; index < positional.length; index++) {
    const flag = positional[index]!;
    const value = positional[++index];
    if (seen.has(flag) || !value || value.startsWith('--')) {
      fail('Invalid or repeated sarif option.', 2);
    }
    seen.add(flag);
    if (flag === '--output' || flag === '--out') {
      outputPath = path.resolve(value);
    } else {
      fail(USAGE, 2);
    }
  }

  return { runId, ...(outputPath ? { outputPath } : {}) };
}

export async function runsSarif(invocation: RunsInvocation): Promise<void> {
  const options = parseSarifOptions(invocation);
  const { dataDir } = await resolveDataDir(invocation.configPath);
  const directory = await locateListedRun(dataDir, options.runId);

  const findingsPath = path.join(directory, 'artifacts', 'findings.json');
  let rawBytes: Buffer;
  try {
    rawBytes = await readOwnedFile(findingsPath, MAX_FINDINGS_BYTES);
  } catch {
    const message = `Run ${options.runId} has no findings artifact; run must be a review with output='findings'.`;
    throw Object.assign(new Error(message), supervisorError('VSUP_INVALID_STATE', message));
  }

  let findingsArtifact: FindingsArtifact;
  try {
    findingsArtifact = JSON.parse(rawBytes.toString('utf8')) as FindingsArtifact;
  } catch {
    const message = `Run ${options.runId} findings artifact is invalid JSON.`;
    throw Object.assign(new Error(message), supervisorError('VSUP_INVALID_STATE', message));
  }

  const sarifLog = convertFindingsToSarif(findingsArtifact);
  const rendered = `${JSON.stringify(sarifLog, null, 2)}\n`;

  if (options.outputPath) {
    await writeFile(options.outputPath, rendered, 'utf8');
  } else {
    process.stdout.write(rendered);
  }
}
