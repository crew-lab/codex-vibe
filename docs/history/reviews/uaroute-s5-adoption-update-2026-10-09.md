# UARoute S5 adoption update before rc.17 testing

Date: 2026-10-09. Documentary review only; no hosted run, application or configuration change. Source: `/Users/roman/src/github.com/r-senchuk/uaroots/docs/Operations/POC/`. Its foreign AGENTS.md change was preserved.

## New evidence

The updated adoption report, S5 review record and `s5-evidence-2026-10-09/vibe-review-attempt.json` add run `7a9c283c-78f8-4606-a82a-565201781751`: installed CLI rc.15, but native creator **rc.12**, pinned Vibe 2.25.8, ACP read-only review. Seven matching schemas did not establish a refreshed connection. Limits were 20 cumulative turns, timeout 2400 seconds, initial wait 30 seconds; no increase. Execution took 64.878 seconds.

The run completed with `end_turn`, a final answer accepting the original bundle, no warnings/changed files and verified integrity/no write observed. Five unique reads completed without failed updates; 17 streamed chunks are not assistant turns. The worker accepted the supplied manifest identity without computing it. Supported close and same-connection closed-state confirmation were recorded; no edit worktree existed. Continuation, correction, recovery and soak were not exercised.

This corroborates the later [rc.17 desktop preflight](rc17-desktop-preflight-2026-10-09.md), which also returned creator rc.12 despite the updated registration. These are separate observations, not proof of an rc.15/rc.17 runtime defect. Resolve the desktop connection before further hosted tests; fresh official-client initialization remains separate evidence.

## Quality and identity

Vibe accepted the original report, but independent GPT-6 Luna High found a P2 ambiguity: a combined eight-row GA4 query appeared beside one channel's totals. The coordinator clarified **35 events / 18 key events**, with channel subtotals **20/9 across five rows** and **15/9 across three rows**. These are not unique inquiries, receipts or journeys. Luna accepted the revision after one correction; its acceptance is not a Vibe result.

Fresh local verification matched the accepted report SHA-256 `733137ffa3b25b4340a0424d74802717af2599b2bdc5fc0ebc800ed8c0dd4c77` and manifest `b3a89e46924629d30fe673abdb9447bbb5d57c6851c70c949eaac466ebccedb0`. All 15 manifest entries and all ten adoption source entries plus its report hash matched (11/11). Original report/manifest snapshots also matched their recorded hashes `eefdefee107cde91e2abf147f2ae7d8cae7f73f35ae037244059584174e16cdb` and `1da8ee7f3150b25d8d94127a9c13c3eee64be22a90c9211d2f9d1dfaa76999dd`. Saved normalized R4 rows/summary agree with the corrected totals. This verifies documentary identity/consistency, not new authenticated collection.

The adoption report's frontmatter still says no hosted S5 review occurred; the thread handoff retains older cleanup wording saying no new usable review existed. Their subsequent dated S5 review sections supersede those statements. No UARoute files were edited here.

## Next-test adjustments

1. Verify the actual fresh native connection/version. Do not repeat the completed S5 review merely to obtain a newer version label.
2. Use a new small tracked review fixture with a known defect and a clean control, against coordinator-held oracles. Require location, trigger and consequence; final ACCEPT alone cannot pass the defect fixture. Assess review accuracy separately from integrity/lifecycle.
3. Compute hashes independently; echoed supplied hashes are not verification. Preflight exact context availability, including ignored/local evidence, without worker reconstruction.
4. Then exercise the prepared controlled edit/correction fixture. Keep the session open through independent tests/review, continue within the cumulative ceiling, re-export and verify cleanup. Synthetic correction is not product acceptance.
5. For a subsequent narrow product increment, prepare the immutable effective baseline before inference and keep verification caches outside the worker worktree. Preserve earlier hydration/match failures and distinguish structured termination from unavailable tools or policy denial.

The city/SEO implementations remain Luna/coordinator outcomes; no Vibe product candidate was accepted in these UARoute records. The historical POC hour plan/owner estimate is not a new Supervisor testing allowance. Turns and runtime establish neither daily provider quotas nor billing.

Checks: JSON/hash verification above, local Markdown links and `git diff --check`. No runtime tests or packaging rerun for this documentation update.
