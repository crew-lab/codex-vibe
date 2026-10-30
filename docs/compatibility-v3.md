# Vibe 3.0.2 compatibility assessment

Current policy: **Vibe 3.0.2 is the sole accepted and default exact version**. The current candidate remains **unqualified for hosted dispatch** until its own target gates pass. Configuration no longer has an experimental Vibe-version selector; pin and preparation evidence must match 3.0.2. This document preserves the earlier tagged-source review and prior candidate trial as historical evidence. Neither qualifies the current candidate or transfers to a new build.

## Source basis

The reviewed checkout is the exact `v3.0.2` tag commit `36f7b3a4e10440e90f98080492530b8f4d46960d`. SHA-256 values below are for the exact source bytes at that commit.

| Source path | SHA-256 |
| --- | --- |
| `vibe/app_server/server.py` | `05eedf63aa8ecb2423199e248b8fbde0afad0138f7d55b3dbf65427c6701ba76` |
| `vibe/app_server/protocol.py` | `d0a7b8e712bced849014982cfe342b6f4967f1c1b343cd99a0b46b073013488d` |
| `vibe/app_server/session.py` | `9ea618fc88a474b6b3d18bcee16bfaef5e2cb7de0aab5254dbd0e590e2d99119` |
| `vibe/app_server/models.py` | `180257cbfc7ccb18de366f42100abe01fddbc95273ac7183ea5bf2816cf9365a` |
| `vibe/app_server/events.py` | `6bcf1f97f090c83f7625c5ca61fa178c1f4107ef4c9747d12f377896bf58f7fe` |
| `vibe/app_server/_unified_harness_backend_adapter.py` | `2b63dfc160aa1b6877be15dd7d9e946e192ef68c4820861b543535731081473b` |
| `vibe/app_server/_runtime.py` | `ad3561ab5f9e0b529313b443df2057736f26afab8a0d68eae8cd98946a38bb7f` |
| `vibe/app_server/_config_introspect.py` | `e69a20c5c53f0c387fa4e09fbaba48c36e0ee7f5001b2d5e2d1952abbf680203` |
| `vibe/app_server/_approval_permissions.py` | `04e0fbfb21058a4b71c60ebea76dcabc07f04777b63c4750a6fb1897128777cb` |
| `vibe/app_server/_history_projection.py` | `1a6e5f309990fe3ea2f2b5b35d0a41a9924b948b528b9d6ebc8552b82d96f9d0` |
| `vibe/core/config/admin_config.py` | `af6fe5a1ab007c4a8f497df7261d39aa53e74bc9d9833597f87e7e586b1a6e94` |

The installed CLI independently reports `vibe 3.0.2`, and its `bin` directory contains `vibe-app-server` and `vibe-acp`. Those are installation facts, not conformance evidence. The first research attempt could not retrieve GitHub source because the environment blocked GitHub access and DNS; the coordinator then provided the exact tagged source checkout above. The earlier failure is retained here as research history, not treated as the current evidence state.

## Findings and qualification stop

Vibe 3.0.2 retains the protocol primitives for supervisor-controlled work: `server.py` dispatches `turn/start`, `turn/interrupt`, `config/effective/read`, and `runtime/read`; `session.py` emits `callback/call` and accepts `callback/result`; the typed approval callback in `models.py` carries an effect and exposes approval choices; effect history carries approval type/source; and `events.py` checks sequential event identifiers and snapshot watermarks. `effective_config_response` returns the redacted effective Vibe configuration, while the runtime extension returns its runtime snapshot. These source facts make a same-session correction flow technically plausible through another `turn/start` on the existing `session_id`. `session/continue` instead resumes the latest eligible session and is not the intended correction primitive.

Vibe 3.0.2 also has an explicit ephemeral-store path when `session_logging.enabled` is false: `_runtime.py` creates throwaway storage, and `_UnifiedSessionPersistence._persists_to_disk` in `_unified_harness_backend_adapter.py` returns false for disabled logging. Reasoning nevertheless exists as a first-class public history entry (`models.py`) and is projected by `_history_projection.py`; the supervisor must continue filtering it before persistence, output, and export. The terminal's changed default display for reasoning does not alter this protocol finding.

