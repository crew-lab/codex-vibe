import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { access, mkdtemp, rm, stat, lstat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateDir, expandHome, isPathWithinRoot } from '../security/paths.js';
import { configFingerprint, executableSearchPath, getDataDir } from '../config/config.js';
import { selectedVibeVersion } from '../backends/app-server/supported-vibe.js';
import { inspectOwnerLock } from '../core/owner-lock.js';
import type { BackendKind, SupervisorBackend, SupervisorConfig } from '../contracts.js';
import { APP_VERSION } from '../version.js';
import { nodeVersionAtLeast } from '../runtime/node-version.js';

export interface DoctorCheck { name: string; ok: boolean; status?: 'ok' | 'missing' | 'unverified'; version?: string; message: string; stderr_tail?: string }
export interface DoctorDependencies { backend?: SupervisorBackend }
export interface DoctorReport { ok: boolean; generatedAt: string; provenance: { backend: BackendKind; backend_experimental: boolean; antigravity_permission_layer?: 'enforced' | 'bypassed'; executable: string; application_entrypoint: string; runtime_module: string; app_version: string; vibe_version?: string; config_path: string; config_source: 'explicit' | 'environment' | 'default'; config_fingerprint: string; data_directory: string; storage_mode: 'selected-template' }; checks: DoctorCheck[] }

export function nodeRuntimeCheck(version: string): DoctorCheck {
  const ok = nodeVersionAtLeast(version, '20.19.0');
  return { name: 'node', ok, version, message: ok ? 'Supported Node.js runtime (20.19.0 or newer).' : 'Node.js 20.19.0 or newer is required.' };
}

function searchPath(name: string): string | undefined {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of executableSearchPath()) for (const extension of extensions) {
    const candidate = path.join(directory, `${name}${extension}`);
    try { requireAccess(candidate); return candidate; } catch { /* keep searching */ }
  }
  return undefined;
}

function findExecutable(name: string): { path?: string } {
  const found = searchPath(name);
  return found ? { path: found } : {};
}

function requireAccess(file: string): void {
  // Synchronous check keeps PATH scanning simple and does not execute the candidate.
  accessSync(file, fsConstants.X_OK);
}

const VERSION_PROBE_TIMEOUT_MS = 15_000;

async function probe(executable: string, args: string[], cwd: string, timeoutMs = VERSION_PROBE_TIMEOUT_MS): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: { PATH: process.env.PATH, HOME: cwd, VIBE_HOME: cwd, TMPDIR: cwd, LANG: 'C' }, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = []; let size = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('probe timed out')); }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8192) { child.kill('SIGKILL'); clearTimeout(timer); reject(new Error('probe output exceeded limit')); }
      else chunks.push(Buffer.from(chunk));
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('probe returned an error'));
      else resolve(Buffer.concat(chunks).toString('utf8').trim().split(/\r?\n/, 1)[0] ?? 'available');
    });
  });
}

export function formatDoctorCheck(check: DoctorCheck): string {
  return `${check.status === 'unverified' ? 'UNVERIFIED' : check.ok ? 'PASS' : 'CHECK'} ${check.name}: ${check.message}${check.version ? ` (${check.version})` : ''}${check.stderr_tail ? `\n  Diagnostic detail: ${check.stderr_tail}` : ''}`;
}

async function antigravityCheck(config: SupervisorConfig, injected: SupervisorBackend | undefined): Promise<DoctorCheck> {
  const backend = injected ?? new (await import('../backends/antigravity.js')).AntigravityBackend(config);
  const capabilities = await backend.probe();
  if (capabilities.available) {
    const sha256 = typeof capabilities.details?.sha256 === 'string' ? ` (sha256: ${capabilities.details.sha256})` : '';
    return {
      name: 'antigravity',
      ok: true,
      status: 'ok',
      ...(capabilities.version ? { version: capabilities.version } : {}),
      message: `Experimental backend: Antigravity CLI (agy) matches pinned version${sha256}; not for production until the target probes pass. agy permission layer: ${config.experimental?.antigravitySkipPermissions === true ? 'bypassed (antigravity_skip_permissions = true; the PreToolUse hook is the only tool gate)' : 'enforced'}.`
    };
  }
  const code = typeof capabilities.details?.code === 'string' ? ` [${capabilities.details.code}]` : '';
  return { name: 'antigravity', ok: false, ...(capabilities.version ? { version: capabilities.version } : {}), message: `Antigravity CLI (agy) could not be verified: ${capabilities.details?.error ?? 'not found'}${code}` };
}

