import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
const distRoot = process.env.VIBE_SUPERVISOR_TEST_DIST || path.join(root, 'dist');
const load = (file) => import(pathToFileURL(path.join(distRoot, file)).href);
const { getDataDir, loadConfig } = await load('config/config.js');
const { RunManager } = await load('core/run-manager.js');
const { spawnManaged } = await load('process/managed.js');
const { startMcpStdio } = await load('mcp/server.js');

class FakeProgrammaticBackend {
  kind = 'programmatic';

  async probe() { return { available: true, backend: this.kind }; }

  async start(input, callbacks) {
    const mode = process.env.FAKE_PROCESS_MODE === 'hold' ? 'hold' : 'exit';
    const pidFile = path.join(input.runDirectory, 'fake-worker.pid');
    const script = mode === 'hold'
      ? "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);"
      : "require('fs').writeFileSync(process.argv[1], String(process.pid));";
    const worker = spawnManaged(process.execPath, ['-e', script, pidFile], { cwd: input.workerWorkspace, stdio: 'ignore' });
    const handle = { runId: input.runId, backend: this.kind, opaque: { worker, callbacks } };
    callbacks.onSpawn?.(handle);
    if (mode === 'exit') {
      void worker.done.then(() => callbacks.onState('completed', { result: { stopReason: 'end_turn', summary: 'Fake one-shot run completed.' } }));
    }
    return { handle, initialState: 'running', process: { pid: worker.child.pid, executable: process.execPath } };
  }

  async cancel(handle) { await handle.opaque.worker.terminate(); }
  async close() {}
  async terminateNow(handle) { await handle.opaque.worker.terminate(); }
}

const config = await loadConfig({ createDataDir: true });
const manager = new RunManager(config, getDataDir(), [new FakeProgrammaticBackend()]);
await manager.initialize();
const handle = startMcpStdio(manager, { config, onError: (message) => process.stderr.write(`${message}\n`) });
manager.startAutomaticRetention();

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await handle.close().catch(() => {});
  await manager.shutdown().catch((error) => process.stderr.write(`Shutdown failed: ${String(error?.message)}\n`));
  process.exit(0);
};
process.stdin.once('end', () => { void close(); });
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
