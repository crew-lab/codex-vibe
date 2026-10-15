# vibe-supervisor 2.0 implementation plan

Written 2026-10-15 from branch `claude/app-server-design` at `2ae8e86` (version 2.0.0; `npm run verify:release` green on Node 20.19.0: 83 files, 1,244 tests). Not shipped. The strategy behind it is [docs/development-strategy.md](../docs/development-strategy.md); the current status is [Handoff.md](../Handoff.md). This document is the step-by-step path from here to a published, stable 2.0.0 and then to 2.0.1.

## Summary: the critical path

Everything that only the owner can do is marked **Owner**. Everything else is prepared here and needs no new decision.

| # | Step | Who | Blocks |
|---|---|---|---|
| 1 | Merge the branch into main; take the branch's `Handoff.md` | Coordinator, **Owner** says yes to the push | 2 |
| 2 | `verify:release` on main, then `make push` | Coordinator | 3 |
| 3 | `npm run package:rc` with a populated npm cache; record the archive SHA-256 | Coordinator, **Owner** gives the cache path | 4 |
| 4 | Run the target brief on the target Mac: build and install, pin manifest, conformance check, readiness, one review and one edit, one disconnect | Target agent, **Owner** gives five authorizations and three hosted runs | 5 |
| 5 | Write the gate results into `acceptance.json` on a branch; merge | Target agent, Coordinator | 6 |
| 6 | Clean-account installation of the same archive | **Owner** | 7 |
| 7 | Repo readiness: description, topics, README top, social preview; the rename decision | **Owner** decides the rename; Coordinator prepares the rest | 8 |
| 8 | Tag `v2.0.0`, publish the GitHub release with the frozen archive and checksums | **Owner** authorizes; Coordinator prepares notes | 9 |
| 9 | 2.0.1: move what the code relies on out of `docs/history/`, then remove the history and every other version | Agents in parallel, Coordinator commits | 10 |
| 10 | 2.0.1 conformance check and readiness on the target; tag and publish | **Owner** authorizes; Target agent | — |

Owner touchpoints, in order: the push to main; the npm cache path; five target authorizations with three hosted runs; the clean-account installation; the rename decision; the publish of 2.0.0; the 2.0.1 merge, branch deletions, target check and publish.

## A. Definition of done

**2.0.0 is stable when all of these hold:**
- Every gate in `docs/acceptance.json` `unverified` is in `verified` with its evidence: `target-no-inference-conformance-check`, `native-readiness-on-candidate`, `hosted-review-edit-confirmation`, `mcp-client-disconnect-hosted`, `permission-ask-visible-in-effective-config`, `thinking-off-effect`, `experiments-fetch-off`, `nested-run-typescript-shape-and-gating`, `clean-account-install`. `node-floor-20.19.0` is already `PASSED_LOCALLY`.
- Each gate's evidence is the one the brief names, recorded under `docs/reviews/v2-target-<date>/` with the placeholders from `docs/reviews/REDACTION.md`.
- One archive, built once by `package:rc` from the merge commit on main, is the archive the target installed and the clean account installed. Its SHA-256 is in `acceptance.json` (`frozen_archive_sha256`) and in the release notes.
- `v2.0.0` is tagged on main and the GitHub release carries the archive, its checksum file and notes stating the limits.
- Every open protocol question in the Handoff has a recorded answer from the target, or is recorded as not exercised.

**2.0.1 is done when:**
- `docs/history/`, `docs/reviews/` and ADR 0003 are gone from the tree, and nothing in the tree links to them.
- No file describes or accepts another supervisor version or another Vibe version, enforced by a test (section C4).
- The `v1-*` scripts and tests carry neutral names.
- `CHANGELOG.md` starts at 2.0.0; `acceptance.json` has no `historical_*` keys.
- `verify:release` and `package:rc` pass, and the conformance check and readiness pass on the target against the 2.0.1 archive.
- The stale remote branches are deleted.

## B. 2.0.0 from here to the published release

### B1. Merge to main

