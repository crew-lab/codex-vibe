# vibe-supervisor development plan

One plan for everything from here: landing the integrated 2.0.1 and 2.0.2 on main, packaging and proving them on the target, publishing them as the first 2.x releases, hardening and unifying the Antigravity execution backend, the 2.1 and 2.2 lines, the outreach that rides on them, and what never gets built. Written 2026-10-15 and revised on 2026-10-16 after the target sitting and on 2026-10-17 to reflect the 2.0.2 target evidence (`origin/codex/package-kit-identity`), the 2.1 Wave 0–3 implementation (`origin/claude/2.1-wave-1`), and the hardened Antigravity execution backend (`origin/explore_project_details`, since merged into main and deleted). Revised 2026-10-19 for the Antigravity cold review and the owner's decision to ship that backend in 2.1.0 as experimental and off by default ([6.2](#62-antigravity-cold-review-and-target-probes-2026-10-19)). Not shipped.

The reasons behind it are in the [development strategy](development-strategy.md); the live status is in the [Handoff](../Handoff.md); the evidence behind each choice is in [marketing/strategy.md](../marketing/strategy.md), [marketing/interest.md](../marketing/interest.md), [research/features-2026-10-14.md](../research/features-2026-10-14.md) and [research/antigravity-2026-10-14.md](../research/antigravity-2026-10-14.md). The [2.1 design sketches](2.1-designs.md) hold the long parts; published release notes live on their GitHub releases.

## 1. Where we are

Revised 2026-10-17 after the 2.0.1 disconnect verification, the 2.0.2 target packaging and readiness, the 2.1 Wave 0–3 implementation, and Phase 1 of the Antigravity execution backend hardening; the hosted results are in [research/evidence/hosted-2.0.1-2026-10-16/](../research/evidence/hosted-2.0.1-2026-10-16/REPORT.md) and the packaging results in [research/evidence/package-kit-identity-2026-10-15/](../research/evidence/package-kit-identity-2026-10-15/REPORT.md).

