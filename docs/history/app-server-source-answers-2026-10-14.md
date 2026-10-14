# Vibe app-server source answers at v2.26.1 (2026-10-14)

Follow-up to the [protocol audit](app-server-protocol-audit-2026-10-14.md) and the [design note](app-server-client-design.md), answering six questions its step 1 left open. Same tag, `v2.26.1` = commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0`, read from the extracted tag source; nothing installed or run. Hashes for the overlapping files equal the audit's. Prefixes: `AS/` = `vibe/app_server/`, `HR/` = `harness/runtimes/python/python/mistralai_vibe_local_harness/`, `RS/` = `harness/core/src/core/`. Hashes are at the end. UNKNOWN marks what could not be established.

## 1. toolName in the approval callback

The wire name is the namespaced runtime route, never the model-visible short name.

| Tool | `detail.effect.toolName` |
|---|---|
| read | `file_system.read_file` |
| write | `file_system.write_file` |
| edit | `file_system.search_replace` |
| shell | `file_system.bash` |

Trace:
1. Core maps the model-visible `read_file`, `write_file`, `edit` to the runtime builtin; the string is `RuntimeBuiltinToolName::as_str` (`RS/tools/external.rs`; `RS/features/file_system/mod.rs` `ToolName::runtime_tool`; test `direct_filesystem_tools_keep_bare_names_and_filesystem_routes` in `RS/tools/execution/mod.rs`).
2. `_approval_callback` (`HR/vibe/_session.py`) builds the callback: `effect.kind = "tool"`, `toolName = gated_tool_name(action)` = `action.call.name`, `input = action.call.arguments` (raw runtime arguments), callback id `approval-<callId>` (plus `-<hex>` when reused), `relatedEntryId = effect-<actionId>`, title `Approve <toolName>`.
3. The adapter's `_callback_events` calls `_project_history_entry`, then `project_unified_history_entry` and `_project_call` (`AS/_unified_tool_projection.py`). `_PATH_PROJECTORS` is keyed by `file_system.*`, and each projector copies `tool_name=detail.tool_name`, so the name survives.
4. `_TOOL_NAME_ALIASES` (`AS/_unified_harness_backend_adapter.py`) maps `file_system.*` to `read_file`, `write_file`, `edit` only inside `_terminal_tool_effect`, which builds telemetry. It never touches a wire entry.
5. Effect entries use the same name (`_effect_detail`, `HR/vibe/_projection.py`), id `effect-<actionId>`.

The projector table also lists bare `read_file`, `write_file`, `search_replace`; which producer emits those was not traced, so a strict client matches only the `file_system.*` names.

## 2. Effect input shapes

Wire keys are camelCase: `ProtocolModel` has `alias_generator=to_camel`, `serialize_by_alias=True` (`AS/_model.py`).

| Tool | Kind | Projected input | Fallback when projection fails |
|---|---|---|---|
| read | `file_read` | `{filePath, offset, limit}` | `kind:"tool"`, `{path, offset, limit}` |
| write | `file_write` | `{filePath, content}` | `kind:"tool"`, `{path, content}` |
| edit | `file_edit` | `{filePath, changes:[{oldString, newString, replaceAll}]}` | `kind:"tool"`, `{file_path, content:[{old_str, new_str, replace_all}]}` |

- `filePath` is the path as the model wrote it, relative or absolute. Only `display` is rebased onto the workspace roots.
- `offset` is the display offset: null for 0, offset+1 for a positive one. `limit` defaults to 2000 and may be null (`_project_read`, `_display_offset`).
- Edit is always the batch class `FileEditEffectBatchInput`. The single class `FileEditEffectInput` (`filePath, oldString, newString, replaceAll`) is in the `FileEditEffectDetail.input` union but `_project_search_replace` never emits it. Core turns the model's single `old_string/new_string` into one `content` block (`edit_runtime_arguments`), so `changes` has one element.
- A projection failure (empty path, `old_str == new_str`, empty `content`) leaves the entry generic with raw snake_case input. Deny anything not of the expected kind.

`AS/_effect_models.py` kinds, one detail class each: `tool` (generic, any JSON input), `shell`, `file_edit`, `file_search`, `file_read`, `todo`, `file_write`, `user_question`, `web_search`, `web_fetch`, `skill`, `subagent`, `worktree`, `process` (JSON input), `scratchpad`. `_EffectDetailBase` makes `toolName` and `display` required. The profile's tools only produce `file_read`, `file_write`, `file_edit`, plus `shell` and the generic kind for tools outside it. A required permission is `{scope, invocationPattern, sessionPattern, label}`.

## 3. config/effective/read and runtime/read

`config/effective/read` returns `{config: {...}}`. The inner object is `VibeConfigSchema.model_dump(mode="json")`, redacted, with `bypass_tool_permissions` replaced by the session's value (`effective_config_response`, `AS/_config_introspect.py`). It is a plain `dict[str, JsonValue]`, so keys stay snake_case at every depth.

| Wanted | Where | Notes |
|---|---|---|
| per-tool `permission` | `config.tools.<name>.permission` | `tools` holds overrides only; built-in defaults are not expanded. Present when a layer sets it: the agent profile (installed into the same orchestrator by `AgentManager` before the read), TOML, or `VIBE_TOOLS__<NAME>__PERMISSION`. Absent means the tool's default |
| `enable_subagents`, `enable_background_processes` | top level booleans | default true |
| `disabled_skills` | top level `list[str]` | |
| `session_logging` | `{save_dir, session_prefix, enabled, generate_titles}` | |
| thinking | `config.models.<alias>.thinking` | the map is keyed by alias; `active_model` may be the unpinned sentinel, so prefer `runtime/read` `config.activeModel.thinking` |
| `enabled_tools`, `disabled_tools`, `mcp_servers` | top level | from the session options (`_session_config_overrides`, `AS/_runtime.py`) |

`runtime/read` returns `{runtime, sessionLog, ready}` (`ready` = experiments settled). `RuntimeSnapshot` (`AS/protocol.py`) carries `config`, `activeAgent`, `agents`, `skills[]`, `tools[{name, isCustom}]`, `stats`, `contextWindow`, `issues[{file, message}]`, `hooksCount`, `connectors`, `mcp`, `bypassToolPermissions`, `experimentalHarness`. Details:
- `config` is `ConfigView`: no tool permission, subagent or logging fields; `activeModel` has `thinking` and `thinkingLevels`.
- `connectors` is the count object `{connected, total}`; `mcp` is `{sources[], discoveryErrors, connectorError, manageConnectorsUrl}`.
- `tools` has names only, so permission is read from the effective config.
- `experimentalHarness` is true on the Unified derivation (`build_unified_runtime_snapshot`).
- `contextWindow` is the active model's `auto_compact_threshold`.

## 4. Nested run_typescript calls

Identical to a direct call. The program call resolves through `resolve_program_call` (`RS/tools/resolved/mod.rs`) to the same `Action::RuntimeBuiltinTool` with the same `RuntimeBuiltinToolName`; edit arguments go through the same `edit_runtime_arguments`. Python handles it in the same `_execute` and `_gate_tool_call` path. The callback and effect entries therefore carry `file_system.*` names and the shapes of section 2, with no field marking nesting or the parent call, and no history entry for `run_typescript` itself exists in `HR/vibe/_projection.py` (only the tool-discovery effect `effect-tool-discovery-<callId>`). Programmatic provided tools (MCP, connectors) surface as generic `kind:"tool"` named `<group>.<tool>`. Evidence is Rust unit tests (`routes_programmatic_filesystem_effects_then_replays_typescript`, the hook-key equality test in `RS/features/programmatic_tool_calling/execution.rs`) and code reading; nothing ran, so the target no-inference scenario stays needed.

## 5. session/history/list paging

Params `{sessionId, turnId?, page:{cursor?, limit, direction}}`: `limit` 1 to 500, default 200; `direction` `backward` (default) or `forward` (`PageRequest`, `AS/protocol.py`). `session/start` `historyLimit` has the same bounds. Result `{items, nextCursor, previousCursor}`. `history_page` (`AS/_state.py`) and `_HistoryWindows.list` (adapter):
- A cursor is an entry id, an opaque string; nothing else is encoded.
- Items inside a page are always oldest first.
- Backward, no cursor: the last `limit` entries. With a cursor (the oldest id already held): the `limit` entries before it. `nextCursor` is the page's first id while older entries exist, else null; `previousCursor` is the page's last id while newer entries exist.
- Forward with a cursor: the entries after it. Forward without a cursor returns the latest page, not the first, so a scan from the start pages backward.
- An unknown cursor id gives an empty page with null cursors, not an error. A Harness `invalid_cursor` maps to `invalid_params` (`_raise_session_backend_error`), but no path to it from this method was found: UNKNOWN. The audit's "a bad page cursor is `invalid_params`" is not confirmed for this method.
- `turnId` filters before paging. All entry kinds are listed, effects and callbacks included.

## 6. Decision and approval source on effect entries

Terminal effect states (`completed`, `failed`, `cancelled`, `skipped`) carry `decision` (`execute` | `skip`), `approvalType` (`always` | `never` | `ask`) and `approvalSource` (`config` | `smart` | `user` | `bypass` | `never`) (`AS/models.py`). The gate records them per action (`_record_approval_meta`, `_gate_tool_call`, `_classify_gate` in `HR/vibe/_local_actions.py`), the projection lifts them from the result `_meta` (`_approval_meta`, `HR/vibe/_projection.py`).

| Situation | state | decision | type | source |
|---|---|---|---|---|
| callback answered approve (any approving type) | `completed` | execute | ask | user |
| callback answered deny, error or cancel | `failed`, code `tool_denied`, "Tool execution denied by approval callback" | skip | ask | user |
| allowed by mode or resolver, no callback | `completed` | execute | always | config |
| allowed under bypass | `completed` | execute | always | bypass |
| smart approve allow or session approval | `completed` | execute | always | smart |
| denied by mode or resolver | `failed`, `tool_denied`, "Tool execution denied by approval policy" or the resolver's reason | skip | never | never |
| smart approve deny-and-continue | `failed`, `tool_denied` | skip | never | smart |

- `skipped` appears only for error code `tool_skipped`, which the gate never uses.
- All three fields are null when the result never passed the gate, at least for `self.sleep` and tool-results writes (`_execute`), and on a running entry. Treat null as unapproved for a profile tool.
- The callback entry records the answer: `state {status:"answered", output:<the ApprovalCallbackOutput sent>}`, or `{status:"cancelled", reason}`. It links to its effect by `relatedEntryId`.
- Source `user` is set for any callback answer, so it marks a client-approved call only because the client is the sole approver. The effect stays `running` while its callback is open; no producer of `blocked` effect state exists in the Unified path (`blocked` is set only by `AS/_projector.py`, which projects legacy AgentLoop events), a negative finding rather than a run.

## Contradictions with the design note

| Design note | Source says |
|---|---|
| Line 71, "approve `read_file` only", "`read_file`, `write_file`, `edit`" | Wire names are `file_system.read_file`, `file_system.write_file`, `file_system.search_replace` |
| Line 71, edit input is `FileEditEffectInput` | Unified emits `FileEditEffectBatchInput` (`filePath`, one-element `changes`); `filePath` holds for all three |
| Line 70, "skills, MCP and connectors empty" | `connectors` is `{connected, total}`, `mcp` is `{sources[], ...}`; test for count 0 and empty sources |
| Line 70, "`config/effective/read` shows each setting" | Keys are snake_case; thinking is `models.<alias>.thinking`; tool permission appears only if overridden, which the profile does |
| Line 72, "allowed or executed without a matching approval" | Needs the exact triple `execute`/`ask`/`user`; null triples exist and are unapproved. Off-profile denial is `failed` + `tool_denied`, never `skipped` |
| Line 149, `RuntimeSnapshot` carries only tool names | True, but `config/effective/read` carries `tools.<name>.permission`, so the step 1 read-back works |
| Line 150, page size | Default 200, max 500; cursors are entry ids; forward without cursor returns the latest page |
| Audit section 2 (not the note), bad cursor is `invalid_params` | Unknown cursor returns an empty page on this path |

## Provenance and hashes (sha256, file bytes at tag)

- `vibe/app_server/_unified_harness_backend_adapter.py` 5784d07e34dde7c37081bb6f303d6b49cf0e4a5e9b810ec89fe8e4ff417659f4
- `vibe/app_server/_unified_tool_projection.py` 0b3046d0a78a77c771a456900827d60d8d6c3bebda8cee599bf3ea9cf75cb889
- `vibe/app_server/_effect_models.py` 8fca2e7e124cc086e3085ba1b16bec7b4759b9db57dfdd22d62666c320e6d701
- `vibe/app_server/_model.py` 9e0f99b33f9988334117ecabb0d979f7b07f1947193ccb5cc8db9ede036901ae
- `vibe/app_server/models.py` 8cdfa65293b0cae02f7fedc1e215fc63c7680b15251ef63f4dd11362215ac384
- `vibe/app_server/protocol.py` 34368acaa20e3ffdfe2d3d0e52c11c361465483442441077faa172f48891481d
- `vibe/app_server/config.py` 0741237c7a63aed216def11acad78e4e094649df098970ae799b45f9fba6f888
- `vibe/app_server/_state.py` fa000cea561dd323606eecbd2584bc9766787b3ebc9c7caf85af56dd97f1af15
- `vibe/app_server/_config_introspect.py` c9ba0eaeabf60b8765ca61513efc6cd4db9f4e336021c1f13b60de77de93c817
- `vibe/app_server/_runtime.py` 0c766f4a4931779639304152a9aa6c392f2eafd8dcdc5a9de50f99ea821d9042
- `vibe/app_server/_unified_permissions.py` 44a0716b84007812956df6f3a43b73b609ca58e669f3b4caabf8d9012af0bd57
- `vibe/core/config/vibe_schema.py` cb1dae2ffd18a898b7e4d4a6deba6814d3b3723318ba7cc0d2832b408888c668
- `vibe/core/config/models.py` 4daa1ca9202e2eb09659cdbe7af85918685ffe92eec4b9e6544172c26d94bca7
- `vibe/core/agents/manager.py` c1a7b7064de7a8ff2e92e91ad0615783af935ab6cce971d5c5fd020bc0419444
- `vibe/core/agents/registry.py` 95791c2ea9cf13d8eb4f181623b10f26dc3405ff8135e60e0315c37c8d5f6407
- `vibe/app_server/_projector.py` f5f4c7f7a2808b3052c3e1f24471adc3d887eaf03627a936d94c7a046d5d8153
- `HR/vibe/_session.py` 1fe2442ab69d287c650910ed70a3ffe844ecea874cb1cdbf46423605409be436
- `HR/vibe/_local_actions.py` f0a855ef3d11b65fa264924862b3127c93091e2be313eda3314d08aadbdc22ab
- `HR/vibe/_projection.py` 51f0980cbbf65a68de25fe2d8620a19502e5fc38c7c5c1077f75c8f79217963f
- `HR/protocol.py` f969fadeecef1597028774360e911f94bacd6c95443b2d74d8ddb37673dda5dd
- `RS/tools/external.rs` 7dec378072aeea4b1c3665232128955478820114675c885c9d51aee855258f1d
- `RS/tools/resolved/mod.rs` 6462af75816add80b70903b7a835a3f56c7909290cac3b6e625c9f1e22441af4
- `RS/tools/execution/mod.rs` ef1c98994348a5ee7a3a2ab8d6f1681cee8b8a715f58c77cdb519bfaa1d6d306
- `RS/features/file_system/mod.rs` 7679b6209dd8d797835a0f44cabf3b68f288bd5ca1ce77429cccf9d8302e41d5
- `RS/features/programmatic_tool_calling/execution.rs` 181795b9211b36ad075fb55a069882f466902f067b2bd86fb8d03d6f345ce4f8
- `tests/app_server/test_unified_tool_projection.py` 80ce16e5dd5e995555fc53aba92581d9593b643b9e12227d46f311bde9865453 (confirms `file_system.*` names and `filePath` after projection)
