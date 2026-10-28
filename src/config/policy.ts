import { configFingerprint, loadConfig } from "./config.js";
import { SUPPORTED_VIBE } from "../backends/app-server/supported-vibe.js";
import type { SupervisorConfig } from "../contracts.js";
import { inspectWorkspaceRoots } from "../security/paths.js";
import type { UnavailableWorkspaceRoot } from "../security/paths.js";

export interface PolicySource {
  readonly configPath: string | null;
  read(): Promise<SupervisorConfig>;
}

export interface CurrentPolicy {
  config: SupervisorConfig;
  revision: string;
  bootDrift: string[];
  unavailableRoots: UnavailableWorkspaceRoot[];
}

export function selectedConfigPolicy(configPath: string): PolicySource {
  return { configPath, read: () => loadConfig({ configPath }) };
}

export function fixedPolicy(config: SupervisorConfig): PolicySource {
  return { configPath: null, read: async () => config };
}

const BOOT_BOUND_SETTINGS: ReadonlyArray<readonly [string, (config: SupervisorConfig) => unknown]> = [
  ["version", (config) => config.version],
  ["vibe_version", (config) => config.vibeVersion ?? SUPPORTED_VIBE],
  ["retention.days", (config) => config.retention.days],
  ["limits.review_timeout_seconds", (config) => config.limits.reviewTimeoutSeconds],
  ["limits.edit_timeout_seconds", (config) => config.limits.editTimeoutSeconds],
  ["limits.max_turns_review", (config) => config.limits.maxTurnsReview],
  ["limits.max_turns_edit", (config) => config.limits.maxTurnsEdit],
  ["limits.max_event_bytes", (config) => config.limits.maxEventBytes],
  ["limits.max_transcript_bytes", (config) => config.limits.maxTranscriptBytes],
  ["limits.max_artifact_bytes", (config) => config.limits.maxArtifactBytes],
  ["limits.worker_progress_timeout_seconds", (config) => config.limits.workerProgressTimeoutSeconds],
  ["limits.max_mcp_result_chars", (config) => config.limits.maxMcpResultChars],
  ["limits.max_tokens", (config) => config.limits.maxTokens ?? null],
  ["limits.max_cost_usd", (config) => config.limits.maxCostUsd ?? null],
  ["paths.vibe", (config) => config.paths?.vibe ?? null],
  ["paths.app_server", (config) => config.paths?.appServer ?? null],
  ["paths.vibe_pin_manifest", (config) => config.paths?.vibePinManifest ?? null],
  ["backend", (config) => config.backend ?? "app-server"],
  ["paths.antigravity", (config) => config.paths?.antigravity ?? null],
  ["experimental.antigravity", (config) => config.experimental?.antigravity ?? false],
  ["experimental.antigravity_skip_permissions", (config) => config.experimental?.antigravitySkipPermissions ?? false],
];

export function bootBoundDrift(boot: SupervisorConfig, current: SupervisorConfig): string[] {
  return BOOT_BOUND_SETTINGS.filter(([, value]) => value(boot) !== value(current)).map(([key]) => key);
}

export async function readCurrentPolicy(source: PolicySource, boot: SupervisorConfig): Promise<CurrentPolicy> {
  const config = await source.read();
  const { unavailable } = await inspectWorkspaceRoots(config.allowedWorkspaceRoots);
  return { config, revision: configFingerprint(config), bootDrift: bootBoundDrift(boot, config), unavailableRoots: unavailable };
}
