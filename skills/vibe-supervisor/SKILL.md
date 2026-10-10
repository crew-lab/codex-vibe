---
name: vibe-supervisor
description: "Use for one bounded Mistral Vibe review or isolated edit through the local Vibe Supervisor MCP tools. Do not use for deployment, credential handling, or automatic patch application."
license: MIT
---

# Vibe Supervisor

The supervisor exposes five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. It runs exactly Vibe 2.26.1 through the validated legacy programmatic harness; other versions fail closed. Each owning server/storage instance accepts one active run; a competing start is rejected immediately. A run is one-shot: there are no interactive permission grants, follow-up prompts, or restart recovery. If the supervisor restarts during work, the run is marked failed and its task is never replayed. Completed means execution ended; the coordinator still owns acceptance and cleanup.

Shell and network tools are disabled. The supervisor's policy is not an OS sandbox. Reviews can read and search an allowlisted workspace; edits need a Git repository root and explicit `base_ref`, and run in a detached supervisor-owned worktree. The worker's patch is exported for review and is never applied, committed, merged, or pushed automatically.

## Prepare before connecting

1. Select the intended installed artifact and configuration. If the explicit config does not exist, initialize it first with `vibe-supervisor allow --config <selected-config> <canonical-workspace>`; this creates a private config and adds only that workspace. Then use the same config for doctor and serve. An explicitly selected missing or invalid file on doctor/serve must fail with its path; do not fall back to another home configuration. The default reduced-release data root is `~/Library/Application Support/VibeSupervisor-oneshot` on macOS, `%APPDATA%/VibeSupervisor-oneshot` on Windows, or `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` on Linux. `VIBE_SUPERVISOR_HOME` is an explicit override. Do not reuse the legacy `VibeSupervisor` data root.
2. Run `vibe-supervisor doctor --config <selected-config> --json`. This checks local prerequisites and pinned Vibe compatibility, not provider authentication or hosted inference. Keep the reported selected config and data path as separate facts.
3. Choose a clean reviewed Git base, or prepare reviewed dirty inputs with the source checkout's `scripts/prepare-reviewed-baseline.mjs`. The manifest shape and add/replace/delete hash rules are in [scripts/README.md](../../scripts/README.md). Run `node scripts/prepare-reviewed-baseline.mjs /absolute/private/manifest.json --config <selected-config>` first; this is a dry-run. If the exact validated inputs need a snapshot, rerun with `--create --expect-manifest-sha256 <manifest_sha256-from-dry-run>`. That creates private snapshot commits in the coordinator-owned snapshot repository; it does not authorize staging, committing, or changing refs in the original checkout. Independently verify the recorded file inventory, modes, hashes, source/index/ref invariants, and returned `base_ref` before dispatch. A changed source invalidates the dry-run.
4. For Codex, use the default isolated setup registration; an existing registration needs `--isolated` and reconnection to prevent other chats from competing for its storage lock. This does not change allowed roots. Connect to the selected server and verify its handshake version and exact five-tool catalog. A CLI version or doctor result does not establish the identity of an already-open desktop connection. Authentication is observed only during a real run.

## Run one bounded task

Collect the desired outcome, concrete acceptance criteria, canonical allowed workspace, exact file scope, exclusions, and explicit Git base for edits. Never put credentials in task text. Check the real connected tool schemas and do not invoke fields or tools absent from that catalog. One started run owns the instance's active slot until backend close verifies termination. If close reports termination unverified, keep the run inspectable and do not start another run on that slot. Do not queue, retry automatically, or replay a task after restart or failure.

Start one review or edit with bounded turns, deadline, output limits, and wait. Use cursor-based `vibe_status` calls on the same connection, then read `vibe_result`. Do not raise limits or rotate accounts after a failure. Ask the worker for a concise final answer and an inventory of scratch paths. Reviews should identify findings with file and location, trigger, and incorrect behavior, or state that no defect was found in the inspected scope.

For a review, check the final answer, stop reason, warnings, and integrity result. For an edit, inspect the full transcript and fresh exported patch, changed and residual files, and hashes while the worktree remains available. Verify the exact candidate in a separate disposable copy; do not run commands or tests inside the worker worktree or original source checkout. Accept only the reviewed delta. Coordinator verification does not turn an unsuccessful Vibe run into a Vibe success.

Close the run after verification. Request cleanup only when the exported artifact is current. A pristine worktree can be removed after ownership checks; a dirty or uncertain one is retained with its path and reason for review. Keep the exported patch available and do not force-delete retained data. Report the candidate version, source/base, actual checks, stop reason, authentication outcome if observed, and any unresolved cleanup or acceptance gate. No platform is currently certified for stable use; macOS Apple silicon is the first target. Hosted inference, native desktop lifecycle, and clean-account installation remain unverified until performed against the exact candidate.

## Reviewed dirty baseline helper

The helper is a source-checkout coordinator tool and is not part of the installed package. It validates selected paths and bytes without a live server, connection identity, provider authentication, or worker. Refusal of secrets, unsafe links, reserved paths, unreviewed ignored files, or source drift is a stop condition; do not weaken the guard or ask Vibe to reconstruct baseline files.

## References

- [Tool and configuration reference](../../docs/reference.md)
- [Behavior](../../docs/functionality.md)
- [Security](../../docs/security.md)
- [Compatibility and unverified gates](../../docs/compatibility.md)
- [Errors](../../docs/errors.md)
- [Agent Skills specification](https://agentskills.io/specification)
