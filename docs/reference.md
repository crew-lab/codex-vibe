# Reference

The supervisor uses MCP over stdio. Standard output carries protocol frames; diagnostics go to standard error. Tool schemas reject unknown fields, including removed `backend`, `allow_shell`, `vibe_continue`, and `vibe_respond` fields. See [behavior](functionality.md), [security](security.md), and [errors](errors.md).

## Tools

Exactly five tools are registered in every server instance:

| Tool | Purpose |
|---|---|
| `vibe_review_start` | Start one read-only review in an allowed workspace. |
| `vibe_edit_start` | Start one edit from an explicit Git base in a detached supervisor worktree. |
| `vibe_status` | With `run_id`: read state and bounded events, including the compact result when settled. With `workspace` and `operation`: check readiness on this connection without starting a run. |
| `vibe_result` | Read the compact/full record and optionally its transcript. |
| `vibe_close` | Cancel live work, close the run, and optionally request verified worktree cleanup. |

Each owning server/storage instance has one active run slot. A concurrent start is rejected immediately. The slot is released only after backend close verifies termination. A `vibe_close` response with `worker_termination_unverified: true` means the handle and slot remain owned, the run is still inspectable and its worktree is retained; do not report that the process is closed or start another run on that slot. A settled result is not independently accepted until the coordinator reviews it. On restart, an interrupted run is marked failed and never resumed or replayed.

All schemas are strict. `run_id` is a UUID v4. Unless noted, required fields have no default.

| Tool | Field | Type and bounds | Default |
|---|---|---|---|
| `vibe_review_start` | `task` | string, 1–100,000 characters | required |
| | `cwd` | absolute workspace path, 1–4096 characters, inside an allowed root | required |
| | `context_files` | up to 50 paths, each 1–4096 characters | `[]` |
| | `max_turns` | integer 1–50 | `limits.max_turns_review` |
| | `timeout_seconds` | integer 30–7200 | `limits.review_timeout_seconds` |
| | `wait_seconds` | integer 0–300 | `0` |
| | `readiness_receipt` | string, 1–2048 characters, from a workspace check on this connection | none |
| `vibe_edit_start` | `task`, `cwd` | as above; `cwd` must be the Git repository root | required |
| | `base_ref` | existing Git ref, 1–512 characters | `HEAD` |
| | `max_turns`, `timeout_seconds`, `wait_seconds`, `readiness_receipt` | same bounds as review | configured defaults, then `0` for wait, no receipt |
| `vibe_status` | `run_id` | UUID v4; pass exactly one of `run_id` or `workspace` | none |
| | `after_seq` | integer ≥0 (run mode) | `0` |
| | `max_events` | integer 0–100 (run mode) | `10` |
| | `wait_seconds` | integer 0–300 (run mode) | `0` |
| | `workspace` | absolute path, 1–4096 characters (readiness mode) | none |
| | `operation` | `review` or `edit`; required with `workspace` | none |
| | `base_ref` | Git ref, 1–512 characters; only with `operation: edit` | `HEAD` for edit |
| `vibe_result` | `run_id` | UUID v4 | required |
| | `detail` | `compact` or `full` | `compact` |
| | `include_transcript` | boolean | `false` |
| `vibe_close` | `run_id` | UUID v4 | required |
| | `cleanup_worktree` | boolean | `false` |

A failed tool call sets `isError` and returns one JSON text block, `{"error": {code, message, remediation, retryable, details?}}`, redacted and bounded like a result; branch on `code`, `retryable` and `details`. See [errors](errors.md).

Start calls can wait until the run needs coordinator attention. For longer work, use cursor-based status calls and pass `next_after_seq` as the next `after_seq`; waits are bounded to 300 seconds. A completed run can carry a non-`end_turn` stop reason and partial-result warning. Read the stop reason before trusting its summary.

## Workspace readiness

`vibe_status` with `workspace` and `operation` asks the connected server whether it would admit that start now. It creates no run, record, worktree or model call and does not launch Vibe. It rereads the selected configuration and runs the same admission validators as a start: canonical allowlisted workspace, Git repository root for an edit, no project `.vibe` or unsafe `.agents`, no glob characters. An edit check also resolves `base_ref` to a commit. Fields:

