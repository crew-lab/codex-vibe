# MCP tools

The server uses the official MCP stdio transport. Stdout contains protocol frames only; status messages and failures go to stderr. Tool inputs use strict schemas and unknown fields are rejected.

| Tool | Purpose |
|---|---|
| `vibe_review_start` | Start a read-only review in an allowed workspace. |
| `vibe_edit_start` | Start an isolated edit in a detached worktree. |
| `vibe_status` | Read normalized state and bounded events. |
| `vibe_continue` | Send a follow-up to a live run. |
| `vibe_respond` | Answer a pending permission or input request; unknown requests fail closed. |
| `vibe_result` | Read summary and artifact references, optionally transcript. |
| `vibe_cancel` | Request cancellation. |
| `vibe_close` | Close a run and optionally remove a verified worktree. |

## Waiting inside a call

`vibe_status` accepts `wait_seconds` (integer 0 to 300, default 0). With a positive value the call returns as soon as any of these holds, or when the wait elapses:

- an event with `seq` greater than `after_seq` exists
- the run state differs from its state at call time
- a permission or input request is pending
- the run is in a state that needs the coordinator: `completed`, `failed`, `cancelled`, `closed`, `waiting_permission`, `waiting_input` or `recoverable`

A condition that already holds returns immediately. The wait is event-driven, ends on MCP request cancellation, and is released when the supervisor shuts down. Advance `after_seq` to the last event received, or the call returns at once.

`vibe_review_start` and `vibe_edit_start` accept the same `wait_seconds`. After starting, the call waits until the run needs the coordinator (the list above, or a pending request); an intermediate change such as `starting` to `running` does not end it. The result carries the current `state`, `run_id` and worker paths, plus `pending_request` or `error` when present, and the compact result when the run is `completed`, `failed` or `cancelled`.

Keep the client's tool timeout above 300 seconds. `configure-codex` writes `tool_timeout_sec = 600` for this reason.

## Result shape

`vibe_status` returns at most `max_events` (default 10) events.

When a completed turn ends with a `stop_reason` other than `end_turn` (ACP values `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`, or any unknown string), the run stays `completed`, `warnings` gains an entry beginning "Vibe stopped with stop reason" and naming the reason, and `summary` is derived from the reason unless the backend supplied one. A later turn replaces the stop reason, summary and that warning; other warnings carry over.

`vibe_result` takes `detail`: `compact` (default) or `full`; `summary` is a deprecated value that returns the `full` shape plus a `deprecation` string ("detail=summary is deprecated; use detail=compact (default) or detail=full."). Compact returns `run_id`, `state`, `backend`, `stop_reason`, `summary`, `warnings`, `integrity` (reviews), `error`, up to 50 `changed_files` with `changed_files_total`, `diff_stat` (at most 2000 characters), the patch inline as `patch` when the patch artifact is at most 4000 bytes and the whole compact payload stays within `limits.max_mcp_result_chars` (otherwise `patch_path` and `patch_bytes`), artifacts as `{name, path}`, and `worker` for edits. With `include_transcript`, compact returns the last 4000 characters as `transcript`, with `transcript_truncated` and `transcript_path`. Review runs carry an `integrity` object in `result.json` and in both compact and full `vibe_result`: `status` (`verified`, `changed` or `unverified`), `write_tool_observed`, and for `changed` also `changed_paths` (at most 50 relative paths) with `changed_paths_total` and a `reason`; `unverified` carries a `reason`. Edit runs have none. `full` adds workspace paths, SHA-256 digests, byte counts, media types, usage, and an inline transcript up to 32 KiB.

## Result encoding

`limits.mcp_result_format` selects how a result crosses the wire:

- `text` (default): one JSON text block, no `structuredContent`.
- `structured`: `structuredContent` plus a pointer text block such as `{"run_id":"...","state":"running","see":"structuredContent"}`.
- `both`: the same JSON as text and `structuredContent`.

Error results use the same format. No tool declares an `outputSchema`, so `structuredContent` is optional under the MCP specification. A result is bounded to `limits.max_mcp_result_chars` (default 8000). When it is larger, the top level and the nested `result` of a start call are reduced in this order until it fits: drop the inline `patch` (keeping `patch_path` and `patch_bytes`), cap `transcript`, cap `diff_stat`, trim `changed_files` and `events` (totals kept in `changed_files_total` and `events_total`), then cap `summary` keeping its head and tail around a marker. `run_id`, `state`, `error`, `warnings`, `integrity`, `pending_request`, `patch_path` and `next_action` are never dropped. A reduced result carries `truncated: true` and `truncated_fields`. Only if it still does not fit does a minimal fallback with those protected fields (as many as fit) and the first artifact apply. MCP transport/schema validation can reject malformed requests before supervisor error normalization.
