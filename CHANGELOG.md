# Changelog

## 2.0.1 — one version

Unreleased. The version is set on branch `claude/v2.0.1-cleanup`. Documentation, names and one recovery special case change; run behavior does not.

- One supported version: only the latest release is supported, and Vibe 2.26.1 is the only Vibe release described or accepted.
- The development history, the recorded evidence of earlier candidates and the superseded launcher decision record are removed from the tree. The wire facts keep their basis in [compatibility](docs/compatibility.md#source-basis): the Vibe tag commit and the SHA-256 of every file read.
- New [target acceptance procedure](docs/target-acceptance.md): the reusable steps, authorizations and stop rules that prove a build against one Vibe release on the machine that runs Vibe, including the disconnect procedure. The evidence placeholders are in AGENTS.md.
- The disconnect and fixture-verification scripts and their tests carry neutral names: `scripts/disconnect-client.mjs`, `scripts/disconnect-observer.mjs`, `scripts/fixture-verify.mjs`.
- Saved run records with an unknown engine are skipped by the same rule as any other unreadable record, without a special case.
- `docs/acceptance.json` keeps the 2.0.0 gates, verified and unverified, and drops every record of other candidates. A test fails the build when a document, script or source file refers to another supervisor version, another Vibe version or the removed history.

## 2.0.0 — one engine: a client of Vibe's app-server

Version set on 2026-10-14. The GitHub release follows the target-machine acceptance recorded in `docs/acceptance.json`.

The supervisor drives Mistral Vibe 2.26.1 as a client of `vibe-app-server` (JSON-RPC over stdio, one process per run). The five MCP tools and every boundary are described in [ADR 0004](docs/adr/0004-app-server-client.md). The runtime has only been exercised against a scripted fake server, and every 2.0 gate in `docs/acceptance.json` is open.

- No `backend` configuration key, no second backend, no worker diagnostics file or `VIBE_SUPERVISOR_DIAGNOSTICS`, and no `grep` tool. Tool names and outcomes are in the event log instead.
- Breaking: `paths.vibe_pin_manifest` is required, and a configuration with a `backend` key is rejected. Generate the manifest with `vibe-supervisor pin-manifest` on the machine that runs Vibe; `setup` adds the default path.
- Pin: before each spawn the installed `mistral_vibe` files are hashed against the manifest, and the server must report exactly 2.26.1. Drift fails closed. The check covers that distribution's `RECORD` only, not dependencies, `.pth` files, the interpreter or `__pycache__`.
- Enforcement: the session configuration and `VIBE_*` environment disable subagents, shell, connectors, skills, MCP, telemetry and session logging; a supervisor-written agent profile asks for every profile tool and denies reserved and secret paths; the startup read-back fails the run on any difference before the first turn; the supervisor answers every approval, approving only the profile's tool on an in-workspace path and denying anything else after 5 seconds; and the event validator fails a run on any allowed effect it did not approve, any unknown history entry kind, or a gap in event ids.
- Reviews have `read_file` only and no search or listing tool. The model's catalogue still lists `write_file`, `edit`, the shell tool and `run_typescript`, which the protocol cannot hide; they are refused when called and recorded as `tool_denied` events (fields `tool`, `outcome`, `reason`, `entry_id`, `path`).
- Stop reasons `turn_limit`, `token_limit`, `price_limit`, `refusal` and `cancelled`. New optional `limits.max_tokens` and `limits.max_cost_usd`, enforced by the supervisor because the Vibe server does not enforce them. Usage and cost are rebuilt from the session statistics.
- Run records, events and results name the engine as `backend: app-server`. `doctor` runs the pin check, and its provenance records the backend.
- Reasoning stays off disk: session logging is off, thinking is off, Vibe's throwaway store lives in a private `TMPDIR` that is deleted at close, and restart recovery deletes the private directories of interrupted runs and warns when it cannot. A reaper process kills the worker group if the supervisor disappears or the deadline passes. The credential reaches the worker only in its environment, resolved from `MISTRAL_API_KEY` or the macOS Keychain by Node.
