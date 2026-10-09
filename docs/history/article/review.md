# Review of plan, evidence and draft 1 (2026-10-08)

Checked against `README.md`, `docs/reference.md`, `docs/functionality.md`, `docs/security.md`, `docs/compatibility.md`, `CHANGELOG.md`, `Handoff.md`, the dated evidence under `docs/history/reviews/` and `src/backends/profile.ts`. Corrections marked **applied** were made directly in [evidence.md](evidence.md) or [plan.md](plan.md); the rest are fixed in draft 2.

## Factual corrections

| # | Claim | Where | What the source says | Source |
|---|---|---|---|---|
| 1 | "idle expiry after 60 s" | evidence.md, Runs survive restarts | The test set `worker_idle_ttl_seconds = 60`; the default is 600 s. The 60 s is a test setting, not the shipped behaviour. **Applied.** | `Handoff.md:343` (D12), `docs/reference.md:116` |
| 2 | Policy probes (outside read, `.env`, `write_file` unknown) presented without backend | evidence.md, Reviews are read-only | The hosted probes ran on the ACP backend (`acp-target-checks.json`, run `ed5b37c8`). Programmatic reviews use the same tool list, so the claim holds, but the condition belongs in the ledger. **Applied.** | `docs/history/reviews/rc7-target-test-2026-10-07/Read.md`, "Explicit ACP tests" |
| 3 | "task text kept out of `ps`" stated for every run | evidence.md, Least privilege; draft.md, How the pieces fit | Only the programmatic backend writes the task to a 0600 prompt file the shim deletes; ACP sends the task over the protocol. **Applied in evidence.md**; draft 2 qualifies it. | `docs/functionality.md:11`, `docs/security.md:7` |
| 4 | "85 worker calls over about 13 minutes ... about $0.94" | evidence.md, Numbers | The figures cover two runs of the deployment task on rc.4, about 771 s including coordinator pauses, coordinator estimates. The run count and the rc.4 condition were missing. **Applied.** | `docs/history/reviews/deployment-acp-lessons-2026-10-08.md` |
| 5 | "Server start with 200 retained runs, under 300 ms" | evidence.md, overhead table | Measured as `initialize` with 200 retained runs of 1 MiB logs each; logs load on demand. Condition added. **Applied.** | `Handoff.md`, Phase B table |
| 6 | Review snapshot "per pass" | evidence.md and draft.md tables | The source adds that a review takes two passes (launch and end), and that the 2.6 s is almost all stat scan. Condition added. **Applied.** | `Handoff.md`, Phase B table |
| 7 | Test count "615 TypeScript and 66 Python tests" | evidence.md | 615 tests in 55 files, of which the 2 installed-resolver tests skip when Vibe is not installed; nothing in the suite runs a real Vibe on the preparing machine. Condition added. **Applied.** | `Handoff.md:75` |
| 8 | Story 2: "rc.8 refuses that continuation" | plan.md, The story | True as implemented, but the field task ran on rc.4, and the rc.8 gate is tested against fakes only until D21. Both conditions added. **Applied.** | `CHANGELOG.md` rc.8; `Handoff.md:148`, D21 |
| 9 | "The shim ... gives each run a private `HOME` with only the supervisor's own agent definitions, keeps the task text out of the process list" | draft.md, How the pieces fit | The Node supervisor creates the private `HOME`/`VIBE_HOME`, writes the agent profiles and the prompt file; the shim checks version and logger signatures, deletes the prompt file, forces the legacy harness and filters session persistence. Attribution fixed in draft 2. | `docs/compatibility.md:15,36`, `docs/functionality.md:11` |
| 10 | Cleanup refuses when "no unexplained files are left" | draft.md, Edits come back as a patch | The conditions are: a fresh export matches the saved `diff.patch` digest, the path is a registered supervisor-created worktree, and no ignored files remain. Draft 2 says "ignored files". | `docs/functionality.md:43` |
| 11 | "Small patches come back inline" without the threshold | draft.md | Inline when at most 4000 bytes and the reply fits `limits.max_mcp_result_chars` (default 8000). Draft 2 gives the number. | `docs/reference.md:82,93` |
| 12 | Hosted timing table lacks "synthetic repository" | draft.md, Overhead | The 8.9 s / 3.8 s / 12.1 s runs were on a synthetic fixture, and the settled-reply times are not first-token latencies. Draft 2 states both. | `rc7-target-test-2026-10-07/Read.md`, Hosted evidence |
| 13 | "[VERSION] covers ... several Codex clients at once" | draft.md, Status | Concurrent isolated clients are verified only in the offline installed-package smoke test with the official MCP client (D14 partial); native desktop adoption is unverified. Draft 2 says "several MCP clients with `--isolated`" and leaves desktop out. | `rc7-target-test-2026-10-07/Read.md` D14; `docs/compatibility.md` gates |
| 14 | "Codex then makes three tool calls" | draft.md | Three is the usual loop; `vibe_status` repeats while the run is unsettled, and the Phase D driver added a `vibe_result` call. Draft 2 says "usually three". | `docs/reference.md:19`; D5 note |
| 15 | "only Codex is tested" | draft.md, When not to use it | Native Codex desktop registration and visibility were verified on 2026-10-05 with a patched rc.2; rc.7 hosted runs went through the official MCP client, and native desktop use of the current build is unverified. Codex CLI was never exercised as a client. Draft 2 states the actual scope. | `docs/compatibility.md`, Unverified gates |
| 16 | "Try it in five minutes" | draft.md heading | No clean-account install exists (D20 skipped), so the time is an unverified promise. Draft 2 drops the minutes. | `rc7-target-test-2026-10-07/Read.md` D20 |

