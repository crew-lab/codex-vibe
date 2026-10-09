# Changelog

## 0.9.0-rc.15

Simplification; no change to the MCP tools, allowlists, worktree model, launcher shim or permission handling.

- `backend = "auto"` and the availability probe cache are removed. The backend is `programmatic` (default, five tools) or `acp` (seven tools); a configuration with `auto` is rejected with an error naming both. `doctor` still probes Vibe directly.
- The CLI is `setup`, `allow`, `doctor`, `serve` and `runs list|show|tail|cleanup`. `init`, `configure-codex` and the `test-acp` and `config validate` aliases are removed; `setup --dry-run` prints the planned configuration and Codex changes without writing them.
- The coordinator tools `baseline prepare` and `audit-edit` leave the package and become `scripts/prepare-reviewed-baseline.mjs` and `scripts/audit-edit-run.mjs`, with the same behaviour (see `scripts/README.md`). The duplicated preflight text is removed from the README and both skills.
- `audit-edit-run.mjs` reports `unverified` and exits non-zero when a declared scope is breached, including by a successful call to a tool other than read, search and file edits; backend permission refusals are linked to their tool calls.

## 0.9.0-rc.14

- Add optional owner-private scope files to the offline audit CLI, retaining argument-only scope evidence and unverified candidate acceptance.
- Reject dash-prefixed scope segments at every depth; add private-input and path regressions.

## 0.9.0-rc.13

- Add explicit dry-run/creation of reviewed baseline snapshots in a separate private repository with hash-bound manifests and unchanged source/index/refs.
- Add safe offline ACP edit audits distinguishing messages, unique calls, failed updates, unavailable tools and known failures; incomplete evidence remains unverified.
- Add installed CLI baseline preparation and edit-audit commands; retain the seven-tool MCP interface and existing permissions.

## 0.9.0-rc.12

- Record the creating Supervisor release in persisted run records and public run responses; legacy releases remain unknown after restart.
- Prepare a bounded detached-edit/correction/cleanup pilot with tracked project-discovery canaries and explicit fresh-connection requirements.

## 0.9.0-rc.11

- Support real project `.agents` directories without inheriting their content. The pinned Python launcher disables project discovery for all harness-manager instances before either backend starts, including session copies and reload; exact source-hash and property-signature checks fail closed on drift before credential lookup. Reserved-path file denials, grep exclusions, private homes, untrusted state, and disabled shell/network tools remain unchanged. Root `.vibe`, symlink or non-directory `.agents`, and unsafe `.vibeignore` paths remain refused.
- Add fail-closed/startup-order regressions, tracked and untracked `.agents` lifecycle coverage, and no-network installed-Vibe tests for project discovery and file permissions.

## 0.9.0-rc.10

- An edit run's patch is checked for credentials in added lines only, with stricter shapes: Bearer, `sk-`, GitHub and AWS tokens, private-key blocks, secrets the supervisor itself holds, values assigned to password, secret, token or API-key names (quoted literals, and unquoted values that contain a digit) and literal `Authorization`, `Cookie` and `x-api-key` headers. Placeholders, `${...}` templates, type names and lookups such as `password: string`, `secret: SecretString` or `process.env.SECRET` are accepted, so ordinary code, and anything in context or removed lines, no longer fails the run and strands its worktree.
- A worker is registered with its run as soon as it is spawned, so `vibe_close`, cancellation and the run deadline kill an ACP worker that is still negotiating, and its concurrency slot is released only after it exits. ACP negotiation is bounded by 60 seconds when that is shorter than the run's timeout (otherwise the run deadline applies) and fails with `VSUP_ACP_INIT_FAILED` naming the step that did not finish. A worker whose start returns after its run already ended is cancelled and closed instead of being attached.
- `vibe_edit_start` refuses a `cwd` that is not the root of its Git repository with `VSUP_WORKSPACE_INVALID`, before any worktree is created; an edit worktree always contains the whole repository, so a subdirectory could not bound the worker. Reviews still accept any allowlisted directory.
- A worker that asks for something outside policy, and a refused `vibe_respond`, now fail with `VSUP_PERMISSION_DENIED`; an option that was not offered or an answer of the wrong kind is `VSUP_INVALID_ARGUMENT`. `VSUP_PERMISSION_REQUIRED` and `VSUP_INPUT_REQUIRED` now mean a request is pending, and `vibe_continue` returns them while one is.
- A missing `context_files` entry, a workspace with a project `.vibe` or `.agents` directory or a symlinked `.vibeignore`, and a path with glob characters are refused at start with `VSUP_WORKSPACE_INVALID` and a specific message, instead of `VSUP_INTERNAL` or a generic `VSUP_BACKEND_ERROR` after the run was accepted.
- `doctor` looks up a bare `paths.vibe` or `paths.vibe_acp` name on `PATH` only and rejects a relative path, so it never runs an executable from the current directory.
- Documentation: the `VSUP_TIMEOUT` meaning and the diagnostic remedies in `docs/errors.md`, the tool-inventory wording in `docs/compatibility.md` and the ADRs, what export and cleanup actually verify in `docs/security.md`, and the README's install, verification and edit-example text are corrected.

