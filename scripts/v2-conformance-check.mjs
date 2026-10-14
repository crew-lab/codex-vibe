#!/usr/bin/env node

import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(SCRIPT_DIRECTORY, '..');
const USAGE = 'Usage: node scripts/v2-conformance-check.mjs --manifest <path> [--executable <path>] [--config <path>] [--dist <dir>] [--output <path>] [--mode review|edit] [--placeholder-key] [--observe-network] [--settle-ms <n>] [--pin-runs <n>] [--request-timeout-ms <n>] [--run-timeout-ms <n>]';
const VALUE_OPTIONS = ['--manifest', '--executable', '--config', '--dist', '--output', '--mode', '--settle-ms', '--pin-runs', '--request-timeout-ms', '--run-timeout-ms'];
const FLAG_OPTIONS = ['--placeholder-key', '--observe-network'];
const PLACEHOLDER_KEY = 'vsup-conformance-placeholder-not-a-credential';
const MAX_TURNS = 20;
const EXIT_WAIT_MS = 5000;
const GROUP_WAIT_MS = 2000;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_INBOUND_BYTES = 64 * 1024 * 1024;
const STDERR_KEEP_BYTES = 4096;
const MAX_FINDINGS_PER_KIND = 60;
const MAX_VALUE_CHARS = 160;
const MAX_NAMES = 50;
const MAX_PROXY_ATTEMPTS = 100;
const NO_PROXY_VALUE = '127.0.0.1,localhost,::1';
const PROXY_VARIABLES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];
const PATH_LEAK = /(?<![\w<])\/(?:Users|home|private|var|tmp|opt|usr|Library|Applications|Volumes|nix)\/[^\s"'`),;]*/g;

class UsageError extends Error {}

class StageError extends Error {
  constructor(stage, cause) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.stage = stage;
    this.cause = cause;
  }
}

function parseArguments(args) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (FLAG_OPTIONS.includes(key)) {
      if (flags.has(key)) throw new UsageError(`${key} may be supplied once.`);
      flags.add(key);
    } else if (VALUE_OPTIONS.includes(key)) {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${key} requires a value.`);
      if (values.has(key)) throw new UsageError(`${key} may be supplied once.`);
      values.set(key, value);
    } else throw new UsageError(`Unknown argument: ${String(key)}.`);
  }
  const integer = (key, fallback, min, max) => {
    if (!values.has(key)) return fallback;
    const parsed = Number(values.get(key));
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new UsageError(`${key} must be an integer from ${min} to ${max}.`);
    return parsed;
  };
  const mode = values.get('--mode');
  if (mode !== undefined && mode !== 'review' && mode !== 'edit') throw new UsageError('--mode must be review or edit.');
  const absolute = (key) => {
    const value = values.get(key);
    if (value !== undefined && !path.isAbsolute(value)) throw new UsageError(`${key} must be an absolute path.`);
    return value;
  };
  return {
    manifest: absolute('--manifest'),
    executable: values.get('--executable'),
    config: absolute('--config'),
    dist: absolute('--dist') ?? path.join(REPOSITORY, 'dist'),
    output: absolute('--output'),
    modes: mode === undefined ? ['review', 'edit'] : [mode],
    placeholderKey: flags.has('--placeholder-key'),
    observeNetwork: flags.has('--observe-network'),
    settleMs: integer('--settle-ms', flags.has('--observe-network') ? 3000 : 0, 0, 60_000),
    pinRuns: integer('--pin-runs', 3, 1, 10),
    requestTimeoutMs: integer('--request-timeout-ms', 60_000, 1000, 600_000),
    runTimeoutMs: integer('--run-timeout-ms', 240_000, 10_000, 1_800_000)
  };
}

async function loadDist(dist) {
  const load = (relative) => import(pathToFileURL(path.join(dist, relative)).href);
  try {
    const [pin, protocol, readback, sessionConfig, jsonrpc, managed, reaper, environment, redaction, failure, supported, appServer] = await Promise.all([
      load('backends/app-server/pin.js'),
      load('backends/app-server/protocol.js'),
      load('backends/app-server/readback.js'),
      load('backends/app-server/session-config.js'),
      load('backends/app-server/jsonrpc.js'),
      load('process/managed.js'),
      load('process/reaper.js'),
      load('security/environment.js'),
      load('security/redaction.js'),
      load('backends/app-server/failure.js'),
      load('backends/app-server/supported-vibe.js'),
      load('backends/app-server.js')
    ]);
    const version = await load('version.js').then((module) => module.APP_VERSION, () => null);
    return { pin, protocol, readback, sessionConfig, jsonrpc, managed, reaper, environment, redaction, failure, supported, appServer, version };
  } catch (error) {
    throw new UsageError(`The built supervisor modules could not be loaded from ${dist}: ${error instanceof Error ? error.message : String(error)}. Run npm run build first or pass --dist <dir>.`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueAt(root, segments) {
  let cursor = root;
  for (const segment of segments) {
    if (!isRecord(cursor) || !Object.hasOwn(cursor, segment)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function bounded(value) {
  if (value === undefined) return 'missing';
  let text;
  try { text = JSON.stringify(value) ?? String(value); } catch { text = String(value); }
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}...` : text;
}

