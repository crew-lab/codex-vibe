import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyStartFailure, rateLimitFailure } from '../../src/backends/app-server/failure.js';

let scratch = '';

beforeEach(async () => { scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'app-server-failure-'))); });
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

describe('rate limit classification', () => {
  it.each([
    'HTTP 429 Too Many Requests',
    'Rate limit exceeded (429): too many requests',
    'status code: 429',
    'API error 429',
    'Too many requests, retry later'
  ])('recognizes %s', (text) => {
    expect(rateLimitFailure(text)).toMatchObject({ code: 'VSUP_RATE_LIMITED', retryable: true });
  });

  it.each(['processed 4290 files', 'exit code 1', 'Unauthorized (401): missing api key', 'line 1429 failed', 'x-ratelimit-limit: 100', 'Retrying after rate limit in 5s', 'rate-limited by the provider', ''])('ignores %s', (text) => {
    expect(rateLimitFailure(text)).toBeUndefined();
  });

  it('reads a 401 before any rate-limit text', async () => {
    expect(await classifyStartFailure('vibe', new Error('boom'), 'HTTP 401 Unauthorized\nx-ratelimit-limit: 100')).toMatchObject({ code: 'VSUP_AUTH_REQUIRED' });
  });

  it('reports a missing interpreter even when stderr mentions a 429', async () => {
    const orphan = path.join(scratch, 'orphan-vibe');
    await writeFile(orphan, '#!/nonexistent/interpreter\n');
    await chmod(orphan, 0o755);
    const failure = await classifyStartFailure(orphan, Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), 'HTTP 429 Too Many Requests');
    expect(failure).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND', details: { interpreter_missing: true, interpreter: '/nonexistent/interpreter' } });
  });

  it('reports a missing executable even when stderr mentions a 429', async () => {
    const failure = await classifyStartFailure(path.join(scratch, 'absent'), Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), 'HTTP 429 Too Many Requests');
    expect(failure).toMatchObject({ code: 'VSUP_VIBE_NOT_FOUND' });
  });

  it('classifies a start failure whose stderr reports a rate limit', async () => {
    expect(await classifyStartFailure('vibe', new Error('boom'), 'error: HTTP 429 Too Many Requests')).toMatchObject({ code: 'VSUP_RATE_LIMITED', retryable: true });
  });

  it('reads a version mismatch printed on stderr before anything else', async () => {
    expect(await classifyStartFailure('vibe', new Error('boom'), 'this release supports exactly 2.26.1; found 2.27.0')).toMatchObject({ code: 'VSUP_VIBE_VERSION_UNSUPPORTED', details: { detected_version: '2.27.0' } });
  });
});
