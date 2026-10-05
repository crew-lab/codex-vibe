---
name: vibe-supervisor
description: Use when a task benefits from delegating a bounded code review or isolated code edit to Vibe through the local Vibe Supervisor MCP tools. Do not use for unrestricted shell execution, deployment, or when workspace boundaries and user review cannot be preserved.
---

# Vibe Supervisor

Use the local Vibe Supervisor tools to delegate bounded review and edit work while keeping run state and changes reviewable.

For coding tasks requiring verification and correction rounds, read [vibe-acp](../vibe-acp/SKILL.md) and select the ACP backend explicitly. Keep the session open through review and correction; do not stop at the first failed draft when a safe continuation is available.

## When To Use

Use this skill when the user asks for a Vibe-assisted code review or a self-contained implementation task in an allowed local workspace. Keep the user’s original goal and constraints in the Vibe task description.

Do not use it for production deployment, unrestricted shell access, credential handling, or workspaces outside the configured allowed roots. Vibe Supervisor is an application-level policy boundary, not an operating-system sandbox.

## Inputs To Collect First

- The canonical local workspace path. Confirm it is within a configured allowed root.
- A concise task with expected outcome and relevant constraints.
- Whether the requested work is review-only or may edit files.
- For edits, the base Git reference and any files that must not change.

Do not put secrets, API keys, or private user data in task text. Avoid asking for context files unless they are necessary and safe to persist.

## Procedure

### Step 1 — Check local availability

Use `vibe-supervisor doctor --json` when configuring or diagnosing the local installation. Treat auth and desktop registration as unverified unless an explicit local check establishes them. Do not infer hosted auth from an environment variable.

### Step 2 — Start the narrowest run

For review, call `vibe_review_start` with the workspace path and a read-only task. For changes, call `vibe_edit_start` and specify the intended base reference. Keep task scope limited to the files and behavior needed. Pass `wait_seconds` (120 to 300) so the start call itself waits until the run needs action; if the run finished, the response already holds the compact result.

### Step 3 — Monitor safely

Do not poll turn by turn. While the run is not finished, call `vibe_status` with `wait_seconds` (up to 300) and `after_seq` set to the last event received; it returns on a new event, state change, pending request, or a state that needs you (`completed`, `failed`, `cancelled`, `waiting_permission`, `waiting_input`, `recoverable`). Continue only with actionable instructions that preserve the original scope. Permission and input requests must be answered based on the actual request details; deny unknown, incomplete, or out-of-scope requests.

### Step 4 — Inspect outputs

For a review, report its bounded findings and cite relevant paths. For an edit, call `vibe_result` (compact by default) for the summary, changed-file list, diff stat, and the patch, inline when small or at `patch_path` otherwise. Use `detail: "full"` only when digests or workspace paths are needed. Read the patch before suggesting or performing application to the source checkout. Report test results and any limitations separately.

### Step 5 — Close the run

Call `vibe_close` when the user’s task is complete. Request worktree cleanup only after the exported artifact is verified and no further inspection is needed. If cleanup refuses because the worktree changed or contains unexported files, preserve it and report the reason.

## Completion Checks

- The run used the intended workspace and review/edit mode.
- Results contain no credentials or hidden reasoning.
- Every edit is represented in a reviewable patch and changed-file record.
- The patch and tests were inspected before reporting completion.
- The run was closed or its remaining state and artifacts were clearly reported.

If a run fails, a version is unsupported, an artifact is missing, or a permission request cannot be safely classified, stop unsafe execution and inspect the stable error and recovery options. Verification failures on a usable ACP candidate belong in the [correction loop](../vibe-acp/SKILL.md); a process failure does not authorize replaying the task or weakening policy. Do not claim OS-level isolation.

## References

- [Vibe Supervisor README](../../README.md)
- [Security model](../../docs/security.md)
- [MCP tool reference](../../docs/protocol.md)
- [Release acceptance status](../../docs/acceptance.md)