function makeRedactor(dist, pairs, secrets) {
  const ordered = pairs.filter(([from]) => typeof from === 'string' && from.length > 1).sort((left, right) => right[0].length - left[0].length);
  const text = (input) => {
    let output = input;
    for (const [from, to] of ordered) output = output.split(from).join(to);
    output = dist.redaction.redactSecrets(output, secrets);
    return output.replace(PATH_LEAK, '<path>');
  };
  const walk = (value) => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(walk);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  return { text, walk };
}

async function startRefusingProxy() {
  const attempts = [];
  const sockets = new Set();
  const current = { run: 'unassigned' };
  const hostOf = (raw) => {
    const host = String(raw).toLowerCase();
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host : 'invalid-host';
  };
  const describe = (line) => {
    const parts = line.split(/\s+/);
    const method = (parts[0] ?? '').slice(0, 16).toUpperCase();
    const target = parts[1] ?? '';
    if (method === 'CONNECT') {
      const match = /^(.*):(\d{1,5})$/.exec(target);
      return { method, host: hostOf(match ? match[1] : target), port: match ? Number(match[2]) : null };
    }
    try {
      const url = new URL(target);
      return { method, host: hostOf(url.hostname), port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80 };
    } catch { return { method, host: 'unparsed', port: null }; }
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffered = '';
    let answered = false;
    socket.on('data', (chunk) => {
      if (answered) return;
      buffered += chunk.toString('latin1');
      const newline = buffered.indexOf('\n');
      if (newline < 0 && buffered.length < 4096) return;
      answered = true;
      if (attempts.length < MAX_PROXY_ATTEMPTS) attempts.push({ run: current.run, ...describe(buffered.slice(0, newline < 0 ? 4096 : newline).trim()) });
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  return {
    port: server.address().port,
    attempts,
    current,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  };
}

async function listNames(directory) {
  try { return (await readdir(directory)).sort().slice(0, MAX_NAMES); } catch { return null; }
}

async function exists(target) {
  try { await lstat(target); return true; } catch (error) { return error?.code !== 'ENOENT'; }
}

function groupPresent(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

async function waitGroupGone(pid, limitMs) {
  const started = performance.now();
  while (performance.now() - started < limitMs) {
    if (!groupPresent(pid)) return true;
    await sleep(50);
  }
  return !groupPresent(pid);
}

function idle(ms) {
  return sleep(ms, undefined, { ref: false });
}

function withinMs(promise, ms) {
  return Promise.race([promise.then(() => true, () => true), idle(ms).then(() => false)]);
}

async function main(argv) {
  const options = parseArguments(argv);
  const startedAt = new Date();
  const dist = await loadDist(options.dist);
  const { pin, protocol, readback, sessionConfig, jsonrpc, managed, reaper, environment, failure, supported, appServer } = dist;
  const pinned = supported.SUPPORTED_VIBE;

  let config = { paths: {} };
  if (options.config) {
    const loaded = await import(pathToFileURL(path.join(options.dist, 'config/config.js')).href).then((module) => module.loadResolvedConfig({ configPath: options.config }));
    config = loaded.config;
  }
  const manifestPath = options.manifest ?? config.paths?.vibePinManifest;
  if (!manifestPath) throw new UsageError('No manifest: pass --manifest <path> or set paths.vibe_pin_manifest in --config.');
  let executable;
  try { executable = await appServer.resolveAppServerExecutable(config, options.executable); }
  catch { throw new UsageError('The vibe-app-server executable could not be located; pass --executable <path>.'); }

  const scratchRoot = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-conformance-')));
  await chmod(scratchRoot, 0o700);
  const pairs = [[scratchRoot, '<check-scratch>'], [await realpath(os.tmpdir()), '<tmpdir>'], [os.homedir(), '<target-home>'], [REPOSITORY, '<supervisor-repository>'], [options.dist, '<supervisor-repository>/dist']];
  const secrets = [PLACEHOLDER_KEY, ...dist.redaction.environmentSecrets(process.env)];
  const findings = [];
  const report = {
    format: 1,
    tool: 'v2-conformance-check',
    supervisor_version: dist.version,
    pinned_vibe: pinned,
    started_at: startedAt.toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    inference: { turn_start_sent: false, note: 'The check never sends turn/start, so no model request is made by the supervisor or the app-server.' },
    credential_mode: options.placeholderKey ? 'placeholder' : 'none',
    options: { modes: options.modes, observe_network: options.observeNetwork, settle_ms: options.settleMs, pin_runs: options.pinRuns },
    pin: null,
    runs: [],
    network_observation: null,
    findings
  };
  const addFinding = (id, severity, message, run, details) => {
    if (findings.filter((item) => item.id === id).length >= MAX_FINDINGS_PER_KIND) return;
    findings.push({ id, severity, ...(run ? { run } : {}), message, ...(details ? { details } : {}) });
  };

  let proxy = null;
  try {
    report.pin = await runPinCheck();
    if (report.pin.ok) {
      if (options.observeNetwork) {
        try { proxy = await startRefusingProxy(); }
        catch (error) { addFinding('proxy-unavailable', 'fail', `The local refusing proxy could not start: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (!options.observeNetwork || proxy) {
        for (const mode of options.modes) report.runs.push(await runOne({ label: mode, mode, role: 'subject' }));
        if (proxy) report.runs.push(await runOne({ label: 'control-experiments-on', mode: 'review', role: 'control' }));
      }
      if (proxy) report.network_observation = summarizeNetwork(proxy.attempts);
    }
  } finally {
    if (proxy) await proxy.close().catch(() => undefined);
    await rm(scratchRoot, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
    if (await exists(scratchRoot)) addFinding('scratch-retained', 'warn', 'The check scratch directory could not be removed.');
  }

  async function runPinCheck() {
    const result = { ok: false, manifest: null, verify_runs_ms: [], environment: null, tamper_control: null };
    let manifest;
    try {
      manifest = await pin.loadPinManifest(manifestPath);
      result.manifest = { format: manifest.format, version: manifest.version, files: Object.keys(manifest.files).length, record_sha256: manifest.record_sha256 };
      if (manifest.version !== pinned) addFinding('manifest-version-mismatch', 'fail', `The manifest records Vibe ${manifest.version}; this candidate pins ${pinned}.`);
      for (let index = 0; index < options.pinRuns; index++) {
        const started = performance.now();
        const verified = await pin.verifyPinnedInstall({ executable, manifestPath });
        result.verify_runs_ms.push(Math.round(performance.now() - started));
        if (index === 0) {
          pairs.push([verified.environmentRoot, '<vibe-tool-env>']);
          result.environment = { version: verified.version, file_count: verified.fileCount, total_bytes: verified.totalBytes, record_sha256: verified.recordSha256 };
        }
      }
      result.ok = manifest.version === pinned;
    } catch (error) {
      if (error instanceof pin.PinCheckError) {
        result.failure = { reason: error.reason, code: error.code, message: error.message, details: error.details };
        addFinding('pin-check-failed', 'fail', `The pin check failed (${error.reason}); Vibe is not launched.`, undefined, { reason: error.reason });
      } else addFinding('pin-check-error', 'fail', `The pin check could not run: ${error instanceof Error ? error.message : String(error)}`);
      return result;
    }
    const first = Object.keys(manifest.files).sort()[0];
    if (first !== undefined) {
      const tampered = { ...manifest, files: { ...manifest.files, [first]: '0'.repeat(64) } };
      try {
        await pin.verifyPinnedInstall({ executable, manifest: tampered });
        result.tamper_control = { rejected: false };
        addFinding('tamper-control-accepted', 'fail', 'A manifest with one altered file hash was accepted against the installed files.');
      } catch (error) {
        const rejected = error instanceof pin.PinCheckError && error.reason === 'file-mismatch';
        result.tamper_control = { rejected, reason: error instanceof pin.PinCheckError ? error.reason : 'unexpected-error' };
        if (!rejected) addFinding('tamper-control-unexpected', 'fail', 'A manifest with one altered file hash was not rejected as file-mismatch.', undefined, result.tamper_control);
      }
    }
    return result;
  }

  async function runOne(spec) {
    const { label, mode, role } = spec;
    const control = role === 'control';
    const runRoot = path.join(scratchRoot, label);
    const runDirectory = path.join(runRoot, 'run');
    const workspace = path.join(runRoot, 'workspace');
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await writeFile(path.join(workspace, 'README.txt'), 'conformance check workspace\n');
    pairs.push([workspace, '<workspace>'], [runDirectory, '<run-directory>']);
    const record = {
      label, mode, role, purpose: control ? 'network-control' : 'conformance', spawned: false, stages: [], timings_ms: {}, handshake: null, session_start: null,
      readiness: null, readback: null, thinking: null, observed: null, notifications: { total: 0, by_method: {}, unknown_methods: [] },
      server_requests: [], server_warnings: [], stats_after: null, stderr: { bytes: 0, tail: '' }, shutdown: null, blocked: null
    };
    const note = (id, severity, message, details) => addFinding(id, severity, message, label, details);
    const plan = sessionConfig.buildSessionConfig({ mode, workspace, runDirectory, maxTurns: MAX_TURNS });
    await sessionConfig.writeSessionFiles(plan);
    const childEnvironment = { ...environment.buildChildEnvironment(process.env), ...plan.environment };
    delete childEnvironment.MISTRAL_API_KEY;
    if (options.placeholderKey) childEnvironment.MISTRAL_API_KEY = PLACEHOLDER_KEY;
    if (control) childEnvironment.VIBE_EXPERIMENTS__ENABLE = 'true';
    if (proxy) {
      proxy.current.run = label;
      for (const name of PROXY_VARIABLES) childEnvironment[name] = `http://127.0.0.1:${proxy.port}`;
      childEnvironment.NO_PROXY = NO_PROXY_VALUE;
      childEnvironment.no_proxy = NO_PROXY_VALUE;
    }
    record.child_environment_names = Object.keys(childEnvironment).sort();

    let child;
    let rpcClient;
    let reaperHandle;
    let stderrTail = '';
    let unexpectedEnd = null;
    const unknownEntryKinds = new Set();
    const timer = { clock: performance.now() };
    const lap = (name) => { record.timings_ms[name] = Math.round(performance.now() - timer.clock); timer.clock = performance.now(); };
    let deadlineTimer;
    try {
      const stage = async (name, action) => {
        record.stages.push(name);
        try { return await action(); } catch (error) { throw new StageError(name, error); }
      };
      const call = async (spec2, parse) => {
        if (spec2.method === 'turn/start') throw new Error('turn/start is refused by the conformance check');
        const raw = await rpcClient.request(spec2.method, spec2.params, { timeoutMs: options.requestTimeoutMs });
        try { return { raw, value: parse(raw) }; }
        catch (error) {
          if (error instanceof protocol.ProtocolParseError) error.rawKeys = isRecord(raw) ? Object.keys(raw).slice(0, 30) : typeof raw;
          throw error;
        }
      };

      await stage('spawn', async () => {
        child = managed.spawnManaged(executable, [], {
          cwd: runDirectory,
          env: childEnvironment,
          forwardEnv: Object.keys(childEnvironment),
          stdio: ['pipe', 'pipe', 'pipe'],
          maxStdoutBytes: MAX_INBOUND_BYTES + 1024 * 1024,
          maxStderrBytes: 1024 * 1024,
          onStderr: (chunk) => { record.stderr.bytes += Buffer.byteLength(chunk); stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_KEEP_BYTES); },
          onLimit: (stream) => { unexpectedEnd = `${stream} budget exceeded`; }
        });
        child.done.then((exit) => { if (!record.shutdown) unexpectedEnd = `the app-server exited with ${exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? 'null'}`}`; }, () => undefined);
        await new Promise((resolve, reject) => {
          if (child.child.pid !== undefined) { resolve(undefined); return; }
          child.child.once('spawn', () => resolve(undefined));
          child.child.once('error', reject);
        });
        record.spawned = true;
        reaperHandle = await reaper.startReaper({ workerPid: child.child.pid, deadlineAtMs: Math.ceil(Date.now() + options.runTimeoutMs + 15_000) });
        deadlineTimer = setTimeout(() => { unexpectedEnd = 'the run deadline passed'; void child.terminate(0).catch(() => undefined); }, options.runTimeoutMs);
        deadlineTimer.unref();
        rpcClient = new jsonrpc.JsonRpcClient({
          input: child.child.stdout,
          output: child.child.stdin,
          maxLineBytes: MAX_LINE_BYTES,
          maxInboundBytes: MAX_INBOUND_BYTES,
          defaultTimeoutMs: options.requestTimeoutMs,
          onDiagnostic: (message) => { if (record.server_warnings.length < 20) record.server_warnings.push({ source: 'client-diagnostic', message: message.slice(0, 300) }); },
          onFatal: (error) => { unexpectedEnd = `transport failure (${error.code})`; },
          onEnd: (info) => { if (info.reason === 'eof' && !record.shutdown) unexpectedEnd = 'the app-server closed its output stream'; }
        });
        rpcClient.setRequestHandler('callback/call', (params) => {
          record.server_requests.push({ method: 'callback/call', keys: Object.keys(params).slice(0, 10) });
          throw new Error('The conformance check sends no turn and answers no callback.');
        });
        rpcClient.setNotificationHandler((method, params) => {
          record.notifications.total += 1;
          record.notifications.by_method[method] = (record.notifications.by_method[method] ?? 0) + 1;
          let parsed;
          try { parsed = protocol.parseNotification(method, params); }
          catch (error) { note('notification-parse-failed', 'warn', `A ${method} notification did not parse: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`); return; }
          if (parsed.kind === 'unknown' && !record.notifications.unknown_methods.includes(method) && record.notifications.unknown_methods.length < 20) record.notifications.unknown_methods.push(method.slice(0, 80));
          if (parsed.kind === 'history/entryAdded' && parsed.entry.kind === 'unknown') unknownEntryKinds.add(String(parsed.entry.type).slice(0, 64));
          if ((parsed.kind === 'warning' || parsed.kind === 'error') && record.server_warnings.length < 20) record.server_warnings.push({ source: method, code: parsed.code, message: (parsed.message ?? '').slice(0, 300) });
        });
        lap('spawn');
      });

      const init = await stage('initialize', async () => (await call(protocol.buildInitialize({ name: 'vibe-supervisor-conformance', version: dist.version ?? '0.0.0' }), protocol.parseInitializeResult)).value);
      lap('initialize');
      record.handshake = { server_name: init.serverName, server_version: init.serverVersion, version_ok: init.serverVersion === pinned, process_id_matches_spawned: init.processId === null ? null : init.processId === child.child.pid };
      if (init.serverVersion !== pinned) {
        note('server-version-mismatch', 'fail', `serverInfo.version is ${init.serverVersion}; this candidate pins ${pinned}.`);
        throw new StageError('initialize', new Error('server version mismatch'));
      }
      if (init.processId !== null && init.processId !== child.child.pid) note('process-id-differs', 'info', 'The server reports a processId different from the spawned process (a wrapper or re-exec is in between).');
      const initialized = protocol.buildInitialized();
      rpcClient.notify(initialized.method, initialized.params);

      const started = await stage('session/start', async () => (await call(protocol.buildSessionStart(plan.agentConfig), protocol.parseSessionStartResult)).value);
      lap('session_start');
      const sessionId = started.state.session.id;
      for (const entry of started.state.history) if (entry.kind === 'unknown') unknownEntryKinds.add(String(entry.type).slice(0, 64));
      record.session_start = {
        harness: started.state.session.harness, cwd_ok: started.state.session.cwd !== null && path.resolve(started.state.session.cwd) === path.resolve(workspace),
        history_entries: started.state.history.length, event_id: started.state.eventId, model: started.state.session.model, reasoning_effort: started.state.session.reasoningEffort
      };

      const ready = await stage('session/ready/wait', async () => (await call(protocol.buildSessionReadyWait(sessionId), protocol.parseSessionReadyWaitResult)).value).catch((error) => {
        if (control) { note('control-ready-wait-failed', 'info', `The control run did not become ready: ${error.message}`); return { ready: false }; }
        throw error;
      });
      lap('ready_wait');
      record.readiness = { ready: ready.ready };
      if (!ready.ready && !control) {
        note('session-not-ready', 'fail', 'session/ready/wait returned ready: false.');
        throw new StageError('session/ready/wait', new Error('not ready'));
      }

      if (!control) {
        const firstRuntime = await stage('runtime/read', async () => call(protocol.buildRuntimeRead(sessionId), protocol.parseRuntimeReadResult));
        const firstEffective = await stage('config/effective/read', async () => call(protocol.buildConfigEffectiveRead(sessionId), protocol.parseConfigEffectiveReadResult));
        const configRead = await stage('config/read', async () => call(protocol.buildConfigRead(sessionId), protocol.parseConfigReadResult));
        lap('readback_before_thinking');
        const before = readback.compareReadback(plan.expectation, { sessionStart: started, runtime: firstRuntime.value, effective: firstEffective.value }, { checkThinking: false });
        if ((configRead.value.hooksCount ?? 0) !== 0) before.push({ path: 'config/read.hooksCount', expected: 0, actual: configRead.value.hooksCount });
        if ((configRead.value.skillsCount ?? 0) !== 0) before.push({ path: 'config/read.skillsCount', expected: 0, actual: configRead.value.skillsCount });

        const write = await stage('config/model/write', async () => call(sessionConfig.buildThinkingOffWrite(sessionId), protocol.parseConfigModelWriteResult));
        lap('thinking_write');
        const secondRuntime = await stage('runtime/read', async () => call(protocol.buildRuntimeRead(sessionId), protocol.parseRuntimeReadResult));
        const secondEffective = await stage('config/effective/read', async () => call(protocol.buildConfigEffectiveRead(sessionId), protocol.parseConfigEffectiveReadResult));
        lap('readback_after_thinking');
        const after = readback.compareReadback(plan.expectation, { sessionStart: started, runtime: secondRuntime.value, effective: secondEffective.value }, { checkThinking: true });

        const format = (list) => list.map((item) => ({ path: item.path, expected: bounded(item.expected), actual: bounded(item.actual) }));
        record.readback = { before_thinking: { mismatches: format(before), total: before.length }, after_thinking: { mismatches: format(after), total: after.length } };
        const reported = new Set();
        for (const item of [...before, ...after]) {
          if (reported.has(item.path)) continue;
          reported.add(item.path);
          note('readback-mismatch', 'fail', `${item.path}: expected ${bounded(item.expected)}, got ${bounded(item.actual)}`, { path: item.path });
        }

        const effectiveConfig = secondEffective.value.config;
        const profileTools = plan.expectation.tools;
        const policies = Object.fromEntries(profileTools.map((tool) => {
          const entry = valueAt(effectiveConfig, ['tools', tool]);
          const policy = plan.expectation.toolPolicies[tool];
          return [tool, {
            permission: isRecord(entry) && typeof entry.permission === 'string' ? entry.permission : null,
            denylist_entries: isRecord(entry) && Array.isArray(entry.denylist) ? entry.denylist.length : null,
            denylist_matches_expected: isRecord(entry) && JSON.stringify(entry.denylist) === JSON.stringify([...policy.denylist])
          }];
        }));
        const alias = secondRuntime.value.runtime.activeModel?.alias ?? null;
        const activeRaw = valueAt(secondRuntime.raw, ['runtime', 'config', 'activeModel']);
        record.thinking = {
          write_status: write.value.status,
          before: firstRuntime.value.runtime.activeModel?.thinking ?? null,
          after: secondRuntime.value.runtime.activeModel?.thinking ?? null,
          alias,
          effective_models_thinking: alias === null ? null : valueAt(effectiveConfig, ['models', alias, 'thinking']) ?? null,
          levels: isRecord(activeRaw) && Array.isArray(activeRaw.thinkingLevels) ? activeRaw.thinkingLevels.slice(0, 10) : null
        };
        record.observed = {
          runtime_tools: secondRuntime.value.runtime.tools.map((tool) => tool.name).sort(),
          tool_policies: policies,
          permission_ask_visible: profileTools.every((tool) => policies[tool].permission === 'ask'),
          settings: Object.fromEntries(plan.expectation.settings.map((setting) => {
            const actual = valueAt(effectiveConfig, setting.path);
            return [setting.path.join('.'), { expected: setting.value, actual: actual === undefined ? 'missing' : actual }];
          })),
          effective_top_level_keys: Object.keys(effectiveConfig).sort(),
          effective_tool_keys: isRecord(effectiveConfig.tools) ? Object.keys(effectiveConfig.tools).sort() : null,
          harness: started.state.session.harness,
          harness_selection_source: configRead.value.harnessSelectionSource,
          experimental_harness: valueAt(secondRuntime.raw, ['runtime', 'experimentalHarness']) ?? null,
          runtime_ready_flag: secondRuntime.value.ready,
          skills: secondRuntime.value.runtime.skills.length,
          hooks: secondRuntime.value.runtime.hooksCount,
          mcp_sources: isRecord(secondRuntime.value.runtime.mcp) && Array.isArray(secondRuntime.value.runtime.mcp.sources) ? secondRuntime.value.runtime.mcp.sources.length : null,
          connectors: secondRuntime.value.runtime.connectors,
          bypass_tool_permissions: secondRuntime.value.runtime.bypassToolPermissions
        };
        const stats = secondRuntime.value.runtime.stats;
        record.stats_after = { model_calls: stats.modelCalls, prompt_tokens: stats.promptTokens, completion_tokens: stats.completionTokens };
        if ((stats.modelCalls ?? 0) !== 0 || stats.promptTokens !== 0 || stats.completionTokens !== 0) note('unexpected-usage', 'fail', 'The session reports model calls or tokens although no turn was started.', record.stats_after);
        if (options.settleMs > 0) await sleep(options.settleMs);
      } else if (options.settleMs > 0) await sleep(options.settleMs);
      if (unexpectedEnd) note('server-ended-early', 'fail', `The app-server ended before the check finished: ${unexpectedEnd}.`);
    } catch (error) {
      const stageName = error instanceof StageError ? error.stage : 'unknown';
      const cause = error instanceof StageError ? error.cause : error;
      const tail = stderrTail.split('\n').filter((line) => line.trim()).slice(-5).join('\n');
      let handled = false;
      if (cause instanceof jsonrpc.JsonRpcServerError && cause.code === 'unauthorized') {
        record.blocked = { kind: 'credential', stage: stageName, detail: 'The server answered unauthorized.' };
        handled = true;
      } else if ((cause instanceof jsonrpc.JsonRpcClosedError || cause instanceof jsonrpc.JsonRpcFatalError || (cause instanceof Error && stageName === 'spawn')) && failure.authFailureText(tail)) {
        record.blocked = { kind: 'credential', stage: stageName, detail: 'The server stopped with an authentication message on standard error.' };
        handled = true;
      }
      if (handled && !control) note('credential-required-at-startup', 'info', `The server requires a credential before ${stageName}. The check does not read the Keychain or any environment key. Re-run with --placeholder-key if the server only needs a key to be present.`, { stage: stageName, credential_mode: report.credential_mode });
      else if (!handled) {
        const details = { stage: stageName };
        let message = cause instanceof Error ? cause.message : String(cause);
        if (cause instanceof jsonrpc.JsonRpcServerError) Object.assign(details, { method: cause.method, server_error_code: cause.code, issues: protocol.serverErrorIssues(cause.data).slice(0, 10) });
        else if (cause instanceof jsonrpc.JsonRpcTimeoutError) Object.assign(details, { method: cause.method, timeout_ms: cause.timeoutMs });
        else if (cause instanceof protocol.ProtocolParseError) Object.assign(details, { context: cause.context, issues: cause.issues.slice(0, 10), raw_keys: cause.rawKeys ?? null });
        if (tail) details.stderr_tail = tail.slice(-400);
        if (unexpectedEnd) details.ended = unexpectedEnd;
        if (message.length > 300) message = `${message.slice(0, 300)}...`;
        note(control ? 'control-run-failed' : 'run-failed', control ? 'warn' : 'fail', `${stageName}: ${message}`, details);
      }
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      record.shutdown = await shutdownRun();
    }
    record.stderr.tail = stderrTail.split('\n').filter((line) => line.trim()).slice(-5).join('\n').slice(-400);
    if (record.stderr.bytes > 0 && !record.blocked) note('server-stderr-output', 'info', 'The server wrote to standard error; the redacted tail is in the run record.', { bytes: record.stderr.bytes });
    if (unknownEntryKinds.size > 0) {
      record.unknown_entry_kinds = [...unknownEntryKinds].sort();
      note('unknown-entry-kinds', 'warn', `History entries of unknown kind were seen: ${record.unknown_entry_kinds.join(', ')}.`, { kinds: record.unknown_entry_kinds });
    }
    if (record.notifications.unknown_methods.length > 0) note('unknown-notification-methods', 'info', `Unknown notification methods were seen: ${record.notifications.unknown_methods.join(', ')}.`);
    if (record.server_requests.length > 0) note('unexpected-server-request', 'fail', 'The server sent a request although no turn was started.', { requests: record.server_requests });
    return record;

    async function shutdownRun() {
      const result = {
        stdin_closed: false, exited_on_eof: null, exit: null, exit_ms: null, forced: false, group_gone: null, termination_verified: null,
        reaper: null, tmp_entries_at_close: null, tmp_entries_after_exit: null, tmp_left_by_server: [], vibe_home_entries: null, child_home_entries: null,
        private_directories_removed: null, remaining: []
      };
      if (!child) return result;
      const pid = child.child.pid;
      result.tmp_entries_at_close = await listNames(plan.directories.tmp);
      if (rpcClient) result.stdin_closed = await withinMs(rpcClient.closeInput(), 1000);
      else { try { child.child.stdin?.end(); result.stdin_closed = true; } catch { result.stdin_closed = false; } }
      const closedAt = performance.now();
      const exit = await Promise.race([child.done.then((value) => value, () => null), idle(EXIT_WAIT_MS).then(() => undefined)]);
      result.exited_on_eof = exit !== undefined;
      result.exit_ms = Math.round(performance.now() - closedAt);
      result.exit = exit ? { code: exit.code, signal: exit.signal } : null;
      if (exit === undefined) {
        result.forced = true;
        addFinding('server-ignored-stdin-eof', 'fail', `The app-server did not exit within ${EXIT_WAIT_MS} ms of standard input closing; the process group was terminated.`, label);
        await child.terminate(0).catch(() => undefined);
      }
      if (pid !== undefined) {
        result.group_gone = await waitGroupGone(pid, GROUP_WAIT_MS);
        if (!result.group_gone) {
          result.forced = true;
          addFinding('process-group-survived', 'fail', 'Processes of the app-server group were still present after it exited; the group was terminated.', label);
          await child.terminate(0).catch(() => undefined);
          result.group_gone = await waitGroupGone(pid, GROUP_WAIT_MS);
        }
      }
      result.termination_verified = child.terminationVerified === true || result.group_gone === true;
      if (reaperHandle) {
        const outcome = await reaperHandle.stop().catch(() => null);
        result.reaper = outcome ? { reason: outcome.reason, killed: outcome.killed, verified: outcome.verified } : null;
        if (outcome && (outcome.reason === 'deadline' || outcome.reason === 'supervisor-gone' || outcome.killed)) addFinding('reaper-fired', 'fail', `The process reaper acted (${outcome.reason}).`, label);
        if (!outcome || outcome.reason === 'crashed') addFinding('reaper-crashed', 'warn', 'The process reaper did not report an outcome.', label);
      }
      rpcClient?.dispose();
      result.tmp_entries_after_exit = await listNames(plan.directories.tmp);
      const atClose = new Set(result.tmp_entries_at_close ?? []);
      result.tmp_left_by_server = (result.tmp_entries_after_exit ?? []).filter((name) => atClose.has(name));
      result.vibe_home_entries = await listNames(plan.directories.vibeHome);
      result.child_home_entries = await listNames(plan.directories.home);
      const residue = result.tmp_left_by_server;
      if (residue.length > 0) addFinding('server-left-state-in-tmp', 'warn', 'Entries the server created under its private temporary directory were still there after it exited on standard input EOF.', label, { entries: residue });
      await Promise.allSettled([plan.directories.home, plan.directories.vibeHome, plan.directories.tmp].map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 2 })));
      for (const directory of [plan.directories.home, plan.directories.vibeHome, plan.directories.tmp]) if (await exists(directory)) result.remaining.push(path.basename(directory));
      result.private_directories_removed = result.remaining.length === 0;
      if (!result.private_directories_removed) addFinding('private-directories-retained', 'fail', 'Private Vibe directories could not be removed.', label, { remaining: result.remaining });
      return result;
    }
  }

  function summarizeNetwork(attempts) {
    const subject = attempts.filter((item) => item.run !== 'control-experiments-on');
    const controlAttempts = attempts.filter((item) => item.run === 'control-experiments-on');
    const controlHosts = new Set(controlAttempts.map((item) => item.host));
    const summary = {
      method: 'local-refusing-proxy',
      description: 'The child gets HTTP(S)_PROXY and ALL_PROXY pointing at a local listener that records only the method, host and port of the first request line and answers 403. Nothing is forwarded. The control run starts the same server with experiments enabled to show that the method can see a request at all.',
      proxy_variables: PROXY_VARIABLES,
      no_proxy: NO_PROXY_VALUE,
      subject_attempts: subject,
      control_attempts: controlAttempts,
      control_hosts: [...controlHosts].sort(),
      verdict: ''
    };
    if (subject.length > 0) {
      summary.verdict = 'requests-observed';
      for (const item of subject) {
        const matchesControl = controlHosts.has(item.host);
        addFinding('network-request-observed', matchesControl ? 'fail' : 'warn', `${item.run} attempted ${item.method} ${item.host}:${item.port ?? 'unknown'}${matchesControl ? ', a host the experiments-enabled control also contacted' : ''}.`, item.run, { host: item.host, port: item.port, matches_control: matchesControl });
      }
    } else if (controlAttempts.length > 0) summary.verdict = 'none-observed-control-validated';
    else {
      summary.verdict = 'inconclusive-control-saw-nothing';
      addFinding('network-method-inconclusive', 'warn', 'The experiments-enabled control made no request the proxy could see, so an empty result for the supervisor configuration proves nothing. Use an external observation (see the brief).');
    }
    return summary;
  }

  const blocked = report.runs.find((item) => item.blocked && item.role === 'subject');
  const failed = findings.some((item) => item.severity === 'fail');
  const subjectRuns = report.runs.filter((item) => item.role === 'subject');
  const complete = report.pin?.ok === true && subjectRuns.length === options.modes.length && subjectRuns.every((item) => item.observed !== null && item.shutdown !== null);
  report.result = failed ? 'fail' : blocked ? 'incomplete' : complete ? 'pass' : 'fail';
  if (!failed && !blocked && !complete) addFinding('check-incomplete', 'fail', 'The check did not complete every stage.');
  const profileTools = (run) => run.observed?.tool_policies ?? {};
  const askVisible = subjectRuns.length > 0 && subjectRuns.every((item) => item.observed?.permission_ask_visible === true);
  const askAbsent = subjectRuns.some((item) => item.observed !== null && Object.values(profileTools(item)).some((policy) => policy.permission !== 'ask'));
  const thinkingConfirmed = subjectRuns.length > 0 && subjectRuns.every((item) => item.thinking?.after === 'off' && item.thinking?.effective_models_thinking === 'off');
  const experimentsOff = subjectRuns.length > 0 && subjectRuns.every((item) => item.observed?.settings?.['experiments.enable']?.actual === false);
  report.gates = {
    'target-no-inference-conformance-check': report.result,
    'permission-ask-visible-in-effective-config': { config: askVisible ? 'visible' : askAbsent ? 'not-visible' : 'unknown', approval_handler_reached: 'needs-hosted-run' },
    'thinking-off-effect': { setting_read_back: thinkingConfirmed, levels: subjectRuns[0]?.thinking?.levels ?? null, effect: 'needs-hosted-run' },
    'experiments-fetch-off': { setting_read_back: experimentsOff, network: report.network_observation?.verdict ?? 'not-observed' },
    'nested-run-typescript-shape-and-gating': { check: 'needs-hosted-run' }
  };
  report.finished_at = new Date().toISOString();
  report.duration_ms = Date.now() - startedAt.getTime();
  const redactor = makeRedactor(dist, pairs, secrets);
  const safe = redactor.walk(report);
  const text = `${JSON.stringify(safe, null, 2)}\n`;
  if (options.output) {
    await writeFile(options.output, text, { flag: 'wx', mode: 0o600 }).catch((error) => {
      if (error?.code === 'EEXIST') throw new UsageError(`${options.output} already exists.`);
      throw error;
    });
    process.stdout.write(`${report.result.toUpperCase()} ${findings.filter((item) => item.severity === 'fail').length} failing findings, ${findings.filter((item) => item.severity === 'warn').length} warnings: ${redactor.text(options.output)}\n`);
  } else process.stdout.write(text);
  return report.result === 'pass' ? 0 : report.result === 'incomplete' ? 3 : 1;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n${USAGE}\n`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`v2-conformance-check failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
);