Verified as written (no change): the 12-turn limit reached in 27.4 s with exit 1 and `VSUP_BACKEND_CRASHED` on run 1/100; the retry on the patched build reached it in 15.2 s and was reported as `max_turn_requests`; the four-condition recognition rule; the review default of 20 turns; `VSUP_TURN_LIMIT_REACHED`, `max_turns` 1 to 50 as a cumulative ceiling, `VSUP_INVALID_ARGUMENT` for a lower value; the hosted 8.9 s / 3.8 s / 12.1 s / 1.4 s / 98 ms / 8 ms; 30.2 s to 2.6 s, 1.6 to 2.1 s to 0.13 s, 4.8 s to 18 ms; the fsync coalescing at 100 ms; review tools `read_file` and `grep`, edit tools adding `write_file` and `edit` (`src/backends/profile.ts:109`); `wait_seconds` 0 to 300 with the skill's 120 to 300 guidance; `cleanup_worktree`, `worktree_removed`, `worktree_retained_reason`, `integrity.status`, `write_tool_observed`, `stop_reason`, `next_action`, `patch_path`; the 48-hour hard cap; Node >= 20.19; the install and setup commands; the GitHub remote `crew-lab/codex-vibe`; the empty starter allowlist; shell and network off with no switch; the 2026-10-06 date of Vibe 2.26.0 and the recommendation to keep 2.25.8 for 1.0.

## Editorial findings

1. **The angle is right for #showdev**, and the two real failures are the strongest material. Draft 1 gives them one paragraph each in section 7; they deserve more room and more specifics (the exact marker, the time, the stop reason, what the fix checks), because they are also the clearest evidence that the project tests its claims. Draft 2 expands that section and moves it ahead of the measurements.
2. **The opening depends entirely on an `[author]` placeholder**, so draft 1 has no first two or three sentences that state the problem. Draft 2 writes the problem statement itself and keeps a shorter `[author]` placeholder for the personal reason only.
3. **MCP is not spelled out on first use** (the TL;DR says "MCP server"); ACP is. Draft 2 expands both.
4. **No table of contents** although the plan asks for one and the post exceeds 1,500 words. Added.
5. **Guardrail list and the "pieces" section overlap**; draft 1 says "private home" twice and "shell and network off" twice. Draft 2 keeps the mechanism in "How the pieces fit" and the policy in "Guardrails".
6. **Measurements mix model latency and supervisor cost under one heading** without saying which is which until the second table. Draft 2 labels them and says in one sentence that the hosted numbers are mostly the model's time.
7. **Status overclaims** ("covers reviews and edits in both modes, recovery after restarts, several Codex clients") relative to the unverified gates. Draft 2 lists what was verified, on which build, and links the gates.
8. **"Try it in five minutes"** is a promise the evidence cannot back until D20. Renamed.
9. **The honesty paragraph is good** and stays close to the README wording. Draft 2 adds the redaction caveat already present and the "treat it as running someone else's code" line.
10. **Research rules:** no em dashes, no banned words and no "That's it." were found in draft 1 or the plan. The AI disclosure sentence at the end is right, but research.md notes that the label is set in the editor, not by the sentence; the README already says so.
11. **Length:** draft 1 is about 1,900 words including front matter. Draft 2 is about 2,250.
12. **Alternatives section is thin** and still marked "[recheck]"; that is correct, since the landscape was checked once on 2026-10-07. Keep the placeholder.
13. **The cost figures** ($0.02 per edit, $0.94 for the deployment task) are coordinator estimates, not billing data. Draft 2 uses only the $0.02 figure with its condition; the deployment figure adds little to a launch post.

