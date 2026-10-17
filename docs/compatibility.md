# Compatibility

vibe-supervisor 2.0 supports exactly **Mistral Vibe 2.26.1** as a client of its `vibe-app-server` (newline-delimited JSON-RPC 2.0 over stdio, one process per run). It is the only engine: there is no ACP adapter, backend selector, `backend` configuration key or fallback to another entry point.

The protocol carries no version field, so the pin is the compatibility check: the server must report exactly `serverInfo.version` 2.26.1, and the installed package files must match a manifest generated for that candidate. Any other Vibe version fails closed, and each new Vibe release needs its own candidate, manifest and conformance check. These findings come from Vibe's tagged source (`v2.26.1`) read without running it, supplemented by one no-inference observation of the installed Vibe 2.26.1 with an earlier build of this workflow ([candidate acceptance](#candidate-acceptance)). They do not certify other builds or operating systems, and every other Vibe version is rejected. The supported platform is macOS Apple silicon.

## The pin and its manifest

`src/backends/app-server/supported-vibe.ts` holds the version. The manifest is a JSON file written by `vibe-supervisor pin-manifest` on the machine that runs Vibe, once per candidate, and named by `paths.vibe_pin_manifest`, which is required. It records the manifest format, the Vibe version, the SHA-256 of the installed `mistral_vibe` distribution's `RECORD` file, and the SHA-256 of every file `RECORD` lists. Review it before relying on it: it records what is installed at that moment.

