# Vibe 3.0.3 re-pin assessment (2026-10-28)

**Recommendation: wait. Do not re-pin to 3.0.3 now.** Re-pinning is mechanically small but not free. 3.0.3 renames the edit tool on the approval wire, from `file_system.search_replace` to `file_system.edit`, and the changelog does not mention it. Under the current pin an edit run would be denied every edit, so a re-pin needs a code change. That change makes a new candidate, and the qualification v2.2.0 just earned on 3.0.2 does not carry over to it. None of the 3.0.3 fixes addresses a problem we have seen on 3.0.2. Reassess at the next Vibe release, or sooner if a hosted 3.0.2 run hits one of the fixes listed under "Fixes that touch us".

This is research only. Nothing was installed or run. The facts come from the tagged source, fetched through the GitHub API on 2026-10-28 (`compare/v3.0.2...v3.0.3` and the tag tarballs) and read as text. No hosted run or no-inference probe was made. Nothing here qualifies 3.0.3 behaviour on the target.

## Source basis

| Tag | Commit |
| --- | --- |
| `v3.0.2` | `36f7b3a4e10440e90f98080492530b8f4d46960d` |
| `v3.0.3` | `7bb48f213ac677f943d5c791199ed3dddf302f00` |

The comparison is 3 commits ahead: `1ffeaa1338` (umask fix), `63d0e8f17e` (revert of that fix) and `7bb48f213a` (the 3.0.3 release, which squashes all other changes). The compare API truncates its file list at 300 files. The full tree diff below comes from both tag tarballs and has 2,673 differing entries. Most of them are client-e2e goldens, the Rust CLI and the harness core.

SHA-256 values are for the exact file bytes at each tag. "Same" means the bytes are identical.

