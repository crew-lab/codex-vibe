# Bounded review pilot outcome — 2026-10-08

**FAIL: first pilot exceeded the read-call acceptance bound.** No second pilot or full 60-review/30-edit/10-ACP pass started. The earlier intermittent silent stall remains unresolved. No runtime defect or quota failure was demonstrated.

## Candidate and verification

Candidate `b366c5932f95c60c00dfd43e292bcb7ec4739f09` on codex/rc8-stall-diagnostics; source tree `af6f7a1b529ec3b06355aa3e64b5eab698ed2e22`. Installed archive SHA-256 `987441497cd707cb0af0c688cee3614a99f2badd48c83a8463f0a000de238de9`. Exact driver/audit hashes and prior archive hash are in [manifest](manifest.json). Prior archive retained privately; no release/version bump/main push/global configuration change.

Bounded-test evidence was already separately committed as b7625e0. Driver prompts now request correctness-only reviews, at most three separate read calls and two searches, and a same-turn final answer. Lifecycle prompts allow five separate reads and no searches. Audit validates canonical owner-only session paths and regular, unlinked, size-capped native records; only fixed tool counts and final-answer status are retained. It rejects exceeded bounds, unexpected tools, unavailable/unsafe records and a missing current-turn final answer. Read-call bounds conservatively enforce the file limit without retaining tool arguments; five reads does **not** establish that five distinct files were read. Runtime permissions, 20-turn ceiling, deadlines and MCP interfaces were unchanged. Expected single-file edit scope is also checked before cleanup.

Offline package:rc passed release verification and actual installed executable/MCP smoke with the populated cache: 626 TypeScript tests passed, two optional installed-profile tests skipped in that invocation, plus 76 Python cases. Supplemental installed-profile/audit run passed eight tests, including both installed pinned-Vibe profiles and three new audit regressions. Final lint and typecheck passed. The installed npm executable printed 0.9.0-rc.8. Driver regressions cover excess reads/searches, absent final answers, unsafe/unavailable records, stop-on-failure and cleanup; final-answer freshness, stop-marker rejection and native secret-canary exclusion have additional regressions. The full package run began before discovery of the three supplemental unit cases; they were run separately, with final lint/typecheck after the frozen candidate.

## Observed hosted result

Seed soak, existing synthetic fixture, fresh private homes, installed candidate, current account, diagnostics enabled, start wait zero, status waits 30 seconds, run deadline 900 seconds. The pilot budget was 1860 seconds with its final 60 reserved for cleanup; the planned full-pass budget remains 7200 seconds and was never started.

First shuffled pilot was review-bug-class, run fda1df51-72a3-40ac-af66-700392b3a5bb. It completed end_turn in 21.502 seconds with verified review integrity and a public final answer. Validated native counts: **five read_file calls, two grep calls, zero unexpected tool names**; all seven tool-call IDs were distinct. Acceptance failed with driver:review_task_bounds against the explicit three-read-call limit. Its public answer claimed to stay within that limit; the audit contradicts that claim. The seeded arithmetic subtraction defect was correctly identified. Its extra input-validation/error-handling findings depend on an unstated type contract and duplicate the same trigger, so they are not independently established defects.

All six startup stages completed by 95 ms. No 60-second frame snapshot was due. One public message event and zero permission/input requests were recorded. This was a task-bound violation, not turn exhaustion, timeout, provider-reported error or unexplained silence. Native histories/arguments/reasoning remain private. No account balance or credentials were inspected. No automatic retry, limit increase or account rotation occurred.

An earlier coordinator CLI invocation rejected an unsupported --server-arg= syntax during argument parsing, before any hosted run or evidence home was created. It was corrected before the sole hosted pilot; this is a preserved preflight harness error, not a hosted retry.

## Cleanup and limits

Run closed; saved worker absent; owner locks absent; no registered owned worktrees or owned process leaks. Fixture Git state is clean. [Cleanup evidence](cleanup.json) and [driver summary](summary.json) record the checks. Public result/transcript/events, bounded startup diagnostics, verification logs and hashes are retained here. Private candidate installation, diagnostic homes and native histories remain at the private root in the manifest. The primary checkout's unrelated changes remain preserved.

The pilot gate failed at 1/2; full soak acceptance remains unverified. No new edit exports, ACP continuation/reload/mid-turn close or real hosted stall snapshots were exercised. Native desktop, permission/elicitation callbacks, clean-account and Intel gates remain separate.

## Next focused investigation — not started

Inspect the private failed-read sequence offline to determine why five calls were made and why the answer miscounted them; publish only bounded aggregate counts. Evaluate an explicit validated file-list task and a stop-after-read-error rule using fake records before deliberately authorizing any fresh pilot. Confirm whether repeated/failed reads should continue to consume the conservative call budget; do not silently relax it or rely on the worker's self-report. Add a runtime regression/change only if a concrete runtime defect emerges. Preserve this failure and the earlier silent-stall reports.
