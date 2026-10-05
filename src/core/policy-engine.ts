import path from "node:path";
import { realpath } from "node:fs/promises";
import type { PendingRequest, RunMode, SupervisorConfig } from "../contracts.js";
import { isPathWithinRoot } from "../security/paths.js";

export type PermissionPolicyDecision =
  | { kind: "prompt" }
  | { kind: "deny"; reason: string };

/** Deny unsafe or incomplete requests; every remaining permission still requires an explicit user response. */
export class PolicyEngine {
  constructor(private readonly config: SupervisorConfig) {}

  async evaluate(mode: RunMode, workerRoot: string, pending: PendingRequest, allowShellRequested: boolean): Promise<PermissionPolicyDecision> {
    if (pending.kind !== "permission") return { kind: "prompt" };
    const toolKind = normalizeKind(pending.tool?.kind);
    if (!toolKind) return { kind: "deny", reason: "unknown_tool_kind" };
    if (toolKind === "execute") {
      // No kernel sandbox has been certified for the current Vibe release profile.
      if (mode === "review" || !allowShellRequested || !this.config.security.allowShellInEdit) return { kind: "deny", reason: "shell_disabled" };
      return { kind: "deny", reason: "shell_sandbox_unavailable" };
    }
    if (toolKind === "fetch" && !this.config.security.allowNetworkTools) return { kind: "deny", reason: "network_disabled" };
    if (mode === "review" && ["edit", "delete", "move"].includes(toolKind)) return { kind: "deny", reason: "review_is_read_only" };
    if (!["read", "edit", "delete", "move", "fetch"].includes(toolKind)) return { kind: "deny", reason: "unsupported_tool_kind" };
    const locations = collectLocations(pending);
    if (["read", "edit", "delete", "move"].includes(toolKind) && locations.length === 0) return { kind: "deny", reason: "missing_path_scope" };
    for (const location of locations) if (!(await containedPath(workerRoot, location))) return { kind: "deny", reason: "workspace_boundary" };
    return { kind: "prompt" };
  }

  offeredDenyOption(pending: PendingRequest): string | undefined {
    if (pending.kind !== "permission") return undefined;
    return pending.options.find((option) => /reject|deny|decline/i.test(`${option.optionId} ${option.kind ?? ""} ${option.name}`))?.optionId;
  }

  userChoiceAllowed(pending: PendingRequest, optionId: string): boolean {
    if (pending.kind !== "permission") return false;
    if (!pending.options.some((option) => option.optionId === optionId)) return false;
    const decision = normalizeKind(pending.tool?.kind);
    if (!decision || decision === "execute" || (decision === "fetch" && !this.config.security.allowNetworkTools)) return this.offeredDenyOption(pending) === optionId;
    return true;
  }
}

export function normalizeKind(kind: string | undefined): "read" | "edit" | "delete" | "move" | "execute" | "fetch" | undefined {
  if (!kind) return undefined;
  const value = kind.toLowerCase().replace(/[^a-z]/g, "");
  if (["read", "search", "list", "view"].includes(value)) return "read";
  if (["edit", "write", "create", "modify"].includes(value)) return "edit";
  if (["delete", "remove"].includes(value)) return "delete";
  if (["move", "rename"].includes(value)) return "move";
  if (["execute", "shell", "command", "terminal", "run"].includes(value)) return "execute";
  if (["fetch", "network", "web", "http"].includes(value)) return "fetch";
  return undefined;
}

function collectLocations(pending: Extract<PendingRequest, { kind: "permission" }>): string[] {
  const values = [...(pending.tool?.locations ?? [])];
  const visit = (input: unknown, key = ""): void => {
    if (Array.isArray(input)) { for (const item of input) visit(item, key); return; }
    if (!input || typeof input !== "object") {
      if (typeof input === "string" && /^(?:path|file|file_path|target|directory|cwd|workdir)$/i.test(key)) values.push(input);
      return;
    }
    for (const [childKey, child] of Object.entries(input)) visit(child, childKey);
  };
  visit(pending.tool?.rawInput);
  return [...new Set(values)].filter((value) => value.length > 0 && value.length <= 4096);
}

async function containedPath(root: string, input: string): Promise<boolean> {
  if (!input || input.includes("\0")) return false;
  const absolute = path.resolve(root, input);
  let canonical: string;
  try { canonical = await realpath(absolute); }
  catch {
    try { canonical = path.join(await realpath(path.dirname(absolute)), path.basename(absolute)); }
    catch { return false; }
  }
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(root); } catch { return false; }
  return isPathWithinRoot(canonicalRoot, canonical);
}
