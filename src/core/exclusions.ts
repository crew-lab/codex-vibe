import { lstat } from "node:fs/promises";
import path from "node:path";
import { MAX_RUN_EXCLUDED_GLOBS, supervisorError, type ExclusionScope, type SupervisorConfig, type SupervisorErrorCode } from "../contracts.js";
import { createExcludedMatcher, relativeSegments, workspaceAnchors } from "../security/globs.js";
import { expandHome, isPathWithinRoot, resolveCanonicalWorkspaceRoot } from "../security/paths.js";

function coded(code: SupervisorErrorCode, message: string, details: Record<string, unknown>): Error {
  return Object.assign(new Error(message), supervisorError(code, message, details));
}

async function rootIsMissing(root: string, home: string | undefined): Promise<boolean> {
  const expanded = path.resolve(expandHome(root, home ?? process.env.HOME ?? ""));
  try {
    await lstat(expanded);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}

export async function exclusionScopesForWorkspace(config: SupervisorConfig, workspace: string, home?: string): Promise<ExclusionScope[]> {
  const merged = new Map<string, string[]>();
  for (const [root, globs] of Object.entries(config.excludedGlobs ?? {})) {
    if (globs.length === 0) continue;
    let canonical: string;
    try { canonical = await resolveCanonicalWorkspaceRoot(root, home); }
    catch (error) {
      if (await rootIsMissing(root, home)) continue;
      const reason = error instanceof Error ? error.message : String(error);
      throw coded("VSUP_CONFIG_INVALID", `The allowed root ${root} has excluded_globs but could not be resolved (${reason}); no run is started, because its exclusions could not be applied. Make the root a canonical real directory or remove it and its excluded_globs entry from the selected config.`, { excluded_root: root });
    }
    if (!isPathWithinRoot(canonical, workspace)) continue;
    merged.set(canonical, [...new Set([...(merged.get(canonical) ?? []), ...globs])]);
  }
  const scopes = [...merged].map(([root, globs]) => ({ root, globs }));
  const total = scopes.reduce((count, scope) => count + scope.globs.length, 0);
  if (total > MAX_RUN_EXCLUDED_GLOBS) {
    throw coded("VSUP_CONFIG_INVALID", `The allowed roots that contain ${workspace} contribute ${total} excluded_globs, more than the ${MAX_RUN_EXCLUDED_GLOBS} one run can apply; no run is started. Merge or remove globs under ${scopes.map((scope) => scope.root).join(", ")} in the selected config.`, { excluded_glob_count: total, limit: MAX_RUN_EXCLUDED_GLOBS });
  }
  return scopes;
}

export function excludedWithinWorkspace(scopes: readonly ExclusionScope[], workspace: string, candidates: readonly string[]): boolean {
  const matches = createExcludedMatcher(workspaceAnchors(scopes, workspace));
  return candidates.some((candidate) => {
    const relative = path.relative(workspace, candidate);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    return matches(relativeSegments(relative));
  });
}