- **Purpose:** main becomes the 2.0 line.
- **State:** main is at `d9d9dae` and has one commit the branch lacks, which edits `Handoff.md`. `git merge-tree --write-tree main HEAD` reports exactly one conflict, in `Handoff.md`. The branch has about fifty commits on top.
- **Steps (coordinator, in the main checkout at `/Users/r.senchuk/src/github.com/whitebithq/cdx-vibe`):** `git merge --no-ff claude/app-server-design`; resolve `Handoff.md` with `git checkout --theirs Handoff.md` (the branch rewrote it; main's one sentence about rebuilding usage from events is already in the branch's strategy); `git add Handoff.md && git commit`.
- **Verification:** `npm ci && npm run verify:release` on main; `git diff claude/app-server-design main -- . ':!Handoff.md'` is empty.
- **Push:** `make push`, only after the owner says yes.
- **Size:** S. **Risk:** low. **Rollback:** before the push, `git reset --hard d9d9dae`; after it, a revert commit, never a force push.

### B2. Packaging

- **Needs:** a populated npm cache with `_cacache`, named by `VIBE_SUPERVISOR_TEST_NPM_CACHE`. No cache path is recorded anywhere; the owner supplies it. `package:rc` never falls back to the network.
- **Command:** `VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc`, which runs `verify:release` and the offline installed-package smoke test.
- **Outputs:** the tarball, its SHA-256 and the SBOM under `release/` (unshipped). Record the SHA-256 in `acceptance.json` (`frozen_archive_sha256`, `packaging_time_snapshot` with the commit) and in the Handoff.
- **Shipping check:** `package.json` `files` is `dist`, `schemas`, `examples`, `skills`, `docs` minus `docs/history` and `docs/reviews`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `LICENSE`. `marketing/`, `research/` and `planning/` are at the root and are not listed, so they never ship. `npm pack --dry-run` must list no path under any of those five folders; add this to `tests/unit/package-files.test.ts` as an explicit assertion so it cannot regress.
- **Size:** S. **Risk:** an unpopulated cache fails the smoke test; this is the intended failure. **Rollback:** none needed; nothing is published.

### B3. Release notes

Draft from `CHANGELOG.md`'s 2.0.0 entry, plus four short sections: install (Vibe 2.26.1 first with `uv tool install mistral-vibe==2.26.1`, then the archive, `setup`, `pin-manifest`, `doctor`); the gates and their evidence; the limits in the same type size as the features (application policy, not an OS sandbox; macOS Apple silicon only; the catalogue lists refused write tools; the pin covers Vibe's `RECORD` only; costs are estimates; answer quality is mixed); the breaking change for 1.0 configurations (`paths.vibe_pin_manifest` required, `backend` rejected). The coordinator writes it to `release/notes-2.0.0.md` (unshipped) for the owner to paste.

### B4. The target run

The target agent follows `docs/history/v2-target-brief.md` against the archive from B2, stopping at the first failure.

| Brief step | Authorization | Gates it fills |
|---|---|---|
| 1. Build and install next to the current prefix; switch the Codex registration | 1 | — |
| 2. `pin-manifest`, review it, `doctor` | 2 | the pin half of the conformance check |
| 3. `scripts/v2-conformance-check.mjs` with `--observe-network` | 3 | `target-no-inference-conformance-check`, the config half of `permission-ask-visible-in-effective-config`, the setting half of `thinking-off-effect`, `experiments-fetch-off` |
| 4. Native readiness through Codex | 3 | `native-readiness-on-candidate` |
| 5–6. One review (with the nested-write probe and the reasoning watcher), one edit verified with the fixture script | 4 (two hosted runs) | `hosted-review-edit-confirmation`, the handler half of `permission-ask`, the effect half of `thinking-off-effect`, `nested-run-typescript-shape-and-gating` |
| 7. One observed MCP-client disconnect | 5 (one hosted run) | `mcp-client-disconnect-hosted` |

- **Allowance:** three hosted runs; none remain from 1.x.
- **Recording:** evidence under `docs/reviews/v2-target-<date>/`; each passed gate moves from `unverified` to `verified` in `acceptance.json` with its evidence path; the six open protocol questions are answered in the same report. The target agent commits on a branch and pushes it with `make push-branch BRANCH=<name>`; the coordinator reviews and merges it into main.
- **Size:** M for the target agent. **Risk:** see the table below.

**What can go wrong on the target, and what happens:**

