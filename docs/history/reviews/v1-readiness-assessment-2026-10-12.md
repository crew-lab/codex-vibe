# v1.0 readiness assessment (2026-10-12)

Read-only review of main at `2b7221e` (vibe-supervisor 0.9.0-rc.25): AGENTS.md, Handoff, acceptance gates, the five shipped docs, the rc.24 cold review, the rc.25 runbook, CHANGELOG rc.18 to rc.25, all of `src/`, the Python shim, the skill, `scripts/`, CI, and the test layout. Nothing was executed. Known open gates and the flaky-test work in progress are taken as given.

## 1. Verdict

The code is close; the evidence is not. Every boundary in AGENTS.md holds in the code I read, the rc.24 cold-review S-items are fixed, and the remaining code defects are small. What stands between rc.25 and a defensible 1.0 is a single fact: **no run with inference has ever happened on Vibe 2.26.1 or on the one-shot (post-ACP) runtime.** The last hosted runs were rc.8 (2026-10-08) and rc.17 (ACP, 2026-10-09), both on 2.25.8. The pin moved to 2.26.1 at rc.20 on a source audit only. Turn-limit parsing, Keychain resolution, the tool-permission env, the agent profile, and the `--legacy-harness` flag are all string-exact assumptions about a release nobody has run through this supervisor.

"Stable v1.0" should mean, concretely, that I would sign these five lines and nothing else:

1. Five hosted runs on the frozen 1.0 artifact against Vibe 2.26.1 (two reviews, two edits, one of each at the turn limit) ended in the documented state with `stop_reason` read, patch verified in a scratch clone, and `vibe_close` cleanup reporting `worktree_removed: true`.
2. One real active disconnect (Codex quit while `running`) left: server gone, worker group gone, lock released, run `failed`, no relaunch.
3. Native readiness (C1) passed on the desktop connection with `server_version` equal to the artifact.
4. The full suite passes 10 consecutive times on the preparing machine with zero failures.
5. A tag, a GitHub prerelease with the tarball and `SHA256SUMS`, and the Handoff's install path pointing at it.

Clean-account install, CI on exact Node 20.19.0, C2/C3 live-policy gates and the Node 24 job are not 1.0 criteria; see section 4.

## 2. Issues, ranked

Format: location, scenario, confidence.

### Blockers for 1.0

**B1. Vibe 2.26.1 has no inference evidence.** `src/backends/pinned.ts:1`, `vibe_supervisor_launcher.py:20`. The whole stack fails closed on drift, so a wrong assumption produces `VSUP_BACKEND_CRASHED` or a false `failed` on every run, not a subtle bug. Specific unverified strings: the turn-limit markers in `programmatic.ts:38-45` (`<vibe_stop_event>Turn limit of N reached</vibe_stop_event>`, `Stopped: turn_limit`, exit code 3), the Keychain service names `ai.mistral.vibe`/`vibe` and account `MISTRAL_API_KEY` (`launcher.py:29-31`; last confirmed 2026-10-05 on 2.25.8), `VIBE_TOOLS__*__DENYLIST/ALLOWLIST` and `vibe-path:directory_recursive:` encoding in `profile.ts:25-45`, and the agent TOML keys in `profile.ts:84-96`. High confidence this is the gate that matters; medium confidence something in the list has moved.

**B2. Test suite is not green under repetition.** Known and in progress (storage-faults EACCES 4/25, wall-clock assertions, shared doctor/cli state). A 1.0 whose own `verify:release` fails one run in six cannot be re-cut safely. 25 `toBeLessThan` wall-clock assertions across 10 files should become structural assertions or be deleted. High confidence.

**B3. No release exists past rc.22.** `git tag` stops at `v0.9.0-rc.22`; rc.23 to rc.25 live only as tarballs in `tmp/` on the target machine and in a Handoff hash. README tells users to install "the exact tarball from the matching GitHub prerelease", which does not exist. High confidence.

### Should fix before 1.0 (small, bind to the frozen artifact so fix them first)

