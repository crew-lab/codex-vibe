# Vibe 2.25.8 silent stall: static analysis, 2026-10-08

This note looks for a cause of the unexplained silent stall seen in the rc.8 hosted soak by reading the pinned Vibe source. No cause is identified. It narrows the field, rules several paths out, ranks the remaining candidates and says what evidence on the target machine would tell them apart. It changes no code and proposes no limit increase or automatic retry.

## Method

Static reading only. The macOS arm64 wheel of mistral-vibe 2.25.8 (sha256 `9b2a3f9c1078e8cf2bd0a2cd860336b3ad8039894ecf423994588be4545d73ea`) was unpacked and hash-checked before this work; nothing was installed, imported or executed, and nothing touched the network, the Keychain or any real data directory. Citations are `path:line` inside the wheel. Three limits apply.

- The `mistralai` SDK (pinned by the wheel at 2.6.0), `httpx` 0.28.1 and `httpcore` 1.0.9 are not in the wheel. What they do with the timeout and retry settings Vibe passes them (when the retry budget is checked, whether `Retry-After` is honoured) is taken from general knowledge and is marked unverified below.
- The Rust harness (`mistralai_vibe_local_harness/_native.abi3.so`) is the Unified Harness. The supervisor forces `--legacy-harness`, so only the Python legacy path was read.
- The wheel cannot say what the provider did. Every candidate below that involves the network is a statement about what Vibe would do, not about what happened.

## Evidence summary

The stall is run `600ab9fd-9b2b-43fa-8c19-14768567cc14` of the rc.8 hosted soak: programmatic backend, edit mode, task `edit-add-file`, run 20 of 100 (`docs/history/reviews/rc8-continuation-followup-2026-10-08/hosted-soak-100/runs.ndjson`, `soak-stall-observation.json`, `Read.md` in the same folder).

- Started 09:41:45 UTC, right after 19 runs of about 13 seconds each that all passed (the soak began at 09:37:30). The driver closed the run at 900.375 s with `driver:run_timeout`.
- Zero public events, no `transcript.md`, no `events.ndjson` content, no stderr diagnostic, no native session metadata and a zero-byte Vibe log when inspected after more than 3 minutes.
- The worker process was alive with an established HTTPS connection. The follow-up report says it remained alive "before closure"; whether it was still alive at the full 900 s is not separately recorded.
- No credit, authentication or rate-limit error was observed. The later targeted edits (23.2 s and 10.8 s) and the later rc.8 diagnostic pass did not reproduce it.
- That build had no progress watchdog. The activity rules that exist now (`docs/functionality.md`, `src/core/run-manager.ts` `noteActivity`) count a complete programmatic stdout line, any stderr output and, for ACP, every `session/update` or request. They were not in force for this run.

What the evidence does and does not show:

- "No public event" in rc.8 means no assistant text line. A programmatic stdout line for the user message, or for a completed tool entry, would not have been recorded as an event (`src/backends/programmatic.ts` `extractAssistantText` keeps only assistant text). So the stall may have started after the user-message line, and may even have been inside the first tool call.
- "No native session metadata" fits any stall before the first model step completes. The first save is after the first full step, including its tool calls (`vibe/core/agent_loop/_loop.py:2105`), with a final save in the `finally` block (`_loop.py:2137`).
- No shim line on stderr means the Keychain step ended normally. The shim writes `vibe-supervisor: no Keychain credential resolved (...)` to stderr for any outcome other than environment, Keychain or non-macOS (`src/backends/runtime/vibe_supervisor_launcher.py`, end of `main`), and that would have become an event. So the credential was in the environment when Vibe started.
- A zero-byte log proves little: the profile and the shim force `LOG_LEVEL=ERROR`, and Vibe's retry and model-failure notices are warnings (`vibe/core/llm/backend/mistral.py:382`, `_loop.py:436-454`), so they are never written.

## How the supervisor launches the worker

