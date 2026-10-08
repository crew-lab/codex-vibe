# rc.8 continuation investigation — 2026-10-08

Follow-up authorized after the [failed target-machine D21 trial](../rc8-target-test-2026-10-08/Read.md). Source e71f918 and the same locally rebuilt installed rc.8 package; no runtime/pin/policy changes. The original failure remains recorded unchanged.

## Diagnosis and controlled comparison

The supervisor queues the exact new message in src/backends/acp.ts, sets max_turns before session/prompt, and clears the old stop reason before starting the new turn. The failed trial's private sanitized history contained the new user message, the native ceiling was 10, and its six resumed reads succeeded. No lost message or unchanged budget was established.

Pinned Vibe 2.25.8 increments stats.steps when opening a user turn and after each model response (core/agent_loop/_loop.py:_open_user_turn and _conversation_loop). TurnLimitMiddleware stops when stats.steps - 1 >= max_turns (core/middleware.py). The ceiling is cumulative and a call that asks for more work is itself part of that accounting; leave room for the final answer. Tool calls may batch into a single model response. The nine-file chain plus write/final answer and two user prompts cannot finish at ceiling 10 if the worker continues the original objective. The initial correction asked for a different objective but did not explicitly cancel the original chain; the worker continued it. This is one observed behavior, not a guarantee that all task replacements require that wording.

Three fresh controlled runs with the same 3-to-10 ceilings passed:

- 84d450f0-c99b-45fc-9c20-3bb84a5f7d65: explicitly CANCEL the nine-file chain and replace it with one write. Produced override-result.txt with exact expected content; end_turn.
- 7eaac95c-8027-46a0-aae4-fb0f759ddbcf: a four-file pointer chain reaches the 3-turn cap; continue the same objective at ceiling 10. Produced short-result.txt with exact expected content; end_turn.
- ce82c536-b897-4dd6-b24a-4c5d01156c2e: repeat the four-file test, disconnect/restart after the cap, then explicitly raise to 10. Lazy load continued useful work and produced the exact file; end_turn.

All three exported patches were inspected and the expected files independently read before fresh verified export cleanup. No source patch was applied. See continuation-diagnostic.json for full public MCP results and close replies. The original trial already established plain/equal/lower refusal with unchanged event activity; these new trials establish useful live/reloaded raised continuation on a fixture small enough to fit.

## Acceptance-plan clarification

D21 is a lifecycle test, not a model's ability to finish an arbitrarily long original objective after a task replacement. Use a four-file sequential pointer chain whose fourth file instructs one small result write, and use a same-objective continuation. Retain max_turns 3 then 10 and the three refusal probes; do not increase ceilings. Record a changed test fixture as a separate attempt. Keep an explicit replacement prompt for changes of objective; do not silently assume cancelled objectives disappear from context. No supervisor code change is warranted by these observations.

## Further checks

Official-client shutdown and worker lifetime outcomes, the distinct 60/30/10 soak attempt, cleanup, usage and remaining native/platform gates will be recorded in session.json and accompanying evidence. The dry-run plan uses built-in rc.8 scoped tasks and the 20-turn review default on a fresh synthetic repository without the diagnostic pointer chains. It does not rewrite either earlier rc.7 soak failure or the original rc.8 D21 trial. Provider identity/credit balance is not inspected.

## Reliability outcomes

D24 passed: programmatic run dee12e6e-beda-4ee5-9205-7e0b6aad3000 at max_turns 2 reported completed/max_turn_requests, partial warning and matching saved result, without a crash error.

D22 official-client variants passed: disconnect while a review was running yielded recoverable after restart and bounded process exit; disconnect with a completed idle ACP review removed its worker and exited the server; closed edit sessions and their complete harness clients also exited naturally. Native desktop is unverified. Worktrees retained for recovery were not forcibly deleted; these running/idle scenarios used reviews, with edit cleanup proven by closed edit scenarios.

D23 passed: run 89b1295d-0151-48f2-aab9-824fdb611220 completed its initial 60-second-budget review, waited 90 seconds within idle TTL, then accepted a deliberately long continuation. It ended after 61,268 ms with VSUP_TIMEOUT from the supervisor, rather than VSUP_BACKEND_CRASHED from the original launcher lifetime. This is the expected timeout branch, not a completed long answer.

An initial shutdown harness loop exhausted its iterations before startup because it repeatedly requested already-delivered events. Adding a bounded observation delay fixed the harness. Its cleanup assertion also expected worktree_removed for a review, which has no worktree; that assertion was restricted to edits. Both issues and trials remain preserved as harness-only evidence, not product defects. No source changes or extra full-suite rerun was needed.

D15 installed-package checks passed without hosted inference: a second shared client was refused with owner PID/lock diagnostics, and VSUP_VIBE_NOT_FOUND was returned and saved identically in result.json. A scoped live soak-worker observation confirmed no task text/prompt path in argv, task-prompt.txt removed, manifest mode 0600 and run directory 0700. These are sampled D6 checks, not observations of every process. Import wall time was 23.969 ms (vibe cumulative import 6.453 ms); metadata-only Keychain lookup was 11.119 ms, output discarded and no credential value read. See the named JSON files.

## Hosted soak outcome — FAIL

The distinct rc.8 attempt requested 60 reviews, 30 edits and 10 ACP runs with seed soak, built-in scoped tasks, default review/edit ceiling 20 and stop-on-failure. It stopped at run 20/100: 11 reviews and 8 edits passed, then programmatic edit-add-file run 600ab9fd-9b2b-43fa-8c19-14768567cc14 emitted no public event and did not settle within the driver's 900-second deadline. The driver recorded driver:run_timeout and closed the uncertain run, exported an empty patch and removed its worktree. No task was replayed. ACP soak scenarios were not reached.

The worker remained alive with an established HTTPS connection, but wrote no native session metadata or public output before closure. This does not establish a credit, authentication, rate-limit or supervisor root cause; no corresponding explicit backend error was observed. Recorded native cost is incomplete because usage for the stalled run is unavailable. No account rotation occurred.

Summary criteria: unexpected-failure gate FAIL; zero permission requests, no owned leaked processes/worktrees, bounded artifacts and recent-run retention PASS. The driver found two new unrelated Vibe processes and did not terminate them. All 20 test runs are closed, source is clean and owned worktrees/locks/processes are absent. See hosted-soak-100/summary.json, runs.ndjson, cleanup.json and native-usage-summary.json. Original rc.7 and rc.8 failed trials remain intact.

Next: investigate the silent startup/inference stall without attributing it to credits. After a targeted isolated edit settles reliably, retry the full soak as a new attempt. A separate real CLI symlink defect was also discovered by direct installed-command testing; its fix and stronger offline smoke are recorded separately.
