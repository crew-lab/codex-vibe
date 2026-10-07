# Configuration

Initialize with `vibe-supervisor init`, then edit the generated TOML. Use exact canonical workspace paths. The starter configuration selects the `programmatic` backend; select `acp` explicitly only when testing the compatibility path. `allowed_workspace_roots` starts empty, so add only the workspaces required for delegated runs.

Security settings default to shell off, network tools off, raw ACP logging off, and reasoning persistence off. Limits and retention are bounded in the example at `examples/config.toml`. Validate changes with `vibe-supervisor config validate [path]`. Result size is controlled by `limits.max_mcp_result_chars` (default 8000, allowed 1000 to 1000000) and `limits.mcp_result_format` (`text` by default, `structured` or `both`). `text` sends the result once as JSON text; `structured` sends `structuredContent` with a short pointer text; `both` sends both. See [protocol.md](protocol.md).

`vibe-supervisor configure-codex` writes the Codex `[mcp_servers.vibe-supervisor]` entry with `startup_timeout_sec = 30` and `tool_timeout_sec = 600`. The tool timeout must stay above the 300 second maximum of `wait_seconds`; the startup timeout leaves room for a cold start. An existing entry that lacks either value is updated on the next run. The `paths` table can point to local Vibe executables and the data directory; paths still undergo validation.

## Independent MCP clients

A data directory has one supervisor owner. Independent desktop, CLI, or subagent connections using the same directory can fail MCP initialization because the second server cannot acquire its owner lock. Do not remove a live lock or terminate another session to work around this.

For independent clients, initialize and validate the normal configuration, then preview and register opt-in isolation:

```sh
vibe-supervisor configure-codex --user --isolated --dry-run
vibe-supervisor configure-codex --user --isolated
```

This registers `serve --stdio --isolated`. Each server claims an owner-only `mcp-sessions/session-*` directory beneath its configuration home. It adopts the most recently used existing directory whose owner lock is free (no lock file, or a lock held by a dead or reused PID, as the normal owner lock decides) and creates a new one only when every existing directory is held by a live supervisor. The directory is claimed by acquiring its owner lock during selection, and that held lock is handed to the run manager, so two starts racing for one free directory cannot both win: the loser moves on to the next candidate or creates a new directory. The stderr line names the private directory and says whether it was adopted or created. Only real, owner-only directories directly under `mcp-sessions/` that match the `session-` name pattern are candidates; symlinks, group- or world-accessible directories, foreign-owned directories and directories with an unsafe lock file are skipped with one stderr line and never modified or deleted.

The number of directories is therefore bounded by the number of simultaneous clients. Codex restarts its MCP servers with the app, and each restart reuses a released directory instead of leaving a new one behind.

On adoption the directory's `config.toml` is atomically replaced with a fresh owner-only snapshot of the validated template, so allowlist and limit changes take effect on reconnect. Existing runs in the directory are recovered lazily by the normal startup recovery, remain reachable by their run IDs from the new connection (`vibe_continue`, `vibe_close` and cleanup work as before), and retention applies to them. Only the validated configuration is copied from the template home. Source locks, runs, credentials and pending permission grants are never copied. Invalid, missing, oversized, or symlinked configuration fails closed. Explicit `paths.data_dir` is rejected in isolated mode because it would redirect independent clients back to shared storage. `VIBE_SUPERVISOR_HOME` can select a different template configuration home.

Run IDs belong to the directory that holds them, and two live clients never share one: a run started by one connection is unreachable from another live connection. To inspect or deliberately recover a directory by hand, use the normal CLI with `VIBE_SUPERVISOR_HOME` set to that exact directory, respecting its owner lock; do not use `--isolated` for recovery. Never remove a live lock, and never delete retained directories without checking valuable runs and worktrees.

Concurrency and queues apply per server, not globally. Retention runs inside each server over the directory it holds, automatically shortly after start and then daily, so a directory that no client ever reconnects to is not swept; it is adopted by the next start that finds no more recently used free directory.

Without `--isolated`, startup retains the existing shared-directory behavior. Re-running `configure-codex` without that option restores direct shared storage; retain the option when upgrading an isolated installation. A custom local adapter is unnecessary with this release.
