# rc.1 hosted acceptance — 14 October 2026

## Final authorized batch outcome

All **seven** authorized starts have been used; all runs are closed; no retries or task replay occurred. Cases 1, 2b, 3, 4 and 5 meet their respective acceptance criteria. Original case 2 remains **FAIL**. Case 6 has **PASS for independently observed runtime lifecycle**, while its original helper **FAIL** remains preserved as a separate harness defect. Usage and cost remain UNKNOWN.

### Case 6: observed disconnect accepted; raw helper failure retained

Run `20627eaf-caeb-4612-a879-2232ddcc4ee5` used the official MCP client, verified the exact five-tool catalog and `1.0.1-rc.1` handshake, and started once against base `9e04d00353b368d84bfbd529d51333ef40ae2b83`. The observer was armed before start. Five completed reads, running state and a fresh live owned-worker sample were recorded before client close at `2026-10-14T06:54:42.578Z`.

Observer sample 21, at `06:54:43.165Z`, proves supervisor and worker exit, an empty worker process group, released lock and the same failed run. Reconnect reports `VSUP_BACKEND_CRASHED` and `retryable: false`, without replay. The helper nevertheless returned FAIL: the supervisor shared a process group with the helper/controller, so the helper waited for its own process group to become empty. Sample 107, at `06:55:04.780Z`, in the same continuous observation proves all tracked groups empty after helper exit. The raw result is unchanged; separate independent review accepts the runtime gate. This is one observed lifecycle case, not a completed edit or repeated soak.

Fresh export equals the saved zero-byte patch; the worker was pristine. Protected close removed only that owned worktree. Final native readiness is eligible with no blockers and a free slot. The frozen candidate archive remains unchanged. No patch was applied to Garnebo; no commit, push, tag or release was created.

Evidence: [independent review](case6-independent-review.md), [raw helper FAIL](case6/case6-official-client.json), [observer snapshot](case6/observer-snapshot.jsonl), [native result](case6-result.json), [fresh export verification](case6-export-verification.json), [protected close](case6-close.json), [native readiness](final-readiness.json), [budget](budget.json). The separate [offline post-exit verifier](case6/post-exit-verification.json) accepts this same evidence; [11 local regressions](case6/helper-regressions.log) passed. The executed helper and raw FAIL were not rewritten.

### Next gates

1. Prepare human-operated fresh standard macOS account acceptance without account creation or credential copying by an agent. Any further paid inference needs its own authorization.
2. Preserve and integrate the reviewed source delta against the current remote baseline in a clean checkout; verify CI and source/package identities. Do not rebuild or replace the frozen archive while describing it as the same candidate.
3. Obtain applicable publication approval only for a concrete reviewed source/artifact. Fresh-account acceptance and any unresolved release requirements remain prerequisites.

The historical no-edit run's cause remains UNKNOWN. The successful observed reads and edit do not explain that older failure retroactively. Published 1.0.0 remains unchanged; 1.0.1-rc.1 is not declared stable.

## Historical continuation checkpoint (before final disconnect)


The owner separately authorized one new whole-file edit and resumption of cases 3–6 only after that edit passes. **Case2b implementation PASS**: independent source review and all 18 actual-command fixtures PASS, without worker-code repair. GNU grep 3.11 with PCRE support was built temporarily to exercise the Ubuntu-targeted grep-P commands; no global tool or project dependency changed. The worker's summary misstated record length as126; its dynamic calculation and accepted bytes correctly use127. This reporting inaccuracy is retained and corrected in coordinator evidence.

Cases3/4 PASS for the intended incomplete turn-limit classification; case4 exported no changes and its pristine worktree was safely removed. Case5 normal review PASS after both limits. All are closed. Total allowance is now seven; six used, one remaining for the official-client disconnect. **Earlier case2 FAIL remains unchanged**; the original stopped-batch account below is historical, not rewritten.

Evidence: [case2b acceptance](case2b-acceptance.json), [18-case results](case2b/fixtures.log), [case3](case3-acceptance.json), [case4](case4-acceptance.json), [case5](case5-acceptance.json), [current budget](budget.json). Hosted lifecycle/quality is not fully complete until the final disconnect and remaining release gates are verified.

