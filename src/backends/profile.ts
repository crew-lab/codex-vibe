import path from 'node:path';
import { lstat } from 'node:fs/promises';
import type { RunMode, StartRunInput } from '../contracts.js';
import { createPrivateDir, createPrivateFile } from '../security/paths.js';
import { stringify } from 'smol-toml';
import { buildChildEnvironment, ORIGINAL_HOME_ENV } from '../security/environment.js';

const SENSITIVE_NAMES = ['.env', '.env.*', '.envrc', '.envrc.*', '*.pem', '*.key', '*.p12', '*.pfx'];
const RESERVED_DIRS = ['.git', '.vibe', '.agents'];
const RESERVED_FILES = ['.vibeignore'];

const STOCK_GREP_EXCLUDE_PATTERNS = [
  '.venv/', 'venv/', '.env/', 'env/', 'node_modules/', '.git/', '.vibe/', '.agents/',
  '__pycache__/', '.pytest_cache/', '.mypy_cache/', '.tox/', '.nox/', '.coverage/',
  'htmlcov/', 'dist/', 'build/', '.idea/', '.vscode/', '*.egg-info', '*.pyc', '*.pyo', '*.pyd',
  '.DS_Store', 'Thumbs.db', '*.env', '*.env.*', '*.envrc', '*.envrc.*', '*.pem', '*.key', '*.p12', '*.pfx',
];

function assertSimpleGlobRoot(root: string): void {
  if (/[\*?\[\]]/.test(root)) throw new Error('Workspace path contains glob characters and cannot be safely encoded for Vibe');
}

function setToolPathPolicy(env: NodeJS.ProcessEnv, name: string, root: string, permission: 'never' | 'always' | 'ask'): void {
  assertSimpleGlobRoot(root);
  const prefix = `VIBE_TOOLS__${name.toUpperCase()}`;
  const absolute = path.resolve(root);
  const nestedSecrets = SENSITIVE_NAMES.flatMap((pattern) => [`${absolute}/**/${pattern}`, `${absolute}/**/**/${pattern}`]);
  const rootSecrets = SENSITIVE_NAMES.map((pattern) => `${absolute}/${pattern}`);
  const reserved = RESERVED_DIRS.flatMap((name) => [
    `${absolute}/${name}`, `${absolute}/${name}/**`,
    `${absolute}/**/${name}`, `${absolute}/**/${name}/**`,
  ]);
  const reservedFiles = RESERVED_FILES.flatMap((name) => [`${absolute}/${name}`, `${absolute}/**/${name}`]);
  env[`${prefix}__PERMISSION`] = permission;
  env[`${prefix}__DENYLIST`] = JSON.stringify([...reserved, ...reservedFiles, ...rootSecrets, ...nestedSecrets]);
  env[`${prefix}__ALLOWLIST`] = JSON.stringify([`vibe-path:directory_recursive:${absolute}`]);
  env[`${prefix}__SENSITIVE_PATTERNS`] = JSON.stringify([
    `${absolute}/.env`, `${absolute}/.env.*`, `${absolute}/.envrc`, `${absolute}/.envrc.*`,
    `${absolute}/**/.env`, `${absolute}/**/.env.*`, `${absolute}/**/.envrc`, `${absolute}/**/.envrc.*`,
  ]);
  if (name === 'grep') env[`${prefix}__EXCLUDE_PATTERNS`] = JSON.stringify(STOCK_GREP_EXCLUDE_PATTERNS);
}

export interface VibeChildProfile {
  home: string;
  vibeHome: string;
  env: NodeJS.ProcessEnv;
}

export async function assertNoProjectVibeExtensions(root: string): Promise<void> {
  const canonical = path.resolve(root);
  for (const rel of ['.vibe', '.agents']) {
    try {
      const info = await lstat(path.join(canonical, rel));
      if (info.isSymbolicLink() || info.isDirectory() || info.isFile()) {
        throw new Error(`Workspace contains project Vibe configuration at ${rel}; this profile cannot prove it inactive`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const ignore = path.join(canonical, '.vibeignore');
  try {
    const info = await lstat(ignore);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Workspace .vibeignore must be a regular, non-symlink file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function writeSupervisorAgentProfile(vibeHome: string, agentId: string, mode: RunMode, tools: string[]): Promise<void> {
  const agentDirectory = path.join(vibeHome, 'agents');
  await createPrivateDir(agentDirectory);
  const toolPermissions: Record<string, { permission: string }> = Object.fromEntries(
    tools.map((tool) => [tool, { permission: tool === 'bash' ? 'ask' : 'never' }]),
  );
  await createPrivateFile(path.join(agentDirectory, `${agentId}.toml`), stringify({
    display_name: mode === 'review' ? 'Plan' : 'Accept Edits',
    description: 'Supervisor-owned workspace policy',
    safety: mode === 'review' ? 'safe' : 'destructive',
    enabled_tools: tools,
    disabled_tools: ['exit_plan_mode'],
    tools: toolPermissions,
  }), 'w');
}

export interface VibeChildProfileOptions {
  allowShell?: boolean;
  forwardOriginalHome?: boolean;
}

export async function createVibeChildProfile(input: StartRunInput, mode: RunMode, options: VibeChildProfileOptions = {}): Promise<VibeChildProfile> {
  const allowShell = options.allowShell === true;
  const home = path.join(input.runDirectory, 'child-home');
  const vibeHome = path.join(input.runDirectory, 'vibe-home');
  await createPrivateDir(home);
  await createPrivateDir(vibeHome);

  const env = buildChildEnvironment(process.env);
  const originalHome = process.env.HOME;
  if (options.forwardOriginalHome === true && originalHome && path.isAbsolute(originalHome)) env[ORIGINAL_HOME_ENV] = originalHome;
  env.HOME = home;
  env.VIBE_HOME = vibeHome;
  env.VIBE_ACP_LOGGING_ENABLED = '0';
  env.LOG_LEVEL = 'ERROR';
  env.VIBE_ENABLE_TELEMETRY = 'false';
  env.VIBE_DEFAULT_AGENT = mode === 'review' ? 'plan' : 'accept-edits';
  env.VIBE_ENABLED_AGENTS = JSON.stringify([env.VIBE_DEFAULT_AGENT]);
  const tools = mode === 'review'
    ? ['read_file', 'grep']
    : ['read_file', 'grep', 'write_file', 'edit', ...(allowShell ? ['bash'] : [])];
  env.VIBE_ENABLED_TOOLS = JSON.stringify(tools);
  env.VIBE_ENABLE_CONNECTORS = 'false';
  env.VIBE_MCP_SERVERS = '[]';
  env.VIBE_SESSION_LOGGING__SAVE_DIR = path.join(vibeHome, 'sessions');
  for (const tool of ['read_file', 'grep']) setToolPathPolicy(env, tool, input.workerWorkspace, 'never');
  if (mode === 'edit') {
    for (const tool of ['write_file', 'edit']) setToolPathPolicy(env, tool, input.workerWorkspace, 'never');
    if (allowShell) env.VIBE_TOOLS__BASH__PERMISSION = 'ask';
  }
  await writeSupervisorAgentProfile(vibeHome, env.VIBE_DEFAULT_AGENT, mode, tools);
  return { home, vibeHome, env };
}
