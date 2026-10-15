# Compatibility

The workflow candidate is `vibe-supervisor` **2.0.0-rc.5**, pinned to **Mistral Vibe 2.26.1** through `vibe-app-server` (newline-delimited JSON-RPC over stdio, one process per run). Main's source version 2.0.1, older releases, the selected installation and this candidate are distinct. The candidate is committed/pushed at `91afad4`; it is not published or integrated with main.

The protocol carries no version field. Pin and handshake checks require exactly Vibe 2.26.1 and the candidate's installed-file manifest. Another Vibe release needs its own audited wire facts and evidence. Source audit is supplemented by the actual rc.5 no-inference observations below. Observations on macOS Apple silicon / Node 24.21.0 do not verify another platform, fresh-account install, exact declared Node floor or hosted behavior.

## The pin and its manifest

`src/backends/app-server/supported-vibe.ts` holds the version. The manifest is a JSON file written by `vibe-supervisor pin-manifest` on the machine that runs Vibe, once per candidate, and named by `paths.vibe_pin_manifest`, which is required. It records the manifest format, the Vibe version, the SHA-256 of the installed `mistral_vibe` distribution's `RECORD` file, and the SHA-256 of every file `RECORD` lists. Review it before relying on it: it records what is installed at that moment.

Before each spawn the supervisor locates the Python environment from the `vibe-app-server` script's interpreter line, requires a virtual environment, reads the package metadata version, and compares `RECORD`'s digest and every listed file's hash with the manifest. The script itself must be listed. Files in the covered directories that `RECORD` does not list fail the check; compiled `__pycache__` bytecode and `RECORD` itself are skipped. It is bounded in file count and bytes, and unsafe or non-regular files are refused. Failures carry a `details.reason`, for example `manifest-unreadable`, `manifest-version-mismatch`, `record-mismatch`, `file-mismatch`, `file-missing`, `file-extra`, `file-unsafe` or `version-mismatch`, under `VSUP_VIBE_VERSION_UNSUPPORTED` (or `VSUP_VIBE_NOT_FOUND` when the executable or interpreter is missing). The check returns the real path of the verified script, and the worker is spawned from exactly that path. The scope and limits of this check, including the known 2.0.0 limitation of its reach, are in [security](security.md#process-configuration-and-persistence): it covers only the `mistral_vibe` `RECORD`, not dependencies, `.pth` files, the interpreter or `__pycache__`, and it runs before the process starts.

## Wire facts the client relies on

