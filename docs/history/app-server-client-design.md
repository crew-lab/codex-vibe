# 2.0 app-server client: design note (2026-10-14)

Decided by the owner on 2026-10-14 and recorded in [ADR 0004](../adr/0004-app-server-client.md). Protocol facts come from the [protocol audit](app-server-protocol-audit-2026-10-14.md), cited as "audit section N"; Rust-side facts from the [Unified Harness audit](unified-harness-audit-2026-10-14.md). Nothing here was run. Vibe's ADR 0014 (backend contract compatibility; sha256 `84885b85a5e92f73aae55af7f8d3041436bb83ae2d7db0b93d2682d23c33f711` at the tag), which the audit had not read, was read for this note.

## 1. Context and comparison

Vibe 2.26.1 runs the Unified Harness by default; `--legacy-harness` is the only way to the path 1.0.x pins, and Mistral may remove it. Two ways forward existed.

| | App-server client (chosen) | In-process patching of the Unified Harness |
|---|---|---|
| Enforcement point | Wire and configuration: session config, read-back, approval answers, event audit | Python executors: `_execute`, `_gate_tool_call`, the process gate, the subagent controller, `_apply_model_input` |
| Pinning | Exact `serverInfo.version` plus installed-wheel file hashes | About ten function sources plus the `_native` binary; Rust semantics cannot be pinned by hashing Python |
| Stability of the surface | The boundary Vibe's own surfaces use (audit section 1); strict versioned-by-pin models | Private internals with no contract |
| Gaps | Model-visible catalogue cannot be narrowed; no `grep`; no run export; price and token budgets not enforced by the server (audit sections 4 and 8) | Could drop catalogue entries, but only by patching a function nobody promises to keep |
| Maintenance per Vibe release | Re-run the conformance check; update the fixture if a schema moved | Re-audit and re-hash every patch point, then re-test the patches |

The client was chosen because each of its gaps is something the supervisor can enforce or accept in the open (sections 4 and 5), while patching ties every release to private code and leaves the Rust core unpinned. The accepted losses are visible write tools and no search tool in reviews.

## 2. Architecture

A new `src/backends/app-server.ts` implements `SupervisorBackend` (`probe`, `start`, `cancel`, `close`, `terminateNow`, `runtimeCheck`) and `BackendCallbacks`/`BackendStartResult` unchanged. `BackendKind` gains `"app-server"`. Helpers live in `src/backends/app-server/`: JSON-RPC client, typed protocol subset, session configuration, read-back, approval handler, event validator, usage and outcome mapping, pin check, credential lookup.

**Launch.** Before spawning, the pin check runs (section 9). The process is `vibe-app-server` with no arguments: Unified is the default and the legacy flags stay unused (audit section 1). It starts through `spawnManaged` with stdin piped, a new process group, and `buildChildEnvironment`, so the existing allowlist applies. The run directory gains `child-home` (`HOME`), `vibe-home` (`VIBE_HOME`, empty) and `tmp` (`TMPDIR`). The credential reaches the child only as `MISTRAL_API_KEY`; the existing bounded Keychain lookup moves from the Python shim to Node. Process working directory is the run directory; the workspace is the session `cwd`.

The shim's parent-death and deadline watchdog has no Vibe equivalent. Stdin EOF ends the server (audit section 7) and covers a dead supervisor only while Vibe is responsive. A small Node reaper process in its own group replaces the watchdog: it kills the worker group when the supervisor's PID disappears or the recorded deadline passes.

**JSON-RPC client.** Newline-delimited, UTF-8, one compact object per line (audit section 1).
- Bounds: per-line cap, total inbound byte budget per run (the existing collector cap), pending-request and outbound-queue limits, per-request timeouts inside the run deadline. Overflow ends the run with `VSUP_OUTPUT_LIMIT`, a malformed line with `VSUP_BACKEND_ERROR`.
- Write strictness: params built from typed builders, `params` always present, camelCase, no unknown fields; the server models forbid extras (audit section 1).
- Read tolerance, per Vibe ADR 0014's directional rule: unknown fields are ignored at every depth; fields the client depends on are required. Unknown notification methods are ignored and counted (audit section 2). Unknown history entry kinds are different: section 4.
- Error codes are strings: `unauthorized` maps to `VSUP_AUTH_REQUIRED`; `invalid_params` and `not_initialized` map to `VSUP_BACKEND_ERROR` with the issues attached.
- Replies to `callback/call` echo the server's integer id.

