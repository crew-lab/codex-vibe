// Exact packaged plugin skill catalogue audited in the pinned Vibe 2.26.1.
// Names alone are insufficient: a project/global/registry entry must not be
// accepted merely because it uses a bundled name. Installed bytes remain
// subject to the existing per-start distribution pin check.
export const BUNDLED_SKILL_NAMES: readonly string[] = [
  'vibe:create-plugin', 'vibe:skill-creator', 'vibe:vibe', 'vibe:worktree'
];

export function onlyBundledSkills(value: readonly unknown[]): boolean {
  const seen = new Set<string>();
  return value.every((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const skill = entry as Record<string, unknown>;
    if (typeof skill.name !== 'string' || !BUNDLED_SKILL_NAMES.includes(skill.name) || seen.has(skill.name)) return false;
    seen.add(skill.name);
    return skill.source === 'plugin' && skill.scope === 'builtin' && skill.registry === null;
  });
}
