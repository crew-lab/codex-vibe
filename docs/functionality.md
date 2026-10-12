# Behavior

The supervisor is a local MCP coordinator for one-shot Mistral Vibe 2.26.1 programmatic runs through the enforced `--legacy-harness` path. Its tools are `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. A run accepts one task and fixed turn, deadline, event, transcript, and artifact limits. There is no interactive permission response, continuation, queue, ACP session, idle-session retention, or automatic recovery.

The capacity guarantee belongs to one owning server/storage instance. The server reserves its single slot before asynchronous preparation and rejects another start with a capacity error; there is no waiting record or hidden worker. Separate isolated MCP connections can each own an instance. A second process cannot manage the same storage while the owner lock is held.

## Readiness and admission

Every delegation should begin with `vibe_status` in workspace mode on the connection that will run the task. The check rereads the selected configuration, runs the same admission validators a start runs, reports this server's version and instance, the policy revision, boot-setting drift, the active slot and executable resolution, and lists structured blockers. It creates no run, worktree or model call. An eligible check returns a 10-minute receipt bound to this server instance, the policy revision, the operation, the canonical workspace and, for an edit, the `base_ref` and the commit it resolves to. A start that carries the receipt is rejected before launch if any of these drifted. See [workspace readiness](reference.md#workspace-readiness).

A start, with or without a receipt, reserves the slot, then rereads and validates the selected configuration before it creates a record. Allowlist changes therefore apply to the next check or start without a restart; an allowed root that disappears from disk denies only workspaces under it; changes to boot-bound settings make readiness report `restart_required` and starts fail with `VSUP_RESTART_REQUIRED`; a missing or unsafe file fails closed. The admitted `policy_revision` is saved with the run. See [policy authority](reference.md#policy-authority).

## Review

A review requires a canonical workspace beneath an explicitly configured allowlist. The starter allowlist is empty. Before launch, the supervisor snapshots source integrity (see Review snapshot cost below). Vibe receives only read and search tools. The final result records whether source integrity remained verified, changed, or could not be established. `completed` means the worker ended; the coordinator must inspect the stop reason, warnings, integrity and final answer.

## Edit

An edit requires the root of a Git repository and a named base ref. The supervisor creates a detached worktree and launches the one-shot task there. It exports a patch, file inventory, and bounded transcript/artifacts. It never applies, stages, commits, merges, or pushes the patch. The coordinator reviews a fresh export and verifies it in a separate copy before deciding whether to integrate the change.

## Settlement and close

Settlement records one final state. The active slot and owned handle are released only after backend close verifies termination. If close fails or times out, the run stays inspectable, its handle and slot remain owned, and the close response reports `worker_termination_unverified` with `VSUP_BACKEND_ERROR`; a second run cannot take that slot. Deadline, no-progress, output overflow, cancellation, provider error, shutdown and late process callbacks cannot reopen a settled run or replace its result. Deadlines and output limits are bounded. Worker watchdogs stop an orphaned child when its parent disappears or its recorded run deadline passes.

A corroborated Vibe turn-limit stop is recorded as `completed` with `stop_reason: max_turn_requests` and an incomplete-result warning. This means execution ended at its configured budget, not that the task succeeded. The supervisor does not retry, continue, or increase the budget. An assistant message alone cannot establish a runtime limit: unmatched limits, conflicting errors, other stop reasons, and process crashes remain failures.

Closing a live run cancels its process group and accounts for worktree creation that is already in flight. Worktree deletion requires the expected canonical run-owned path, validated Git registration, a fresh export matching the saved artifact, and an inventory showing the worktree is pristine. Dirty or uncertain worktrees are retained with an explicit path and reason so the coordinator can review the exported patch. Cleanup is admitted by the root recorded when the run started, not by the current allowlist. Removing a root does not stop a run already admitted there: it runs to its normal end, stays readable and closable, and its verified pristine worktree can still be removed; a dirty or uncertain one is retained exactly as before. Saved PIDs alone never authorize termination, and saved mutable worktree metadata alone never authorizes deletion.

A retained worktree stays registered in the source repository under `.git/worktrees/`. If you run `git worktree prune` or delete the directory yourself, verified cleanup refuses it permanently, because the registration it checks no longer exists, and the run directory is kept. Recover manually: read the exported patch from the run's artifacts, call `vibe_close` without cleanup (or use `vibe-supervisor runs cleanup`, which lists each retained worktree with the exact `git -C <source> worktree remove <path>` command), then remove or prune the worktree yourself with Git. The supervisor never force-deletes retained data.

Git operations are bounded separately: queries such as `rev-parse` and `ls-files` have a 30 s bound, while worktree creation, patch export and verified cleanup have a 5 minute bound so large repositories can be checked out. The exported patch is capped by `limits.max_artifact_bytes`. Exceeding a bound fails with `VSUP_TIMEOUT` or `VSUP_OUTPUT_LIMIT` and `details.operation`.

### Review snapshot cost

The integrity snapshot hashes the content of every file Git can see (tracked, plus untracked files not ignored) and only stats everything else, such as ignored trees like `node_modules`, skipping `.git`. It runs at launch and again at settle. Large ignored trees cost stat time at both ends. The snapshot is capped at 200,000 files and 2 GiB of hashed content; past either cap integrity is reported as `unverified` rather than failing the review. Keep large generated trees out of the reviewed workspace, or accept `unverified`.

On server shutdown, the supervisor allows a primary 10-second graceful drain and then retries termination through each live owned handle. Individual cancel and forced-termination attempts are bounded, but there is no fixed overall exit guarantee while termination remains unverified. Unresolved workers retain their handle, slot, worktree and owner lock; pending initialization and in-flight Git/worktree writes also remain accounted for under that lock. The lock is released only after all owned work is accounted for.

When `serve --stdio --isolated` receives `vibe_status`, `vibe_result` or `vibe_close` for a run outside its currently selected session directory, it searches the same private `mcp-sessions` namespace for that UUID. It routes only when exactly one safe run directory matches; the existing manager validates its saved record during recovery. The owning lock is acquired before that manager loads the store; live owners, unsafe paths, duplicate UUIDs and namespaces over the scan limit fail closed. The temporary manager uses the current server's boot-bound settings, applies the same frozen-admission cleanup rule, and is shut down after the operation. New runs always stay in the current session. This lookup does not search other config roots or identify which desktop connection originally created a run.

## Restart and saved data

On startup, active records from an interrupted one-shot run are made inspectable and marked failed with an interruption diagnostic. The isolated UUID lookup applies the same recovery when it temporarily opens a unique older session. Startup and lookup do not launch Vibe, load a session, replay a task, restore a grant, or signal a PID from a saved record. Old saved records are read defensively; the reduced runtime does not provide a migration or cleanup contract for an older ACP installation. Use the corresponding older executable for that data.

Runs, events and artifacts are persisted privately and bounded by configured limits and retention. The supervisor uses atomic writes, owner locking, fresh path validation and explicit child environment filtering. Credentials remain in the private Vibe provider runtime; raw provider output, reasoning and secrets are filtered from saved artifacts.

## Configuration and preparation

Select a config with `--config`; otherwise resolution uses `VIBE_SUPERVISOR_HOME`, then the reduced candidate's platform default root. Explicit invalid or missing configs fail without fallback. That selection is made once, before `--isolated` switches to a private session directory, and stays the policy source for the life of the connection; the session's copy of `config.toml` is an audit record only. Once serving, a missing selected file fails closed even where startup could have used defaults. Removed keys such as `backend`, `max_concurrent_runs`, idle-session TTL and ACP executable paths are rejected. The config, doctor provenance, data directory and already-open client handshake are separate facts.

Commit or stash the reviewed state before delegating and pass its ref as `base_ref`; uncommitted source bytes are not an edit base.

The supervisor's path checks, filtered profiles and Vibe tool configuration are application policy. They are not a kernel or process sandbox. A worker's account permissions and any content included in its allowed workspace remain relevant.
