import type { RunMode } from '../../contracts.js';
import { SELECTABLE_VIBE_VERSIONS, SUPPORTED_VIBE, type SelectableVibeVersion } from './supported-vibe.js';

export type ToolAccess = 'read' | 'edit';
export type ToolFingerprint = 'path' | 'path_content' | 'path_changes';

export interface WireTool {
  configName: string;
  approvalName: string;
  effectKind: string;
  access: ToolAccess;
  fingerprint: ToolFingerprint;
}

export type WireSettingValue = boolean | string | readonly string[];

export interface WireSetting {
  key: string;
  value: WireSettingValue;
  match?: 'includes';
}

export interface WireSkillProvenance {
  source: string;
  scope: string;
  registry: null;
}

export interface VibeWireFacts {
  harness: string;
  toolPermission: string;
  tools: readonly WireTool[];
  profiles: Readonly<Record<RunMode, readonly string[]>>;
  disabledTools: readonly string[];
  runtimeSettings: readonly WireSetting[];
  agentSettingKeys: { defaultAgent: string; enabledAgents: string };
  managedConfig: { route: string; baseUrlSetting: string };
  configRead: { harnessSelectionSourceOptional: boolean };
  bundledSkills: { names: readonly string[]; provenance: WireSkillProvenance };
  historyEntryKinds: readonly string[];
  notificationMethods: readonly string[];
}

export const VIBE_WIRE: Readonly<Record<SelectableVibeVersion, VibeWireFacts>> = {
  '3.0.2': {
    harness: 'unified',
    toolPermission: 'ask',
    tools: [
      { configName: 'read_file', approvalName: 'file_system.read_file', effectKind: 'file_read', access: 'read', fingerprint: 'path' },
      { configName: 'write_file', approvalName: 'file_system.write_file', effectKind: 'file_write', access: 'edit', fingerprint: 'path_content' },
      { configName: 'edit', approvalName: 'file_system.search_replace', effectKind: 'file_edit', access: 'edit', fingerprint: 'path_changes' }
    ],
    profiles: {
      review: ['read_file'],
      edit: ['read_file', 'write_file', 'edit']
    },
    disabledTools: ['ask_user_question', 'exit_plan_mode', 'cron'],
    runtimeSettings: [
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
    ],
    agentSettingKeys: { defaultAgent: 'default_agent', enabledAgents: 'enabled_agents' },
    managedConfig: { route: '/api/v1/code/managed-config', baseUrlSetting: 'vibe_base_url' },
    configRead: { harnessSelectionSourceOptional: true },
    bundledSkills: {
      names: ['vibe:create-plugin', 'vibe:skill-creator', 'vibe:vibe', 'vibe:worktree'],
      provenance: { source: 'plugin', scope: 'builtin', registry: null }
    },
    historyEntryKinds: ['message', 'reasoning', 'effect', 'callback'],
    notificationMethods: ['history/entryAdded', 'history/entryUpdated', 'turn/started', 'turn/completed', 'session/statsUpdated', 'session/compacted', 'session/contextCleared', 'turn/retrying', 'warning', 'error']
  }
};

export function wireFactsFor(version: string): VibeWireFacts | undefined {
  const selected = SELECTABLE_VIBE_VERSIONS.find((candidate) => candidate === version);
  return selected === undefined ? undefined : VIBE_WIRE[selected];
}

export function wireFacts(version: string = SUPPORTED_VIBE): VibeWireFacts {
  const facts = wireFactsFor(version);
  if (facts === undefined) throw new Error(`No wire facts are recorded for Vibe ${version}; this build accepts only ${SUPPORTED_VIBE}.`);
  return facts;
}

export const PINNED_WIRE: VibeWireFacts = wireFacts();

export function wireToolByApprovalName(name: string, facts: VibeWireFacts = PINNED_WIRE): WireTool | undefined {
  return facts.tools.find((tool) => tool.approvalName === name);
}

export function wireToolByConfigName(name: string, facts: VibeWireFacts = PINNED_WIRE): WireTool | undefined {
  return facts.tools.find((tool) => tool.configName === name);
}

export function profileApprovalNames(mode: RunMode, facts: VibeWireFacts = PINNED_WIRE): readonly string[] {
  return facts.profiles[mode].map((configName) => {
    const tool = wireToolByConfigName(configName, facts);
    if (tool === undefined) throw new Error(`Profile tool ${configName} has no approval name in the wire facts for Vibe ${SUPPORTED_VIBE}.`);
    return tool.approvalName;
  });
}
