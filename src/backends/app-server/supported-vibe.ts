export const MINIMUM_VIBE_VERSION = '3.0.2';
export const SUPPORTED_VIBE = MINIMUM_VIBE_VERSION;
export const VIBE_3_CANDIDATE = MINIMUM_VIBE_VERSION;
export type SelectableVibeVersion = string;

function versionParts(value: string): bigint[] | undefined {
  return value.length <= 64 && value.trim() === value && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split('.').map((part) => BigInt(part)) : undefined;
}

export function isSupportedVibeVersion(value: string, minimum: string = MINIMUM_VIBE_VERSION): boolean {
  const actual = versionParts(value);
  const floor = versionParts(minimum);
  if (!actual || !floor) return false;
  for (let index = 0; index < 3; index++) {
    if (actual[index]! > floor[index]!) return true;
    if (actual[index]! < floor[index]!) return false;
  }
  return true;
}

export function selectedVibeVersion(value: string | undefined): string {
  const minimum = value ?? MINIMUM_VIBE_VERSION;
  if (!isSupportedVibeVersion(minimum)) throw new Error(`Unsupported Vibe minimum version ${minimum}; use a stable release at least ${MINIMUM_VIBE_VERSION}.`);
  return minimum;
}
