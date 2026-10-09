// Offline findings reproduction only. Fake backends; disposable Git fixtures; no provider calls.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const dist = path.resolve(process.argv[2]);
const load = name => import(pathToFileURL(path.join(dist, name)).href);
const { RunManager } = await load('core/run-manager.js');
const { DEFAULT_CONFIG } = await load('config/defaults.js');
const { validateConfig } = await load('config/validation.js');
const exec = promisify(execFile);
const root = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-lifecycle-reproduce-'));
const observations = { scope: 'offline fake-backend reproduction; not hosted acceptance', findings: {}, fixtures_retained: root };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const value = await read(); if (predicate(value)) return value; await pause(10); }
  throw new Error('Bounded fixture wait expired');
}
class Backend {
  kind = 'programmatic'; supportsContinue = true;
  callbacks = new Map(); responses = []; completeOnRespond = false;
  async start(input, callbacks) { this.callbacks.set(input.runId, callbacks); return { handle: { runId: input.runId, backend: this.kind, opaque: {} }, initialState: 'running' }; }
  async respond(handle, response) {
    this.responses.push(response.optionId);
    if (this.completeOnRespond) {
      await this.callbacks.get(handle.runId).onPendingRequest(undefined);
      await this.callbacks.get(handle.runId).onState('completed', { result: { summary: 'Fixture completed' } });
    }
  }
  async continue() {} async cancel() {} async close() {}
}
async function context(name, git = false) {
  const parent = path.join(root, name); const source = path.join(parent, 'source'); const data = path.join(parent, 'data');
  await mkdir(source, { recursive: true, mode: 0o700 });
  await writeFile(path.join(source, 'a.txt'), 'Public fixture\n');
  const gitCall = (...args) => exec('git', ['-C', source, ...args]);
  if (git) {
    await gitCall('-c', 'init.templateDir=', 'init', '--quiet'); await gitCall('add', '--', 'a.txt');
    await gitCall('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Public baseline');
  }
  const backend = new Backend();
  const config = { ...DEFAULT_CONFIG, allowedWorkspaceRoots: [source], workerIdleTtlSeconds: 0, limits: { ...DEFAULT_CONFIG.limits, workerProgressTimeoutSeconds: 0 } };
  const manager = new RunManager(config, data, [backend]);
  return { parent, source, data, backend, config, manager, gitCall };
}
async function started(c, edit = false) {
  const result = await (edit ? c.manager.editStart({ cwd: c.source, task: 'Fixture only' }) : c.manager.reviewStart({ cwd: c.source, task: 'Fixture only' }));
  await until(() => c.manager.status({ run_id: result.run_id }), value => value.state === 'running');
  return result.run_id;
}
function pending(id, schema) { return { requestId: id, kind: 'elicitation', title: 'Public fixture', schema }; }