The managed-configuration control matches the existing supervisor endpoint. Vibe 3.0.2 appends `/api/v1/code/managed-config` to `vibe_base_url` in `vibe/core/config/admin_config.py`; the supervisor sets `VIBE_VIBE_BASE_URL` to its owned loopback root and serves the disabled policy at that exact route in `src/backends/app-server/managed-config.ts`. Vibe sends its authorization header to this loopback endpoint, which is the intentional request path; it does not redirect to a remote endpoint in the reviewed code. The supervisor reads back the loopback root through the effective configuration expectation. The earlier draft of this assessment incorrectly called the route a mismatch because it compared the root URL without appending Vibe's fixed path; that conclusion is withdrawn.

The Vibe server itself permits callbacks to offer session or permanent approvals and paths scopes. The Supervisor must continue denying those choices unless a particular in-workspace profile tool call satisfies its own handler. Vibe's existence of an approval callback is not evidence that the local approval policy has been retained. Likewise, this source review does not prove that repeated `turn/start` preserves the supervisor's cumulative token, cost, model-call, and time ceilings: those are Supervisor responsibilities that require lifecycle implementation and tests. No hosted run or target no-inference probe was done.

Historical trial implementation and preparation report: an earlier source snapshot exposed `vibe_continue` behind `experimental.correctable` and bound its explicit 3.0.2 profile into the runtime pin, policy revision, boot-drift detection, doctor output, preparation identity and conformance check. That snapshot's version-specific no-inference preparation passed (`prepare check` PASS report `7c0c69835c990bc80452a67c83af1de759bd90161a4b2428dc83eeeee6d5ce1c` on installed candidate `1727a9e15b5f71d2ab20d21767afbd1decffebf35b5044ef4a71a86c5d6c5e21` against the installer-provisioned runtime with `runtime-manifest.json`). This historical result does not qualify the current source or archive; the current public surface is five tools and one-shot only.

Historical report for that earlier six-tool trial snapshot: four local hosted trial runs were executed on the test fixture. Trial 1 read-only review completed successfully; Trial 2 one-shot edit and Trials 3/4 correctable edits were rejected because worker-generated test files failed contract requirements (`node:test` and `node:assert/strict`). No trial produced an accepted edit. Total consumption across all four runs was 14 model calls, 106,175 tokens, and an estimated non-authoritative cost of $0.06682. These runs do not authorize a new hosted dispatch or qualify the current candidate.

## Runtime identity

Historical candidate tooling labeled 2.26.1 `supported` and 3.0.2 `unqualified`. Current source accepts only 3.0.2 but still requires candidate-specific qualification. Runtime installation creates a separate versioned executable and hashes its installed files. It never changes the shared `vibe` command. Installation identity is not protocol qualification and does not authorize dispatch.

## Wire facts and re-pinning

Every fact the app-server client assumes about the accepted version is one entry in `src/backends/app-server/vibe-wire.ts`, keyed by the version string: the config tool names (`read_file`, `write_file`, `edit`) and the approval-wire names, effect kinds and fingerprint material they map to; the review and edit profiles; the disabled tools; the `permission = "ask"` value; the `unified` harness name; the `VIBE_*` runtime settings written and read back, with the `default_agent` and `enabled_agents` keys; the managed-config route and its `vibe_base_url` setting; whether `config/read` may omit `harnessSelectionSource`; the bundled plugin skills and their provenance ([ADR 0006](adr/0006-bundled-vibe-skills.md)); and the history entry kinds and notification methods treated as known. `approvals.ts`, `session-config.ts`, `readback.ts`, `bundled-skills.ts`, `protocol.ts`, `events.ts`, `managed-config.ts` and `app-server.ts` read the pinned entry; `tests/unit/vibe-wire.test.ts` checks that the table holds exactly the selectable versions and that no wire literal remains in `src/` outside it. The version itself stays in `supported-vibe.ts`, and the pin manifest is still checked at launch.

