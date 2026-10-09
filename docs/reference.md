# Reference

Tools, fields, results, configuration keys and CLI commands of `vibe-supervisor`. Behavior that is not reference material is in [How it works](functionality.md); error codes are in [errors.md](errors.md).

## Tools

The server speaks MCP over stdio: frames on stdout, diagnostics on stderr. Inputs use strict schemas, so an unknown field (for example `allow_shell`, `backend` or `detail: "summary"`) is rejected with `VSUP_INVALID_ARGUMENT`. The schemas live in `src/mcp/schemas.ts`.

| Tool | Registered | Purpose |
|---|---|---|
| `vibe_review_start` | always | Start a read-only review in an allowed workspace. |
| `vibe_edit_start` | always | Start an edit in a detached Git worktree. |
| `vibe_status` | always | Read state and bounded events; embeds the compact result once the run has settled. |
| `vibe_result` | always | Read the full record or the transcript. |
| `vibe_close` | always | Cancel the run if it is live, close it, optionally remove a verified worktree. |
| `vibe_continue` | backend `acp` or `auto` | Send a follow-up to a completed, ready or recoverable ACP run. |
| `vibe_respond` | backend `acp` or `auto` | Answer a pending permission or input request. |

The backend comes only from the configuration. There is no cancel tool (`vibe_close` cancels), no shell switch and no tool-side backend selection. The usual loop is: start with `wait_seconds`, then `vibe_status` with `wait_seconds` until `result` appears, independent verification and any same-session correction, then a fresh export and `vibe_close`. Do not close a candidate session before deciding acceptance. Keep the client's tool timeout above 300 seconds; `configure-codex` writes `tool_timeout_sec = 600` and `startup_timeout_sec = 30`.

### Inputs

`run_id` is always a UUID v4 returned by a start tool.

| Tool | Field | Type and bounds | Default |
|---|---|---|---|
| `vibe_review_start` | `task` | string, 1 to 100000 characters | required |
| | `cwd` | string, 1 to 4096 characters, a workspace under an allowed root | required |
| | `context_files` | up to 50 strings of 1 to 4096 characters | `[]` |
| | `max_turns` | integer 1 to 50 | `limits.max_turns_review` |
| | `timeout_seconds` | integer 30 to 7200 | `limits.review_timeout_seconds` |
| | `wait_seconds` | integer 0 to 300 | 0 |
| `vibe_edit_start` | `task`, `cwd`, `max_turns`, `timeout_seconds`, `wait_seconds` | as above, except that `cwd` must be the root of a Git repository (a subdirectory is refused with `VSUP_WORKSPACE_INVALID` before any worktree is created) | edit limits `limits.max_turns_edit`, `limits.edit_timeout_seconds` |
| | `base_ref` | string, 1 to 512 characters, an existing Git ref | `HEAD` |
| `vibe_status` | `run_id` | UUID | required |
| | `after_seq` | integer 0 or more | 0 |
| | `max_events` | integer 0 to 100 | 10 |
| | `wait_seconds` | integer 0 to 300 | 0 |
| `vibe_continue` | `run_id`, `message`, `max_turns` | UUID; string 1 to 100000 characters; integer 1 to 50 | `run_id` and `message` required; `max_turns` has no default and a limit is never raised implicitly. It is the session's cumulative ceiling, not an increment: a value below the run's current limit fails with `VSUP_INVALID_ARGUMENT`. After a `max_turn_requests` stop it is required and must exceed the current limit, otherwise the call fails with `VSUP_TURN_LIMIT_REACHED` before anything reaches Vibe; at the maximum of 50 the session cannot be extended and a new run is needed. The new value becomes the run's limit and is sent with `session/set_config_option` before the prompt. |
| `vibe_respond` | `run_id`, `request_id` | UUID; string 1 to 512 characters | required |
| | `kind` | `permission` or `elicitation` | required |
| | `option_id` | permission only: an offered option, 1 to 512 characters | required |
| | `action` | elicitation only: `accept`, `decline` or `cancel` | required |
| | `content` | elicitation only: object matching the request schema | none |
| `vibe_result` | `run_id` | UUID | required |
| | `detail` | `compact` or `full` | `compact` |
| | `include_transcript` | boolean | `false` |
| `vibe_close` | `run_id` | UUID | required |
| | `cleanup_worktree` | boolean | `false` |

### Waiting inside a call