**S1. `git worktree add` and patch export share a fixed 30 s / 100 MiB Git bound.** `src/git/worktree.ts:506-507,662`. A repository whose checkout takes over 30 s (large monorepo, slow disk) fails every edit with `VSUP_WORKTREE_CREATE_FAILED`/`VSUP_TIMEOUT` and the remedy says "reduce the size of the repository changes", which is wrong for a checkout. Make the `worktree add` timeout scale with `timeoutSeconds` or raise it to 5 min. High confidence for big repos; the fixture and Garnebo may be fine.

**S2. Review snapshot hashes the whole workspace twice, excluding only `.git`.** `src/core/workspace-snapshot.ts:7` (200k files, 2 GiB), called at launch (`run-manager.ts:877`) and settle (`:1425`). A workspace with `node_modules` or build output is slow at both ends and, past the cap, reports `integrity: unverified` on every review. Honour `.gitignore` via `git ls-files` (already in `listGitVisibleFiles`) or document the cap in the reference. Medium confidence on user impact.

**S3. Stdout cap equals the transcript limit (rc.24 A1, still open).** `programmatic.ts:125`. In `--output streaming` stdout carries every tool result; a read-heavy review on a 10 MiB default can fail `VSUP_OUTPUT_LIMIT` with a tiny transcript. Use `maxEventBytes` for stdout. Medium confidence.

**S4. Retained worktrees stay registered in the user's repository.** `worktree.ts:662` registers under `<repo>/.git/worktrees/`. A user who runs `git worktree prune` or `git worktree remove` on the stray entry makes supervisor cleanup refuse forever (`:724`) and the run directory is never pruned (`run-manager.ts:694,700`). Document it in the reference and have `runs cleanup` list retained worktrees with the one safe manual command. High confidence; this is the first thing a real user will hit.

**S5. Doctor rejects `~/` roots** (rc.24 A5). `doctor.ts:845` uses the raw entry. Setup writes canonical absolute paths, so only hand-edited configs are affected. High confidence, low impact.

**S6. `VSUP_CANCELLED` documented but never emitted** (`docs/errors.md`, `contracts.ts`); close records state `cancelled` with no error object. Either emit it or drop the row. High confidence.

**S7. Skill and README link to `scripts/README.md`, which the package does not ship** (`package.json` `files`). The installed skill has a dead link and tells the coordinator to run a script that is not there. Either ship `scripts/README.md` and `prepare-reviewed-baseline.mjs`, or remove the dirty-baseline step from the skill for 1.0 (recommended; see section 3). High confidence.

### After 1.0

- **A1. Session sprawl.** `isolated-home.ts` creates `mcp-sessions/session-XXXXXX` per concurrent connection and never prunes; retention runs only inside the connected session, so runs in idle sessions are kept forever, and more than 128 entries (`isolated-run-router.ts:251`) breaks every `run_id` lookup. Add a `runs cleanup --sessions` that removes unlocked sessions with no retained worktree. Medium confidence it is reached in practice within months.
- **A2. Receipt reuse within TTL** (rc.24 A8), wording only.
- **A3. Settle before worker death on the output-limit path** (rc.24 A2), fails safe.
- **A4. `closeRun` records `VSUP_BACKEND_CRASHED` when the exit report wins the race** (rc.24 A3), narrow.
- **A5. Turn-limit check rejects any extra stderr line** (rc.24 A4), including the shim's own "no Keychain credential" line at `launcher.py:558`; a turn-limit stop on an API-key login becomes `failed`. Worth checking during the matrix.
- **A6. Readiness fingerprint uses `os.homedir()` while validation uses `env.HOME`** (`config.ts:60`); differs only under a rewritten HOME.
- **A7. Setup's "Restart Codex to load it"** (`setup.ts:630`) is the only place the operator learns that a stale desktop connection keeps the old `dist/cli.js`; make it name the registered path.

Not found: any path that applies, commits or pushes a patch; any shell or network tool reaching the worker; any inherited HOME/VIBE_HOME; any replay on recovery.

## 3. Complexity that threatens stability

The code is 5k lines of `src/` and 10k of tests for five tools; the weight is in process, not code. Three items are worth cutting or freezing before 1.0:

