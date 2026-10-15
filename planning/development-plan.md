# vibe-supervisor development plan

One plan for everything from here: shipping 2.0.0, 2.0.1, the 2.1 and 2.2 lines, the outreach that rides on them, and what never gets built. Written 2026-10-15; replaces the earlier 2.0 implementation plan. Not shipped.

The reasons behind it are in the [development strategy](../docs/development-strategy.md); the live status is in the [Handoff](../Handoff.md); the evidence behind each choice is in [marketing/strategy.md](../marketing/strategy.md), [marketing/interest.md](../marketing/interest.md), [research/features-2026-10-14.md](../research/features-2026-10-14.md) and [research/antigravity-2026-10-14.md](../research/antigravity-2026-10-14.md).

## 1. Where we are

| Item | State |
|---|---|
| 2.0.0 code, docs, version | On main at `4ade3fc`, merged and pushed 2026-10-15. `npm run verify:release` green on the exact merged tree under Node 20.19.0: 83 files, 1,244 tests, acceptance, secret scan, SBOM |
| 2.0.0 gates | `node-floor-20.19.0` passed locally; the nine target gates and the clean-account installation are open |
| 2.0.1 cleanup | Prepared on `claude/v2.0.1-cleanup` at `b76eda7`: history and other versions removed, `v1-*` renamed, version 2.0.1, a guard test against any trace of another version; `verify:release` green (84 files, 1,270 tests). Merges only after 2.0.0 is published |
| Target kit | `docs/history/v2-target-brief.md` and `scripts/v2-conformance-check.mjs` on main; the reusable form is `docs/target-acceptance.md` on the cleanup branch |
| Outreach | Drafts only: the dev.to article, the interest note's asks, the marketing calendar. Nothing posted |

## 2. The critical path and your touchpoints

| # | Step | Who | Your touchpoint |
|---|---|---|---|
| 1 | Package 2.0.0 from main: `package:rc` | Coordinator | **The populated npm cache path** |
| 2 | Run the target brief on the archive | Target agent | **Five authorizations, three hosted runs** |
| 3 | Record gate results in `acceptance.json`; merge | Target agent, Coordinator | Yes to merging the evidence branch |
| 4 | Clean-account installation of the same archive | You | **Do it** |
| 5 | Repo readiness | Coordinator prepares | **Decide the rename; run one `gh repo edit`** |
| 6 | Tag `v2.0.0`, publish the release | Coordinator prepares | **Authorize the publish** |
| 7 | Merge `claude/v2.0.1-cleanup`; conformance check and readiness on the target; tag `v2.0.1` | Coordinator, Target agent | **Yes to the merge; two authorizations; publish** |
| 8 | Delete stale branches and the leftover `v2-0-1` worktree | You | **Run the deletions** |
| 9 | 2.1 work starts | Agents | Scope reading for Antigravity |

Nothing else blocks 2.0.0 stable.

## 3. 2.0.0 to published

### 3.1 Package

- **Command:** read the path once, then package from main.

  ```bash
  read -r VIBE_SUPERVISOR_TEST_NPM_CACHE
  ```

  ```bash
  VIBE_SUPERVISOR_TEST_NPM_CACHE="$VIBE_SUPERVISOR_TEST_NPM_CACHE" npm run package:rc
  ```
- **What it does:** `verify:release`, then the offline installed-package smoke test. It never falls back to the network; an unpopulated cache fails it, which is the intended failure.
- **Record:** the archive SHA-256 in `acceptance.json` (`frozen_archive_sha256`, `packaging_time_snapshot` with the commit) and in the Handoff.
- **Already enforced:** nothing under `docs/history`, `docs/reviews`, `marketing/`, `research/` or `planning/` ships (`tests/unit/package-files.test.ts`).

### 3.2 Target run

The target agent follows the brief on that archive, stopping at the first failure.

| Brief step | Authorization | Gates |
|---|---|---|
| 1. Build and install next to the current prefix; switch the Codex registration | 1 | — |
| 2. `pin-manifest`, review it, `doctor` | 2 | pin half of the conformance check |
| 3. Conformance check with `--observe-network` | 3 | `target-no-inference-conformance-check`, config half of `permission-ask-visible-in-effective-config`, setting half of `thinking-off-effect`, `experiments-fetch-off` |
| 4. Native readiness | 3 | `native-readiness-on-candidate` |
| 5–6. One review (nested-write probe, reasoning watcher), one edit verified with the fixture script | 4: two hosted runs | `hosted-review-edit-confirmation`, handler half of `permission-ask`, effect half of `thinking-off-effect`, `nested-run-typescript-shape-and-gating` |
| 7. One observed MCP-client disconnect | 5: one hosted run | `mcp-client-disconnect-hosted` |

The same sitting answers the six open protocol questions in the Handoff. Evidence goes to `docs/reviews/v2-target-<date>/` with the placeholders from `docs/reviews/REDACTION.md`; passed gates move to `verified`. The target agent pushes a branch with `make push-branch`; the coordinator reviews and merges it.

**If the target finds something:**