| Field | Meaning |
|---|---|
| `server_version`, `server_instance_id` | The serving process's release and a random per-process identity. Unlike `supervisor_version` in run output, which names the release that created a saved run, these describe this connection. |
| `policy_path`, `policy_revision` | The selected configuration file and the semantic SHA-256 of what it holds now; `null` revision when it cannot be read. |
| `restart_required`, `boot_drift` | Whether boot-bound settings in the file differ from the ones this server started with, and which keys. |
| `session_id` | The private `--isolated` session directory name, or `null`. |
| `operation`, `requested_workspace`, `workspace` | The request and its canonical path, `null` when rejected. |
| `base_ref`, `base_commit` | Edit checks only: the ref and the commit it resolves to now. |
| `eligible`, `blockers` | Whether a start would be admitted, and every reason it would not, each with `code`, `message`, `remediation`, `retryable` and, when present, `details` (for example `unavailable_root` or `boot_drift`). |
| `active_slot.busy` | Whether this instance already has an active run. |
| `runtime` | Executable resolution for `paths.vibe` (`executable_found`, `pinned_version`). Vibe is not launched, so `version_verified` is always `false`; the exact pinned version is still enforced when a run starts. |
| `readiness_receipt`, `receipt_expires_at` | Present only when eligible. An opaque token, valid for 10 minutes on this server instance. |

Passing `readiness_receipt` to the matching start binds it to the check: the start is rejected before any run is created with `VSUP_READINESS_RECEIPT_INVALID` when the receipt is malformed, altered, expired, issued by another instance, or bound to a different policy revision, operation, canonical workspace or `base_ref`, or when, for an edit, the ref no longer resolves (`base_ref_unresolved`) or resolves to another commit (`base_commit`). An admitted edit's worktree is created at exactly the commit that was checked, so a ref that moves afterwards cannot change what the worker sees; without a receipt the ref is resolved once, when the worktree is created, and that commit is used throughout. `details.reason` names which. A receipt is not authorization for the task and does not prove provider availability or authentication. Without a receipt a start behaves as before, but always against the freshly reread configuration. Either way a start still claims the slot, rereads and validates, so a slot taken after the check is rejected with `VSUP_LIMIT_EXCEEDED`.

## Results and artifacts

Compact results include state, stop reason, summary, warnings, error, next action, and review integrity or edit changes. Edits include changed paths, diff statistics, and an exact exported patch. Small patches may be inline; larger patches are returned by private artifact path. Full results add artifact digests, sizes and media types, usage, workspace paths, and transcript when requested. Replies are bounded by `limits.max_mcp_result_chars`.

Review integrity is `verified`, `changed`, or `unverified`. Inspect `changed_paths` and `reason` before relying on a review that changed during execution or could not be fully snapshotted. For edits, inspect the fresh patch and changed/residual files before close. Cleanup reports `worktree_removed` and, when cleanup is refused, a retained reason.

## Configuration

The configuration is strict TOML. The starter allowlist is empty. Removed keys—including backend selection, concurrency, idle-session TTL, and ACP paths—are errors; do not reuse the old configuration unchanged.

| Key | Meaning |
|---|---|
| `version` | Required schema version `1`. |
| `allowed_workspace_roots` | Up to 100 absolute or home-relative canonical workspace roots. Defaults to empty. |
| `retention.days` | Bounded artifact retention age. |
| `limits.review_timeout_seconds`, `limits.edit_timeout_seconds` | Default run deadlines. |
| `limits.max_turns_review`, `limits.max_turns_edit` | Default one-shot turn limits, 1–50. |
| `limits.max_event_bytes`, `limits.max_transcript_bytes`, `limits.max_artifact_bytes` | Bounded persisted output sizes. |
| `limits.worker_progress_timeout_seconds` | No-progress watchdog, `0` disables or 60–7200 seconds. |
| `limits.max_mcp_result_chars` | Maximum serialized MCP response size. |
| `paths.vibe` | Absolute executable path or bare command resolved through `PATH`. |

