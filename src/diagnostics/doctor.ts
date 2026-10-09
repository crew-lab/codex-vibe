import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { access, mkdtemp, rm, stat, lstat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPrivateDir, isPathWithinRoot } from '../security/paths.js';
import { executableSearchPath, getDataDir } from '../config/config.js';
import { SUPPORTED_VIBE } from '../backends/pinned.js';
import { inspectOwnerLock } from '../core/owner-lock.js';
import type { SupervisorConfig } from '../contracts.js';
import { environmentSecrets, redactSecrets } from '../security/redaction.js';

export interface DoctorCheck { name: string; ok: boolean; status?: 'ok' | 'missing' | 'unverified'; version?: string; message: string; stderr_tail?: string }
export interface DoctorReport { ok: boolean; generatedAt: string; checks: DoctorCheck[] }

type ExecutableLookup = { path?: string; rejected?: string };

function searchPath(name: string): string | undefined {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of executableSearchPath()) for (const extension of extensions) {
    const candidate = path.join(directory, `${name}${extension}`);
    try { requireAccess(candidate); return candidate; } catch { /* keep searching */ }
  }
  return undefined;
}

function findExecutable(name: string, configPath?: string): ExecutableLookup {
  if (!configPath) { const found = searchPath(name); return found ? { path: found } : {}; }
  if (path.isAbsolute(configPath)) return { path: configPath };
  if (/[\\/]/.test(configPath)) return { rejected: configPath };
  const found = searchPath(configPath);
  return found ? { path: found } : {};
}

function rejectedMessage(label: string, configured: string): string {
  return `The configured ${label} path ${JSON.stringify(configured)} is relative; use an absolute path or a bare command name that resolves through PATH.`;
}

function requireAccess(file: string): void {
  // Synchronous check keeps PATH scanning simple and does not execute the candidate.
  accessSync(file, fsConstants.X_OK);
}

async function probe(executable: string, args: string[], cwd: string, timeoutMs = 2500): Promise<string> {
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
  return `${check.status === 'unverified' ? 'UNVERIFIED' : check.ok ? 'PASS' : 'CHECK'} ${check.name}: ${check.message}${check.version ? ` (${check.version})` : ''}${check.stderr_tail ? `\n  Vibe ACP stderr: ${check.stderr_tail}` : ''}`;
}