| Item | State |
|---|---|
| Main (2026-10-19) | 2.1.0, unreleased: the 2.0.2 line plus 2.1 Waves 0–5 and the experimental Antigravity backend with its cold-review fixes and agy probes; every branch above it is merged and deleted. `npm run verify:release`: 101 files, 1,477 tests; CI green |
| 2.0.2 archive | Packaged on the target under Node 20.19.0 from `347bf79` (archive `84bff9411b63188051a8ca7c025d362ac5a0f08b532f37dc0e9a01b9ba0f4437`, candidate/kit `eaa4032009dc7db754471b0be3c5de57f4d1d067baef0999d6664cfdc179c202`); side-by-side install, pin, `doctor`, `prepare check` PASS and native readiness passed; published as a pre-release |
| Antigravity status (2026-10-19) | Experimental, off unless `experimental.antigravity = true`; cold-review fixes and the agy probes on main; not for production until the five `antigravity-*` target gates pass ([6.2](#62-antigravity-cold-review-and-target-probes-2026-10-19)) |
| 2.0.1 archive | Packaged on the target from `44dc6f8` under Node 20.19.0: archive `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`, candidate and kit identity `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4` |
| Hosted allowance | Three starts authorized for the 2.0.1 sitting; all three used (review, edit, disconnect) |
| Target kit | `docs/target-acceptance.md` is the procedure; `package:rc` writes `preparation-kit-<version>/` beside the archive and installs the exact archive offline to prove the binding before it reports success |
| Outreach | Drafts only: the dev.to article, the interest note's asks, the marketing calendar. Nothing posted |

**Owner decision 2026-10-16:** worker answer quality is a documented limit; no further hosted allowance for the review and edit. v2.0.1 is published from the tested archive (`7978719c…`, tag at `44dc6f8`) as a pre-release while the clean-account installation is open; main's later changes go into 2.0.2. The notes are on the GitHub release; the publish commands are in the Handoff.

## 2. Delivered

| Milestone | Scope | Evidence |
|---|---|---|
| 2.0 engine | The app-server client, handoff re-validation, effect-bound approvals, the review file listing, the cold-review fixes | 83 files, 1,244 tests; `verify:release` on exactly Node 20.19.0 for that source |
| One version (2.0.1 cleanup) | No other version described or accepted, history out of the tree, neutral script names, the guard test, `docs/target-acceptance.md` | 84 files, 1,270 tests on main |
| Target repairs | Null harness provenance accepted; owned loopback managed-config endpoint ([ADR 0005](../docs/adr/0005-target-conformance-repairs.md)); Vibe's bundled skills permitted with provenance ([ADR 0006](../docs/adr/0006-bundled-vibe-skills.md)) | Workflow candidate's no-inference check |
| Workflow 1: acceptance and export | Frozen contracts on the exported patch; append-only assessments; `runs verify` and `runs export` | 1,256 tests, release checks, offline smoke |
| Workflow 2: observable preparation | Token, model-call, model and price observations; the version-matched kit and private receipt; readiness with workspace eligibility, candidate, preparation and expected-candidate drift; dispatch gated on the pass | 1,258 tests, release checks, offline smoke |
| Workflow 3: validation and coordination | Owned validation copies with offline dependency preparation; the main-chat coordinator and the evidence-backed fallback in the skill | 1,260 tests in 87 files; no-inference conformance and installed SDK readiness on the target |
| Integration | One line on main with both sets of work (`6c645e3`) | 88 files, 1,286 tests in `verify:release` on the pushed tree |
| Package and kit binding | Identity captured right after `npm pack`; the exact archive installed offline and compared with the kit before success (`44dc6f8`) | 89 files, 1,296 tests in `package:rc` on the target under Node 20.19.0; the corrected archive's conformance and native readiness |
| Execution provenance | The outcome kept through close as `execution_state`, `started_at` from the first running observation, the count-only `reasoning_observation` diagnostic (`2a49abd`) | 89 files, 1,305 tests |
| 2.0.1 disconnect & 2.0.2 target readiness (`origin/codex/package-kit-identity`) | 2.0.1 `mcp-client-disconnect-hosted` PASS (`347bf79`); 2.0.2 target archive `84bff941…` and kit `eaa40320…` packaged, installed, conformance-checked, and native-readiness verified (`a3c9631`) | Recorded on `origin/codex/package-kit-identity` (`6faee25`) |
| 2.1 Wave 0–3 (`origin/claude/2.1-wave-1`, `0d7119a`) | Items 1 (`usage.tool_calls`, ceilings, cross-session `runs list/show/tail`), 2 (`runs usefulness`), 3 (`excluded_globs`), and 6 (`approvals.json` ledger + `pin` in exports) | Recorded on `origin/claude/2.1-wave-1` (`0d7119a`) |
| 2.1 Wave 4: Review findings & SARIF (`origin/explore_project_details`) | Structured review findings (`output: "findings"`), `findings.json` artifact, workspace and exclusion safety validation (`src/core/findings.ts`), and SARIF 2.1.0 export (`src/core/sarif.ts`, `src/cli/runs/sarif.ts`) | 97 files, 1,433 tests passing |
| 2.1 Wave 5: Daily cost ledger & budgets (`origin/explore_project_details`) | Per-root daily spending limits (`budgets.<root>.max_cost_usd_per_day`), rolling 24h usage aggregation across standard and isolated runs (`src/core/usage-ledger.ts`), admission check with `VSUP_BUDGET_EXCEEDED`, and `runs usage` CLI (`src/cli/runs/usage.ts`) | 98 files, 1,441 tests passing |
| Antigravity Execution Backend Phases 1–3 (`origin/explore_project_details`) | `AntigravityBackend` (`src/backends/antigravity.ts`) revalidated and hardened for `agy 1.4.0`: isolated `HOME`/`TMPDIR`, strict unified `settings.json` policy, untrusted extension guard, watchdog activity, `boot_drift` tracking, structured `stream-json` envelope parsing, `PreToolUse` hook enforcing `judgeWorkspacePath` and emitting `approvals.json`, and zero-inference `prepare check` with slash-command read-backs and synthetic hook evaluations | Tests pass in `verify:release` on `origin/explore_project_details` |

Do not reschedule these as future work. Aggregated usefulness, SARIF, a daily cost ledger, per-root budgets, and the Antigravity backend are delivered on `explore_project_details`. Per owner decision 2026-10-17, feature expansion is frozen to focus on operational stability and target verification.

## 3. The critical path and your touchpoints

| # | Step | Who | Your touchpoint |
|---|---|---|---|
| 1 | Done: integration on main (`6c645e3`), pushed | — | — |
| 2 | Done: the owner deleted the v2.0.0 draft (2026-10-15) | — | — |
| 3 | Done: the reference package from `9d2bbde` on the preparing machine | — | — |
| 4 | Done: populated pnpm validation passed on a public fixture after fixing the lockfile check | — | — |
| 5 | Done on the target: 2.0.1 packaging from git (`44dc6f8`, archive `7978719c…`), installation, pin, `doctor`, one `prepare check` PASS, SDK and native readiness PASS; recorded in `docs/acceptance.json` | — | — |
| 6 | Done, rejected: the hosted review (answer quality); the hosted edit (its contract). Neither retried | — | — |
| 7 | Done on the target (`347bf79` on `origin/codex/package-kit-identity`): the MCP-client disconnect passed on the installed 2.0.1 archive | Target agent | — |
| 8 | Review and merge `origin/codex/package-kit-identity` (`6faee25`, carrying both 2.0.1 disconnect and 2.0.2 target readiness) | Coordinator | Yes to the merge and `make push` |
| 9 | Clean-account installation of the frozen archive (`docs/clean-account-checklist.md`) | You | **Do it, with the packet in 4.6** |
| 10 | Done 2026-10-16: worker answer quality is a documented limit; the tested archive from `44dc6f8` is published as v2.0.1 and main's later changes are 2.0.2 | — | — |
| 11 | Repo readiness: rename, description, topics | Coordinator prepares | **Decide the rename; run two `gh` commands** |
| 12 | Publish v2.0.1 as a pre-release from the target-held tested assets, with the commands in the Handoff; mark it latest once step 9 is recorded | You | **Run `gh release create` on the target Mac** |
| 13 | Done on the target (`1f906e8` on `origin/codex/package-kit-identity`): 2.0.2 packaged (`84bff941…`, candidate `eaa40320…`) under Node 20.19.0 | Target agent | — |
| 14 | Done on the target (`1f906e8` & `a3c9631` on `origin/codex/package-kit-identity`): 2.0.2 identity check, side-by-side install, pin and `doctor`, one `prepare check`, installed SDK readiness, registration switch with rollback and native readiness PASS | Target agent | — |
| 15 | Confirm the proposed carry-over in `docs/acceptance.json` (`6faee25`) and decide the optional hosted review for the reporting fix | You | **One decision; a new allowance only if you want the review** |
| 16 | Publish v2.0.2 from its checked target-held assets | You | Done 2026-10-17 (pre-release) |
| 17 | Phase 2 & 3 unification: merge `origin/claude/2.1-wave-1` and `origin/explore_project_details` after v2.0.2 is tagged | Agents, Coordinator | Scope reading for Antigravity; the wheel download |

Open decisions that do not block the release are in section 4.12. Steps 7 and 9 can overlap; step 11 can happen any time before the first outreach post. Steps 13 to 16 follow the v2.0.1 publish and need no hosted start; the disconnect (step 7) runs on the installed 2.0.1 archive, so the registration moves to 2.0.2 only after it is recorded.

## 4. 2.0.1 to published

### 4.1 Integrate (coordinator) — done

Landed as `6c645e3` and pushed. `git merge --no-ff 2e920d3` on `claude/integrate-workflow` (from `881464c`). The workflow line's product work is kept whole: `src/acceptance/`, `src/reporting/`, `src/preparation/`, `src/validation/`, `src/cli/prepare.ts`, `src/cli/validation.ts`, the managed-config endpoint and bundled-skill read-back, the run-manager, contract, serialization, CLI and MCP schema changes, the tests and the schemas; ADR 0005 and ADR 0006; `docs/preparation.md`, `docs/validation-workspace.md`, `docs/workflow-acceptance.md`. Main's rules are kept: version 2.0.1 everywhere, no `docs/history/` or `docs/reviews/`, neutral script names (the workflow's edit to `tests/v1-disconnect-client.test.mjs` landed on `tests/disconnect-client.test.mjs`), candidate names out of every scanned file. The evidence packet `docs/reviews/workflow-2026-10-15/` left the tree and is summarized in `docs/acceptance.json` (`evidence_builds`, the `workflow-candidate-*` entries); `docs/history/v2-target-brief.md` stays deleted, and its two amendments are in `docs/target-acceptance.md` (step 4 runs `prepare check`, the skills and managed-config criteria, the network rule, the owner's authorization clarification). Before the merge commit: lint, typecheck, build, the full suite, acceptance, secret scan, `git diff --check`, no unmerged path. The first full run failed one test under load (the fake server's wedge step signalled readiness before installing its signal handlers); the fixture now installs them first, and the rerun passed. No separate cold review of the merge diff was run; the merged code is the workflow line's own, verified on its candidate, and the resolution touched documents, versions and one fixture.

### 4.2 Package (coordinator, preparing machine)

Done as the reference build (`9d2bbde`). The archive under test was then packaged on the target from git, because archives are not byte-reproducible across machines; the identity record in `docs/acceptance.json` names that archive. The commands below remain the way to package a reference build.

Package in a detached worktree at the exact main commit that carries the integration, under Node 20.19.0, with the default cache. The worktree keeps main's checkout untouched.

```bash
read -r COMMIT   # the 40-hex main commit to package
cd <supervisor-repository> && git fetch origin && git merge-base --is-ancestor "$COMMIT" origin/main && git worktree add --detach .claude/worktrees/package-2.0.1 "$COMMIT"
```

```bash
cd <supervisor-repository>/.claude/worktrees/package-2.0.1 && git rev-parse HEAD && node --version && npm --version && npm ci && VIBE_SUPERVISOR_TEST_NPM_CACHE=<target-home>/.npm npm run package:rc; echo exit=$?
```

- **What it does:** `verify:release` (lint, typecheck, build, the suite, acceptance, secret scan, SBOM), then the offline installed-package smoke test, then `npm pack` with the cache, then the version-matched kit. It never falls back to the network.
- **Where outputs land:** `.claude/worktrees/package-2.0.1/release/`: `vibe-supervisor-2.0.1.tgz`, `sbom.spdx.json`, `acceptance.json` (the packaging-time report, not `docs/acceptance.json`), `SHA256SUMS` over those three, and `preparation-kit-2.0.1/` (`v2-conformance-check.mjs`, `manifest.json` with the candidate identity, `PROCEDURE.md`, its own `SHA256SUMS`). Copy them to the gitignored `release/2.0.1/` of the primary checkout before the worktree is removed:

```bash
mkdir -p <supervisor-repository>/release/2.0.1 && cp -Rp <supervisor-repository>/.claude/worktrees/package-2.0.1/release/vibe-supervisor-2.0.1.tgz <supervisor-repository>/.claude/worktrees/package-2.0.1/release/sbom.spdx.json <supervisor-repository>/.claude/worktrees/package-2.0.1/release/acceptance.json <supervisor-repository>/.claude/worktrees/package-2.0.1/release/SHA256SUMS <supervisor-repository>/.claude/worktrees/package-2.0.1/release/preparation-kit-2.0.1 <supervisor-repository>/release/2.0.1/
```

- **Check and compute the SHA-256**, each a separate exit code:

```bash
cd <supervisor-repository>/release/2.0.1 && shasum -a 256 -c SHA256SUMS; echo exit=$?
(cd preparation-kit-2.0.1 && shasum -a 256 -c SHA256SUMS); echo exit=$?
shasum -a 256 vibe-supervisor-2.0.1.tgz sbom.spdx.json acceptance.json SHA256SUMS preparation-kit-2.0.1/SHA256SUMS
jq -e '[.deterministic_checks[] | select(.status != "PASS")] | length == 0' acceptance.json; echo exit=$?
jq -r .generated_at acceptance.json
jq -r '.version, .candidate_sha256' preparation-kit-2.0.1/manifest.json
tar -xOzf vibe-supervisor-2.0.1.tgz package/package.json | jq -r .version
tar -tzf vibe-supervisor-2.0.1.tgz | grep -E '^package/(docs/(history|reviews)|marketing|research|planning)/'; echo "exit=$? (1 means nothing leaked)"
```

- **The archive and the kit are built once, together.** The archive's bytes are not reproducible: `dist/sbom.spdx.json` ships inside it and carries a creation time and a random namespace (`scripts/sbom.mjs`), and the kit's `candidate_sha256` hashes `dist`, so a rebuild gets a different identity and the old kit refuses it. Every later step uses this pair: the target installs it, the clean account installs it, the release attaches it.
- **Record on main** (coordinator, one commit by path, then `make push` with your yes): in `docs/acceptance.json` the top-level `frozen_archive_sha256` and `packaging_time_snapshot` for the `candidate`, 2.0.1, and the `node-floor-20.19.0` gate moved to `verified` as `PASSED_LOCALLY` for this exact source when the run was on exactly Node 20.19.0. Nothing reads these fields but humans and the coordinator's review; `scripts/acceptance.mjs` reads only `verified` and `unverified`.

```json
"frozen_archive_sha256": "<64 hex>",
"packaging_time_snapshot": {
  "version": "2.0.1",
  "source_commit": "<40 hex>",
  "report_sha256": "<64 hex of release/2.0.1/acceptance.json>",
  "generated_at": "<generated_at from that report>",
  "preparation_kit_candidate_sha256": "<candidate_sha256 from the kit manifest>",
  "preparation_kit_sums_sha256": "<64 hex of preparation-kit-2.0.1/SHA256SUMS>",
  "node": "20.19.0",
  "npm": "10.8.2",
  "verify_release": "<test files> test files, <tests> tests, from this run's output"
}
```

### 4.3 Target run (target agent, target machine)

Run on 2026-10-15 and 2026-10-16 with the target packaging its own archive instead of receiving one: steps 1 to 5 passed on the corrected archive, step 6 stopped at the rejected review, and the edit was reported later from an unmerged branch. Step 7, the disconnect, is authorized and next. The transfer and rebuild instructions below described the earlier plan to ship the preparing machine's archive.

**Transfer (you).** Copy `vibe-supervisor-2.0.1.tgz`, `SHA256SUMS` and the `preparation-kit-2.0.1/` directory from `release/2.0.1/` to the target by whatever private means you use, and tell the target agent the archive's SHA-256 and the kit's `candidate_sha256` from the Handoff.

**One checkout on the target** at the packaged commit, for the procedure, the scripts and the official client SDK, plus the installed archive:

```sh
read -r REPO_DIR   # the target's existing clone of the repository
read -r SRC        # a new directory for the packaged commit's worktree
read -r COMMIT     # the packaged commit from the Handoff
read -r EVIDENCE   # the evidence folder you name, outside every checkout
read -r ARCHIVE    # the copied vibe-supervisor-2.0.1.tgz
read -r EXPECTED   # the archive SHA-256 from the Handoff
read -r KIT        # the copied preparation-kit-2.0.1 directory, absolute
read -r CONFIG     # the selected config.toml the procedure uses
git -C "$REPO_DIR" fetch origin && git -C "$REPO_DIR" worktree add --detach "$SRC" "$COMMIT" && git -C "$SRC" rev-parse HEAD
test "$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)" = "$EXPECTED" && echo archive-match
(cd "$KIT" && shasum -a 256 -c SHA256SUMS) && echo kit-match
```

**Step 1 as written, with one change.** In `$SRC`: `npm ci`, `npm run verify:release` (keep the output for the node-floor gate if it ran under exactly Node 20.19.0) and `VIBE_SUPERVISOR_TEST_NPM_CACHE="$(npm config get cache)" npm run package:rc`. Record that build's SHA-256 as "target rebuild, not installed": it differs from the frozen archive by the SBOM bytes, and its kit does not match the frozen archive. Step 2 installs `$ARCHIVE`, never the rebuild:

```sh
read -r PREFIX     # a new private prefix next to the current install
npm install --ignore-scripts --offline --prefix "$PREFIX" "$ARCHIVE" && "$PREFIX/node_modules/.bin/vibe-supervisor" --version
```

**The conformance check runs against the installed bytes with the frozen kit**, so its evidence is about the frozen archive: `"$PREFIX/node_modules/.bin/vibe-supervisor" prepare check --kit "$KIT" --config "$CONFIG"`, then copy `preparation-reports/<report_sha256>.json` from beside the pin manifest to `$EVIDENCE/conformance.json`.

**The sitting**, stopping at the first failure:

| Procedure step | Authorization | Gates |
|---|---|---|
| 1. Build in `$SRC`; record the rebuild's SHA-256 | 1 | `node-floor-20.19.0` (target half, if Node is exactly 20.19.0) |
| 2. Install `$ARCHIVE`; `setup --dry-run`; switch the Codex registration | 1 | — |
| 3. `pin-manifest`, review it, `doctor` | 2 | pin half of the conformance check |
| 4. `prepare check` with the frozen kit | 3 | `target-no-inference-conformance-check`, config half of `permission-ask-visible-in-effective-config`, setting half of `thinking-off-effect`, the proxy half of `experiments-fetch-off` (the gate stays open without attribution) |
| 5. Native readiness with `expected_candidate` | 3 | `native-readiness-on-candidate` |
| 6. One review (probe, reasoning counts) and one edit with an acceptance contract, verified with the fixture verifier, closed with an assessment, exported | 4: two hosted runs | `hosted-review-edit-confirmation`, handler half of `permission-ask`, effect half of `thinking-off-effect`, `nested-run-typescript-shape-and-gating` |
| 7. One observed MCP-client disconnect | 5: one hosted run | `mcp-client-disconnect-hosted` |

Authorizations 1 to 3 are covered by the request itself when the sitting serves a Vibe implementation request (AGENTS.md, task authorization); otherwise each is a separate yes. The same sitting answers the open protocol questions in the Handoff; the agent writes each answer, with the observation behind it, into `$EVIDENCE/FINDINGS.md`. Placeholders from AGENTS.md ("Recording target evidence") apply to every file before it leaves the target. When the sitting ends, pass or stop, the agent writes a digest file into the folder:

```sh
cd "$EVIDENCE" && ! grep -rln '/Users/\|/home/' . && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS && shasum -a 256 SHA256SUMS
```

If the `grep` lists a file, replace its paths with the placeholders first; a raw-byte file whose hash is recorded elsewhere (the saved conformance report) keeps its bytes and is listed in `FINDINGS.md` with the reason, as AGENTS.md says. The last hash is the folder digest the gate entries cite. The raw evidence stays in that folder, outside the tree; you decide whether a redacted copy is ever published.

### 4.4 Recording the evidence (target agent, then coordinator)

**Branch.** `evidence/v2.0.1-target`, from main, in `$REPO_DIR`. It changes exactly two files, `docs/acceptance.json` and `docs/compatibility.md`, and is pushed with `make push-branch BRANCH=evidence/v2.0.1-target`. No code, no Handoff (the coordinator owns it).

**A verified gate**: `evidence_required` unchanged, `status` `VERIFIED`, `evidence` naming the files and their hashes instead of a tree path, and a one-line `result`:

```json
{
  "name": "target-no-inference-conformance-check",
  "status": "VERIFIED",
  "evidence_required": "<unchanged>",
  "evidence": "Owner's evidence folder v2.0.1-target-2026-10-NN, outside the tree, folder digest (sha256 of its SHA256SUMS) <64 hex>: conformance.json sha256 <64 hex> (the prepare check report_sha256), vibe-pin-manifest.json sha256 <64 hex>, doctor.json sha256 <64 hex>, FINDINGS.md sha256 <64 hex>.",
  "result": "PASS 2026-10-NN on the target (macOS arm64, Node 20.19.0, Vibe 2.26.1), archive sha256 <first 16 hex>, kit candidate <first 16 hex>: prepare check passed; read-back totals 0 before and after thinking for review and edit; bundled skills as ADR 0006; managed-config URL read back; shutdown clean, reaper stopped; pin verify 3 runs, median <n> ms; network none-observed-control-validated; findings: <none, or the warning kinds>."
}
```

**A gate that stays open** keeps `status` `UNVERIFIED` and gains a `result`: `"NOT EXERCISED 2026-10-NN: the model never attempted a write; not rerun."` or `"FINDING 2026-10-NN: reasoning count grew from 0 to 41 during the review; recorded, run completed."` The `prior_evidence` lines of the workflow candidate stay as they are. The agent also sets `delivery_requirements.hosted_allowance_remaining` to what is left (0 after three runs) and `updated_at`.

**`compatibility.md`.** Each verified gate leaves the "Unverified gates" table for a "Verified gates" table with the same one-line result; open gates keep their row with the finding appended.

**Words the guard test refuses.** `docs/acceptance.json` and `docs/compatibility.md` are scanned by `tests/unit/no-legacy-references.test.ts`. A result line must not contain `docs/history`, `docs/reviews`, a `v1-` name (write "the fixture verifier", "the disconnect client"), `rc.` with a digit, `1.0.0`, `1.0.1`, `programmatic`, `legacy-harness`, `vibe -p` or any Vibe version other than 2.26.1. `2.0.0`, `2.0.1`, the commit hashes and dates are fine.

**Before pushing**, in a main checkout with `npm ci` done: `npm run build && npm run acceptance; echo exit=$?` and `npx vitest run tests/unit/no-legacy-references.test.ts tests/unit/docs-links.test.ts; echo exit=$?`.

**The coordinator's review**, in this order, each check by exit code:

1. Scope: `git diff --name-only main...origin/evidence/v2.0.1-target` lists only the two files.
2. Shape: `jq -e . docs/acceptance.json` parses; every moved gate has `status`, `evidence_required`, `evidence`, `result`; `evidence_required` is byte-equal to main's (`jq` both sides and `diff`).
3. Identity: the archive SHA-256 prefix in every hosted and readiness result matches `frozen_archive_sha256`; the readiness result shows `server_version` `2.0.1` and the kit's candidate.
4. Completeness: each moved gate meets its row in the procedure's last table; nothing is `VERIFIED` on a partial observation; the hosted run count matches the allowance used (no retries).
5. Evidence: you copy the evidence folder to the preparing machine, into the gitignored `release/2.0.1/evidence/`; `shasum -a 256 -c SHA256SUMS` passes in it; the folder digest matches the one in the entries; `grep -rn '/Users/\|/home/'` finds nothing outside the listed raw-byte files; no readiness receipt value, credential or reasoning text appears (`npm run secret-scan` on the branch; a manual read of `FINDINGS.md`).
6. Findings: every warning kind and every answer in `FINDINGS.md` is either recorded in a result line or routed to section 4.5.
7. Checks: `npm run verify:release; echo exit=$?` on the merge result, then a cold review of the diff, then the merge and `make push` with your yes.
8. After the merge, the coordinator copies the answers into the Handoff's open questions and the observed wire facts into `compatibility.md` ("observed on the target, 2026-10-NN").

### 4.5 If the target finds something

Every row fails closed, so a finding costs a fix and a new sitting, never a silent pass. Paths are on main.

| Failure | Shows as | Fix: files and functions | Test to add | ADR | Decides |
|---|---|---|---|---|---|
| `prepare check` refuses the kit | "Preparation kit does not match installed candidate" | The kit and the archive came from different packaging runs: use the pair from one run. Never edit a kit | None | No | Coordinator |
| Read-back key missing, cased or nested differently | `readback_mismatch` with `details.fields` | Expectation in `src/backends/app-server/session-config.ts` `buildExpectation`; comparison in `src/backends/app-server/readback.ts` `compareReadback`; parse in `protocol.ts` `parseConfigEffectiveReadResult`. Check the same fact at its observed location | Observed shape in `tests/fixtures/fake-vibe-app-server.mjs` and a scenario; the old shape now fails in `tests/unit/app-server-readback.test.ts` | No; yes if a fact can no longer be read back and would be dropped | Coordinator; you approve the new sitting |
| The skill catalogue differs from ADR 0006 | `readback_mismatch` on `runtime.skills` | `src/backends/app-server/bundled-skills.ts` changes only with an amended ADR 0006 | Allowed and refused entries in `tests/unit/app-server-readback.test.ts` | Yes: amend 0006 | You |
| Managed-config endpoint not read back, or bind fails | `readback_mismatch` on the base URL, or a start error before spawn | `src/backends/app-server/managed-config.ts` and its wiring in `src/backends/app-server.ts`; never a remote fallback or an invalid URL as a switch | `tests/unit/app-server-managed-config.test.ts` | Yes if the isolation changes | Coordinator drafts; you approve |
| A subject network request observed | `prepare check` fails, verdict `requests-observed` | A 2.26.1 setting that stops it goes into `RUNTIME_SETTINGS` in `session-config.ts` (the read-back follows); if none exists, `docs/security.md` says so and you decide whether the profile is still usable | Environment and expectation contain the setting in `app-server-session-config.test.ts` | No; yes if a request is accepted | Coordinator; you on accepting |
| Callback `relatedEntryId` only under `detail` | Every approval refused, `unlinked_callback` | `src/backends/app-server/protocol.ts` `callbackSchema` and the `callback/call` parser read `detail.relatedEntryId` when the top level is null; `approvals.ts` keeps `unlinked_callback` when both are absent | Both placements parse equal in `app-server-protocol.test.ts`; detail-only link approved, no link denied in `app-server-approvals.test.ts` | No | Coordinator |
| Approved effects lack `execute` / `ask` / `user` | First approved read fails `unapproved_effect` | `src/backends/app-server/events.ts`, the approval-metadata check in the effect validator: accept the observed triple only for an effect linked to the handler's own ledger record with equal fingerprint, tool and turn | Observed triple plus ledger link passes, without link fails, in `app-server-events.test.ts`; a scenario in `tests/fixtures/app-server-scenarios/` | Yes: it changes what the event validator counts as approved | Coordinator drafts; you approve |
| Unknown history entry kind | `unknown_entry_kind` naming the kind | `protocol.ts` `parseHistoryEntry` gains a case; `events.ts` ignores it only if its schema cannot carry a tool call or effect | A scenario with the kind in the history and in `history/entryAdded` | No if it cannot carry a call; yes if it can | Coordinator |
| Legitimate `write_file` over the 8 MiB frame cap | `VSUP_OUTPUT_LIMIT` (`line_too_long`) | Document the limit in `docs/reference.md`, or derive the line cap from `limits.max_event_bytes` (bounded above) in `src/backends/app-server.ts` (`MAX_LINE_BYTES`) and `jsonrpc.ts` | Frame at the new cap passes, one byte over fails, in `app-server-jsonrpc.test.ts` | No | You |
| Thinking stays on | `reasoning_observation` reports positive `streamed_entries` or `history_entries` | Documentation only: `docs/security.md` and `docs/compatibility.md` say reasoning is generated and held in the throwaway store until close | None | No | You |
| Callback expires before 5 s | Callback error before the verdict | `DEFAULT_DECISION_DEADLINE_MS` in `src/backends/app-server/approvals.ts` below the observed expiry; AGENTS.md's "5-second deadline" wording follows | Deadline test at the new value; `approval-stall.json` scenario | No (shorter); the AGENTS.md line is your edit | Coordinator |
| `maxTurns` not enforced and `modelCalls` null | A review runs past its limit | `checkBudget` in `src/backends/app-server/usage.ts` and the start sequence in `src/backends/app-server.ts` fail closed when the first statistics carry no model-call count; if Vibe never reports one, every run fails, so the real fix counts model calls from history | `stats-usage.json` variant with null `modelCalls` | No | Coordinator |
| The real install fails the pin (`file-extra`, `file-unsafe`) | `doctor` or the conformance check refuses | Covered-directory rules in `src/backends/app-server/pin.ts`, only for files Vibe itself writes after install, named exactly | A fixture environment with that file in `app-server-pin.test.ts` | No if exact; yes if a directory is excluded | Coordinator; you approve |
| The worker group survives a disconnect | Observer shows a live owned process | `src/process/reaper.ts` and the cleanup path in `src/backends/app-server.ts` | `tests/integration/active-disconnect.test.ts` case reproducing it | No | Coordinator |
| An acceptance check disagrees with the independent verifier | Contract `failed` or `incomplete` on a patch the verifier passes, or the reverse | The contract or the check in `src/acceptance/verify.ts`; the assessment records the correction, never an overwrite | A case in `tests/unit/acceptance.test.ts` | No | Coordinator |

**What a code fix means.** The fix lands on main as a new commit; section 4.2 packages a new archive and kit; the sitting runs again on them. Gates whose evidence the fix cannot touch may be carried over only by your recorded decision, as a `decision` field on the gate naming the old archive and the `git diff` that justifies it. Rows decided as "document" do not need a new archive if only documentation changes; the release notes state the finding under the limits.

### 4.6 Clean account (you)

On a new standard macOS account on an Apple silicon Mac, with the archive copied into it. The packet records into one file in that account; read it, replace the account's home path with `<target-home>`, and keep it with the target evidence.

```sh
read -r ARCHIVE    # absolute path of vibe-supervisor-2.0.1.tgz in this account
read -r EXPECTED   # the archive SHA-256 from the Handoff
REC="$HOME/clean-account-2.0.1.txt"
{ date -u; sw_vers; uname -m; node --version; npm --version; git --version; } | tee "$REC"
test "$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)" = "$EXPECTED" && echo archive-match | tee -a "$REC"
PREFIX="$HOME/.local/vibe-supervisor-2.0.1"
npm install --ignore-scripts --prefix "$PREFIX" "$ARCHIVE" 2>&1 | tail -3 | tee -a "$REC"
VSUP="$PREFIX/node_modules/.bin/vibe-supervisor"
"$VSUP" --version | tee -a "$REC"
mkdir -p "$HOME/vsup-check" && git -C "$HOME/vsup-check" init -q && git -C "$HOME/vsup-check" -c user.name=check -c user.email=check@invalid commit -q --allow-empty -m base
CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
"$VSUP" allow --config "$CONFIG" "$HOME/vsup-check" 2>&1 | tee -a "$REC"
"$VSUP" pin-manifest --config "$CONFIG" 2>&1 | tee -a "$REC"
"$VSUP" doctor --config "$CONFIG" --json > "$HOME/doctor.json"; echo "doctor exit=$?" | tee -a "$REC"
"$VSUP" setup --workspace "$HOME/vsup-check" --config "$CONFIG" --codex user --dry-run 2>&1 | tee -a "$REC"
"$VSUP" setup --workspace "$HOME/vsup-check" --config "$CONFIG" --codex user --yes 2>&1 | tee -a "$REC"
```

- If Vibe 2.26.1 is installed in the account (`uv tool install mistral-vibe==2.26.1`, the README's first step), `pin-manifest` writes the manifest and `doctor` passes its pin check; if not, both fail with `VSUP_VIBE_NOT_FOUND`, which you record: the gate is about the supervisor's installation, not Vibe's. Without a preparation pass, readiness reports the preparation blocker; that is expected here and recorded.
- Open Codex in the account, confirm the five tools are listed and run one `vibe_status` readiness check on `~/vsup-check` (no run, no inference). Note `server_version` and `candidate` in the record.
- **Rollback:** restore the Codex configuration from the backup `setup --yes` printed (or delete the `[mcp_servers.vibe-supervisor]` block if the file was new), restart Codex, confirm the tools are gone. **Cleanup:** `rm -rf "$PREFIX" "$HOME/Library/Application Support/VibeSupervisor-oneshot" "$HOME/vsup-check"`, then delete the account.
- **The gate entry** (the coordinator writes it from your record):

```json
{
  "name": "clean-account-install",
  "status": "VERIFIED",
  "evidence_required": "<unchanged>",
  "evidence": "Owner's record clean-account-2.0.1.txt sha256 <64 hex>, kept with the target evidence.",
  "result": "PASS 2026-10-NN: new standard macOS <version> arm64 account, Node <version>; archive sha256 <first 16 hex> matched; installed into a private prefix with --ignore-scripts; --version 2.0.1; allow, pin-manifest and doctor <pass, or Vibe absent as recorded>; setup previewed then written with a backup; Codex listed five tools and readiness answered 2.0.1; rollback restored the backup; prefix, data root and account removed."
}
```

### 4.7 Repo readiness (you run, coordinator prepares)

- **Rename** (recommended before the first outreach post; GitHub redirects the old name and old clones keep working):

```bash
gh repo rename vibe-supervisor --repo crew-lab/codex-vibe --yes && git -C <supervisor-repository> remote set-url origin https://github.com/crew-lab/vibe-supervisor.git && git -C <supervisor-repository> remote -v
```

- **Description and nine topics**, from the outreach draft (commit `d360f28`, `docs/history/outreach-drafts.md`, section 2):

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && gh repo edit "$REPO" --description "Local MCP server that lets Codex delegate one bounded review or one isolated edit to Mistral Vibe 2.26.1. Edits run in a detached Git worktree and return a patch that is never applied. Shell and network tools are off. macOS Apple silicon only. Application policy, not an OS sandbox." --add-topic mcp --add-topic mcp-server --add-topic model-context-protocol --add-topic codex --add-topic mistral --add-topic mistral-vibe --add-topic code-review --add-topic git-worktree --add-topic coding-agents
```

- **README top section** (coordinator, on main, so it ships in 2.0.1): the limits in the first paragraph, the independence line ("an independent project, not affiliated with Mistral AI or OpenAI"), the install steps from the release notes including the kit, and "verified on the target" only for gates that are `VERIFIED`. A social preview concept goes into `marketing/` as text; you upload any image.

### 4.8 Release (coordinator prepares, you publish)

**Release notes.** The coordinator wrote `release/2.0.1/release-notes.md` (outside the tree) for 2.0.1, adds the 2.0.1 changelog entry's features (acceptance contracts, reports, the preparation kit and how to run `prepare check`, validation copies, the two target repairs), fills every `[FILL]` from the merged `docs/acceptance.json` and the evidence, says that v2.0.0 was not released and why, and deletes the template's instructions block.

**Three more assets**, after the evidence branch is merged: the kit as one archive, the evidence summary and the asset checksums.

```bash
cd <supervisor-repository>/release/2.0.1 && tar -czf preparation-kit-2.0.1.tar.gz preparation-kit-2.0.1; echo exit=$?
```

```bash
cd <supervisor-repository> && read -r COMMIT && jq --arg sha "$(shasum -a 256 release/2.0.1/vibe-supervisor-2.0.1.tgz | cut -d' ' -f1)" --arg commit "$COMMIT" --arg evidence_commit "$(git rev-parse origin/main)" '{schema_version: 1, version: "2.0.1", tag: "v2.0.1", source_commit: $commit, archive_sha256: $sha, evidence_record: ("docs/acceptance.json at " + $evidence_commit), verified: [.verified[] | {name, status, result}], open: [.unverified[] | {name, status, result}], hosted_allowance_remaining: .delivery_requirements.hosted_allowance_remaining, packaging_report_note: "The acceptance.json asset is the packaging-time report; this file records the later target results for the same archive, which was not rebuilt."}' docs/acceptance.json > release/2.0.1/release-evidence.json; echo exit=$?
```

```bash
cd <supervisor-repository>/release/2.0.1 && shasum -a 256 vibe-supervisor-2.0.1.tgz sbom.spdx.json acceptance.json SHA256SUMS preparation-kit-2.0.1.tar.gz release-evidence.json | jq -R -s '{tag: "v2.0.1", algorithm: "sha256", assets: (split("\n") | map(select(length > 0) | capture("^(?<sha256>[0-9a-f]{64})  (?<name>.+)$")))}' > asset-checksums.json; echo exit=$?
```

`SHA256SUMS` stays exactly as `package:rc` wrote it; `asset-checksums.json` covers the later files.

**Publish (you).** A draft first, so the assets can be checked before anything is public. The target commit must be on main's history:

```bash
cd <supervisor-repository> && read -r COMMIT && git fetch origin && git merge-base --is-ancestor "$COMMIT" origin/main && echo on-main
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && REL=<supervisor-repository>/release/2.0.1 && gh release create v2.0.1 --repo "$REPO" --draft --target "$COMMIT" --title "vibe-supervisor 2.0.1" --notes-file "$REL/release-notes.md" "$REL/vibe-supervisor-2.0.1.tgz" "$REL/sbom.spdx.json" "$REL/acceptance.json" "$REL/SHA256SUMS" "$REL/preparation-kit-2.0.1.tar.gz" "$REL/release-evidence.json" "$REL/asset-checksums.json"
gh release view v2.0.1 --repo "$REPO" --json isDraft,assets --jq '.isDraft, (.assets[] | "\(.digest)  \(.name)")'
```

Compare the printed digests with `asset-checksums.json`; then publish. GitHub creates the lightweight tag `v2.0.1` at the target commit on publish:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && gh release edit v2.0.1 --repo "$REPO" --draft=false --latest
```

**After publishing** (coordinator or you):

```bash
cd <supervisor-repository> && read -r COMMIT && git fetch origin --tags && test "$(git rev-parse v2.0.1^{commit})" = "$COMMIT" && echo tag-ok
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && CHECK=$(mktemp -d) && gh release download v2.0.1 --repo "$REPO" --dir "$CHECK" && cd "$CHECK" && shasum -a 256 -c SHA256SUMS && test "$(shasum -a 256 vibe-supervisor-2.0.1.tgz | cut -d' ' -f1)" = "$(jq -r .frozen_archive_sha256 <supervisor-repository>/docs/acceptance.json)" && echo archive-matches-record
```

Then on main (coordinator, by path, `make push` with your yes): the Handoff's release identity says "published", the 2.0.1 changelog line "Unreleased" becomes the date and the link, and the 2.0.0 entry's release sentence says it was not released. Existing releases are never replaced or retagged; a wrong asset means a new patch release, not an edit of the old one.

### 4.9 The v2.0.0 draft (you) — done

Deleted by the owner on 2026-10-15. The options below are kept as the record of the decision.

It is a private draft, so it has no tag yet and nobody outside sees it. Two ways, your choice:

- **Delete it (recommended).** Nothing references it; the archive stays in `release/2.0.0/` for the record and the commit stays in main's history.

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && gh release view v2.0.0 --repo "$REPO" --json isDraft --jq .isDraft && gh release delete v2.0.0 --repo "$REPO" --yes
```

- **Leave it unpublished.** It costs nothing, but anyone with access may publish it by mistake, and it ships a runtime that cannot start a run on the supported Vibe.

Publishing it as a pre-release is not recommended: its notes would have to say that every start fails before the first turn.

### 4.10 Branches and worktrees — done

GitHub holds `main` only. Every remote branch was checked as an ancestor of `origin/main` and then deleted, the workflow branch last, after `6c645e3` reached main. Locally, the leftover worktrees and every branch merged into main are removed; the CI branches went with them, and their commits stay reachable in main's history (`59eb988`). To recreate CI once the push token has the `workflow` scope, branch from main and restore `.github/` from `8904c13`.

### 4.11 The plugin scaffold: your call

Decided 2026-10-15: deleted; rebuilt in 2.2.

`.codex-plugin/plugin.json` (legacy layout, version in lockstep with `package.json`) and `.mcp.json` (a disabled `node ./dist/cli.js serve --stdio --isolated` entry) are outside the npm package, so neither path changes an archive.

- **Delete now, rebuild in 2.2 (recommended).** One commit on main before 2.0.1 is packaged: delete both files; in `tests/unit/version.test.ts` drop the case "keeps the plugin manifest literal equal to package.json"; in `tests/integration/lazy-startup-retention.test.ts` drop the two `.mcp.json` lines and " and matches .mcp.json" from the test name (the timeouts stay asserted against the written Codex entry); the scaffold sentence in `docs/compatibility.md` and the Handoff's known limits go; the 2.0.1 changelog entry gains "The unverified Codex plugin scaffold is removed; Codex plugin packaging returns in 2.2 in the current layout." 2.2 builds the root `plugin.json` with `extensions.com.openai` and the `.agents/plugins/marketplace.json` the interest note describes, with an install gate on the target.
- **Keep.** Nothing changes now; `version.test.ts` keeps the version in step at every bump; the documents keep calling it an unverified scaffold; 2.2 migrates it instead of creating it. Cost: a file in a fallback layout that no one has installed, shown in the repository root during the outreach weeks.

### 4.12 Open decisions and small leftovers

| Item | Recommendation | Who |
|---|---|---|
| The private project name in history: `marketing/strategy.md` named it in commit `2e920d3`, now in main's history; the current tree uses `<site-project>` | Leave history as it is unless the name is sensitive; a rewrite of public `main` breaks every clone | You |
| Authorizations when a sitting serves an implementation request (`docs/target-acceptance.md`): authorizations 1 to 3 treated as given; a standalone release sitting asks for each; hosted runs always need an allowance | Confirm | You |
| The preparation kit as a release asset beside the archive, so release installs can dispatch | Yes; section 4.8 lists it | You confirm |
| Code comments in the workflow line's source (`bundled-skills.ts`, `managed-config.ts`, `cli/prepare.ts`, `validation/workspace.ts`, `scripts/package-rc.mjs` and others) against the no-comments rule | Done 2026-10-15: removed; the two facts without a home are in `docs/preparation.md` and `docs/workflow-acceptance.md` | Coordinator |
| A site-specific example value in `docs/workflow-acceptance.md` | Done 2026-10-15: replaced with a neutral example | Coordinator |
| Release-candidate story lines in `marketing/strategy.md` (for example "rc.15 and rc.16") | Keep as dated story material or reword; unshipped, not guarded | You |

## 5. One coordinator workflow

1. The main chat establishes task scope, the immutable base, exact assertions, manual validation IDs and the hosted budget. An implementation request using Vibe already covers its necessary scoped preparation; preserve settings and rollback.
2. Check the actual connection and candidate (`expected_candidate`). Diagnose a deterministic preparation failure, repair the candidate, and verify the changed artifact. Do not repeat an unchanged failure or substitute the fallback implementer for an infrastructure problem.
3. Start the bounded Vibe task once. Preserve the original output and allowance. Vibe's own pinned bundled skills are allowed; skills never expand tools or roots.
4. Independently verify exported bytes, hashes and deterministic assertions. A concise final message is not evidence of missing code. Completed execution and an automated pass do not by themselves mean coordinator acceptance.
5. Prepare owned validation copies; run the declared checks deliberately. Export sanitized reports and record the decision. Correct a mistaken decision by appending, preserving who made the error.
6. Use GPT-6 Luna/high only for an evidence-backed implementation failure, within the authorized fallback scope. Attribute Vibe and fallback changes separately. Extra hosted starts need explicit remaining allowance. Integration and remote delivery keep the user's scope and authorization.

The `<site-project>` run showed why step 4 matters: Vibe's exact patch contained the disclosure that its summary abbreviated. The initial rejection was a review error; no fallback edits reached the accepted website patch. The generic regression is now automated; that historical result does not certify a different supervisor build. Its pull request and the first-visit consent overlap it exposed are separate tasks in that repository, each with its own authorization.

## 6. 2.1: observable and measurable

Ranked by demand evidence, fit with the boundaries and effort in the features research. Every item gets a fixture test; items that touch a run get one hosted observation. The design of each, with data shapes, files, tests, gate entries, size and dependencies, is in the [2.1 design sketches](2.1-designs.md); the status column says what 2.0.1 and `origin/claude/2.1-wave-1` (`0d7119a`) already deliver.

| # | Item | Status as of 2026-10-17 | Remaining | Size | Gate | ADR |
|---|---|---|---|---|---|---|
| 1 | Usage, ceilings and tool-call counts in every run record; `runs list` covers isolated sessions | **Done on `origin/claude/2.1-wave-1` (`0d7119a`) & `origin/explore_project_details`**: `usage.tool_calls` populated for both backends, `max_tokens`/`max_cost_usd`/`max_model_calls`, cross-session `runs list/show/tail` | Merge after 2.0.2 tag | S | Fixture + the 2.1 hosted review | No |
| 2 | Recorded decisions and `runs usefulness` | **Done on `origin/claude/2.1-wave-1` (`0d7119a`)**: `runs usefulness [--config] [--since] [--json]` over assessments | Merge after 2.0.2 tag | S | Fixture + the 2.1 hosted close | No |
| 3 | `excluded_globs` per allowed root, merged into the profile denylist, the handler and the listing, read back | **Done on `origin/claude/2.1-wave-1` (`0d7119a`) & `origin/explore_project_details`**: validation, session config, approvals (`path_excluded`), workspace listing, conformance `--excluded-glob`; wired into `AntigravityBackend` listing and `settings.json` `permissions.deny` | Merge after 2.0.2 tag | S | Fixture + the 2.1 hosted review | No |
| 4 | Findings for reviews: `output: "findings"`, `findings.json`, `runs sarif` | **Done on `origin/explore_project_details`**: `output: "findings"` parameter, schema & contracts, snapshot & exclusion validation, `findings.json` artifact, SARIF 2.1.0 conversion with stable rule fingerprints, and `runs sarif <run-id>` CLI subcommand | Merge after 2.0.2 tag | M | Fixture + the 2.1 hosted review | No |
| 5 | Daily cost ledger & usage aggregation | **Done on `origin/explore_project_details`**: `budgets.<root>.max_cost_usd_per_day`, rolling 24-hour usage aggregation across standard and isolated session runs (`src/core/usage-ledger.ts`), admission gating failing closed with `VSUP_BUDGET_EXCEEDED` and surfacing in readiness, and `runs usage [--since] [--root] [--json]` (`src/cli/runs/usage.ts`) | Merge after 2.0.2 tag | S | Fixture + the 2.1 hosted review | No |
| 6 | Audit bundles with the approval ledger | **Done on `origin/claude/2.1-wave-1` (`0d7119a`) & `origin/explore_project_details`**: `approvals.json` saved per run (`truncated` boolean) and `pin` included in `runs export`; `approvals.json` ledger emitted for `AntigravityBackend` via `PreToolUse` hook | Merge after 2.0.2 tag | S | Fixture + one exported hosted run | No |
| 7 | Vibe candidate script and the wheel-derived shipped manifest | Frozen / deferred per owner decision 2026-10-17 | Deferred | M | Your yes to the wheel download; conformance check on the target | No |
| 8 | Antigravity as a verified MCP client: docs, client-neutral skill wording, four gates | Reference config documented; hosted gates ride operational validation | Target validation | S docs + target | Your scope reading; an account on the target; three hosted runs | No |
| 9 | Per-language task templates in the skill | Handled in skill guidance and task prompts | Complete | S | Review | No |
| 10 | Antigravity execution backend hardening and 2.1 parity | **Phases 1, 2 & 3 Done on `origin/explore_project_details`**: Phase 1 `agy` CLI flag & permission hardening, private `HOME`/`TMPDIR` + `settings.json`, untrusted extension guard, watchdog & `boot_drift`, `stream-json` envelope parsing; Phase 2 `excluded_globs` wired into listing & `settings.json`, `usage.tool_calls` populated, `PreToolUse` hook enforcing `judgeWorkspacePath` and emitting `approvals.json`; Phase 3 revalidated against `agy 1.4.0` (binary SHA-256 pin, unified rule syntax, zero-inference `prepare check` with slash-command read-backs and synthetic hook evaluations, ADR 0008, acceptance gates); target no-inference conformance gate `antigravity-backend-no-inference-check` VERIFIED (`3bb58cb`) | Complete on `explore_project_details`, ready for merge after 2.0.2 release | M | Fixture + target acceptance | Yes (0008) |

**Status 2026-10-17.** Primitives 1, 2, 3 and 6 are implemented on branch `claude/2.1-wave-1` (waves 0 to 2 in `404b801`, `f6c852e` and `e4c1608`), and items 1, 3, 4, 5, 6, and 10 are implemented and verified on `explore_project_details` (1,441 tests passing).

**Owner strategic decision — 2026-10-17: Pivot from feature expansion to operational stability ("Working ASAP").**
The owner decided on 2026-10-17 to halt the exploratory feature run (deferred: wheel candidate extraction scripts, review search sidecar, outreach and task template pipelines). The 2.1 line is frozen at the delivered Waves 0–5 and Antigravity execution backend capabilities. The strategic priority is to see the system working end-to-end immediately:
1. Target-level zero-inference conformance validation on the local `agy 1.4.0` installation (`antigravity-backend-no-inference-check`).
2. Live operational verification of real review and edit delegation on the target machine with verified hook enforcement and clean exports.
3. Branch convergence (`origin/codex/package-kit-identity`, `origin/claude/2.1-wave-1`, `origin/explore_project_details`) into main.
4. Stable, predictable everyday use with the active MCP tools.

### 6.1 Antigravity Execution Backend Hardening & 2.1 Unification Plan (Phases 1–3)

#### Phase 1 — CLI Compatibility, Permission Hardening, and Lifecycle Alignment (Completed on `origin/explore_project_details`)

1. **Fix `agy 1.3.1` CLI Invocation & Remove Permission Bypass (`src/backends/antigravity.ts`)**:
   - Removed the non-existent `--cwd` flag (relying on `spawn(..., { cwd: input.workerWorkspace })` and `--add-dir <workerWorkspace>`) and removed `--dangerously-skip-permissions`.
   - Added `--disable-slash-commands`, `--sandbox`, and `--print-timeout <timeoutSeconds>s`.
2. **Per-Run Private `HOME`/`TMPDIR` and Strict `settings.json` Policy (`src/backends/antigravity.ts`, `src/core/run-manager.ts`)**:
   - Created private per-run `antigravity-home` (`HOME`) and `antigravity-tmp` (`TMPDIR`) inside `input.runDir`, cleaned up automatically at run completion/close and by `removeLeftoverPrivateState()` on crash recovery.
   - Wrote `$HOME/.gemini/antigravity-cli/settings.json` before spawning `agy` with `toolPermission: "strict"`, `enableTerminalSandbox: true`, `allowNonWorkspaceAccess: false`, mode-scoped `permissions.allow` (`read_file`, `view_file`, `list_dir`, `grep_search`, `find_by_name` for reviews; plus `write_file`, `edit_file`, `replace_file_content`, `multi_replace_file_content` for edits), and `permissions.deny` blocking `bash`, `run_command`, `web_fetch`, `web_search`, `browser`, `mcp`, and reserved/secret globs (`.git/**`, `.vibe/**`, `.gemini/**`, `.agents/**`, `.env*`, `*.pem`, `*.key`).
3. **Reject Untrusted Project `.gemini` and `.agents` Extensions (`src/security/workspace-guard.ts`, `src/core/run-manager.ts`)**:
   - Added `assertNoProjectAntigravityExtensions(root)` in `src/security/workspace-guard.ts` and wired it into `RunManager.validateAdmission()` when `backend === "antigravity"`, failing closed with `VSUP_WORKSPACE_INVALID` if `.gemini`, `.agents/hooks.json`, `.agents/mcp_config.json`, or `.agents/plugins` exist.
4. **Wire Watchdog Progress & Boot-Bound Policy Drift (`src/core/run-manager.ts`, `src/config/config.ts`, `src/config/policy.ts`)**:
   - Updated `callbacks.onEvent` in `src/core/run-manager.ts` so `"antigravity"` events call `this.noteActivity(...)` alongside `"vibe"`.
   - Added `backend` and `paths.antigravity` to `configFingerprint()` and `BOOT_BOUND_SETTINGS` so changing either surfaces `boot_drift` and `restart_required: true`.
5. **Parse `stream-json` Envelope Metadata & Align Review Context (`src/backends/antigravity.ts`)**:
   - Extracted `status` (`SUCCESS` / `ERROR` / `INVALID`), `usage` (`input_tokens`, `output_tokens`, `total_tokens`, `cost_usd`), `num_turns`, and `denied_actions` from the `stream-json` envelope; emitted `tool_denied` events for `denied_actions`, populated `UsageState`, and failed closed (`VSUP_ANTIGRAVITY_EXEC_FAILED`) when `status` is `'ERROR'` or `'INVALID'`.
   - Included `buildWorkspaceListing(input.workerWorkspace)` in review prompts and implemented `preparationCheck()` returning `candidateIdentity()`.

#### Phase 2 — Unification with 2.1 Wave 1–3 (`origin/claude/2.1-wave-1`) & Supervisor-Owned `PreToolUse` Hook (Completed on `origin/explore_project_details`)

1. **Merged `origin/codex/package-kit-identity` (`6faee25`) and `origin/claude/2.1-wave-1` (`0d7119a`)**:
   - Integrated the 2.0.1 disconnect / 2.0.2 target readiness evidence and the 2.1 Wave 0–3 features onto `origin/explore_project_details`.
2. **Propagate `excluded_globs` & `usage.tool_calls` to `AntigravityBackend` (`src/backends/antigravity.ts`)**:
   - Passed `input.excludedGlobs` into `buildWorkspaceListing(input.workerWorkspace, input.excludedGlobs)` and appended each excluded glob into `settings.json` `permissions.deny` for `read`, `edit`, and `write`.
   - Mapped `AntigravityBackend`'s executed tool calls and `denied_actions` into 2.1's `usage.tool_calls` (`executed`, `denied_by_handler`, `denied_by_policy`).
3. **Deterministic `PreToolUse` Enforcement Hook & `approvals.json` Ledger (`src/backends/antigravity.ts`, `src/backends/antigravity/pre-tool-hook.mjs`)**:
   - Configured a supervisor-owned `PreToolUse` hook script `pre-tool-hook.mjs` referenced in `$HOME/.gemini/antigravity-cli/hooks.json` that invokes `judgeWorkspacePath(workspace, toolPath, excludedGlobs)` on every tool call before `agy` executes it, exiting with code `2` (blocking error) on out-of-workspace, reserved, secret, or excluded paths and writing a cryptographic `approvals.json` ledger compatible with `runs export`.

#### Phase 3 — Antigravity Conformance Kit, ADR, and Target Acceptance Gates (Completed on `origin/explore_project_details`)

1. **Antigravity Preparation & Pin Check**:
   - Extended `doctor`, `prepare check`, and `AntigravityBackend` to verify `agy 1.4.0` binary version and SHA-256 digest, run zero-inference slash-command read-backs (`/config`, `/hooks`, `/permissions`, `/skills`) against a refusing proxy, run 6 synthetic `PreToolUse` hook checks, and write a backend-scoped preparation receipt and sanitized report bound to the binary SHA-256 digest.
2. **ADR & Target Acceptance Gates**:
   - Recorded the `AntigravityBackend` four-layer defense-in-depth isolation architecture in [ADR 0008](../docs/adr/0008-antigravity-execution-backend.md), added deterministic check `antigravity-backend-settings-pretool-hook-ledger-and-prepare` and target acceptance gates (`antigravity-backend-no-inference-check`, `antigravity-backend-hosted-review-edit`) in `docs/acceptance.json` and `docs/compatibility.md`. Target evidence in `research/evidence/antigravity-backend-2026-10-17/` is verified (`4ca2ca88520d1acbd4d4112ce3c9609203cb1c5c293fc2dbde4eee07b85824bf`); checker repaired and target no-inference conformance gate closed (`antigravity-backend-no-inference-check` VERIFIED, `3bb58cb`).

### 6.2 Antigravity cold review and target probes (2026-10-19)

A cold review found 16 issues in the Antigravity backend (listed in the [Handoff](../Handoff.md#cold-review-of-the-antigravity-backend--2026-10-19)). F1–F10 and F14–F16 are code fixes on `claude/antigravity-fixes`. F11–F13 (hook load not verified per run, proxy egress and the Code Assist host, project configuration above the workspace) and the hook's deny and failure semantics depend on agy itself, so `prepare check` now probes them through agy with a fixed fake key and a scripted loopback model (`src/preparation/antigravity-probes.ts`) and fails the receipt unless each passes. Five `UNVERIFIED` gates track them in `docs/acceptance.json`; the procedure is in [target acceptance](../docs/target-acceptance.md#antigravity-backend-probes).

**Owner decision 2026-10-19:** Antigravity ships in 2.1.0 as experimental and off by default (`experimental.antigravity = true` opts in; without it `backend = "antigravity"` is rejected), and is not for production until the five gates pass on the target.

The 2.1.0 line from here:

1. Review and merge `claude/antigravity-fixes` into main (coordinator: private-path scan, `npm run verify:release`).
2. Package 2.1.0 on the target with `package:rc`.
3. Target checks on that archive: pin, `doctor`, the app-server no-inference check, and with the opt-in set the Antigravity `prepare check` and its probes. A probe failure is a candidate defect and a new candidate.
4. Clean-account installation (owner).
5. Publish 2.1.0 from the tested archive. If the Antigravity gates are still open, the release notes say the backend is experimental and unproven.

Then 2.1.x for fixes and 2.2 below.

## 7. 2.2: wider, still one path

- `allowed_write_paths` on edits: the handler denies writes outside the declared list and the run continues (features candidate 3).
- A per-root cost ledger (`budgets.<root>.max_cost_usd_per_day`) surfaced as a readiness blocker, built on item 1's records.
- Linux, claimed only after a Linux pin manifest, conformance check, one review, one edit and one disconnect are recorded.
- MCPB bundle and registry entry; the Codex plugin in its current layout (section 4.11).
- A `runs` watch view over item 1's numbers.
- Reviewed dependency-preparation profiles (required build scripts, project manager configuration, workspaces), only with your authorization; existing blockers never become implicit script or network permission.

## 8. Later and never

**Later, each behind its own trigger:** fixes from target evidence; the next Vibe release as a new candidate (revalidate wire facts, new manifest, conformance, one review, one edit; item 7's script does the first pass; if the cadence becomes unaffordable, the pin policy is revisited openly, never relaxed silently); MCP Tasks when a client declares it; size-capped inline images; a single repair turn and `turn/steer`, each only through an ADR; a CI mode after Linux and an ADR; byte-reproducible archives (the SBOM's creation time and namespace are the first thing to fix); CI once the `workflow` scope exists, confirmed by its first real run.

**Never**, each rejected by a line in AGENTS.md rather than by lack of demand: resume, replay or queueing; interactive or elicitation-based approvals; more than one active run per instance; shell-based search; automatic patch application; a Vibe version range.

## 9. How the work runs

### 9.1 Rules

- **Coordinator only:** merges, commits, pushes, packaging, tags, Handoff changes, the registration lines in shared files named below.
- **Agents:** named files, disjoint ownership, never stage or move files in Git, never write outside their worktree. Implementation agents use the model AGENTS.md names where it is available; where it is not, the report says so rather than claiming it.
- **Checks gate on exit codes:** `cmd; echo exit=$?` or `&&`, never a `grep` of test output, which hides failures. Run the checks the change warrants: links, JSON and `git diff --check` for documentation; the relevant regressions and release checks for runtime changes; a new package only when delivering one.
- **Fakes:** no credential that matches `/\bsk-[A-Za-z0-9_-]{24,}\b/`.
- **Files:** written with the Write tool, never with stdin heredocs; no aliased `ls`.
- **After each agent:** check for its leftover processes; forward any fact one agent finds that another needs.
- **Long agents:** write a usable first version early, so an interruption leaves something.
- **Vibe:** never run on the preparing machine; behaviour is proven only on the target.
- **Owner values:** a command that needs one uses `read -r NAME` (or `read -rs` for a secret) and then `$NAME`, never a placeholder to edit.
- **Evidence:** records the actual source, archive, kit, runtime, transport, budget, outcome and limits. Source review, fixtures, initialization, native readiness, hosted behaviour and clean-account or platform installation are distinct layers. No plan creates a hosted allowance. Frozen artifacts and failure and correction history are kept. Unrelated primary-checkout work, private evidence and other chats' worktrees are never moved, staged, deleted or reset.

### 9.2 Dependency graph

| ID | Work item | Needs | Who |
|---|---|---|---|
| I1 | Integration committed, cold-reviewed, merged to main | — | Coordinator, your yes |
| R0 | v2.0.0 draft deleted or left unpublished | — | You |
| R1 | Package 2.0.1 from main with its kit; record the identity | I1 | Coordinator |
| V1 | Populated pnpm validation | R1 | Coordinator |
| R2 | Archive and kit to the target | R1 | You |
| R3 | 2.0.1 target sitting | R2, authorizations | Target agent |
| R4 | Clean-account installation | R1 | You |
| R5 | Evidence branch reviewed and merged | R3, R4, V1 | Coordinator |
| R6 | Rename, description, topics; then the README top section | — | You; Coordinator for the README |
| R7 | Release notes filled; kit archive, `release-evidence.json`, `asset-checksums.json` | R5 | Coordinator |
| R8 | v2.0.1 published | R7, your yes | You |
| R9 | Plugin path if "delete" | — (before R1 if chosen) | Coordinator |
| R10 | Branch and worktree deletions | I1 (remote), R8 (worktrees) | You |
| D1 | Outreach drafts | — | Agents |
| D2 | Article updated for the workflow features; markers filled | R5 | Agent |
| P0 | 2.1 wave 0: contracts | — (merges after R8) | Agent |
| P1 | Items 1, 2, 3, 4, 6, 7 modules | P0 | Agents |
| P2 | Backend wiring | P1 | Agent |
| P3 | 2.1 docs and gate entries | P2 | Agent |
| P4 | ADR 0007 and the search sidecar | R5 (nested-gating evidence), P2 | Agents |
| P5 | Antigravity docs and skill wording | Your scope reading | Agent |
| P6 | 2.1 package, kit and target sitting | P3 (P4, P5 if they ship) | Coordinator, Target agent |

### 9.3 Agent waves and file ownership

**Release work** runs mostly by people and one target agent; the only parallel agent work beside it is D1 (`marketing/` drafts, one agent per document) and R6's README section (one agent owning `README.md`).

**2.1, contract first.** Shared files are touched in one wave by one owner; later waves only read them.

| Wave | Agent | Owns (creates or edits only these) |
|---|---|---|
| 0 | Contracts | `src/contracts.ts`, `src/core/serialization.ts`, `src/core/run-manager.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/cli.ts`, new `src/cli/runs.ts`, `src/acceptance/schema.ts`, `schemas/run.schema.json`, `schemas/result.schema.json`, new `schemas/findings.schema.json`, new stub `src/core/findings.ts`; tests `tests/unit/tool-schemas.test.ts`, `tests/unit/cli.test.ts`, new `tests/unit/run-record-fields.test.ts` |
| 1 | Usage (item 1) | `src/backends/app-server/usage.ts`, `src/backends/app-server.ts`; tests `tests/unit/app-server-usage.test.ts`, new `tests/integration/usage-record.test.ts`, new scenario `tests/fixtures/app-server-scenarios/usage-tool-counts.json` |
| 1 | Exclusions (item 3) | `src/config/validation.ts`, `src/config/config.ts`, `src/config/policy.ts`, `src/backends/app-server/session-config.ts`, `src/backends/app-server/approvals.ts`, `src/backends/app-server/workspace-listing.ts`, `schemas/config.schema.json`, `examples/config.toml`, `scripts/v2-conformance-check.mjs`; tests `tests/unit/config.test.ts`, `tests/unit/app-server-session-config.test.ts`, `tests/unit/app-server-approvals.test.ts`, `tests/unit/app-server-workspace-listing.test.ts`, `tests/unit/policy-readiness.test.ts` |
| 1 | Findings (item 4) | `src/core/findings.ts` (replacing the stub), new `src/cli/runs/sarif.ts`; new `tests/unit/findings.test.ts`, new `tests/unit/sarif.test.ts` |
| 1 | Usefulness and ledger (items 2 and 6) | new `src/cli/runs/usefulness.ts`, `src/reporting/export.ts`; new `tests/unit/runs-usefulness.test.ts`, `tests/unit/acceptance.test.ts` |
| 1 | Candidate tooling (item 7) | new `scripts/vibe-candidate.mjs`, `src/backends/app-server/pin.ts`, new generated `src/backends/app-server/shipped-manifest.ts`, `src/cli/pin.ts`, `scripts/README.md`; tests `tests/unit/app-server-pin.test.ts`, new `tests/unit/vibe-candidate.test.ts` |
| 1 | Templates (item 9) | `skills/vibe-supervisor/SKILL.md` |
| 2 | Backend wiring | `src/backends/app-server.ts` (exclusions passed to the session configuration, handler and listing; the findings contract in the prompt; the ledger handed over at settle); new scenarios for each; `tests/integration/app-server-backend.test.ts` |
| 3 | Docs | `docs/reference.md`, `docs/functionality.md`, `docs/security.md`, `docs/compatibility.md`, `docs/workflow-acceptance.md`, `docs/acceptance.json`, `README.md`, `CHANGELOG.md`, `tests/unit/no-legacy-references.test.ts` (the changelog rule: start the scan at the first `## ` heading, so a `## 2.1.0` entry is scanned); `npm run docs:errors` if a remedy changed |
| 4 | Sidecar (item 5) | new `docs/adr/0007-review-search-sidecar.md`, new `src/backends/app-server/search.ts`, `search-server.ts`, `path-policy.ts`; then `session-config.ts`, `readback.ts`, `approvals.ts`, `events.ts` (all free again after wave 2) |
| any | Antigravity (item 8) | `docs/reference.md` section "Other MCP clients" (coordinated with wave 3 by sequencing: wave 3 first), `skills/vibe-supervisor/SKILL.md` after wave 1's templates |

The coordinator adds one line per subcommand to `src/cli/runs.ts`'s table when merging waves 1 and 2, and resolves the version bump to 2.1.0 last. Each wave ends with the coordinator's `npm run verify:release` on the merged result and a cold review before the next wave starts.

## 10. Risks and measures

**Risks:**
- **A wire fact we guessed wrong:** every one fails closed, so the cost is a fix, a new archive and kit, and a new sitting (section 4.5). Two have already been found this way.
- **The frozen archive or its kit is lost or rebuilt:** their bytes cannot be reproduced and a rebuilt archive refuses the old kit; keep `release/2.0.1/` until v2.0.1 is published and verified, and never rebuild to "refresh" it.
- **Evidence on the wrong bytes:** the workflow candidate's results and the 2.0.0 source's floor run sit beside this candidate's gates in `docs/acceptance.json`; the `build` field, the archive hash in every result line and the coordinator's identity check keep them apart.
- **Mistral changes or removes `vibe-app-server`:** each release pins one Vibe version, and a later Vibe release is a new candidate.
- **The hosted allowance runs out:** stop at the first failure and never retry.
- **The guard test rejects an evidence line:** it fails `verify:release` before the merge, never after; the forbidden words are listed in section 4.4.
- **Dependency preparation blocks a real project:** blockers are explicit; a reviewed profile is 2.2 work, never an implicit permission.
- **Antigravity churn and terms:** client only, verified per version, never "supported".

**Done means:**
- 2.0.1: zero `UNVERIFIED` gates or each remaining one accepted by you with its finding in the release notes, and one archive SHA-256 and one kit identity matching across the packaging record, the target, the clean account and the release assets; the guard test passes and no link is broken.
- Every release: `verify:release` is green on Node 20.19.0, and its kit ships beside its archive.
- 2.1 and later: each item has its fixture test and, where it touches a run, one hosted observation.

## Outreach and adjacent work

You send everything personally; agents only draft.

| When | Action | Who |
|---|---|---|
| Now | Rename decision; description and topics (section 4.7) | You |
| Now | Rewrite the Mistral Discussion for 2.0 (add the managed-configuration refresh and the skill catalogue); draft three Bug Reports; write the private note for Mistral security; protocol feedback note; one-page brief; rewrite the Multica comment (it still describes the removed launcher), draft the Paperclip comment. Story facts come from `marketing/sources.md` on main, which cites commits now that the history is out of the tree | Agents draft |
| Now | Send the private note to Mistral security; wait for a reply or two weeks | You |
| 2.0.1 published | Publish the article (update it for the workflow features, apply its `[UPDATE AT PUBLISH]` list from the merged `docs/acceptance.json`; pick dev.to's AI-assisted label); post the Discussion and Bug Reports with the hosted results; Show and tell; Multica and Paperclip comments | You |
| 2.0.1 + 1 week | Show HN with the article link; Reddit and LinkedIn | You |
| 2.0.1 installable | Apply to the Codex open source fund | You |
| 2.0.1 published | MCPB bundle and registry entry, awesome-list PR (agents build; you publish as org Owner) | Agents, you |
| 2.1 | Antigravity forum reply with the gate evidence; the reviewdog channel once SARIF ships; the usefulness rate published monthly from `runs usefulness` | You |
| After 2.0.1 | Ambassador application, with the advocacy record | You |
| Monthly | Blog series pieces; CFP submissions | Agents draft, you publish |

The marketing calendar's weeks 3 to 4 ("2.0.1 work; history leaves the tree") are already done; its registry work (weeks 5 and 6) can start as soon as 2.0.1 is published. The independence line ("an independent project, not affiliated with Mistral AI or OpenAI") goes in every public asset. Security claims always carry "application policy, not an OS sandbox". Claims use exact version-bound outcomes and disclose unknown model and cost fields; research citations are refreshed when used.
