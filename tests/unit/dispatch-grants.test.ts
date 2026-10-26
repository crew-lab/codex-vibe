import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, chmod, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DispatchGrants, MAX_GRANT_LIFETIME_MS } from '../../src/core/dispatch-grants.js';

const roots: string[] = [];
const digest = 'a'.repeat(64);
async function fixture(): Promise<string> { const root = await mkdtemp(path.join(await realpath(tmpdir()), 'dispatch-grants-')); roots.push(root); return path.join(root, 'grants'); }
const input = (expiresAt = new Date(Date.now() + 60_000).toISOString()) => ({ requestSha256: digest, ownerReference: 'owner-123', expiresAt });

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('DispatchGrants', () => {
  it('issues one bound attempt, consumes it once, and retains it across instances', async () => {
    const root = await fixture(); const grants = new DispatchGrants(root); const issued = await grants.issue(input());
    expect(issued.authorization_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(issued.attempt_id).toMatch(/^[0-9a-f-]{36}$/i);
    await grants.consume({ authorizationId: issued.authorization_id, attemptId: issued.attempt_id, requestSha256: digest, runId: issued.attempt_id });
    await expect(new DispatchGrants(root).consume({ authorizationId: issued.authorization_id, attemptId: issued.attempt_id, requestSha256: digest, runId: issued.attempt_id })).rejects.toMatchObject({ code: 'VSUP_ATTEMPT_CONSUMED' });
    expect(await readFile(path.join(root, 'consumed', `${issued.attempt_id}.json`), 'utf8')).toContain('"run_id"');
  });

  it('rejects invalid inputs, expired grants, and binding mismatches', async () => {
    const root = await fixture(); const grants = new DispatchGrants(root);
    await expect(grants.issue({ ...input(), requestSha256: 'bad' })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    const credentialLikeOwnerReference = ['sk', '123456789012'].join('-');
    await expect(grants.issue({ ...input(), ownerReference: credentialLikeOwnerReference })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    await expect(grants.issue(input(new Date(Date.now() - 1000).toISOString()))).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    const issued = await grants.issue(input());
    await expect(grants.consume({ authorizationId: issued.authorization_id, attemptId: issued.attempt_id, requestSha256: 'b'.repeat(64), runId: issued.attempt_id })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
    const expired = await grants.issue({ ...input(), expiresAt: new Date(Date.now() + 10).toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(grants.consume({ authorizationId: expired.authorization_id, attemptId: expired.attempt_id, requestSha256: digest, runId: expired.attempt_id })).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID' });
  });

  it('refuses an authorization that would outlive 24 hours', async () => {
    const root = await fixture(); const grants = new DispatchGrants(root);
    await expect(grants.issue(input(new Date(Date.now() + MAX_GRANT_LIFETIME_MS + 60_000).toISOString()))).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', message: expect.stringContaining('24 hours') });
    await expect(grants.issue(input(new Date(Date.now() + MAX_GRANT_LIFETIME_MS - 60_000).toISOString()))).resolves.toMatchObject({ request_sha256: digest });
  });

  it('says when nothing was ever registered under the data directory, apart from an unknown authorization', async () => {
    const root = await fixture();
    const unknown = { authorizationId: '00000000-0000-4000-8000-000000000000', attemptId: '00000000-0000-4000-8000-000000000001', requestSha256: digest, runId: '00000000-0000-4000-8000-000000000002' };
    await expect(new DispatchGrants(root).consume(unknown)).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', message: expect.stringContaining('No dispatch authorization is registered') });
    await new DispatchGrants(root).issue(input());
    await expect(new DispatchGrants(root).consume(unknown)).rejects.toMatchObject({ code: 'VSUP_AUTHORIZATION_INVALID', message: 'The dispatch authorization is invalid or unavailable.' });
  });

  it('allows only one consumer across separate processes', async () => {
    const root = await fixture(); const issued = await new DispatchGrants(root).issue(input());
    const builtModule = path.join(process.env.VIBE_SUPERVISOR_TEST_DIST ?? '', 'core', 'dispatch-grants.js');
    const script = `import { DispatchGrants } from ${JSON.stringify(pathToFileURL(builtModule).href)}; try { await new DispatchGrants(${JSON.stringify(root)}).consume({authorizationId:${JSON.stringify(issued.authorization_id)},attemptId:${JSON.stringify(issued.attempt_id)},requestSha256:${JSON.stringify(digest)},runId:${JSON.stringify(issued.attempt_id)}}); process.exit(0); } catch (e) { process.exit(e.code === 'VSUP_ATTEMPT_CONSUMED' ? 3 : 4); }`;
    const run = () => new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' });
      child.once('close', (code) => resolve(code));
    });
    const results = await Promise.all([run(), run()]);
    expect(results.sort()).toEqual([0, 3]);
  });

  it('rejects symlinked and malformed grant records, and treats partial reservations as consumed', async () => {
    const root = await fixture(); const grants = new DispatchGrants(root); const issued = await grants.issue(input());
    await rm(path.join(root, `${issued.authorization_id}.json`));
    await symlink('missing.json', path.join(root, `${issued.authorization_id}.json`));
    await expect(grants.consume({ authorizationId: issued.authorization_id, attemptId: issued.attempt_id, requestSha256: digest, runId: issued.attempt_id })).rejects.toMatchObject({ code: 'VSUP_STORAGE_ERROR' });
    await rm(path.join(root, `${issued.authorization_id}.json`));
    const malformed = await grants.issue(input());
    await mkdir(path.join(root, 'consumed'), { mode: 0o700 });
    await (await import('node:fs/promises')).writeFile(path.join(root, 'consumed', `${malformed.attempt_id}.json`), '{');
    await expect(grants.consume({ authorizationId: malformed.authorization_id, attemptId: malformed.attempt_id, requestSha256: digest, runId: malformed.attempt_id })).rejects.toMatchObject({ code: 'VSUP_ATTEMPT_CONSUMED' });
  });

  it('keeps the reservation consumed when its final durability check fails', async () => {
    const root = await fixture();
    const grants = new DispatchGrants(root);
    const issued = await grants.issue(input());
    const internal = grants as unknown as { syncDirectory(directory: string): Promise<void> };
    const original = internal.syncDirectory.bind(grants);
    vi.spyOn(internal, 'syncDirectory').mockImplementation(async directory => {
      if (directory === path.join(root, 'consumed')) throw new Error('fixture directory sync failure');
      await original(directory);
    });
    const request = { authorizationId: issued.authorization_id, attemptId: issued.attempt_id, requestSha256: digest, runId: issued.attempt_id };
    await expect(grants.consume(request)).rejects.toMatchObject({ code: 'VSUP_STORAGE_ERROR' });
    await expect(new DispatchGrants(root).consume(request)).rejects.toMatchObject({ code: 'VSUP_ATTEMPT_CONSUMED' });
  });

  it('keeps grant directories and records private', async () => {
    const root = await fixture(); await mkdir(root, { mode: 0o755 }); await chmod(root, 0o700);
    const issued = await new DispatchGrants(root).issue(input());
    expect((await lstat(root)).mode & 0o077).toBe(0);
    expect((await lstat(path.join(root, `${issued.authorization_id}.json`))).mode & 0o077).toBe(0);
  });

  it('refuses a symlinked parent without creating grants through it', async () => {
    const root = await fixture(); const alias = `${root}-alias`;
    await symlink(path.dirname(root), alias);
    await expect(new DispatchGrants(path.join(alias, 'linked-grants')).issue(input())).rejects.toMatchObject({ code: 'VSUP_STORAGE_ERROR' });
    await expect(lstat(path.join(path.dirname(root), 'linked-grants'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
