# Draft local installation and registration review

This is a proposed, reversible local test only. The package is private and unpublished. No installation, Codex configuration edit, account creation, or user-global change has been performed or authorized by this document. The steps are usable only after a separately reviewed rc20 artifact exists and the owner authorizes the exact paths and config scope.

## Private local install proposal

Use an owner-private prefix and the exact local tarball; do not use npm's global prefix:

```sh
PRIVATE="$HOME/.local/share/vibe-supervisor-rc20"
mkdir -m 700 -p "$PRIVATE/prefix"
npm install --prefix "$PRIVATE/prefix" --ignore-scripts \
  /absolute/path/to/release/vibe-supervisor-0.9.0-rc.20.tgz
```

The reviewed executable entrypoint is then:

```text
$PRIVATE/prefix/node_modules/vibe-supervisor/dist/cli.js
```

Use that same absolute entrypoint for every check. Keep the private config path fixed throughout:

```sh
CLI="$PRIVATE/prefix/node_modules/vibe-supervisor/dist/cli.js"
CONFIG="$PRIVATE/config.toml"
node "$CLI" --version
node "$CLI" allow --config "$CONFIG" /absolute/canonical/repository
node "$CLI" doctor --config "$CONFIG" --json
```

The expected version is `0.9.0-rc.20`. Inspect doctor provenance and confirm its `application_entrypoint`, `runtime_module`, canonical config path, and Vibe version point to the reviewed candidate and selected files. `allow` initializes a missing config and adds only that canonical repository; doctor and serve use the same explicit config afterward. A local source checkout is not a substitute for the frozen tarball in this gate.

## Registration diff proposal

Before any proposed registration review, record SHA-256 hashes of the tarball, SBOM, and acceptance report and verify them against the package outputs. The setup dry run is the source of truth for the machine-specific diff. It prints the absolute Node executable, exact candidate `dist/cli.js`, selected config path, and the existing Codex config path, without writing either file:

```sh
node "$PRIVATE/prefix/node_modules/vibe-supervisor/dist/cli.js" setup \
  --workspace /absolute/canonical/repository \
  --config "$PRIVATE/config.toml" \
  --codex user --dry-run
```

The only intended registration entry is this TOML section, with paths replaced by the exact values printed by the dry run:

```toml
[mcp_servers.vibe-supervisor]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/vibe-supervisor/dist/cli.js", "serve", "--stdio", "--config", "/absolute/private/config.toml"]
startup_timeout_sec = 30
tool_timeout_sec = 600
```

The proposal is to add or update only `[mcp_servers.vibe-supervisor]` in the selected user or project Codex config. Review the full dry-run before authorizing the write; existing keys and the selected workspace allowlist must match the review. After authorization, a second dry run should show no remaining change. Restart the selected client and confirm the live handshake version and exact five-tool catalog.

## Rollback plan

Before an authorized write, retain the dry-run output and hash of the target Codex config. Setup creates a timestamped private backup when replacing an existing file. To roll back, first stop the registered server and compare the current file with the reviewed post-change file. Restore the timestamped backup if the file is still the reviewed version; if it has changed since, preserve the new contents and remove only the exact candidate section after another review. If the file did not exist before, remove the candidate section and remove the file only when it is otherwise empty and unchanged. Then remove only the private rc20 install prefix and candidate config after confirming their paths and contents; preserve run records or retained worktrees for separate review. Reconnect the client and confirm the candidate server is no longer registered.

No rollback step should overwrite intervening user edits, delete unaccounted runtime data, or alter another MCP entry.
