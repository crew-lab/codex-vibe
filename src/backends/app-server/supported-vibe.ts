import { isStableVersionAtLeast } from '../../core/stable-version.js';

export const MINIMUM_VIBE_VERSION = '3.1.2';
export const SUPPORTED_VIBE = MINIMUM_VIBE_VERSION;
export const VIBE_3_CANDIDATE = MINIMUM_VIBE_VERSION;
export type SelectableVibeVersion = string;

export function isSupportedVibeVersion(value: string, minimum: string = MINIMUM_VIBE_VERSION): boolean {
  return isStableVersionAtLeast(value, minimum);
}

export function selectedVibeVersion(value: string | undefined): string {
  const minimum = value ?? MINIMUM_VIBE_VERSION;
  if (!isSupportedVibeVersion(minimum)) throw new Error(`Unsupported Vibe minimum version ${minimum}; use a stable release at least ${MINIMUM_VIBE_VERSION}.`);
  return minimum;
}
