import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KEYCHAIN_PATH,
  MAX_KEYCHAIN_OUTPUT_BYTES,
  ResolvedCredential,
  checkOriginalHome,
  decodeKeychainOutput,
  resolveCredential,
  spawnKeychainRunner,
  type KeychainRequest,
  type KeychainRunResult,
  type KeychainRunner,
} from '../../src/backends/app-server/credentials.js';

const SECRET = 'mistral-test-key-0123456789abcdef';
let scratch = '';
let home = '';

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'app-server-credentials-')));
  home = path.join(scratch, 'home');
  await mkdir(home);
});
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

function recorder(results: Array<KeychainRunResult | Error>): { runner: KeychainRunner; requests: KeychainRequest[] } {
  const requests: KeychainRequest[] = [];
  const runner: KeychainRunner = async (request) => {
    requests.push(request);
    const next = results.shift() ?? { kind: 'exit', code: 44, output: Buffer.alloc(0) };
    if (next instanceof Error) throw next;
    return next;
  };
  return { runner, requests };
}

const exit = (code: number, output = ''): KeychainRunResult => ({ kind: 'exit', code, output: Buffer.from(output) });
const lookup = (runner: KeychainRunner) => resolveCredential({ environment: {}, home, platform: 'darwin', runner });

describe('keychain lookup with an injected runner', () => {
  it('strips exactly one trailing newline and returns the key only through the child environment', async () => {
    const { runner } = recorder([exit(0, `${SECRET}\n`)]);
    const result = await lookup(runner);
    expect(result.status).toBe('keychain');
    expect(result.credential?.environment()).toEqual({ MISTRAL_API_KEY: SECRET });
    expect(result.credential?.secret()).toBe(SECRET);
    const second = recorder([exit(0, `${SECRET}\n\n`)]);
    expect((await lookup(second.runner)).status).toBe('invalid-output');
  });

  it('uses fixed argv, a minimal environment, and the bounds', async () => {
    const { runner, requests } = recorder([exit(0, SECRET)]);
    await lookup(runner);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      executable: '/usr/bin/security',
      args: ['find-generic-password', '-a', 'MISTRAL_API_KEY', '-s', 'ai.mistral.vibe', '-w'],
      env: { HOME: home, PATH: KEYCHAIN_PATH },
      timeoutMs: 5000,
      maxOutputBytes: MAX_KEYCHAIN_OUTPUT_BYTES,
    });
  });

  it('tries the legacy service only after the primary misses', async () => {
    const { runner, requests } = recorder([exit(44), exit(0, SECRET)]);
    const result = await lookup(runner);
    expect(result.credential?.secret()).toBe(SECRET);
    expect(requests.map((request) => request.args[4])).toEqual(['ai.mistral.vibe', 'vibe']);
  });

  it('ignores output on a failing exit and reports not-found', async () => {
    const { runner } = recorder([exit(44, SECRET), exit(44, SECRET)]);
    const result = await lookup(runner);
    expect(result).toEqual({ status: 'not-found', detail: 'ai.mistral.vibe=not-found,vibe=not-found', credential: undefined });
  });

  it('rejects empty, multi-line, NUL and non-UTF-8 output', async () => {
    for (const output of ['', '\n', 'a\nb', 'a\rb', 'a\0b']) {
      expect(decodeKeychainOutput(Buffer.from(output))).toBeUndefined();
    }
    expect(decodeKeychainOutput(Buffer.from([0xff, 0xfe, 0x41]))).toBeUndefined();
    expect(decodeKeychainOutput(Buffer.from('abc\n'))).toBe('abc');
    const { runner } = recorder([exit(0, ''), exit(0, 'a\nb')]);
    expect((await lookup(runner)).status).toBe('invalid-output');
  });

  it('maps timeout, oversize, failure and a throwing runner to value-free reasons', async () => {
    expect((await lookup(recorder([{ kind: 'timeout' }, { kind: 'timeout' }]).runner)).status).toBe('timeout');
    expect((await lookup(recorder([{ kind: 'oversize' }, { kind: 'oversize' }]).runner)).status).toBe('oversize');
    expect((await lookup(recorder([{ kind: 'failed' }, { kind: 'failed' }]).runner)).status).toBe('error');
    const thrown = await lookup(recorder([new Error(`boom ${SECRET}`), new Error('boom')]).runner);
    expect(thrown).toMatchObject({ status: 'error', detail: 'ai.mistral.vibe=error,vibe=error' });
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
  });

  it('maps security exit statuses to distinct reasons', async () => {
    for (const [code, status] of [[44, 'not-found'], [36, 'locked'], [51, 'denied'], [128, 'denied'], [7, 'error']] as const) {
      const result = await lookup(recorder([exit(code), exit(code)]).runner);
      expect(result.status).toBe(status);
    }
    expect((await lookup(recorder([exit(7), exit(7)]).runner)).detail).toBe('ai.mistral.vibe=error-7,vibe=error-7');
  });

  it('reports the most actionable reason regardless of service order', async () => {
    expect((await lookup(recorder([exit(44), exit(36)]).runner)).status).toBe('locked');
    expect((await lookup(recorder([exit(36), exit(44)]).runner)).status).toBe('locked');
    expect((await lookup(recorder([{ kind: 'timeout' }, exit(51)]).runner)).status).toBe('denied');
    expect((await lookup(recorder([exit(9), { kind: 'timeout' }]).runner)).status).toBe('timeout');
    expect((await lookup(recorder([exit(44), exit(9)]).runner)).status).toBe('error');
  });
});