Read from the source at the Vibe tag, commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0` (the protocol audit, source answers and design note are kept in the source repository). The actual no-inference rc.5 check confirmed the handshake/configuration subset below. Hosted permission/event behavior remains in the [unverified gates](#unverified-gates); a source-read fact is not automatically an observed gate.

- **Framing and handshake.** One compact JSON object per line. `initialize` carries `clientInfo` with entrypoint `programmatic` and `capabilities.callbackKinds = ["approval"]`; without that declaration the server crashes on its first approval. The result's `serverInfo.version` is checked against the pin, then the client sends `initialized`. The server sends error codes as strings (`unauthorized`, `invalid_params`, `not_initialized`, and others); `unauthorized` maps to `VSUP_AUTH_REQUIRED`.
- **Strictness.** The server's models forbid unknown fields and require `params`, camelCase. The client sends exactly what it builds and tolerates unknown fields on read, but requires the fields it depends on.
- **Approvals.** The server sends the request `callback/call` and never times out a pending one. The client acknowledges it, then answers with a separate `callback/result` request (the name Vibe's code accepts; one ADR of Vibe's still says `callback/respond`). The answer is `{"type": "approval", "decision": {"type": "approve" | "deny"}, "feedback": null}`, never a session or permanent approval.
- **Tool names and inputs.** The wire names are `file_system.read_file`, `file_system.write_file` and `file_system.search_replace` (Vibe's `edit`); the model-visible names are the short ones. Effect kinds are `file_read`, `file_write` and `file_edit`, and each carries `filePath` as the model wrote it. An effect that does not project to its expected kind is generic and is denied.
- **Effect outcome metadata.** An approved, executed call carries decision `execute`, approval type `ask`, source `user`. A call denied by approval or by policy fails with code `tool_denied`. Metadata is null when a result never passed Vibe's gate; the client treats null as unapproved.
- **Configuration read-back.** `config/effective/read` returns the redacted effective configuration in snake_case, with per-tool `permission` and `denylist` under `tools.<name>` when a layer sets them, and the active model's `thinking`. `runtime/read` returns tool names only, plus skills, connectors, MCP, hooks, issues, bypass state, statistics and the model configuration.
- **History and events.** `session/history/list` pages 1 to 500 entries (default 200), items oldest first, cursors are entry ids; the client pages backward from the end. Notifications carry monotonic event ids; the snapshot's id is the watermark. `session/compacted` and `session/contextCleared` hand over to a new session id. Unknown notification methods are ignored; unknown history entry kinds are not.
- **Limits and usage.** `maxTurns` becomes Vibe's iteration limit. The server does not enforce price or token limits and writes no run export, so the supervisor enforces `limits.max_tokens` and `limits.max_cost_usd` from `session/statsUpdated` and `runtime/read`, and computes cost with Vibe's pricing formula (cached tokens clamped to prompt tokens).
- **Outcomes.** Turn status is `in_progress`, `completed`, `failed` or `interrupted`; stop reason is `limit` or `length` or null; error codes include `invalid_api_key`, `invalid_model`, `context_too_long`, `response_too_long`, `rate_limit`, `refusal`, `backend_error`, `internal_error`, `incomplete_stream` and `compaction_failed`.
- **Shutdown.** Closing standard input ends the message loop and runs Vibe's cleanup, including removing the throwaway session store. A termination signal skips that cleanup, and the exit behavior after `session/stop` is not established, so the supervisor does not use `session/stop`.

## Diagnostic reasons

Supervisor `diagnostic` events carry a `reason`, and some failures carry the same word in `details.reason`.

| Reason | Where | Meaning |
|---|---|---|
| `session_handoff` | event, warning | Vibe compacted or cleared the session and replaced its id; the supervisor followed the new one and added a result warning. |
| `turn_retrying` | event, warning | Vibe is retrying the turn after a transient error. Recorded only. |
| `ignored_notifications` | event, info | Counts of unknown notification methods (with `unknown_methods`), stale events and notifications for another session, ignored by design. |
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

## Candidate acceptance: 2.0.0-rc.5

Evidence belongs to source `91afad4a9b6c598d2486c5d22e902f32972e4cac`, frozen archive SHA-256 `d1fd22ec04e50048c052cdf013b4d235b525dffc2efb11596dd29f8253003f6a` and installed distribution identity `a3600f7632ea42a221d342734dd1b6cb17deaaf072211693a728e31c0437b053`. The [source-only evidence packet](https://github.com/crew-lab/codex-vibe/tree/codex/workflow-acceptance-reporting/docs/reviews/workflow-2026-10-15) and [machine-readable gates](acceptance.json) contain the observations. Updating this documentation does not replace the frozen archive or its original packaging report.

| Check | Observed result and boundary |
|---|---|
| Release verification | PASS: 1,260 tests across 87 files, lint, strict types, build, acceptance, secret scan and SBOM on Node 24.21.0. |
| Offline installed package | PASS: installed CLI, five-tool catalog, isolated/reconnect smoke; no hosted inference. |
| Actual no-inference conformance | VERIFIED once on installed Vibe 2.26.1 with a fixed fake key. Pin/handshake, review/edit initialization, full read-back and cleanup passed. No turn/start or real credentials. |
| Network observation | `none-observed-control-validated`: no subject attempts and an observed control. Experiments-specific attribution remains `unverified-host-only-observation`; do not promote that gate from a host name. |
| Installed readiness and drift | PASS through official SDK stdio; matching candidate eligible and an intentionally incorrect expected candidate rejected. Intended desktop/native connection not tested on rc.5. |
| Validation helper | PASS for independent copies, source preservation, modified-state cleanup refusal and real npm dependency-free offline fixture with lifecycle scripts disabled. Populated pnpm dependency graphs remain unverified. |

## Unverified gates

| Gate | Remaining observation |
|---|---|
| Exact Node 20.19.0 floor | Full verification of the selected candidate on exactly the declared minimum. Another source's floor test does not transfer. |
| Native desktop readiness | Intended connection reports the frozen candidate/distribution, preparation PASS, eligibility, no blockers and free slot. |
| Hosted fixture review/edit | Explicit bounded allowance, contracts/hashes and independent validation with standardized reports. No new hosted start ran in this session. |
| Hosted disconnect/soak | Observed owned-group termination, lock release, failed interruption without replay, private cleanup and retained uncertain worktree. |
| Permission handler | `ask` and denylist were read back; actual hosted in-workspace calls still need to demonstrate handler enforcement. |
| Thinking generation effect | Thinking-off setting was read back; absence of generated reasoning remains unverified. |
| Experiments-specific fetch | Attribute the request purpose/effect separately; the proxy matrix alone does not. |
| Nested tool gating | Hosted nested-write probe with deny/effect evidence under the existing bounded policy. |
| Clean-account installation | Frozen archive installation, registration, rollback and cleanup under a fresh standard account. |
| Other platforms/clients | Intel, Linux, Windows and additional MCP clients have no new acceptance here. Plugin declarations remain unverified scaffolds. |
| Integration with main | Reconcile current 2.0.1 source/guards/neutral scripts, review and freeze a new integrated candidate; do not carry rc.5 receipts implicitly. |

Earlier rc.2 Crew Bravo acceptance and historical release results remain attached to their own artifacts. No general reliability, platform or stable release claim follows from the current partial matrix.

## History: 1.0.x

Published 1.0.0 (legacy harness) was accepted against its own archive. The 1.0.1 candidates were never released; rc.1 evidence is the rc.1 hosted report, kept in the source repository. The runtime source of 1.0.0 is identical to 0.9.0-rc.28 (`bef09855cd8104b979b962462ae9d87062ed8a9d`), whose hosted gates were observed on the target machine on 2026-10-13 (archive SHA256 `9179a091830e548d9ebd3c13bd6f12997f22a86bda6964d827c23e1a55773bbf`) and apply to 1.0.0 by owner decision together with a short confirmation on the 1.0.0 archive. The evidence is in `docs/history/` in the source repository; see [machine-readable gates](acceptance.json).

| Gate (1.0.0) | Evidence |
|---|---|
| Native readiness | VERIFIED on the Codex desktop connection, rc.28, 2026-10-13. |
| Five hosted runs (review, edit, review and edit to the turn limit, review), each with a readiness receipt | VERIFIED, rc.28, 2026-10-13; the edit checked independently; no retries or repairs. |
| Provider authentication | VERIFIED through the hosted runs, rc.28, 2026-10-13. |
| Real active disconnect, official client | PASS 2026-10-13, run 56c3920b-6758-4751-8b57-f58b2803942e. The desktop variant (case 6) was inconclusive and is covered by the deterministic rehearsal. |
| 1.0.0 archive confirmation: readiness, one review, one edit with verified cleanup | PASS 2026-10-13, archive 4e91e90b…; review f8f9c56f…, edit 377bc531…; independent verification and safe close, dirty export retained. See dated release-evidence supplement. |

A separate real-project review ran safely but its answer was not accepted. Usage and cost were not reported (UNKNOWN). Completed execution and correct task output remain separate claims.

## Target conformance corrections (2.0.0-rc.1)

`config/read.harnessSelectionSource` is nullable on the unified implementation. Null is accepted as diagnostic provenance, while the actual session/runtime unified-harness checks and hooks/skills checks remain mandatory. See ADR 0005 for the owned loopback managed-config service, which must be read back exactly. Its lifecycle is covered by fake-worker tests; installed-Vibe evidence is pending.

The no-inference observer records CONNECT authorities, not encrypted paths. Its control enables both telemetry and experiments, but host equality cannot attribute requests to experiments. Every observed subject request fails the no-request check even without a matching control host. An otherwise passing subject/control matrix validates only absence of proxy-observed requests; the experiments-specific gate stays `unverified-host-only-observation` until separate attributable evidence exists. No network gate is promoted merely because configuration read-back passes.

## Bundled Vibe skills (2.0.0-rc.2, owner decision)

Pinned Vibe 2.26.1 bundled plugin skills are permitted: `vibe:create-plugin`, `vibe:skill-creator`, `vibe:vibe`, `vibe:worktree`. Read-back requires plugin source, builtin scope and no registry reference, and rejects unknown or duplicate names. User/project/registry skills remain disabled. Skills are guidance; their instructions do not authorize tools, paths, shell or network access. The exact review/edit file-tool profiles and approval handler remain unchanged. Earlier statements of an empty skill catalogue are superseded by ADR 0006.
