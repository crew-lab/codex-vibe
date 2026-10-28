import { PINNED_WIRE } from './vibe-wire.js';

export const BUNDLED_SKILL_NAMES: readonly string[] = PINNED_WIRE.bundledSkills.names;
export const BUNDLED_SKILL_PROVENANCE = PINNED_WIRE.bundledSkills.provenance;

export function onlyBundledSkills(value: readonly unknown[]): boolean {
  const seen = new Set<string>();
  return value.every((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const skill = entry as Record<string, unknown>;
    if (typeof skill.name !== 'string' || !BUNDLED_SKILL_NAMES.includes(skill.name) || seen.has(skill.name)) return false;
    seen.add(skill.name);
    return skill.source === BUNDLED_SKILL_PROVENANCE.source && skill.scope === BUNDLED_SKILL_PROVENANCE.scope && skill.registry === BUNDLED_SKILL_PROVENANCE.registry;
  });
}
