# Bounded lifecycle and recovery test plan

Status: **planned, not run**. [Current triage](history/reviews/lifecycle-triage-2026-10-09.md) blocks hosted execution until F8/F7/F15/F11 fixes pass offline regressions. This plan is not a new hosted allowance or approval to raise limits. Elicitation coverage separately requires F9 resolution.

## Preparation and offline prerequisites

1. Implement typed denial selection, response race protection, canonical saved-worktree ownership checks and late-creation bookkeeping. Independently review exact changes. Test misleading option names/IDs, missing rejection, late completion/failure/close, replacement pending requests, swapped run paths, symlink/outside paths, identical exports and close during creation. Refusals must preserve unrelated refs/files/allowlists.
2. Run relevant tests, lint, typecheck/build and release packaging verification using the populated offline cache. Verify the new artifact checksum and installed source/version; do not assume rc.17 contains new fixes or label source-only changes as installed.
3. Use a secret-free tracked fixture on an already allowed root, an immutable Git base and supervisor-created detached worktrees. Baseline process/worktree inventory precedes dispatch. Keep dependencies, build caches and independent verification in separate copies.
4. Record actual available hosted allowance and agreed cumulative ceilings. Bind each native run to creator version, executable Vibe 2.25.8, archive/source identity and installed skill hashes. Fresh official-client initialization is a separate observation from native desktop connection.

## Proposed campaign

Run one worker at a time; stop on the first unexpected result. Proposed per-session ceilings: 12 cumulative turns and 240 seconds, initial wait at most 30 seconds; never silently raise either limit. Reserve cleanup/observation time separately. Declare a finite total wall-time envelope before execution. Failed pilots do not authorize retries, account rotation or fallback replays.

| Stage | Procedure | Required evidence |
| --- | --- | --- |
| Offline boundary failures | Exercise the new regression cases above with fake backends/owned fixtures. | Safe rejection; final state never revived; wrong-run cleanup refused; late worktree accounted for; original source/ref hashes unchanged. |
| Completed-session recovery | Complete a small edit, preserve exact export, disconnect the client; reconnect and explicitly request a small same-session follow-up. | Advertised load capability, validated supervisor paths, same session identity, no original-task replay or restored permission grant. |
| Interrupted-session recovery | In a separate controlled edit, disconnect mid-turn; reconnect and inspect before explicit continuation. | Accurate recoverable/failure state, owned residue inventory, preserved candidate evidence, no automatic prompt replay or saved-PID termination. |
| Cancellation and expiry | Separate controlled cases for mid-turn close, timeout and idle expiry, only within the declared campaign budget. | Structured stop/state, bounded exit, no live owned worker, source unchanged; continuation behavior and cumulative limits explicitly reported. |
| Export and cleanup | Independently verify exact base plus fresh exported patch in a separate copy; collect result before supported close. | Fresh file hashes match candidate/export; removal independently confirmed, or explicit retention reason with inventory. No force deletion. |

Begin with at most two recovery pilots (completed and interrupted). Cancellation/expiry cases require remaining declared allowance; they are not implicit extra runs. A desktop restart must be deliberately scheduled by the operator, never triggered automatically in the active chat. Repeat required scopes separately through the official client and native desktop; neither result substitutes for the other.

## Measurement, failure receipts and acceptance

Measure from disconnect request to client/server exit, owned-worker absence and owner-lock availability. Report graceful shutdown time and force-termination time separately: the current source has a 10-second graceful deadline and a separate bounded force wait. Establish the exact expected end-to-end ceiling from the fixed source before dispatch, including client close handling; do not claim the whole path is bounded by the graceful timer alone.

Collect sanitized run ID/creator, start/end times, declared limits, structured stop reason, event sequence, session identity, export/file hashes, source invariants, owned residue and cleanup outcome. Preserve failures privately; omit raw histories, credentials and contact URLs. Pending grants must not survive recovery. Never act on an arbitrary saved PID. If capability/path validation fails, record the supported refusal instead of replaying the task.

A gate passes only with its expected state and evidence: no unexplained live workers, changed source or worktrees, explicit retention for preserved edits, and independent candidate verification where an edit exists. Initialization-only probes and fake ACP tests remain offline evidence. No native recovery, crash/soak, Intel or clean-account pass is implied by preparation or earlier bounded edit success.

After both pilots pass, review evidence and remaining allowance before scheduling the rest of D10–D12/D22–D23. The full D18 soak stays a separate campaign after readiness; preserve [Handoff](../Handoff.md), [strategy](v1-stable-strategy.md) and [canonical release gates](compatibility.md#unverified-gates).
