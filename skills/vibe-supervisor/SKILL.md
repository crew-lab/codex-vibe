---
name: vibe-supervisor
description: "Use for one bounded Mistral Vibe review or isolated edit through the local Vibe Supervisor MCP tools. Do not use for deployment, credential handling, or automatic patch application."
license: MIT
---

# Vibe Supervisor

The supervisor exposes five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. It runs exactly Vibe 2.26.1 through its pinned `vibe-app-server`, verified against a pin manifest before each run; other versions and any file drift fail closed. Each owning server/storage instance accepts one active run; a competing start is rejected immediately. A run is one-shot: there are no interactive permission grants, follow-up prompts, or restart recovery. If the supervisor restarts during work, the run is marked failed and its task is never replayed. Completed means execution ended; the coordinator still owns acceptance and cleanup.

Shell and network tools are disabled. The supervisor's policy is not an OS sandbox. Reviews are read-only (`read_file`) over an allowlisted workspace, with a bounded workspace file listing in the prompt and no search tool; edits can read, write and edit inside the worktree, need a Git repository root and explicit `base_ref`, and run in a detached supervisor-owned worktree. The worker's patch is exported for review and is never applied, committed, merged, or pushed automatically.

## Prepare before connecting

1. Select the intended installed artifact and configuration. If the explicit config does not exist, initialize it first with `vibe-supervisor allow --config <selected-config> <canonical-workspace>`; this creates a private config and adds only that workspace. Then use the same config for doctor and serve. An explicitly selected missing or invalid file on doctor/serve must fail with its path; do not fall back to another home configuration. The default data root is `~/Library/Application Support/VibeSupervisor-oneshot` on macOS, `%APPDATA%/VibeSupervisor-oneshot` on Windows, or `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` on Linux. `VIBE_SUPERVISOR_HOME` is an explicit override.
2. Run `vibe-supervisor doctor --config <selected-config> --json`. This checks local prerequisites and pinned Vibe compatibility, not provider authentication or hosted inference. Keep the reported selected config and data path as separate facts.
3. Choose a clean reviewed Git base: commit or stash the reviewed state, then pass its ref as `base_ref`. The supervisor never uses uncommitted source bytes as an edit base.
4. For Codex, use the default isolated setup registration; an existing registration needs `--isolated` and reconnection to prevent other chats from competing for its storage lock. This does not change allowed roots. Connect to the selected server; the readiness call below identifies it by `server_version` and proves the tools are callable, with or without a protocol handshake. A CLI version or doctor result does not establish the identity of an already-open desktop connection. Authentication is observed only during a real run.

## Check readiness on the connection

Every delegation starts with a native workspace readiness call on the connection that will run it: `vibe_status` with `workspace` (absolute canonical path), `operation` (`review` or `edit`) and, for an edit, `base_ref`. It starts nothing and costs no inference. Read `server_version`, `server_instance_id`, `policy_path`, `policy_revision`, `restart_required`, `eligible` and `blockers`; `supervisor_version` in run output describes a saved run, not this server.

- If the Vibe tools are absent from the connected catalog, or the call cannot reach the server, classify the attempt as CONNECTION_FAILED.
- If `eligible` is false, classify it as PREPARATION_FAILED and report each blocker's code and remediation. An allowlist approval in the selected config is seen on the next check without a restart; `VSUP_RESTART_REQUIRED` needs a deliberate server restart or reverting the boot-bound setting.
- Neither is a Vibe run result, a failed inference run or a successful Vibe test. Route it to repair, and do not silently fall back to another implementer. Handing the work to another implementer despite an infrastructure failure is an explicit, separately reported decision that leaves the Vibe test blocked.
- When `eligible` is true, pass its `readiness_receipt` to the matching start before `receipt_expires_at`. A receipt rejection (`VSUP_READINESS_RECEIPT_INVALID`) created no run: check readiness again rather than retrying the start blindly. A receipt is not authorization for the task and does not prove provider authentication.

## Run one bounded task

Collect the desired outcome, concrete acceptance criteria, canonical allowed workspace, exact file scope, exclusions, and explicit Git base for edits. Never put credentials in task text. Check the real connected tool schemas and do not invoke fields or tools absent from that catalog. One started run owns the instance's active slot until backend close verifies termination. If close reports termination unverified, keep the run inspectable and do not start another run on that slot. Do not queue, retry automatically, or replay a task after restart or failure.

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

Match the limits to the template: a review of two or three files fits `max_turns` 12; raise turns only with the number of files to read. Record whether the answer was accepted, so the template can be improved.

## Check the result

For a review, check the final answer, stop reason, warnings, and integrity result. For an edit, inspect the full transcript and fresh exported patch, changed and residual files, and hashes while the worktree remains available. Verify the exact candidate in a separate disposable copy; do not run commands or tests inside the worker worktree or original source checkout. Accept only the reviewed delta. Coordinator verification does not turn an unsuccessful Vibe run into a Vibe success.

Close the run after verification. Request cleanup only when the exported artifact is current. A pristine worktree can be removed after ownership checks; a dirty or uncertain one is retained with its path and reason for review. Keep the exported patch available and do not force-delete retained data. Report the server version, source/base, actual checks, stop reason, authentication outcome if observed, and any unresolved cleanup or acceptance gate. macOS Apple silicon is the supported platform; a clean-account installation is not yet verified. A run proves execution, not that the answer is correct.

## References

- [Tool and configuration reference](../../docs/reference.md)
- [Behavior](../../docs/functionality.md)
- [Security](../../docs/security.md)
- [Compatibility and unverified gates](../../docs/compatibility.md)
- [Errors](../../docs/errors.md)
- [Agent Skills specification](https://agentskills.io/specification)
