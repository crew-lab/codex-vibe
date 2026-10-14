import type { StartRunInput } from '../../contracts.js';
import { supervisorError } from '../../contracts.js';
import { object, array, string } from './protocol.js';
import { APP_SERVER_MODEL, APP_SERVER_REASONING, DISABLED_FEATURES, SEARCH_NAME, type AppServerProfile } from './session-config.js';

export function validateSessionSnapshot(value: unknown, input: StartRunInput, allowCallbacks = false): string {
  const state = object(value, 'session state');
  const session = object(state.session, 'session');
  if (!Number.isSafeInteger(state.eventId) || typeof state.eventId !== 'number' || state.eventId < 0) throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid app-server event watermark.');
  if (state.format !== 'vibe.public-session-state/v1' || session.harness !== 'unified' || session.cwd !== input.workerWorkspace) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server session identity or harness mismatch.');
  const roots = array(session.workspaceRoots, 'workspace roots');
  if (roots.length > 1 || roots.some(root => root !== input.workerWorkspace)) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server exposed additional workspace roots.');
  const callbacks = array(state.activeCallbacks, 'initial callbacks');
  if ((!allowCallbacks && callbacks.length !== 0) || array(state.backgroundProcesses, 'background processes').length !== 0 || array(state.childSessions, 'child sessions').length !== 0) throw supervisorError('VSUP_BACKEND_ERROR', 'App-server new session has unexpected active work.');
  return string(session.id, 'session id');
}

export function validateRuntime(value: unknown, profile: AppServerProfile, checkModel: boolean): void {
  const response = object(value, 'runtime response');
  const runtime = object(response.runtime, 'runtime');
  const fail = (field: string): never => { throw supervisorError('VSUP_BACKEND_ERROR', 'App-server effective runtime mismatch.', { field }); };
  if (response.ready !== true) fail('ready');
  if (object(runtime.activeAgent, 'active agent').name !== profile.agent) fail('active_agent');
  const names = array(runtime.tools, 'runtime tools').map(tool => string(object(tool).name, 'tool name')).sort();
  if (JSON.stringify(names) !== JSON.stringify([...profile.tools].sort())) fail('tools');
  if (array(runtime.skills, 'skills').length !== 0) fail('skills');
  if (array(runtime.issues, 'issues').length !== 0) fail('issues');
  if (runtime.hooksCount !== 0 || runtime.bypassToolPermissions !== false) fail('permissions_or_hooks');
  if (object(runtime.connectors, 'connectors').connected !== 0) fail('connectors');
  const mcp = object(runtime.mcp, 'mcp');
  if (Object.keys(object(mcp.discoveryErrors, 'MCP discovery errors')).length !== 0 || mcp.connectorError !== null) fail('mcp_errors');
  const sources = array(mcp.sources, 'MCP sources');
  if (sources.length !== 1) fail('mcp_sources');
  const source = object(sources[0]);
  if (source.name !== SEARCH_NAME || source.kind !== 'server' || source.transport !== 'stdio' || source.status !== 'connected' || source.error !== null || source.pluginName !== null) fail('mcp_source_identity');
  const searchNames = array(source.tools, 'MCP tools').map(tool => {
    const item = object(tool); if (item.enabled !== true) fail('mcp_tool_enabled'); return string(item.name, 'MCP tool name');
  }).sort();
  if (JSON.stringify(searchNames) !== JSON.stringify(['grep', 'list_files'])) fail('mcp_tool_inventory');
  const log = object(response.sessionLog, 'session log');
  if (log.enabled !== false || log.persisted !== false) fail('session_logging');
  if (checkModel) {
    const model = object(object(runtime.config, 'runtime config').activeModel, 'active model');
    if (model.alias !== APP_SERVER_MODEL || model.thinking !== APP_SERVER_REASONING) fail('active_model');
  }
}

export function validateEffectiveConfig(value: unknown, profile: AppServerProfile): void {
  const config = object(object(value, 'effective config response').config, 'effective config');
  const fail = (field: string): never => { throw supervisorError('VSUP_BACKEND_ERROR', 'App-server effective configuration mismatch.', { field }); };
  for (const feature of DISABLED_FEATURES) if (config[feature] !== false) fail(feature);
  if (config.default_agent !== profile.agent || config.max_turns !== profile.agentConfig.maxTurns) fail('agent_or_turn_limit');
  if (JSON.stringify(config.enabled_skills) !== '[]' || JSON.stringify(config.disabled_skills) !== '["*"]') fail('skill_filter');
  if (object(config.session_logging, 'session logging').enabled !== false) fail('session_logging');
  const names = array(config.enabled_tools, 'enabled tools');
  if (JSON.stringify([...names].sort()) !== JSON.stringify([...profile.tools].sort())) fail('enabled_tools');
  const disabled = array(config.disabled_tools, 'disabled tools');
  if (array(profile.agentConfig.disabledTools, 'profile disabled tools').some(name => !disabled.includes(name))) fail('disabled_tools');
  const configured = object(config.tools, 'tool configurations');
  for (const name of profile.tools) {
    const tool = object(configured[name], 'tool configuration');
    if (tool.permission !== 'ask') fail('tool_permission');
    if (['read_file', 'write_file', 'edit'].includes(name) && JSON.stringify(tool.allowlist) !== '[]') fail('automatic_path_grants');
  }
  const servers = array(config.mcp_servers, 'configured MCP servers');
  if (servers.length !== 1) fail('mcp_configuration');
  const server = object(servers[0]);
  if (server.name !== profile.mcpServer.name || server.command !== profile.mcpServer.command || JSON.stringify(server.args) !== JSON.stringify(profile.mcpServer.args) || server.cwd !== profile.mcpServer.cwd) fail('mcp_launch_configuration');
  const env = object(server.env, 'MCP environment');
  const expected = object(profile.mcpServer.env, 'profile MCP environment');
  if (Object.keys(env).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => env[key] !== value)) fail('mcp_environment');
}
