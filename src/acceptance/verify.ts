import path from 'node:path';
import { inspectNodeTests } from './node-test.js';
import { z } from 'zod';
import { atomicWriteJson } from '../persistence/atomic.js';
import { createPrivateDir, createPrivateFile } from '../security/paths.js';
import { inspectExport } from '../git/worktree.js';
import { readOwnedFile, assertOwnedDirectory } from '../reporting/private-files.js';
import { acceptanceContractSchema, contractDigest, digest, safeRelativePath, sha256, type AcceptanceContract, type CheckResult, type Verification } from './schema.js';

const snapshotSchema = z.object({ schema_version: z.literal(1), contract_sha256: sha256, patch_sha256: sha256, base_commit: z.string().regex(/^[a-f0-9]{40,64}$/), execution_state: z.enum(['completed', 'failed', 'cancelled']), stop_reason: z.string().nullable(), changed_files: z.array(safeRelativePath).max(1000), files: z.array(z.object({ path: safeRelativePath, mode: z.string().nullable(), sha256: sha256.nullable(), bytes: z.number().int().min(0).max(4 * 1024 * 1024) }).strict()).max(100) }).strict();
type Snapshot = z.infer<typeof snapshotSchema>;
const MAX_INPUTS = 16 * 1024 * 1024;

export async function captureVerification(options: { directory: string; source: string; base: string; patch: Buffer; contract: AcceptanceContract; executionState: 'completed' | 'failed' | 'cancelled'; stopReason?: string; maxBytes: number }): Promise<Verification> {
  const { directory, source, base, patch, contract } = options;
  const inputs = path.join(directory, 'acceptance'); await createPrivateDir(inputs); await createPrivateDir(path.join(inputs, 'blobs'));
  const paths = [...new Set(contract.checks.map((check) => check.path))];
  const candidate = await inspectExport(source, base, patch, paths, Math.min(MAX_INPUTS, options.maxBytes));
  let total = 0;
  const files: Snapshot['files'] = [];
  for (const file of paths) {
    const entry = candidate.files[file];
    if (!entry) { files.push({ path: file, mode: null, sha256: null, bytes: 0 }); continue; }
    total += entry.bytes.length;
    if (total > Math.min(MAX_INPUTS, options.maxBytes)) throw new Error('Verification inputs exceed artifact budget');
    const hash = digest(entry.bytes);
    try { await createPrivateFile(path.join(inputs, 'blobs', hash), entry.bytes, 'wx'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (digest(await readOwnedFile(path.join(inputs, 'blobs', hash))) !== hash) throw new Error('Verification blob mismatch'); }
    files.push({ path: file, mode: entry.mode, sha256: hash, bytes: entry.bytes.length });
  }
  const snapshot: Snapshot = { schema_version: 1, contract_sha256: contractDigest(contract), patch_sha256: digest(patch), base_commit: base, execution_state: options.executionState, stop_reason: options.stopReason ?? null, changed_files: candidate.changedFiles, files };
  await atomicWriteJson(path.join(inputs, 'snapshot.json'), snapshotSchema.parse(snapshot));
  return verifySaved(directory, contract, Math.max(options.maxBytes, patch.length));
}

export async function verifySaved(directory: string, rawContract: AcceptanceContract | undefined, maxBytes: number): Promise<Verification> {
  if (!rawContract) return { status: 'not_requested', checks: [] };
  const contract = acceptanceContractSchema.parse(rawContract);
  const binding = { contract_sha256: contractDigest(contract), checked_at: new Date().toISOString() };
  try {
    await assertOwnedDirectory(directory);
    const inputRoot = path.join(directory, 'acceptance'); await assertOwnedDirectory(inputRoot); await assertOwnedDirectory(path.join(inputRoot, 'blobs'));
    const snapshot = snapshotSchema.parse(JSON.parse((await readOwnedFile(path.join(inputRoot, 'snapshot.json'), 256 * 1024)).toString('utf8')));
    const patch = await readOwnedFile(path.join(directory, 'artifacts', 'diff.patch'), maxBytes);
    if (snapshot.contract_sha256 !== binding.contract_sha256 || digest(patch) !== snapshot.patch_sha256) throw new Error('Artifact binding mismatch');
    const changed = new Set(snapshot.changed_files);
    const checks: CheckResult[] = [
      { id: '$scope', status: snapshot.changed_files.every((file) => contract.allowed_changed_paths.includes(file)) ? 'passed' : 'failed', reason: 'changed-path-allowlist' },
      { id: '$required_changes', status: contract.required_changed_paths.every((file) => changed.has(file)) ? 'passed' : 'failed', reason: 'required-changed-paths' }
    ];
    const files = new Map(snapshot.files.map((file) => [file.path, file]));
    let readBytes = 0;
    for (const check of contract.checks) {
      const file = files.get(check.path);
      if (!file) throw new Error('Missing verification input');
      let passed = false;
      let reason = check.kind as string;
      if (check.kind === 'file_absent') passed = file.mode === null;
      else if (file.mode !== '100644' && file.mode !== '100755') reason = file.mode === null ? 'file-missing' : 'unsupported-file-type';
      else {
        if (!file.sha256) throw new Error('Missing file digest');
        const bytes = await readOwnedFile(path.join(inputRoot, 'blobs', file.sha256), Math.min(maxBytes, 4 * 1024 * 1024));
        readBytes += bytes.length;
        if (readBytes > Math.min(maxBytes, MAX_INPUTS) * 100) throw new Error('Verification read limit');
        if (digest(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error('Verification input modified');
        if (check.kind === 'file_exists') passed = true;
        else if (check.kind === 'file_sha256') passed = file.sha256 === check.value;
        else if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)) reason = 'unsupported-text-encoding';
        else if (check.kind === 'node_test') {
          const structure = inspectNodeTests(bytes.toString('utf8'), check.min_cases);
          passed = structure.passed; reason = structure.reason;
        } else passed = check.kind === 'text_contains' ? bytes.toString('utf8').includes(check.value) : !bytes.toString('utf8').includes(check.value);
      }
      checks.push({ id: check.id, path: check.path, status: passed ? 'passed' : 'failed', reason });
    }
    const status = snapshot.execution_state !== 'completed' || snapshot.stop_reason !== 'end_turn' ? 'incomplete' : checks.every((check) => check.status === 'passed') ? 'passed' : 'failed';
    return { ...binding, patch_sha256: snapshot.patch_sha256, base_commit: snapshot.base_commit, execution_state: snapshot.execution_state, status, checks };
  } catch {
    return { ...binding, status: 'incomplete', checks: [{ id: '$artifacts', status: 'incomplete', reason: 'missing-unsafe-or-changed-verification-inputs' }] };
  }
}
