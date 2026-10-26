import type { EditStartToolInput, ReviewStartToolInput, WaitOptions } from "../../src/contracts.js";
import { RunManager } from "../../src/core/run-manager.js";

type DispatchMode = "review" | "edit";
type DispatchInput = Omit<ReviewStartToolInput | EditStartToolInput, "authorization_id" | "attempt_id">;

async function authorizedStart<T extends DispatchMode>(manager: RunManager, mode: T, input: T extends "review" ? Omit<ReviewStartToolInput, "authorization_id" | "attempt_id"> : Omit<EditStartToolInput, "authorization_id" | "attempt_id">, wait?: WaitOptions) {
  const grant = await manager.authorizeDispatch(mode, input as DispatchInput, "codex-vibe-test-owner", new Date(Date.now() + 60 * 60 * 1000).toISOString());
  const authorizedInput = { ...input, authorization_id: grant.authorization_id, attempt_id: grant.attempt_id };
  return mode === "review"
    ? manager.reviewStart(authorizedInput as ReviewStartToolInput, wait)
    : manager.editStart(authorizedInput as EditStartToolInput, wait);
}

export function authorizedReviewStart(manager: RunManager, input: Omit<ReviewStartToolInput, "authorization_id" | "attempt_id">, wait?: WaitOptions) {
  return authorizedStart(manager, "review", input, wait);
}

export function authorizedEditStart(manager: RunManager, input: Omit<EditStartToolInput, "authorization_id" | "attempt_id">, wait?: WaitOptions) {
  return authorizedStart(manager, "edit", input, wait);
}