describe('credential resolution order and platform gates', () => {
  it('prefers a non-empty environment credential without any lookup', async () => {
    const { runner, requests } = recorder([exit(0, 'other')]);
    const result = await resolveCredential({ environment: { MISTRAL_API_KEY: SECRET }, home, platform: 'darwin', runner });
    expect(result.status).toBe('environment');
    expect(result.credential?.secret()).toBe(SECRET);
    expect(requests).toEqual([]);
  });

  it('treats an empty environment value as absent', async () => {
    const { runner, requests } = recorder([exit(0, SECRET)]);
    const result = await resolveCredential({ environment: { MISTRAL_API_KEY: '' }, home, platform: 'darwin', runner });
    expect(result.status).toBe('keychain');
    expect(requests).toHaveLength(1);
  });

  it('skips the lookup on other platforms', async () => {
    const { runner, requests } = recorder([exit(0, SECRET)]);
    const result = await resolveCredential({ environment: {}, home, platform: 'linux', runner });
    expect(result).toEqual({ status: 'skipped-platform', detail: '', credential: undefined });
    expect(requests).toEqual([]);
  });

  it('reads HOME from the environment when no home option is given', async () => {
    const { runner, requests } = recorder([exit(0, SECRET)]);
    const result = await resolveCredential({ environment: { HOME: home }, platform: 'darwin', runner });
    expect(result.status).toBe('keychain');
    expect(requests[0]?.env.HOME).toBe(home);
  });

  it('skips the lookup with a specific reason for an untrusted home', async () => {
    const target = path.join(scratch, 'target');
    await mkdir(target);
    const link = path.join(scratch, 'link');
    await symlink(target, link);
    const file = path.join(scratch, 'file');
    await writeFile(file, '');
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'unset'], ['', 'unset'], ['relative/home', 'not-absolute'], [`${home}/../home`, 'not-normalized'],
      [`${home}\0x`, 'not-normalized'], [path.join(scratch, 'absent'), 'missing'], [link, 'symlink'], [file, 'not-directory'],
    ];
    for (const [value, reason] of cases) {
      const { runner, requests } = recorder([exit(0, SECRET)]);
      const result = await resolveCredential({ environment: {}, home: value, platform: 'darwin', runner });
      expect(result).toEqual({ status: 'skipped-home', detail: reason, credential: undefined });
      expect(requests).toEqual([]);
    }
  });

  it('accepts and strips a trailing slash on an owned real directory', async () => {
    expect(await checkOriginalHome(`${home}/`)).toEqual({ path: home, reason: 'ok' });
    const { runner, requests } = recorder([exit(0, SECRET)]);
    await resolveCredential({ environment: {}, home: `${home}/`, platform: 'darwin', runner });
    expect(requests[0]?.env.HOME).toBe(home);
  });
});

