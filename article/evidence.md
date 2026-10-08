# Claims and the evidence behind them

The article claims only what this file supports on publishing day. Each number keeps its conditions. Update it after Phase D on rc.8; the [Vibe interactions under test](../Handoff.md#vibe-interactions-under-test) list says which gates are still open.

## Benefits

| Benefit | How it works | Evidence today | Wording rule |
|---|---|---|---|
| A second opinion from another model family without leaving Codex | Codex starts a review, waits inside the tool call, reads the result | Hosted reviews on 2026-10-05 (rc.2) and 2026-10-07 (rc.7) correctly diagnosed a planted bug in a nested file of a synthetic repository and left the source unchanged | No "Vibe catches what Codex misses" unless the [experiment](experiment.md) shows it |
| Edits never touch your checkout | Detached worktree from `base_ref`; a patch comes back; nothing applied, committed, merged or pushed; cleanup checks the patch before removing the worktree | Hosted edit on 2026-10-07: an eleven-file patch applied to a clean clone and its four test cases passed; source unchanged; worktree removed | "You get a patch and decide." Say that uncommitted changes are not copied into the worktree |
| Reviews are read-only, and checked | Read and search tools only (`read_file`, `grep`; edits add `write_file` and `edit`); the workspace is snapshotted at launch and compared at the end, Git-visible files hashed | Hosted policy probes on 2026-10-07 on the ACP backend (both backends use the same tool list): outside reads and `.env` refused, `write_file` unknown in a review, zero permission requests | Name the blind spot: ignored paths such as `node_modules/` are compared by metadata only |
| Least privilege by default | Empty allowlist; shell and network tools off with no switch; private `HOME` and `VIBE_HOME`; filtered environment; the programmatic task text goes through a 0600 prompt file the shim deletes, so it is not in `ps` (ACP sends the task over the protocol); redaction; permission requests matched to tool calls, anything unknown refused | 615 tests in 55 files (2 installed-resolver tests skip without Vibe) and 66 Python tests at rc.8, none against a real Vibe; hosted checks above; hosted permission callbacks never triggered | Always pair with: an application-level policy, not an OS sandbox; Vibe runs with your account's permissions; permitted file content goes to Mistral |
| Runs survive crashes and restarts | Persisted state and events; recovery on demand; owner lock that detects reused PIDs; one end-of-run path; storage faults degrade instead of crashing | Hosted on 2026-10-07: restart after a completed run and during a running one, startup 98 ms, lazy reload to `end_turn`; idle expiry observed after 65 s with `worker_idle_ttl_seconds` set to 60 for the test (the default is 600) | Restarts were graceful (as when Codex quits), not `kill -9` |
| Honest results | `stop_reason` and warnings say when Vibe stopped early; a spent turn budget is refused instead of continued for nothing | Turn-limit fixes after the 2026-10-07 soak; the ACP budget gate in rc.8 is tested against fakes only | Hosted proof of the ACP budget gate is Phase D step D21 |
| Small overhead | Hybrid snapshot, temporary-index export, fsync batched to 100 ms, no probe for an explicit backend, logs loaded on demand | Table below | Supervisor overhead, not model latency |
| Easy to adopt | One `setup` command; five tools (seven with ACP); every reply names the next call; every error code has a remedy | `setup` plan, write and repeat on the target machine (project scope); clean-account install still open (D20) | "One command" only after D20 passes |
| Uses your own Vibe login, separate from Codex | Browser login, no API key | Hosted runs since 2026-10-05 used the browser login | Codex token savings were never measured: no savings claim |
| Several Codex windows at once | `--isolated` gives each client its own data directory and reuses free ones | Two concurrent isolated clients in the installed-package smoke test; native desktop adoption is D14 | |
| Everything is inspectable | `transcript.md`, `events.ndjson`, `diff.patch` per run; `runs list`, `show`, `tail` | Tests and hosted runs | |
| Fails closed on version drift | Exact Vibe pin with version and signature checks and a remedy | Tests; [2.26.0 source comparison](../docs/history/reviews/vibe-2.26.0-source-diff-2026-10-08.md) | A trade-off: Vibe 2.26.0 is refused until it is revalidated |

## Numbers

Hosted, macOS arm64, Vibe 2.25.8 with `mistral-medium-3.5`, official MCP client, synthetic repository, rc.7, 2026-10-07 ([evidence](../docs/history/reviews/rc7-target-test-2026-10-07/Read.md)):

| Measure | Value |
|---|---|
| Review of a nested file, reply settled, cold / warm | 8.9 s / 3.8 s |
| Edit producing an eleven-file patch | 12.1 s |
| `vibe-supervisor doctor` | 1.4 s |
| Keychain lookup of the browser-login credential | 8 ms |
| Supervisor startup with saved runs, restart test | 98 ms |

The settled-reply times are measured after the start call's wait returned, so they are not first-token latencies; most of each is the model's time. Earlier hosted edits cost about $0.02 each as reported by Vibe (rc.2, 2026-10-05). A real deployment task on rc.4 (2026-10-08, ACP) recorded 85 worker calls across two runs, about 771 seconds of session time including coordinator pauses, and about $0.94 estimated; those figures are the coordinator's estimates, not billing data, and the task did not validate the rc.7 or rc.8 fixes.

Supervisor overhead on the preparing machine (macOS arm64, Node 24.19, fake backends), before and after the latency phase:

| Path | Before | After |
|---|---|---|
| Review snapshot, 156,169-file tree (mostly `node_modules`), per pass; a review takes two passes | 30.2 s | 2.6 s, almost all stat scan |
| Patch export, 1 modified and 50 untracked files | 1.6 to 2.1 s | 0.13 s |
| Persisting 1,000 events | 4.8 s | 18 ms |
| `initialize` with 200 retained runs of 1 MiB logs each | reads every log | under 300 ms, logs load on demand |

Still missing for the article: the 100-run hosted soak (failures by code, p50 and p95), native Codex desktop timings, a clean-account install.

## Claims confirmed outside this file (editor review 2026-10-08)

| Claim in the article | Source |
|---|---|
| The planted bug is an arithmetic bug: `src/nested/arithmetic.py` in the synthetic repository has an intentional subtraction bug | [rc.7 test record](../docs/history/reviews/rc7-target-test-2026-10-07/Read.md), "Environment" section and the D8 row |
| The soak plan was 60 programmatic reviews, 30 programmatic edits and 10 ACP runs | Same file, soak section ("Its requested mix was 60 programmatic reviews, 30 programmatic edits and 10 ACP runs") |
| 50 is the supervisor's `max_turns` bound, not a Vibe limit | `MAX_TURNS_LIMIT = 50` in `src/mcp/schemas.ts`; write "the supervisor's maximum", never "Vibe's maximum" |
| Node.js 20.19 or newer | [README.md](../README.md) prerequisites |
| Reasoning: the supervisor does not persist the model's reasoning and filters it from Vibe's own session history | [docs/security.md](../docs/security.md): persisted events and JSON are sanitized and reasoning/private thought fields are omitted; the launcher shim removes reasoning fields before Vibe's native history writes. Do not write "not stored at all" |

## Never write

"Sandbox" or "sandboxed"; "secure" without saying against what; "production-ready" before 1.0; "saves tokens" or "saves money"; "the first" or "the only"; Linux or Windows support; support for MCP clients other than Codex; soak figures before Phase D.

## rc.8 real runs (2026-10-08)

Target machine, macOS arm64, Vibe 2.25.8 browser login, official MCP client, synthetic repository; reports in `docs/history/reviews/rc8-*`.

| Claim | Evidence |
|---|---|
| Turn-budget refusals (plain, equal, lower) send nothing to Vibe | Run `c20da652`: three refusals, `events.ndjson` unchanged at 12,545 bytes ([rc8-target-test](../docs/history/reviews/rc8-target-test-2026-10-08/Read.md)) |
| First raised continuation (3 to 10) failed; message and ceiling delivered; worker resumed the old nine-file chain | Same report; diagnosis in [rc8-continuation-followup](../docs/history/reviews/rc8-continuation-followup-2026-10-08/Read.md) |
| Raised continuation works live and after a restart when the objective fits or is explicitly cancelled | Runs `84d450f0`, `7eaac95c`, `ce82c536`: `end_turn`, expected file written |
| One-shot turn limit reported as `completed` / `max_turn_requests` with matching saved result (D24) | Run `dee12e6e`, `max_turns: 2` |
| Continued ACP session ends by the supervisor's deadline, not the launcher (D23) | Run `89b1295d`: `VSUP_TIMEOUT` after 61,268 ms |
| Disconnect while running leaves `recoverable`; idle session's worker removed; closed sessions' servers exit in 3 to 5 ms (D22, official client only) | rc8-target-test and rc8-continuation-followup |
| Edits: exact single-file write 23.223 s, add-file 10.782 s (60 s supervisor deadline) | [rc8-finding-fixes](../docs/history/reviews/rc8-finding-fixes-2026-10-08/Read.md) |
| Soak attempt 3: 19 passed, run 20 (edit) silent for the 900 s driver deadline; cause unknown, not recurred | rc8-continuation-followup |
| Soak attempt 4: run 1 review, 16 `grep` and 4 `read_file` calls, `max_turn_requests` at 20 turns after 21.4 s; native cost $0.03486 (non-authoritative) | [rc8-stall-diagnostics](../docs/history/reviews/rc8-stall-diagnostics-2026-10-08/Read.md) |
| Installed `npm link` command printed nothing until the realpath fix; smoke test missed it by starting Node directly | [rc8-cli-entry-fix](../docs/history/reviews/rc8-cli-entry-fix-2026-10-08/Read.md) |

Still open: the 100-run soak, Codex desktop, permission callbacks, clean account, Intel.
