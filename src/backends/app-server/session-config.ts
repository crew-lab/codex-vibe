import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stringify } from 'smol-toml';
import type { StartRunInput } from '../../contracts.js';
import { buildChildEnvironment } from '../../security/environment.js';
import { createPrivateDir, createPrivateFile } from '../../security/paths.js';
import { assertSimpleGlobRoot } from '../profile.js';
import type { JsonObject } from './protocol.js';

export const APP_SERVER_MODEL = 'mistral-medium-3.5';
export const APP_SERVER_REASONING = 'high';
export const SEARCH_NAME = 'supervisor_search';
export const SEARCH_TOOLS = ['supervisor_search_grep', 'supervisor_search_list_files'] as const;
export const DISABLED_FEATURES = ['enable_subagents', 'enable_background_processes', 'managed_shell_tools_enabled', 'enable_connectors', 'enable_telemetry', 'enable_update_checks', 'experimental_enable_model_catalog'] as const;
const DISABLED_TOOLS = ['bash', 'grep', 'skill', 'exit_plan_mode', 'ask_user_question', 'cron'];

export interface AppServerProfile {
  home: string;
  vibeHome: string;
  tmp: string;
  agent: string;
  tools: string[];
  env: NodeJS.ProcessEnv;
  mcpServer: JsonObject;
  agentConfig: JsonObject;
  searchRegistry: string;
  searchNonce: string;
}

function denylist(root: string): string[] {
  return ['.git', '.vibe', '.agents', '.vibeignore', '.env', '.env.*', '.envrc', '.envrc.*', '*.pem', '*.key', '*.p12', '*.pfx'].flatMap(name => [
    `${root}/${name}`, `${root}/${name}/**`, `${root}/**/${name}`, `${root}/**/${name}/**`,
  ]);
}

export async function createAppServerProfile(input: StartRunInput, deadline: number): Promise<AppServerProfile> {
  assertSimpleGlobRoot(input.workerWorkspace);
  const home = path.join(input.runDirectory, 'child-home');
  const vibeHome = path.join(input.runDirectory, 'vibe-home');
  const tmp = path.join(input.runDirectory, 'tmp');
  const searchRegistry = path.join(tmp, 'search-processes'); const searchNonce = randomUUID();
  for (const directory of [home, vibeHome, tmp, searchRegistry, path.join(vibeHome, 'agents')]) await createPrivateDir(directory);
  const agent = input.mode === 'review' ? 'supervisor-review' : 'supervisor-edit';
  const native = input.mode === 'review' ? ['read_file'] : ['read_file', 'write_file', 'edit'];
  const tools = [...native, ...SEARCH_TOOLS];
  const disabled = [...DISABLED_TOOLS, ...(input.mode === 'review' ? ['write_file', 'edit'] : [])];
  // An explicit path allowlist wins over ask in Vibe. Empty allowlists keep every
  // file action at the Supervisor's invocation-level approval handler.
  const definitions = Object.fromEntries(tools.map(name => [name, {
    permission: 'ask',
    ...(native.includes(name) ? { allowlist: [], denylist: denylist(input.workerWorkspace), sensitive_patterns: [] } : {}),
  }]));
  await createPrivateFile(path.join(vibeHome, 'agents', `${agent}.toml`), stringify({
    display_name: 'Supervisor', description: 'Supervisor-owned one-shot policy',
    safety: input.mode === 'review' ? 'safe' : 'destructive',
    enabled_tools: tools, disabled_tools: disabled, tools: definitions,
  }));
  const env = buildChildEnvironment(process.env);
  env.HOME = home; env.VIBE_HOME = vibeHome; env.TMPDIR = tmp;
  env.LOG_LEVEL = 'ERROR';
  for (const feature of DISABLED_FEATURES) env[`VIBE_${feature.toUpperCase()}`] = 'false';
  env.VIBE_ENABLED_SKILLS = '[]'; env.VIBE_DISABLED_SKILLS = '["*"]';
  env.VIBE_MCP_SERVERS = '[]';
  env.VIBE_ENABLED_AGENTS = JSON.stringify([agent]); env.VIBE_DEFAULT_AGENT = agent;
  env.VIBE_ENABLED_TOOLS = JSON.stringify(tools); env.VIBE_DISABLED_TOOLS = JSON.stringify(disabled);
  env.VIBE_SESSION_LOGGING__ENABLED = 'false'; env.VIBE_SESSION_LOGGING__SAVE_DIR = path.join(tmp, 'sessions');
  env.VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS = String(input.limits.timeoutSeconds);
  const searchEnv = {
    HOME: home, PATH: '/usr/bin:/bin', LANG: 'C', TMPDIR: tmp,
    VIBE_SUPERVISOR_SEARCH_ROOT: input.workerWorkspace,
    VIBE_SUPERVISOR_SEARCH_RUN_ID: input.runId,
    VIBE_SUPERVISOR_SEARCH_DEADLINE: String(deadline),
    VIBE_SUPERVISOR_SEARCH_REGISTRY: searchRegistry,
    VIBE_SUPERVISOR_SEARCH_NONCE: searchNonce,
  };
  // Vibe's discovery and invocation paths need not inherit identically. The
  // POSIX environment launcher clears both paths before Node can start.
  const mcpServer: JsonObject = {
    transport: 'stdio', name: SEARCH_NAME, command: '/usr/bin/env',
    args: ['-i', ...Object.entries(searchEnv).map(([key, value]) => `${key}=${value}`), process.execPath, fileURLToPath(new URL('./search-server.js', import.meta.url))],
    cwd: input.runDirectory, env: {},
  };
  const agentConfig: JsonObject = {
    cwd: input.workerWorkspace, agent, enabledTools: tools, disabledTools: disabled,
    maxTurns: input.limits.maxTurns, headless: true,
    autoApprove: false, trustWorkspace: false, workspaceRoots: [], mcpServers: [mcpServer],
  };
  return { home, vibeHome, tmp, agent, tools, env, mcpServer, agentConfig, searchRegistry, searchNonce };
}