**Sequence** (audit section 6, with the supervisor's additions):

| Step | Call |
|---|---|
| 1 | `initialize` with `clientInfo` and `capabilities.callbackKinds = ["approval"]`; the result's `serverInfo.version` must equal the pin; then notification `initialized` `{}` |
| 2 | `session/start` with the profile (section 4) |
| 3 | `runtime/read`, `session/ready/wait`, `runtime/read`, `config/effective/read`, `config/read` (harness selection); verify (section 4) |
| 4 | `config/model/write` to turn thinking off, before the first turn, then read back again |
| 5 | Baseline from `runtime/read` stats; `turn/start` with the task as one text block; record the turn id |
| 6 | Consume notifications and `callback/call` until `turn/completed` |
| 7 | `session/history/list` for the final assistant message and the history audit; `runtime/read` for final stats |
| 8 | Close stdin; wait; process-group kill if needed; delete the private directories |

The watermark rule (audit section 2) applies: ignore ids at or below the snapshot's, accept the next, treat a larger one as a gap. A gap fails closed: the client sends `turn/interrupt`, then replaces state from `session/read` as the audit prescribes and runs the history audit on it before deciding the outcome. A hidden entry is therefore found while the turn is stopped, not after it has run on. The end-of-turn history audit (step 7) stays as a second check and pages `session/history/list` to the end. `session/compacted` and `session/contextCleared` carry a new session id; the client adopts it and records a warning.

## 3. Run lifecycle mapping

| Operation | Protocol calls | Supervisor action |
|---|---|---|
| `vibe_review_start`, `vibe_edit_start` | Steps 1 to 5 | RunManager admission, slot, snapshot or worktree are unchanged and run first. `start()` resolves once `turn/start` is accepted and reports `running`; failure before that rejects `start()` and the run settles failed with a classified code. `onSpawn` fires right after spawn so a cancel during the handshake reaches the process. |
| `vibe_status` | None | RunManager state. The backend calls `onActivity` for every inbound frame, `onEvent` for tool calls and denials, and `onState("running", {usage})` for each stats update (same-state transitions are legal), throttled. |
| `vibe_result` | Step 7 | Last completed assistant message of the turn, redacted and bounded, emitted as one `message` event; outcome by section 5. Reasoning entries are dropped. |
| Deadline, no-progress | `turn/interrupt` with `expectedTurnId`, wait for `turn/completed(interrupted)` within a grace period | RunManager settles `VSUP_TIMEOUT` or `VSUP_NO_PROGRESS`; then step 8. |
| `vibe_close`, cancel | Same as above; `stale_turn` or `conflict` means the turn already ended | Close stdin, wait, group kill, verify termination, delete private directories. Slot and handle are released only after termination is verified, as today. |
| MCP client disconnect, shutdown | Same; `terminateNow` skips the grace period | Close stdin and kill the group at once; the run directory's private subdirectories are deleted after verification. |
| Supervisor restart | None | Interrupted run marked failed. No process is launched, no session resumed, no task replayed, no grant restored, no PID signalled from saved data. Leftover private subdirectories of marked runs, including Vibe's throwaway store, are deleted during restart recovery before the server accepts work, not left to the retention sweep. |

`session/stop` is not required: closing stdin is the documented clean path, while exit behaviour after `session/stop` is UNKNOWN (audit section 7).

## 4. Enforcement layers

Two kinds of control exist. Preventive: Vibe's own configuration and the approval answer. Detective: the audit of effect entries, which can only interrupt after the fact (audit section 3). The design makes every disclosure path preventive and uses detection to catch drift.

| Layer | What it does | What it protects | How it is tested |
|---|---|---|---|
| Session configuration | Wire `agentConfig`: `cwd`, `agent` (a supervisor-written profile), `enabledTools`, `disabledTools`, `maxTurns`, `headless`; `autoApprove` false, `trustWorkspace` false, `workspaceRoots` empty, `mcpServers` empty. Process env: subagents, background processes, managed shell, connectors off; skills `["*"]` disabled; MCP `[]`; telemetry, update checks, model catalogue off; session logging off. Thinking off through `config/model/write`. The per-tool path policy of 1.0 (permission, workspace allowlist, reserved and sensitive-file denylist) carries over for the tools in the profile. Disabled like the reference client: `ask_user_question`, `exit_plan_mode`, `cron`. | No shell, network, subagents, plugins' tools, skills, hooks, MCP or connectors; reserved paths and secrets files; reasoning off disk | Unit tests on the exact agentConfig and env; read-back tests |
| Startup read-back | After `session/start`: `runtime/read` tools equal the profile exactly, skills, MCP and connectors empty, `hooksCount` 0, `issues` empty, `bypassToolPermissions` false; `config/effective/read` shows each setting above; `PublicSession.harness` is `unified`. Any mismatch, or a missing expected field, fails the run before `turn/start` with `VSUP_BACKEND_ERROR` and the field list. Unknown extra fields are ignored. | A config that silently did not apply; a Vibe that reads settings differently | Fixture scenario per mismatch; target conformance check |
| Approval handler | Answers each `callback/call`. Review: approve `read_file` only. Edit: approve `read_file`, `write_file`, `edit`. In both, only for a path that resolves (realpath, no symlink escape) inside the worker workspace and outside `.git`, `.vibe`, `.agents`, `.vibeignore` and secret-file patterns. Everything else is `deny`. The reply is `ApprovalCallbackOutput`: `{"type": "approval", "decision": {"type": "approve" | "deny"}, "feedback": null}`; `path_scope` is never sent (`vibe/app_server/models.py`, `ApprovalDecision`, `ApprovalCallbackOutput`; `deny_callback` in `vibe/app_server/session.py`). The path is `effect.input.filePath` for all three tools: the effect inputs are the app-server's own `FileReadEffectInput`, `FileWriteEffectInput` and `FileEditEffectInput` (`vibe/app_server/_effect_models.py`), and app-server models serialize camelCase (`alias_generator=to_camel`, `serialize_by_alias=True` in `vibe/app_server/_model.py`). A missing or non-string `filePath`, an unknown `effect.kind`, or a generic effect detail for a profile tool is denied. A relative path resolves against the session `cwd` (the worker workspace), as Vibe does (`_make_absolute` in `vibe/core/tools/utils.py`), never the process cwd. A path that does not exist yet (a new file in an edit run) is judged by the realpath of its nearest existing ancestor plus the remaining components, which must contain no `..` and no symlink. Never `approve_for_session`, `approve_permanently` or `cancel_turn`. A 5-second decision deadline answers deny. The handler is the sole preventive control for any call the path policy escalates to it. | Out-of-workspace or secret-file reads and writes; off-profile tools | Fixture: allowed call, denied approval, stalled approval |
| Event validator | Every history entry is classified. Reasoning entries are dropped on receipt. An effect entry for a tool outside the profile that was denied is expected, because the write tools stay listed: it is recorded as `permission_denied_by_policy` and the run continues. Any effect entry that was allowed or executed without a matching approval the handler gave, for any tool including the profile's own, ends the run: `turn/interrupt`, cancel, failed `VSUP_BACKEND_ERROR` with the tool name. Vibe has allow paths that bypass the callback even for profile tools (scratchpad paths in `resolve_file_tool_permission`, a session grant store in `UnifiedPermissionResolver.resolve`, the BYPASS gate in `_rust_tool_modes`); the handler never grants for the session, so a legitimate allow always pairs with a handler approval. An unknown history entry kind ends the run the same way, because it could hide a call. An unknown notification method is ignored. | Drift where Vibe auto-allows a call the handler never saw | Fixture: off-profile call, unknown entry, unknown method |
| Post-run checks | Review: the existing launch and end snapshot comparison decides `integrity`, and `writeToolObserved` is set from tool-call events named `write_file` or `edit`. Edit: the existing export, secret refusal and verified cleanup. Plus the step 7 history audit. | A write that every earlier layer missed | Existing tests; fixture scenario with a write |

Note: `allow` modes and in-workdir tool rules skip the callback (audit section 3). Read at the tag (`resolve_file_tool_permission` in `vibe/core/tools/utils.py`): an in-workspace path that matches no allow/deny list and no sensitive pattern returns no context, so the tool's configured `permission` decides. `read_file` defaults to `always`, which would skip the handler. The supervisor's agent profile therefore sets `permission = "ask"` for every profile tool, so every call reaches the handler; the startup read-back checks it. This is the Python resolver; that the Unified effect executor reaches it is carried over from the Unified audit and confirmed by the target conformance check. `run_typescript` stays listed; its nested calls take the same gate and `fetch` is disabled in the isolate (Unified audit section 3; nested-call gating is carried over, not re-read). One no-inference target scenario must show a nested write reaching deny.

## 5. Budgets, usage and cost

- **Time:** RunManager's deadline and no-progress watchdog already call `cancel`; the backend also passes the remaining time to every request timeout.
- **Turns:** `maxTurns` goes in `agentConfig` (Rust `max_iterations`). As a backstop the client interrupts when `modelCalls` from stats exceeds the limit plus a small margin; how an iteration relates to a model call is UNKNOWN.
- **Tokens and price:** not enforced by the server (audit section 4). The client checks each `session/statsUpdated` against optional ceilings and interrupts. These need new optional `limits` keys in the configuration; names and defaults are an owner call.
- **Usage:** `UsageState.tokensUsed` from the stats snapshot, cost from Vibe's formula in `vibe/utils/pricing.py`: cached tokens clamped to prompt tokens, input and output prices per million from the snapshot. `authoritative: false` stays. `contextSize` is omitted unless the snapshot is found to carry it.

Outcome mapping uses `turn.status`, `stopReason` and `error.code` (audit section 6), with supervisor-detected limits taking precedence. Read at the tag (`PublicTurnStatus`, `PublicTurnStopReason` and `turn_stop` in `vibe/app_server/models.py`; `_turn_outcome` and `_turn_error_outcome` in `vibe/cli/programmatic.py`): status `in_progress`, `completed`, `failed`, `interrupted`; stop reason `limit` (iteration, token or price) or `length`, or null. An `interrupted` status wins over any reason. Mapping: null → `completed`; `limit` → `turn_limit`; `length` → `failed` (length); `interrupted` not requested by the supervisor → `failed`; error codes `invalid_api_key`/`invalid_model` → configuration failure, `context_too_long`/`response_too_long` → length, `rate_limit` → `VSUP_RATE_LIMITED`, `refusal` → `completed` with a refusal warning, anything else (`backend_error`, `internal_error`, `incomplete_stream`, `compaction_failed` and unknown codes) → `failed` (`TurnErrorCode` in `vibe/app_server/models.py`). `turn/retrying` is recorded as a warning only.

| Observed | Run state | Detail |
|---|---|---|
| Turn completed normally | `completed` | `stop_reason: end_turn`; warning if no final message |
| Turn limit, token or price ceiling | `completed` | `stop_reason` names the limit; the incomplete-result warning, as 1.0 does for turn limits |
| Deadline | `failed` | `VSUP_TIMEOUT` |
| Interrupted by cancel, close | `cancelled` | |
| `error.code` `invalid_api_key` or `invalid_model` | `failed` | `VSUP_AUTH_REQUIRED` or configuration error |
| `error.code` `rate_limit` | `failed` | `VSUP_RATE_LIMITED` |
| `error.code` `refusal` | `completed` | refusal warning |
| Watermark gap, unapproved allowed effect, unknown entry kind | `failed` | `VSUP_BACKEND_ERROR` |
| Any other `error.code`, crash | `failed` | `VSUP_BACKEND_ERROR` or `VSUP_BACKEND_CRASHED` |

## 6. Persistence and secrets

| Location | Content | Handling |
|---|---|---|
| `TMPDIR` store (throwaway directory, audit section 4) | Session checkpoint, journal and tool results, including reasoning and tool output | Never read by the supervisor; deleted with the private directories |
| `$VIBE_HOME/logs/vibe.log` | Server log at `LOG_LEVEL=ERROR` | Never read; deleted |
| `$VIBE_HOME` trust records, `.env` | Empty | The supervisor writes nothing there |
| Supervisor run directory | `meta.json`, events, transcript, artifacts | As today: bounded, private, atomically written |

Frames are parsed, reasoning entries dropped, then every string passes `redactSecrets` with the child's known secrets and `sanitizeForPersistence` before `onEvent`. Server stderr is captured bounded and redacted. The credential is in the child's environment only, as in 1.0 (the server must be able to use it); it is in no task, event or artifact. The store holds reasoning and unredacted tool output (Unified audit section 5), which is why it must never outlive the run: logging off puts it in a throwaway root, `TMPDIR` places that root in the supervisor's private area, deletion happens at close and by retention, and a stdin EOF lets the server remove its root itself. Whether `thinking = off` stops reasoning generation for the target model is UNKNOWN (audit section 8c) and is one target check.

## 7. What is removed and what stays

Removed at 2.0.0, in a final step after the new engine is green:
- the Python launcher, its tests and the `test:python` script; `programmatic.ts` and the legacy parts of `launcher.ts` and `profile.ts`; the legacy source-hash pins and the worker diagnostics file (tool names and outcomes are in the event log instead);
- the prompt-file handoff: the task now travels in `turn/start` over stdin, still absent from OS-visible arguments;
- the `grep` tool from both profiles; legacy sections of the security, functionality and compatibility documents; the profile-check and fake programmatic fixtures; ADR 0003 is marked superseded.

Stays unchanged: the five MCP tools and schemas, RunManager (slot, deadline, no-progress, settlement, retention), readiness receipts, owner lock, policy reread, snapshots, worktree creation, export and verified cleanup, redaction, `buildChildEnvironment`, `spawnManaged`, error codes (new details only), `--isolated` routing.

## 8. Test plan

A scripted fake `vibe-app-server` (`tests/fixtures/fake-vibe-app-server.mjs`, Node) speaks the audited subset from scenario files. It is written from the audit, independently of the client's types, so the two cross-check each other. It checks inbound params strictly, as the real server does.

| Scenario | Asserts |
|---|---|
| Allowed call | Approved `read_file` in workspace; run completes; usage rebuilt |
| Denied approval | Out-of-workspace and secret-file paths answered deny; model sees failure; run continues |
| Off-profile call, denied | Recorded as `permission_denied_by_policy`; run continues |
| Off-profile call, executed | Run ends failed; interrupt sent |
| Unknown notification, unknown entry kind | Ignored; fail closed respectively |
| Stalled approval | Server never times out; the handler's deadline answers deny |
| Missing `approval` callback kind | Fixture crashes as the real server does; the client always declares it |
| Crash, malformed line, oversized frame | `VSUP_BACKEND_CRASHED`, `VSUP_BACKEND_ERROR`, `VSUP_OUTPUT_LIMIT`; no leaked process |
| Stdin close | Fixture exits and removes its store; supervisor deletes the private directories |
| Wedged server | Group kill after grace; reaper kills it if the supervisor dies |
| Budget exceeded | Interrupt on stats; outcome mapping |
| Read-back mismatch, one case per field | Run fails before `turn/start` |
| Version or hash drift | Refused before spawn |
| Write in a review | Integrity `changed`, `writeToolObserved` true |
| Edit | Worktree export and cleanup through existing code |

Existing RunManager lifecycle tests also run against the new backend through the fixture. Target acceptance, each needing the owner's separate authorization: a no-inference conformance check (handshake, `session/start`, read-back, a nested-write denial if a fake provider can be configured, no turn); native readiness; one hosted review and one edit; one observed MCP-client disconnect.

## 9. Risks and open questions

| Item | Source | Handling |
|---|---|---|
| Catalogue cannot be narrowed; write tools visible | Audit 8b, Mistral question 1 | Accepted; refused at execution; documented plainly |
| Search absent; reviews depend on a prompt-supplied listing | Audit 8a | `git ls-files` of the allowed scope, bounded; a supervisor-run MCP grep is later, driven by the usefulness log |
| Design choices made in this note, not yet approved by the owner: a Node reaper process replacing the Python watchdog; the Keychain lookup moving to Node; installed-wheel verification against a per-candidate `RECORD` hash manifest | New | Proposed; the owner approves them with step 4 |
| Whether `config/effective/read` exposes per-tool `permission`, so the `ask` setting can be read back (`RuntimeSnapshot` carries only tool names) | Cold review | Step 1 reads `protocol.py`; if absent, the target conformance check observes a callback for an in-workspace read |
| Nested `run_typescript` effect shape; inbound frame cap; `session/history/list` page size | Cold review | Step 1 reads the source; the cap is set above the largest effect a bounded `read_file` can produce |
| `thinking=off` effect; crash residue | Audit 8c | Target check; directory deletion |
| Exit status after `session/stop`; SIGTERM path | Audit 9.1 | Stdin close is primary; fixture covers both |
| Nested `run_typescript` gating | Audit 9.2 | Target no-inference scenario |
| Built-in plugin skills or tools; `disabled_skills` reach | Audit 9.3 | Read-back lists skills; empty required |
| MCP stdio environment, `config/write` paths, `maxTokens`, `experiments.enable`, hosted behaviour | Audit 9.4 to 9.8 | Not used or not relied on; hosted behaviour is target acceptance only |
| Wheel hashing: how the supervisor finds the installed files, and who produces the expected manifest | New | The console script's shebang gives the interpreter and so the environment; `RECORD` is read, every listed file is hashed and compared with a manifest shipped per candidate, produced on the target by the owner. Per-run hashing cost is measured at the target check. |
| New config surface (`vibe-app-server` path, budget ceilings) | New | Derive the executable from `paths.vibe`'s directory with an optional override; owner decides key names |
| `clientInfo.entrypoint` accepted values | Audit 4; read at the tag | Closed: `AgentEntrypoint` is `cli`, `acp`, `desktop`, `programmatic` or `unknown` (`vibe/utils/__init__.py`; `ClientInfo` in `vibe/app_server/_connection_protocol.py`, sha256 `8372b35a…`). Auto titles run only for `cli` and `desktop` (`_auto_titles_enabled`, `vibe/app_server/_runtime.py`, sha256 `0c766f4a…`). The client sends `programmatic` |
| A Python `grep` tool exists at the tag (`vibe/core/tools/builtins/grep.py`) | Read at the tag | It is the builtin the legacy `ToolManager` discovers, which 1.0's review profile uses. The Unified audit found no `grep` in the Rust-built catalogue. Whether `enabledTools` naming `grep` exposes it on the Unified backend is one target conformance check; the design does not rely on it |
| `callback/result` is the stable name (ADR 0009 says `callback/respond`) | Audit 2, question 6 | Use `callback/result`; a drift fails the conformance check |

What would change the decision: Mistral removing or breaking `vibe-app-server` stdio, or changing it so that execution gating can no longer be made preventive; a read-back that cannot confirm the effective profile; a Vibe release cadence that makes a candidate per release unaffordable. Answers from Mistral to audit questions 1, 3, 4 and 5 (catalogue narrowing, search, omitting reasoning, honouring budgets) would remove work, not change the design.

## 10. Work breakdown

Prerequisite: 1.0.1 is tagged and `release/1.0` exists. The branch starts from main. Steps 1 to 4 run in parallel; each owner touches only the listed files and keeps others' changes.

| Step | Owner files | Needs |
|---|---|---|
| 1. Fixture | `tests/fixtures/fake-vibe-app-server.mjs`, scenario files, using the stop reasons and approval envelope in sections 4 and 5 | the audit |
| 2. JSON-RPC and protocol | `src/backends/app-server/jsonrpc.ts`, `protocol.ts`, unit tests | the audit |
| 3. Profile and configuration | `src/backends/app-server/session-config.ts`, `readback.ts`, rewrite of `src/backends/profile.ts`, tests | the audit |
| 4. Pin and credentials | `src/backends/app-server/pin.ts`, `credentials.ts`, `src/backends/pinned.ts`, `src/process/reaper.ts`, tests | the audit |
| 5. Policy and events | `approvals.ts`, `events.ts`, `usage.ts`, `outcome.ts`, tests | steps 2, 3 |
| 6. Backend | `src/backends/app-server.ts`, integration tests against the fixture | steps 1 to 5 |
| 7. Wiring | `src/contracts.ts`, `src/core/run-manager.ts` (backend loading, event types), `src/config/`, `src/diagnostics/doctor.ts`, CLI | step 6 |
| 8. Documentation | `docs/reference.md`, `security.md`, `functionality.md`, `compatibility.md`, `errors.md` via `npm run docs:errors`, `acceptance.json`, `AGENTS.md`, `Handoff.md`, ADR 0003 status | step 7 |
| 9. Legacy removal | everything listed in section 7, `package.json` scripts, `scripts/`, packaging | steps 7, 8 |
| 10. Target kit | brief and runbook under `docs/history/` | step 9 |

Each step ends with lint, typecheck, build and its tests; step 9 ends with `verify:release`. Step 10 follows the existing rule: nothing is installed or run on the preparing machine.
