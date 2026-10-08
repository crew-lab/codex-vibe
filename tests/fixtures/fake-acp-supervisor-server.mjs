import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
const distRoot = process.env.VIBE_SUPERVISOR_DIST_DIR || process.env.VIBE_SUPERVISOR_TEST_DIST || path.join(root, 'dist');
const load = (file) => import(pathToFileURL(path.join(distRoot, file)).href);
const { getDataDir, loadConfig } = await load('config/config.js');
const { RunManager } = await load('core/run-manager.js');
const { AcpBackend } = await load('backends/acp.js');
const { startMcpStdio } = await load('mcp/server.js');
const { installProcessGuards } = await load('diagnostics/background.js');

const fixture = path.join(root, 'tests', 'fixtures', 'fake-acp.mjs');

class FakeAcpBackend extends AcpBackend {
  executable() { return 'fake-acp'; }
  async buildLaunch(_args, profile) {
    return {
      command: process.execPath,
      args: [fixture],
      env: { ...profile.env, FAKE_ACP_CASE: process.env.FAKE_ACP_CASE ?? 'normal', ...(process.env.FAKE_ACP_MODE ? { FAKE_ACP_MODE: process.env.FAKE_ACP_MODE } : {}), ...(process.env.FAKE_PID_DIR ? { FAKE_PID_DIR: process.env.FAKE_PID_DIR } : {}) },
    };
  }
  async probe() {
    return { available: true, backend: 'acp', executable: 'fake-acp', version: '2.25.8', supportsContinue: true, supportsPermissionResponse: true };
  }
}

const config = await loadConfig({ createDataDir: true });
const dataDir = config.paths?.dataDir ?? getDataDir();
const manager = new RunManager(config, dataDir, [new FakeAcpBackend({ ...config, backend: 'acp' }, dataDir)]);
await manager.initialize();
const handle = startMcpStdio(manager, { config, onError: (message) => process.stderr.write(`${message}\n`) });
manager.startAutomaticRetention();

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await handle.close().catch(() => {});
  await manager.shutdown().catch((error) => process.stderr.write(`Shutdown failed: ${String(error?.message)}\n`));
};
installProcessGuards({ shutdown: close });
process.stdin.once('end', () => { void close(); });
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
