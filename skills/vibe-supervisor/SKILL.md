---
name: vibe-supervisor
description: "Use for one bounded Mistral Vibe review or isolated edit through the local Vibe Supervisor MCP tools. Do not use for deployment, credential handling, or automatic patch application."
license: MIT
---

# Vibe Supervisor

The supervisor exposes exactly five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. It accepts only Vibe 3.0.2 through its pinned `vibe-app-server`; the server version and installed files must match the per-candidate pin manifest, and any other version or file drift fails closed. The current Vibe 3.0.2 candidate remains unqualified for hosted dispatch until its target gates pass. Each review or edit start requires a short-lived local dispatch grant created with `vibe-supervisor task authorize` and the grant's unique `attempt_id`; the grant authorizes one exact request and one start. This is not an interactive Vibe permission or continuation protocol. Each owning server/storage instance accepts one active run; a competing start is rejected immediately. A run is one-shot: there are no follow-up prompts or restart recovery. If the supervisor restarts during work, the run is marked failed and its task is never replayed. Completed means execution ended; the coordinator still owns acceptance and cleanup. The Antigravity backend is experimental and opt-in (`experimental.antigravity = true`); use it only when the configuration selects it, and see [security](../../docs/security.md#antigravity-backend-experimental).

Vibe's packaged plugin skills are accepted only when the runtime reports their required plugin provenance; user/project/registry skill entries are refused. Skill instructions never grant extra tool or path permissions. Shell and network tools are disabled. The supervisor's policy is not an OS sandbox. Reviews are read-only (`read_file`) over an allowlisted workspace, with a bounded workspace file listing in the prompt and no search tool; edits can read, write and edit inside the worktree, need a Git repository root and explicit `base_ref`, and run in a detached supervisor-owned worktree. The worker's patch is exported for review and is never applied, committed, merged, or pushed automatically.


## Coordinator, acceptance and fallback

The main chat coordinates and independently verifies. Vibe is the bounded implementer. A fallback implementer is used only after verified artifact rejection and within the user's authorized workflow; do not appoint it coordinator by default. Never infer failure from an abbreviated worker summary. Preserve the original patch/export hashes and inspect deterministic checks first. If the patch is correct, validate it unchanged. A mistaken rejection must be corrected in append-only assessment history, with the review error attributed to the coordinator. Keep Vibe and fallback changes/evidence separate; never claim fallback edits were applied when they were discarded.

The owner's implementation request already authorizes necessary task-scoped installation/switching, no-inference preparation and adding only the named task root while preserving settings and rollback. Do not ask again for these steps. It does not authorize extra hosted starts, broader access, commit/push/merge/deploy or publication. Keep original budgets and no-replay rules. A deterministic preparation failure stops that check: diagnose and repair, then verify the changed artifact. Preparation/infrastructure failure is not implementation rejection and does not automatically trigger fallback.

Before dispatch, freeze an acceptance_contract with exact allowed/required paths, required text/hash assertions and coordinator validation IDs. For an edit, also pass `allowed_write_paths` naming the files or `dir/` prefixes the worker may write, so the handler refuses writes elsewhere during the run. Require version-matched preparation PASS via `prepare check --kit ... --config ...`; inspect workspace_eligible, preparation, candidate and optional expected_candidate on the native connection. These checks are separate from hosted acceptance. Use `validation prepare` for owned baseline/candidate copies and explicit offline dependency preparation; blockers do not authorize scripts or network fetches.

After the bounded run, compare exported bytes and hashes, then run the declared coordinator checks. Record execution outcome, automated verification and coordinator decision separately. `vibe_close` assessments bind patch/contract hashes and coordinator validation results; accepted requires automated PASS plus all required validations. Preserve failed/incomplete evidence. Use `runs export --out ...` for sanitized reporting, with optional patch/projected events only. Never collect raw transcripts, reasoning, credentials or private receipt histories for reports. New hosted attempts require remaining explicit allowance; no summary-driven rejection or blind retry. See [acceptance](../../docs/workflow-acceptance.md), [preparation](../../docs/preparation.md) and [validation workspaces](../../docs/validation-workspace.md).

## Prepare before connecting

1. Select the intended installed artifact and configuration. If the explicit config does not exist, initialize it first with `vibe-supervisor allow --config <selected-config> <canonical-workspace>`; this creates a private config and adds only that workspace. Then use the same config for doctor and serve. An explicitly selected missing or invalid file on doctor/serve must fail with its path; do not fall back to another home configuration. The default data root is `~/Library/Application Support/VibeSupervisor-oneshot` on macOS, `%APPDATA%/VibeSupervisor-oneshot` on Windows, or `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` on Linux. `VIBE_SUPERVISOR_HOME` is an explicit override.
2. Run `vibe-supervisor doctor --config <selected-config> --json`. This checks local prerequisites and pinned Vibe compatibility, not provider authentication or hosted inference. Keep the reported selected config and data path as separate facts.
3. Choose a clean reviewed Git base: select its existing immutable commit and pass it as `base_ref`; preserve unrelated uncommitted changes. The supervisor never uses uncommitted source bytes as an edit base.
4. For Codex, use the default isolated setup registration; an existing registration needs `--isolated` and reconnection to prevent other chats from competing for its storage lock. This does not change allowed roots. Connect to the selected server; the readiness call below identifies it by `server_version` and proves the tools are callable, with or without a protocol handshake. A CLI version or doctor result does not establish the identity of an already-open desktop connection. Authentication is observed only during a real run.

