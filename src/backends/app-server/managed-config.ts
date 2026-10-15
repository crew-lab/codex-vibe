import { createServer } from 'node:http';
import type { SessionConfigPlan } from './session-config.js';

export interface ManagedConfigEndpoint {
  readonly url: string;
  close(): Promise<void>;
}

/** Local, non-forwarding replacement for Vibe's remote managed-config service.
 * Never reads, records or echoes the Authorization header. No request bodies
 * are accepted and no vendor/provider connection is made by this service.
 */
export async function startManagedConfigEndpoint(): Promise<ManagedConfigEndpoint> {
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 1000, headersTimeout: 1000 }, (request, response) => {
    const allowed = request.method === 'GET' && request.url === '/api/v1/code/managed-config' &&
      request.headers['transfer-encoding'] === undefined &&
      (request.headers['content-length'] === undefined || request.headers['content-length'] === '0');
    response.writeHead(allowed ? 200 : 403, { 'Content-Type': 'application/json', Connection: 'close', 'Cache-Control': 'no-store' });
    response.end(allowed ? '{"state":"disabled"}' : '{}');
  });
  server.maxConnections = 4;
  server.timeout = 1000;
  server.on('clientError', (_error, socket) => { socket.destroy(); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Managed-config endpoint did not bind a loopback port.'); }
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve(); });
        server.closeAllConnections();
      });
      return closing;
    }
  };
}

export function configureManagedConfigEndpoint(plan: SessionConfigPlan, url: string): void {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(url) || Number(new URL(url).port) > 65535) {
    throw new TypeError('Managed-config endpoint must be an owned IPv4 loopback HTTP endpoint.');
  }
  plan.environment.VIBE_VIBE_BASE_URL = url;
  plan.expectation = { ...plan.expectation, settings: [...plan.expectation.settings, { path: ['vibe_base_url'], value: url, match: 'equal' }] };
}
