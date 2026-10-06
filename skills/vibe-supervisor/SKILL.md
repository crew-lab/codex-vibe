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

Discover all eight supervisor tools in the actual root client; independently connected subagents need their own visibility check. Keep configuration, live connection, workspace permission, hosted inference, model identity, and task acceptance as separate evidence. `doctor`, ACP initialization, `tools/list`, and a successful `vibe_status` response do not establish hosted inference or review quality. Never claim an unreported model identity.

Current rc.4 supports `configure-codex --user --isolated` and `serve --stdio --isolated`. Each independent server gets a persistent private configuration snapshot and owner lock. Save the owning connection, run ID, private home and artifacts together; keep every run call on that connection. New connections do not automatically recover another home's run. Reconnect after allowlist/template changes. Do not remove a live owner lock or kill another server. Read [current setup and failure handling](references/current-setup.md) for diagnosis, configuration and workspace restrictions.

### Step 2 — Start the narrowest run

For review, call `vibe_review_start` with the workspace path and a read-only task; explicitly choose `backend: "programmatic"` for a bounded single-pass review. Ask for a final answer in this turn, not a plan or mode switch. Require each correctness finding to identify its file/location, concrete trigger and incorrect behavior supported by inspected evidence. Exclude naming, directory placement, barrel exports and other style suggestions unless requested. Permit “No correctness defects found in the inspected scope”; never require an invented finding count. Label conditional findings and scope limitations; do not infer build/runtime behavior from files that were not inspected or tested.

For changes, call `vibe_edit_start` and specify the intended base reference. Use explicit `backend: "acp"` when continuation is needed, otherwise `"programmatic"`. Edits start from the selected Git base; uncommitted source changes are not copied. Keep task scope limited to the files and behavior needed, with `allow_shell: false` and explicit turn/deadline bounds. Pass `wait_seconds` (120 to 300) so the start call itself waits until the run needs action; if the run finished, the response already holds the compact result.

Give the worker the coordinator's applicable project constraints and cleanup rules as task instructions; project extensions are not inherited. Ask it to track scratch files/plans it creates and report their exact paths, ownership and dispositions. It may clean only disposable files it created inside its own edit worktree using available permitted tools; review mode must not mutate the workspace. Worktree removal and process/private-runtime cleanup remain supervisor/coordinator operations.

### Step 3 — Monitor safely

Do not poll turn by turn. While the run is not finished, call `vibe_status` with `wait_seconds` (up to 300) and `after_seq` set to the last event received; it returns on a new event, state change, pending request, or a state that needs you (`completed`, `failed`, `cancelled`, `waiting_permission`, `waiting_input`, `recoverable`). Continue only with actionable instructions that preserve the original scope. Permission and input requests must be answered based on the actual request details; deny unknown, incomplete, or out-of-scope requests.

### Step 4 — Inspect outputs

Call `vibe_result` for the actual response, warnings, integrity, state and stop reason. `completed` and `end_turn` establish turn completion, not satisfactory findings or accepted code. For reviews, reject unsupported or purely stylistic findings; a plan requesting an edit-mode switch is not a completed read-only review. Report evidence-backed findings and scope limits. If the workspace changed, inspect integrity evidence before trusting the review.

For an edit, inspect the changed-file list, diff stat and patch, inline when small or at `patch_path` otherwise. Use `detail: "full"` only when digests or workspace paths are needed. Read the patch before suggesting or performing application to the source checkout. Shell/network tools are disabled for Vibe; the coordinator performs tests and official-documentation research. Report checks actually executed and limitations separately.

### Step 5 — Close the run

Before closing a usable owned ACP edit session, ask Vibe to finish the task's bounded cleanup of its own scratch files and to report remaining disposables, following the local cleanup rules supplied by the coordinator. Fetch fresh artifacts and verify its report; use the [ACP cleanup procedure](../vibe-acp/SKILL.md#step-6--accept-integrate-within-scope-and-close). Programmatic runs cannot receive a cleanup continuation, so include self-cleanup/reporting in their initial task. Do not create a fresh edit run against an old worktree merely to clean it.

Call `vibe_close` when the user’s task is complete. Request worktree cleanup only after the exported artifact is verified, verifier-created residuals are accounted for and no further inspection is needed. If cleanup refuses because the worktree changed or contains unexported files, preserve it and report the reason. Keep useful results/private homes for deliberate recovery; never delete all isolated session directories as incidental cleanup. Explicit `/ent` delegates final thread-owned resource accounting to [ent](../ent/SKILL.md), if that skill is present; do not invoke it just because a run ended.

## Completion Checks

- [ ] The run used the intended workspace, owning connection, backend and review/edit mode.
- [ ] Results contain no credentials or hidden reasoning; model identity is evidence-based or unverified.
- [ ] Reviews give concrete supported findings or an explicit no-defect result, not style substitutes or plans.
- [ ] Every edit is represented in a reviewable patch and changed-file record.
- [ ] The current patch and relevant checks were inspected before reporting completion.
- [ ] Worker/coordinator disposable resources were accounted for; closure and retained artifacts were reported.

If a run fails, a version is unsupported, an artifact is missing, or a permission request cannot be safely classified, stop unsafe execution and inspect the stable error and recovery options. Verification failures on a usable ACP candidate belong in the [correction loop](../vibe-acp/SKILL.md); a process failure does not authorize replaying the task or weakening policy. Do not claim OS-level isolation.

## References

- [Current rc.4 setup and observed limitations](references/current-setup.md)
- [Vibe Supervisor README](../../README.md)
- [Security model](../../docs/security.md)
- [MCP tool reference](../../docs/protocol.md)
- [Release acceptance status](../../docs/acceptance.md)
