import { spawn } from 'node:child_process';
import { lstat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { canonical, digest, safeRelativePath } from '../acceptance/schema.js';
import { sanitizeForPersistence } from '../persistence/atomic.js';
import { assertOwnedDirectory, parseInputJson, readOwnedFile } from '../reporting/private-files.js';
import { environmentSecrets, googleCredentialSecrets } from '../security/redaction.js';
import { validationFingerprint } from './workspace.js';

const profileSchema = z.object({ schema_version: z.literal(1), owner: z.literal('vibe-supervisor-validation'), root: z.string(), device: z.number(), inode: z.number(), tree_sha256: z.string(), patch_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough();

export async function checkNodeTests(options: { directory: string; tests: string[]; output: string; validationId: string; timeoutSeconds?: number }): Promise<unknown> {
  const directory = path.resolve(options.directory);
  await assertOwnedDirectory(directory);
  const manifest = parseInputJson(await readOwnedFile(path.join(directory, 'manifest.json'), 16 * 1024), 'validation', profileSchema);
  const info = await lstat(directory);
  if (manifest.root !== directory || manifest.device !== info.dev || manifest.inode !== info.ino || manifest.tree_sha256 !== await validationFingerprint(directory)) throw new Error('Validation workspace changed; prepare fresh copies before checking.');
  const tests = z.array(safeRelativePath.refine(value => /\.(?:mjs|cjs|js)$/.test(value))).min(1).max(50).parse(options.tests);
  if (new Set(tests).size !== tests.length || !/^[a-zA-Z0-9_.-]{1,100}$/.test(options.validationId)) throw new Error('Invalid validation profile selection');
  const timeoutSeconds = z.number().int().min(1).max(120).parse(options.timeoutSeconds ?? 30);
  const candidate = path.join(directory, 'candidate');
  const candidateInfo = await lstat(candidate);
  if (await realpath(candidate) !== candidate || !candidateInfo.isDirectory() || candidateInfo.uid !== info.uid) throw new Error('Unsafe candidate directory.');
  for (const test of tests) {
    const file = path.join(candidate, test);
    if (await realpath(file) !== file || !(await lstat(file)).isFile()) throw new Error('Test paths must be canonical regular files in the candidate.');
  }
  const output = path.resolve(options.output);
  if (output === directory || output.startsWith(directory + path.sep)) throw new Error('Validation report must be outside the workspace.');
  await assertOwnedDirectory(path.dirname(output));
  for (const file of [output, output + '.evidence.json']) {
    try { await lstat(file); throw new Error('Validation output already exists; choose a new report path.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const reportHandle = await open(output, 'wx', 0o600);
  try {
  const evidenceHandle = await open(output + '.evidence.json', 'wx', 0o600);
  try {
  const profile = { kind: 'node-test', tests, timeout_seconds: timeoutSeconds, node: process.version };
  const outcome = await new Promise<{ status: 'passed' | 'failed'; reason: string; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', ...tests], { cwd: candidate, env: { PATH: path.dirname(process.execPath), HOME: path.join(directory, 'home'), TMPDIR: path.join(directory, 'tmp'), CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let bytes = 0; let diagnostic = ''; let reason = 'exit'; let killTimer: NodeJS.Timeout | undefined; let graceTimer: NodeJS.Timeout | undefined; let settled = false;
    const finish = (status: 'passed' | 'failed', finalReason: string): void => {
      if (settled) return; settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer); if (graceTimer) clearTimeout(graceTimer);
      resolve({ status, reason: finalReason, output: diagnostic });
    };
    const signal = (value: NodeJS.Signals): void => { if (child.pid) { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, value); } catch {} } };
    const stop = (why: string): void => { if (reason !== 'exit') return; reason = why; signal('SIGTERM'); killTimer = setTimeout(() => signal('SIGKILL'), 1000); killTimer.unref(); graceTimer = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish('failed', `${reason}-cleanup-unverified`); }, 2000); };
    const timer = setTimeout(() => stop('timeout'), timeoutSeconds * 1000); timer.unref();
    const collect = (chunk: Buffer): void => { bytes += chunk.length; if (bytes > 256 * 1024) stop('output-limit'); else diagnostic += chunk.toString('utf8'); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { if (settled) return; settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer); if (graceTimer) clearTimeout(graceTimer); reject(error); });
    child.once('close', code => { signal('SIGKILL'); finish(code === 0 && reason === 'exit' ? 'passed' : 'failed', reason === 'exit' ? `exit-${code}` : reason); });
  });
  const diagnostic = String(sanitizeForPersistence(outcome.output.replaceAll(directory, '<validation-workspace>'), [...environmentSecrets(), ...googleCredentialSecrets()]));
  const evidence = { profile, profile_sha256: digest(canonical(profile)), patch_sha256: manifest.patch_sha256, status: outcome.status, reason: outcome.reason, diagnostic };
  const report = { schema_version: 1, patch_sha256: manifest.patch_sha256, validations: [{ id: options.validationId, status: outcome.status, evidence_sha256: digest(canonical(evidence)) }] };
  await evidenceHandle.writeFile(JSON.stringify(evidence, null, 2) + '\n');
  await evidenceHandle.sync();
  await reportHandle.writeFile(JSON.stringify(report, null, 2) + '\n');
  await reportHandle.sync();
  return { ...report, report: output, reason: outcome.reason };
  } finally { await evidenceHandle.close(); }
  } finally { await reportHandle.close(); }
}
