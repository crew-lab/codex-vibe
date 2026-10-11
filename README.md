# vibe-supervisor

A local MCP server for one bounded Mistral Vibe review or isolated edit. The reduced candidate exposes exactly five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. Edits run in a supervisor-created detached Git worktree and return a patch for review; the supervisor never applies, commits, merges, or pushes it automatically.

This is an application policy boundary, **not an operating-system sandbox**. A delegated run uses your account's permissions, and permitted workspace content is sent to Mistral. Review [SECURITY.md](SECURITY.md) before use.

The development candidate is `0.9.0-rc.21`, private, unpublished, and MIT licensed. No platform is currently certified for stable use. macOS Apple silicon is the intended first target; hosted inference, native desktop lifecycle, clean-account installation, and provider authentication remain unverified for this candidate. Linux and Windows are not claimed as supported platforms.

## Requirements

- Node.js 20.19 or newer, npm, and Git.
- Mistral Vibe exactly 2.26.1 through the validated legacy programmatic harness. Other versions fail closed:

  ```sh
  uv tool install mistral-vibe==2.26.1
  vibe
  ```

  Complete Vibe sign-in in the browser before a real run. Doctor checks local prerequisites, not provider authentication.

## Source setup

This candidate has not been published. For local source work:

```sh
npm ci
npm run build
```

This builds the checkout for local inspection; it does not install the package. A future local package installation and Codex registration are described as a review-only draft in [the installation plan](docs/local-install-registration-plan.md). Neither has been applied.

## Configuration and connection

The starter workspace allowlist is empty. On a fresh source checkout, initialize the explicit private config by allowing the canonical repository first. `allow` creates a missing config and adds only the requested root:

```sh
CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
node dist/cli.js allow --config "$CONFIG" "$PWD"
node dist/cli.js doctor --config "$CONFIG" --json
node dist/cli.js serve --stdio --isolated --config "$CONFIG"
```

Replace `$PWD` with the intended canonical repository path if it is not the current directory. An explicit missing or invalid config fails for doctor/serve and never falls back. Without an override, the candidate uses `~/Library/Application Support/VibeSupervisor-oneshot` on macOS, `%APPDATA%/VibeSupervisor-oneshot` on Windows, or `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` on Linux. `VIBE_SUPERVISOR_HOME` explicitly selects another root. Do not point it at legacy `VibeSupervisor` data.

Codex `setup` generates `--isolated` registrations by default. Each connection owns a separate private storage directory, so another chat can connect without competing for the same owner lock. Existing registrations need the flag added and the connection reloaded; setup previews that change before writing it. Each instance still permits one active run. Direct `serve` without `--isolated` remains available for a deliberately shared storage owner.

Bind preparation, doctor, allow, and serve to the same explicit config. For a separately installed artifact, use its exact executable path and config for every command. Verify the live MCP handshake version and exact five-tool catalog on the connection that will own the run; an installed CLI or doctor result cannot identify a previously open desktop connection.

## One-shot workflow

1. Review the config and choose a clean Git base, or prepare reviewed dirty bytes using the source-checkout helper in [scripts/README.md](scripts/README.md). Preparation is a dry run first and needs no live connection. Snapshot creation uses a separate private repository; verify its receipt, source invariants, file hashes, and `base_ref` before dispatch.
2. Start one bounded review or edit with explicit scope and limits. A second start on the same server/storage instance is rejected while the first run is active. There are no interactive grants, continuation tools, or restart recovery. A run interrupted by server restart is marked failed; its task is never replayed.
3. Wait with `vibe_status`, inspect `vibe_result`, and verify the result independently. `completed` means execution ended, not that the work was accepted. For edits, inspect the fresh patch and exact changed files while the worktree is available.
4. Call `vibe_close` after review. Cleanup is reported only after current-export and ownership checks; inspect any retained-worktree reason.

Patches are never applied automatically. The worker has no shell or network tools, so run checks in a separate verification copy. It cannot guarantee that a prompt will finish within the declared turn or time limit.

## Skills and references

The package ships one coordinator skill at `skills/vibe-supervisor`. It describes the explicit config and reviewed-baseline workflow, five-tool catalog, one-shot limits, verification, and close procedure.

- [Tool, config, and CLI reference](docs/reference.md)
- [Behavior and lifecycle](docs/functionality.md)
- [Security](docs/security.md) and [error codes](docs/errors.md)
- [Vibe compatibility and unverified gates](docs/compatibility.md)
- [Candidate acceptance record](docs/acceptance.json)
- [Implementation handoff](Handoff.md)
