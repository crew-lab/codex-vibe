# Configuration

Initialize with `vibe-supervisor init`, then edit the generated TOML. Use exact canonical workspace paths. The starter configuration selects the `programmatic` backend; select `acp` explicitly only when testing the compatibility path. `allowed_workspace_roots` starts empty, so add only the workspaces required for delegated runs.

Security settings default to shell off, network tools off, raw ACP logging off, and reasoning persistence off. Limits and retention are bounded in the example at `examples/config.toml`. Validate changes with `vibe-supervisor config validate [path]`. The `paths` table can point to local Vibe executables and the data directory; paths still undergo validation.
