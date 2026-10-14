import path from 'node:path';
import { stringify } from 'smol-toml';
import type { RunMode } from '../../contracts.js';
import { WorkspacePathError, createPrivateDir, createPrivateFile } from '../../security/paths.js';
import { buildConfigModelWrite, type SessionAgentConfigInput } from './protocol.js';
import { THINKING_OFF, type ReadbackExpectation, type SettingExpectation, type ToolPolicyExpectation } from './readback.js';

export const PROFILE_TOOLS: Readonly<Record<RunMode, readonly string[]>> = {
  review: ['read_file'],
  edit: ['read_file', 'write_file', 'edit']
};

export const DISABLED_TOOLS: readonly string[] = ['ask_user_question', 'exit_plan_mode', 'cron'];
export const AGENT_NAMES: Readonly<Record<RunMode, string>> = { review: 'supervisor-review', edit: 'supervisor-edit' };
export const PRIVATE_DIRECTORY_NAMES = { home: 'child-home', vibeHome: 'vibe-home', tmp: 'tmp' } as const;
export const TOOL_PERMISSION = 'ask';
export const LOG_LEVEL = 'ERROR';

const AGENT_SAFETY: Readonly<Record<RunMode, 'safe' | 'destructive'>> = { review: 'safe', edit: 'destructive' };
const SECRET_FILE_PATTERNS = ['.env', '.env.*', '.envrc', '.envrc.*', '*.pem', '*.key', '*.p12', '*.pfx'];
const RESERVED_DIRECTORIES = ['.git', '.vibe', '.agents'];
const RESERVED_FILES = ['.vibeignore'];

type SettingValue = boolean | string | readonly string[];

interface RuntimeSetting {
  key: string;
  value: SettingValue;
  match?: 'includes';
}

const RUNTIME_SETTINGS: readonly RuntimeSetting[] = [
  { key: 'enable_subagents', value: false },
  { key: 'enable_background_processes', value: false },
  { key: 'managed_shell_tools_enabled', value: false },
  { key: 'enable_connectors', value: false },
  { key: 'disabled_skills', value: ['*'], match: 'includes' },
  { key: 'mcp_servers', value: [] },
  { key: 'enable_telemetry', value: false },
  { key: 'enable_otel', value: false },
  { key: 'enable_update_checks', value: false },
  { key: 'enable_auto_update', value: false },
  { key: 'experimental_enable_model_catalog', value: false },
  { key: 'experimental_enable_registry_skills', value: false },
  { key: 'experiments.enable', value: false },
  { key: 'session_logging.enabled', value: false },
  { key: 'session_logging.generate_titles', value: false },
  { key: 'bypass_tool_permissions', value: false }
];

function runtimeSettings(agent: string): readonly RuntimeSetting[] {
  return [...RUNTIME_SETTINGS, { key: 'default_agent', value: agent }, { key: 'enabled_agents', value: [agent] }];
}

export interface SessionDirectories {
  home: string;
  vibeHome: string;
  tmp: string;
}

export interface SessionConfigInput {
  mode: RunMode;
  workspace: string;
  runDirectory: string;
  maxTurns: number;
}

export interface AgentProfileDocument {
  display_name: string;
  description: string;
  safety: 'safe' | 'destructive';
  tools: Record<string, { permission: typeof TOOL_PERMISSION; denylist: string[] }>;
}

export interface SessionConfigPlan {
  mode: RunMode;
  agent: string;
  directories: SessionDirectories;
  agentConfig: SessionAgentConfigInput;
  profile: { directory: string; file: string; document: AgentProfileDocument; content: string };
  environment: Record<string, string>;
  expectation: ReadbackExpectation;
}

