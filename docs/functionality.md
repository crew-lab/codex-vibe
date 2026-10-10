# Behavior

The supervisor is a local MCP coordinator for one-shot Mistral Vibe 2.26.1 programmatic runs through the enforced `--legacy-harness` path. Its tools are `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. A run accepts one task and fixed turn, deadline, event, transcript, and artifact limits. There is no interactive permission response, continuation, queue, ACP session, idle-session retention, or automatic recovery.

The capacity guarantee belongs to one owning server/storage instance. The server reserves its single slot before asynchronous preparation and rejects another start with a capacity error; there is no waiting record or hidden worker. Separate isolated MCP connections can each own an instance. A second process cannot manage the same storage while the owner lock is held.

## Review

A review requires a canonical workspace beneath an explicitly configured allowlist. The starter allowlist is empty. Before launch, the supervisor snapshots source integrity. Vibe receives only read and search tools. The final result records whether source integrity remained verified, changed, or could not be established. `completed` means the worker ended; the coordinator must inspect the stop reason, warnings, integrity and final answer.

## Edit

An edit requires the root of a Git repository and a named base ref. The supervisor creates a detached worktree and launches the one-shot task there. It exports a patch, file inventory, and bounded transcript/artifacts. It never applies, stages, commits, merges, or pushes the patch. The coordinator reviews a fresh export and verifies it in a separate copy before deciding whether to integrate the change.

## Settlement and close

Settlement records one final state. The active slot and owned handle are released only after backend close verifies termination. If close fails or times out, the run stays inspectable, its handle and slot remain owned, and the close response reports `worker_termination_unverified` with `VSUP_BACKEND_ERROR`; a second run cannot take that slot. Deadline, no-progress, output overflow, cancellation, provider error, shutdown and late process callbacks cannot reopen a settled run or replace its result. Deadlines and output limits are bounded. Worker watchdogs stop an orphaned child when its parent disappears or its recorded run deadline passes.

Closing a live run cancels its process group and accounts for worktree creation that is already in flight. Worktree deletion requires the expected canonical run-owned path, validated Git registration, a fresh export matching the saved artifact, and an inventory showing the worktree is pristine. Dirty or uncertain worktrees are retained with an explicit path and reason so the coordinator can review the exported patch. Saved PIDs alone never authorize termination, and saved mutable worktree metadata alone never authorizes deletion.

On server shutdown, the supervisor allows a primary 10-second graceful drain and then retries termination through each live owned handle. Individual cancel and forced-termination attempts are bounded, but there is no fixed overall exit guarantee while termination remains unverified. Unresolved workers retain their handle, slot, worktree and owner lock; pending initialization and in-flight Git/worktree writes also remain accounted for under that lock. The lock is released only after all owned work is accounted for.

## Restart and saved data

On startup, active records from an interrupted one-shot run are made inspectable and marked failed with an interruption diagnostic. Startup does not launch Vibe, load a session, replay a task, restore a grant, or signal a PID from a saved record. Old saved records are read defensively; the reduced runtime does not provide a migration or cleanup contract for an older ACP installation. Use the corresponding older executable for that data.

Runs, events and artifacts are persisted privately and bounded by configured limits and retention. The supervisor uses atomic writes, owner locking, fresh path validation and explicit child environment filtering. Credentials remain in the private Vibe provider runtime; raw provider output, reasoning and secrets are filtered from saved artifacts.

## Configuration and preparation

Select a config with `--config`; otherwise resolution uses `VIBE_SUPERVISOR_HOME`, then the reduced candidate's platform default root. Explicit invalid or missing configs fail without fallback. Removed keys such as `backend`, `max_concurrent_runs`, idle-session TTL and ACP executable paths are rejected. The config, doctor provenance, data directory and already-open client handshake are separate facts.

Reviewed dirty inputs can be prepared before connecting by the source-checkout helper. Its dry-run binds config/runtime provenance and source HEAD, index, refs, input paths, modes and hashes. Snapshot creation requires the dry-run digest and writes to a private coordinator repository. It revalidates inputs, then returns a `base_ref` and independently checkable manifest. It does not change the original source checkout or require a server, connection identity, credential, or Vibe inference. A clean reviewed Git base skips this step.

The supervisor's path checks, filtered profiles and Vibe tool configuration are application policy. They are not a kernel or process sandbox. A worker's account permissions and any content included in its allowed workspace remain relevant.
