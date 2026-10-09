---
name: vibe-supervisor
description: Use when a task benefits from delegating a bounded code review or isolated code edit to Vibe through the local Vibe Supervisor MCP tools. Do not use for unrestricted shell execution, deployment, or when workspace boundaries and user review cannot be preserved.
---

# Vibe Supervisor

Delegate a bounded review or edit to Vibe and keep the result reviewable. The supervisor is an application-level policy boundary, not an operating-system sandbox; never claim OS-level isolation.

Do not use it for deployment, credential handling, shell access, or workspaces outside the configured allowed roots. For verification and correction rounds on an edit, use [vibe-acp](../vibe-acp/SKILL.md).

## Before starting

- The canonical workspace path, inside an allowed root. If it is not, tell the user to run `vibe-supervisor allow <dir>` and then restart the Codex MCP server (reconnect for `--isolated`); a running server keeps the allowlist it started with, so `allow` alone does not fix `VSUP_WORKSPACE_INVALID`.
- A concise task with the expected outcome, constraints and, for an edit, the Git base and files that must not change. Never put secrets in the task. Vibe does not inherit project instructions or skills, so put the rules it must follow in the task text.
- For a review, ask for the final answer in this turn: each finding with its file and location, the trigger and the incorrect behavior, or an explicit statement that no defect was found in the inspected scope. Never require a number of findings.
- A real root `.agents` directory is supported without inheriting its content: the pinned launcher disables project discovery and file tools deny reserved paths. A root `.vibe`, a symlink or non-directory `.agents`, a symlinked `.vibeignore`, or a path with glob characters is refused at start with `VSUP_WORKSPACE_INVALID`. Do not delete project configuration or work around a refusal; tell the user.
- For an edit, `cwd` must be the Git repository root; a subdirectory is refused with `VSUP_WORKSPACE_INVALID`. Name files inside the task relative to the repository, not as source-checkout paths: the worker runs in a worktree.
- With `--isolated`, a run belongs to the server connection that started it; keep every call for that `run_id` on the same connection.
- If the tools are missing or a run fails at launch, run `vibe-supervisor doctor --json`; it proves local prerequisites, not hosted authentication.

## Loop

1. Start: `vibe_review_start` for a read-only review, `vibe_edit_start` for a change (`base_ref` defaults to `HEAD`; uncommitted changes are not copied). Pass `wait_seconds` 120 to 300 so the call waits until the run needs action. Limits default from the configuration; set `max_turns` or `timeout_seconds` only when the task needs it.
2. Wait: while the run is not settled, call `vibe_status` with `wait_seconds` 120 to 300 and `after_seq` set to the previous `next_after_seq`. Do not poll turn by turn.
3. Read: a settled `vibe_status` (or start reply) already carries the compact `result`. Call `vibe_result` only for `detail: "full"` or the transcript.
4. Close: call `vibe_close` when finished. Pass `cleanup_worktree: true` only after the patch is verified; if cleanup is refused, keep the worktree and report `worktree_retained_reason`.

Every reply has `next_action`; follow it.

## Check before trusting a result

- `stop_reason`: a `completed` run whose value is not `end_turn` (for example `max_turn_requests`) stopped early and may be partial; for `max_turn_requests` the ACP session's turn budget is spent, so `vibe_continue` needs a larger `max_turns` (it fails with `VSUP_TURN_LIMIT_REACHED` otherwise).
- For reviews, a style preference, an implementation plan or a request to switch to edit mode is not a correctness finding. `completed` with `end_turn` means the turn finished, not that the review is good.
- `warnings`, and for reviews `integrity`: `changed` or `unverified` means the source workspace may have changed during the review, so inspect `changed_paths` first.
- For edits, read the patch (inline, or at `patch_path`) and `changed_files`, not just the summary, then run the checks yourself: Vibe has no shell. The patch is never applied, committed or pushed for you; apply it only when the user authorized it.
- On `failed`, read `error.code` in [errors](../../docs/errors.md). A process failure never authorizes replaying the task or loosening policy.

## References

- [README](../../README.md), [reference](../../docs/reference.md), [security](../../docs/security.md)

## Coordinator scripts

Coordinator scripts for preparing a reviewed baseline and auditing a settled edit run live in the repository's `scripts/` directory (see `scripts/README.md`); they are not part of the package.
