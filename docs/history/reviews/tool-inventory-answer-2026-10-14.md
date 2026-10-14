# Does Vibe 2.26.1 reach the model only through the checked tool inventory? (2026-10-14)

Answers the open question in the [rc.1 cold review](rc1-cold-review-2026-10-14.md). Answered on the preparing machine from Vibe's public source; no Vibe was installed or run.

## Provenance

Source read at tag `v2.26.1` of `mistralai/mistral-vibe` (tag commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0`). The two functions the launcher pins, `ToolManager.available_tools` and `BaseTool.invoke`, hash to exactly the values in `src/backends/runtime/vibe_supervisor_launcher.py` (`93ca0fc7…`, `7e178d97…`), so the tag is the source the target runs. File SHA-256 at the tag: `vibe/core/tools/manager.py` `a2d5fc65…`, `vibe/core/llm/format.py` `739d8c02…`, `vibe/core/agent_loop/_loop.py` `15250197…`, `vibe/core/tools/base.py` `70d706fa…`, `vibe/core/skills/manager.py` `5ac053f4…`.

The forced `--legacy-harness` runs the Python agent loop (`vibe/core/agent_loop/_loop.py`); the Unified Harness is a separate Rust engine and is out of scope until the adapter.

## Verdict: COVERED for tools, with one non-tool path to close

| Path | Where | Goes through `available_tools`? |
|---|---|---|
| Tool schemas sent to the model, including after compaction | `APIToolFormatHandler.get_available_tools` → `ToolManager.available_tool_specs` | Yes |
| Resolving a model's tool call | `APIToolFormatHandler.resolve_tool_calls`; unknown names become failed calls | Yes |
| Executing a resolved call | `_execute_tool_call` → `ToolManager.get`, which raises for any name not available | Yes |
| Streaming tool-call events | `available_tools.get(name)`, skipped when absent | Yes |
| `@file` mentions in the task | `_inject_mentioned_files` → `ToolManager.get("read_file")`; skipped if unavailable; `read_file`'s own path checks apply | Yes |
| MCP and connector tools | added to `_all_tools`, then filtered by `available_tools` | Yes |
| `/name` at the start of the task text | `_inject_invoked_skill` injects a skill's content; the `skill` tool falls back to `SkillTool` when unavailable | No, but no tool runs |

The last row is not a tool exposure: it puts a skill's text into the conversation. Vibe 2.26.1 ships two built-in skills (`vibe`, `skill-creator`) that the private `VIBE_HOME` does not remove, and the supervisor sets no `enabled_skills` or `disabled_skills`. A task that starts with `/vibe` or `/skill-creator` would get that text injected. The task comes from the coordinator, so this is low severity, but it contradicts "skills are not inherited".

## Recommendation for rc.2

Current practice for agent tool control is deny by default, enforced in code at the point of action rather than at discovery or in the prompt (OWASP Top 10 for Agentic Applications 2026, tool misuse and privilege abuse). The rc.1 check guards discovery; rc.2 should also guard the action, so safety no longer depends on every upstream path being found:

1. In the existing `BaseTool.invoke` wrapper, refuse any tool whose name is not in the exact profile, whether or not diagnostics are on. Every tool execution passes through `invoke`, so this holds even if Vibe adds a path.
2. Pin the source hashes of the two chokepoints above, `APIToolFormatHandler.get_available_tools` and `resolve_tool_calls`, so a change in how Vibe builds or resolves tools fails closed.
3. Close the skill path: set `disabled_skills` to all skills in the launcher's private config, or refuse task text whose first character is `/`.
4. Prove it with a test, not a reading: extend `tests/fixtures/vibe-profile-check.py` (runs installed Vibe offline on the target, no provider) with a call to a tool outside the profile through `invoke` and through `ToolManager.get`, both refused, and a `/vibe` task that injects nothing.
