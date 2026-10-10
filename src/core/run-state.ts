import type { RunState } from "../contracts.js";

const transitions: Record<RunState, readonly RunState[]> = {
  starting: ["running", "completed", "failed", "cancelled", "closing"],
  running: ["completed", "failed", "cancelled", "closing"],
  completed: ["closing", "closed"],
  failed: ["closing", "closed"],
  cancelled: ["closing", "closed"],
  closing: ["closed", "failed"],
  closed: []
};

export function canTransition(from: RunState, to: RunState): boolean { return from === to || transitions[from].includes(to); }

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) throw Object.assign(new Error(`Invalid run state transition ${from} -> ${to}`), { code: "VSUP_INVALID_STATE" });
}

export function isTerminal(state: RunState): boolean { return state === "failed" || state === "cancelled" || state === "closed"; }