| Path | v3.0.2 | v3.0.3 |
| --- | --- | --- |
| `vibe/app_server/session.py` | `9ea618fc88a474b6b3d18bcee16bfaef5e2cb7de0aab5254dbd0e590e2d99119` | same |
| `vibe/app_server/models.py` | `180257cbfc7ccb18de366f42100abe01fddbc95273ac7183ea5bf2816cf9365a` | same |
| `vibe/app_server/_effect_models.py` | `188bb56c856a9844f12f368f62807c343ea19e28cc7aec6fb341afb40b1f3c14` | same |
| `vibe/app_server/_approval_permissions.py` | `04e0fbfb21058a4b71c60ebea76dcabc07f04777b63c4750a6fb1897128777cb` | same |
| `vibe/app_server/_history_projection.py` | `1a6e5f309990fe3ea2f2b5b35d0a41a9924b948b528b9d6ebc8552b82d96f9d0` | same |
| `vibe/core/config/admin_config.py` | `af6fe5a1ab007c4a8f497df7261d39aa53e74bc9d9833597f87e7e586b1a6e94` | same |
| `vibe/core/config/layers/admin.py` | `1f942a01fd5d01f3e58b11c889d0b8f5c8d8d28c86514784316dde79e9d6b00d` | same |
| `vibe/core/config/layers/environment.py` | `5671b47656c5d4f8822f1bd3c7469e1171ceb7aadabe80d387a7eda0d70a2a0d` | same |
| `vibe/app_server/_connection_protocol.py` | `7ddc84f91d81a1cd299c409792f09ccbdbf7eaabf072a11a33eb9a9519cbe1c8` | `df817944eab6645d491157e937a9e13afb756e5c330f083bae1229524bc37219` |
| `vibe/app_server/protocol.py` | `d0a7b8e712bced849014982cfe342b6f4967f1c1b343cd99a0b46b073013488d` | `b30a6a4677560db18d5ac0cd819ed4c4a3570d835d18101ca9e3d64fc6f0b589` |
| `vibe/app_server/server.py` | `05eedf63aa8ecb2423199e248b8fbde0afad0138f7d55b3dbf65427c6701ba76` | `82bea0d46ef42812064f3f38c0ff608a80bc13dc3315abbd5c3912e02d559da5` |
| `vibe/app_server/events.py` | `6bcf1f97f090c83f7625c5ca61fa178c1f4107ef4c9747d12f377896bf58f7fe` | `307053aef3ff803688109b00beb529a8641b2f5e437a3d9cad14c9fa962a5398` |
| `vibe/app_server/_runtime.py` | `ad3561ab5f9e0b529313b443df2057736f26afab8a0d68eae8cd98946a38bb7f` | `57d1628fb4eaa3f4245422fd3b0906b91a30b6032341ee026953805c309e2f71` |
| `vibe/app_server/_config_introspect.py` | `e69a20c5c53f0c387fa4e09fbaba48c36e0ee7f5001b2d5e2d1952abbf680203` | `98cae5231dc50711adf1d372f26bd0eade9a91647713df7fe8717de930a35eee` |
| `vibe/app_server/config.py` | `617ff9fbf2102eef537ad28f4f2797578afc8c16624a17da90402c02c8f6a5dc` | `5170b1430bfa589cf8e98bea853c23484cd1a1684ca06bc93917774e54431dd9` |
| `vibe/app_server/_unified_harness_backend_adapter.py` | `2b63dfc160aa1b6877be15dd7d9e946e192ef68c4820861b543535731081473b` | `a8c9baf3dbc1f2c6607abed80da5c31389c4532239d21042933a05c959fffa29` |
| `vibe/app_server/_unified_tool_projection.py` | `987d70d4b41b8513ae39026ffb7b66ac4deba08dcae73178f828fbf2a6a38efb` | `ec1e1e999ef1f6fc73b77ad94faee26b398a09ce73e2c562a36958b06c462ca5` |
| `vibe/app_server/_unified_permissions.py` | `e8190f27982acc818fb828d66a5edd47023283e5ebfc8298ff6112440dfb8911` | `df494ed1414620b38b377c73067860ff228e028f3f4cfbebf33a8d78f65f0981` |
| `harness/core/src/core/tools/external.rs` | `2dfaa53b3fcaad8d640d86482b3f965f73678ef56976d2e3c43502928fa2e5b8` | `449def08e2f2d7c56593c226f3d39020c1b52d7c9d944904d3813d9946282c27` |
| `vibe/app_server/connector_catalog.py` | `c90c5a12dc555f55bb72b831d38fcaaf580ed93b1d5a8265f0feac730d9c5efc` | `91ea6874363e74ffbf71839354f116d401e96ac5d068df799ecdfbd33b2fdd11` |
| `vibe/app_server/stdio.py` | `40252370ab68967641cb33c3fb6e64ead16944d12e27ddbea08fb9b2b502133e` | `da1db6bd7a0353db6094c15aec9cc9c67dfa7369207f384aad1a352b034b04a0` |
| `vibe/app_server/_termination.py` | `8e2d45c52f68ca3e300fbf7ce55c87c1c78a753d7a04e9f5ce1c42eff85f5b3c` | `647e94052f34e3fa0c3ce73cc75a3982b91d0590771726a4b31f64d930f2f68d` |
| `vibe/core/config/vibe_schema.py` | `93c394bb630c61a6f5c4b29010505ed7713cce457e31b22891ff0dcf4a91b11e` | `9342baaddd5c3b5c98bad5244c706ec90c3927ec3351ca058124f44993c9803d` |
| `vibe/core/config/models.py` | `4cd2c5b19039dc6721324a6c6af1fb97af281045992db64a6f62f3210d4d7b13` | `d4abacf3de26319204df421b3f30232cc57fe7f1800c9f5630e05c3e6f435b35` |
| `vibe/core/config/layers/agent_profile.py` | `a252e3773cce8fac025dcd458ccdeef62e37ebc95a4829fea0176a381265272f` | `1cef642b68e33ca5d9a44ff6d378cd64dafaf2f44bb738ae4489ebb347555c14` |
| `vibe/core/config/layers/growthbook.py` | `60eec5e5bbc60f3f64f530bce01e1379ab3a456c9ebd9b5496e1582fef516045` | `10177bdb100a0562e96f77decfd552b5330b03d528b34834be092fe16ee5c8a4` |
| `vibe/core/experiments/active.py` | `2981cb66250c157ed076b8d8e155c97509bbc281d89257a1e4baaa0d2b522fce` | `c922bf9969ea924222e853faccd8f92ef2e82769741e21db96781e9ea4e72421` |
| `vibe/core/agents/registry.py` | `4f2f36cb8c6a17a6889119ff809846f30ba85d30342197fb0ae72e9f700275dc` | `a3700bcd00df0b1c4f775e46f3230952c8044a02c901a25343d07f5150b1cd66` |
| `vibe/core/agents/models.py` | `3e240ce910b557c7553be16e4d86031023ce5d94bc9ad601dd9953dab6eaf063` | `3278d6d0f5b0b48252eda643031289e6884f8a39b5ddc5245c1ce94f5a62c121` |
| `vibe/plugins/builtins/vibe/skills/vibe/SKILL.md` | `d01cab3f9625d083d2eb75a5e38a0913e89eca1e753d316095f07c5d88856fd3` | `752a8c40a3489ba914f37b4189cc0b9dca3df7adc6a4988b7338126ac1db1c70` |
| `vibe/acp/agent.py` | `c229343dac46587aa2e6174e6a98bba3a7bf78cc72fda2c3e98bd05822dfc57f` | `e4328e7ce0252e6cd77e1f335aacd4928a47089910acfbb6e872d234c90be37e` |