## 0.9.0-rc.9

- A run whose worker shows no activity for `limits.worker_progress_timeout_seconds` (default 600, 0 disables) while running now fails with the new `VSUP_NO_PROGRESS` and a diagnostic event, instead of waiting for its full deadline. Waiting for a permission or input answer, queued runs and idle completed ACP sessions are not watched. Activity is any ACP notification or request (tool calls, usage updates, thought chunks that are otherwise dropped, permission requests), any complete programmatic stdout line and any stderr output; the `no_progress` diagnostic records the seconds since the last activity and its kind. The timer is disarmed when a deadline, cancel, close, settling state or shutdown begins, so it cannot mislabel or cancel a run that is already ending. Prompted by a real edit that stayed silent for 15 minutes in the rc.8 soak.
- The soak driver's built-in tasks are bounded (named file, capped reads and searches, a final answer in a few lines); a truthfully reported `max_turn_requests` or `max_tokens` run with its partial warning counts as truncated, not as a failure, under a new `truncated_within_threshold` criterion (`--max-truncated-percent`, default 10), applied overall and to every kind and backend separately. A `continue` scenario with a truncated first turn skips its follow-up instead of failing it, and a run's final state comes from its last settled turn.

- Add opt-in bounded programmatic worker stage/frame diagnostics and an overall hosted-soak budget with reserved cleanup time.

- Bound initial hosted-soak worker deadlines below the driver budget so silent workers can record supervisor timeouts before cleanup; preserve shorter configured limits.

- Fix the npm-installed executable silently exiting when invoked through its symlink. The CLI now resolves the entry path before checking whether to run, and offline package smoke exercises the installed executable directly. Module imports remain inactive.

## 0.9.0-rc.8

- `vibe_continue` takes an optional `max_turns` (1 to 50, no default). Vibe counts turns cumulatively per session, so a run whose last turn ended with `max_turn_requests` could never make progress; such a continuation is now rejected with the new `VSUP_TURN_LIMIT_REACHED` before anything reaches Vibe unless `max_turns` exceeds the run's current limit. The new limit is saved on the run and sent to the ACP session before the prompt, on a live session and after a lazy load. The turn-limit summary and `next_action` no longer suggest a plain continue, and a programmatic run is told to start a new run instead. `max_turns` on `vibe_continue` is the session's cumulative ceiling: a lower value is rejected with `VSUP_INVALID_ARGUMENT`, and at 50 the error says the session cannot be extended. An accepted continuation clears the previous stop reason so an interrupted one stays continuable, and a storage fault while saving the raised limit no longer leaves the run `running` with no prompt sent. A programmatic child whose stderr exceeds the event limit now fails the run instead of leaving it running until the deadline.
- A programmatic run that reaches Vibe's turn limit is reported as `completed` with `stop_reason: max_turn_requests` and a partial-result warning instead of `VSUP_BACKEND_CRASHED`. It is recognized only when Vibe exits 1 and its final message, its stderr marker and the configured turn count all agree.
- A saved `result.json` now carries the run's structured `error` for failed and cancelled runs, the same as the MCP reply.
- The default `limits.max_turns_review` is 20 instead of 12. A broad hosted review used up 12 turns in about 15 to 27 seconds on the target machine; edits already defaulted to 20. A config file that sets the key keeps its value.
- The soak driver's built-in review tasks name a starting file, say that only the file read and search tools exist, and cap the number of files read.

## 0.9.0-rc.7

- An ACP session that is continued long after it started is no longer killed mid-turn by the launcher's fixed lifetime. The supervisor keeps a private worker-deadline file in the run directory and moves it forward on every turn and over the idle window; the launcher re-reads it, keeps its last valid value when the file is missing, unsafe or malformed, still stops on parent death, and never runs past a 48-hour hard cap. A worker stopped after the supervisor's own deadline is reported as `VSUP_TIMEOUT` instead of `VSUP_BACKEND_CRASHED`. A failed deadline write is a diagnostic, not a session failure, and nothing is written after a session closes.
- 1.0 supports Vibe's legacy harness only; the unified harness is a documented limitation rather than an open release gate.
- New `npm run soak` hosted soak driver for the Phase D test plan (maintainer tool, run from a source checkout).

## 0.9.0-rc.6

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
- A release workflow that builds, verifies and attaches the tarball, checksums, SBOM and acceptance report to a GitHub Release on a `v<version>` tag was prepared on a separate branch; it is not in the tree yet, and candidates are built locally with `npm run package:rc`. Nothing is published to npm.

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
