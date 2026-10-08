---
name: vibe-acp
description: "Use when delegating coding tasks to Mistral Vibe through the Vibe Supervisor ACP backend, verifying worker patches, sending correction requests, or continuing an existing ACP run. Covers the delegate-review-test-correct loop and safe session recovery. Do not use for generic ACP clients, unrestricted Vibe CLI execution, credential extraction, or automatic patch application."
license: MIT
---

# Vibe ACP

Operate Vibe as an implementation worker. The coordinating agent owns scope, independent verification, correction requests and the final assessment. A completed prompt turn is a candidate result, not acceptance.

Start, wait, read and close follow the [vibe-supervisor](../vibe-supervisor/SKILL.md) loop; this skill adds only the correction loop. It needs `backend = "acp"` or `"auto"` in the supervisor config, which is what registers `vibe_continue` and `vibe_respond`. If they are absent, tell the user to change the config and restart Codex; do not substitute a backend, enable trust or loosen permissions. Do NOT use it for deployments, credential extraction, or work outside the allowed roots.

## Inputs to collect first

1. The outcome, acceptance criteria, canonical workspace and Git base.
2. File ownership, excluded files and changes to preserve.
3. The checks you will run yourself, and the budget: reassess after three correction rounds unless the user set one.
4. For continued work, the `run_id` and its artifacts. Distinguish the source checkout from the worker worktree.

## Assign the task

Tell Vibe that it shares the codebase, must preserve other changes, cannot run shell checks and cannot commit, merge, push or apply its patch. Ask it to list any scratch files or plans it creates and to remove only those, inside its own worktree, before it finishes; it must keep the deliverables. Name the checks you will run and do not accept fabricated execution claims. Use the [templates](references/verification-loop.md#prompt-templates). Pass `wait_seconds` on the start call.

## Answer requests

On `waiting_permission` or `waiting_input`, read `pending_request` and answer with `vibe_respond` using the matching `request_id` and an offered `option_id` (or an elicitation `action`). Deny unknown, incomplete, stale, sensitive, out-of-root, shell or network requests; never grant blanket approval to unblock work. Missing user decisions stay pending. Do not send concurrent prompts.

## Verify, then correct

1. Read the compact `result` and the full patch. Check `stop_reason` and `warnings` first.
2. Run the relevant checks against the exact candidate in the worker worktree or a disposable checkout, and account for new files and the base. Use canonical private temporary paths; do not weaken a symlink check to fit a bad fixture.
3. If checks fail, send a focused correction instead of reporting the first draft: the failing command with a short sanitized excerpt, the defect and expected behavior, the paths, and a regression criterion. Batch related findings; never send a vague "try again".
4. Call `vibe_continue` with the same `run_id` and a `message`, only for a run in `completed`, `ready` or `recoverable` state. Do not close the run between rounds; a failed or cancelled run is not eligible, and the programmatic backend has no continuation.
5. After each correction, fetch fresh artifacts and repeat the review and affected checks; earlier patches and results are stale.

## Recovery

On `VSUP_INVALID_STATE`, `VSUP_SESSION_NOT_RESUMABLE`, `VSUP_REQUEST_EXPIRED` or a process failure, inspect the status and saved artifacts before choosing an action ([errors](../../docs/errors.md)). A `recoverable` run reloads its saved session on `vibe_continue` and needs a free run slot. Never replay an uncertain task, restore pending grants or use saved PIDs as kill authority. A new run needs a deliberate base and a plan to preserve reviewed changes, since restarting from `HEAD` loses the candidate. If no safe recovery exists, keep the artifacts and report the blocker.

## Accept and close

Accept only when the final patch meets the outcome, the checks pass and the limitations are stated. Delegation alone does not authorize applying a patch, committing, merging or pushing. Before closing, check the final patch for scratch files the worker left; if any remain and the session is usable, send one short `vibe_continue` naming the exact paths to remove, then fetch fresh artifacts. Do not start a new run just to clean an old worktree; worktree, process and private-storage cleanup belong to the supervisor and to you. Close with `vibe_close`; request `cleanup_worktree: true` only after a fresh export matches the final worktree. Report the outcome, what was applied or retained, the checks actually run and what is unresolved, distinguishing "worker produced a patch" from "verified implementation delivered".

## References

- [Verification loop and templates](references/verification-loop.md)
- [How it works](../../docs/functionality.md), [reference](../../docs/reference.md), [security](../../docs/security.md), [compatibility](../../docs/compatibility.md)
- [ACP v1 prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn), [session loading](https://agentclientprotocol.com/protocol/v1/session-setup), [tool calls and permissions](https://agentclientprotocol.com/protocol/v1/tool-calls)
