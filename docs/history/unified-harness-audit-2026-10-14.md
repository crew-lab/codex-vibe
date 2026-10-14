# Unified Harness source audit at Vibe v2.26.1 (2026-10-14)

Read from source only through the GitHub API; nothing installed or run. Tag `v2.26.1` = commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0`. Paths are repository-relative; `HR/` means `harness/runtimes/python/python/mistralai_vibe_local_harness/`. Facts below were read in the named file; items marked UNKNOWN were not established.

## Verdict in one paragraph

The Unified Harness is not a separate process. The Rust core is a sans-IO state machine loaded into the Python process as a PyO3 extension; Python executes every effect (model calls, file tools, shell, hooks, approvals). That is good for an adapter: the effect executors are Python and hash-pinnable, and the existing project-discovery pin still applies. It is bad for two assumptions of the legacy launcher: the tool list the model sees is not narrowed by `enabled_tools`, and `BaseTool.invoke` is no longer on the execution path. There is also no `grep` tool in the Unified Harness, so the review profile cannot be reproduced as is.

## 1. Selection, start, and the Python-Rust boundary

| Fact | Where |
|---|---|
| Console script `vibe` is `vibe.cli.launcher:main`, which may exec a Rust TUI by `VIBE_CLI` or a rollout flag. The supervisor already imports `vibe.cli.entrypoint` directly, which bypasses it. | `pyproject.toml` `[project.scripts]`; `vibe/cli/launcher.py` `main` |
| Selection: `--legacy-harness` gives legacy; anything else gives Unified, unconditionally. No remote flag is consulted. A missing runtime is a startup error, not a fallback. | `vibe/_experimental_harness.py` `resolve_harness_selection`, `require_experimental_harness`, `HarnessSelection` |
| Programmatic path: `entrypoint.main` -> `HeadlessRun.for_args` -> `cli.run_cli` -> `_run_programmatic_mode` -> `programmatic.run_programmatic` -> `run_headless` -> `LocalHarness.start`. `LocalHarnessOptions` carries both harness flags into `HarnessProcess`. | `vibe/cli/entrypoint.py`, `vibe/cli/cli.py`, `vibe/cli/programmatic.py`, `vibe/app_server/local.py` |
| `HarnessProcess.__init__` calls `resolve_harness_selection`, then `create_experimental_harness_host()` (imports `mistralai_vibe_local_harness.vibe`, calls `create_harness_host`). | `vibe/app_server/_runtime.py` `HarnessProcess` |
| The app server runs in the same process over an in-memory transport (`memory_transport_pair`, `transport_kind="in_process"`). There is no socket or subprocess between CLI and app server in `-p` mode. | `vibe/app_server/local.py` `LocalHarnessHost.connect` |
| Python-to-Rust: in-process FFI. `HarnessSession.create/restore/apply/inspect/checkpoint/close` take and return JSON strings; `SHARED_ENGINE` holds one mutex per session. The protocol is a step protocol: `HarnessInput` in, `HarnessApplyResult` with `HarnessNextAction` (`Action` variants: `Approval`, `llm_call`, `runtime_builtin_tool_call`, `provided_tool_call`, `hook_call`, `Filesystem`) out; Python runs each action and feeds back an event. | `harness/core/src/python_binding.rs`, `engine.rs`, `core/step_protocol/mod.rs`, `action.rs`; `HR/runtime.py`, `HR/vibe/_runtime.py` |
| The extension ships inside the same wheel as `vibe` (maturin, `python-packages = ["vibe", "mistralai_vibe_local_harness"]`, module `mistralai_vibe_local_harness._native`). | `pyproject.toml` `[tool.maturin]` |
| `vibe -p` never reaches a Rust process; the separate `vibe-rs` TUI is a client of the Python app server and is out of the `-p` path. | `docs/adr/0016-rust-cli-delivery-surface.md` |

## 2. Tool exposure and dispatch

- Inventory of Vibe tools is still the Python `ToolManager.available_tools` (`vibe/core/tools/manager.py`), computed in `derive_config` as `available_tools = set(derived_tools.available_tools)` (`vibe/app_server/_runtime.py`). `enabled_tools`/`disabled_tools` (config or the CLI overrides at `_runtime.py` lines 2965-2968) act here, so the legacy inventory pin still covers this set.
- The model-visible catalogue is built in Rust, not from that set. `ResolvedTools::compile` -> `build_top_level_tools` gives: the tool-discovery tool, `run_typescript`, `assembly::direct_tools` (always `read_file`, `write_file`, `edit`, and the shell tool unless the command environment is disabled; `skill` only if skills exist), plus provided direct tools. `file_system::tools` filters only `Bash` by environment. So `enabled_tools=[read_file]` still lists `write_file` and `edit` to the model. (`harness/core/src/core/tools/resolved/mod.rs`, `assembly.rs`, `features/file_system/mod.rs`.) The Python host forwards the catalogue unfiltered (`_LocalActionState._apply_model_input`, `HR/vibe/_local_actions.py` line 1377).
- Execution is gated in Python by `tool_modes` (allow, ask, deny, classify) per Rust builtin. `_rust_tool_modes` (`vibe/app_server/_runtime.py`) sets a builtin to `deny` when no Vibe tool in `RUST_BUILTIN_TOOL_SOURCES` (`vibe/app_server/_unified_permissions.py`) is in `available_tools`. So `enabled_tools` is honoured at execution through `deny`, not at listing.
- Builtin namespaces: `self.sleep`, `file_system.{read_file,write_file,search_replace,bash}`, `skill.read`, `process.*`, `subagent.*` (`harness/core/src/core/tools/external.rs`). Mapping to Vibe tools covers only 10 of them: read_file, write_file, edit, the shell tools, skill. There is no `grep` builtin and no directory-listing tool. `grep` appears in the Unified code only as a display projection of old events (`vibe/app_server/_unified_tool_projection.py`). `self.sleep` and `subagent.*` are not in the map, and `tool_modes.get(name, "allow")` defaults to allow.
- Dispatch: Rust resolves model calls (`ResolvedTools::resolve_direct_call`, `resolve_program_call`) and emits actions. Python executes. Builtins and provided tools go through `_LocalActionState._execute` -> `_gate_tool_call` -> `execute_file_tool` / `execute_shell_tool` / `execute_skill_tool` / `execute_self_tool` (`HR/vibe/_local_actions.py`). Process actions take a second path with their own gate (`_runtime.py` `_process_gate`, `validate_process_action`). Subagents are a third (`HR/vibe/_subagents/_controller.py`). Not one chokepoint for execution; one for the catalogue sent to the model (`_apply_model_input`) and one for builtin gating (`_gate_tool_call`).
- `run_typescript` (V8 inside the Rust core) lets the model call `tools.<namespace>.<name>`. Nested calls come back as ordinary actions and take the same gate (test `permissions/programmatic.rs`; code in `programmatic_tool_calling/execution.rs`). `fetch`, `eval`, `setInterval` are disabled in the isolate (`code_mode/v8.rs`); heap limit and execution watchdog exist.
- File tools run `_sandbox_helper.run_file_tool` on the host with a path policy (`roots`, `roots_are_a_boundary`, no-follow open). Out-of-root access becomes an approval ask.

## 3. Capabilities the boundary must turn off

| Capability | How it is controlled | Status |
|---|---|---|
| Subagents | `config.enable_subagents` -> `RustToolSettings.subagents` (`_runtime.py` derive); Rust omits the group from catalogues when disabled (`resolved/program.rs`, `assembly.rs`) | Verified; default is on |
| Background processes | `config.enable_background_processes` -> `RustToolSettings.background_processes`; also `deny` when no shell source exists | Verified; default is on |
| Shell, `git_bash`, PowerShell | Rust always lists the shell tool unless command environment is `Disabled` (`RustDisabledCommandEnvironment` exists in `HR/protocol.py`), but `derive_config` only ever selects unix, git_bash or powershell; denial relies on `tool_modes` deny | Denied at execution; still listed. `Disabled` is not reachable without patching |
| Network tools | No builtin fetch or search in the map. Remaining network paths: MCP, connectors, plugins, hooks, the model provider, telemetry | Verified for builtins |
| MCP | `VIBE_MCP_SERVERS=[]`; plugin MCP catalogue `PluginMCPCatalog` is built regardless | Config honoured; plugin path UNKNOWN |
| Connectors | `enable_connectors=false` -> `_resolve_provider` returns None (`connector_catalog.py`); `_build_connector_registry` still runs | Likely off; verify offline |
| Skills | `SkillManager(include_builtins=False)` honours `disabled_skills`; built-in skills now ship as the `vibe` plugin (`vibe/plugins/builtins/vibe`), loaded via `builtin_plugin_roots`. User invocation by `/name` anywhere in the prompt (`_skill_invocation.invoked_skill_names`, `_resolved_invoked_skills`). | UNKNOWN whether `disabled_skills` filters plugin skills; closing needs a test |
| Hooks | `load_hooks_from_fs` reads `harness_files.hook_files` (project `.vibe/hooks.toml`, `VIBE_HOME/hooks.toml`, plugin hooks); hooks run shell commands | Private `VIBE_HOME` is empty; project path covered by the discovery patch |
| Plugins | `PluginResolver.from_harness_files` uses `project_plugins_dirs`, `user_plugins_dirs`, builtin roots; foreign formats read `.agents/skills`, `.claude/skills` | Builtin always loaded; project part likely covered; UNKNOWN |
| Project config (`.vibe`, `.agents`, AGENTS.md) | `HarnessFilesManager` properties `project_source_enabled`, `project_roots`; the file hash equals the launcher pin `43fc21e2...`; the Unified path builds its manager from the same class and `for_session` | Class-level patch should carry over; AGENTS.md hooks call `for_session`, so also covered |
| Trust records | `trusted_folders` under `VIBE_HOME`; `--trust` is not passed so project layers stay untrusted; `_warn_if_workspace_untrusted` only warns | Carries over |
| `ask_user_question`, `cron` | CLI adds both to `disabled_tools`; `ask_user_question` group exists only if the tool is available | Verified |
| Telemetry, update checks | `VIBE_ENABLE_TELEMETRY=false` already set; `enable_update_checks` and `experimental_enable_model_catalog` are separate config fields | Set explicitly |
| Remote flags | Harness choice no longer remote. README says shell variant uses a server experiment `vibe_cli_managed_shell_tools` | Pin `managed_shell_tools_enabled=false` explicitly |

## 4. Permissions model

- Per-builtin mode comes from `_rust_tool_modes`: strictest of Vibe's permission for the mapped tools; `allow` is lowered to `ask` so the per-call resolver runs; `bypass_approval` (= `--auto-approve` or `bypass_tool_permissions`) keeps `allow` and retires the resolver; smart approve turns `ask` into `classify`.
- `ask` path: `_gate_tool_call` -> `UnifiedPermissionResolver.resolve` (`vibe/app_server/_unified_permissions.py`), which reuses Vibe's per-tool `resolve_permission`, `PermissionStore`, allowlist, denylist and sensitive patterns; then, if still ask, `request_approval`.
- Headless: `_act` in `vibe/cli/programmatic.py` answers every `CallbackRequested` with `session.deny_callback`. So a `-p` run never asks a human and never approves without `bypass_approval`. A resolver exception falls back to ask, which is then denied. Our existing `VIBE_TOOLS__<NAME>__PERMISSION/ALLOWLIST/DENYLIST/SENSITIVE_PATTERNS` map onto this resolver; `read_file`/`write_file`/`edit` are in `ALLOWLIST_EXEMPTED_BUILTINS`, so `never` plus an allowlist is honoured.
- Provided tools (todo, scratchpad, MCP) use `provided_tool_mode`; scratchpad is pinned allow in `VIBE_PROVIDED_TOOL_MODES` (`_provided_tools.py`), so it is reachable unless `enabled_tools` excludes it.
- Rust also has a `PermissionPolicy` (`features/permissions/policy.rs`) but `derive_config` does not set it.

## 5. Persistence and logging

- Store: `<session_logging.save_dir>/unified/<session_id>`, or a throwaway `tempfile.mkdtemp("vibe-session-logging-disabled-")` when `session_logging.enabled` is false (`ThrowawayStorageRoot`, `_runtime.py`). The temp location follows `TMPDIR`.
- Contents: versioned Core checkpoint, runtime and projection recovery state, `journal/NNNNNNNNNNNNNNNN.jsonl`, committed-history export (ADR 0011; `HR/vibe/_storage.py`). Large tool outputs go to `<session store>/tool-results` (`_LocalActionState._write_file`), not the workspace.
- Reasoning is persisted: the checkpoint schema stores `Reasoning` parts with `Text`, `Summary` and `Redacted` content (`harness/core/src/core/checkpoint/v1/schema/message.rs`). The legacy `SessionLogger` patch does not apply: the Unified store does not use `SessionLogger`.
- `--output-dir`: `write_run_export` writes `export.json` (version, redacted effective config, usage, `cost_usd`, `steps`, warnings, outcome, exit code); `copy_journal` copies the whole session directory into `DIR/session/` and redacts only the metadata config (`vibe/app_server/run_export.py`). Reasoning in the copied journal is not stripped.
- Secrets: `redact_config` covers the export config; nothing in the files read redacts message content. UNKNOWN for tool output.

## 6. Process model

- One OS process: Python host, Rust engine (threads, `py.detach`), V8 isolate for `run_typescript`, all in-process. The only children come from the shell and process tools (`HR/vibe/_processes/_posix.py`, which re-enters `vibe.cli.entrypoint --internal-posix-pty-helper`) and from plugin or MCP stdio servers. No OS sandbox (seatbelt, landlock) found in the files read. `_sandbox.py` is a remote-sandbox adapter for `--agent-socket`, not isolation of the harness.
- `--time-limit` counts from process start (`StopRequests`, `headless_run.py`); on expiry, SIGTERM or SIGINT it interrupts the turn and exits 3 after at most `STOP_GRACE_SECONDS = 10`. Exit codes: 0 finished, 1 usage/config, 2 infrastructure, 3 limit or refusal (`turn_limit`, `token_limit`, `price_limit`, `deadline`, `terminated`, `length`, `refusal`), 4 aborted (`RunOutcome.exit_code`). `--max-turns` becomes Rust `max_iterations` (`TurnSettings`); `--max-tokens`, `--max-price` are Python-side observers. Stale refusal note: README says only legacy reports `refusal` as such.
- `--prompt-file` reads the file in place and does not delete it (`cli._headless_prompt`).

## 7. Launcher controls mapped

| Launcher control | Unified Harness | Verdict |
|---|---|---|
| Private HOME/VIBE_HOME, filtered env | Same variables; also set `TMPDIR` into the run directory; the shell tool copies `os.environ` | Carries over |
| `VIBE_ENABLED_TOOLS` | Shapes `available_tools` and execution modes, not the model catalogue | Needs a new hook |
| `VIBE_DISABLED_SKILLS=["*"]` | Root skills yes; `vibe` plugin skills and `/name` mentions UNKNOWN | Needs a test and likely a hook |
| Project discovery off (hash `43fc21e2...`) | Same file and class, same hash; Unified uses it via `HarnessFilesManager` and `for_session` | Carries over; re-verify plugins and foreign skills |
| Persistence shim (`SessionLogger`) | Different store, reasoning persisted | Needs a new hook |
| Inventory check at `ToolManager.available_tools` | Still computed; but not what the model sees | Carries over, insufficient |
| Deny-by-default at `BaseTool.invoke` | Not on the path | Replace: gate in `_LocalActionState._execute`, `_gate_tool_call`, process gate, subagent controller |
| Pinned hashes of schema builder, call resolver, `ToolManager.get` (`APIToolFormatHandler`) | Legacy only | Replace with Unified set (section 8) |
| MCP/connectors off | Honoured by config; plugin MCP path unclear | Carries over, verify |
| Prompt-file handoff, argv-free | Works unchanged; native `--prompt-file` is less private | Carries over |
| Watchdog, hard cap, process-group kill | Engine and V8 are in-process, so one SIGKILL ends them; add native `--time-limit` | Carries over |
| Turn limit | `--max-turns` honoured | Carries over |
| Subagents, background processes off | Config fields | New config, no hook |
| Never ask, never approve | `_act` denies callbacks; never pass `--auto-approve` | Carries over (different mechanism) |
| Review tools `read_file` + `grep` | No `grep` builtin | Not possible as is |

## 8. Pinning

- Rust behaviour cannot be pinned by hashing Python. Pin the installed wheel instead: sha256 of the `mistralai_vibe_local_harness/_native*.so` for the exact platform and CPython, plus every Python file under `vibe/` and `mistralai_vibe_local_harness/` (wheel `RECORD` lists hashes; compute independently). That pins bytes, not semantics, so add behavioural tests with a fake model that return a catalogue and a denied call.
- Python functions to hash-pin (file sha256 at the tag in the list below): `vibe/app_server/_runtime.py` (`derive_config`, `_rust_tool_modes`, `HarnessProcess.__init__`), `vibe/app_server/_unified_permissions.py` (`RUST_BUILTIN_TOOL_SOURCES`, `UnifiedPermissionResolver.resolve`), `HR/vibe/_local_actions.py` (`_execute`, `_gate_tool_call`, `_apply_model_input`), the process gate region of `HR/vibe/_runtime.py`, `HR/vibe/_subagents/_controller.py`, `vibe/cli/programmatic.py` (`_act`), `vibe/cli/cli.py` (`_run_programmatic_mode`), `vibe/_experimental_harness.py` (`resolve_harness_selection`), plus the existing `_harness_manager.py` and `ToolManager.available_tools`.

## 9. Risks and unknowns

Verified: sections 1 to 6 as cited.

UNKNOWN:
1. Whether `disabled_skills` filters the built-in `vibe` plugin skills, and whether a `/name` mention injects them.
2. Whether any project path (plugins, foreign skills, hooks) bypasses the `project_roots` patch.
3. Whether the Rust catalogue can be narrowed without patching: `RustDisabledCommandEnvironment` is unreachable from `derive_config`; `write_file` and `edit` have no switch.
4. Whether subagent and process actions reach a gate in every state (not read: `_subagents/_controller.py`, process manager).
5. Whether tool output or message content can carry secrets into the journal; no redaction found.
6. The installed macOS wheel layout and `.so` name; the target wheel was not inspected.
7. Whether `thinking = "off"` stops reasoning generation for the Mistral model in use.
8. Real behaviour with a hosted model; nothing here was run.

## Recommended adapter design

1. Keep the private `HOME`, `VIBE_HOME` and a private `TMPDIR`; keep the env filter; import `vibe.cli.entrypoint` directly; keep the prompt-file consume step.
2. Pin the wheel: `_native` binary hash plus a hash of each Python file in the pin list above; fail closed on drift.
3. Reuse the project-discovery class patch; add startup checks that `project_roots`, `hook_files` and plugin directories resolve empty.
4. Set config: `enable_subagents=false`, `enable_background_processes=false`, `managed_shell_tools_enabled=false`, `enable_connectors=false`, `VIBE_MCP_SERVERS=[]`, telemetry and update checks off, `disabled_skills=["*"]`.
5. Patch `_LocalActionState._apply_model_input` to drop every catalogue entry outside the profile, and `_execute` and the process gate to refuse any builtin or provided call outside the profile; add a start-up check of the effective `tool_modes`.
6. Replace the persistence shim: write the session store inside the run directory, then strip reasoning and redact before any export, or refuse `--output-dir` and read `export.json` only.
7. Pass `--time-limit`, `--max-turns`, `--output-dir` (export only) and map exit codes 0 to 4 to the supervisor outcomes; keep the watchdog.
8. Decide the review profile: `read_file` alone, or accept `bash` limited to a vetted read-only set. Do not assume `grep`.
9. Add an offline profile check on the target (fake model, no provider) covering: catalogue, denied call, skills, `/name`, project files, store contents.

## Questions for Mistral

1. Is there a supported way to narrow the model-visible catalogue (not only execution) by `enabled_tools`, including `write_file`, `edit`, `run_typescript` and the discovery tool?
2. Will a `grep` or directory-listing builtin exist in the Unified Harness?
3. Is there a supported setting to disable plugins entirely, including the built-in `vibe` plugin, and does `disabled_skills` apply to it?
4. Is reasoning text meant to be written to the checkpoint, and is there a switch to omit it?
5. Can `--output-dir` omit the journal copy?
6. Is `RustDisabledCommandEnvironment` meant to be reachable from the CLI?
7. Is the `_native` ABI and the `mistralai_vibe_local_harness` package versioned independently of `mistral-vibe`?
8. Are the `tool_modes` default of `allow` for unmapped builtins and the Rust `PermissionPolicy` stable contracts?

## Provenance and hashes (sha256, file bytes at tag)

- `vibe/_experimental_harness.py` eace7ceb43ea8913fe94d37a30b88eb183e18b5901f013e12461f72c8fb7cebf
- `vibe/cli/entrypoint.py` fbb033ec73433bc575211680308f287f4bc26a3857f1100f55988de79bad0bb1
- `vibe/cli/launcher.py` db6a00e04258fd74c25665dbe959f84325e6cb06bbb808f18525d68aab295ccd
- `vibe/cli/cli.py` f53bd1000145ab6b033845321691b95f7eae7a4f03c3816561524cac588464e6
- `vibe/cli/programmatic.py` a938d2440ff5599fa1c48f131c8d6d1ac336aec8cd496c1f8a7caa85c92bbbc1
- `vibe/cli/headless_run.py` 0693c7bee986492625bc5b0b8606527680494528d7b3a16847b45dfddf81593e
- `vibe/app_server/local.py` 3bf3014d24a5a666254b73d0df29649558e81c6a47aa388ff94602347d6d2e64
- `vibe/app_server/_runtime.py` 0c766f4a4931779639304152a9aa6c392f2eafd8dcdc5a9de50f99ea821d9042
- `vibe/app_server/_unified_permissions.py` 44a0716b84007812956df6f3a43b73b609ca58e669f3b4caabf8d9012af0bd57
- `vibe/app_server/_provided_tools.py` f6dd427c1f36bcea612e99399c8a389debc6035788d042d2e1648ac9f731d9f7
- `vibe/app_server/_skills.py` e25a72f8c9d0de656061743f0eb78eb7086b77e22f932811f22c75b3ffd0abbe
- `vibe/app_server/_skill_invocation.py` 8e5bc7c0e4cf2ed82f76dafd79ada873d1fcf9cdec9d60530be8b46916b24e95
- `vibe/app_server/_plugins.py` e5b3e14e6b59ab847b3b520699fd2d4447ddf28663a6ecf1cadc0d36f4c64350
- `vibe/app_server/_agents_md_hooks.py` fdc2a008be1c8fe69a0151f160f62fbe98def609ec66c37643d36acf2b95c9bf
- `vibe/app_server/connector_catalog.py` 55cd92f34ff975beab95b450791e0ddb4b470042a3672ecb4d78bd27280c74a4
- `vibe/app_server/_unified_harness_backend_adapter.py` 5784d07e34dde7c37081bb6f303d6b49cf0e4a5e9b810ec89fe8e4ff417659f4
- `vibe/app_server/run_export.py` e48c6da3d727d056f4f4874809aa7162c27a47c8ca42cb8eea5062e9e1261fb3
- `vibe/core/config/harness_files/_harness_manager.py` 43fc21e2d1a7359ac896ab41e902d927d363ba4ef8f989909af8bcca4b82cbac
- `vibe/core/config/vibe_schema.py` cb1dae2ffd18a898b7e4d4a6deba6814d3b3723318ba7cc0d2832b408888c668
- `vibe/core/tools/manager.py` a2d5fc658504fd0055f7c16825731b00011e7ae2ffdb51ad95828dc63881659b
- `vibe/core/tools/base.py` 70d706fa373afb9cd5beba6fe50e58720b929017aae0a752949763255cc9ccc2
- `vibe/plugins/builtins/vibe/plugin.json` 6c288482b77047b21056653f3264d014090f4b7987ad19deacb0e95b01bf2ce3
- `pyproject.toml` 339856af4e36aafc0df9dd27e5b37b711d148330482b0fb8372378ee7115ba6e
- `README.md` dfe5c431c0806524120e637e7c2ef402b12b7fc055eb37ea62acea8d6b867d27
- `docs/adr/0011-unified-harness-backend.md` 571a518b76eec5d49a4db0fd74e19f1333ffc6829d8c10bc3e42d4450ebe461c
- `HR/protocol.py` f969fadeecef1597028774360e911f94bacd6c95443b2d74d8ddb37673dda5dd
- `HR/runtime.py` 50dda46bd66c6db962ce300860bddf7f8fac4d730da8cc7573bfba43a127ec94
- `HR/vibe/_local_actions.py` f0a855ef3d11b65fa264924862b3127c93091e2be313eda3314d08aadbdc22ab
- `HR/vibe/_runtime.py` 55fb9e01f4a871b4c6677fb64957b2b6c70e784ac8011c003e35d07ebf35aefa
- `HR/vibe/_runtime_config.py` c50d5f2c4a66d92547e7d41c13e602d9926ed73fbe617f6965c56b82049aff05
- `HR/vibe/_host.py` b8bc5ed27b3f7c91690680ab9a896835b334cbae9d865bb53e325bbc5efbf70a
- `HR/vibe/_storage.py` 68ac57e766dc0e2038f7de5388b164ad98f4bc38145e1575788cb77a9488548b
- `HR/vibe/_file_tools.py` 57befc06096070fd4f40188d0566743444fc017b5615961a5038878e15a78bad
- `HR/vibe/_shell_tools.py` 5384b463aca5cff0d3762664bb35791593e60a0af01d6ad7acedfdb8bb910c14
- `HR/vibe/_sandbox_helper.py` 10526afbf5402170e4dcea190ec50090d2886ceb5352de416b7191cb8048d8c3
- `harness/core/src/python_binding.rs` 5ca30afc615780669ed34793ec4e7de59e4653320f043e35ed0775bb927d2b9c
- `harness/core/src/engine.rs` f23c794b5ad67ba9bd9c55583dcaf1c49b06386ceaccc583e64796a3b24038e0
- `harness/core/src/lib.rs` be2a04bd8ce6a0abc643ed67f60f09320e3da905f7e62ec9ae761667057d7a43
- `harness/core/src/core/step_protocol/action.rs` 4451e07afbe61f88549be6445d32037eeaa66789fd5c0275bfaf0c9490dd2f66
- `harness/core/src/core/tools/external.rs` 7dec378072aeea4b1c3665232128955478820114675c885c9d51aee855258f1d
- `harness/core/src/core/tools/resolved/assembly.rs` 0dbbd194fefed3df2b33a798b3e115adb60ffcfa9016687c8b680f0df3903c15
- `harness/core/src/core/tools/resolved/mod.rs` 6462af75816add80b70903b7a835a3f56c7909290cac3b6e625c9f1e22441af4
- `harness/core/src/core/tools/resolved/program.rs` 8a1cef280987d2bb4c7112495cdcf526bf3d6f3cb357d440ffa160fab3929e48
- `harness/core/src/core/features/file_system/mod.rs` 7679b6209dd8d797835a0f44cabf3b68f288bd5ca1ce77429cccf9d8302e41d5
- `harness/core/src/core/features/permissions/policy.rs` 95024ce1101557015c44cc1f6bc51ce2796c95d722efdd67623c0d343f06a4fd
- `harness/core/src/core/features/programmatic_tool_calling/code_mode/v8.rs` dac09f89de27c4ace9f8a64c6e76d206a0112fd52ad7e7b9f04e8f1f9cd941d4
- `harness/core/src/core/checkpoint/v1/schema/message.rs` 789e27f99df0f503b1f637997763be007ca66a3e3c32cd01540210fde9cb7db4

