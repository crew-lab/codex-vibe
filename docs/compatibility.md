# Compatibility

Candidate 2.0.0 supports exactly **Mistral Vibe 2.26.1** as a client of its `vibe-app-server` (newline-delimited JSON-RPC 2.0 over stdio, one process per run). It is the only engine: the `vibe -p --legacy-harness` path, the Python launcher, the `backend` configuration key and the programmatic backend are removed, and there is no ACP adapter, backend selector or fallback to another entry point. Published 1.0.0 and the unreleased 1.0.1 candidates used the legacy harness. 1.0.1 was skipped by owner decision; 1.0.0 is the last 1.x release, with no maintenance line. Their evidence is history and does not transfer to 2.0.

The protocol carries no version field, so the pin is the compatibility check: the server must report exactly `serverInfo.version` 2.26.1, and the installed package files must match a manifest generated for that candidate. Any other Vibe version fails closed, and each new Vibe release needs its own candidate, manifest and conformance check. These findings come from Vibe's tagged source (`v2.26.1`) read without running it; they do not certify other builds or operating systems, and Vibe 2.25.8 and all other versions are rejected. The supported platform is macOS Apple silicon.

## The pin and its manifest

`src/backends/app-server/supported-vibe.ts` holds the version. The manifest is a JSON file written by `vibe-supervisor pin-manifest` on the machine that runs Vibe, once per candidate, and named by `paths.vibe_pin_manifest`, which is required. It records the manifest format, the Vibe version, the SHA-256 of the installed `mistral_vibe` distribution's `RECORD` file, and the SHA-256 of every file `RECORD` lists. Review it before relying on it: it records what is installed at that moment.

Before each spawn the supervisor locates the Python environment from the `vibe-app-server` script's interpreter line, requires a virtual environment, reads the package metadata version, and compares `RECORD`'s digest and every listed file's hash with the manifest. The script itself must be listed. Files in the covered directories that `RECORD` does not list fail the check; compiled `__pycache__` bytecode and `RECORD` itself are skipped. It is bounded in file count and bytes, and unsafe or non-regular files are refused. Failures carry a `details.reason`, for example `manifest-unreadable`, `manifest-version-mismatch`, `record-mismatch`, `file-mismatch`, `file-missing`, `file-extra`, `file-unsafe` or `version-mismatch`, under `VSUP_VIBE_VERSION_UNSUPPORTED` (or `VSUP_VIBE_NOT_FOUND` when the executable or interpreter is missing). The check returns the real path of the verified script, and the worker is spawned from exactly that path. The scope and limits of this check, including the known 2.0.0 limitation of its reach, are in [security](security.md#process-configuration-and-persistence): it covers only the `mistral_vibe` `RECORD`, not dependencies, `.pth` files, the interpreter or `__pycache__`, and it runs before the process starts.

## Wire facts the client relies on

Read from the source at the Vibe tag, commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0` (the protocol audit, source answers and design note are kept in the source repository). None of it was observed on a running server; the [unverified gates](#unverified-gates) say which parts the target must confirm.

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

## Candidate acceptance: 2.0.0

The 2.0 runtime is new, so **no earlier hosted or native evidence transfers**. The candidate is implemented and has only been exercised against the scripted fake server; every gate below needs the target machine and the owner's separate authorization, and all are open. See [machine-readable gates](acceptance.json).

## Unverified gates

All of these stay unverified until evidence is recorded here and in `acceptance.json`.

| Gate | What it settles |
|---|---|
| Target no-inference conformance check | With the installed Vibe 2.26.1 and no provider: the manifest generated and verified on the target (and the per-run hashing cost), `serverInfo.version`, the handshake, `session/start`, and the complete read-back, with no turn. |
| Native readiness | On the intended Codex desktop connection, native readiness on the frozen 2.0 archive: `server_version`, eligible, no blockers, free slot. |
| One hosted review and one hosted edit | Each with a readiness receipt, the edit verified independently in a disposable copy, both closed with verified cleanup. Needs a new owner allowance; stop on first failure. |
| MCP client disconnect | One observed disconnect during a running hosted run: worker group gone, owner lock released, run failed and never replayed, private directories deleted, edit worktree kept until close. |
| `permission = "ask"` visible in effective configuration | That `config/effective/read` shows `tools.<name>.permission` and the denylist for each profile tool, and that an in-workspace `read_file` reaches the approval handler. Read from source only. |
| Thinking off | That turning thinking off stops the model from generating reasoning. The read-back confirms the setting, not the effect. |
| Experiments fetch off | That `experiments.enable = false` stops Vibe's experiments request. The setting is read back; its effect is unknown. |
| Nested `run_typescript` shape and gating | That a `write_file` or `edit` called from inside `run_typescript` arrives as the same `file_system.*` effect and reaches deny. From Vibe's Rust tests and code reading only; the hosted-review probe in the target brief (step 6) must show a nested write refused. |

Also open for 2.0: a clean macOS account installation, and verification of the frozen package on exactly Node 20.19.0. macOS Apple silicon is the supported platform. Linux and Windows code paths may exist, but 2.0.0 makes no support claim for them. No Intel or plugin installation gates apply to the reduced surface. `.codex-plugin/plugin.json` remains an unverified source scaffold and is not part of the npm package; its declarations do not establish plugin installation or registration support.

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
