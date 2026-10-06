# Configuration

Initialize with `vibe-supervisor init`, then edit the generated TOML. Use exact canonical workspace paths. The starter configuration selects the `programmatic` backend; select `acp` explicitly only when testing the compatibility path. `allowed_workspace_roots` starts empty, so add only the workspaces required for delegated runs.

Security settings default to shell off, network tools off, raw ACP logging off, and reasoning persistence off. Limits and retention are bounded in the example at `examples/config.toml`. Validate changes with `vibe-supervisor config validate [path]`. Result size is controlled by `limits.max_mcp_result_chars` (default 8000, allowed 1000 to 1000000) and `limits.mcp_result_format` (`text` by default, `structured` or `both`). `text` sends the result once as JSON text; `structured` sends `structuredContent` with a short pointer text; `both` sends both. See [protocol.md](protocol.md).

`vibe-supervisor configure-codex` writes the Codex `[mcp_servers.vibe-supervisor]` entry with `tool_timeout_sec = 600`, which must stay above the 300 second maximum of `wait_seconds`. The `paths` table can point to local Vibe executables and the data directory; paths still undergo validation.

## Independent MCP clients

A data directory has one supervisor owner. Independent desktop, CLI, or subagent connections using the same directory can fail MCP initialization because the second server cannot acquire its owner lock. Do not remove a live lock or terminate another session to work around this.

For independent clients, initialize and validate the normal configuration, then preview and register opt-in isolation:

```sh
vibe-supervisor configure-codex --user --isolated --dry-run
vibe-supervisor configure-codex --user --isolated
```

This registers `serve --stdio --isolated`. Each new server creates an owner-only persistent `mcp-sessions/session-*` directory beneath its configuration home and copies only the validated configuration. It never copies source locks, runs, credentials, or pending permission grants. Invalid, missing, oversized, or symlinked configuration fails closed. Explicit `paths.data_dir` is rejected in isolated mode because it would redirect independent clients back to shared storage. `VIBE_SUPERVISOR_HOME` can select a different template configuration home.

The server prints its private directory to stderr. Run IDs belong to that server; keep all start/status/result/close calls on the owning connection. Independent clients cannot fetch each other's runs. Saved directories persist after disconnect. To inspect or deliberately recover a previous directory, use the normal CLI with `VIBE_SUPERVISOR_HOME` set to that exact directory, respecting its owner lock; do not use `--isolated` for recovery. Never delete retained directories without checking valuable runs and worktrees.

Concurrency, queues, and retention apply per server, not globally. A directory never reopened is not automatically swept by another server. Configuration and allowlist changes affect new snapshots only: reconnect the affected client after preserving current work. A fresh connection does not automatically resume old runs.

Without `--isolated`, startup retains the existing shared-directory behavior. Re-running `configure-codex` without that option restores direct shared storage; retain the option when upgrading an isolated installation. A custom local adapter is unnecessary with this release.
