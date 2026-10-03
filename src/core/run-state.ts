import type { RunState } from "../contracts.js";

const transitions: Record<RunState, readonly RunState[]> = {
  queued: ["starting", "cancelled", "failed"],
  starting: ["queued", "negotiating", "ready", "running", "waiting_permission", "waiting_input", "completed", "failed", "cancelled", "recoverable", "closing"],
  negotiating: ["ready", "running", "waiting_permission", "waiting_input", "completed", "failed", "cancelled", "recoverable", "closing"],
  ready: ["running", "waiting_permission", "waiting_input", "completed", "failed", "cancelled", "recoverable", "closing"],
  running: ["ready", "waiting_permission", "waiting_input", "completed", "failed", "cancelled", "recoverable", "closing"],
  waiting_permission: ["running", "ready", "waiting_input", "completed", "failed", "cancelled", "recoverable", "closing"],
  waiting_input: ["running", "ready", "waiting_permission", "completed", "failed", "cancelled", "recoverable", "closing"],
  completed: ["starting", "running", "recoverable", "closing", "closed"],
  failed: ["closing", "closed"],
  cancelled: ["closing", "closed"],
  closing: ["closed", "failed"],
  closed: [],
  orphaned: ["recoverable", "starting", "failed", "closed"],
  recoverable: ["starting", "running", "ready", "waiting_permission", "waiting_input", "completed", "failed", "cancelled", "closed"]
};

export function canTransition(from: RunState, to: RunState): boolean { return from === to || transitions[from].includes(to); }

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) throw Object.assign(new Error(`Invalid run state transition ${from} -> ${to}`), { code: "VSUP_INVALID_STATE" });
}

export function isTerminal(state: RunState): boolean { return state === "failed" || state === "cancelled" || state === "closed"; }