The exact defaults and bounds are in [`schemas/config.schema.json`](../schemas/config.schema.json). An explicit `--config` takes precedence over `VIBE_SUPERVISOR_HOME`, then the platform default. An explicit invalid or missing file fails without fallback. The reduced candidate's default data roots are `~/Library/Application Support/VibeSupervisor-oneshot` (macOS), `%APPDATA%/VibeSupervisor-oneshot` (Windows), and `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` (Linux). `VIBE_SUPERVISOR_HOME` is an explicit override. With `--isolated`, per-connection storage remains below the selected config parent. The selected path is kept for the whole connection; the `config.toml` copied into a session directory is an audit record of the file at connect time and is never read as policy.

### Policy authority

The selected configuration file is the only policy source. A running server rereads and validates it before every workspace readiness check and every start, with the same checks as at startup: a regular file of at most 1 MiB, opened without following a symlink, no symlinked parent directories, owned by the current user, not writable by group or others, strict schema, and unique roots within the allowed scope; an existing root must still be a canonical real directory, so a symlinked or over-broad root makes the whole file invalid. A missing, unsafe or invalid file fails closed with `VSUP_CONFIG_INVALID`; there is no fallback to an earlier read, a session snapshot or the defaults. An allowlisted root whose directory no longer exists (deleted or unmounted) denies only itself: it is left out of the effective allowlist, a check or start for a workspace under it fails with `VSUP_WORKSPACE_INVALID` naming the unavailable root (`details.unavailable_root`), and every other root keeps working. The server notes such roots on stderr at startup.

`allowed_workspace_roots` is live: an added root is admitted and a removed root is refused on the next check or start, without restarting Codex. Every other key is boot-bound, because the server binds it at startup: `paths.vibe` (backend executable), `retention.days` (retention schedule), `limits.max_mcp_result_chars` (tool registration), `limits.worker_progress_timeout_seconds` (watchdog of running work), and the default turn, deadline and output limits (kept together so one server never mixes two limit sets). When the file changes a boot-bound key, readiness reports `restart_required: true` with the keys in `boot_drift`, and starts fail with `VSUP_RESTART_REQUIRED` instead of adopting part of the change.

A start records the `policy_revision` it was admitted under in its run record and start reply. A running run is never changed by a later edit. When its root is removed it keeps running to its normal end, and status, result and close keep working. A start also records the canonical root that admitted it (`admitted_root`). Worktree cleanup is admitted by that frozen admission, not by the current file, so narrowing the allowlist never strands a worktree: the saved source must still be its own canonical path inside the admitted root, and every existing removal check still applies (supervisor-owned run path, Git registration, a fresh export matching the saved artifact, a pristine worktree). Dirty or uncertain worktrees are retained with their reason as before. Records written before this field existed are checked against the boot configuration's allowlist.

## CLI

- `setup` writes a template and can plan a Codex registration; it does not silently rewrite unknown settings.
- `allow <workspace>` creates a missing private config when needed, then adds that canonical workspace root. Initialize a fresh explicit `--config` path with `allow` before running doctor or serve against it.
- `doctor [--json] [--config <path>]` reports local Node, Git, config, executable, pinned Vibe checks, and the exact `application_entrypoint` and `runtime_module` that produced the report. It makes no model request and does not prove provider authentication.
- `serve --stdio [--config <path>] [--isolated]` runs the MCP server.
- `runs list|show|tail|cleanup` inspects or cleans saved runs according to ownership and fresh-export checks.

Use `vibe-supervisor <command> --help` for current options. The explicit selected config and the connection already open in a desktop client are separate facts; verify the live handshake version and five-tool catalog on the owning connection.

### Codex connection isolation

`setup` registers `serve --stdio --isolated` by default. The optional `setup --isolated` flag remains accepted. Existing non-isolated registrations are updated through the normal reviewed setup flow; configuration backup and confirmation rules are unchanged. A direct non-isolated `serve` still requires exclusive storage ownership and competing connections fail closed. Isolation changes storage ownership, not workspace permissions.

Saved UUIDs remain usable through `vibe_status`, `vibe_result` and `vibe_close` when an isolated reconnect selects a different free store. Lookup covers at most 128 entries in the selected configuration’s private `mcp-sessions` namespace. It requires a unique safe record and exclusive ownership of its store; a live owner, duplicate UUID or unsafe path returns an error without replaying the task.
