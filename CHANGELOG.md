# Changelog

## Unreleased

Breaking changes for coordinators (Phase C):

- `vibe_cancel` is removed; `vibe_close` cancels a live run, and a closed run stays readable through `vibe_status` and `vibe_result` until retention.
- `vibe_edit_start` no longer accepts `allow_shell`, the start tools no longer accept `backend` (the backend comes from configuration), and `vibe_result` no longer accepts `detail: "summary"`.
- `vibe_continue` and `vibe_respond` are listed only when the configured backend is `acp` or `auto`: five tools for programmatic, seven otherwise.
- `configure-codex --path <dir>` without `--project` exits 2 instead of being silently ignored.
- `allowed_workspace_roots` entries must be absolute or start with `~/`, `paths.vibe` and `paths.vibe_acp` must be absolute or a bare command name, and `paths.data_dir` must be absolute; relative values that used to load now fail validation.
- `allow` and `setup` refuse `/` and the home directory as a workspace.

Surface:

- Every reply carries `next_action`; `vibe_status` returns `next_after_seq`. Tool descriptions carry the wait, `stop_reason` and close guidance.
- `limits.review_timeout_seconds`, `limits.edit_timeout_seconds`, `limits.max_turns_review` and `limits.max_turns_edit` now set the defaults when a call omits them. `phase1.*` and the `security.*` keys are removed: shell, network tools, raw ACP logging and reasoning persistence are always off, and a file that still sets them loads with a warning and is never loosened by them.
- A Vibe rate limit (HTTP 429) is `VSUP_RATE_LIMITED` with `retryable: true`; the unused `VSUP_WORKSPACE_DENIED` code is gone.
- New `setup --workspace <dir>` (configuration, allowlist, executable paths, doctor and a confirmed Codex registration in one command) and `allow <dir>`; `doctor --config <path>` validates a file; `test-acp` and `config validate` remain as aliases; `configure-codex` drops the `--scope` and `--path=` forms; `init` writes a minimal file; the version comes from `package.json`.
- `vibe_status` paging is lossless under `max_mcp_result_chars`: events are trimmed from the end, and `next_after_seq` (and the `after_seq` in `next_action`) names the last event actually delivered.
- `next_action` offers `vibe_continue` from the run's own backend, so a programmatic run reached through `backend = "auto"` is no longer told to continue.
- Failures are classified authentication first, and a rate limit needs an explicit 429 or "too many requests" in the final error (not `x-ratelimit-*` headers or retry log lines); a missing executable or interpreter is reported before either.
- `allow` and `setup` say that a running MCP server must be restarted (reconnected for `--isolated`) to read a changed allowlist; the `VSUP_WORKSPACE_INVALID` remedy says so too. They keep one owner-only `config.toml.bak-<timestamp>` copy before rewriting an existing file (comments and layout are not preserved), compare `~`-prefixed roots as the same directory, and `setup` validates the Codex config before writing anything.
- A tag `v<version>` builds, verifies and attaches the tarball, checksums, SBOM and acceptance report to a GitHub Release; nothing is published to npm.

Documentation and package contents:

- `README.md` is the single entry point; `docs/reference.md` replaces the protocol, configuration and chat-usage documents, and `docs/errors.md` is generated from the error remedies and checked by a test.
- Dated evidence, reviews and the first ADR moved to `docs/history/`, which is not packaged. The package no longer ships `.codex-plugin/` or `.mcp.json`.

## 0.9.0-rc.5

Reliability (Phase A; these changes were already in the rc.4 package but not listed there):

- Every run end goes through one path, so failed, cancelled, timed-out and shut-down runs always write `result.json` and, for reviews that launched, an integrity record. A supervisor timeout or cancel wins over a backend-reported outcome.
- Filesystem faults become `VSUP_STORAGE_ERROR` with accurate messages and degrade a running run instead of failing it; the server logs unhandled rejections and exits cleanly on uncaught exceptions.
- Startup no longer launches Vibe: crashed queued and starting runs become `cancelled`, the rest become `recoverable`, and `vibe_continue` reattaches with a 30-second session-load timeout. The owner lock detects reused PIDs and stale recovery locks and names the holder when it refuses.
- `vibe_close` always ends `closed` and returns `worktree_removed` or `worktree_retained_reason`; cleanup after a restart verifies against the saved patch, exporting one first when it is missing; `runs cleanup <id>` refuses resumable runs.
- Clearer failures: Vibe exiting mid-turn, version mismatches (with the exact-pin remedy), missing executables or interpreters, mid-turn ACP errors, worktree creation errors with git's stderr, and supervisor diagnostics in `vibe_status`. Stderr tails are redacted as a whole and treat the child's API key as a known secret.

Latency (Phase B):

- Reviews hash only Git-visible files and compare everything else by stat (30 s to 2.6 s per pass on a 156,000-file tree), with the launch manifest persisted so a review continued after a restart is judged the same way.
- Patch export uses one temporary index (50 untracked files: 1.6 s to 0.13 s) and never touches the source index, including with `core.splitIndex`.
- Events are buffered and fsynced at most every 100 ms (1,000 events: 4.8 s to 18 ms).
- An explicitly selected backend starts without a separate availability probe and still fails closed on a version mismatch.
- A settled `vibe_status` includes the compact result, which now always carries `next_action`, so the usual loop is start, status, close.
- Startup reads only run metadata; retention runs automatically after the server is serving and keeps completed runs at least one day. `configure-codex` writes `startup_timeout_sec = 30`.

Isolation: `serve --stdio --isolated` reuses a free session directory (claiming its owner lock first and refreshing its configuration) instead of creating one per connection, so directories are bounded by simultaneous clients and runs survive a reconnect.

## 0.9.0-rc.4

- Adds opt-in per-connection storage with `serve --stdio --isolated` and `configure-codex --isolated`, preventing independent MCP clients from competing for one owner lock. Each server snapshots the validated configuration and retains its own runs. Default shared storage and existing recovery behavior remain unchanged.
- Documents configuration refresh, private run ownership, and concurrent desktop/CLI use.

## 0.9.0-rc.3

Replaces the rc.2 package, since two different tarballs carried the rc.2 version.

- Workspace file grants now use the recursive `vibe-path:directory_recursive:` form, so files at any depth are readable and writable inside the worker workspace.
- Supervisor-owned agent profiles in the private `VIBE_HOME` shadow Vibe's built-in Plan and Accept Edits agents, which would otherwise replace the read grants and make writes global; mode IDs are unchanged.
- Hosted acceptance evidence recorded for desktop registration, a review, a programmatic edit, and an ACP edit with continuation.
- The rationale for the launch profile moved from code comments into `docs/compatibility.md`.

## 0.9.0-rc.2

Refuse uncorrelated or overlapping ACP permission requests by selecting an offered reject option instead of cancelling the whole prompt turn; `cancelled` remains the fallback when no reject option is offered.

## 0.9.0-rc.1

Initial private release candidate: local MCP stdio server, review/edit run lifecycle, private persistence, detached-worktree patch artifacts, CLI diagnostics/configuration, and a pinned Vibe launcher compatibility shim. Production authentication and long-run ACP gates remain unverified; see `docs/history/acceptance.md`.
