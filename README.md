# vibe-supervisor

A local MCP server for one bounded Mistral Vibe review or isolated edit. It exposes exactly five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. Edits run in a supervisor-created detached Git worktree and return a patch for review; the supervisor never applies, commits, merges, or pushes it automatically.

This is an application policy boundary, **not an operating-system sandbox**. A delegated run uses your account's permissions, and permitted workspace content is sent to Mistral. Review [SECURITY.md](SECURITY.md) before use.

This is `vibe-supervisor` `2.0.0`; the previously published release is `1.0.0`. 2.0 has one engine: the supervisor is a client of Vibe's `vibe-app-server` protocol, one server process per run. It verifies the installed Vibe against a pin manifest before each run, reads the effective configuration back before the model sees a prompt, answers every approval itself, and refuses any tool outside the profile. The model's tool catalogue still lists write tools that are refused when called, not hidden. Release 1.0.0, which used Vibe's legacy harness, is the last 1.x release; there is no 1.x maintenance line. 2.0 acceptance gates are open in the [acceptance record](docs/acceptance.json), and no 1.0.x evidence transfers. Supported platform claims remain limited to macOS Apple silicon with Mistral Vibe 2.26.1. See [compatibility](docs/compatibility.md).

## Requirements

- Node.js 20.19 or newer, npm, and Git.
- Mistral Vibe exactly 2.26.1, driven through its `vibe-app-server`. The installed files must match a pin manifest you generate on the machine that runs Vibe. Other versions fail closed:

  ```sh
  uv tool install mistral-vibe==2.26.1
  vibe
  ```

  Complete Vibe sign-in in the browser before a real run, or provide `MISTRAL_API_KEY` in the supervisor's environment. Doctor checks local prerequisites and the pin, not provider authentication.

## Source setup

For local source work:

```sh
npm ci
npm run build
```

This builds the checkout for local inspection; it does not install the package. Install the exact tarball from the matching GitHub release into a private local prefix, using a populated offline npm cache and `--ignore-scripts`. Review its checksums and the exact executable/config paths before updating Codex registration; retain the previous prefix and a configuration backup for rollback. Source setup does not update an existing installation.

## Configuration and connection

The starter workspace allowlist is empty. On a fresh source checkout, initialize the explicit private config by allowing the canonical repository first. `allow` creates a missing config and adds only the requested root:

```sh
CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
node dist/cli.js allow --config "$CONFIG" "$PWD"
node dist/cli.js pin-manifest --config "$CONFIG"
node dist/cli.js doctor --config "$CONFIG" --json
node dist/cli.js serve --stdio --isolated --config "$CONFIG"
```

Replace `$PWD` with the intended canonical repository path if it is not the current directory. `paths.vibe_pin_manifest` is required in the config; `allow` on a new config sets it beside the config file, and `pin-manifest` writes that file from the installed Vibe (review what it recorded, since it records whatever is installed). A 1.0 config needs that key added and any `backend` key removed. An explicit missing or invalid config fails for doctor/serve and never falls back. Without an override, it uses `~/Library/Application Support/VibeSupervisor-oneshot` on macOS, `%APPDATA%/VibeSupervisor-oneshot` on Windows, or `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` on Linux. `VIBE_SUPERVISOR_HOME` explicitly selects another root. Do not point it at legacy `VibeSupervisor` data.

Codex `setup` generates `--isolated` registrations by default. Each connection owns a separate private storage directory, so another chat can connect without competing for the same owner lock. Existing registrations need the flag added and the connection reloaded; setup previews that change before writing it. Each instance still permits one active run. Direct `serve` without `--isolated` remains available for a deliberately shared storage owner.

Bind preparation, doctor, allow, and serve to the same explicit config. For a separately installed artifact, use its exact executable path and config for every command. Identify the connection that will own the run with a `vibe_status` readiness call and its `server_version`, which does not depend on an MCP initialization handshake; an installed CLI or doctor result cannot identify a previously open desktop connection.

## One-shot workflow

1. Review the config and choose a clean Git base: commit or stash the reviewed state, then pass its ref as `base_ref`.
2. Check readiness on the owning connection with `vibe_status` in workspace mode (`workspace`, `operation`, and `base_ref` for an edit). It starts nothing; a blocker is a preparation failure, not a Vibe result. Allowlist changes in the selected config are picked up without a restart. Then start one bounded review or edit with explicit scope and limits, passing the returned `readiness_receipt`. A second start on the same server/storage instance is rejected while the first run is active. There are no interactive grants, continuation tools, or restart recovery. A run interrupted by server restart is marked failed; its task is never replayed.
3. Wait with `vibe_status`, inspect `vibe_result`, and verify the result independently. `completed` means execution ended, not that the work was accepted; read the stop reason (`turn_limit`, `token_limit`, `price_limit` and `refusal` are incomplete or non-answers). For edits, inspect the fresh patch and exact changed files while the worktree is available.
4. Call `vibe_close` after review. Cleanup is reported only after current-export and ownership checks; inspect any retained-worktree reason.

Patches are never applied automatically. The worker has no shell or network tools, and a review has a read tool but no search tool: the prompt carries a bounded listing of the workspace's files (without reserved and secret files), so still name the files that matter in the task or `context_files`. Run checks in a separate verification copy. It cannot guarantee that a prompt will finish within the declared turn or time limit.

## Skills and references

The package ships one coordinator skill at `skills/vibe-supervisor`. It describes the explicit config workflow, five-tool catalog, one-shot limits, verification, and close procedure.

- [Tool, config, and CLI reference](docs/reference.md)
- [Behavior and lifecycle](docs/functionality.md)
- [Security](docs/security.md) and [error codes](docs/errors.md)
- [Vibe compatibility and unverified gates](docs/compatibility.md)
- [Acceptance record](docs/acceptance.json)
