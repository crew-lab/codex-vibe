import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface Grant { authorization_id: string; attempt_id: string; request_sha256: string; expires_at: string }

function dispatchRequest(request: Record<string, unknown>): Record<string, unknown> {
  const dispatch = { ...request };
  delete dispatch.readiness_receipt;
  delete dispatch.wait_seconds;
  delete dispatch.authorization_id;
  delete dispatch.attempt_id;
  return dispatch;
}

async function withRequestFile<T>(operation: 'review' | 'edit', request: Record<string, unknown>, use: (file: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-grant-cli-'));
  const file = path.join(root, 'request.json');
  try {
    await writeFile(file, JSON.stringify({ operation, request: dispatchRequest(request) }), { mode: 0o600 });
    return await use(file);
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function authorizeCli(cli: string, config: string, operation: 'review' | 'edit', request: Record<string, unknown>): Promise<{ authorization_id: string; attempt_id: string }> {
  return withRequestFile(operation, request, async (file) => {
    const result = await exec(process.execPath, [cli, 'task', 'authorize', '--request', file, '--owner-reference', 'deterministic-test-owner', '--expires-at', new Date(Date.now() + 3600_000).toISOString(), '--config', config]);
    const grant = JSON.parse(result.stdout) as Grant;
    return { authorization_id: grant.authorization_id, attempt_id: grant.attempt_id };
  });
}

export async function authorizeWithReturnedCommand(argv: readonly string[], operation: 'review' | 'edit', request: Record<string, unknown>, ownerReference = 'deterministic-test-owner'): Promise<Grant> {
  return withRequestFile(operation, request, async (file) => {
    const filled = argv.map((word) => word === '<private-request-file>' ? file : word === '<owner-reference>' ? ownerReference : word);
    const [executable, ...args] = filled;
    const result = await exec(executable!, args);
    return JSON.parse(result.stdout) as Grant;
  });
}