These files exist only in v3.0.3:

| Path | SHA-256 |
| --- | --- |
| `vibe/core/config/_setting_keys.py` | `c776ff6c9713fbdb5bbc7e8e54e0ea5996eca80bcc5ab4d52ccc29ec647268de` |
| `vibe/app_server/_platform_credentials.py` | `71c34bebfd12d687933c9fd7da41ea878e69119a6f8af08f2d6ab8b754d2a653` |
| `vibe/app_server/_session_artifacts.py` | `39b655c29829fcddc4a7299a84a718c559155e83ee134a4d4af2720ec573fa27` |
| `vibe/core/git/forge.py` | `0ac22c6bfdfb9133ac0a3763f19a57d0bb7b087ecca73f84b27c7195eb27b7a4` |
| `CHANGELOG.md` (v3.0.3) | `1948f09d87fb85d90dbe66b6618406ce8a1e3e1f1d465d5d4a2267200152a6b8` |

## Category results

| Category | Status | Evidence |
| --- | --- | --- |
| Initialize response | **Unchanged.** `InitializeResponse` is still `server_info` plus `process_id`, with no protocol-version field. A new optional client capability, `platform_credentials`, is the only addition. Only a client that declares it receives `platformCredentials/resolve` requests from the server or may send `platformCredentials/invalidated`. We declare only `callbackKinds: ['approval']`, so neither path runs for us. | `_connection_protocol.py`, `server.py` |
| Session start options and our `agentConfig` (`cwd`, `agent`, `enabledTools`, `disabledTools`, `maxTurns`) | **Unchanged.** The `protocol.py` diff touches no session-start model. `session.py` is byte-identical. | `protocol.py`, `session.py` |
| `runtime/read` | **Unchanged.** `RuntimeSnapshot` has the same fields, including `issues`, `hooks_count`, `skills`, `tools`, `connectors`, `mcp` and `bypass_tool_permissions`. One new source of warnings: 3.0.3 reports config keys it does not use (see "Unused-key warnings" below). Those warnings go to `config.validation_warnings`, not to `runtime.issues`, so our `runtime.issues == []` check is unaffected. | `protocol.py` (`RuntimeSnapshot`), `_runtime.py` (`build_unified_runtime_snapshot`), `_projection.py` |
| `config/effective/read` | **Unchanged in shape.** Every key we write is still declared in `VibeConfigSchema`: `enable_subagents`, `enable_background_processes`, `managed_shell_tools_enabled`, `enable_connectors`, `disabled_skills`, `mcp_servers`, `enable_telemetry`, `enable_otel`, `enable_update_checks`, `enable_auto_update`, `experimental_enable_model_catalog`, `experimental_enable_registry_skills`, `experiments.enable`, `session_logging.enabled`, `session_logging.generate_titles`, `bypass_tool_permissions`, `default_agent`, `enabled_agents`, `vibe_base_url`, `enabled_tools` and `disabled_tools`. The new keys are `strict_config` (default false) and `experimental_enable_pr_monitoring` (default false). `ModelConfig.auto_compact_threshold` becomes `int \| None` (0 is now an error), and `supports_images` becomes `bool \| None`. We set neither. | `vibe_schema.py`, `models.py` |
| `config/read` (`skillsCount`, `hooksCount`, `harnessSelectionSource`) | **Unchanged.** `skills_count` and `hooks_count` both default to 0. `harnessSelectionSource` appears in neither tag's Python source, which matches our parser treating it as optional for the accepted pin. The parser makes it required for any other version string (`protocol.ts`, `parseConfigReadResult`), so the constant must move with the pin. | `protocol.py` |
| Callback/approval wire and effect kinds | **Unchanged.** `models.py`, `_effect_models.py` and `_approval_permissions.py` are byte-identical. `callback/call` and `callback/result` are unchanged. The `file_edit` effect kind keeps its name. | as listed |
| Tool names (`file_system.*`) | **Changed, breaking for edit runs.** The harness built-in `file_system.search_replace` is renamed to `file_system.edit`. `search_replace` stays only as a deprecated replay-only name that fails without running. The tool's input changes from a batch (`file_path`, `content: [{old_str, new_str, replace_all}]`) to one flat change (`file_path`, `old_string`, `new_string`, `replace_all`). The projected effect input is now `FileEditEffectInput`, not `FileEditEffectBatchInput`. `file_system.read_file` and `file_system.write_file` are unchanged. The Vibe-level tool names in `runtime.tools` (`read_file`, `write_file`, `edit`) are unchanged. | `external.rs`, `_unified_tool_projection.py`, `_unified_permissions.py` |
| History entry kinds | **Unchanged.** `models.py` and `_history_projection.py` are byte-identical, so a 3.0.3 server sends no new kind that would trip `unknown_entry_kind`. | as listed |
| Notifications, watermarks and handoffs | **Changed, additive.** Two new event notifications carry `eventId`: `artifacts/created` and `artifacts/updated`. They fire only with `experimental_enable_pr_monitoring` on. If one did arrive, `events.ts` would count it as an unknown method and still advance the watermark, without making it fatal. There is a new `warning` code, `integrations_unavailable`, for connectors or MCP servers that failed to load. Our client already handles `warning`. The handoff notifications (`session/compacted`, `session/contextCleared`) are unchanged. | `events.py`, `protocol.py` |
| Managed-config route | **Unchanged.** `MANAGED_CONFIG_PATH = "/api/v1/code/managed-config"`. `admin_config.py` and `layers/admin.py` are byte-identical. | as listed |
| `VIBE_*` settings we write | **Unchanged.** `layers/environment.py` is byte-identical, and every key is still declared (see `config/effective/read`). One new environment variable, `VIBE_STRICT_CONFIG`, turns unused-key warnings into a refusal to start. We do not set it. Check that the child-environment filter never passes it through from the parent. | `environment.py`, `_setting_keys.py` |
| Session logging and the throwaway store | **Unchanged by inspection.** `_persists_to_disk` still returns false when `session_logging_enabled` is false. Session artifacts are written into session logs, but only behind the PR-monitoring flag. | `_unified_harness_backend_adapter.py` |
| Telemetry and experiments | **Changed, additive.** There are new telemetry events (`vibe.artifact_detected`, `vibe.artifact_created`) and new startup fields. We keep `enable_telemetry = false`. The new GrowthBook experiment `vibe_cli_pr_monitoring` maps to `experimental_enable_pr_monitoring` and defaults to off. Whether `experiments.enable = false` keeps the GrowthBook layer out is still an open gate in `docs/compatibility.md`. | `growthbook.py`, `experiments/active.py`, `telemetry/*.py` |
| Subagents, shell, MCP and connectors | **Unchanged for our settings.** Shell tools stay outside our profile. Several shell-timeout settings are now hard config errors, but we set none. The stdio app server now warms the connector catalog at process start, before any session. `_resolve_provider` returns early when `enable_connectors` is false, so with our setting that fetch makes no request. | `connector_catalog.py`, `stdio.py`, `_runtime.py` |
| Bundled plugin skills (ADR 0006) | **Unchanged set.** The same four skills ship: `create-plugin`, `skill-creator`, `vibe` and `worktree`. The text of `vibe/SKILL.md` changed (it now documents unused settings, `outside_workdir` and compaction settings), so its manifest hash changes. Running sessions now pick up skills edited on disk without `/reload`. That leaves `disabled_skills = ["*"]` and our empty private `VIBE_HOME` as they are. | `vibe/plugins/builtins/vibe/skills/` |
| Removed or renamed RPCs | **None removed or renamed.** The method list grows from 139 to 142 entries, adding `artifacts/list`, `artifacts/markViewed` and `artifacts/sync`. Every method we call is still present: `session/start`, `session/read`, `session/ready/wait`, `session/history/list`, `runtime/read`, `config/read`, `config/effective/read`, `config/model/write`, `turn/start`, `turn/interrupt` and `callback/result`. `session/ready/wait` gains an optional `integrations: bool = false`. `ConfigWriteResponse` gains an optional `reason`. | `protocol.py` |
| GrowthBook and admin config layers | **Admin unchanged. GrowthBook changed, additive.** GrowthBook gains one mapping (PR monitoring). The admin layer is byte-identical. | as listed |

