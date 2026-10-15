import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { configureManagedConfigEndpoint, startManagedConfigEndpoint, type ManagedConfigEndpoint } from '../../src/backends/app-server/managed-config.js';
import { buildSessionConfig } from '../../src/backends/app-server/session-config.js';

const endpoints: ManagedConfigEndpoint[] = [];
afterEach(async () => { await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close())); });

function call(url: string, method = 'GET', body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: { Authorization: 'Bearer fake-local-test-value', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('owned managed-config endpoint', () => {
  it('serves only a disabled policy, refuses other paths/methods/bodies, and closes its listener', async () => {
    const endpoint = await startManagedConfigEndpoint();
    endpoints.push(endpoint);
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await call(`${endpoint.url}/api/v1/code/managed-config`)).toEqual({ status: 200, body: '{"state":"disabled"}' });
    for (const [suffix, method, body] of [['/other', 'GET'], ['/api/v1/code/managed-config?x=1', 'GET'], ['/api/v1/code/managed-config', 'POST'], ['/api/v1/code/managed-config', 'GET', 'payload']]) {
      expect(await call(`${endpoint.url}${suffix}`, method, body)).toEqual({ status: 403, body: '{}' });
    }
    await endpoint.close();
    await endpoint.close();
    await expect(call(`${endpoint.url}/api/v1/code/managed-config`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('pins the owned endpoint into both child config and mandatory read-back', () => {
    const plan = buildSessionConfig({ mode: 'review', workspace: '/srv/work', runDirectory: '/srv/run', maxTurns: 1 });
    configureManagedConfigEndpoint(plan, 'http://127.0.0.1:12345');
    expect(plan.environment.VIBE_VIBE_BASE_URL).toBe('http://127.0.0.1:12345');
    expect(plan.expectation.settings).toContainEqual({ path: ['vibe_base_url'], value: 'http://127.0.0.1:12345', match: 'equal' });
    for (const invalid of ['https://chat.mistral.ai', 'http://localhost:1234', 'http://127.0.0.1:0', 'http://127.0.0.1:99999', 'http://127.0.0.1:1234/path']) {
      expect(() => configureManagedConfigEndpoint(plan, invalid)).toThrow(TypeError);
    }
  });
});