Programmatic: `src/backends/programmatic.ts` runs the shim (`src/backends/runtime/vibe_supervisor_launcher.py`) with the Vibe interpreter. The shim reads the prompt from a private file, patches the session logger, resolves the credential, forces `LOG_LEVEL=ERROR` and `--legacy-harness`, then calls `vibe.cli.entrypoint.main`. Arguments are `--agent`, `--max-turns`, `--output streaming`, `--enabled-tools`. stdio is `['ignore','pipe','pipe']` (`src/process/managed.ts:60`), so stdin is `/dev/null`. The child environment keeps only HOME (private), PATH, LANG, TMPDIR, `MISTRAL_API_KEY` and `LC_*`, plus the profile values in `src/backends/profile.ts`: private `VIBE_HOME`, `VIBE_ENABLE_TELEMETRY=false`, `VIBE_ENABLE_CONNECTORS=false`, `VIBE_MCP_SERVERS=[]`, `VIBE_ACP_LOGGING_ENABLED=0`, read/search or edit tools only. ACP uses the same shim with stdin and stdout as the JSON-RPC pipe.

The shim has its own parent-pid and deadline watchdog (`WorkerWatchdog`, default 2400 s, hard cap 48 h) and an opt-in diagnostics thread (programmatic only) that writes stage timings and, at 60, 180 and 600 s, a bounded list of Python frames per thread. The supervisor-side watchdog fails the run after `limits.worker_progress_timeout_seconds` (default 600) without activity.

## Code paths that can be silent

Programmatic mode is much quieter than the traffic it hides. `ProgrammaticOutput` prints a streaming entry only when its generation status is `COMPLETED` (`vibe/cli/programmatic.py:117-127`). By static reading:

- The user message entry is completed on creation (`vibe/app_server/_projector.py` `_project_user_message`), so the first stdout line should appear almost immediately. This is inferred, not observed.
- Streamed assistant and reasoning text are `IN_PROGRESS` (`_projector.py:574-612`) and complete only when the next tool call starts (`_projector.py:311`) or the turn finishes (`_projector.py:412`). A model response that thinks or generates for minutes before its first tool call prints nothing.
- Tool entries print when their result arrives.
- Retry notices are `turn/retrying` session state (`vibe/app_server/_turns.py:1024-1042`), never history entries, so retries are invisible on stdout, and stderr gets nothing at `LOG_LEVEL=ERROR`.

ACP mode is louder. Message and thought chunks arrive as `session/update` per delta and each one is counted as activity (`src/backends/acp.ts:286-289`). Retries produce an extension notification `_session/retrying` (`vibe/acp/agent.py:396,735-742`), but `src/backends/acp.ts` registers only `session/update`, permission and elicitation handlers (lines 285-312), so that notification is neither counted nor recorded.

## Candidate table

Defaults come from `vibe/core/config/_defaults.py:16-21` and `vibe/core/config/vibe_schema.py:605-613`. Every `VibeConfigSchema` field can be set as `VIBE_<FIELD>` through `EnvironmentLayer` (`vibe/core/config/layers/environment.py:15-17`, layered after default and user config in `vibe/core/config/default_orchestrator.py:68-75`), so the pinned Vibe honours these without a config file.