## Other changes that bear on us

**Unused-key warnings.** 3.0.3 checks the user, project and agent-profile layers for keys the schema does not use. The environment, admin, GrowthBook and model-catalogue layers are not checked. Our profile's `display_name`, `description` and `safety` are stripped as metadata before the check runs (`AgentProfile.from_toml`). What remains is `tools.<name>.permission` and `.denylist`, which are tool config fields. We expect no warning. Even if one appeared, it would go to `config.validation_warnings` and stay non-fatal unless `strict_config` is on. This is **unknown until probed**: a no-inference preparation run on 3.0.3 should confirm that `validation_warnings` is empty.

**Thinking off.** 3.0.3 refuses `thinking = off` on models that always reason (the changelog names gpt-6-astra and GLM 5.3). Our startup writes `thinking: off` and then reads it back. Mistral models that can turn reasoning off are unaffected. Whether the target's active model can turn reasoning off is **unknown** from source alone.

**Model replies.** A reply without token usage now fails the turn. The Mistral API reports usage, and `usage.ts` already depends on it. Replies wait up to 12 minutes for the first output and retry once after 5 minutes of silence. Both sit inside our deadline but change how a stalled run looks.

**PR monitoring.** With the flag on, Vibe runs `gh pr list` and `glab mr list` subprocesses at session load (`vibe/core/git/forge.py`, `subprocess.run`). Those calls bypass the tool profile. The flag defaults to off, but GrowthBook can turn it on. Any 3.0.3 pin should add `experimental_enable_pr_monitoring = false` to `RUNTIME_SETTINGS`, so it is both written and read back.