async function appServerCheck(config: SupervisorConfig, injected: SupervisorBackend | undefined): Promise<DoctorCheck> {
  const backend = injected ?? new (await import('../backends/app-server.js')).AppServerBackend(config);
  const capabilities = await backend.probe();
  if (capabilities.available) {
    return { name: 'vibe', ok: true, status: 'ok', ...(capabilities.version ? { version: capabilities.version } : {}), message: `The installed vibe-app-server matches the pinned manifest for Vibe ${selectedVibeVersion(config.vibeVersion)}; the installed files were hashed and Vibe was not launched.` };
  }
  const reason = typeof capabilities.details?.reason === 'string' ? capabilities.details.reason : 'The app-server pin check failed.';
  const code = typeof capabilities.details?.code === 'string' ? ` [${capabilities.details.code}]` : '';
  return { name: 'vibe', ok: false, message: `${reason}${code}${capabilities.executable ? ` (vibe-app-server: ${capabilities.executable})` : ''}` };
}

export async function runDoctor(config: SupervisorConfig, provenance?: { configPath?: string; configSource?: 'explicit' | 'environment' | 'default'; dataDir?: string; fingerprint?: string }, dependencies: DoctorDependencies = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(nodeRuntimeCheck(process.versions.node));
  checks.push({ name: 'platform', ok: true, version: `${process.platform} ${os.arch()}`, message: `Detected ${process.platform} on ${os.arch()}.` });
  const tmpRoot = await mkdtemp(path.join(await realpath(os.tmpdir()), 'vsup-doctor-'));
  try {
    await createPrivateDir(tmpRoot);
    const git = findExecutable('git').path;
    if (git) {
      try { const version = await probe(git, ['--version'], tmpRoot); checks.push({ name: 'git', ok: true, version, message: 'Git is available.' }); }
      catch { checks.push({ name: 'git', ok: false, message: 'Git could not be probed.' }); }
    } else checks.push({ name: 'git', ok: false, message: 'Git was not found on PATH.' });
    if (process.platform === 'darwin') {
      try { checks.push({ name: 'macos', ok: true, version: await probe('/usr/bin/sw_vers', ['-productVersion'], tmpRoot), message: 'macOS version detected.' }); }
      catch { checks.push({ name: 'macos', ok: false, message: 'macOS version could not be detected with sw_vers.' }); }
    }
    if (config.backend === 'antigravity') {
      try { checks.push(await antigravityCheck(config, dependencies.backend)); }
      catch { checks.push({ name: 'antigravity', ok: false, message: 'The Antigravity CLI probe could not be completed.' }); }
    } else {
      try { checks.push(await appServerCheck(config, dependencies.backend)); }
      catch { checks.push({ name: 'vibe', ok: false, message: 'The vibe-app-server pin check could not be completed.' }); }
    }
    const codex = findExecutable('codex').path;
    if (codex) {
      try { const version = await probe(codex, ['--version'], tmpRoot); checks.push({ name: 'codex', ok: true, version, message: 'Codex CLI is available.' }); }
      catch { checks.push({ name: 'codex', ok: false, message: 'Codex CLI was found but its bounded version probe failed.' }); }
    } else checks.push({ name: 'codex', ok: false, message: 'Codex CLI was not found; this is optional for local MCP use.' });
  } finally { await rm(tmpRoot, { recursive: true, force: true }); }
  let validRoots = 0;
  for (const root of config.allowedWorkspaceRoots) {
    try { const canonical = await realpath(expandHome(root)); if ((await stat(canonical)).isDirectory() && isPathWithinRoot(canonical, canonical)) validRoots++; } catch { /* invalid workspace roots are reported below */ }
  }
  checks.push({ name: 'workspace-roots', ok: config.allowedWorkspaceRoots.length > 0 && validRoots === config.allowedWorkspaceRoots.length, message: `${validRoots}/${config.allowedWorkspaceRoots.length} allowed workspace root(s) resolve to existing directories.` });
  const dataDir = provenance?.dataDir ?? getDataDir();
  try {
    const entry = await lstat(dataDir);
    if (entry.isSymbolicLink()) throw new Error('Supervisor data directory must not be a symlink.');
    await access(dataDir, fsConstants.W_OK | fsConstants.X_OK);
    const info = await stat(dataDir);
    checks.push({ name: 'data-directory', ok: info.isDirectory(), message: info.isDirectory() ? 'Supervisor data directory is writable.' : 'Supervisor data path is not a directory.' });
  } catch {
    try { await access(path.dirname(dataDir), fsConstants.W_OK | fsConstants.X_OK); checks.push({ name: 'data-directory', ok: true, message: 'Supervisor data directory does not exist yet; its parent is writable.' }); }
    catch { checks.push({ name: 'data-directory', ok: false, message: 'Supervisor data directory and its parent are not writable.' }); }
  }
  try {
    const lock = await inspectOwnerLock(dataDir);
    if (!lock.held) checks.push({ name: 'lock', ok: true, message: 'No supervisor currently holds the data directory.' });
    else if (lock.owner === 'malformed') checks.push({ name: 'lock', ok: false, message: `The supervisor owner lock ${lock.path} is malformed; inspect it manually.` });
    else if (lock.owner === 'alive') checks.push({ name: 'lock', ok: true, message: `The data directory is held by supervisor pid ${lock.pid} (alive); another session needs its own VIBE_SUPERVISOR_HOME.` });
    else checks.push({ name: 'lock', ok: true, message: `The data directory lock belongs to pid ${lock.pid}, which is gone or was reused (stale); the next supervisor start takes it over.` });
  } catch { checks.push({ name: 'lock', ok: false, message: 'The supervisor owner lock could not be inspected.' }); }
  checks.push({ name: 'authentication', ok: true, status: 'unverified', message: 'The Mistral credential is resolved from the environment or the macOS Keychain when a run starts; doctor does not read it.' });
  checks.push({ name: 'codex-registration', ok: true, status: 'unverified', message: 'Codex desktop visibility is not verified by doctor; run `vibe-supervisor setup` and restart Codex after reviewing its changes.' });
  try { await import('@modelcontextprotocol/server'); checks.push({ name: 'mcp-server', ok: true, message: 'The MCP SDK dependency is installed.' }); }
  catch { checks.push({ name: 'mcp-server', ok: false, message: 'The MCP SDK dependency is unavailable.' }); }
  const backendCheckName = config.backend === 'antigravity' ? 'antigravity' : 'vibe';
  const requiredFailure = checks.some((check) => !check.ok && ['node', 'git', backendCheckName, 'workspace-roots', 'data-directory', 'mcp-server'].includes(check.name));
  const selectedPath = provenance?.configPath ?? path.join(dataDir, 'config.toml');
  const vibeVersion = checks.find((check) => check.name === 'vibe')?.version;
  return { ok: !requiredFailure, generatedAt: new Date().toISOString(), provenance: {
    backend: config.backend ?? 'app-server',
    backend_experimental: config.backend === 'antigravity',
    ...(config.backend === 'antigravity' ? { antigravity_permission_layer: config.experimental?.antigravitySkipPermissions === true ? 'bypassed' as const : 'enforced' as const } : {}),
    executable: process.execPath,
    application_entrypoint: fileURLToPath(new URL('../cli.js', import.meta.url)),
    runtime_module: fileURLToPath(import.meta.url),
    app_version: APP_VERSION,
    ...(vibeVersion ? { vibe_version: vibeVersion } : {}),
    config_path: selectedPath,
    config_source: provenance?.configSource ?? 'default',
    config_fingerprint: provenance?.fingerprint ?? configFingerprint(config),
    data_directory: dataDir,
    storage_mode: 'selected-template'
  }, checks };
}