| Failure | Shows as | Fix | Decides |
|---|---|---|---|
| Read-back key missing, cased or nested differently | `readback_mismatch` with fields | Correct the expectation from the observed shape and the source; rebuild | Coordinator; you approve the rebuild |
| Callback `relatedEntryId` only in `detail` | Every approval refused `unlinked_callback` | Read either place; rebuild | Coordinator |
| Approved effects lack `execute` / `ask` / `user` | Approved read fails `unapproved_effect` | Accept the observed triple only for ledger-linked handler approvals; rebuild | Coordinator; you approve |
| Unknown history entry kind | `unknown_entry_kind` | Add it if it cannot carry a call; rebuild | Coordinator |
| Legitimate `write_file` over the 8 MiB frame cap | `VSUP_OUTPUT_LIMIT` | Document, or raise within `limits.max_event_bytes` | You |
| Thinking stays on | Reasoning watcher count grows | Documented limitation (deleted at close) unless you reject it | You |
| Experiments request observed | `--observe-network` | Find the setting; rebuild if one exists, else document | Coordinator; you on documenting |
| Callback expires before 5 s | Callback error | Shorten the deadline; rebuild | Coordinator |
| `maxTurns` not enforced and `modelCalls` null | Review runs past its limit | Fail closed on missing `modelCalls` when a turn limit is set; rebuild | Coordinator |

A rebuild repeats 3.1 and restarts 3.2 from step 1; earlier evidence does not transfer. Budget for one.

### 3.3 Clean account, readiness, release

- **Clean account:** you install the same archive on a fresh standard macOS account and record `clean-account-install`.
- **Repo readiness:** decide the rename `codex-vibe` → `vibe-supervisor` (recommended before the first outreach post; GitHub redirects the old name). The coordinator prepares the description and nine topics as one `gh repo edit` command, a README top section with the limits and the independence line, and a social preview concept.
- **Release notes:** from the changelog's 2.0.0 entry plus install steps (Vibe 2.26.1 first, then the archive, `setup`, `pin-manifest`, `doctor`), the gates and their evidence, the limits in the same type size as the features, and the breaking change for 1.0 configurations.
- **Publish:** with your authorization, tag `v2.0.0` on the commit the archive came from; attach the archive and `SHA256SUMS`; check the downloaded assets against `acceptance.json`. Existing releases are never replaced or retagged.

## 4. 2.0.1: one version, no history

Prepared on `claude/v2.0.1-cleanup` (`b76eda7`). It moved first and then removed:
- **Moved:** the Vibe tag commit and a 57-file source hash table into `compatibility.md`; the evidence placeholders into AGENTS.md; the target procedure and disconnect steps into `docs/target-acceptance.md`; the article's story facts into `marketing/sources.md` with citations to commit `d360f28`.
- **Removed:** `docs/history/`, `docs/reviews/`, ADR 0003, the historical acceptance sections, the 1.0 upgrade notes, the changelog before 2.0.0, the saved-record special case, and every reference to another version.
- **Renamed:** the `v1-*` scripts and tests.
- **Guarded:** `tests/unit/no-legacy-references.test.ts` fails on any trace of another supervisor or Vibe version; three listed exceptions are Vibe's own wire value and two Vibe source paths.

**To release it, after 2.0.0 is published:**
1. Merge main into the branch first, so 2.0.0's target evidence and archive hash come along; summarise that evidence as one-line results in `acceptance.json` before the merge removes `docs/reviews/`. The raw evidence stays reachable at the `v2.0.0` tag.
2. `verify:release`, then merge into main with your yes.
3. `package:rc`; on the target, the conformance check and readiness only, no hosted inference, because 2.0.1 changes no run behaviour. Two authorizations.
4. Tag `v2.0.1`, publish.
5. You delete the stale branches (the list is in the Handoff), `claude/app-server-design`, `claude/v2.0.1-cleanup`, `claude/v2.0.1` and the `v2-0-1` worktree. `codex/unified-harness-v2` goes last, after 2.1 has ported the shipped manifest and the search sidecar.

**Open for you:** delete `.codex-plugin/` and `.mcp.json` in 2.0.1 and rebuild in the current Codex layout in 2.2 (recommended), or keep them.

## 5. 2.1: observable and measurable

Ranked by demand evidence, fit with the boundaries and effort in the features research. Every item gets a fixture test; items that touch a run get one hosted observation.

| # | Item | Size | Gate |
|---|---|---|---|
| 1 | Usage, ceilings and tool-call counts saved in every run record; shown by `runs list` | S | Fixture + one hosted run |
| 2 | `accepted` and `reason` on `vibe_close`; `runs usefulness` prints the log row, so the usefulness rate is measured | S | Fixture |
| 3 | `excluded_globs` per workspace, merged into the profile denylist and read back | S | Fixture + one hosted review |
| 4 | Findings schema for reviews: `findings.json`, optional SARIF export | M | Fixture + one hosted review |
| 5 | Search sidecar for reviews: a supervisor-owned, read-only MCP tool, replacing the listing as the way to find code | L | Needs the 2.0.0 evidence of how MCP tools appear; ADR; fixture + hosted review |
| 6 | `runs export` audit bundles | S | Fixture |
| 7 | Vibe candidate script and the wheel-derived shipped manifest | M | You authorize the wheel download; conformance check on the target |
| 8 | Antigravity as a verified MCP client: config docs, client-neutral skill wording, four gates (readiness and tool appearance, one review and one edit, a disconnect, approval latency against the receipt) | S docs + target | Your scope reading (documentation plus evidence, not new platform scope); an Antigravity account on the target |
| 9 | Per-language task templates in the skill | S | Review |