| Failure | Where it shows | Fix path | Decides |
|---|---|---|---|
| A startup read-back mismatch (a key missing, cased differently or nested elsewhere) | Conformance check, `readback_mismatch` with fields | Correct the expectation from the observed shape and the source; rebuild 2.0.0 (new archive, B2 again) | Coordinator; owner approves the rebuild |
| The callback's `relatedEntryId` sits in `detail`, not at the entry | First hosted review: every approval refused as `unlinked_callback` | Read it from either place; rebuild | Coordinator |
| Approved effects do not carry `execute` / `ask` / `user` | First hosted review fails `unapproved_effect` on an approved read | Accept the observed triple only for handler-approved effects linked to the ledger; rebuild | Coordinator; owner approves |
| An unknown history entry kind | Any run fails `unknown_entry_kind` | Add the kind to the known set if it cannot carry a call; rebuild | Coordinator |
| A legitimate `write_file` exceeds the 8 MiB frame cap | Edit fails `VSUP_OUTPUT_LIMIT` | Document the limit, or raise the cap within `limits.max_event_bytes`; rebuild only if raised | Owner |
| Thinking stays on, or reasoning grows in the private store | Reasoning watcher count rises | Record it; reasoning is deleted at close, so this is a documented limitation unless the owner rejects it | Owner |
| An experiments request is observed | `--observe-network` | Find the setting in the source; rebuild if one exists, otherwise document | Coordinator; owner on documenting |
| A callback expires before the 5-second answer | A run fails with a callback error | Shorten the deadline if expiry is shorter; rebuild | Coordinator |
| `maxTurns` not enforced and `modelCalls` reported as null | A review runs past its turn limit | Make a missing `modelCalls` fail closed when a turn limit is set; rebuild | Coordinator |

Every rebuild repeats B2 and restarts B4 from step 1 on the new archive; earlier evidence does not transfer.

### B5. Clean-account installation

The owner installs the same archive on a fresh standard macOS account, following the brief's packet, and records the result as `clean-account-install`. **Owner only.** Size S.

### B6. Repo readiness before any promotion

From [marketing/strategy.md](../marketing/strategy.md) and [marketing/interest.md](../marketing/interest.md):
- **Owner decides the rename** from `codex-vibe` to `vibe-supervisor`. The interest note recommends doing it before the first outreach post. What changes: the repository URL in README, `package.json` `repository`, the article, the outreach drafts, the release links and any future MCPB identifier. GitHub redirects the old name, so existing links keep working.
- **Coordinator prepares:** the description and nine topics from the outreach drafts (one `gh repo edit` command for the owner); a README top section stating what it is, the limits and the independence line; a social preview image concept.

### B7. Tag and release

- **Owner authorizes.** The coordinator tags `v2.0.0` on the main commit the archive was built from and drafts the GitHub release with the archive, `SHA256SUMS` and the notes from B3. Existing releases are never replaced or retagged.
- **Verification:** download the published assets and check their SHA-256 against `acceptance.json`.

### B8. After the release

- **Article:** apply the `[UPDATE AT PUBLISH]` list in `marketing/article/editor-notes.md` (test count from the release commit, gate status, costs); the owner publishes with dev.to's AI-assisted label.
- **Mistral:** per `marketing/interest.md`, the owner files the doc-versus-code mismatches as Bug Reports, sends the three "privately first" findings to Mistral's security address, and posts the rewritten Discussion.
- **Other outreach:** the Multica comment must be rewritten first (it still describes the Python launcher); Show HN only once 2.0.0 installs.

## C. 2.0.1: move, then remove

### C1. Move first (one agent, docs only)