function requireAbsolute(value: string, name: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path`);
  return path.resolve(value);
}

export function assertGlobSafeRoot(root: string): void {
  if (/[*?[\]]/.test(root)) throw new WorkspacePathError(`Workspace path contains glob characters (* ? [ ]) and cannot be safely encoded for Vibe: ${root}`);
}

export function workspaceDenylist(workspace: string): string[] {
  const root = requireAbsolute(workspace, 'workspace');
  assertGlobSafeRoot(root);
  return [
    ...RESERVED_DIRECTORIES.flatMap((name) => [`${root}/${name}`, `${root}/${name}/**`, `${root}/**/${name}`, `${root}/**/${name}/**`]),
    ...RESERVED_FILES.flatMap((name) => [`${root}/${name}`, `${root}/**/${name}`]),
    ...SECRET_FILE_PATTERNS.map((pattern) => `${root}/${pattern}`),
    ...SECRET_FILE_PATTERNS.map((pattern) => `${root}/**/${pattern}`)
  ];
}

export function sessionDirectories(runDirectory: string): SessionDirectories {
  const root = requireAbsolute(runDirectory, 'runDirectory');
  return { home: path.join(root, PRIVATE_DIRECTORY_NAMES.home), vibeHome: path.join(root, PRIVATE_DIRECTORY_NAMES.vibeHome), tmp: path.join(root, PRIVATE_DIRECTORY_NAMES.tmp) };
}

function settingEnvironmentName(key: string): string {
  return `VIBE_${key.split('.').join('__').toUpperCase()}`;
}

function encodeSettingValue(value: SettingValue): string {
  if (typeof value === 'string') return value;
  return typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function buildEnvironment(directories: SessionDirectories, agent: string): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: directories.home,
    VIBE_HOME: directories.vibeHome,
    TMPDIR: directories.tmp,
    LOG_LEVEL,
    VIBE_SESSION_LOGGING__SAVE_DIR: path.join(directories.vibeHome, 'sessions')
  };
  for (const setting of runtimeSettings(agent)) environment[settingEnvironmentName(setting.key)] = encodeSettingValue(setting.value);
  return environment;
}

function buildExpectation(workspace: string, agent: string, tools: readonly string[], denylist: readonly string[]): ReadbackExpectation {
  const toolPolicies: Record<string, ToolPolicyExpectation> = Object.fromEntries(tools.map((tool) => [tool, { permission: TOOL_PERMISSION, denylist }]));
  const settings: SettingExpectation[] = runtimeSettings(agent).map((setting) => ({ path: setting.key.split('.'), value: setting.value, match: setting.match ?? 'equal' }));
  return { harness: 'unified', agent, cwd: workspace, tools, disabledTools: DISABLED_TOOLS, toolPolicies, settings };
}

export function buildSessionConfig(input: SessionConfigInput): SessionConfigPlan {
  if (input.mode !== 'review' && input.mode !== 'edit') throw new TypeError('mode must be review or edit');
  if (!Number.isInteger(input.maxTurns) || input.maxTurns < 1) throw new RangeError('maxTurns must be a positive integer');
  const workspace = requireAbsolute(input.workspace, 'workspace');
  const denylist = workspaceDenylist(workspace);
  const directories = sessionDirectories(input.runDirectory);
  const tools = PROFILE_TOOLS[input.mode];
  const agent = AGENT_NAMES[input.mode];
  const document: AgentProfileDocument = {
    display_name: input.mode === 'review' ? 'Supervisor Review' : 'Supervisor Edit',
    description: 'Supervisor-owned workspace policy',
    safety: AGENT_SAFETY[input.mode],
    tools: Object.fromEntries(tools.map((tool) => [tool, { permission: TOOL_PERMISSION, denylist: [...denylist] }]))
  };
  const profileDirectory = path.join(directories.vibeHome, 'agents');
  return {
    mode: input.mode,
    agent,
    directories,
    agentConfig: { cwd: workspace, agent, enabledTools: [...tools], disabledTools: [...DISABLED_TOOLS], maxTurns: input.maxTurns },
    profile: { directory: profileDirectory, file: path.join(profileDirectory, `${agent}.toml`), document, content: stringify(document) },
    environment: buildEnvironment(directories, agent),
    expectation: buildExpectation(workspace, agent, tools, denylist)
  };
}

export async function writeSessionFiles(plan: SessionConfigPlan): Promise<void> {
  await createPrivateDir(plan.directories.home);
  await createPrivateDir(plan.directories.vibeHome);
  await createPrivateDir(plan.directories.tmp);
  await createPrivateDir(plan.profile.directory);
  await createPrivateFile(plan.profile.file, plan.profile.content, 'w');
}

export function buildThinkingOffWrite(sessionId: string): ReturnType<typeof buildConfigModelWrite> {
  return buildConfigModelWrite(sessionId, { reasoningEffort: THINKING_OFF });
}
