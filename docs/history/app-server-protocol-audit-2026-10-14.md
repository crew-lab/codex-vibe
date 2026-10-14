# Vibe app-server protocol audit at v2.26.1 (2026-10-14)

Read from source only through the GitHub API; nothing installed or run. Tag `v2.26.1` = commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0` (checked with `git/ref/tags/v2.26.1` and `commits/v2.26.1`; a lightweight tag). Paths are repository-relative; `AS/` means `vibe/app_server/`, `HR/` means `harness/runtimes/python/python/mistralai_vibe_local_harness/`. Same method as the [Unified Harness audit](unified-harness-audit-2026-10-14.md), whose Rust-side findings are carried over where marked. Items marked UNKNOWN were not established.

## Verdict in one paragraph

The wire is usable as an engine boundary: newline-delimited JSON-RPC 2.0, strict camelCase models, every approval delivered as a server request that the client answers. It does not settle the three owner choices. There is no client-declared tool on the wire (client tools exist only in-process or on the hidden `--agent-socket` of `vibe -p`), so a supervisor grep has to be an MCP server passed in the session config, callable only from `run_typescript`. No field narrows the model-visible catalogue. No field omits reasoning from the store. The run export is a CLI feature, not a server one, so usage, cost and outcome must be rebuilt from `session/statsUpdated` and `runtime/read`. Price and token budgets are not enforced by the Unified server. The client must supply deny-by-default itself and verify the effective config at startup.

## 1. Start and handshake

| Fact | Where |
|---|---|
| Console script `vibe-app-server` = `vibe.app_server.stdio:main`. Flags: `--multiplex`, `--experimental-harness`, `--legacy-harness` (mutually exclusive), `--additional-builtin-plugin-root`. No cwd, config or tool flags. | `pyproject.toml` `[project.scripts]`; `AS/stdio.py` `parse_arguments` |
| Startup: `bootstrap_vibe_home`, `init_harness_files_manager("user","project")` (hardcoded), file logging to `$VIBE_HOME/logs/vibe.log`, `load_dotenv_values` (`$VIBE_HOME/.env` fills only unset env), then `asyncio.run(serve_stdio)`. A Runtime that cannot load prints `Error:` to stderr, exit 1. `VIBE_HOME` env selects the home. | `AS/stdio.py` `main`; `vibe/utils/vibe_home.py` `get_vibe_home` |
| Config layers, low to high: defaults, GrowthBook, user TOML, project TOML (trust-gated), `VIBE_*` env (`__` nesting), session overrides, agent profile, enforced admin. | `vibe/core/config/default_orchestrator.py` `build_default_orchestrator`; `layers/environment.py` |
| Framing: one compact JSON object per line ending `\n`, read with `readline`, written by one ordered writer; stdout is reserved. No `Content-Length`. Malformed JSON raises `InvalidJsonRpcMessage` out of the serve loop. | `AS/transport.py` `StdioJsonRpcTransport`; ADR 0009, ADR 0016 |
| Strict models: camelCase, `extra="forbid"`; `params` is required on requests and notifications; an unknown client notification raises `JsonRpcProtocolError`. Replies to server requests must echo the server's integer id. | `AS/_model.py` `ProtocolModel`; `AS/protocol.py` `Notification`, `ServerRequest`; `AS/server.py` `_handle_notification`, `_handle_response` |
| Handshake: `initialize` `{clientInfo{name,version,entrypoint,...}, capabilities{callbackKinds,clientTools,disabledNotifications}}` returns `{serverInfo{name,version}, processId}`; then the client notification `initialized` with `{}`. Any other request first gives `not_initialized`; a second `initialize` gives `invalid_request`. | `AS/_connection_protocol.py`; `AS/server.py` `_initialize`, `_dispatch_or_error` |
| No protocol or capability version field exists. ADR 0009 says the response carries protocol version, methods, callback kinds and transports; the code returns only `serverInfo` and `processId`. Compatibility is the exact `serverInfo.version` plus strict models (ADR 0014 is cited in `AS/protocol.py` comments; not read). | same; `docs/adr/0009-app-server-boundary.md` |
| Backend: Unified by default; `--legacy-harness` selects legacy; `--experimental-harness` is redundant. A client can confirm with `config/read` `harnessSelectionSource` and `PublicSession.harness == "unified"`. | `vibe/_experimental_harness.py` `resolve_harness_selection`; `AS/protocol.py` `ConfigReadResponse`; `AS/models.py` `PublicSession` |
| Errors: a JSON-RPC error object whose `code` is a string, not a number: `invalid_request`, `invalid_params`, `not_initialized`, `not_found`, `conflict`, `stale_turn`, `not_steerable`, `callback_closed`, `compaction_failed`, `unauthorized`, `forbidden`, `method_not_found`, `not_implemented`, `stale_cursor`, `internal_error` (`StrEnum` with `auto()`). `invalid_params` carries `data{errorCount, issues[{path,message}]}`. A missing API key on `session/start` is `unauthorized` with `data{provider, env_key}`. | `AS/protocol.py` `ProtocolErrorCode`, `ProtocolError`; `AS/server.py` `_dispatch_or_error`; `AS/_unified_harness_backend_adapter.py` `_lifecycle_context` |

## 2. Methods and events

`SERVER_METHODS` lists 148 methods (`AS/protocol.py`); `initialize` is handled before it. The ones a one-shot client needs:

| Method | Params | Result |
|---|---|---|
| `session/start` / `session/resume` / `session/continue` | `agentConfig` (section 4), `historyLimit`, `idempotencyKey`, `kind`; resume adds `sessionId` | `lastEventId`, `state` (`PublicSessionState`) |
| `session/ready/wait` | `sessionId` | `ready`, `initDurationMs` |
| `runtime/read` | `sessionId` | `runtime{config, tools, skills, mcp, connectors, hooksCount, issues, stats, bypassToolPermissions}`, `sessionLog`, `ready` |
| `config/effective/read` | `sessionId` | full redacted effective config |
| `turn/start` | `sessionId`, `message[ContentBlock]`, optional ids | `turn`, `lastEventId`; needs an idle session |
| `turn/interrupt` | `sessionId`, `expectedTurnId` | `accepted`, `lastEventId`; `stale_turn` or `conflict` when already settled |
| `callback/result` | `sessionId`, `result{callbackId, output or error}` | `accepted`, `lastEventId` |
| `session/read`, `session/history/list`, `stats/read`, `tools/list`, `session/log/read` | `sessionId`, paging | state, history page, stats, Vibe tool inventory, store path |
| `config/write`, `config/model/write`, `session/settings/update` | JSON-pointer ops with `targetLayer`; `modelAlias`, `reasoningEffort`; `maxTurns`, `maxTokens` | runtime snapshot; `config/write` is idle-only |
| `session/stop` | `sessionId` | `closed`; the server then closes itself |
| Not used by a one-shot | `session/shellCommand` and `shell/*` (client-run shell), `setup/*` (credential store), `skills/*`, `mcp*`, `connector*`, `plugin*`, `agents/*`, `loops/*`, `review/*`, `workspace/*`, `projectLinks/*`, `vibeCode/*`, queue and steer methods; `events/read` always returns an empty batch | |

There is no subscribe method: `session/start|resume|continue` attaches the connection and returns the snapshot and watermark together; notifications follow the response (`AS/server.py` `_SESSION_ATTACHMENT_CANDIDATES`). The method is `callback/result`; ADR 0009 still says `callback/respond`, and the code does not accept it (`_dispatch_backend_callback`).

Server to client: the request `callback/call` (section 3) and these notifications (`AS/events.py` `_parse_event_params`, `parse_server_event`; `AS/server.py`): `history/entryAdded`, `history/entryUpdated` (JSON-patch ops `add|append|replace|remove|test`), `turn/started`, `turn/completed`, `session/statsUpdated`, `session/snapshot`, `session/updated`, `session/compacted` and `session/contextCleared` (handoffs that carry a new session id, so a client must adopt it), `turn/queueUpdated`, `session/childSessionUpdated`, `runtime/updated`, unnumbered `turn/retrying`, `warning`, `error`, and auth notices. The reference reducer raises on a notification it does not know (`UnknownNotificationError`), so an own client must ignore unknown methods.

Watermark: event ids are positive and monotonic per session runtime; the snapshot's `eventId` is the watermark; ignore ids at or below it, accept the next, treat a larger one as a gap and replace state from `session/read` (`AS/events.py` `ClientProjection._next_event_id`; ADR 0009). `stale_cursor` is raised only when the event stream ended before a read snapshot was observed (`AS/_unified_harness_backend_adapter.py` `_finish_event_stream`); a bad page cursor is `invalid_params`. A simpler client can skip patch handling and re-read history after `turn/completed`.

## 3. Approvals

| Path | Gate | Reaches the client? |
|---|---|---|
| Builtins `read_file`, `write_file`, `edit`, shell, `skill` | `_LocalActionState._execute` then `_gate_tool_call`, mode from `tool_modes` (`HR/vibe/_local_actions.py`); modes built by `_rust_tool_modes` (`AS/_runtime.py`) | Only when `UnifiedPermissionResolver.resolve` answers ask. `allow` (always, bypass, in-workdir allowed by tool rules) and `deny` (`never`, tool unavailable) skip it |
| Nested calls from `run_typescript` | same action path | Carried over from the prior audit (Rust); not re-read |
| `process.start`, `process.write` | `gate_process_call` / `_process_gate` | Yes when ask. `process.output`, `list`, `stop` are cleared without a callback (`_PROCESS_UNGATED_BUILTINS`, `AS/_unified_permissions.py`) |
| `subagent.*` | `SubagentController.execute` (`HR/vibe/_runtime.py` `_execute_action`); no approval code in `_subagents/_controller.py`; not in `tool_modes` | No callback for the spawn; children run under a narrowed ceiling (`_subagents/_configuration.py`) |
| `self.sleep` | not in `tool_modes`; `.get(name, "allow")` | No |
| Provided tools (todo, scratchpad, cron, MCP, connectors) | `_provided_tool_mode`: `ui.ask_user_question` and scratchpad allow; todo and cron ask (cron then resolves to allow by default, `_resolve_provided_tool`); others the session mode (ask, classify, allow) | Yes when ask |

Modes that skip the callback: `allow`, `bypass` (`autoApprove` or `bypass_tool_permissions` turns every ask into allow), and `classify` (smart-approve agent: a classifier model runs first and only some verdicts escalate). The default agent asks.

The callback: server request `callback/call` with an integer id and `callback` (`PublicCallbackEntry`, `detail.kind = "approval"`, `detail.effect{toolName, input}`, `requiredPermissions`, `choices`). The client replies `{callbackId, accepted:true}`, then sends the answer as a separate `callback/result` request (`AS/session.py` `_handle_callback_request`, `respond_to_callback`). Decision types: `approve`, `approve_for_session`, `approve_permanently`, `deny`, `cancel_turn` (interrupts the turn); unknown or malformed answers, and an `error` result, count as deny (`HR/vibe/_session.py` `_approval_grant`, `respond_to_callback`). Never send `approve_permanently`: it writes the grant into the user config (`_unified_permissions.py` `_persist`). Deny as the reference does: `{type:"approval", decision:{type:"deny"}}` (`AppServerSession.deny_callback`).

What the model sees on deny: a failed tool result, code `tool_denied`, message "Tool execution denied by approval callback" (`_gate_tool_call`). `feedback` is accepted by the schema; no reader was found. There is no server-side timeout on a pending approval (`_request_approval` awaits a bare future), so a silent client stalls the turn. A client that does not list `approval` in `callbackKinds` crashes the server on the first approval: `_deliver_callback` raises, `_backend_event_finished` cancels the serve task.

Levers: `tool_modes` is derived, never client-set; only the ten mapped builtins get entries (`RUST_BUILTIN_TOOL_SOURCES`). `tools.<name>.permission = never` (env `VIBE_TOOLS__<NAME>__PERMISSION`) and `disabledTools` produce `deny` without a callback. Unmapped `self.sleep` and `subagent.*` stay allow; close subagents with `enable_subagents=false`. Auto-allowed calls never reach the client, so a callback handler alone is not deny-by-default; every call is still projected as an effect history entry (`PublicEffectEntry`, `decision`, `approvalSource`) that a client can audit and answer with `turn/interrupt`, which is detective only.

## 4. Session configuration

| Need | Channel | Verdict |
|---|---|---|
| Narrow the model-visible catalogue | `enabledTools`/`disabledTools` shape `available_tools`, builtin `deny`, and the provided groups (`vibe_tool_groups`). Rust lists `read_file`, `write_file`, `edit` and the shell tool unconditionally; the command environment is never `Disabled` (`HR/protocol.py`; `AS/_runtime.py` `_command_environment_mode`; `harness/core/.../assembly.rs` `direct_tools`, `features/file_system/mod.rs`). An empty `enabledTools` list means no filter (`vibe/core/tools/manager.py`). | No narrowing of builtins |
| Subagents, background processes, managed shell, connectors | config `enable_subagents`, `enable_background_processes`, `managed_shell_tools_enabled`, `enable_connectors` (`vibe/core/config/vibe_schema.py`); process env `VIBE_...` | Process-level; no wire field |
| MCP | wire `mcpServers` (stdio, http, streamable-http) adds servers (`_session_config_overrides`); config `mcp_servers` merges by name | Per session (adds only) |
| Plugins | no config field; built-in plugin roots always loaded (`HarnessProcess`) | Cannot be disabled; contribution UNKNOWN |
| Skills | `disabled_skills` config; effect on plugin skills UNKNOWN (prior audit) | Process-level |
| Hooks | files only (`hook_files`: trusted project roots, `$VIBE_HOME/hooks.toml`); wire `hooks` has no reader | Process-level |
| Store location | `session_logging.save_dir` (`VIBE_SESSION_LOGGING__SAVE_DIR`); `enabled=false` gives a `tempfile.mkdtemp("vibe-session-logging-disabled-")` root removed at shutdown (`AS/_runtime.py` `ThrowawayStorageRoot`) | Process-level |
| Reasoning | no omit switch; `config/model/write` `reasoningEffort` or `models.<alias>.thinking`; the default model `mistral-medium-3.5` has `thinking="high"`, levels off and high | Thinking only |
| Limits | `maxTurns` becomes Rust `max_iterations` (default 1000). `maxPrice` and `maxSessionTokens` are read only by the legacy `_RootRuntimeBlueprint.build`; the Unified server ignores them. The time limit and the budgets are client-side in `StopRequests` (`vibe/cli/headless_run.py`). `session/settings/update.maxTokens` semantics UNKNOWN | Client enforces |
| Unused wire fields | `completion`, `sandbox`, `instructions`, `tools`, `hooks`: no reader in any `AS/` file | Inert in 2.26.1 |

Per-session wire config is small: `cwd`, `workspaceRoots`, `agent`, `autoApprove`, `enabledTools`, `disabledTools`, `maxTurns`, `headless`, `trustWorkspace`, `mcpServers`, `worktree`. Leave `trustWorkspace` false and `workspaceRoots` empty (listed roots load project state even when untrusted, `_harness_manager.py` `project_roots`); `worktree` would make Vibe create worktrees. Since the supervisor spawns one process per run, process env is per run. The reference headless client also disables `ask_user_question`, `exit_plan_mode`, `cron`, and sets `entrypoint="programmatic"` (no background title call) and `headless=true` (`vibe/cli/cli.py` `_run_programmatic_mode`; `_auto_titles_enabled`). `experiments.enable` exists in config; whether it stops the experiments fetch is UNKNOWN. `config/effective/read` and `runtime/read` let a client verify every setting before the first turn.

## 5. Replacing grep

Builtins have no search, glob or listing: the file tools are `read_file`, `write_file`, `edit`, shell, and reading a directory raises "Path is a directory" (`file_system/mod.rs`; `HR/vibe/_sandbox_helper.py`). Options that exist:

| Option | Mechanism | Limits |
|---|---|---|
| `read_file` only, listing in the prompt | supervisor puts a tree or `git ls-files` into the task text | no search; client-side and read-only |
| Supervisor MCP server | `mcpServers` entry: a stdio command Vibe spawns, or an HTTP endpoint the supervisor serves. Tools are exposed `programmatic` only (`HR/vibe/_host.py` `_integration_tool_groups`), so the model calls `tools.<group>.<tool>` inside `run_typescript`. Calls are gated as provided tools: default ask, so the callback names the route and the client approves only its own | timeouts, result size, child env inheritance UNKNOWN |
| Client tools on the wire | declared nowhere on the wire: `AS/_client_provided_tools.py` says "nothing on the app-server wire declares these tools"; the `clientTool/*` requests and `clientTools` capabilities feed only the legacy `ClientToolIO` (`AS/_legacy_session_runtime.py`) | not available over stdio |
| Hidden `vibe -p --agent-socket PATH` | `vibe/cli/agent_socket.py`: Unix socket (0600 in a 0700 directory), one request per connection, protocol version 2. `agent/initialize` returns `tools[{namespace,name,description,inputSchema,outputSchema,modelAccess}]`; `tools/call` `{callbackId,name,input,toolCallId}` returns `{output, annotations, error}`; default 600 s timeout; error `-32001` timeout, `-32002` abort the run. `modelAccess:"direct"` lists the tool to the model directly. It can also serve `sandbox/readFile` and `sandbox/execute` | `argparse.SUPPRESS`, "may change or go away without notice"; not the app-server protocol; Unix only |
| Shell with client-side filtering | callback `effect.input.command` could be checked before approval | violates the no-shell boundary; shell stays listed |

## 6. One-shot mapping

The reference sequence (`vibe/cli/programmatic.py` `_ProgrammaticRun._drive`, `_act`, `_report`; `AS/session.py` `AppServerSession.open`, `act`, `close`): connect; `initialize`; `initialized`; `session/start`; `runtime/read`; `session/ready/wait`; `runtime/read`; `config/effective/read`; baseline stats; `workspace/trust/status` (warning only); `turn/start`; consume events, answering each `callback/call` with a deny; on `turn/completed` read `runtime/read` for stats; build the report; `session/stop`; close.

| Supervisor operation | App-server mapping |
|---|---|
| `vibe_review_start`, `vibe_edit_start` | spawn one process per run with the private env; handshake; `session/start` with the profile; verify config; `turn/start`; return at once |
| `vibe_status` | supervisor state kept from notifications: turn status, latest `session/statsUpdated`, count of open callbacks |
| `vibe_result` | last completed assistant message for the turn (`session/history/list` after `turn/completed`); outcome from `turn.status`, `stopReason`, `error.code` using the `_turn_outcome` and `_turn_error_outcome` mapping, plus supervisor-detected limits |
| `vibe_close`, cancel, disconnect | `turn/interrupt`, wait for `turn/completed(interrupted)` within a grace period, `session/stop`, close stdin, wait, then kill the process group |

Usage and cost: the server writes no export; `RunExport` is built by `HeadlessRun._write` from `RunResult` and `copy_journal` copies files (`AS/run_export.py`, `vibe/cli/headless_run.py`). A client reads `AgentStatsSnapshot` (tokens, `modelCalls`, per-million prices) from `session/statsUpdated` and `runtime/read` and computes cost with `session_token_cost` (`vibe/utils/pricing.py`: cached tokens clamped to prompt tokens). Edit runs approve `write_file` and `edit` only for paths inside the supervisor's worktree, read from `effect.input`.

## 7. Process model over stdio

- One Python process; its children are MCP stdio servers, plugin and hook commands, and the PTY helper that re-enters the server module with `--internal-posix-pty-helper` (`AS/entrypoint.py`). The Rust engine and V8 are in-process (prior audit).
- Stdin EOF ends the message loop; `serve_connection` then calls `AppServer.close`, which cancels request tasks and runs the host `shutdown`: it cancels active work, closes the runtime and MCP clients, releases the session lease, and removes a throwaway store (`AS/server.py`; `AS/_unified_harness_backend_adapter.py` `shutdown`; `HR/vibe/_session.py` `shutdown`).
- `session/stop` answers, then `close()` cancels the serve task from a request task. Whether that exits cleanly or with a `CancelledError` traceback is UNKNOWN from source. `main` installs no signal handler, so SIGTERM skips cleanup.
- Session lease: an OS file lock `<store>/active/<session>.lock` plus a `.lock.json` diagnostic with the pid; the OS drops it when the process dies; a held lease gives `HarnessSessionBusyError` (`HR/vibe/_storage.py` `SessionLease`). Error-code mapping for it UNKNOWN.

## 8. Decisions this settles

| Decision | State | Evidence |
|---|---|---|
| (a) Review profile without grep | SETTLED as a menu, STILL OPEN as a choice. Possible: `read_file` plus a prompt-supplied listing; a supervisor MCP server called through `run_typescript`; the hidden agent socket (not the app-server). Not possible: a builtin or wire-declared grep. | sections 4 and 5 |
| (b) Narrow the model-visible tool list | SETTLED no for builtins: `read_file`, `write_file`, `edit`, the shell tool and `run_typescript` stay listed; only execution (`deny`) and Vibe's provided groups narrow. A review that lists write tools must refuse them at execution. STILL OPEN whether Mistral will add a switch. | `direct_tools`, `_rust_tool_modes`, `vibe_tool_groups` |
| (c) Reasoning off disk | SETTLED that no client switch omits it and that the store is always on disk. SETTLED that `session_logging.enabled=false` gives a private temp store deleted at shutdown. STILL OPEN whether `thinking=off` stops generation for the target model, and what a crash leaves behind. Reasoning also reaches the client as `PublicReasoningEntry`. | `AS/models.py`; `ThrowawayStorageRoot`; prior audit section 5 |

## 9. Still UNKNOWN

1. Exit status and cleanup after `session/stop`; the SIGTERM path.
2. `run_typescript` nested-call gating was not re-read; one fake-model test should show a nested `write_file` reaching `deny`.
3. Whether the built-in `vibe` plugin adds model-visible skills or tools, and whether `disabled_skills` filters them.
4. MCP stdio child environment, result limits and timeouts.
5. What `config/write` accepts as paths, and whether `targetLayer: "overrides"` is session-only.
6. `session/settings/update.maxTokens` meaning.
7. Whether `experiments.enable=false` stops the experiments request.
8. Hosted behaviour: nothing was run, and no fake-server evidence exists.

## 10. Questions for Mistral

1. Is there a supported way to narrow the model-visible Rust catalogue, including `write_file`, `edit`, the shell tool and `run_typescript`?
2. Will `AgentConfig.tools` (declared `client_tool` definitions) be implemented on the wire, and is `--agent-socket` meant to stay?
3. Will a read-only search or listing builtin exist?
4. Is there a supported switch to omit reasoning from the Unified store, and does `thinking=off` stop reasoning output?
5. Are `maxPrice` and `maxSessionTokens` meant to be honoured by the Unified server?
6. Should the `initialize` result carry a protocol version, and is `callback/result` the stable name?
7. Is the default-allow for unmapped builtins (`self.sleep`, `subagent.*`) a stable contract?
8. Can plugins, including the built-in one, be disabled by config?

## Provenance and hashes (sha256, file bytes at tag)

- `pyproject.toml` 339856af4e36aafc0df9dd27e5b37b711d148330482b0fb8372378ee7115ba6e
- `docs/adr/0009-app-server-boundary.md` 0bc2f970c6e870a9f0ba9a4617d428741854d1448def83d5aa821d54aee194cc
- `docs/adr/0016-rust-cli-delivery-surface.md` 481858ab9a9a9a743cc755d58744ea953346aef15185a2e46462de23d3942ed2
- `vibe/app_server/stdio.py` 57d30b17bc062b3f75d6b1fb257fadd2c45ee46f9db2caf24df1dbbe66aba8cd
- `vibe/app_server/entrypoint.py` 8009ddaa967db878efb3d3f40ff626d5bad97e2848f5011d6f3b62e80a2a8635
- `vibe/app_server/transport.py` d23dc315e207d90b88ef9f03390db927392b3bfc7301f590470ee81f076acf10
- `vibe/app_server/protocol.py` 34368acaa20e3ffdfe2d3d0e52c11c361465483442441077faa172f48891481d
- `vibe/app_server/_connection_protocol.py` 8372b35abd288a5ccc21dcccf9337709ead7504981904a34da7ad157fdc3495c
- `vibe/app_server/_model.py` 9e0f99b33f9988334117ecabb0d979f7b07f1947193ccb5cc8db9ede036901ae
- `vibe/app_server/server.py` 4dd202b65c8d72c2bdbf7211defac79ce952ced56647beaeedc1f6ca9ecefc07
- `vibe/app_server/session.py` 8476f2f46238c742904236cc4bd4e98b90587d8e8627493ae0c7d9b3a0fefb72
- `vibe/app_server/events.py` 6bcf1f97f090c83f7625c5ca61fa178c1f4107ef4c9747d12f377896bf58f7fe
- `vibe/app_server/models.py` 8cdfa65293b0cae02f7fedc1e215fc63c7680b15251ef63f4dd11362215ac384
- `vibe/app_server/run_export.py` e48c6da3d727d056f4f4874809aa7162c27a47c8ca42cb8eea5062e9e1261fb3
- `vibe/app_server/_client_provided_tools.py` 52f6fa81a531c768a29d676fc915c4e41eaf2889f696e5a4a7cfa0944335fead
- `vibe/app_server/_provided_tools.py` f6dd427c1f36bcea612e99399c8a389debc6035788d042d2e1648ac9f731d9f7
- `vibe/app_server/_unified_permissions.py` 44a0716b84007812956df6f3a43b73b609ca58e669f3b4caabf8d9012af0bd57
- `vibe/app_server/_runtime.py` 0c766f4a4931779639304152a9aa6c392f2eafd8dcdc5a9de50f99ea821d9042
- `vibe/app_server/_unified_harness_backend_adapter.py` 5784d07e34dde7c37081bb6f303d6b49cf0e4a5e9b810ec89fe8e4ff417659f4
- `vibe/app_server/_tool_io.py` a4d124b64e82c3c51625f303e44e47f4528b27aa0c254fc420dd376aada4a329
- `vibe/cli/programmatic.py` a938d2440ff5599fa1c48f131c8d6d1ac336aec8cd496c1f8a7caa85c92bbbc1
- `vibe/cli/headless_run.py` 0693c7bee986492625bc5b0b8606527680494528d7b3a16847b45dfddf81593e
- `vibe/cli/cli.py` f53bd1000145ab6b033845321691b95f7eae7a4f03c3816561524cac588464e6
- `vibe/cli/agent_socket.py` 55616d9daa0683e0cf4d53b28bfa877ac2f3f8d72495da7d3ccc47e635fcd59f
- `vibe/_experimental_harness.py` eace7ceb43ea8913fe94d37a30b88eb183e18b5901f013e12461f72c8fb7cebf
- `vibe/utils/vibe_home.py` df7191d3ea02bf2e7db1de8263c0f17016482338705622f07ef4384b35f423df
- `vibe/utils/pricing.py` 1306b489ce38b4ad8c0169d85954d847edbf98e255fd8d6e4e8ad1966f7d1181
- `vibe/core/config/default_orchestrator.py` 4556e7771a8bccf960e29e6d7c07c37e0f26a9d8a79ed0e995f01db8df0217d4
- `vibe/core/config/vibe_schema.py` cb1dae2ffd18a898b7e4d4a6deba6814d3b3723318ba7cc0d2832b408888c668
- `vibe/core/config/harness_files/_harness_manager.py` 43fc21e2d1a7359ac896ab41e902d927d363ba4ef8f989909af8bcca4b82cbac
- `vibe/core/tools/manager.py` a2d5fc658504fd0055f7c16825731b00011e7ae2ffdb51ad95828dc63881659b
- `HR/vibe/_local_actions.py` f0a855ef3d11b65fa264924862b3127c93091e2be313eda3314d08aadbdc22ab
- `HR/vibe/_session.py` 1fe2442ab69d287c650910ed70a3ffe844ecea874cb1cdbf46423605409be436
- `HR/vibe/_runtime.py` 55fb9e01f4a871b4c6677fb64957b2b6c70e784ac8011c003e35d07ebf35aefa
- `HR/vibe/_host.py` b8bc5ed27b3f7c91690680ab9a896835b334cbae9d865bb53e325bbc5efbf70a
- `HR/vibe/_storage.py` 68ac57e766dc0e2038f7de5388b164ad98f4bc38145e1575788cb77a9488548b
- `HR/vibe/_sandbox_helper.py` 10526afbf5402170e4dcea190ec50090d2886ceb5352de416b7191cb8048d8c3
- `HR/vibe/_subagents/_controller.py` 5c8b3ed43d31370d39fb2c8f568ddf12c6d6826578a3762f6c85b47383ac8a21
- `HR/vibe/_subagents/_configuration.py` 11ee676ff7fdb5d51382455b2ca8101a05506660c34cbb24249809fe0f0874c4
- `HR/protocol.py` f969fadeecef1597028774360e911f94bacd6c95443b2d74d8ddb37673dda5dd
- `harness/core/src/core/tools/resolved/assembly.rs` 0dbbd194fefed3df2b33a798b3e115adb60ffcfa9016687c8b680f0df3903c15
- `harness/core/src/core/features/file_system/mod.rs` 7679b6209dd8d797835a0f44cabf3b68f288bd5ca1ce77429cccf9d8302e41d5