With a positive `wait_seconds`, `vibe_status` returns as soon as any of these holds, or when the wait elapses: an event with `seq` above `after_seq` exists, the run state differs from its state at call time, a request is pending, or the run is in a state that needs the coordinator (`completed`, `failed`, `cancelled`, `closed`, `waiting_permission`, `waiting_input`, `recoverable`). A condition that already holds returns at once, so pass the reply's `next_after_seq` back as `after_seq`. The wait ends on MCP request cancellation and on shutdown.

The start tools accept the same `wait_seconds` and wait until the run needs the coordinator; an intermediate change such as `starting` to `running` does not end the wait. A finished run returns its compact result inside the start reply.

## Replies

Every reply carries `next_action`, a one-sentence instruction for the next call.

| Reply | Fields |
|---|---|
| Start | `run_id`, `state`, `backend`, `mode`, `source_workspace`, `worker_workspace`, `created_at`, `next_action`; `base_ref` for edits; `pending_request`, `error` and `result` when they apply. |
| `vibe_status` | `run_id`, `state`, `backend`, `last_seq`, `next_after_seq`, `events`, `next_action`; `pending_request`, `error`, `warnings` when present; `result` once the run is `completed`, `failed` or `cancelled`. |
| `vibe_continue`, `vibe_respond` | `run_id`, `state`, `next_action`. |
| `vibe_close` | `run_id`, `state`, `next_action`, `worktree_removed`; `worktree_retained_reason` and `error` when cleanup was refused or a step failed. |

`events` hold at most `max_events` entries of `seq`, `type` and, for tool calls, `title`, `kind` and `status`. Events of type `diagnostic`, `review_integrity`, `timeout` and `permission_denied_by_policy` also carry `text` (redacted, at most 400 characters). `last_seq` is the newest event in the run and may be ahead of the page; `next_after_seq` is the `seq` of the last delivered event, or `after_seq` when none was delivered.

### Results

`vibe_result` with `detail: "compact"` (and the `result` embedded in a settled `vibe_status` or start reply) returns:

| Field | Meaning |
|---|---|
| `run_id`, `state`, `backend`, `next_action` | Identity, state and the next call. |
| `stop_reason` | How the last turn ended. A `completed` run with a value other than `end_turn` (`max_tokens`, `max_turn_requests`, `refusal`, `cancelled` or an unknown string) stopped early; `warnings` then gains an entry starting "Vibe stopped with stop reason" and `summary` is derived from the reason unless the backend gave one. |
| `summary`, `warnings`, `error` | Public summary, warnings and the failure, if any. |
| `integrity` | Reviews only: see below. |
| `changed_files`, `changed_files_total` | Up to 50 changed paths, with the total. Edits. |
| `diff_stat` | At most 2000 characters. Edits. |
| `patch` or `patch_path` and `patch_bytes` | The patch inline when it is at most 4000 bytes and the payload fits `limits.max_mcp_result_chars`; otherwise its path and size. |
| `artifacts` | `{name, path}` per artifact: `transcript.md`, `events.ndjson`, and for edits `diff.patch`, `diff.stat`, `changed-files.json`. |
| `worker` | Edits: the worker worktree. |
| `transcript`, `transcript_truncated`, `transcript_path` | With `include_transcript`: the last 4000 characters. |

`detail: "full"` adds workspace paths, per artifact SHA-256 digest, byte count and media type, usage and an inline transcript up to 32 KiB. A later turn replaces `stop_reason`, `summary` and the stop-reason warning; other warnings carry over.

**Integrity.** Review results carry `integrity.status`: `verified` (nothing changed), `changed` (with `changed_paths`, up to 50 relative paths, `changed_paths_total` and a `reason`) or `unverified` (with a `reason`, for example when the workspace was too large to snapshot). `write_tool_observed` is true when the run issued a write-capable tool call. A changed workspace is a warning, not a failure; inspect the paths before trusting the review. Edit runs have no integrity record.

### Result encoding and size

`limits.mcp_result_format` selects the wire format: `text` (default, one JSON text block), `structured` (`structuredContent` plus a short pointer text) or `both`. Error results use the same format. A reply is bounded to `limits.max_mcp_result_chars` (default 8000). When it is larger it is reduced in this order until it fits: the inline `patch` (keeping `patch_path` and `patch_bytes`), `transcript`, `diff_stat`, `changed_files` and `events` (totals are kept), then `summary` (head and tail kept). `run_id`, `state`, `error`, `warnings`, `integrity`, `pending_request`, `patch_path` and `next_action` are never dropped. A reduced reply carries `truncated: true` and `truncated_fields`. `events` are trimmed from the end so paging stays lossless: the reply's `next_after_seq` (and the `after_seq` in `next_action`) is the `seq` of the last event actually delivered, or just before the first event when none fit, and `events_total` counts the events before trimming.