| # | Path | Where | Default bounds | Logged or visible? | Programmatic vs ACP |
|---|------|-------|----------------|--------------------|---------------------|
| 1 | Model request, headers phase | `vibe/core/llm/backend/mistral.py:315-343,417-436,527-580` | connect 10 s, write 30 s, pool 10 s, read 720 s (`api_timeout`); retry budget 300 s, backoff 0.5 s growing by 1.5x to 30 s, retry on 429, 500, 502, 503, 504, network and timeout errors | retry notices are warnings, suppressed at ERROR; `Model call failed` also a warning | programmatic fully silent; ACP emits `_session/retrying`, unused by the supervisor |
| 2 | Model response stream, bytes arriving | same, `async with stream` at line 577 | httpx read timeout is per read, so any trickle (including reasoning deltas) resets it; no overall cap; `max_tokens` unset; default model `thinking="high"` (`vibe_schema.py:137`) | nothing | programmatic silent until an entry completes; ACP shows every chunk |
| 3 | Model response stream, bytes stopped | same | one read timeout of 720 s, then `httpx` error, `RuntimeError`, turn fails, exit 1 with stderr text. Mid-stream hangs are not retried by Vibe (unverified for the SDK's stream wrapper). No TCP keepalive is configured (`vibe/utils/http.py:79-109`) | failure warning only; stderr `Error:` line | same exit in both; ACP reports a failed turn |
| 4 | Retry chain ending in a hung attempt | SDK `RetryConfig` built at `mistral.py:315-326` | the elapsed budget is checked between attempts (unverified), so the last attempt can start near 300 s plus a 30 s sleep and then run to 720 s: roughly 1050 s worst case | none at ERROR | programmatic silent; ACP `_session/retrying` |
| 5 | Startup network: experiments, identity, whoami, Sentry, telemetry | `vibe/core/experiments/session.py:113`, `vibe/observability/sentry.py:184`, `vibe/core/telemetry/send.py:199-210` | 5 to 10 s timeouts | n/a | gated by `enable_telemetry`, off in the profile: not reachable |
| 6 | Update check | `vibe/cli/cli.py:445-451` | n/a | n/a | interactive mode only: not reachable |
| 7 | Connector and MCP discovery | `vibe/core/agent_loop/_loop.py:1356-1400`, `vibe/app_server/connector_catalog.py:329` | n/a | n/a | off in the profile: not reachable |
| 8 | Credential lookup | `vibe/utils/keyring.py:28-33,78-98` (`security` subprocess, no timeout); shim lookup bounded to 5 s per service | none in Vibe | stderr from the shim if the shim fails | reachable only if `MISTRAL_API_KEY` is unset; the absent shim line shows it was set. Vibe's own call would also use the private HOME |
| 9 | Stdin read at startup | `vibe/cli/cli.py:55-65,457` (reads stdin to EOF unless it is a TTY) | none | none | programmatic stdin is `/dev/null`: EOF at once. Not reachable |
| 10 | Output backpressure | `src/process/managed.ts:62-72` | n/a | n/a | streams are flowing, never paused: not reachable |
| 11 | Git and session metadata subprocesses | `vibe/core/system_prompt.py:100,58-80`, `vibe/core/session/session_logger.py:144-155` | 10 s and 5 s | none | bounded; only a stuck uninterruptible subprocess could exceed it |
| 12 | Tool execution | `vibe/core/tools/builtins/grep.py:56-58,316-330` (60 s `wait_for`); read_file, write_file, edit have no waits | 60 s for search | tool entry | bounded; no shell or web tools enabled |
| 13 | Approval wait | `vibe/core/agent_loop/_request_broker.py:65,84` (futures with no timeout) | none | permission request | programmatic denies at once (`vibe/cli/programmatic.py:160-162`); ACP waits for the supervisor, which already surfaces `waiting_permission` |
| 14 | Compaction | `vibe/core/middleware.py:100-108`, `_loop.py:1885`, non-streaming call | triggers at 200,000 context tokens; same 720 s read timeout | start and end events | unreachable on the small soak fixture. 2.26.0 compacts at 80 percent of the context window |
| 15 | Title generation | `vibe/core/config/models.py:79`, `_loop.py:2212` | off by default in 2.25.8 | n/a | not reachable; 2.26.0 turns it on for cli and desktop only |
| 16 | Session lease and VIBE_HOME locks | `vibe/core/session/session_lease.py:48-130` | blocking directory lock | none | the home is private per run, so no peer can hold it |
| 17 | Private log | `vibe/cli/entrypoint.py:421`, `vibe/core/paths/_vibe_home.py:17` | rotating, 10 MB | vibe.log in the private VIBE_HOME at the forced level | same |

## Ranked conclusion

No cause is identified. The static reading cannot explain the observation with a purely local defect; every local path that could run for 15 minutes without output is either unreachable in the profile or bounded to seconds. What remains is a wait on the model request, which Vibe itself bounds only loosely.

1. Model request or stream stalled or slow-trickling (rows 1 to 4). This is the only family that fits an established HTTPS connection, an idle disk, no stderr and no reproduction. Three variants cannot be told apart from the recorded evidence:
   - 3, a half-open or hung connection: the 720 s read timeout should end it near 12 minutes with an `Error:` line and exit 1, which the supervisor would have classified. That fits only if the worker was already gone or had been given a fresh attempt, so the "alive at 900 s" point matters.
   - 2, a long thinking or generation phase with bytes still flowing (thinking is `high`, `max_tokens` unset): nothing reaches stdout until an entry completes, and no read timeout fires. The first fast response from the same model on later runs makes a 15-minute generation unusual, but a degenerate reasoning loop is possible.
   - 4, quick failures and backoff followed by one hung attempt: up to about 1050 s with no output, and it survives the 900 s deadline. This is the best fit for "alive at 900 s", but depends on the unverified SDK budget check.
   The burst of 19 hosted runs in four minutes just before the stall makes provider-side queueing or throttling plausible; it is a guess, not evidence.
2. A tool or filesystem wait inside the first step (rows 11, 12). It is not excluded by the evidence, because tool lines were never recorded as events and the first save follows the whole step. It is unlikely: the longest bound is 60 s, and the same task completed in 10.8 s later.
3. A host or network event (sleep, wake, VPN or Wi-Fi change) leaving a half-open connection. The driver recorded 900,375 ms for a 900 s deadline; if that duration is wall clock, a long sleep would show as excess, so sleep is unlikely, but a network change would not.
4. A blocked event loop from a synchronous call (row 8, row 11). Low, for the reasons in the table.

Ruled out by reading (for this profile): startup network (telemetry, experiments, identity, update check, connectors, MCP), the stdin read, output backpressure, title generation, compaction on a small fixture, session lock contention, supervisor credential fall-through, approvals in programmatic mode.

What would distinguish the candidates, if it happens again and the worker is left alive until captured:

- Bytes in and out on the worker's connection over 30 to 60 seconds (`nettop -p <pid>` or two `lsof -nP -a -p <pid> -i` samples): rising inbound bytes mean a trickle (variant 2); flat bytes mean a hung peer (variants 3 and 4).
- CPU time delta from `ps -o time,state -p <pid>` and whether the worker has children (`pgrep -P`, `ps -g`): a child `security`, `git` or `rg` points at rows 8, 11, 12.
- The worker's own exit time, exit code and stderr tail if it ends before the deadline: an `Error:` line with a timeout name confirms variant 3.
- The 60, 180 and 600 s frame snapshots from `worker-diagnostics.json` (opt-in `VIBE_SUPERVISOR_DIAGNOSTICS=1`): a thread inside `subprocess` frames means a local wait. A main thread idle in `selectors` only says "waiting on I/O" and does not name the coroutine, so it supports but does not prove a network wait.
- `pmset -g log` entries for sleep and wake and recent network-change events around the start time.
- Provider status and request logs for the same minute, which only the account owner can read.

## Recommended supervisor actions

None of these raises a limit or adds a retry.

1. Document it as a known limit, bounded by the watchdog. The programmatic backend cannot tell a long model response from a stall, because Vibe prints nothing until an entry completes; the default 600 s progress timeout is already below Vibe's own 720 s read timeout, so the watchdog, not Vibe, ends a fully silent worker and records `last_activity_kind`. `docs/functionality.md` already says the window must exceed the longest single response; add that the soak default fits a small fixture only.
2. Leave Vibe's own timeout and retry settings alone. They are honoured as `VIBE_API_TIMEOUT`, `VIBE_API_RETRY_MAX_ELAPSED_TIME`, `VIBE_API_CONNECT_TIMEOUT`, `VIBE_API_WRITE_TIMEOUT` and `VIBE_API_POOL_TIMEOUT`, but lowering the read timeout below the progress timeout would turn a diagnosable `VSUP_NO_PROGRESS` into an unclassified crash exit, and removing retries is a behaviour change the evidence does not justify.
3. Capture on the next occurrence, in this order, before cleanup: the run's `worker-diagnostics.json` and `no_progress` diagnostic event, the network-byte and CPU samples above, the worker's child processes, and the private `vibe-home/logs/vibe.log`. Keep the worker alive until sampled; this is a manual step on the target machine, not a code change.
4. Candidate follow-ups for a deliberate decision (not implemented):
   - Record a `_session/retrying` notification as a supervisor diagnostic event in the ACP backend without counting it as activity, so a failure can say "provider was retrying with HTTP 429" instead of silence.
   - Offer an opt-in diagnostic log level of WARNING in the private profile for programmatic runs, which would write retry notices and `Model call failed` lines (provider, status, duration, response excerpt; payload only as counts, `vibe/core/llm/exceptions.py:63-70,169-170`) to the private `vibe.log`. The shim and the profile both force ERROR today, so this needs a review of what other warnings can contain before enabling, and must stay off by default.
   - Include in the `no_progress` diagnostic whether the worker had child processes and its CPU time, which splits local waits from network waits at no inference cost.
5. Static follow-up that this note could not do: read `mistralai` 2.6.0 (`utils/retries.py`, `basesdk.py`) and `httpx` 0.28.1 to confirm when the retry budget is checked, whether `Retry-After` is honoured and how the stream wrapper treats a mid-stream timeout. That would settle whether row 4's 1050 s bound and row 3's exit are real.
6. When the pin moves to 2.26.0, re-read the stall-relevant paths: title generation default, 80 percent compaction and the `vibe/app_server/` refactor changed there (`docs/history/reviews/vibe-2.26.0-source-diff-2026-10-08.md`).
