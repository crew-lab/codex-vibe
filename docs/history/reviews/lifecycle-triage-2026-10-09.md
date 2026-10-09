# Current lifecycle triage — 2026-10-09

Source: `9191338380cca6f2723765a513d26040c1b636a4`, now merged into remote main. This review reassesses [cold-review F7–F15](1.0-cold-review-2026-10-08.md). Runtime code and installed rc.17 remain unchanged. No hosted inference, global configuration changes or release certification occurred.

## Findings and execution order

| Finding | Current evidence | Disposition |
| --- | --- | --- |
| F8, automatic denial | A fake unsafe execute request offered `allow_once` named “Allow once (never deny)” before a valid `reject_once`. Policy selected the allow option because it matches denial substrings in labels/IDs. No shell or network executed. | Safety prerequisite: select only validated rejection kinds; misleading labels must never grant. Missing valid refusal must fail closed. |
| F7, response completion race | Fake backend completed during `respond`; manager subsequently changed `completed` back to `running`. | Lifecycle prerequisite: condition/serialize the post-response state change against the same pending request; cover completion and replacement-request overlap. |
| F15, saved worktree identity | Two disposable supervisor-owned runs had identical empty exports. After changing only fixture A's saved path/workspace to B, closing A removed B. Restoring A metadata allowed supported cleanup of A. | Cleanup prerequisite: derive and validate canonical run-owned path and source/base identity before cleanup, including retention. Saved metadata and matching patches alone are insufficient. Requires access to private saved records; no remote exploit demonstrated. |
| F11, close during worktree creation | Delayed return from a real fixture worktree creation let close return `closed`, without removal or retention reason; the worktree was recorded afterward. A second supported close removed it. | Lifecycle prerequisite: account for late creation, preserve evidence, and return or persist explicit cleanup/retention status. Never force-delete uncertain work. |
| F9, elicitation validation | Annotated root schema accepted by adapter inspection; responding to a matching manager fixture yielded `VSUP_INVALID_ARGUMENT`, leaving `waiting_input`. Adapter permits additional constructs the manager rejects. | Compatibility fix before claiming elicitation coverage: use a shared supported schema contract or narrow admission. This refusal is not a credential disclosure. |
| F10, manual broad roots | Config validator accepted `/` and `~`; setup/allow have stricter restrictions. Actual allowlists unchanged. | Explicit hardening decision: align direct configuration with supported root policy or document intentional operator authority. Do not describe the current deployment as broadly allowlisted. |
| F12, transport output cap | Source confirms cumulative wire stdout uses `maxTranscriptBytes`, including continuation; visible transcript and wire traffic are different quantities. | Define/document supported accounting, then test exact overflow and continuation boundaries. Overflow itself was not reproduced in this review. |
| F13, shutdown | Current remedy has graceful deadline, owned-worker termination and owner-lock release. Existing fake-process tests passed, including a real OS process group for a fake ACP peer. Force termination has a separate bounded wait. | Old finding is remedied locally; end-to-end native desktop shutdown/recovery remains unverified. Measure the entire client/server path, not just the graceful timer. |
| F14, unused dependency | `@modelcontextprotocol/node` remains pinned but has no imports in source/tests/scripts. | Nonblocking maintenance decision; dependencies unchanged. |

F8, F7, F15 and F11 must be fixed and covered by meaningful passing regressions before the [bounded recovery campaign](../../lifecycle-recovery-test-plan.md). F9 requires resolution before its specific gate. Historical “non-blocking” labels do not override reproduced boundary/lifecycle failures.

## Reproduction and verification

[Sanitized observations](lifecycle-triage-2026-10-09/observations.json) and [offline reproducer](lifecycle-triage-2026-10-09/reproduce.mjs) preserve the evidence. The reproducer asserts observed defects; it is a historical diagnostic, **not** a passing safety regression or a release command. It uses fake backends, private disposable Git fixtures and no provider calls. After fixes, implement focused regressions asserting safe behavior instead of treating this diagnostic's assertions as acceptance.

On a separate disposable source copy, install the pinned dependencies, build, then invoke `node docs/history/reviews/lifecycle-triage-2026-10-09/reproduce.mjs dist`. Process inspection and local Git worktree operations must be permitted. It retains private fixtures and an owner-only observation receipt; rerunning it creates additional evidence. Do not point it at global provider state.

Checks actually performed: build passed; recovery/client-shutdown/worktree-close suites **29/29**; stability-fixes **5/5**. These existing tests pass despite the uncovered cases. F7/F8/F9/F10/F11/F15 were independently exercised against compiled current source through the diagnostic. F12/F14 are source inspection only. No full release/package rerun is claimed for this documentation increment.

All worktrees in the F11/F15 diagnostic were cleaned through supported close calls, with the fixture metadata restored where required. Private source fixture directories remain as diagnostic evidence. Unrelated source changes, installed configuration, provider homes and locks were preserved. No new hosted spending or platform/soak claim follows from these tests.