- **Reviewed dirty-baseline helper** (`scripts/prepare-reviewed-baseline.mjs`, 396 lines, its schema, test and skill section). It is unshipped, unlinked from the package, and no documented run has used it since rc.13. Remove it from the 1.0 skill and README; keep the script in the repository. Simpler story: "commit or stash, then pass `base_ref`".
- **Readiness receipts** (`readiness-receipt.ts`, 91 lines plus the binding checks in `run-manager.ts:353-366`). A start already rereads and revalidates everything; the receipt's only non-redundant effect is pinning `base_commit`. Keep it (it is built and tested), but do not spend a hosted gate on C2/C3 live-policy proofs; the unit tests in `policy-readiness.test.ts` cover them and the hosted matrix exercises the receipt path anyway.
- **Platform branches with no support claim**: `linuxGroupHasRunningMembers` (`managed.ts:150-166`), Windows `PATHEXT`, `%APPDATA%`. Leave them; do not add more.
- **`docs/history/` at 2,500 lines plus 30 review folders** and a Handoff that still narrates rc.23 paths. After 1.0, collapse Handoff to one page and archive the rest.

Do not cut: owner lock, isolated router, verified cleanup, redaction. They are what makes the boundaries true.

## 4. Shortest path to a v1.0 tag

Ordered. "Prep" is the preparing machine, "target" the operator's Mac, "owner" a decision.

1. **Prep: land rc.26** = the flaky-test fixes in flight plus S1, S3, S5, S6, S7 (S2 and S4 may be docs-only for 1.0). Evidence: `npm test` 10 consecutive green runs, `verify:release`, `package:rc` with the offline cache. One day.
2. **Prep: tag and publish rc.26** as a GitHub prerelease with tarball, `SHA256SUMS`, `sbom.spdx.json`, `acceptance.json`. Evidence: the release page; Handoff install section points at it instead of `tmp/`. Closes B3. Needs the push token; if the token still lacks `workflow` scope, publishing a release does not need it.
3. **Owner: drop or defer these gates** so the matrix is the only hosted spend: `clean-account-install` (defer to 1.0.1; a fresh macOS account proves installability, not runtime correctness, and the offline smoke already proves the tarball installs), `node-floor-20.19.0-ci` and the Node 24 job (local pass on exactly 20.19.0 is recorded; `engines` says `>=20.19`; CI on `'20.19'` is enough), `live-allowlist-change-without-restart` and `boot-key-change-restart-required` (unit-covered; keep as optional observations during step 5). Keep: native readiness, hosted matrix, active disconnect, provider auth (the last is observed by the matrix for free).
4. **Target: install rc.26 next to rc.23**, runbook section B, then **native readiness C1** for the fixture and Garnebo. Evidence: redacted `vibe_status` replies with `server_version 0.9.0-rc.26`. Half a day, no spend. If C1 fails, the fix goes back to step 1 and the artifact is re-cut; nothing in steps 5 to 7 is lost.
5. **Target: hosted matrix on the fixture**, runbook section D, with the budget agreed up front: review, edit, review to the turn limit (closes A5 and the turn-limit strings), edit to the turn limit, review. Pass the receipt each time. Evidence: run ids, `stop_reason`, patch applied in a scratch clone, `cleanup` receipts, `runs list` empty of worktrees. This single step closes B1, provider auth, and `hosted-review-edit-matrix`. One day including waiting.
6. **Target: active disconnect** during run 5 or a sixth run (Cmd+Q Codex while `running`; the official-client variant is optional since the fake rehearsal covers it). Evidence as in the runbook. One hour.
7. **Owner: go/no-go.** If steps 4 to 6 passed with no code change, `rc.26` becomes `1.0.0` by version bump and changelog only; re-run `verify:release` and `package:rc`, tag `v1.0.0`, publish. The hosted evidence binds to the rc.26 source hash; a version-only bump is defensible if the diff is `package.json`, `CHANGELOG.md`, `acceptance.json` and the Handoff. If any code changed after step 5, repeat step 5 (five runs) on the new artifact; do not shortcut it.
8. **After 1.0 (1.0.1 or docs):** S2, S4 docs, A1 session pruning, clean-account walkthrough, Handoff collapse, launch article rewrite.

What makes this the shortest path: one hosted sitting on the target machine that yields readiness, five runs, auth and disconnect together; no gate a deterministic test already proves; no release without a tag; no code change after the matrix.