## Decisions for the author

1. **Title:** option 1 (recommended in the plan) is used in draft 2. Option 2 ("I gave Codex a second code reviewer with read-only access to my repo") reads more like a person and less like a release note; pick one.
2. **Tags:** `showdev, mcp, ai, opensource` versus swapping `opensource` for `security`. Draft 2 keeps the plan's choice.
3. **Publish at 1.0 or as a release candidate asking for testers.** Draft 2 is written for 1.0; an rc post would need the "Status" section rewritten and the install line pointed at a pre-release.
4. **Which clients to name.** Draft 2 says Codex desktop was verified on a patched rc.2 build and the current build through the official MCP client. If native desktop use of the release build is verified in Phase D, simplify that sentence.
5. **Whether to run the experiment** (experiment.md). Without it the post makes no cross-model-quality claim, and draft 2 does not.
6. **The ACP mode.** It is opt-in and its budget gate is unverified until D21. Draft 2 mentions it in two paragraphs and marks the D21 dependency; cutting it entirely would shorten the post by about 150 words and remove one unverified claim.
7. **Repository URL and description.** The remote is `crew-lab/codex-vibe`; confirm the repository is public before publishing and fix the description ("Codex ASP client for Mistral Vibe") first, as Handoff.md already requires.
8. **Cover and GIF:** the plan excludes OpenAI and Mistral logos; confirm before commissioning the assets.
9. **The soak placeholder.** If the rc.8 soak fails again, the "Overhead" section needs the failure described rather than a table, and the two-failures section gains a third entry.

## Revision for DEV readers (2026-10-08)

The rc.8 text was accurate but addressed a reader who already runs Codex with Mistral Vibe on macOS. DEV's readers mostly use Claude Code, Cursor, Copilot or Codex, many build MCP servers, and almost none have Vibe, so the post was rewritten to pay them back whether or not they can install it. Every claim and number still comes from [evidence.md](evidence.md) with its conditions; the fact-check table above was not reopened because no new claim was added beyond what `README.md`, `docs/reference.md`, `docs/functionality.md` and `src/cli/codex.ts` state.

What changed:

1. **Angle.** The seven boundaries (verified read-only, patches from a throwaway worktree, no shell, honest stop reasons, restart survival, replies that name the next call, waiting inside the tool call) are now the structure, one H2 each, with vibe-supervisor as the worked example under every one. The feature-first sections ("A delegated review, seen from Codex", "Edits come back as a patch", "Guardrails") were folded into the checks they illustrate; the guardrail list and the "pieces" paragraph were merged to remove the overlap noted in finding 5.
2. **Hook.** The post opens on the 100-run soak that died on run 1 (27.4 s, the `<vibe_stop_event>` marker, exit 1, `VSUP_BACKEND_CRASHED`), taken from `docs/history/reviews/rc7-target-test-2026-10-07/Read.md` and `soak-failure-detail.json`. The two failures stay in check 4 with the 15.2 s retry and the cumulative-budget finding, and the section ends with the one transferable lesson.
3. **Title and tags.** "7 things to check before one coding agent hands work to another"; `showdev, mcp, ai, security`. Reasons are in [plan.md](plan.md#title-tags-cover). Codex, Mistral Vibe and MCP moved from the title to the description and the first paragraphs.
4. **Skimmability.** TL;DR card, numbered H2s, a "Steal this checklist" card, the result JSON (still shape-only, now showing a `max_turn_requests` stop so the snippet teaches check 4), the real `config.toml` entry `setup` writes (paths shortened; values from `src/cli/codex.ts`), the diagram, and the repository embed.
5. **Ending.** A question aimed at people who will never install it (how they know an agent only read), a second for people running sub-agents from other tools, the try/star/issue ask, and a Part 2 line (crash-safe supervisor, one end-of-run path, PID-reuse lock, 30.2 s to 2.6 s). The AI-assistance sentence closes the post.
6. **Cuts.** The supervisor-overhead table left the post (its headline number is promised for Part 2), the trade-offs list became one paragraph, and the alternatives sentence was shortened. Prose (cards and block quote included; front matter, table of contents, code and tables excluded) is about 2,400 words, roughly 100 over the 2,300 target; `wc -w` on the whole file is about 2,750. The next cut, if one is wanted, is the second half of check 4 or the config snippet's paragraph.

Still unsupported by evidence, and therefore not in the text: any claim that Vibe finds what Codex misses, any soak figure, any Codex CLI test, any client other than Codex, and token or cost savings. The `next_action` and warning strings in the JSON snippet are illustrative and labelled so; the real warning starts "Vibe stopped with stop reason" per `docs/reference.md`.

## Revision to invite development discussion (2026-10-09)

User direction: build interest in the development, using DEV recommendations and the prior expert review. Edited from merged main `87c6bf217add26cd34989b0526899e12ae5eabb7` in a separate managed checkout; the older primary checkout and its local changes were preserved. No commit, push, publication, installation or hosted inference was performed.

Changes:

1. The title and opening use the first failed soak, with its existing 27.4-second evidence. The central distinction is supervision vs task completion vs independent acceptance.
2. Architecture precedes implementation detail, and a complete verification/correction/close workflow replaces scattered instructions. The rc.13 early-close failure remains concrete.
3. Read-only claims now describe observations and blind spots, including the metadata optimization for Git-visible files. Worker shell restriction is a chosen boundary; coordinator-run tests introduce a separate execution risk.
4. Cumulative turn accounting, correct partial classification, source/worker prompt-injection risks and the stale rc.12 native process during rc.17 preflight are explicit. Fake-backend coverage is labelled near the watchdog/shutdown claims.
5. The changed soak acceptance contract is disclosed. Earlier failed pilots stay failed. Lifecycle reliability, task compliance and output correctness are separate evaluation questions; ten ACP jobs are not a migration proof for ninety programmatic jobs.
6. Release chronology, unsupported alternatives comparisons and free-credit predictions were removed. Existing dated timing/account observations keep their limits. No new benchmark or efficiency claim appears.
7. The ending names three bounded design areas and a concrete report format. Developers can inspect source and use fake tests without a provider account. Optional installation is collapsed, pinned, names `uv` and ends at setup dry-run.
8. Research and evidence records were updated. DEV's current AI-promotion restriction is preserved as a prepublication policy consideration, not asserted as resolved by an educational framing.

Before publication: author voice/accountability review; current DEV policy and truthful disclosure selection; public-link/repository-description confirmation; real editor preview of cards/details; refresh version/evidence if the candidate changes. Static Markdown checks do not establish rendering or installation. The full hosted soak, current native acceptance, callbacks, Intel and clean-account gates remain open.

Validation performed for this revision: git diff --check passed; all 48 local link targets and their heading fragments in the five edited documents resolved; four distinct pinned GitHub file/directory targets were validated against local Git objects; published: false, four tags, JSON parsing, code fences and paired card/details blocks passed static checks. Word count including front matter/code: 3,722 to 2,445 (34.3% reduction). No application tests, installed-package checks, hosted inference or actual DEV editor preview were run.
