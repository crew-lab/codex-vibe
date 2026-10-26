import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function authorizeCli(cli: string, config: string, operation: 'review' | 'edit', request: Record<string, unknown>): Promise<{ authorization_id: string; attempt_id: string }> {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-grant-cli-'));
  const file = path.join(root, 'request.json');
  const dispatch = { ...request };
  delete dispatch.readiness_receipt;
  delete dispatch.wait_seconds;
  delete dispatch.authorization_id;
  delete dispatch.attempt_id;
  try {
    await writeFile(file, JSON.stringify({ operation, request: dispatch }), { mode: 0o600 });
    const result = await exec(process.execPath, [cli, 'task', 'authorize', '--request', file, '--owner-reference', 'deterministic-test-owner', '--expires-at', new Date(Date.now() + 3600_000).toISOString(), '--config', config]);
    const grant = JSON.parse(result.stdout);
    return { authorization_id: grant.authorization_id, attempt_id: grant.attempt_id };
  } finally { await rm(root, { recursive: true, force: true }); }
}
