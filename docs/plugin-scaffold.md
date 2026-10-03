# Codex plugin and MCP configuration scaffold

The repository includes `.codex-plugin/plugin.json`, `.mcp.json`, and the `skills/vibe-supervisor/` skill. The manifest shape and file references follow locally installed Codex plugins (`.codex-plugin/plugin.json` with a `skills` directory and an `mcpServers` file; `.mcp.json` with `command`, `args`, `cwd`, `enabled`, timeouts, and `env`).

These files are a **scaffold**, not a claim that this unpublished npm package is installable as a Codex plugin or visible in Codex Desktop. The MCP example assumes execution from the package root; an installed local copy may need an absolute CLI path in `args` and an absolute package directory in `cwd`, consistent with the local Codex host's path handling. The server is disabled in the example. No automated command edits a user's Codex configuration. Use `vibe-supervisor configure-codex --dry-run` to preview a local MCP entry before choosing whether to register it yourself.

The plugin manifest uses the metadata subset verified against local installed plugin examples. Codex plugin validation, installation, and desktop visibility have not been run for this release candidate; see [acceptance status](acceptance.md).
