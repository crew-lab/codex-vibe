export const DEFAULT_VIBE_MODEL = 'mistral-medium-3.5';
export const VIBE_MODEL_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

export function sessionModel(configured: string | undefined): string {
  return configured ?? DEFAULT_VIBE_MODEL;
}
