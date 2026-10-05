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

`vibe_result` takes `detail`: `compact` (default) or `full`; `summary` is accepted as a deprecated alias of `compact`. Compact returns `run_id`, `state`, `backend`, `stop_reason`, `summary`, `warnings`, `error`, up to 50 `changed_files` with `changed_files_total`, `diff_stat` (at most 2000 characters), the patch inline as `patch` when the patch artifact is at most 4000 bytes (otherwise `patch_path` and `patch_bytes`), artifacts as `{name, path}`, and `worker` for edits. With `include_transcript`, compact returns the last 4000 characters as `transcript`, with `transcript_truncated` and `transcript_path`. `full` adds workspace paths, SHA-256 digests, byte counts, media types, usage, and an inline transcript up to 32 KiB.

## Result encoding

`limits.mcp_result_format` selects how a result crosses the wire:

- `text` (default): one JSON text block, no `structuredContent`.
- `structured`: `structuredContent` plus a pointer text block such as `{"run_id":"...","state":"running","see":"structuredContent"}`.
- `both`: the same JSON as text and `structuredContent`.

Error results use the same format. No tool declares an `outputSchema`, so `structuredContent` is optional under the MCP specification. A result is bounded to `limits.max_mcp_result_chars` (default 8000): verbose fields are shortened first, while run and artifact references are retained. MCP transport/schema validation can reject malformed requests before supervisor error normalization.
