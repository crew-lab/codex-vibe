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

Results have structured content and concise text; verbose fields are bounded while run and artifact references are retained. MCP transport/schema validation can reject malformed requests before supervisor error normalization.