Order: 1, 2, 3 and 6 first (small, independent, disjoint files); 4 next; 7 when you authorize the download; 5 and 8 after the 2.0.0 target evidence.

## 6. 2.2: wider, still one path

- `allowed_write_paths` on edits.
- A per-root cost ledger surfaced as a readiness blocker.
- Linux, claimed only after a Linux pin manifest, conformance check, one review, one edit and one disconnect are recorded.
- MCPB bundle and registry entry; the Codex plugin in its current layout.
- A `runs` watch view.

## 7. Later and never

**Later, each behind its own trigger:** fixes from target evidence; the next Vibe release as a new candidate (revalidate wire facts, new manifest, conformance, one review, one edit; if the cadence becomes unaffordable, the pin policy is revisited openly, never relaxed silently); MCP Tasks when a client declares it; size-capped inline images; a single repair turn and `turn/steer`, each only through an ADR; a CI mode after Linux and an ADR; Antigravity as a worker only if Google documents ACP permission semantics, per-process configuration isolation, checksummed binaries, API-key authentication and a permissions read-back; byte-reproducible archives; the local CI branches once the `workflow` scope exists.

**Never**, each rejected by a line in AGENTS.md rather than by lack of demand: resume, replay or queueing; interactive or elicitation-based approvals; more than one active run per instance; shell-based search; a worker other than Vibe; automatic patch application; a Vibe version range.

## 8. Outreach, tied to the releases

You send everything personally; agents only draft.

| When | Action | Who |
|---|---|---|
| Now | Rename decision; description and topics | You |
| Now | Rewrite the Mistral Discussion for 2.0; draft three Bug Reports; write the private note for Mistral security; protocol feedback note; one-page brief; rewrite the Multica comment (it still describes the removed launcher), draft the Paperclip comment | Agents draft |
| Now | Send the private note to Mistral security; wait for a reply or two weeks | You |
| 2.0.0 stable | Publish the release notes and the article (apply its `[UPDATE AT PUBLISH]` list; pick dev.to's AI-assisted label); post the Discussion and Bug Reports with hosted evidence; Show and tell; Multica and Paperclip comments | You |
| 2.0.0 + 1 week | Show HN with the article link; Reddit and LinkedIn | You |
| 2.0.0 installable | Apply to the Codex open source fund | You |
| 2.0.1 | MCPB bundle and registry entry, awesome-list PR (agents build; you publish as org Owner) | Agents, you |
| 2.1 | Antigravity forum reply with the gate evidence; the reviewdog channel once SARIF ships; the usefulness rate published monthly | You |
| After 2.0.1 | Ambassador application, with the advocacy record | You |
| Monthly | Blog series pieces; CFP submissions | Agents draft, you publish |

The independence line ("an independent project, not affiliated with Mistral AI or OpenAI") goes in every public asset. Security claims always carry "application policy, not an OS sandbox".

## 9. How the work runs

- **Coordinator only:** merges, commits, pushes, packaging, tags, Handoff changes.
- **Agents:** named files, disjoint ownership, never stage or move files in Git, never write outside their worktree.
- **Checks gate on exit codes:** `cmd; echo exit=$?` or `&&`, never a `grep` of test output, which hides failures.
- **Fakes:** no credential that matches `/\bsk-[A-Za-z0-9_-]{24,}\b/`.
- **Files:** written with the Write tool, never with stdin heredocs; no aliased `ls`.
- **After each agent:** check for its leftover processes; forward any fact one agent finds that another needs.
- **Long agents:** write a usable first version early, so an interruption leaves something.
- **Vibe:** never run on the preparing machine; behaviour is proven only on the target.

## 10. Risks and measures

**Risks:**
- **A wire fact we guessed wrong:** every one fails closed, so the cost is a rebuild and a rerun.
- **Mistral changes or removes `vibe-app-server`:** each release pins one Vibe version, and a later Vibe release is a new candidate.
- **The hosted allowance runs out:** stop at the first failure and never retry.
- **The npm cache is not populated:** `package:rc` fails and nothing is published.
- **History removal loses something still needed:** the move-first step and the guard test cover it.
- **Antigravity churn and terms:** client only, verified per version, never "supported".

**Done means:**
- 2.0.0: zero `unverified` gates, and one archive SHA-256 matching across the target, the clean account and the release.
- 2.0.1: the guard test passes and no link is broken.
- Every release: `verify:release` is green on Node 20.19.0.
- 2.1 and later: each item has its fixture test and, where it touches a run, one hosted observation.
