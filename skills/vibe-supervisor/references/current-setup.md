# Current setup and observed limitations

Updated 2026-10-06 for vibe-supervisor 0.9.0-rc.4 and pinned Mistral Vibe 2.25.8. Keep dependency pins and fail-closed guards; this is not a sandbox or a certification of every hosted backend/model.

## Connection and storage

Use the actual client tool catalog first. A registered MCP entry is not necessarily connected. Connection-closed initialization failures need startup diagnostics; increasing a tool-call timeout does not fix an owner-lock conflict. Check the configured executable, configuration home/profile, current registration, startup errors and whether the session predates a configuration change. Do not dump global logs or credential environments.

For independently connected desktop/CLI/subagent clients, preview and register `configure-codex --user --isolated` using the installed CLI after initialization/config validation. It starts `serve --stdio --isolated`. Each process copies only validated configuration to a private persistent `mcp-sessions/session-*` directory under the template home. An explicit `paths.data_dir` is rejected; `VIBE_SUPERVISOR_HOME` selects the template. Re-register with `--isolated` after upgrades; running configure-codex without it restores shared storage.

Record the owning connection and directory. Status/result/continue/respond/close for a run must stay on that client. A different home's NOT_FOUND error is not proof the run vanished. Concurrency and retention are per server; a never-reopened directory is not swept by another instance. Do not bulk-delete session storage. For deliberate inspection/recovery, point the normal CLI at the exact old home and honor its owner lock; do not create a new isolated home and expect old runs there.

## Workspace checks

Authorization requires canonical allowlisted roots. Add only the intended repository when authorized, back up configuration and preserve restrictive security options. New configuration snapshots require reconnecting; do not rewrite live private snapshots.

The launch profile rejects root `.agents` and `.vibe` project extensions, even when `.agents` contains only another client's skills. `AGENTS.md` is a different file. A passing allowlist check does not bypass this guard. Do not rename/delete the project's skills, enable trust, remove the guard or change tool permissions to force execution.

For an explicitly bounded read-only smoke check, an authorized coordinator may prepare a fresh copy of only safe selected files in an already-allowed clean workspace. Preserve relative paths, source identity and before/after hashes; omit project extensions, credentials and private records. The guard must still pass. Never describe a two-file copy as full repository support, a complete build, or proof that missing contextual files do not matter. Review mode needs no Git repository. Edit mode still requires a supervisor-created detached Git worktree; a review copy is not authority to edit or integrate elsewhere.

## Evidence and acceptance

Separate installed/configured, connected/tools visible, workspace allowed, hosted response produced, model identity evidenced, task accepted and read-only integrity. Initialization/status probes do not prove authentication or inference. A hosted response does not prove model selection or correctness.

The 2026-10-06 two-file smoke workflow produced a hosted response with verified unchanged hashes and a closed run. Its initial naming/placement/barrel suggestions and mode-switch plan failed the correctness assignment despite end_turn. A focused follow-up supported a conditional undeclared-runtime-tool finding; unsupported build-output claims were excluded. Use the final-review instructions in the main skill rather than requiring a fixed finding count.

## Cleanup limits

Vibe has read/search in review and read/search/write/edit in edit mode; shell/network and arbitrary filesystem deletion are unavailable. Ask usable ACP workers to account for their own temporary files and plans within their owned worktree, clean only when a permitted tool supports the exact operation, and report unsupported removal. The coordinator verifies ownership/preservation, removes its own verifier scratch resources and calls supervisor close/worktree cleanup. Never delegate runtime homes, locks, process termination or Git worktree removal to worker text instructions.