Before each spawn the supervisor locates the Python environment from the `vibe-app-server` script's interpreter line, requires a virtual environment, reads the package metadata version, and compares `RECORD`'s digest and every listed file's hash with the manifest. The script itself must be listed. Files in the covered directories that `RECORD` does not list fail the check; compiled `__pycache__` bytecode and `RECORD` itself are skipped. It is bounded in file count and bytes, and unsafe or non-regular files are refused. Failures carry a `details.reason`, for example `manifest-unreadable`, `manifest-version-mismatch`, `record-mismatch`, `file-mismatch`, `file-missing`, `file-extra`, `file-unsafe` or `version-mismatch`, under `VSUP_VIBE_VERSION_UNSUPPORTED` (or `VSUP_VIBE_NOT_FOUND` when the executable or interpreter is missing). The check returns the real path of the verified script, and the worker is spawned from exactly that path. The identity that passed (version, the SHA-256 of the manifest file as read and the SHA-256 of the installed `RECORD`: `vibe_version`, `manifest_sha256`, `record_sha256`) is saved in the run record as `pin` and appears in an export's `report.json`. The scope and limits of this check, including the known limitation of its reach, are in [security](security.md#process-configuration-and-persistence): it covers only the `mistral_vibe` `RECORD`, not dependencies, `.pth` files, the interpreter or `__pycache__`, and it runs before the process starts.

## Wire facts the client relies on

Read from the source at the Vibe tag, commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0`; the files and their hashes are in [Source basis](#source-basis). The no-inference checks of the workflow candidate and of the corrected 2.0.1 archive on a running server confirmed the handshake and configuration read-back subset below. One hosted review on the corrected archive then observed approved `read_file` calls through the handler, `runtime/updated` and `session/updated` as ignored notification methods, and no handoff or turn retry; it did not exercise a nested write, a denied write or an edit on main's evidence. The [unverified gates](#unverified-gates) say which parts the target must still confirm. A source-read fact is not an observed gate.

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

`vibe-supervisor doctor --config <path> --json` checks Node, Git, the `vibe-app-server` pin check against the configured manifest, selected config provenance and local storage prerequisites. Its JSON records the exact `application_entrypoint` and `runtime_module` that produced the report, and `provenance.backend` (`app-server`). Doctor hashes the installed files, launches nothing and makes no provider request. It cannot establish provider authentication or the identity of an already-open MCP connection. The actual connection must be checked separately for its server version and exact five-tool catalog. Authentication is observed during a real run.

Use `npm run verify:release` for local code and security verification and `npm run smoke:install` for the offline installed-package check. The smoke verifies the installed executable and exact MCP tool inventory; it does not run a Vibe task or prove hosted inference. The protocol tests run against a scripted fake `vibe-app-server`, written from the source audit; it shows the client handles what the source says, not that a real Vibe behaves that way.

The declared Node floor is 20.19.0. Release acceptance compares major, minor, and patch components; a passing run on another Node version does not establish that the minimum runtime itself was exercised. Verify the frozen package on Node 20.19.0 before making a stable compatibility claim.

`vibe-supervisor prepare check --kit <preparation-kit-VERSION> --config <path>` is the one local check that launches the installed `vibe-app-server`: it runs the no-inference conformance check from the version-matched kit with a fixed fake key and the refusing network observer, never sends `turn/start`, and saves the private receipt that ordinary dispatch requires ([preparation](preparation.md)). Its pass is initialization evidence for that candidate, pin, runtime and policy, not hosted acceptance.

## Candidate acceptance

The 2.0.1 release integrates the one-version cleanup with the coordinator workflow and is published from the archive its target sitting ran on, the **corrected archive**: source `44dc6f815c1b80ac75c0ce2613373e38ed2421c8`, archive SHA-256 `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`, candidate identity `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`, packaged and installed on the target (macOS arm64, Node 20.19.0, npm 10.8.2, Vibe 2.26.1). The packet built before it, from `8b288b8`, was rejected at archive inspection because its kit named bytes that were not in the archive. The sanitized records are under `research/evidence/` (source only, never shipped); see [machine-readable gates](acceptance.json) and the [target acceptance procedure](target-acceptance.md). The source has since moved to 2.0.2, which changes the runtime in reporting only (execution outcome, start time and reasoning counts), so its archive is a new candidate and none of this evidence transfers to it; each 2.0.2 gate's `carry_over` in `acceptance.json` says whether a 2.0.1 result is a reasonable basis and what 2.0.2 still needs.

| Check on the corrected archive | Observed result and boundary |
|---|---|
| Package and kit identity | PASS: the archive, the kit's candidate and the installed package match, verified by `package:rc`'s offline lifecycle-disabled installation and by a separate one; delivery and kit checksums pass. |
| Release verification on Node 20.19.0 | PASS inside `package:rc`: 89 files, 1,296 tests, lint, strict types, build, acceptance, secret scan, SBOM and the offline installed-package smoke. |
| No-inference conformance | PASS once with the matched kit: 783-file pin reviewed, `doctor` passed, pin hashing 149 to 166 ms; zero read-back mismatches for both profiles, thinking off, the bundled skills with their provenance; no subject network request with a validated observer; clean shutdown. Two informational `runtime/updated` findings. |
| Installed and native readiness | PASS through the official SDK, then on 2026-10-16 on the native desktop connection after a reconnect: expected candidate, preparation passed, eligible, free slot, exactly five tools. |
| Hosted review | Completed `end_turn` with read-only integrity, two approved `read_file` calls, no unapproved effect and verified cleanup; **rejected** by the coordinator because the final answer reversed both negative-number cases. The nested-write probe was not exercised (the worker called a member that does not exist). The export showed execution `unknown`, the reporting defect since fixed in source. |
| Hosted edit | Reported only on an unmerged target branch, on source `2a49abd`: completed `end_turn` and **rejected** by its frozen acceptance contract (wrong `node:assert` import, no `node:test`). No evidence packet is on main. |
| Disconnect | Not run; the owner authorized the last hosted start for it on 2026-10-16. |

An earlier build of the same workflow, the **workflow candidate**, was observed on the target on 2026-10-15: source `91afad4a9b6c598d2486c5d22e902f32972e4cac`, frozen archive SHA-256 `d1fd22ec04e50048c052cdf013b4d235b525dffc2efb11596dd29f8253003f6a`, installed distribution identity `a3600f7632ea42a221d342734dd1b6cb17deaaf072211693a728e31c0437b053`. The sanitized records are the evidence packet at commit 2e920d3 (source only, never shipped), summarized in `acceptance.json` under `evidence_builds` and the `workflow-candidate-*` entries. That evidence belongs to that archive; the integrated build's bytes differ, so none of it closes a gate here. It does show what to expect when the same checks are rerun.

| Check on the workflow candidate | Observed result and boundary |
|---|---|
| Release verification | PASS: 1,260 tests across 87 files, lint, strict types, build, acceptance, secret scan and SBOM on Node 24.21.0. |
| Offline installed package | PASS: installed CLI, five-tool catalogue, isolated reconnect smoke; no hosted inference. |
| No-inference conformance | PASS once on the installed Vibe 2.26.1 with a fixed fake key and no `turn/start`: pin and tamper control, handshake, review and edit initialization, the full read-back before and after thinking (including the owned managed-config URL and the four bundled skills with source `plugin`, scope `builtin`), and cleanup with nothing left in `tmp` after stdin EOF. One unknown notification method, `runtime/updated`, was ignored as designed. |
| Network observation | `none-observed-control-validated`: no subject request and an observed control. Experiments-specific attribution stays `unverified-host-only-observation`; that gate is not promoted from a host name. |
| Installed readiness and drift | PASS through the official SDK over stdio: the matching candidate eligible with preparation passed, a deliberately wrong `expected_candidate` rejected. The intended desktop connection was not tested. |
| Validation helper | PASS for independent copies, source preservation, cleanup refusal after a change, and a real npm dependency-free offline fixture with lifecycle scripts off. Populated pnpm dependency graphs are not demonstrated. |

## Verified gates

Recorded in `acceptance.json` as the `v2.0.1-archive-*` entries for the corrected 2.0.1 archive (candidate `8b1b7dd556ea985e`) and for no other bytes, except the pnpm validation, which ran on the preparing machine and needs no archive. 2.0.2 has no verified target gate yet.

| Gate | Result |
|---|---|
| Package and kit identity | PASS 2026-10-15: archive, kit candidate, installed identity, version and conformance script match; delivery and kit checksums verify. |
| Target no-inference conformance check | PASS 2026-10-15, once, with the matched kit: reviewed 783-file pin and `doctor`, hashing cost recorded, zero read-back mismatches, no subject request with a validated observer, clean shutdown. |
| Native readiness | PASS 2026-10-16 on the native desktop connection with `expected_candidate`: preparation passed, eligible, free slot, no blockers, exactly five tools. |
| Exact Node 20.19.0 floor | PASS 2026-10-15 for the frozen source `44dc6f8` (89 files, 1,296 tests). Later source is not covered. |
| Populated pnpm validation | PASSED_LOCALLY 2026-10-15 on a public fixture with pnpm 9.15.4; no hosted run needed. |

## Reporting repair target: disconnect observation

On 2026-10-16, exact target source `2a49abd`, archive SHA-256 `133e77bdf20fc1cc839d3f0e5bfcdc644aa5ec09e4eb02558fb43cd1b8d191a8` and candidate `1c3c135862e2fe888428a2bf67fc6cd02fe9852259a494e7d624e2a3e96a45c0` passed the real hosted disconnect procedure under Node 20.19.0/Vibe 2.26.1 on macOS arm64. The official client closed while running; observer evidence shows released lock and worker groups after exit; reconnect read failed without replay; private directories were removed; the source stayed unchanged; native close removed the clean worktree after a separate live owner released its lock. Bound evidence is source-only: `research/evidence/disconnect-2a49abd-2026-10-16/REPORT.md`. This is a per-build verified entry in acceptance.json; the existing global packaging snapshot names different bytes and is not promoted by this evidence. Review/edit acceptance remains failed/unverified and no hosted allowance remains.

## Frozen 2.0.2 target preparation

Source 347bf79, archive SHA-256 `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09`, candidate `eaa40320873caf810900cf201862695a82e1dc499807bb81ca25235b955d12c1`: full packaging/Node floor (89 files/1,305 tests), mandatory and separate installed-archive identity verification, pin/doctor, one matched no-inference check and installed SDK readiness PASS on 2026-10-16. The native gate remains pending reconnect. No hosted start or automatic carry-over is claimed. The source-only record is `research/evidence/release-2.0.2-347bf79-2026-10-16/REPORT.md`; acceptance.json names the exact frozen archive.

## Unverified gates

These stay unverified until their evidence is recorded here and in `acceptance.json`. The first two rows are the 2.0.2 archive's own checks; the rest were observed, or left open, on the 2.0.1 archive, except the last four, which are the 2.1 source's hosted observations of what fixture tests already cover (they all ride one hosted review and one hosted edit on the 2.1 archive, with the owner's allowance).

| Gate | What it settles | Status |
|---|---|---|
| 2.0.2 package and kit identity, Node 20.19.0 floor, no-inference conformance, installed and native readiness | That the 2.0.2 archive is the bytes its kit names and starts, reads back and reports ready on the target. | PASS on frozen source `347bf79`: exact archive/kit identity, Node 20.19.0 packaging, matched no-inference preparation and installed SDK readiness. Native review and edit readiness PASS after restart on 2026-10-17 with exact candidate, matching preparation, eligible workspace, free slot, no blockers and five tools. See the [native addendum](../research/evidence/release-2.0.2-347bf79-2026-10-16/NATIVE-READINESS-AFTER-RESTART-2026-10-17.json) and machine-readable acceptance record. No hosted start. |
| Execution provenance on a hosted run | That a closed 2.0.2 run exports `execution.state` `completed`, its start time and the `reasoning_observation` counts. | Covered by tests; reported on an unmerged target branch for source `2a49abd`. Optional: one hosted review on the 2.0.2 archive, only with a new owner allowance. |
| One hosted review and one hosted edit | Each with a readiness receipt, the edit with an acceptance contract and verified independently in a disposable copy, both closed with verified cleanup and exported. Stop on first failure. | Rejected 2026-10-16: the review on answer quality (both negative cases reversed); the edit, reported only on an unmerged target branch, on its contract. Supervisor isolation, permissions, events and cleanup were observed working. A new attempt needs a new allowance. Owner decision 2026-10-16: accepted as a documented limitation of worker answer quality, not passed (see [security](security.md#what-is-not-isolated)); carried to 2.0.2 unchanged. |
| MCP client disconnect | One observed disconnect during a running hosted run: worker group gone, owner lock released, run failed and never replayed, private directories deleted, edit worktree kept until close. | Pending: the owner authorized the last hosted start for it on 2026-10-16, on the installed 2.0.1 archive. Proposed as the basis for 2.0.2 once passed, since the disconnect and recovery paths change only by recording the failed outcome. |
| `permission = "ask"` visible in effective configuration | That `config/effective/read` shows `tools.<name>.permission` and the denylist for each profile tool, and that an in-workspace `read_file` reaches the approval handler. | Both halves observed on the corrected candidate (its preparation check, then two approved reads in the hosted review); not moved until the coordinator reads the per-tool fields in the sanitized conformance report, which is not in the repository. |
| Thinking off | That turning thinking off stops the model from generating reasoning. The read-back confirms the setting, not the effect. | Unverified: the hosted review's word-count watcher cannot attribute anything to reasoning; the structured `reasoning_observation` counts are in source after the frozen archive. |
| Experiments fetch off | Attributable evidence that `experiments.enable = false` stops Vibe's experiments request. The proxy matrix alone cannot attribute a request to experiments. | Unverified: again no subject request on the corrected candidate; attribution still host-only. |
| Nested `run_typescript` shape and gating | That a `write_file` or `edit` called from inside `run_typescript` arrives as the same `file_system.*` effect and reaches deny. From Vibe's Rust tests and code reading only; the hosted-review probe in the [target acceptance procedure](target-acceptance.md) (step 6) must show a nested write refused. | NOT EXERCISED 2026-10-16: the worker called `writeFile`, which does not exist, and no denied nested write was recorded. The probe now names `write_file`. |
| Hosted usage recorded (`hosted-usage-recorded`) | That a hosted run's `meta.json` and `result.json` carry prompt and completion tokens, `model_calls` (or `null` when Vibe's statistics carry none), a cost estimate marked `authoritative: false`, and `tool_calls` counts equal to the run's `tool_call` and `tool_denied` events, with the ceilings in force in `limits`. | Covered by fixture tests; not observed on a real run. Vibe's real statistics fields and counts are what the fixture assumes from source. |
| Excluded-glob read-back and denial (`hosted-excluded-glob-readback-and-denial`) | That with one exclusion for a fixture file, the conformance check run with `--excluded-glob` shows `denylist_matches_expected` true for every profile tool, and a hosted review asked to read the excluded file records `tool_denied` (outcome `permission_denied_by_policy`, or reason `path_excluded`) and completes. This is the first observation of Vibe denying the merged exclusion entries, including that Vibe's denylist matcher agrees with the handler's for `*` within a segment, `**` across segments and the `<workspace>/**/<glob>` form, and that a bare directory glob denies the directory itself and not the files below it (write `dir/**` for contents). | Covered by fixture tests (merged denylist, read-back mismatch, handler and listing judgement, a scenario with an excluded read); The merged entries reuse the two forms of the fixed secret patterns, whose denylist was observed at read-back only; no real denied call has been observed for any denylist entry. |
| Run export on a hosted run (`hosted-run-exported`) | That a hosted edit exported with `runs export` has every artifact digest matching, an `approvals.json` whose records cover every `tool_call` and `tool_denied` entry id, a `pin` equal to the target's manifest identity, and no machine path left. | Covered by fixture tests (ledger and pin in the bundle, digest mismatch refused); not observed on a real run. |
| Hosted close with an assessment (`hosted-close-acceptance-recorded`) | That the 2.1 hosted edit, closed with an `assessment` bound to its patch and contract, is saved in `meta.json` and that `runs usefulness` prints its row with the run's usage. Reviews stay not assessable. | Covered by fixture tests; not observed on a real run. |

Also open: a clean macOS account installation of the frozen archive. macOS Apple silicon is the supported platform. Linux and Windows code paths may exist, but 2.0 makes no support claim for them, and Intel and other MCP clients have no acceptance. Codex plugin packaging is not offered.

## Target conformance corrections

`config/read.harnessSelectionSource` is nullable on the unified implementation. Null is accepted as diagnostic provenance, while the actual session and runtime unified-harness checks and the hooks and skills checks remain mandatory. See [ADR 0005](adr/0005-target-conformance-repairs.md) for the owned loopback managed-config service, which must be read back exactly; its lifecycle is covered by fake-worker tests, and the workflow candidate's no-inference check read its URL back on the installed Vibe.

The no-inference observer records CONNECT authorities, not encrypted paths. Its control enables both telemetry and experiments, but host equality cannot attribute requests to experiments. Every observed subject request fails the no-request check even without a matching control host. An otherwise passing subject and control matrix validates only the absence of proxy-observed requests; the experiments-specific gate stays `unverified-host-only-observation` until separate attributable evidence exists. No network gate is promoted merely because configuration read-back passes.

## Bundled Vibe skills

Pinned Vibe 2.26.1 bundled plugin skills are permitted by owner decision ([ADR 0006](adr/0006-bundled-vibe-skills.md)): `vibe:create-plugin`, `vibe:skill-creator`, `vibe:vibe`, `vibe:worktree`. Read-back requires plugin source, builtin scope and no registry reference, and rejects unknown or duplicate names. User, project and registry skills remain disabled. Skills are guidance; their instructions do not authorize tools, paths, shell or network access. The exact review and edit file-tool profiles and the approval handler remain unchanged.