**vibe-acp exit fix.** On SIGTERM, `vibe/acp/agent.py` now cancels the serving task, then cancels it a second time after `_SIGTERM_CLOSE_TIMEOUT_SECONDS = 1.0`. A second signal still raises `KeyboardInterrupt`. Before this, the first SIGTERM raised `KeyboardInterrupt` directly, which sometimes left the process running in the background. We do not launch `vibe-acp`. The matching app-server fix, in `_termination.py`, cancels the pending stdin read before `aclose()` so that stopping a session no longer exits with an uncaught exception. That makes our cleanup more orderly but is not required by it, because we already bound the exit and kill the process tree.

## Fixes that touch us

None of these was observed on 3.0.2 in our runs. They are the reasons to reassess sooner:

- "The app server no longer exits with an uncaught exception when a session stops."
- Worktree creation no longer runs repository Git filters before the folder is trusted. Automatic project context no longer runs repository signature-verification programs. Both affect Vibe's own worktrees and project context. Our worktrees are created by the supervisor.
- Allowlisted paths now cover paths reached through system symlinks such as `/tmp` on macOS. We use denylists only, and our allowlist is always empty.

The `vibe` on the target machine's PATH is not the supervisor's runtime. The supervisor launches its own versioned executable and hashes it against the pin manifest. A 3.0.3 on PATH therefore affects nothing until someone re-pins.

## Supervisor files a 3.0.3 pin would change

Code:

- `src/backends/app-server/supported-vibe.ts`: `SUPPORTED_VIBE`.
- `src/backends/app-server/approvals.ts`: `EDIT_TOOLS`, `WRITE_TOOLS`, `EFFECT_KIND_BY_TOOL` and the `inputFingerprint` case go from `file_system.search_replace` to `file_system.edit`. `normalizedChanges` already accepts the flat input.
- `src/backends/app-server.ts`: `TOOL_NAMES` maps `file_system.edit` to `edit`.
- `src/backends/app-server/session-config.ts`: add `experimental_enable_pr_monitoring = false`, so it is written and read back.
- `src/config/policy.ts` and `src/config/config.ts`: the default version and the version named in the error text.
- `scripts/runtime-install.mjs`: the version table. The per-candidate pin manifest is regenerated by installation, not edited.

Tests and fixtures: `tests/fixtures/fake-vibe-app-server.mjs`, `tests/fixtures/app-server-scenarios/{edit-call,args-altered,args-altered-after-approval}.json`, and the tests that name the edit tool or the version: `tests/unit/{app-server-approvals,app-server-events,fake-vibe-app-server,app-server-protocol,runtime-install,setup,config,cli,no-legacy-references}.test.ts` and `tests/integration/{app-server-backend,app-server-wiring,config-without-pin-manifest}.test.ts`.

Docs:

- A new 3.0.3 source basis beside `docs/compatibility-v3.md`.
- `docs/security.md` and `docs/functionality.md`, which name `search_replace`.
- AGENTS.md "Boundaries" (the exact-pin line), README.md and Handoff.md.

Qualification: a new candidate, a preparation PASS for it, and the target-acceptance procedure, all repeated. Evidence for 3.0.2 does not transfer.