## Check readiness on the connection

Every delegation starts with a native workspace readiness call on the connection that will run it: `vibe_status` with `workspace` (absolute canonical path), `operation` (`review` or `edit`) and, for an edit, `base_ref`. It starts nothing and costs no inference. Read `server_version`, `server_instance_id`, `policy_path`, `policy_revision`, `restart_required`, `eligible` and `blockers`; `supervisor_version` in run output describes a saved run, not this server.

- If the Vibe tools are absent from the connected catalog, or the call cannot reach the server, classify the attempt as CONNECTION_FAILED.
- If `eligible` is false, classify it as PREPARATION_FAILED and report each blocker's code and remediation. An allowlist approval in the selected config is seen on the next check without a restart; `VSUP_RESTART_REQUIRED` needs a deliberate server restart or reverting the boot-bound setting.
- Neither is a Vibe run result, a failed inference run or a successful Vibe test. Route it to repair, and do not silently fall back to another implementer. Handing the work to another implementer despite an infrastructure failure is an explicit, separately reported decision that leaves the Vibe test blocked.
- When `eligible` is true, pass its `readiness_receipt` to the matching start before `receipt_expires_at`. A receipt rejection (`VSUP_READINESS_RECEIPT_INVALID`) created no run: check readiness again rather than retrying the start blindly. A receipt is not authorization for the task and does not prove provider authentication.

## Run one bounded task

Collect the desired outcome, concrete acceptance criteria, canonical allowed workspace, exact file scope, exclusions, and explicit Git base for edits. Never put credentials in task text. Check the real connected tool schemas and do not invoke fields or tools absent from that catalog. Read `supervisor_runtime.executable` from readiness. After readiness passes, create a private one-start grant from the exact request with `vibe-supervisor task authorize --runtime-node <that-absolute-executable>`; pass its returned `authorization_id` and `attempt_id` with the same request to the matching start tool. The readiness receipt is admission evidence and does not replace this task authorization. One started run owns the instance's active slot until backend close verifies termination. If close reports termination unverified, keep the run inspectable and do not start another run on that slot. Do not queue, retry automatically, or replay a task after restart or failure.

Files matched by the root's `excluded_globs` or the fixed secret denylist are refused to the worker; leave them out of the file scope. A root with a daily budget refuses a start with `VSUP_BUDGET_EXCEEDED` once its 24-hour spending reaches the ceiling; do not move the task to another root to get around it.

Start one review or edit with bounded turns, deadline, output limits, wait, and the readiness receipt. Use cursor-based `vibe_status` calls on the same connection, then read `vibe_result`. Do not raise limits or rotate accounts after a failure. Write the task text from a template below.

## Write the task from a template

A completed run is not a useful answer. The tasks that produced accepted answers on the target were narrow and checkable; the one real-project review ran safely but its answer was not accepted. Fill one in: replace each `<...>` and keep every line.

Review:

```text
Read only <file>, <file>[, <file>]. Do not open other files.
Question: <one question, e.g. whether parseLimit(value) rejects negative input as CONTRACT.md requires>.
Evaluate these inputs or paths: <input>, <input>, <input>.
For each finding give the file, the function or line, the input that triggers it, and the wrong behaviour against the stated requirement.
"No defect found in the inspected scope" is a valid answer; do not invent a finding.
No style advice, refactors or recommendations outside the question. No scratch files.
Final answer: the conclusion first, then the findings, under <n> lines.
```

Edit:

```text
Read <file>, <file> first.
Then create or change only: <path>, <path>. Do not touch any other file.
Change: <what to add or change, with the exact function names and semantics>.
Must reject or preserve: <each edge case, e.g. a trailing blank line, CRLF, an unsafe path>.
Tests: <test file> using <framework>, covering <cases>.
No shell, network or test execution.
Final answer: what changed, then an inventory of changed and scratch files.
```

Match the limits to the template: a review of two or three files fits `max_turns` 12; raise turns only with the number of files to read. Record whether the answer was accepted, so the template can be improved; `vibe-supervisor runs usefulness` summarizes the recorded assessments.

## Check the result

For a review, check the final answer, stop reason, warnings, integrity result and `usage.tool_calls` (a review that read nothing answered from nothing); `vibe-supervisor runs sarif <run-id>` exports its findings as SARIF. For an edit, inspect the full transcript and fresh exported patch, changed and residual files, and hashes while the worktree remains available. Verify the exact candidate in a separate disposable copy; do not run commands or tests inside the worker worktree or original source checkout. Accept only the reviewed delta. Coordinator verification does not turn an unsuccessful Vibe run into a Vibe success.

Close the run after verification. Request cleanup only when the exported artifact is current. A pristine worktree can be removed after ownership checks; a dirty or uncertain one is retained with its path and reason for review. Keep the exported patch available and do not force-delete retained data. Report the server version, source/base, actual checks, stop reason, authentication outcome if observed, and any unresolved cleanup or acceptance gate. macOS Apple silicon is the supported platform; a clean-account installation is not yet verified. A run proves execution, not that the answer is correct.

## References

- [Tool and configuration reference](../../docs/reference.md)
- [Behavior](../../docs/functionality.md)
- [Security](../../docs/security.md)
- [Compatibility and unverified gates](../../docs/compatibility.md)
- [Errors](../../docs/errors.md)
- [Agent Skills specification](https://agentskills.io/specification)