describe('credential holder', () => {
  it('never reveals the value through serialization, string conversion or inspection', () => {
    const credential = new ResolvedCredential(SECRET);
    const resolution = { status: 'keychain', detail: '', credential };
    for (const text of [JSON.stringify(resolution), String(credential), `${credential}`, inspect(resolution, { depth: 5 }), inspect(credential)]) {
      expect(text).not.toContain(SECRET);
    }
  });
});

describe('real runner against a fake security executable', () => {
  async function fakeSecurity(body: string): Promise<string> {
    const file = path.join(scratch, 'fake-security');
    await writeFile(file, `#!/bin/sh\n${body}\n`);
    await chmod(file, 0o700);
    return file;
  }

  it('passes the exact argv and only HOME and PATH', async () => {
    const log = path.join(scratch, 'log');
    const executable = await fakeSecurity(`printf '%s\\n' "$@" > '${log}'\nenv | sort >> '${log}'\nprintf '%s\\n' '${SECRET}'`);
    const result = await resolveCredential({ environment: { HOME: home, UNRELATED: 'leak-canary', MISTRAL_API_KEY: '' }, platform: 'darwin', executable });
    expect(result.status).toBe('keychain');
    expect(result.credential?.secret()).toBe(SECRET);
    const text = await readFile(log, 'utf8');
    expect(text.split('\n').slice(0, 6)).toEqual(['find-generic-password', '-a', 'MISTRAL_API_KEY', '-s', 'ai.mistral.vibe', '-w']);
    expect(text).toContain(`HOME=${home}`);
    expect(text).toContain(`PATH=${KEYCHAIN_PATH}`);
    expect(text).not.toContain('leak-canary');
  });

  it('discards output and stderr on a nonzero exit', async () => {
    const executable = await fakeSecurity(`printf '%s' '${SECRET}'; printf '%s' '${SECRET}' >&2; exit 44`);
    const result = await resolveCredential({ environment: { HOME: home }, platform: 'darwin', executable });
    expect(result).toEqual({ status: 'not-found', detail: 'ai.mistral.vibe=not-found,vibe=not-found', credential: undefined });
  });

  it('times out and kills the process group', async () => {
    const pidFile = path.join(scratch, 'pid');
    const executable = await fakeSecurity(`echo $$ > '${pidFile}'\nsleep 30`);
    const started = Date.now();
    const result = await resolveCredential({ environment: { HOME: home }, platform: 'darwin', executable, timeoutMs: 300 });
    expect(result.status).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5000);
    const recorded = await readFile(pidFile, 'utf8').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (recorded === undefined) {
      await expect(readFile(pidFile, 'utf8')).rejects.toThrow();
      return;
    }
    const pid = Number(recorded.trim());
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('rejects output above the limit', async () => {
    const executable = await fakeSecurity(`head -c 20000 /dev/zero | tr '\\0' 'a'`);
    const result = await resolveCredential({ environment: { HOME: home }, platform: 'darwin', executable });
    expect(result.status).toBe('oversize');
    expect(result.credential).toBeUndefined();
  });

  it('reports a missing executable as an error without a value', async () => {
    const result = await resolveCredential({ environment: { HOME: home }, platform: 'darwin', executable: path.join(scratch, 'absent-security') });
    expect(result.status).toBe('error');
    expect(await spawnKeychainRunner({ executable: path.join(scratch, 'absent-security'), args: [], env: { HOME: home, PATH: KEYCHAIN_PATH }, timeoutMs: 1000, maxOutputBytes: 10 })).toEqual({ kind: 'failed' });
  });
});
