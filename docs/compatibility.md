# Compatibility

Current source policy admits **stable Mistral Vibe versions at or above 3.0.2**, without a per-release allowlist. The optional `vibe_version` is a minimum, defaulting to 3.0.2. The actual installed version is detected from package metadata and must match both its manifest and the startup handshake. This version eligibility is not qualification: candidate-specific preparation and hosted gates remain separate, and evidence never transfers to another archive or installation. Its tagged-source review is in [Vibe 3.0.2 compatibility assessment](compatibility-v3.md), and does not certify the installed runtime, hosted behavior, or this current candidate. The five MCP tools require a local one-start dispatch grant created with `task authorize`; see [the reference](reference.md#cli). Historical compatibility and acceptance evidence below names the 2.26.1 archive it belongs to and does not transfer to 3.0.2. Google Antigravity (supported `agy` versions `1.4.0`, `1.4.3`, `1.4.4`, `backend = "antigravity"`) remains an optional experimental backend documented in [ADR 0008](adr/0008-antigravity-execution-backend.md), off unless `experimental.antigravity = true`, and not for production until the [Antigravity gates](#antigravity-trust-assumptions) pass on the target. There is no ACP adapter or fallback to an unverified entry point.

## Historical Vibe 2.26.1 source basis and evidence

The following source review and target reports are historical evidence for the exact 2.26.1 source or archive named in each section. They do not describe the current default and do not qualify Vibe 3.0.2.

This historical profile used Vibe 2.26.1. The protocol carried no version field, so its pin required the server to report exactly `serverInfo.version` 2.26.1 and the installed package files to match a manifest generated for that candidate. Those source findings came from Vibe's tagged source (`v2.26.1`) read without running it, supplemented by one no-inference observation with an earlier build of this workflow. They do not certify other builds or operating systems. The historical supported platform claim was macOS Apple silicon.

## The pin and its manifest

The manifest mechanism below remains in use; historical 2.26.1 observations do not qualify the current candidate. Current version policy accepts stable versions at or above the configured minimum, while manifest identity remains exact to the actual installation.

`src/backends/app-server/supported-vibe.ts` defines the minimum and stable-version validation. There is no release-by-release allowlist. The manifest is a JSON file written by `vibe-supervisor pin-manifest` on the machine that runs Vibe, once per candidate, and named by `paths.vibe_pin_manifest`, which is required. It records the manifest format, the Vibe version, the SHA-256 of the installed `mistral_vibe` distribution's `RECORD` file, and the SHA-256 of every file `RECORD` lists. Review it before relying on it: it records what is installed at that moment.

Before each spawn the supervisor locates the Python environment from the `vibe-app-server` script's interpreter line, requires a virtual environment, reads the package metadata version, and compares `RECORD`'s digest and every listed file's hash with the manifest. The script itself must be listed. Files in the covered directories that `RECORD` does not list fail the check; compiled `__pycache__` bytecode and `RECORD` itself are skipped. It is bounded in file count and bytes, and unsafe or non-regular files are refused. Failures carry a `details.reason`, for example `manifest-unreadable`, `manifest-version-mismatch`, `record-mismatch`, `file-mismatch`, `file-missing`, `file-extra`, `file-unsafe` or `version-mismatch`, under `VSUP_VIBE_VERSION_UNSUPPORTED` (or `VSUP_VIBE_NOT_FOUND` when the executable or interpreter is missing). The check returns the real path of the verified script, and the worker is spawned from exactly that path. The identity that passed (version, the SHA-256 of the manifest file as read and the SHA-256 of the installed `RECORD`: `vibe_version`, `manifest_sha256`, `record_sha256`) is saved in the run record as `pin` and appears in an export's `report.json`. The scope and limits of this check, including the known limitation of its reach, are in [security](security.md#process-configuration-and-persistence): it covers only the `mistral_vibe` `RECORD`, not dependencies, `.pth` files, the interpreter or `__pycache__`, and it runs before the process starts.

## Wire facts the client relies on

Historical wire facts for Vibe 2.26.1 only. The Vibe 3.0.2 tagged-source assessment is maintained separately in [compatibility-v3](compatibility-v3.md); neither source review proves current target qualification.

Read from the source at the Vibe tag, commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0`; the files and their hashes are in [Source basis](#source-basis). The no-inference checks of the workflow candidate and of the corrected 2.0.1 archive on a running server confirmed the handshake and configuration read-back subset below. One hosted review on the corrected archive then observed approved `read_file` calls through the handler, `runtime/updated` and `session/updated` as ignored notification methods, and no handoff or turn retry; it did not exercise a nested write, a denied write or an edit on main's evidence. A source-read fact is not an observed gate.

- **Framing and handshake.** One compact JSON object per line. `initialize` carries `clientInfo` with the entrypoint value set by `CLIENT_ENTRYPOINT` in `src/backends/app-server/protocol.ts` and `capabilities.callbackKinds = ["approval"]`; without that declaration the server crashes on its first approval. The result's `serverInfo.version` is checked against the pin, then the client sends `initialized`. The server sends error codes as strings (`unauthorized`, `invalid_params`, `not_initialized`, and others); `unauthorized` maps to `VSUP_AUTH_REQUIRED`.
- **Strictness.** The server's models forbid unknown fields and require `params`, camelCase. The client sends exactly what it builds and tolerates unknown fields on read, but requires the fields it depends on.
- **Approvals.** The server sends the request `callback/call` and never times out a pending one. The client acknowledges it, then answers with a separate `callback/result` request (the name Vibe's code accepts; one ADR of Vibe's still says `callback/respond`). The answer is `{"type": "approval", "decision": {"type": "approve" | "deny"}, "feedback": null}`, never a session or permanent approval.
- **Tool names and inputs.** The wire names are `file_system.read_file`, `file_system.write_file` and `file_system.search_replace` (Vibe's `edit`); the model-visible names are the short ones. Effect kinds are `file_read`, `file_write` and `file_edit`, and each carries `filePath` as the model wrote it. An effect that does not project to its expected kind is generic and is denied.
- **Effect outcome metadata.** An approved, executed call carries decision `execute`, approval type `ask`, source `user`. A call denied by approval or by policy fails with code `tool_denied`. Metadata is null when a result never passed Vibe's gate; the client treats null as unapproved.
- **Configuration read-back.** `config/effective/read` returns the redacted effective configuration in snake_case, with per-tool `permission` and `denylist` under `tools.<name>` when a layer sets them, and the active model's `thinking`. `runtime/read` returns tool names only, plus skills, connectors, MCP, hooks, issues, bypass state, statistics and the model configuration.
- **History and events.** `session/history/list` pages 1 to 500 entries (default 200), items oldest first, cursors are entry ids; the client pages backward from the end. Notifications carry monotonic event ids; the snapshot's id is the watermark. `session/compacted` and `session/contextCleared` hand over to a new session id. Unknown notification methods are ignored; unknown history entry kinds are not.
- **Limits and usage.** `maxTurns` becomes Vibe's iteration limit. The server does not enforce price or token limits and writes no run export, so the supervisor enforces `limits.max_tokens` and `limits.max_cost_usd` from `session/statsUpdated` and `runtime/read`, and computes cost with Vibe's pricing formula (cached tokens clamped to prompt tokens).
- **Outcomes.** Turn status is `in_progress`, `completed`, `failed` or `interrupted`; stop reason is `limit` or `length` or null; error codes include `invalid_api_key`, `invalid_model`, `context_too_long`, `response_too_long`, `rate_limit`, `refusal`, `backend_error`, `internal_error`, `incomplete_stream` and `compaction_failed`.
- **Shutdown.** Closing standard input ends the message loop and runs Vibe's cleanup, including removing the throwaway session store. A termination signal skips that cleanup, and the exit behavior after `session/stop` is not established, so the supervisor does not use `session/stop`.

## Source basis

Historical Vibe 2.26.1 source basis. Keep these recorded hashes unchanged; they are not the current source review.

Every wire fact above was read from Vibe's tagged source, `v2.26.1` = commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0` (a lightweight tag, checked as both the tag ref and the commit), through the GitHub API. Nothing was installed or run. The scripted fake `vibe-app-server` (`tests/fixtures/fake-vibe-app-server.mjs`) and the client's protocol types were written from these files, independently of each other. The table lists each file read with the SHA-256 of its bytes at the tag; paths are relative to the root of Vibe's repository.

Revalidating for a different Vibe release means reading the same files at that release's tag, recording the new commit and hashes here, and comparing every difference with the facts above before any code changes. A file whose hash differs is reread in full. The recorded review covers 2.26.1 only.

| Path | SHA-256 |
|---|---|
| `docs/adr/0009-app-server-boundary.md` | `0bc2f970c6e870a9f0ba9a4617d428741854d1448def83d5aa821d54aee194cc` |
| `docs/adr/0016-rust-cli-delivery-surface.md` | `481858ab9a9a9a743cc755d58744ea953346aef15185a2e46462de23d3942ed2` |
| `harness/core/src/core/features/file_system/mod.rs` | `7679b6209dd8d797835a0f44cabf3b68f288bd5ca1ce77429cccf9d8302e41d5` |
| `harness/core/src/core/features/programmatic_tool_calling/execution.rs` | `181795b9211b36ad075fb55a069882f466902f067b2bd86fb8d03d6f345ce4f8` |
| `harness/core/src/core/tools/execution/mod.rs` | `ef1c98994348a5ee7a3a2ab8d6f1681cee8b8a715f58c77cdb519bfaa1d6d306` |
| `harness/core/src/core/tools/external.rs` | `7dec378072aeea4b1c3665232128955478820114675c885c9d51aee855258f1d` |
| `harness/core/src/core/tools/resolved/assembly.rs` | `0dbbd194fefed3df2b33a798b3e115adb60ffcfa9016687c8b680f0df3903c15` |
| `harness/core/src/core/tools/resolved/mod.rs` | `6462af75816add80b70903b7a835a3f56c7909290cac3b6e625c9f1e22441af4` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/protocol.py` | `f969fadeecef1597028774360e911f94bacd6c95443b2d74d8ddb37673dda5dd` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_host.py` | `b8bc5ed27b3f7c91690680ab9a896835b334cbae9d865bb53e325bbc5efbf70a` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_local_actions.py` | `f0a855ef3d11b65fa264924862b3127c93091e2be313eda3314d08aadbdc22ab` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_projection.py` | `51f0980cbbf65a68de25fe2d8620a19502e5fc38c7c5c1077f75c8f79217963f` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_runtime.py` | `55fb9e01f4a871b4c6677fb64957b2b6c70e784ac8011c003e35d07ebf35aefa` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_sandbox_helper.py` | `10526afbf5402170e4dcea190ec50090d2886ceb5352de416b7191cb8048d8c3` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_session.py` | `1fe2442ab69d287c650910ed70a3ffe844ecea874cb1cdbf46423605409be436` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_storage.py` | `68ac57e766dc0e2038f7de5388b164ad98f4bc38145e1575788cb77a9488548b` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_subagents/_configuration.py` | `11ee676ff7fdb5d51382455b2ca8101a05506660c34cbb24249809fe0f0874c4` |
| `harness/runtimes/python/python/mistralai_vibe_local_harness/vibe/_subagents/_controller.py` | `5c8b3ed43d31370d39fb2c8f568ddf12c6d6826578a3762f6c85b47383ac8a21` |
| `pyproject.toml` | `339856af4e36aafc0df9dd27e5b37b711d148330482b0fb8372378ee7115ba6e` |
| `tests/app_server/test_unified_tool_projection.py` | `80ce16e5dd5e995555fc53aba92581d9593b643b9e12227d46f311bde9865453` |
| `vibe/_experimental_harness.py` | `eace7ceb43ea8913fe94d37a30b88eb183e18b5901f013e12461f72c8fb7cebf` |
| `vibe/app_server/_client_provided_tools.py` | `52f6fa81a531c768a29d676fc915c4e41eaf2889f696e5a4a7cfa0944335fead` |
| `vibe/app_server/_config_introspect.py` | `c9ba0eaeabf60b8765ca61513efc6cd4db9f4e336021c1f13b60de77de93c817` |
| `vibe/app_server/_connection_protocol.py` | `8372b35abd288a5ccc21dcccf9337709ead7504981904a34da7ad157fdc3495c` |
| `vibe/app_server/_effect_models.py` | `8fca2e7e124cc086e3085ba1b16bec7b4759b9db57dfdd22d62666c320e6d701` |
| `vibe/app_server/_model.py` | `9e0f99b33f9988334117ecabb0d979f7b07f1947193ccb5cc8db9ede036901ae` |
| `vibe/app_server/_projector.py` | `f5f4c7f7a2808b3052c3e1f24471adc3d887eaf03627a936d94c7a046d5d8153` |
| `vibe/app_server/_provided_tools.py` | `f6dd427c1f36bcea612e99399c8a389debc6035788d042d2e1648ac9f731d9f7` |
| `vibe/app_server/_runtime.py` | `0c766f4a4931779639304152a9aa6c392f2eafd8dcdc5a9de50f99ea821d9042` |
| `vibe/app_server/_state.py` | `fa000cea561dd323606eecbd2584bc9766787b3ebc9c7caf85af56dd97f1af15` |
| `vibe/app_server/_tool_io.py` | `a4d124b64e82c3c51625f303e44e47f4528b27aa0c254fc420dd376aada4a329` |
| `vibe/app_server/_unified_harness_backend_adapter.py` | `5784d07e34dde7c37081bb6f303d6b49cf0e4a5e9b810ec89fe8e4ff417659f4` |
| `vibe/app_server/_unified_permissions.py` | `44a0716b84007812956df6f3a43b73b609ca58e669f3b4caabf8d9012af0bd57` |
| `vibe/app_server/_unified_tool_projection.py` | `0b3046d0a78a77c771a456900827d60d8d6c3bebda8cee599bf3ea9cf75cb889` |
| `vibe/app_server/config.py` | `0741237c7a63aed216def11acad78e4e094649df098970ae799b45f9fba6f888` |
| `vibe/app_server/entrypoint.py` | `8009ddaa967db878efb3d3f40ff626d5bad97e2848f5011d6f3b62e80a2a8635` |
| `vibe/app_server/events.py` | `6bcf1f97f090c83f7625c5ca61fa178c1f4107ef4c9747d12f377896bf58f7fe` |
| `vibe/app_server/models.py` | `8cdfa65293b0cae02f7fedc1e215fc63c7680b15251ef63f4dd11362215ac384` |
| `vibe/app_server/protocol.py` | `34368acaa20e3ffdfe2d3d0e52c11c361465483442441077faa172f48891481d` |
| `vibe/app_server/run_export.py` | `e48c6da3d727d056f4f4874809aa7162c27a47c8ca42cb8eea5062e9e1261fb3` |
| `vibe/app_server/server.py` | `4dd202b65c8d72c2bdbf7211defac79ce952ced56647beaeedc1f6ca9ecefc07` |
| `vibe/app_server/session.py` | `8476f2f46238c742904236cc4bd4e98b90587d8e8627493ae0c7d9b3a0fefb72` |
| `vibe/app_server/stdio.py` | `57d30b17bc062b3f75d6b1fb257fadd2c45ee46f9db2caf24df1dbbe66aba8cd` |
| `vibe/app_server/transport.py` | `d23dc315e207d90b88ef9f03390db927392b3bfc7301f590470ee81f076acf10` |
| `vibe/cli/agent_socket.py` | `55616d9daa0683e0cf4d53b28bfa877ac2f3f8d72495da7d3ccc47e635fcd59f` |
| `vibe/cli/cli.py` | `f53bd1000145ab6b033845321691b95f7eae7a4f03c3816561524cac588464e6` |
| `vibe/cli/headless_run.py` | `0693c7bee986492625bc5b0b8606527680494528d7b3a16847b45dfddf81593e` |
| `vibe/cli/programmatic.py` | `a938d2440ff5599fa1c48f131c8d6d1ac336aec8cd496c1f8a7caa85c92bbbc1` |
| `vibe/core/agents/manager.py` | `c1a7b7064de7a8ff2e92e91ad0615783af935ab6cce971d5c5fd020bc0419444` |
| `vibe/core/agents/registry.py` | `95791c2ea9cf13d8eb4f181623b10f26dc3405ff8135e60e0315c37c8d5f6407` |
| `vibe/core/config/default_orchestrator.py` | `4556e7771a8bccf960e29e6d7c07c37e0f26a9d8a79ed0e995f01db8df0217d4` |
| `vibe/core/config/harness_files/_harness_manager.py` | `43fc21e2d1a7359ac896ab41e902d927d363ba4ef8f989909af8bcca4b82cbac` |
| `vibe/core/config/models.py` | `4daa1ca9202e2eb09659cdbe7af85918685ffe92eec4b9e6544172c26d94bca7` |
| `vibe/core/config/vibe_schema.py` | `cb1dae2ffd18a898b7e4d4a6deba6814d3b3723318ba7cc0d2832b408888c668` |
| `vibe/core/tools/manager.py` | `a2d5fc658504fd0055f7c16825731b00011e7ae2ffdb51ad95828dc63881659b` |
| `vibe/utils/pricing.py` | `1306b489ce38b4ad8c0169d85954d847edbf98e255fd8d6e4e8ad1966f7d1181` |
| `vibe/utils/vibe_home.py` | `df7191d3ea02bf2e7db1de8263c0f17016482338705622f07ef4384b35f423df` |

## Diagnostic reasons

Supervisor `diagnostic` events carry a `reason`, and some failures carry the same word in `details.reason`.

| Reason | Where | Meaning |
|---|---|---|
| `session_handoff` | event, warning | Vibe compacted or cleared the session and replaced its id; the supervisor followed the new one and added a result warning. |
| `turn_retrying` | event, warning | Vibe is retrying the turn after a transient error. Recorded only. |
| `ignored_notifications` | event, info | Counts of unknown notification methods (with `unknown_methods`), stale events and notifications for another session, ignored by design. |
| `reasoning_observation` | event, info | Recorded once when the turn concludes: `streamed_entries` (structured reasoning entries dropped on receipt), `history_entries` (those found by the final history audit, null without one) and `history_audited` (the audit completed without a fatal error). The two counts can overlap and are not summed. Counts only; zero means none observed, not that no reasoning was generated. |
| `reaper_fired` | event, warning | The reaper ended the worker, because the supervisor disappeared or the deadline plus margin passed. |
| `private_state_retained` | event, warning | The private Vibe directories could not be fully deleted and remain in the run directory; the result carries a warning. |
| `file_listing_unavailable` | event, warning | The bounded workspace file listing was left out of the review prompt; `detail` names why. The run continues without it. |
| `no_progress` | event, warning | The worker produced no output within the configured silence limit; carries `silence_seconds` and `last_activity_kind`. The run fails with `VSUP_NO_PROGRESS`. |
| `launch_failed` | event, error | Starting the backend failed; the run settles failed with the launch error. |
| `worker_termination_unverified` | event, error | The worker's end could not be verified at settlement; the run is failed and keeps its active slot for a safe retry. |
| `artifact_finalization_failed` | event, warning | Finishing the artifacts failed after a run that had not completed; a completed run fails with the artifact error instead. |
| `close_failed` | event, warning | `vibe_close` hit a failure while closing. |
| `worktree_retained` | event, warning | Close left the edit worktree in place; `message` gives the reason, such as no verified patch export. |
| `background_failure` | event, warning | A background task failed (`context` names it) without affecting the run's state. |
| `ignored_backend_state_transition` | event, warning | The backend reported a run state that is invalid from the current state; the transition was ignored (`backend_state`, `run_state`). |
| `readback_mismatch` | `VSUP_BACKEND_ERROR` `details.reason` | The startup read-back differed from the supervisor's session configuration; `details.fields` lists the paths. The run fails before the first turn. A `config/read` that omits or nulls `hooksCount` or `skillsCount` is a mismatch too. |

Other `VSUP_BACKEND_ERROR` `details.reason` values name an unsafe event: `unapproved_effect`, `unknown_entry_kind`, `unknown_effect_status`, `malformed_notification`, `patch_failed`, `retention_exceeded`, `history_paging_failed`, `watermark_gap`, `session_handoff_unsafe`, `historical_effect_changed` and `unfinished_effect` (an effect had not finished when the turn ended). A budget stop whose final audit could not run fails with `audit_unavailable`, or with the audit's own error. Usage faults are `usage_counter_regressed` (a counter went backwards outside a handoff) and `price_unavailable` (a cost ceiling is set but Vibe reports no prices).

## Local checks

`vibe-supervisor doctor --config <path> --json` checks Node, Git, the backend pin check against the configured manifest or binary, selected config provenance and local storage prerequisites. Its JSON records the exact `application_entrypoint` and `runtime_module` that produced the report, and `provenance.backend` (`app-server` or `antigravity`). When `backend = "antigravity"`, `doctor` verifies that the `paths.antigravity` executable exists, matches a supported pinned version (`agy 1.4.0`, `1.4.3`, `1.4.4`), and records its binary SHA-256 digest. Doctor hashes the installed files or binary, launches nothing and makes no provider request. It cannot establish provider authentication or the identity of an already-open MCP connection. The actual connection must be checked separately for its server version and exact five-tool catalog. Authentication is observed during a real run.

Use `npm run verify:release` for local code and security verification and `npm run smoke:install` for the offline installed-package check. The smoke verifies the installed executable and exact MCP tool inventory; it does not run a Vibe task or prove hosted inference. The protocol tests run against a scripted fake `vibe-app-server`, written from the source audit; it shows the client handles what the source says, not that a real Vibe behaves that way.

The declared Node floor is 20.19.0. Release acceptance compares major, minor, and patch components; a passing run on another Node version does not establish that the minimum runtime itself was exercised. Verify the frozen package on Node 20.19.0 before making a stable compatibility claim.

`vibe-supervisor prepare check --kit <preparation-kit-VERSION> --config <path>` is the local check that exercises initialization without inference: for `backend = "app-server"`, it launches the installed `vibe-app-server`, runs the no-inference conformance check from the version-matched kit with a fixed fake key and the refusing network observer, and never sends `turn/start`. When `backend = "antigravity"`, `prepare check` verifies the `agy` executable and SHA-256 digest (pinned to `agy 1.4.0`, `1.4.3`, `1.4.4`), validates isolated `settings.json` unified permission rules and `hooks.json` configuration, runs zero-inference `/config`, `/hooks`, `/permissions`, `/skills`, `/agents` slash-command read-backs against a refusing loopback proxy, executes synthetic `PreToolUse` hook checks, and then runs the [agy probes](preparation.md#antigravity-probes) through agy itself (hook invocation and deny, hook failure modes, stream tool-event shape, proxy egress, project configuration above the workspace), failing the receipt unless each passes. Both backends save the private receipt that ordinary dispatch requires ([preparation](preparation.md)). Its pass is initialization evidence for that candidate, pin, runtime and policy, not hosted acceptance.

## Antigravity trust assumptions

The app-server backend's guarantees come from the protocol: Vibe asks the supervisor before every profile tool call, the supervisor reads the effective configuration back, and every effect arrives with its approval metadata. `agy` offers none of that. Its gate is a `PreToolUse` command hook plus `settings.json`, both written by the supervisor into a private `HOME`, and every guarantee rests on agy behaviour that has not been observed:

- agy loads the supervisor's settings and hook and no project configuration above the workspace;
- agy runs the hook before every tool call, honours a deny, and treats a hook that times out, exits non-zero or prints unparseable output as a deny;
- agy's stream-json names each executed and denied call in the shape the audit parser reads, so the post-run match against the hook ledger is meaningful;
- agy sends its inference traffic through `HTTPS_PROXY`, so the no-inference preparation can observe it.

The probes in `prepare check` ([preparation](preparation.md)) test these assumptions through agy with a fixed fake key and a scripted loopback model. Until they pass on the candidate, the backend is experimental, off unless `experimental.antigravity = true`, and not for production. Running agy headless under a consumer Google sign-in may be outside Antigravity's consumer terms; prefer an API key or enterprise authentication. The [security model](security.md#antigravity-backend-experimental) has the rest.

## Target conformance corrections

`config/read.harnessSelectionSource` is nullable on the unified implementation. Null is accepted as diagnostic provenance, while the actual session and runtime unified-harness checks and the hooks and skills checks remain mandatory. See [ADR 0005](adr/0005-target-conformance-repairs.md) for the owned loopback managed-config service, which must be read back exactly; its lifecycle is covered by fake-worker tests, and the workflow candidate's no-inference check read its URL back on the installed Vibe.

The no-inference observer records CONNECT authorities, not encrypted paths. Its control enables both telemetry and experiments, but host equality cannot attribute requests to experiments. Every observed subject request fails the no-request check even without a matching control host. An otherwise passing subject and control matrix validates only the absence of proxy-observed requests; the experiments-specific gate stays `unverified-host-only-observation` until separate attributable evidence exists. No network gate is promoted merely because configuration read-back passes.

## Bundled Vibe skills

Pinned Vibe 2.26.1 bundled plugin skills are permitted by owner decision ([ADR 0006](adr/0006-bundled-vibe-skills.md)): `vibe:create-plugin`, `vibe:skill-creator`, `vibe:vibe`, `vibe:worktree`. Read-back requires plugin source, builtin scope and no registry reference, and rejects unknown or duplicate names. User, project and registry skills remain disabled. Skills are guidance; their instructions do not authorize tools, paths, shell or network access. The exact review and edit file-tool profiles and the approval handler remain unchanged.