// F7: completion during response delivery must not be overwritten by the coordinator transition.
{
  const c = await context('F7');
  try {
    const id = await started(c); c.backend.completeOnRespond = true;
    await c.backend.callbacks.get(id).onPendingRequest(pending('response', { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }));
    await c.manager.respond({ run_id: id, request_id: 'response', kind: 'elicitation', action: 'accept', content: { ok: true } });
    const status = await c.manager.status({ run_id: id });
    assert.equal(status.state, 'running');
    observations.findings.F7 = { reproduced: true, completedThenRevived: status.state, expected: 'completed' };
  } finally { await c.manager.shutdown(); }
}
// F8: names are untrusted; policy denial must use reject kinds, never label substrings.
{
  const c = await context('F8');
  try {
    const id = await started(c);
    await c.backend.callbacks.get(id).onPendingRequest({ requestId: 'unsafe', kind: 'permission', title: 'Fixture only',
      options: [{ optionId: 'allow', name: 'Allow once (never deny)', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject once', kind: 'reject_once' }],
      tool: { kind: 'execute', locations: [path.join(c.source, 'a.txt')], rawInput: { path: 'a.txt' } } });
    await until(async () => c.backend.responses, values => values.length > 0);
    assert.equal(c.backend.responses[0], 'allow');
    observations.findings.F8 = { reproduced: true, automaticallySelectedKind: 'allow_once', expected: 'reject_once', shellExecuted: false };
  } finally { await c.manager.shutdown(); }
}
// F9: adapter-admitted annotation/array forms cannot currently be accepted by manager validation.
{
  const c = await context('F9');
  try {
    const id = await started(c);
    await c.backend.callbacks.get(id).onPendingRequest(pending('annotated', { type: 'object', title: 'Public annotation', properties: { ok: { type: 'boolean' } }, required: ['ok'] }));
    let code;
    try { await c.manager.respond({ run_id: id, request_id: 'annotated', kind: 'elicitation', action: 'accept', content: { ok: true } }); } catch (error) { code = error.code; }
    assert.equal(code, 'VSUP_INVALID_ARGUMENT');
    observations.findings.F9 = { reproduced: true, annotatedFormResponse: code, state: (await c.manager.status({ run_id: id })).state, adapterAdmission: 'source inspection, not hosted' };
  } finally { await c.manager.shutdown(); }
}
{
  const config = validateConfig({ version: 1, allowed_workspace_roots: ['/', '~'] });
  observations.findings.F10 = { reproduced: true, broadRootsAcceptedByValidator: config.allowedWorkspaceRoots, globalConfigurationChanged: false };
}
// F11: hold the actual disposable Git worktree add after creation, then close before its receipt.
{
  const c = await context('F11', true); const originalPath = process.env.PATH;
  const realGit = (await exec('which', ['git'])).stdout.trim(); const bin = path.join(c.parent, 'bin'); await mkdir(bin);
  const marker = path.join(c.parent, 'worktree-created'); const release = path.join(c.parent, 'release');
  await writeFile(path.join(bin, 'git'), `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');const fs=require('node:fs');const args=process.argv.slice(2);const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});if(r.status===0&&args.includes('worktree')&&args.includes('add')){fs.writeFileSync(${JSON.stringify(marker)},'ready');const end=Date.now()+4000;while(!fs.existsSync(${JSON.stringify(release)})&&Date.now()<end)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}process.exit(r.status??1);\n`, { mode: 0o700 });
  try {
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
    const start = await c.manager.editStart({ cwd: c.source, task: 'Fixture only' });
    await until(async () => access(marker).then(() => true, () => false), Boolean);
    const closed = await c.manager.close({ run_id: start.run_id, cleanup_worktree: true });
    await writeFile(release, 'continue');
    const metaFile = path.join(c.data, 'runs', start.run_id, 'meta.json');
    const meta = await until(async () => JSON.parse(await readFile(metaFile, 'utf8')), value => value.worktree !== undefined);
    assert.equal(meta.state, 'closed'); assert.equal(closed.worktree_removed, false); assert.equal(closed.worktree_retained_reason, undefined);
    observations.findings.F11 = { reproduced: true, firstCloseState: closed.state, firstCloseHadRetentionReason: false, lateWorktreeRecorded: true };
    const cleanup = await c.manager.close({ run_id: start.run_id, cleanup_worktree: true });
    assert.equal(cleanup.worktree_removed, true); observations.findings.F11.supportedSecondCloseRemoved = true;
  } finally { process.env.PATH = originalPath; await writeFile(release, 'continue'); await c.manager.shutdown(); }
}
// F15: rewrite ONLY fixture A's saved path to fixture B; same Git root and identical export.
{
  const c = await context('F15', true); const first = await started(c, true); const second = await started(c, true);
  await c.backend.callbacks.get(first).onState('completed', { result: { summary: 'Fixture complete' } });
  await c.backend.callbacks.get(second).onState('completed', { result: { summary: 'Fixture complete' } });
  await c.manager.shutdown();
  const metaFile = path.join(c.data, 'runs', first, 'meta.json'); const original = JSON.parse(await readFile(metaFile, 'utf8'));
  const other = JSON.parse(await readFile(path.join(c.data, 'runs', second, 'meta.json'), 'utf8'));
  const tampered = { ...original, worker_workspace: other.worker_workspace, worktree: other.worktree };
  await writeFile(metaFile, JSON.stringify(tampered), { mode: 0o600 });
  const reloaded = new RunManager(c.config, c.data, [new Backend()]);
  try {
    await reloaded.initialize(); const closed = await reloaded.close({ run_id: first, cleanup_worktree: true });
    assert.equal(closed.worktree_removed, true);
    observations.findings.F15 = { reproduced: true, differentRunWorktreeRemoved: true, scope: 'two supervisor-owned disposable fixture worktrees only' };
  } finally { await reloaded.shutdown(); }
  // Restore fixture A's independently saved identity, then use supported verified cleanup.
  await writeFile(metaFile, JSON.stringify(original), { mode: 0o600 });
  const restored = new RunManager(c.config, c.data, [new Backend()]);
  try { await restored.initialize(); assert.equal((await restored.close({ run_id: first, cleanup_worktree: true })).worktree_removed, true); }
  finally { await restored.shutdown(); }
  observations.findings.F15.restoredIdentitySupportedCleanup = true;
}
await writeFile(path.join(root, 'observations.json'), JSON.stringify(observations, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(observations, null, 2));
