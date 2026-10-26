export const SUPPORTED_VIBE = '3.0.2';
export const VIBE_3_CANDIDATE = SUPPORTED_VIBE;
export const SELECTABLE_VIBE_VERSIONS = [SUPPORTED_VIBE] as const;
export type SelectableVibeVersion = typeof SELECTABLE_VIBE_VERSIONS[number];

export function selectedVibeVersion(value: string | undefined): SelectableVibeVersion {
  if (value === undefined) return SUPPORTED_VIBE;
  const selected = SELECTABLE_VIBE_VERSIONS.find((version) => version === value);
  if (selected === undefined) throw new Error(`Unsupported Vibe version ${value}; this build accepts only ${SUPPORTED_VIBE}.`);
  return selected;
}