| What | From | To |
|---|---|---|
| Vibe tag commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0` and the source-file hashes the fake server was written from | `docs/history/app-server-source-answers-2026-10-14.md`, the protocol audit | `docs/compatibility.md`, a "Source basis" section |
| The evidence placeholders | `docs/reviews/REDACTION.md` | AGENTS.md, working rules |
| The disconnect procedure | `docs/history/case7-disconnect-brief.md` | `scripts/README.md`, next to the renamed scripts |
| The 2.0.0 target results | `docs/reviews/v2-target-<date>/` | one-line results in `acceptance.json` `verified` entries |
| The target brief, as a reusable procedure for each Vibe release | `docs/history/v2-target-brief.md` | `docs/target-acceptance.md`, without dated or rc references |
| Story material the article and talks cite | `docs/history/` | `marketing/` (already holds the article; check every citation in `marketing/article/editor-notes.md` resolves) |

### C2. Remove

- `docs/history/` and `docs/reviews/` (284 tracked files), and `docs/adr/0003-vibe-launcher.md`.
- In `docs/acceptance.json`: the `historical_evidence`, `historical_1_0_1_rc_2_acceptance`, `historical_1_0_0_acceptance` and `historical_1_0_1_rc_1_acceptance` keys.
- In `docs/reference.md`: the "Upgrading a 1.0 configuration" section.
- In `CHANGELOG.md`: every entry before 2.0.0.
- In `docs/compatibility.md`: the 1.x history paragraph and the "Published 1.0.0 and the unreleased 1.0.1 candidates" sentences.
- In README, SECURITY, AGENTS.md, ADR 0004, `docs/development-strategy.md` and the skill: every mention of 1.0.0, 1.0.1, rc candidates, the legacy engine and `docs/history/`.
- In code: `src/core/run-manager.ts:188` skips saved records with `backend: "acp"`; saved records of any backend other than `app-server` already fail `runFromWire`, so the special case goes, with its test in `tests/integration/recovery.test.ts` kept as a generic "unknown backend is skipped" case. `src/contracts.ts:92` ("absent on legacy records") is reworded. `CLIENT_ENTRYPOINT = 'programmatic'` in `protocol.ts` stays: it is Vibe's wire value, not our history.
- `.codex-plugin/plugin.json` and `.mcp.json`: the interest note found `.codex-plugin/plugin.json` is now Codex's legacy fallback layout. **Owner decides:** delete both, or move to the current plugin layout in 2.2 as planned. Recommended default: delete in 2.0.1 and rebuild in 2.2, so nothing in the tree describes an unverified install path; `tests/unit/version.test.ts` drops its plugin assertion.
- `Handoff.md`: current state only.

### C3. Rename

| Old | New |
|---|---|
| `scripts/v1-disconnect-client.mjs` | `scripts/disconnect-client.mjs` |
| `scripts/v1-disconnect-observer.mjs` | `scripts/disconnect-observer.mjs` |
| `scripts/v1-fixture-verify.mjs` | `scripts/fixture-verify.mjs` |
| `tests/v1-disconnect-client.test.mjs`, `tests/v1-disconnect-observer.test.mjs`, `tests/v1-fixture-verify.test.mjs` | the same without `v1-` |

Update every reference, including `package.json` scripts if any, `docs/target-acceptance.md` and `tests/integration/active-disconnect.test.ts`.

### C4. Grep to zero, enforced

Add `tests/unit/no-legacy-references.test.ts`. It reads every tracked file under `src/`, `tests/`, `scripts/`, `skills/`, `examples/`, `schemas/`, `docs/` and the root Markdown files, and fails on any of: `legacy-harness`, `vibe -p`, `Python launcher`, `vibe_supervisor_launcher`, `release/1.0`, `1.0.1`, `rc.` followed by a digit, `docs/history`, `docs/reviews`, `v1-`, `programmatic` (except the one `CLIENT_ENTRYPOINT` line), and any Vibe version other than `2.26.1`. Each allowed exception is listed in the test with its reason. `CHANGELOG.md` is checked from its 2.0.0 heading down.

Also review by hand the test files the enumeration found with these words, mostly fixture names and assertions about removed keys: `tests/unit/config.test.ts`, `core-run-manager.test.ts`, `run-provenance.test.ts`, `version.test.ts`, `node-version.test.ts`, `package-files.test.ts`, `app-server-pin.test.ts`, `app-server-credentials.test.ts`, `app-server-protocol.test.ts`, `app-server-readback.test.ts`, `fake-vibe-app-server.test.ts`, and the integration tests `active-disconnect`, `app-server-backend`, `app-server-wiring`, `backend-labels`, `cli-entrypoint`, `client-shutdown`, `config-without-pin-manifest`, `mcp-tools`, `readiness-connection`, `recovery`, `reviewed-baseline`, `stop-reason`, `token-shaping`, and `tests/security/worktree-cleanup-order.test.ts`. A test that asserts a removed key is rejected stays, renamed so it does not cite a version.

### C5. Package and scripts

- `package.json` `files`: drop `!docs/history` and `!docs/reviews` once the folders are gone; `tests/unit/package-files.test.ts` keeps asserting that `marketing/`, `research/` and `planning/` never ship.
- `scripts/acceptance.mjs` and `scripts/smoke-install.mjs`: remove the checks that the legacy dist files are absent; they become meaningless once nothing mentions them, and the no-legacy test covers the source.

### C6. The rename, if not done in B6

The same checklist as B6, plus: update the clone URL in every doc and the article, and confirm the redirect.

### C7. Branch deletion (owner)

Delete the remote branches listed in the Handoff: the four merged `claude/v1.*` branches, the eleven merged `codex/*` branches, then the superseded unmerged ones after a last look (`codex/project-agents-isolation`, `codex/rc1-runtime-consolidation`, `codex/rc28-target-evidence`, `codex/skill-cleanup-update`, `claude/session-pruning`, `claude/v1.0.0` after confirming its tip is not needed beyond the `v1.0.0` tag). `codex/unified-harness-v2` goes last, after the ideas the strategy still plans to port from it (the shipped manifest and the search sidecar) have landed. `claude/app-server-design` is deleted once merged.

### C8. Release 2.0.1

- Version 2.0.1 in `package.json`, `package-lock.json` (two entries) and, if kept, `.codex-plugin/plugin.json`; a changelog entry; `verify:release` on Node 20.19.0; `package:rc`.
- **Target scope:** the conformance check and readiness only, no hosted inference, because 2.0.1 changes documentation, names and one recovery special case, not run behaviour. If any `src/` change touches a run, add one hosted review. **Owner authorizes** both.
- Tag `v2.0.1`, publish.

| Step | Owner | Size | Depends on |
|---|---|---|---|
| C1 Move | Agent (docs) | M | 2.0.0 published |
| C2 Remove (docs) | Agent | M | C1 |
| C2 Remove (code) | Agent | S | C1 |
| C3 Rename | Agent | S | — |
| C4 No-legacy test | Agent | S | C2, C3 |
| C5 Package and scripts | Agent | S | C2 |
| C6 Rename repo | **Owner** | S | — |
| C7 Delete branches | **Owner** | S | C8 for `codex/unified-harness-v2` |
| C8 Release | Coordinator, **Owner** | S | all above |

## D. Running it with agents

- **Parallel, disjoint files:** C2 docs (root Markdown and `docs/`), C2 code (`src/core/run-manager.ts`, `src/contracts.ts`, their tests), C3 (`scripts/`, `tests/*.test.mjs`, `tests/integration/active-disconnect.test.ts`) can run together after C1. C4 and C5 follow.
- **Coordinator only:** merges, commits, pushes, packaging, tags, and every Handoff change.
- **Rules that come from the lessons in the strategy:** agents never stage, move or remove files in Git (use the filesystem; the coordinator commits by path); chain every check and the commit with `&&`; fake credentials never match `/\bsk-[A-Za-z0-9_-]{24,}\b/`; agents write with the Write tool, never stdin heredocs, and avoid the aliased `ls`; after each agent, check for leftover processes; forward any fact one agent finds that another depends on; write a usable first version early so an interrupted agent still leaves something.

## E. Risks, open decisions and measures

**Risks:**
- **The target finds a wire fact we guessed wrong.** Each fails closed, so the cost is a rebuild and a rerun, not a bad release. Budget one rebuild.
- **Mistral changes or removes `vibe-app-server`.** 2.0.0 pins one release; a later Vibe release is a new candidate.
- **The hosted allowance runs out.** Stop at the first failure; never retry.
- **The npm cache is not populated.** `package:rc` fails; nothing is published.
- **History removal loses something still needed.** C1 moves first and C4 checks every remaining link.

**Open decisions, with recommended defaults:**

| Decision | Default |
|---|---|
| Rename the repo to `vibe-supervisor` | Yes, before the first outreach post (B6) |
| `.codex-plugin/` and `.mcp.json` in 2.0.1 | Delete; rebuild in the current layout in 2.2 |
| A target failure that is documentable rather than fixable (thinking, frame cap) | Document it in `compatibility.md` and ship, unless it touches a boundary in AGENTS.md |
| 2.0.1 target scope | Conformance check and readiness only |
| Where 2.0.0 evidence lives after 2.0.1 | One-line results in `acceptance.json`; the raw evidence stays reachable at the `v2.0.0` tag |
| Antigravity as a second verified MCP client | Documentation plus evidence, not a scope change (2.1) |

**Measures of done:** zero `unverified` gates for 2.0.0; one archive SHA-256 matching across target, clean account and release; zero hits for the no-legacy test in 2.0.1; zero broken links; `verify:release` green on Node 20.19.0 for both tags.

## F. Pointers to add

**`docs/development-strategy.md`**, under "Releases", after the 2.0.0 paragraph:

> The step-by-step path, owners and failure handling are in the [implementation plan](../planning/v2-implementation-plan.md) (unshipped).

**`Handoff.md`**, under "Pointers":

> Implementation plan for 2.0.0 and 2.0.1: `planning/v2-implementation-plan.md` (added as a link in the Handoff's pointers).
