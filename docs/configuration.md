# Configuration

Initialize with `vibe-supervisor init`, then edit the generated TOML. Use exact canonical workspace paths. The starter configuration selects the `programmatic` backend; select `acp` explicitly only when testing the compatibility path. `allowed_workspace_roots` starts empty, so add only the workspaces required for delegated runs.

Security settings default to shell off, network tools off, raw ACP logging off, and reasoning persistence off. Limits and retention are bounded in the example at `examples/config.toml`. Validate changes with `vibe-supervisor config validate [path]`. Result size is controlled by `limits.max_mcp_result_chars` (default 8000, allowed 1000 to 1000000) and `limits.mcp_result_format` (`text` by default, `structured` or `both`). `text` sends the result once as JSON text; `structured` sends `structuredContent` with a short pointer text; `both` sends both. See [protocol.md](protocol.md).

`vibe-supervisor configure-codex` writes the Codex `[mcp_servers.vibe-supervisor]` entry with `tool_timeout_sec = 600`, which must stay above the 300 second maximum of `wait_seconds`. The `paths` table can point to local Vibe executables and the data directory; paths still undergo validation.
