# Reference

The supervisor uses MCP over stdio. Standard output carries protocol frames; diagnostics go to standard error. Tool schemas reject unknown fields, including removed `backend`, `allow_shell`, `vibe_continue`, and `vibe_respond` fields. See [behavior](functionality.md), [security](security.md), and [errors](errors.md).

## Tools

Exactly five tools are registered in every server instance:

| Tool | Purpose |
|---|---|
| `vibe_review_start` | Start one read-only review in an allowed workspace. |
| `vibe_edit_start` | Start one edit from an explicit Git base in a detached supervisor worktree. |
| `vibe_status` | Read state and bounded events; includes compact result when settled. |
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
| `vibe_edit_start` | `task`, `cwd` | as above; `cwd` must be the Git repository root | required |
| | `base_ref` | existing Git ref, 1–512 characters | `HEAD` |
| | `max_turns`, `timeout_seconds`, `wait_seconds` | same bounds as review | configured defaults, then `0` for wait |
| `vibe_status` | `run_id` | UUID v4 | required |
| | `after_seq` | integer ≥0 | `0` |
| | `max_events` | integer 0–100 | `10` |
| | `wait_seconds` | integer 0–300 | `0` |
| `vibe_result` | `run_id` | UUID v4 | required |
| | `detail` | `compact` or `full` | `compact` |
| | `include_transcript` | boolean | `false` |
| `vibe_close` | `run_id` | UUID v4 | required |
| | `cleanup_worktree` | boolean | `false` |

Start calls can wait until the run needs coordinator attention. For longer work, use cursor-based status calls and pass `next_after_seq` as the next `after_seq`; waits are bounded to 300 seconds. A completed run can carry a non-`end_turn` stop reason and partial-result warning. Read the stop reason before trusting its summary.

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

The exact defaults and bounds are in [`schemas/config.schema.json`](../schemas/config.schema.json). An explicit `--config` takes precedence over `VIBE_SUPERVISOR_HOME`, then the platform default. An explicit invalid or missing file fails without fallback. The reduced candidate's default data roots are `~/Library/Application Support/VibeSupervisor-oneshot` (macOS), `%APPDATA%/VibeSupervisor-oneshot` (Windows), and `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` (Linux). `VIBE_SUPERVISOR_HOME` is an explicit override. With `--isolated`, per-connection storage remains below the selected config parent.

## CLI

- `setup` writes a template and can plan a Codex registration; it does not silently rewrite unknown settings.
- `allow <workspace>` creates a missing private config when needed, then adds that canonical workspace root. Initialize a fresh explicit `--config` path with `allow` before running doctor or serve against it.
- `doctor [--json] [--config <path>]` reports local Node, Git, config, executable, pinned Vibe checks, and the exact `application_entrypoint` and `runtime_module` that produced the report. It makes no model request and does not prove provider authentication.
- `serve --stdio [--config <path>] [--isolated]` runs the MCP server.
- `runs list|show|tail|cleanup` inspects or cleans saved runs according to ownership and fresh-export checks.

Use `vibe-supervisor <command> --help` for current options. The explicit selected config and the connection already open in a desktop client are separate facts; verify the live handshake version and five-tool catalog on the owning connection.