**Batch stopped at the first unexpected acceptance failure.** Two of six authorized runs used; four unused. Both runs closed. No retry, site integration or publication.

Candidate archive SHA256: `2442e35579d30dbc9b28bab4abaddfbb0a7c1e782055ba83cc4187ca24946b98`. Native connection reports `1.0.1-rc.1`, instance `21f2aa4f-9f9a-4944-802b-d6f83de06d13`, policy revision `1b44e421b46ad2443563e8b5625f1ad4859870bfe02397fcb86acbeb41db3966`. Fresh matching receipts were used. A pre-run expired receipt was refused without creating a run; readiness was refreshed before the first hosted start. This was preparation, not a hosted retry.

## Case 1: PASS

Run `4145d2f6-225d-4878-a531-e64c870e058e`: review of CONTRACT.md / src/limit.mjs. Correct answer “No defect found,” end_turn, no warnings, verified integrity, original hashes unchanged. Diagnostics confirm exact read/search inventory and two completed read invocations. Closed. [Result](case1-result.json), [acceptance](case1-acceptance.json), [close](case1-close.json).

Time from start record to final message: **5.511 seconds**. This excludes coordinator verification and close. [Timing](case1-timing.json).

## Case 2: FAIL — incorrect patch, tools worked

Run `0dacfbbc-65c8-441b-990e-021c7b524711` read both workflows, edited only rollback.yml and reread it. Diagnostics show the exact four expected tools, three completed reads and one completed edit. It returned end_turn, no warnings and a nonempty scoped patch. This clears neither the historical failure nor overall candidate acceptance; it establishes hosted access for this observed task.

The original 16 workflow-command fixtures passed. Independent source review found an uncovered violation of the existing whole-file contract: one valid record followed by LF and unterminated junk or CR is accepted. `wc -l` counts LF characters rather than validating the entire file, `read` checks only the first line, `shasum -c` warns but exits zero for malformed trailing text, and the standalone negated grep is exempt from Bash errexit.

Two added tests executed the **actual unchanged worker workflow commands** in a disposable, byte-verified export. Both showed exit zero and tar invocation for forbidden trailing bytes. The already accepted Luna workflow was tested separately as a positive control: **18/18 PASS**. That control is not a repair or acceptance of Vibe's patch.

Evidence: [worker patch](case2/diff.patch), [result](case2-result.json), [diagnostics](case2/worker-diagnostics.json), [16-case results](case2/fixtures-verified.log), [edge failures](case2/independent-edge.log), [18-case verifier](case2/independent-verifier.test.ts.txt), [positive control](positive-control.log), [acceptance](case2-acceptance.json).

An initial coordinator verification copy was nested inside the parent Git checkout, so git apply skipped the target; those 13/16 baseline results are rejected as worker evidence and retained in fixtures-original.log / fixtures/. The corrected standalone Git copy was explicitly compared against worker bytes before testing. Correct workflow SHA256: `d93b133419943842675166e0f8d5633a8e4b22f1ff0fe8ba097b8f2d24889f3b`.

Time from start record to final message: **64.072 seconds**, within its 180-second ceiling. [Timing](case2-timing.json). Source snapshot hashes remained unchanged. The run is [closed](case2-close.json); cleanup correctly retained the dirty worktree. No worker patch was applied to the site.

## Remaining work

Cases 3–6 are NOT RUN because the owner-approved stop rule applies. Costs remain UNKNOWN. Candidate local/packaging checks remain valid, but hosted matrix and stable release acceptance are incomplete. Historical run `4ba5e305…` still has UNKNOWN cause; these observed tool successes do not explain it retroactively.

The failure also improved acceptance coverage: counts and old fixture passes alone would have missed the defect. A [concrete follow-up assignment](proposed-followup.json) now requires whole-file validation and 18 tests. One additional bounded edit and resumption of the four unused cases need an explicit owner decision; no such run is started automatically. Fresh-account and publication gates remain separate.
