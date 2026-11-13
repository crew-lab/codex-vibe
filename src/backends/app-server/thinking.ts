import type { RunMode } from '../../contracts.js';

export const SESSION_THINKING_LEVELS = ['off', 'high'] as const;
export type SessionThinking = typeof SESSION_THINKING_LEVELS[number];
export const DEFAULT_REVIEW_THINKING: SessionThinking = 'high';
export const EDIT_THINKING: SessionThinking = 'off';

export function sessionThinking(mode: RunMode, reviewThinking: SessionThinking | undefined): SessionThinking {
  return mode === 'review' ? reviewThinking ?? DEFAULT_REVIEW_THINKING : EDIT_THINKING;
}