export async function runDoctor(config: SupervisorConfig): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeVersion = process.versions.node;
  const [major] = nodeVersion.split('.').map(Number);
  checks.push({ name: 'node', ok: (major ?? 0) >= 20, version: nodeVersion, message: (major ?? 0) >= 20 ? 'Supported Node.js runtime.' : 'Node.js 20 or newer is required.' });
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
    const vibeLookup = findExecutable('vibe', config.paths?.vibe);
    const vibe = vibeLookup.path;
    if (vibeLookup.rejected) checks.push({ name: 'vibe', ok: false, message: rejectedMessage('Vibe', vibeLookup.rejected) });
    else if (vibe) {
      try {
        const version = await probe(vibe, ['--version'], tmpRoot);
        const match = version.match(/\b(\d+)\.(\d+)\.(\d+)/);
        const supported = Boolean(match && `${match[1]}.${match[2]}.${match[3]}` === SUPPORTED_VIBE);
        checks.push({ name: 'vibe', ok: supported, status: supported ? 'ok' : 'unverified', version, message: supported ? `Exact supported Vibe version ${SUPPORTED_VIBE} verified in an isolated temporary home.` : `The compatibility shim is pinned to Vibe ${SUPPORTED_VIBE}; another or unparseable version is unverified.` });
      }
      catch { checks.push({ name: 'vibe', ok: false, message: 'Vibe was found but its bounded version probe failed.' }); }
    } else checks.push({ name: 'vibe', ok: false, message: 'Vibe was not found on PATH or in configuration.' });
    const acpLookup = findExecutable('vibe-acp', config.paths?.vibeAcp);
    const acp = acpLookup.path;
    if (acpLookup.rejected) checks.push({ name: 'vibe-acp', ok: false, message: rejectedMessage('Vibe ACP', acpLookup.rejected) });
    else if (acp) {
      try { const version = await probe(acp, ['--version'], tmpRoot); checks.push({ name: 'vibe-acp', ok: true, version, message: 'Vibe ACP is available.' }); }
      catch { checks.push({ name: 'vibe-acp', ok: false, message: 'Vibe ACP was found but its bounded version probe failed.' }); }
    } else checks.push({ name: 'vibe-acp', ok: false, message: 'Vibe ACP was not found on PATH or in configuration.' });
    if (acp) {
      try {
        const backendModulePath = '../backends/acp.js';
        const { AcpBackend } = await import(backendModulePath);
        const homeKeys = ['HOME', 'VIBE_HOME', 'TMPDIR'] as const;
        const previous = homeKeys.map((key) => process.env[key]);
        for (const key of homeKeys) process.env[key] = tmpRoot;
        let capabilities;
        try { capabilities = await new AcpBackend(config).probe(); }
        finally { homeKeys.forEach((key, index) => { const value = previous[index]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }); }
        const tail = !capabilities.available && typeof capabilities.details?.stderr_tail === 'string' ? redactSecrets(capabilities.details.stderr_tail, environmentSecrets()) : '';
        checks.push({ name: 'acp-initialize', ok: capabilities.available, message: capabilities.available ? 'ACP initialization probe succeeded in the isolated temporary home.' : 'ACP initialization probe did not succeed.', ...(tail ? { stderr_tail: tail } : {}) });
      } catch {
        checks.push({ name: 'acp-initialize', ok: false, message: 'ACP initialization probe failed; inspect local diagnostics and the Vibe ACP version.' });
      }
    } else checks.push({ name: 'acp-initialize', ok: false, status: 'unverified', message: 'ACP initialization was not attempted because Vibe ACP is unavailable.' });
    const codex = findExecutable('codex').path;
    if (codex) {
      try { const version = await probe(codex, ['--version'], tmpRoot); checks.push({ name: 'codex', ok: true, version, message: 'Codex CLI is available.' }); }
      catch { checks.push({ name: 'codex', ok: false, message: 'Codex CLI was found but its bounded version probe failed.' }); }
    } else checks.push({ name: 'codex', ok: false, message: 'Codex CLI was not found; this is optional for local MCP use.' });
  } finally { await rm(tmpRoot, { recursive: true, force: true }); }
  let validRoots = 0;
  for (const root of config.allowedWorkspaceRoots) {
    try { const canonical = await realpath(root); if ((await stat(canonical)).isDirectory() && isPathWithinRoot(canonical, canonical)) validRoots++; } catch { /* invalid workspace roots are reported below */ }
  }
  checks.push({ name: 'workspace-roots', ok: config.allowedWorkspaceRoots.length > 0 && validRoots === config.allowedWorkspaceRoots.length, message: `${validRoots}/${config.allowedWorkspaceRoots.length} allowed workspace root(s) resolve to existing directories.` });
  const dataDir = config.paths?.dataDir ?? getDataDir();
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
  checks.push({ name: 'authentication', ok: true, status: 'unverified', message: 'Vibe authentication was not inspected; Vibe may use its existing local sign-in or operating-system credential store.' });
  checks.push({ name: 'codex-registration', ok: true, status: 'unverified', message: 'Codex desktop visibility is not verified by doctor; run `vibe-supervisor setup` and restart Codex after reviewing its changes.' });
  try { await import('@modelcontextprotocol/server'); checks.push({ name: 'mcp-server', ok: true, message: 'The MCP SDK dependency is installed.' }); }
  catch { checks.push({ name: 'mcp-server', ok: false, message: 'The MCP SDK dependency is unavailable.' }); }
  const requiredFailure = checks.some((check) => !check.ok && ['node', 'git', 'vibe', 'workspace-roots', 'data-directory', 'mcp-server'].includes(check.name));
  return { ok: !requiredFailure, generatedAt: new Date().toISOString(), checks };
}