A re-pin is owner-triggered and runs in this order:

1. Review the new tag's source the way the [source basis](#source-basis) above was read, and record the hashes and facts in this document. Add the version's entry to the table from that review; a changed approval-wire name, effect kind, setting key or route changes only that entry. Move `SUPPORTED_VIBE` to the new version; the table's `Record` type then requires the entry and refuses an entry for a version that is not selectable.
2. Regenerate the per-candidate pin manifest on the machine that runs Vibe with `vibe-supervisor pin-manifest`; the old manifest fails `manifest-version-mismatch` by design.
3. Run the lighter re-pin qualification: a preparation PASS for the installed candidate ([preparation](preparation.md)), one fixture review and one fixture edit on the target. A re-pin is a new candidate, so the earlier candidate's hosted evidence does not transfer, and the full [target acceptance](target-acceptance.md) still gates the gates it names.

## Search tool facts

Read on 2026-10-28 from the same `v3.0.2` tag commit for [ADR 0007](adr/0007-review-search-tool.md). Source reading only: no Vibe was installed or run, and no fact here is hosted evidence.

| Source path | SHA-256 | Fact relied on |
| --- | --- | --- |
| `vibe/app_server/protocol.py` | `d0a7b8e712bced849014982cfe342b6f4967f1c1b343cd99a0b46b073013488d` | `AgentConfig.mcp_servers` takes `SessionMCPStdioServer` (`transport`, `name`, `command`, `args`, `env`, `cwd`); `ConfigReadResponse` reports `mcp_servers_total` and `mcp_servers_enabled` |
| `vibe/app_server/_runtime.py` | `ad3561ab5f9e0b529313b443df2057736f26afab8a0d68eae8cd98946a38bb7f` | a session stdio server becomes `MCPStdio` with `command=[command]` and is applied as the `mcp_servers` override |
| `vibe/core/config/models.py` | `4cd2c5b19039dc6721324a6c6af1fb97af281045992db64a6f62f3210d4d7b13` | `MCPStdio` defaults: `startup_timeout_sec` 10, `tool_timeout_sec` 60, `sampling_enabled` true, `disabled` false, `disabled_tools` empty |
| `vibe/app_server/_config_introspect.py` | `e69a20c5c53f0c387fa4e09fbaba48c36e0ee7f5001b2d5e2d1952abbf680203` | effective read redacts every MCP `args` and `env` value and keeps only the program of `command` |
| `vibe/app_server/mcp_catalog.py` | `8709efaee6c7f3925abb4bbb7959cedf013dd3d025d39df461bcc100bb40374d` | `runtime/read` projects a configured server as `kind: server` with its remote tool names |
| `vibe/app_server/models.py` | `180257cbfc7ccb18de366f42100abe01fddbc95273ac7183ea5bf2816cf9365a` | `MCPSourceSummary` and `MCPSourceStatus`; `ApprovalCallbackDetail` carries an `EffectDetail` |
| `vibe/app_server/_unified_harness_backend_adapter.py` | `2b63dfc160aa1b6877be15dd7d9e946e192ef68c4820861b543535731081473b` | MCP tools are filtered by `enabled_tools` and `disabled_tools` globs; `config/read` counts configured servers |
| `vibe/app_server/_unified_permissions.py` | `e8190f27982acc818fb828d66a5edd47023283e5ebfc8298ff6112440dfb8911` | a non-builtin name is a provided-tool route; with no configured permission it resolves to `ask` |
| `vibe/app_server/_effect_models.py` | `188bb56c856a9844f12f368f62807c343ea19e28cc7aec6fb341afb40b1f3c14` | an unprojected call is `GenericEffectDetail` with `kind: tool`, `tool_name` and `input` |
| `vibe/app_server/_unified_tool_projection.py` | `987d70d4b41b8513ae39026ffb7b66ac4deba08dcae73178f828fbf2a6a38efb` | only listed builtin names are reprojected; a bare `grep` name would be, an `mcp_*` route is not |
| `vibe/app_server/_client_provided_tools.py` | `86c25f74952e628a75bbfadc536ce0807701a280b0e612bcc29d91bf37eec84e` | client-provided tools are internal; nothing on the app-server wire declares them |
| `vibe/core/tools/builtins/grep.py` | `acbed8afb25ba08d4c2e920a2550c15ff3145a94c5d99acc29c050918b99ded1` | `resolve_permission` judges only `args.path`, the directory searched |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_mcp_naming.py` | `733e5994a09504173e5ea1e68b52d94412571ca26948e6fd7daab3514899df9a` | group `mcp_<server>`, member = remote tool name, display name `<server>_<tool>` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_mcp_models.py` | `0144318f24c39e868539f2b5b005b78802b4e21fdce8edb1f5f40adc44b74994` | `MCPToolFilter` matches the display name, not the route |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_host.py` | `4ff0f76b2fd870a72707a705574398020b2f6d1498b6211fb30b99bb47bc08f2` | every MCP and connector tool is registered for `run_typescript` only, never as a direct tool |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_mcp_transport.py` | `b9bb0df2fcab83215bb8145efd580c1f046c6624acc7d5cca669debbce1ec2f0` | stdio servers start through the `mcp` SDK `stdio_client`; an empty `env` is passed as none |
| `harness/core/src/core/config.rs` | `4c9442d3558f738575bfee537a22d81737fdad3cea8723802795dee20ebc981e` | the three tool exposures; only direct ones are model-visible tools |
| `harness/core/src/core/features/programmatic_tool_calling/tools.rs` | `930e6dd4030ee23e692a86ced0c2793d58a3eadcf2f57e6bedeb2ec1b5ccbd1b` | `run_typescript` is the only direct wrapper tool |
| `harness/core/src/core/features/programmatic_tool_calling/descriptor.rs` | `76757115bb9e83bf4a38559ce4a5f4d238603f60de2dc62da60c2495a172ac8d` | members are named `tools.<namespace>.<name>` |
| `harness/core/src/tests/acceptance_scenarios/permissions/programmatic.rs` | `d863b003ab080d8562ba96069e188bf10cb3325e2caf303fae371a118808af4d` | a nested call asks for approval with `tool_id` as the route and a `tools.`-prefixed display name; a rejection reaches the program |
| `harness/core/src/core/features/permissions/approval.rs` | `e90e671a9de7cf4ecd6dcc2254d81fa431a7fc0f423e0c38884963ae50303fd9` | approval outcomes are approve or reject; a timeout counts as a rejection |
| `pyproject.toml` | `039fbfafbee1ff708263711630860aad00e0d2661c05599cbcb62c6af7d011aa` | pins `mcp==1.28.1` |

The `mcp` Python SDK at tag `v1.28.1` (commit `777b8d06710c140e3606b0d4598e2aa48546c266` of `modelcontextprotocol/python-sdk`):

| Source path | SHA-256 | Fact relied on |
| --- | --- | --- |
| `src/mcp/client/stdio/__init__.py` | `a23227cfe1e3456f16ab41311486a399cf547fcc6b645399bf9bf3a6dc6cf654` | the server inherits only `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER`, and on Unix starts with `start_new_session=True` |
| `src/mcp/os/posix/utilities.py` | `99311857be0cf73f6cd9d79759cb695064d2d4c36d90eafb2180975379b194d2` | Vibe's own close kills the server's group with `killpg` |

The source does not settle three things: the exact `toolName` on a live MCP approval effect, whether `runtime.tools` lists MCP tools, and whether a nested `write_file` arrives as a `file_system.*` effect. The first two are for the hosted gate in ADR 0007. The third is gate `nested-run-typescript-shape-and-gating`.