## Run states

| State | Meaning |
|---|---|
| `queued`, `starting`, `negotiating`, `ready`, `running` | Waiting for a slot, launching, initializing, idle between turns, working. |
| `waiting_permission`, `waiting_input` | ACP run paused for `vibe_respond`. |
| `completed`, `failed`, `cancelled` | Terminal outcomes; the result is available. `completed` ACP runs can still be continued. |
| `recoverable` | Found unfinished after a restart; ACP runs with a saved session can be continued. |
| `closing`, `closed` | Closed by `vibe_close`; the run stays readable until retention. |

## Configuration

Run `vibe-supervisor init` (or `setup`) to create the private config, then edit it. The location is `~/Library/Application Support/VibeSupervisor/config.toml` on macOS (`$XDG_DATA_HOME/vibe-supervisor` or `~/.local/share/vibe-supervisor` on Linux); `VIBE_SUPERVISOR_HOME` overrides the directory and must also reach the MCP server's environment. Validate with `vibe-supervisor doctor --config <path>`. A complete example is [examples/config.toml](../examples/config.toml), and the JSON schema is `schemas/config.schema.json`.

| Key | Default | Bounds |
|---|---|---|
| `version` | required | `1` |
| `backend` | `programmatic` | `programmatic`, `acp` or `auto`; `acp` and `auto` also register `vibe_continue` and `vibe_respond` |
| `allowed_workspace_roots` | `[]` (denies all work) | up to 100 directories, each an absolute path or one starting with `~/` (or `~`); relative paths are rejected, and each entry is canonicalized when a workspace is checked |
| `max_concurrent_runs` | 2 | 1 to 32 |
| `max_queued_runs` | 8 | 0 to 256 |
| `worker_idle_ttl_seconds` | 600 | 0 to 86400 |
| `retention.days` | 7 | 0 to 3650 |
| `retention.preserve_failed_runs` | `true` | boolean |
| `limits.review_timeout_seconds` | 1800 | 30 to 7200 |
| `limits.edit_timeout_seconds` | 2400 | 30 to 7200 |
| `limits.max_turns_review` | 20 | 1 to 50 |
| `limits.max_turns_edit` | 20 | 1 to 50 |
| `limits.max_event_bytes` | 52428800 | 1024 to 1073741824 |
| `limits.max_transcript_bytes` | 10485760 | 1024 to 1073741824 |
| `limits.max_artifact_bytes` | 104857600 | 1024 to 2147483648 |
| `limits.worker_progress_timeout_seconds` | 600 | `0` (disabled) or 60 to 7200; a running worker with no activity for this long (no vibe event, ACP notification or request, complete programmatic stdout line, or stderr output) fails with `VSUP_NO_PROGRESS` |
| `limits.max_mcp_result_chars` | 8000 | 1000 to 1000000 |
| `limits.mcp_result_format` | `text` | `text`, `structured`, `both` |
| `paths.vibe` | found on PATH | absolute path or a bare command name resolved from PATH (no other relative paths), up to 4096 characters |
| `paths.vibe_acp` | found on PATH | absolute path or a bare command name resolved from PATH (no other relative paths), up to 4096 characters |
| `paths.data_dir` | the config directory | absolute path; rejected with `--isolated` |

Unknown keys are rejected. Shell tools, network tools, raw ACP logging and reasoning persistence are always off and have no key.

**Removed keys.** `phase1.allow_temporary_trust`, `security.allow_shell_in_review`, `security.allow_shell_in_edit`, `security.allow_network_tools`, `security.log_raw_acp` and `security.persist_reasoning` still load, are ignored, and are listed on one stderr line at startup and by `doctor`. A value that would loosen policy is never honored.

## CLI

Installed use is `vibe-supervisor <command>`.

| Command | Purpose |
|---|---|
| `setup --workspace <dir> [--codex user\|project] [--isolated] [--yes]` | Plan every change first (a malformed Codex config aborts before anything is written), then create the config if missing, add the canonical workspace, fill `[paths]` from PATH, run doctor (non-PASS lines only), then show the Codex change; written only with `--yes` or an interactive confirmation. Refuses `/` and the home directory. Rewriting an existing `config.toml` drops its comments and layout and keeps a `config.toml.bak-<timestamp>` copy. A running MCP server must be restarted (reconnected for `--isolated`) to read a changed allowlist. |
| `allow <dir>` | Add one canonical workspace root; idempotent, including for roots written with `~`. Symlinked or missing directories, `/` and the home directory are refused. A change rewrites `config.toml` (comments and layout are lost; the previous file is kept as `config.toml.bak-<timestamp>`) and needs a restart of the Codex MCP server, or a reconnect for `--isolated`, to take effect. |
| `doctor [--json] [--config <path>]` | Report local prerequisites without a model request; `--config` validates that file and warns about ignored keys. Its `acp-initialize` check negotiates ACP without a prompt. |
| `serve --stdio [--isolated]` | Run the MCP server. The client owns stdin and stdout. |
| `init` | Create a private starter config; refuses to overwrite. |
| `configure-codex --user\|--project [--path <dir>] [--dry-run] [--isolated]` | Write (or with `--dry-run` preview) the `mcp_servers.vibe-supervisor` entry in the Codex config, backing up a nonempty file. `--path` needs `--project`. |
| `baseline prepare <manifest> [--create]` | Validate a reviewed overlay; explicit creation writes only an independent private snapshot repository. |
| `audit-edit <home> <run-id> [--files <absolute-scope.json>]` | Audit settled edit evidence; scope lists describe tool arguments, not candidate acceptance. |
| `runs list`, `runs show <id>`, `runs tail <id>` | Inspect saved runs. |
| `runs cleanup [run-id]` | Retention sweep, or safe cleanup of one `failed`, `cancelled` or `closed` run. Stop the server first: storage has one owner. |
| `--version` | Print the version. |

`config validate [path]` and `test-acp` still work as aliases and print a one-line pointer to `doctor` on stderr. Exit status is 0 on success, 2 for usage errors and 1 otherwise; errors print `CODE: message remedy` on stderr.

Run records and private histories can contain source content despite filtering; keep the data directory private.

## Run provenance

New runs persist `supervisor_version`, the release that created the run. Start, status, result, continuation and close responses expose it. Existing runs retain their recorded creator release across restart or continuation; legacy records return `null` in public run responses and remain absent in persisted metadata. The MCP initialization server version identifies the currently connected executable separately. A diagnostic event `reason` is not the backend structured `stop_reason`; preserve the two fields separately.

## Coordinator baseline and audit CLI

`baseline prepare manifest.json [--create]` reads an owner-private JSON manifest with `source`, `baseRef`, `outputParent`, and `entries`. Each entry has a relative `path`, `operation` (add/replace/delete), `baseSha256` (null for additions), `reviewedSha256` (null for deletions), and `mode` (100644/100755 for writes). Selected content comes from the source, never from an embedded patch. Dry-run is the default. Explicit creation makes local commits only in a new disposable snapshot repository. Existing source files/index/refs and config stay unchanged. The output parent must be owner-private and inside an existing allowed root, outside the source.

Bounds: 64 overlays, 4096 base/final files, 2 MiB per file, 100 MiB total tree. Overlays must be regular UTF-8 text; binary base blobs are permitted within bounds. Sensitive filenames/recognized credentials, links/submodules, ignored/reserved overlays, conflicting/case-colliding paths and external Git filters are refused. Tracked AGENTS/.agents in the base retain discovery isolation. The output manifest is owner-read-only and hash-bound. Failed creations retain an owner-private output and generic failure marker for explicit recovery; no uncertain deletion/replay is attempted.

`audit-edit canonical-private-home run-id [--files /absolute/private/scope.json]` reads settled pinned-Vibe ACP edit evidence safely and returns only allowlisted counts/classes, creator version and recognized stop reason. It makes no model request and changes no permissions. Missing or incompatible evidence returns unverified. This command does not certify candidate behavior, all task scope, billing, restart or other hosted gates.

Audit scope evidence: `argument_scope` describes only declared tool-call paths when a coordinator supplies a scope list directly to the module. `declared_scope` remains `unverified`: actual candidate/export and symlink targets require independent review. The CLI supplies that list only with an explicit `--files` owner-private JSON file: 1–64 unique repository-relative strings, each at most 1024 characters. Absolute, empty/dot/traversal, leading-dash components, backslash, control and colon paths are rejected. With a scope list, `status` is `validated` only when `argument_scope` is `within_declared_arguments`: a write outside the list, a write whose path cannot be read, or a successful call to any tool other than read, search and file edits makes the report `unverified` and the CLI exit non-zero. `policy_denial_events` counts the supervisor's policy denials and the backend's refused permission requests; a call gets the `policy_denied` class when the denial names its tool-call ID, which the backend refusal does and the supervisor denial, keyed by request ID, does not. Ancestor ownership/write permissions and identities are checked before/after reads, with root-owned sticky temporary directories permitted. These application checks do not resist malicious concurrent mutation by another process running as the same account.
