# Current state — 2026-10-26

**Source.** `main` at `5751d85` is version 2.1.1, unreleased. It holds the 2.1.0 source of [crew-lab/codex-vibe#10](https://github.com/crew-lab/codex-vibe/pull/10) (merged by fast-forward) and the 2.1.1 fixes on top.

**Releases.** v2.1.0 (archive `9f949d43…`, candidate `7641d294…`), v2.0.2 and v2.0.1 are pre-releases; none is latest. v2.1.0 was built before the fixes below: in it, a deadline or cancel that lands while a completed run is being finalized can kill the server and turn the run into a failure.

**2.1.1 changes** ([changelog](CHANGELOG.md)): that finalization fix (`92b9c3c`, already on PR 10); review authorizations bound to file content instead of timestamps, so ignored build output or a touched file no longer spends an attempt; web fetch and search tools count toward the three-denial stop; `task authorize --expires-at` capped at 24 hours, with a distinct error when the data directory holds no authorization; the unreachable correction code removed. `npm run verify:release` passed on Node 20.19.0. The 2.1.0 target evidence does not transfer: 2.1.1 is a new candidate.

**What remains, in order.**

| # | Step | Who |
|---|---|---|
| 1 | Done 2026-10-26: PR 10 and the 2.1.1 fixes are on `main` at `5751d85` | — |
| 2 | Package 2.1.1 from `5751d85`, install beside 2.1.0, pin manifest, `prepare check`, readiness ([brief below](#target-brief-211-packaging-and-no-inference-checks--2026-10-26)) | Target agent; the owner said yes to authorizations 1–3 on 2026-10-26 |
| 3 | Native readiness on the 2.1.1 candidate, then one hosted review and one edit, each through `task authorize` | Target agent; hosted runs need a new allowance of two starts |
| 4 | Publish 2.1.1 as a pre-release from the target-built archive; add a known-issue line to the v2.1.0 release notes | Owner |
| 5 | Still open: clean-account installation (postponed), broader real-task qualification, the five Antigravity probes | Owner / target agent |
| 6 | Feature work after 2.1.1 is published (owner, 2026-10-26): `allowed_write_paths` on edits, built on its own branch now; then the review search sidecar, once ADR 0007 is approved and the 2.1.1 hosted review's `run_typescript` probe shows a nested write arriving as a denied `file_system.*` effect. The step 3 brief must keep that probe | Coordinator; owner approves ADR 0007 |

The target briefs dated 2026-10-19 further down describe older source and must not be sent.

### Target brief: 2.1.1 packaging and no-inference checks — 2026-10-26

The owner said yes on 2026-10-26 to authorizations 1 to 3 of the [target acceptance procedure](docs/target-acceptance.md#authorizations) for 2.1.1: build and install side by side with the registration switch, the pin manifest, and the no-inference checks. It is not a hosted allowance.

```text
Fetch main and read Handoff.md, section "Current state — 2026-10-26", and docs/target-acceptance.md. Follow the procedure's steps 1 to 4 for the 2.1.1 candidate. Stop at the first failure; no retries, no configuration edits to make a check pass, no hosted start, no task authorize.

1. Build from main at 5751d85 (git checkout --detach 5751d85, confirm git rev-parse HEAD) under exactly Node 20.19.0 and npm 10.8.2: npm ci, npm run verify:release, then package:rc with the offline cache populated with the locked versions. Record the archive SHA-256 and the kit's SHA256SUMS.
2. Install the archive into a new private prefix beside the 2.1.0 install, with its own configuration directory, pin manifest path and data directory. Keep the 2.1.0 registration as the rollback; switch the Codex registration to 2.1.1 only after step 4 passes.
3. Use the same Vibe 3.0.2 install the 2.1.0 sitting used. vibe --version must print 3.0.2. Run pin-manifest and doctor --json on the candidate configuration and review the manifest as the procedure says.
4. prepare check --kit with the candidate's kit (check its SHA256SUMS first) and read the saved report against every criterion in step 4 of the procedure.
5. Switch the registration, restart Codex and run vibe_status for review and for edit with expected_candidate set to the kit manifest's candidate_sha256 (procedure step 5). Record the response without the receipt.

Recording: an evidence folder outside the shipped tree, the placeholders from AGENTS.md, grep -rn '/Users/\|/home/' before committing. Add the 2.1.1 candidate to evidence_builds in docs/acceptance.json and move only the gates whose evidence is complete. Commit on a new branch from main and push it with make push-branch BRANCH=<name>. Do not merge to main or publish. Report the archive hash, the candidate hash, each gate's result and every finding.
```

---

# Publication checkpoint — 2026-10-26

The 2.1.0 stability source is consolidated on `codex/publish-vibe-stability` from base `9c38ea0`. This checkpoint supersedes the uncommitted/pending statements in the historical sections below. Only exact Vibe 3.0.2 is supported; the public surface is five one-shot tools and each dispatch requires a single-use registered attempt.

The qualified archive remains byte-exact: SHA-256 `9f949d4337b4dc037c1e82c0a692c8da27878f670992c46f77f79c9f5f1de2a5`, installed candidate `7641d294df5f432b1b99633c052b5e2311e16131e9ad9e8dc828ccf8511f9154`. Target preparation and native readiness passed. The bounded fixture edit was independently accepted after correcting the coordinator verifier; the original rejection remains in the audit history. No additional hosted starts were used.

Publication target: GitHub v2.1.0 pre-release, without stable/latest promotion. The existing archive, kit and original source snapshot are the release artifacts; this source commit additionally contains this handoff and sanitized evidence. Clean-account installation, broader real-task qualification and experimental Antigravity qualification remain open. Unrelated dirty checkouts are preserved. See [qualification evidence](research/evidence/vibe-302-stability-20261026/README.md).

---

# Stability implementation checkpoint — 2026-10-24

The current implementation uses exactly Vibe 3.0.2 and five one-shot MCP tools. Each start requires a locally registered, single-use dispatch authorization and attempt. See [ADR 0010](docs/adr/0010-dispatch-attempt-authorization.md). Continuation is deferred. The previous six-tool archive and its evidence remain historical; they do not qualify this changed source. Hosted inference remains paused.

This work is isolated from the existing dirty checkouts. The local changes are uncommitted and unpushed. Packaging, installed preparation and actual Desktop readiness are separate checks, recorded only after they run. The experimental Antigravity backend remains independent.

# Handoff as of 2026-10-19

Historical; the current state is at the top. Updated 2026-10-19. Status only: what the source, the archives and the installations are, what remains and who does it, what is open, and where the records are. The picture and the rules are in the [development strategy](planning/development-strategy.md); the sequenced work is in the [development plan](planning/development-plan.md); the boundaries are in [AGENTS.md](AGENTS.md).

## Historical goals and state at a glance — 2026-10-19

This section is the one-page summary; the dated sections below are the record behind it.

**Goals, in the owner's order.**
1. **A working 2.x, now** (owner decision 2026-10-17, "working ASAP"): stable everyday use of the five MCP tools, proven on the target, before more features.
2. **One supported line, no history in the tree** (the 2.0.1 goal): only the latest release is supported and described. Done in the tree; the guard test keeps it so.
3. **2.1 as a frozen scope:** Waves 0–5 plus the Antigravity backend, experimental and opt-in (owner decision 2026-10-19). Deferred: the wheel candidate scripts, the review search sidecar, outreach and task-template pipelines.

**State.**

| Item | State |
|---|---|
| Source | `main` at `b88b880` (or later), version 2.1.0, unreleased; branch `review/antigravity-prep-repairs` fixes preparation hook invocation and ancestor project configuration admission refusal & Git boundary isolation |
| Releases | v2.0.1 and v2.0.2 published as pre-releases (the v2.0.2 tag corrected to `347bf79`); no release is marked latest. The older releases (the 1.x release and the 0.9 pre-releases) were deleted 2026-10-19; their tags are kept |
| Default engine (`app-server`, Vibe 2.26.1) | Proven on the target: conformance, native readiness, the disconnect. Worker answer quality is an owner-accepted limitation, not a passed gate |
| Antigravity (`agy` 1.4.0 / 1.4.3 / 1.4.4) | Experimental, off unless `[experimental] antigravity = true`. Cold-reviewed; fixes for F1–F10 and F14–F16 on main; preparation repairs for hook invocation tool preference and ancestor admission refusal on `review/antigravity-prep-repairs`; version support expanded to 1.4.3 and 1.4.4; F11–F13 wait for the five agy preparation probes on the target |
| 2.1 features | On main: tool-call counts and ceilings, `excluded_globs` (anchored per root, linear-time matching), `runs usefulness`, the approval ledger and pin in exports, findings with SARIF, the daily cost ledger and per-root budgets. Hosted gates for them are open |
| Checks | `npm run verify:release` green on `review/antigravity-prep-repairs` (101 files, 1,494 tests) |

**What remains, in order.**

| # | Step | Who |
|---|---|---|
| 1 | Package 2.1.0 from main on the target (offline cache filled with the locked versions; the target-built archive is the one published) | Target agent |
| 2 | `doctor` and `prepare check` for `app-server`, and the five agy probes (hook invoked and deny honoured, failure modes deny, stream shape, proxy honoured, project config not loaded); Antigravity opted in by the owner 2026-10-19 | Target agent |
| 3 | One hosted review and one edit on 2.1.0 to record the 2.1 hosted gates (usage, exclusions, export, assessment); a new hosted allowance | Owner authorizes; target agent runs |
| 4 | Clean-account installation of the 2.1.0 archive ([checklist](docs/clean-account-checklist.md)); postponed by the owner 2026-10-19 | Owner |
| 5 | Publish 2.1.0 and mark it latest; a pre-release while step 4 is open | Owner |
| 6 | Outreach, after a release is latest | Owner |

**Open risks.** Real `agy` tool argument names may differ from the hook's list, in which case those calls are denied until it matches; the agy probes need `agy` to accept a local model endpoint; running `agy` headless under a consumer sign-in may be outside Antigravity's consumer terms, so prefer API-key or enterprise authentication.

### Target brief: 2.1.0 steps 1 and 2 — 2026-10-19 (superseded)

Superseded on 2026-10-26 by the 2.1.1 brief at the top; kept as a record.

The owner's yes to this brief is authorizations 1 to 3 of the [target acceptance procedure](docs/target-acceptance.md#authorizations) for the 2.1.0 candidate: build and install side by side, the pin manifest, and the no-inference checks. It is not a hosted allowance: no `turn/start`, no hosted start, no switch of the Codex registration. Part B runs only when the owner's message handing over this brief says Antigravity is opted in; the owner opted in on 2026-10-19, so both parts run.

Prompt for the target agent:

```text
Fetch main and read Handoff.md, section "Target brief: 2.1.0 steps 1 and 2", and docs/target-acceptance.md. Follow the procedure's steps 1 to 4 for the 2.1.0 candidate, with these specifics. Stop at the first failure; no retries, no configuration edits to make a check pass, no hosted start.

Part A, default engine:
1. Build from main at b88b880 (git checkout --detach b88b880, confirm git rev-parse HEAD) under exactly Node 20.19.0 and npm 10.8.2: npm ci, npm run verify:release, then package:rc with the offline cache populated with the locked versions. Keep the verify:release output for gate node-floor-20.19.0. Record the archive SHA-256 and the kit's SHA256SUMS.
2. Install the archive into a new private prefix beside the current 2.0.2 install. Give the candidate its own configuration directory, pin manifest path and data directory: prepare check rewrites the receipt beside the pin manifest first, so sharing the 2.0.2 configuration would fail the registered install's receipt. Do not switch the Codex registration; 2.0.2 stays registered and is the rollback.
3. pin-manifest and doctor --json on the candidate configuration; review the manifest as the procedure says.
4. prepare check --kit with the candidate's kit (check its SHA256SUMS first) and read the saved report against every criterion in step 4 of the procedure.
5. For gate hosted-excluded-glob-readback-and-denial, read-back half only: run the installed package's scripts/v2-conformance-check.mjs once more with --config of the candidate configuration, --placeholder-key, --observe-network, --excluded-glob 'secrets/**' and --output into the evidence folder, and confirm denylist_matches_expected is true for every profile tool in both modes. The denial half needs the hosted review and stays open.

Part B, Antigravity, only if the owner opted in: a second candidate configuration with backend = "antigravity", [experimental] antigravity = true and paths.antigravity naming the agy binary (supported versions 1.4.0, 1.4.3, 1.4.4), no real Google credential or sign-in in its environment. Run doctor --json and prepare check --kit as in "Antigravity backend probes" of the procedure, and record each of the five antigravity-* gates from agy_probes. An inconclusive probe leaves its gate open; a fail is a candidate defect for the preparing machine.

Recording: an evidence folder outside the shipped tree, placeholders from AGENTS.md, grep -rn '/Users/\|/home/' before committing. Add the 2.1.0 candidate (source, archive, candidate and kit identity, Node and npm) to evidence_builds in docs/acceptance.json and move only the gates whose evidence is complete, per "Stop rules and recording". Commit on a new branch from main and push it with make push-branch BRANCH=<name>. Do not merge to main, publish, or start any hosted run. Report the archive hash, each gate's result and every finding.
```

### Target brief: 2.1.0 step 3 — 2026-10-19 (superseded)

Superseded on 2026-10-26: a 2.1.1 hosted brief is written once the step 2 evidence is merged.

Not authorized yet. It runs only after the owner gives a hosted allowance of two starts in chat, and only after the steps 1 and 2 evidence branch is merged with Part A passing. That yes is authorization 1's registration switch, authorization 3 for one more `prepare check` (the receipt binds the whole configuration except the roots, so adding the exclusion makes the step 2 receipt stale), and authorization 4 of the [procedure](docs/target-acceptance.md#authorizations) for the 2.1.0 candidate. It covers no Antigravity hosted run (gate `antigravity-backend-hosted-review-edit` stays open), no disconnect and no retry. The two runs carry the gates `native-readiness-on-candidate`, `hosted-usage-recorded`, `hosted-excluded-glob-readback-and-denial` (denial half), `hosted-run-exported`, `hosted-close-acceptance-recorded`, `nested-run-typescript-shape-and-gating`, the handler half of `permission-ask-visible-in-effective-config`, the observations for `thinking-off-effect` and `execution-provenance-on-hosted-run`, and a new attempt at `hosted-review-edit-confirmation`.

Prompt for the target agent:

```text
Fetch main and read Handoff.md, section "Target brief: 2.1.0 step 3", and docs/target-acceptance.md steps 5 and 6. The owner has given an allowance of exactly two hosted starts on the 2.1.0 candidate installed in steps 1 and 2: one review, one edit. Stop at the first failure of a deterministic requirement; no retry, no third start, no raised limits, no configuration edits to make a check pass.

1. Fixture. Use the fixture repository the owner names, clean at its known base commit. Add one file, secrets/note.txt, holding a single harmless line, in one new commit; that commit is the base for both runs. In the candidate configuration add the fixture root to allowed_workspace_roots and set excluded_globs for it to ["secrets/**"], the glob from the step 2 read-back. Leave every other setting as step 2 left it. The exclusion changes the policy, so run prepare check --kit once more on the candidate configuration and confirm status passed; that receipt is the one both runs use.
2. Registration. Switch the Codex registration to the 2.1.0 candidate with its own configuration, keeping 2.0.2 for rollback, and restart Codex.
3. Readiness (procedure step 5): vibe_status for review and for edit with base_ref, expected_candidate set to the kit manifest's candidate_sha256. Record the response without the receipt.
4. Review (procedure step 6). The task is the procedure's review assignment, then: "Exclusion probe: call read_file once on secrets/note.txt and report the returned result or error; do not retry." Then the procedure's run_typescript policy probe, verbatim. 12 turns, 180 seconds. Record for the gates: tool_denied for secrets/note.txt with outcome permission_denied_by_policy or reason path_excluded and the run completed; a completed review with read_file tool_call events and no unapproved_effect; the nested-write evidence or NOT EXERCISED; meta.json and result.json usage (prompt and completion tokens, model_calls or null, cost estimate with authoritative false, tool_calls equal to the tool_call and tool_denied events, limits); execution.state, timestamps.started and the reasoning_observation counts from runs export --include events.
5. Edit (procedure step 6). The edit assignment with an acceptance_contract written before dispatch, base ref the new fixture commit, 12 turns, 180 seconds. Verify with scripts/fixture-verify.mjs in a disposable copy outside any Git checkout. Close with cleanup_worktree and an assessment bound to its patch and contract hashes and the verifier's result. Then runs export: every artifact digest matches, approvals.json covers every tool_call and tool_denied entry id, the pin identity equals the target's manifest, no machine path remains. Run runs usefulness and record the row with the run's usage.
6. After each run: no child-home, vibe-home or tmp in the run directory, and pgrep -f vibe-app-server shows nothing.

A worker answer that is wrong is a recorded answer-quality result, not a supervisor failure: record it, close the run and continue to the next run. A supervisor failure (refused start, unapproved effect, failed cleanup, export mismatch) stops the sitting; switch the registration back to 2.0.2 and report.

Recording as in step 2's brief: evidence folder outside the shipped tree, AGENTS.md placeholders, grep -rn '/Users/\|/home/' before committing, update only the gates whose evidence is complete in docs/acceptance.json and docs/compatibility.md, npm run acceptance, a new branch from main pushed with make push-branch BRANCH=<name>. Do not merge to main or publish. Report each gate's result, both runs' usage and every finding.
```

### Test-suite stability under load — 2026-10-19

With 101 test files the suite spawns many real processes, and at full parallelism (9 workers on 10 cores) process-timing tests failed intermittently. Fixed at their causes, not retried: `vitest.config.ts` caps workers at 4; the six app-server deadline tests use an 8-second deadline (the deadline also covers spawn, `initialize` and the startup read-back, which took over 3 seconds under load); the credential timeout test polls until the killed process is gone; and process-group verification on macOS now treats a group whose only members are zombies as gone (`src/process/managed.ts`, `darwinGroupHasRunningMembers`, the counterpart of the Linux `/proc` check), so a natural exit is no longer reported as `termination_unverified` while `launchd` has not yet reaped a killed helper. Three consecutive full runs passed (1,477 tests, about 110 s each).

## Cold review of the Antigravity backend — 2026-10-19

A reviewer with no design context read the Antigravity backend ([ADR 0008](docs/adr/0008-antigravity-execution-backend.md)) and found that several of its safety claims rest on agy 1.4.0 behaviour never observed through agy. The 16 findings:

| # | Finding |
|---|---|
| F1 | The `PreToolUse` hook allowed directory paths it could not read, so their contents went unchecked. |
| F2 | Reasoning was filtered by a denylist of field names; an unlisted field leaked. |
| F3 | Google API keys were not redacted. |
| F4 | `ANTIGRAVITY_HOME` was forwarded to the worker, defeating the private `HOME`. |
| F5–F7 | Configured budgets were not enforced on Antigravity runs. |
| F8–F9 | The binary was resolved through `PATH`, and the version probe ran with an unfiltered environment; what ran need not be what was hashed. |
| F10 | The Mistral key reached agy's environment. |
| F11 | Nothing verified per run that agy loaded and ran the hook; the gate could be silently absent. |
| F12 | Egress: the no-inference verdict assumed agy honours `HTTPS_PROXY`, and the classifier missed Google Code Assist (`cloudcode-pa.googleapis.com`). |
| F13 | Project configuration above the workspace (Git root `.gemini/`, `.agents/`, `.agent/`) was neither refused nor shown to be ignored. |
| F14 | Stderr overflow was reported as a timeout. |
| F15 | Leftover child processes could survive the run. |
| F16 | SARIF line bounds were not validated. |

Code fixes for F1–F10 and F14–F16 are on main (`212bd38`); the fix branch is merged and deleted. F11–F13 need agy itself: `prepare check` now runs [the Antigravity probes](docs/target-acceptance.md#antigravity-backend-probes) through agy with a fixed fake key and a scripted loopback model (hook invoked and deny honoured, hook failure modes deny, stream tool-event shape against the audit parser, proxy honoured with the extended classifier, project configuration above the workspace not loaded) and fails the receipt unless each passes. Five `UNVERIFIED` gates in `docs/acceptance.json` (`antigravity-hook-invoked-and-deny-honoured`, `antigravity-hook-failure-denies`, `antigravity-stream-tool-shape`, `antigravity-proxy-honoured`, `antigravity-project-config-not-loaded`) track them; the 2026-10-17 `antigravity-backend-no-inference-check` keeps its PASS, scoped to what it ran.

**Owner decision 2026-10-19:** Antigravity ships in 2.1.0 as experimental and off by default: a configuration must set `experimental.antigravity = true`, or `backend = "antigravity"` is rejected. It is not for production until the probes pass on the target. Running agy headless under a consumer Google sign-in may be outside Antigravity's consumer terms; prefer an API key or enterprise authentication. The branch `explore_project_details` was fully merged and deleted from GitHub.

**Target checks to run** (no hosted start, fake key only): on the 2.1.0 candidate with `backend = "antigravity"` and the opt-in set, `doctor` and then `prepare check`; read `agy_probes` in the saved report and record each gate's result per [the procedure](docs/target-acceptance.md#antigravity-backend-probes). Any failure is a candidate defect, not a configuration edit.

### Antigravity preparation repairs on candidate 081b563 — 2026-10-20

Candidate `081b563` packaged and passed release verification (101 files, 1,478 tests), but isolated preparation failed on target:
1. Hook was not invoked because headless `agy 1.4.0` in print mode rejected `view_file` as an unknown tool, and `TOOL_PATH_KEYS` only checked lowercase parameter names rather than PascalCase `Path`.
2. Ancestor `.agents` configuration above the workspace was detected.

Fixed on branch `review/antigravity-prep-repairs`:
- `src/security/workspace-guard.ts`: `assertNoProjectAntigravityExtensions` recursively inspects workspace root and all ancestor directories for `.gemini`, `.agent`, `.agents`, `GEMINI.md`, and `AGENTS.md` (no root exemption). Traversal stops strictly at proven Git boundaries: `git rev-parse --show-toplevel` must report the directory itself, validated against real repositories and real detached worktrees; a `.git` pointing at an empty directory is refused. The probe requires the `WorkspacePathError` naming the planted ancestor configuration.
- `src/backends/antigravity-hook.ts`: PascalCase `'Path'` added to `TOOL_PATH_KEYS` strictly for observed file tools (`read_file`, `write_file`, `edit_file`, `edit`). Dual `hooks.json` written to both `.gemini/config/hooks.json` and `.gemini/antigravity-cli/hooks.json`.
- `src/backends/antigravity.ts`: `writeIsolatedSettings` writes rules supporting both dialects (`view_file`/`read_file` and `write_to_file`/`write_file`).
- `src/preparation/antigravity-probes.ts`: `PROBE_TOOL_PREFERENCE = ['view_file', 'read_file']`, `chooseProbeCall` selects schema-declared path property, and `project_config_not_loaded` probe verifies both admission refusal of unisolated descendant folders and boundary isolation of isolated Git roots.

## Package/kit identity repair — 2026-10-15

The target packet built from `8b288b8` passed release verification (88 files, 1,292 tests) and the offline smoke, but independent archive inspection rejected its preparation kit before installation or conformance. npm 10.8.2 ran `prepare` while packing, rebuilding `dist` without its SBOM; packaging then regenerated the external SBOM before hashing the candidate. The kit therefore identified different bytes. The failed packet and its original identities remain preserved separately; no existing receipt was changed.

The repair branch `codex/package-kit-identity` retains unpublished version 2.0.1. Packaging now captures identity immediately after packing and verifies the actual archive through an offline, lifecycle-disabled private installation before announcing success. It compares candidate identity, version, conformance script and kit checksums, includes kit files in delivery checksums, and removes the verification installation afterward. External SBOM generation and the identity algorithm remain intact. Frozen source `44dc6f8` passed full `package:rc` under Node 20.19.0/npm 10.8.2 (89 files, 1,296 tests), installed smoke and mandatory final archive verification. A separate main-chat offline installation also passed. Corrected archive SHA-256 `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`; actual candidate/kit identity `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`. The candidate runtime digest is unchanged; its previously incorrect kit binding is repaired.

Side-by-side installation, reviewed 783-file Vibe pin and doctor passed. Exactly one matched no-inference preparation check passed with verified cleanup, no subject network requests and a validated refusing observer; experiments-specific attribution stays unverified. All prior roots/settings are preserved, with only the named Supervisor repository added. After PASS, registration dry run was reviewed, private backups retained and only Supervisor registration/skill-link entries switched to persistent Node 20.19.0 and this candidate. SDK readiness and five-tool catalog pass. Native readiness was pending desktop reconnect at packaging time and was subsequently verified on 2026-10-16 (see the dated addendum below); SDK success alone was not treated as native proof. No hosted run, merge, push or publication occurred. [Repair evidence](research/evidence/package-kit-identity-2026-10-15/REPORT.md) records exact identities and remaining gates. The source freeze above identifies the packaged source; the later evidence commit does not rebuild or relabel the archive.

### Native reconnect verified — 2026-10-16

The native desktop connection now reports Supervisor 2.0.1 and the expected candidate `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`. Preparation PASS, workspace/dispatch eligible, free slot, no blockers, no restart required and the exact five-tool connected catalog were verified without starting a run. This supersedes the earlier pending-native status below and in the frozen evidence; those historical records remain intact. [Native readiness addendum](research/evidence/package-kit-identity-2026-10-15/NATIVE-READINESS-2026-10-16.md). Zero hosted starts; hosted and clean-account gates remain open.

### Hosted acceptance stopped — 2026-10-16

One of three authorized hosted starts was used. The review completed/end_turn with read-only integrity, two executed reads and cleanup verified, but the actual final answer reversed both required negative-number cases. Independent fixture execution confirmed the error. Coordinator rejected the review; edit and disconnect were not started, and no retry/fallback occurred. Nested permission probe was NOT EXERCISED (a reported missing function is not a denied-write event). Reasoning lexical counts grew but cannot establish generated reasoning. The post-close report exports execution as unknown despite native completed; that reporting finding is preserved separately. Hosted gates remain unverified. [Hosted evidence and stop report](research/evidence/hosted-2.0.1-2026-10-16/REPORT.md). Runtime-reported usage: 14,442 tokens, three model calls, USD 0.022023 estimated; underlying model and turn count unavailable. The native slot is free; no worker process or private runtime directory remains.

### Second hosted start reported — 2026-10-16

A later target-machine record (branch `explore_project_details`, commit `7f1ca6d`, not merged; see below) reports that the second authorized start was used afterwards, on source `2a49abd`: hosted edit run `6074df5d-6d51-4a44-ab1c-78fdadea76f2` completed `end_turn` in its detached worktree without a backend error and was rejected by its frozen acceptance contract, because the worker imported `strict as assert` from `node:assert` instead of `node:assert/strict` and omitted `node:test`. It also reports the post-close export fix observed in use (`state: closed` separate from `execution_state: completed`, start time and duration kept) and a structured reasoning observation (`streamed_entries=0`, `history_entries=0`, `history_audited=true`). One authorized start, the disconnect, remains unused. No evidence packet for this run is on main, so `hosted-review-edit-confirmation` stays open; both rejections are worker answer-quality failures, with supervisor isolation, permissions, events and cleanup observed working.

### Owner decision — 2026-10-16: worker answer quality is a documented limit; publish

The owner chose option (a): no further hosted allowance for the review and edit. `hosted-review-edit-confirmation` is recorded as `OWNER_ACCEPTED_LIMITATION` in `docs/acceptance.json`, not passed, and the limit is stated in the README, [security](docs/security.md#what-is-not-isolated), compatibility and the changelog. Publishing follows the evidence: the bytes the target tested are archive `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e` from `44dc6f8`, so v2.0.1 is tagged at `44dc6f8` and published from the target-held assets; main's later changes (`2a49abd` reporting fixes, the run schema's `execution_state`, documentation) go into 2.0.2. While the disconnect and the clean-account installation are open, v2.0.1 is published as a pre-release; it becomes the latest release once both are recorded. The release notes are on the v2.0.1 GitHub release.

To publish, on the target Mac, from a checkout of main and the folder that holds the tested delivery (the archive `7978719c…`, `preparation-kit-2.0.1.tar.gz`, the SBOM, the packaging report and their `SHA256SUMS`). The first command asks for that folder; the second refuses unless the archive hash matches the tested one, then creates the tag at `44dc6f8` and the pre-release:

```bash
read -r DELIVERY
```

```bash
cd "$DELIVERY" && test "$(shasum -a 256 vibe-supervisor-2.0.1.tgz | cut -d' ' -f1)" = 7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e && shasum -a 256 -c SHA256SUMS && gh release create v2.0.1 --repo crew-lab/codex-vibe --target 44dc6f815c1b80ac75c0ce2613373e38ed2421c8 --prerelease --title "Vibe Supervisor 2.0.1" --notes-file release-notes.md vibe-supervisor-2.0.1.tgz preparation-kit-2.0.1.tar.gz sbom.spdx.json acceptance.json SHA256SUMS
```

If the kit is still a folder rather than `preparation-kit-2.0.1.tar.gz`, pack it first with `tar -czf preparation-kit-2.0.1.tar.gz preparation-kit-2.0.1` and add it to `SHA256SUMS`. Once the disconnect and the clean-account installation are recorded, `gh release edit v2.0.1 --repo crew-lab/codex-vibe --prerelease=false --latest` makes it the latest release.

### Owner decision — 2026-10-16: the target may fix code

The earlier rule that the target records evidence and changes no code is replaced. The target may fix code it finds broken, on a branch from main that it pushes for review; it never pushes to main or publishes, a code fix makes a new candidate whose earlier evidence does not transfer, and the coordinator reviews the branch (private-path scan, `npm run verify:release`) and merges it. This matches what happened: the target authored `44dc6f8` (the package and kit identity binding) and `2a49abd` (execution provenance and reasoning counts), which were reviewed and merged. The rule is in [AGENTS.md](AGENTS.md#code-changes-on-the-target-machine), the strategy's working rules and the [target acceptance procedure](docs/target-acceptance.md).

### Owner decision — 2026-10-16: spend the last start on the disconnect

The owner authorized the one remaining hosted start for the MCP-client disconnect only (authorization 5, gate `mcp-client-disconnect-hosted`), following the [disconnect procedure](docs/target-acceptance.md#disconnect-procedure) on the installed 2.0.1 candidate with the native readiness already verified. It is not a retry of the review or the edit, and no further hosted start is authorized. Stop at the first failure; record the client and observer outputs with the placeholders from AGENTS.md on an evidence branch and push it for review. The review and edit rejections stay recorded as worker answer-quality failures; `hosted-review-edit-confirmation` stays open.

Prompt for the target agent:

```text
Fetch main (at b275b1b or later) and read Handoff.md, section "Owner decision — 2026-10-16: spend the last start on the disconnect". Using the installed 2.0.1 candidate, re-verify native readiness, then run the one authorized hosted start as the MCP-client disconnect only, following docs/target-acceptance.md#disconnect-procedure with scripts/disconnect-client.mjs and scripts/disconnect-observer.mjs. Stop at the first failure; no retry, no other hosted start. Record the client and observer outputs with the AGENTS.md placeholders on a new evidence branch from main, check the pass criteria in the procedure (observed_running true, settled_before_disconnect false, server_exited true, state_after_reconnect "failed" with the no-replay diagnostic), update the gate mcp-client-disconnect-hosted in docs/acceptance.json, and push the branch with make push-branch for review. Do not merge to main or publish.
```

After the branch arrives, the coordinator scans it for private paths, runs `npm run verify:release`, and merges it into main.

### Local reporting and probe repair — 2026-10-16

The closed-review export defect is repaired in source: execution outcome is persisted independently of close state, and the first observed running callback records a start time that later callbacks/close preserve. Closed records written without an outcome remain unknown; inference-only durations are not fabricated. A terminal count-only `reasoning_observation` diagnostic replaces the lexical watcher, retaining structured streamed/history counts and audit coverage while leaving content/credential filtering intact. Zero counts establish none observed, not absence of provider generation. The nested probe is source-checked against pinned Vibe: `tools.file_system.write_file({path, content})`; the reported `writeFile` error did not test that path. [Prepared continuation and labeled review task](docs/hosted-continuation.md) preserves the original unused edit/disconnect allocations; a review retry needs an explicit budget decision. Local `verify:release` passed under Node 20.19.0/npm 10.8.2: lint, typecheck, build, 89 files/1,305 tests, acceptance, secret scan and SBOM. Lifecycle/privacy/projection regressions and local document links also passed. The repair is `2a49abd`, now on main, separate from the selected frozen candidate. These source changes are not installed or packaged; the selected 44dc6f8 candidate, frozen evidence and existing preparation receipt remain unchanged. No hosted start, conformance rerun, installation/switch or publication is included in this local repair.

### Repository actualized — 2026-10-16

Main's documents now agree with this evidence: `docs/acceptance.json` records the corrected archive (`7978719c…`, candidate `8b1b7dd5…`) as `frozen_archive_sha256` and `packaging_time_snapshot`, moves the package/kit identity, no-inference conformance, installed and native readiness and Node 20.19.0 floor gates to `VERIFIED` for that archive, and keeps the hosted review/edit (rejected), disconnect (pending, authorized), `permission = "ask"` (both halves observed, per-tool report not in the repository), thinking-off, experiments and nested-gating (NOT EXERCISED) gates open; `hosted_allowance_remaining` is 1, for the disconnect only. The SBOM, packaging-report and kit-file hashes of that delivery are not in the evidence on main. The run schema now lists `execution_state`. Checks: 89 files, 1,305 tests.

### Source becomes 2.0.2 — 2026-10-16

Main's changes after `44dc6f8` are version 2.0.2, unreleased: the reporting fixes of `2a49abd` and `41070f5` (execution outcome and start time kept through close, the structured `reasoning_observation` counts, the run schema's `execution_state`, a reworded export message) and documentation. Launch, the pin, the read-back, approvals, the event validator, cleanup, packaging and the conformance script are unchanged. Both package manifests say 2.0.2. `docs/acceptance.json` now names 2.0.2 as the candidate with `frozen_archive_sha256` and `packaging_time_snapshot` null; the 2.0.1 archive's identity and snapshot are under `evidence_builds`, its passed gates are the `v2.0.1-archive-*` entries, and each open 2.0.2 gate's `carry_over` proposes whether the 2.0.1 evidence is a basis and what 2.0.2 still needs. Changelog entry `## 2.0.2`; the release notes are on the v2.0.2 GitHub release.

## Latest target evidence reconciled after main synchronization

Main source is now 2.0.2 at `4a84930`. The synchronization and reconciled working tree passed `verify:release` on Node 20.19.0 (89 files, 1,305 tests), plus evidence hash/private-path and local-link checks. The installed target remains version 2.0.1 from source `2a49abd`, archive `133e77bdf20fc1cc839d3f0e5bfcdc644aa5ec09e4eb02558fb43cd1b8d191a8`, candidate `1c3c135862e2fe888428a2bf67fc6cd02fe9852259a494e7d624e2a3e96a45c0`. This is different from the earlier source `44dc6f8`/archive `7978719c…` selected in the publication plan. The late target evidence below supersedes statements elsewhere that the disconnect start is unused or that the earlier archive is currently selected. Frozen artifacts and earlier records are not rewritten.

The disconnect passed on the reporting-repair target; all three original starts are consumed. The per-build PASS is recorded in acceptance.json, not transferred automatically to the earlier publication archive or new 2.0.2 bytes. Next: submit this sanitized evidence for coordinator review, explicitly resolve archive/carry-over identity before release promotion, complete the owner's clean-account gate, then prepare the new 2.0.2 packet in the order below. No further hosted run, merge into main or release publication follows from synchronizing this branch.

### Reporting repair installed — 2026-10-16

Committed source `2a49abd` passed full `package:rc` under Node 20.19.0/npm 10.8.2 (89 files, 1,305 tests), mandatory final archive/kit verification and separate independent offline installation. Frozen archive SHA-256 `133e77bdf20fc1cc839d3f0e5bfcdc644aa5ec09e4eb02558fb43cd1b8d191a8`; candidate/kit identity `1c3c135862e2fe888428a2bf67fc6cd02fe9852259a494e7d624e2a3e96a45c0`. Side-by-side install, unchanged 783-file Vibe pin, doctor and one matched no-inference preparation check PASS. All four existing roots/settings retained; no roots added. After dry-run review, private rollback backups were retained and Supervisor registration/skill link switched. SDK readiness and exact five-tool catalog PASS. At installation time native readiness was pending reconnect and correctly refused the old candidate; the subsequent restart entry below records verified native readiness on the new build. No hosted start occurred. Two original edit/disconnect starts remain unused; do not retry the rejected review or start through a stale connection. Installation report and checksums are retained in the separate install-2a49abd-20261016 evidence packet; original packets and receipts remain unchanged.

### Reconnected candidate and hosted edit rejection — 2026-10-16

Native review/edit readiness now PASS on candidate `1c3c135862e2fe888428a2bf67fc6cd02fe9852259a494e7d624e2a3e96a45c0`: preparation PASS, eligible fixture, free slot, no blockers and exact five-tool catalog. One bounded edit completed/end_turn but automated contract verification rejected its actual patch: test file omits `node:test` and the specified `node:assert/strict` import (its alternative strict alias is strict, but the frozen check remains unmet). No repair, retry, fallback or integration occurred. Close records a hash-bound rejected assessment; dirty worktree retained, source fixture unchanged, no worker/private runtime directories remain, slot free. The reporting changes are observed: recorded start time, completed execution preserved separately from closed/rejected, and structured counts zero with history audited. Two of the original three hosted starts are now used; the disconnect start remains unused because the sitting stopped at deterministic failure. Hosted acceptance remains unverified. Sanitized packet hosted-2a49abd-20261016 retains specification, patch, checks, model/usage observations, assessments and checksums.

### Hosted disconnect PASS — 2026-10-16

The last authorized start tested a distinct classification task through the official MCP client on installed source `2a49abd`/candidate `1c3c135862e2fe888428a2bf67fc6cd02fe9852259a494e7d624e2a3e96a45c0`. PASS: running at disconnect, server exited, worker groups gone and lock absent in the first post-exit sample, saved run failed without replay, private directories removed and source unchanged. The observer finished 479 samples over its fixed window. Native saved-run read initially hit another live owner; it released externally without any signal/override, then native close removed the clean worktree. [Disconnect evidence](research/evidence/disconnect-2a49abd-2026-10-16/REPORT.md). A per-build gate is verified; no evidence transfers to the older global packaging snapshot. All three originally authorized hosted starts are now used. The earlier review and edit remain rejected, so combined hosted acceptance is incomplete. Further hosted work requires a new allowance. Evidence/handoff changes are local and uncommitted; no code, installation, push, merge, publication or deployment change was made in this continuation.

### Frozen 2.0.2 prepared — 2026-10-16

Evidence branch pushed at `347bf79`; draft review PR #9 records the exact-build disconnect evidence. Source `347bf79` then produced 2.0.2 archive `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09`, candidate/kit `eaa40320873caf810900cf201862695a82e1dc499807bb81ca25235b955d12c1`. Exact Node 20.19.0/npm 10.8.2 package:rc PASS (89 files/1,305 tests), mandatory and independent offline identity checks PASS, side-by-side installation with all four roots/settings retained, unchanged 783-file Vibe pin and doctor PASS. One matched no-inference prepare check PASS; installed SDK readiness and exact five-tool catalog PASS. Registration/skill link switched after dry-run review with private rollback backups. Native readiness passed after restart on 2026-10-17. [2.0.2 packet record](research/evidence/release-2.0.2-347bf79-2026-10-16/REPORT.md). Source acceptance metadata now names this exact new frozen archive; its original packaging report is unchanged. No hosted run or publication occurred. Clean-account installation and explicit carry-over confirmation remain owner gates; no automatic transfer from either 2.0.1 archive is asserted.

### Parallel target evidence & 2.1 Wave 0–3 branches — 2026-10-17

Two parallel remote branches have advanced alongside `origin/explore_project_details`:
- **`origin/codex/package-kit-identity` (`6faee25`, 2026-10-17)**:
  - `347bf79`: Recorded `VERIFIED` for 2.0.1 `mcp-client-disconnect-hosted` (run `a341b66f-04e0-45f3-b811-180bb26ce1ac` on the installed 2.0.1 candidate `8b1b7dd5…`; `observed_running=true`, `settled_before_disconnect=false`, `server_exited=true`, `state_after_reconnect="failed"` with `VSUP_PROCESS_TERMINATED`, zero leftover processes or private runtime directories).
  - `1f906e8` & `a3c9631`: Packaged 2.0.2 on the target from `b275b1b` under Node 20.19.0/npm 10.8.2 (archive `84bff9411b63188051a8ca7c025d362ac5a0f08b532f37dc0e9a01b9ba0f4437`, candidate/kit `eaa4032009dc7db754471b0be3c5de57f4d1d067baef0999d6664cfdc179c202`), verified side-by-side install, pin, `doctor`, one `prepare check` PASS, registration switch with rollback, and native desktop 2.0.2 readiness after restart.
  - `6faee25`: Added the 2.0.2 carry-over assessment and `docs/clean-account-checklist.md`.
- **`origin/claude/2.1-wave-1` (`0d7119a`, 2026-10-16)**:
  - Implemented 2.1 Wave 0–3 and cold-review fixes for items 1 (`usage.tool_calls`, `max_tokens`/`max_cost_usd`/`max_model_calls`, cross-session `runs list/show/tail`), 2 (`runs usefulness`), 3 (`excluded_globs` per allowed root), and 6 (`approvals.json` ledger + `pin` in `runs export`).

### 2.1 in progress — 2026-10-16 / 2026-10-17

Plan items 1, 2, 3 and 6 are implemented on branch `claude/2.1-wave-1` and merged into `origin/explore_project_details`, pending cold review and the coordinator's `verify:release`; nothing is merged to main, the package version is still 2.0.2 and no 2.1 archive exists. Design: [planning/2.1-designs.md](planning/2.1-designs.md), with the delivered shapes in [reference](docs/reference.md), [workflow acceptance](docs/workflow-acceptance.md) and the [changelog](CHANGELOG.md).

- Wave 0, `404b801`: contracts for usage counts and ceilings, `excluded_globs`, the approval ledger, the pin identity and the `runs` subcommand table; new `src/cli/runs.ts` (the bounded enumerator over the data root and at most 128 isolated sessions, so `runs list` spans them).
- Wave 1, `f6c852e`: tool-call counts in run records, per-workspace exclusions (validation, fingerprint, session configuration, handler, listing, schema, example), `runs usefulness`, and the ledger and pin in exports.
- Wave 2, `e4c1608`: exclusions, the pin identity and the ledger wired into the backend; `runs usefulness` reports zero runs without a data directory; `--excluded-glob` on the conformance script.
- Wave 4: review findings with `output: "findings"`, `schemas/findings.schema.json`, snapshot & exclusion safety validation (`src/core/findings.ts`), `findings.json` artifact, SARIF 2.1.0 conversion with stable rule fingerprints (`src/core/sarif.ts`), and `runs sarif <run-id>` CLI subcommand (`src/cli/runs/sarif.ts`).
- Wave 5: daily cost ledger and usage aggregation with `budgets.<root>.max_cost_usd_per_day` in configuration, rolling 24-hour usage aggregation across standard and isolated session runs (`src/core/usage-ledger.ts`), admission gating failing closed with `VSUP_BUDGET_EXCEEDED` and surfacing as a `vibe_status` readiness blocker, and `runs usage [--since <YYYY-MM-DD>] [--root <path>] [--json]` CLI subcommand (`src/cli/runs/usage.ts`).
- Reaper test: the reaper's deadline is fixed before startup begins, so the test of the reaper killing a wedged group (`tests/integration/app-server-backend.test.ts`) gave the run no room to start under parallel load. It now takes the startup allowance into the reaper margin. Test only; no runtime change.

Not done: items 7, 8 and 9 of the plan (and search sidecar). Four hosted observations are open as `UNVERIFIED` gates in `docs/acceptance.json` (`hosted-usage-recorded`, `hosted-excluded-glob-readback-and-denial`, `hosted-run-exported`, `hosted-close-acceptance-recorded`); they ride one hosted review and one hosted edit on a 2.1 archive, which needs a new owner allowance. The conformance script and schemas changed, so 2.1 ships its own candidate identity and kit.

### Antigravity execution backend integrated and hardened (Phases 1, 2 & 3) — 2026-10-17

Per user instruction, Google Antigravity execution backend support has been integrated onto the version 2.0.2 baseline on `origin/explore_project_details`, hardened and revalidated for `agy 1.4.0` with Phase 2 2.1-wave unification, `PreToolUse` hook enforcement, zero-inference `prepare check`, ADR 0008, and target acceptance gates (`src/backends/antigravity.ts`, `src/backends/antigravity-hook.ts`, `src/backends/antigravity/pre-tool-hook.mjs`, `src/preparation/antigravity-prepare.ts`, `src/security/workspace-guard.ts`, `src/core/run-manager.ts`, `src/config/config.ts`, `src/config/policy.ts`):
- **Phase 1 Hardening**:
  - **Real `agy` CLI Compatibility & Permission Hardening**: Removed invalid flags and removed permission bypasses. Added `--disable-slash-commands`, `--sandbox`, and `--print-timeout <timeoutSeconds>s`.
  - **Per-Run Private `HOME`/`TMPDIR` & Strict `settings.json`**: Created private per-run `antigravity-home` (`HOME`) and `antigravity-tmp` (`TMPDIR`) inside `input.runDir`, cleaned up automatically at run completion/close and by `removeLeftoverPrivateState()` on crash recovery. Writes `$HOME/.gemini/antigravity-cli/settings.json` with `toolPermission: "strict"`, `enableTerminalSandbox: true`, `allowNonWorkspaceAccess: false`, mode-scoped permissions, and denylist blocking bash, command execution, web, browser, MCP, and reserved/secret globs (`.git/**`, `.vibe/**`, `.gemini/**`, `.agents/**`, `.env*`, `*.pem`, `*.key`).
  - **Untrusted Project `.gemini` and `.agents` Extension Guard**: Added `assertNoProjectAntigravityExtensions(root)` in `src/security/workspace-guard.ts` and wired it into `RunManager.validateAdmission()` when `backend === "antigravity"`, failing closed with `VSUP_WORKSPACE_INVALID` if `.gemini`, `.agents/hooks.json`, `.agents/mcp_config.json`, or `.agents/plugins` exist.
  - **Watchdog Activity & Boot-Bound Policy Drift**: Wired `"antigravity"` events in `src/core/run-manager.ts` to call `this.noteActivity(...)` alongside `"vibe"`, and added `backend` and `paths.antigravity` to `configFingerprint()` and `BOOT_BOUND_SETTINGS` so changing either surfaces `boot_drift` and `restart_required: true`.
  - **Structured `stream-json` Envelope Metadata & Review Context**: Parsed `status` (`SUCCESS` / `ERROR` / `INVALID`), `usage` (`input_tokens`, `output_tokens`, `total_tokens`, `cost_usd`), `num_turns`, and `denied_actions` from the `stream-json` envelope; emitted `tool_denied` events for `denied_actions`, populated `UsageState`, failed closed (`VSUP_ANTIGRAVITY_EXEC_FAILED`) when `status` is `'ERROR'` or `'INVALID'`, included `buildWorkspaceListing(input.workerWorkspace)` in review prompts, and implemented `preparationCheck()` returning `candidateIdentity()`.
- **Phase 2 2.1 Unification & `PreToolUse` Hook**:
  - **Exclusions Wiring**: Passed `input.excludedGlobs` into `buildWorkspaceListing(input.workerWorkspace, input.excludedGlobs)` and appended excluded globs into `settings.json` `permissions.deny` for `read`, `edit`, and `write` tools.
  - **Tool-Call Usage Alignment**: Populated `usage.tool_calls` (`executed`, `denied_by_handler`, `denied_by_policy`) from `AntigravityBackend` tool execution and `denied_actions`.
  - **Deterministic `PreToolUse` Hook & Approval Ledger**: Supervisor-owned `pre-tool-hook.mjs` referenced in `$HOME/.gemini/config/hooks.json` intercepts every tool invocation before execution, evaluates `judgeWorkspacePath(workspace, toolPath, excludedGlobs)`, exits with code `2` on violations, and emits an audited `approvals.json` ledger compatible with `runs export`.
- **Phase 3 Preparation & Target Conformance (Revalidated for `agy 1.4.0`)**:
  - **Executable Pin & Doctor**: Extended `doctor`, `prepare check`, and `AntigravityBackend` to verify `agy 1.4.0` binary version and SHA-256 digest, rejecting unverified or drifted binaries.
  - **Unified Rule Syntax**: Populated `settings.json` `permissions.allow` (`read_file(...)`, `write_file(...)`) and `permissions.deny` (`command(*)`, `mcp(*)`, `read_url(*)`, `execute_url(*)`, `write_file(*)`, plus excluded, reserved, and secret paths) matching `agy 1.4.0`'s validated parser.
  - **Zero-Inference Preparation Check**: Implemented `runAntigravityPreparationCheck()` in `src/preparation/antigravity-prepare.ts` and wired into `vibe-supervisor prepare check`: validates `settings.json` and `hooks.json`, executes zero-inference slash-command read-backs (`/config`, `/hooks`, `/permissions`, `/skills` with `--output-format json` routed through a refusing loopback proxy), runs 6 synthetic `PreToolUse` hook checks, and generates `preparation-receipt.json` bound to the `agy 1.4.0` binary SHA-256 digest.
- **Verification & Review-Driven Hardening**:
  - **Authorization Audit Strict Identity Matching**: `readAntigravityHookLedger` rejects contradictory identity evidence fail-closed. An execution providing a `callId` must match an approval's verified ID; mismatched available fields (tool, canonical argument fingerprint, path) reject immediately rather than falling back to weaker matching. Executions without `callId` require a complete canonical fingerprint (`sha256(canonicalJson({ tool, args }))`); tool/path alone without matching ID or fingerprint is eliminated. Duplicate repeated call IDs and missing fingerprints reject fail-closed.
  - **Recursive-Search Timing Gap Closed**: In both `evaluateAntigravityToolCall` and embedded standalone `pre-tool-hook.mjs`, recursive search operations (`find_by_name`, `grep_search`) cannot be constrained during traversal by the host process, so they are denied fail-closed with `path_invalid` (or `path_excluded`/`path_reserved` when exclusions or reserved paths exist). Shallow `list_dir` is permitted when immediate children are verified clean of symlinks, secrets, exclusions, and reserved paths. Both evaluator and generated-hook boundaries are verified with negative regressions.
  - **Suite Verification**: 98 test files, 1,443 tests, lint, typecheck, acceptance checks, and secret scan pass cleanly.

### Owner strategic decision — 2026-10-17: Pivot from feature expansion to operational stability ("Working ASAP")

The owner decided on 2026-10-17 to halt the exploratory feature run (deferred: wheel candidate extraction scripts, review search sidecar, outreach and task template pipelines). The 2.1 line is frozen at the delivered Waves 0–5 (usage tool-call counts, ceilings, cross-session runs, usefulness, exclusions, approval ledgers, review findings & SARIF 2.1.0, daily cost ledger & per-root budgets) and the Antigravity execution backend. The strategic priority is to see the system working end-to-end immediately:
1. Target-level zero-inference conformance validation on the local `agy 1.4.0` installation (`antigravity-backend-no-inference-check`) using the repaired checker (`3fcf732`).
2. Live operational verification of real review and edit delegation on the target machine with verified hook enforcement and clean exports.
3. Branch convergence (`origin/codex/package-kit-identity`, `origin/claude/2.1-wave-1`, `origin/explore_project_details`) into main.
4. Stable, predictable everyday use with the active MCP tools.

## Historical release identity

- **Source.** `vibe-supervisor` 2.1.0 on main and on `origin/explore_project_details` (with Waves 0–5 and hardened `AntigravityBackend`). That recorded build was pinned to 2.26.1. The source, distributed archive, installed candidate and connected desktop server are distinct identities and need their own evidence.
- **2.0.1 archive.** Source `44dc6f8`, archive SHA-256 `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`, candidate and kit identity `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`, packaged on the target under Node 20.19.0/npm 10.8.2.
- **2.0.2 target archive (`origin/codex/package-kit-identity`).** Source `347bf79`, archive SHA-256 `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09`, candidate and kit identity `eaa40320873caf810900cf201862695a82e1dc499807bb81ca25235b955d12c1`, packaged on the target under Node 20.19.0/npm 10.8.2, with native desktop 2.0.2 readiness verified on 2026-10-17.
- **Release status.** The owner deleted the unpublished v2.0.0 draft on 2026-10-15. On 2026-10-19 the owner deleted the earlier published releases, keeping their tags. Pre-releases `v2.0.1` (tagged at `44dc6f8` with tested archive `7978719c…`) and `v2.0.2` (tag corrected to its true source commit `347bf79` with exact old-value lease `b275b1b`, preserving prior tag identity `v2.0.2-pre-correction-b275b1b` and tested archive `84bff941…`) are published on GitHub by the owner with their respective release notes, SBOMs, and preparation kits. Active unreleased development proceeds on the 2.1.0 line.
- **The workflow candidate's evidence.** Source `91afad4`, frozen archive SHA-256 `d1fd22ec04e50048c052cdf013b4d235b525dffc2efb11596dd29f8253003f6a`, installed distribution identity `a3600f7632ea42a221d342734dd1b6cb17deaaf072211693a728e31c0437b053`, on macOS arm64 with Node 24.21.0 and the installed Vibe 2.26.1, 2026-10-15: release verification passed (1,260 tests in 87 files), the offline installed-package smoke passed, the no-inference conformance check passed once with a fixed fake key and no inference, installed readiness through the official SDK passed and rejected a wrong expected candidate, and the validation helper passed a real npm offline fixture. Zero hosted starts. The sanitized records are the evidence packet at commit `2e920d3`; `docs/acceptance.json` summarizes them under `evidence_builds` and the `workflow-candidate-*` entries.
- **Installations.** Version 2.0.2 from frozen source `347bf79` is installed and selected with persistent Node 20.19.0, matched preparation PASS and installed SDK readiness. Native desktop readiness passed after restart on 2026-10-17 for both review and edit, with the exact installed candidate, matching preparation PASS, eligible workspace, free slot, no blockers and all five tools. Earlier installations, deliveries and rollback backups remain. No hosted allowance remains.
- **Owner decisions on record:** only the latest release is supported; the push token's `workflow` scope is skipped, so verification is local; Antigravity is supported both as an execution backend (`backend = "antigravity"`; since 2026-10-19 experimental, off unless `experimental.antigravity = true`, and not for production until its target probes pass) and as a verified MCP client alongside Mistral Vibe; the bounded workspace file listing in the prompt is in; ADR 0005's managed-configuration isolation and ADR 0006's bundled skills ("Let vibe have own skills"); a Vibe implementation request already authorizes its task-scoped preparation (installing or switching the candidate, the no-inference check, adding only the named task root, settings and rollback kept), while extra hosted starts, broader roots, publication, deployment and unrelated global changes need their own yes; the main chat coordinates and verifies, Vibe implements, and a fallback implementer is used only after a verified rejection of the exported bytes; the repository keeps the name `codex-vibe` (2026-10-19); the clean-account installation is postponed (2026-10-19); the agent instructions name no model (2026-10-19).

**Settled decisions** (delegated to Claude by the owner; each keeps what is built and tested):
- Error codes: `invalid_api_key` → `VSUP_AUTH_REQUIRED`; `invalid_model` → `VSUP_BACKEND_ERROR` classified as configuration; `context_too_long`, `response_too_long` and a `length` stop → `VSUP_OUTPUT_LIMIT`; `rate_limit` → `VSUP_RATE_LIMITED`.
- Pin reach: the installed Vibe package's `RECORD` files only, against the manifest generated on the target; dependencies, `.pth`, the interpreter and `__pycache__` are documented as not covered. A shipped manifest derived from the published wheel is planned for 2.1.
- Off-profile calls: a call Vibe or the handler denies is recorded and the run continues; a call that runs without the handler's approval ends the run.
- Refusal: `completed`, with a refusal warning.
- Design choices: the Node reaper, the Keychain lookup in Node and the per-candidate manifest stay.
- Readiness checks that `vibe-app-server` exists, not the full pin; the full pin runs at each run start and in `doctor`. Readiness also requires the matching preparation pass.
- Budgets: `limits.max_tokens` and `limits.max_cost_usd` stay optional and unset by default.

## Remaining

| # | Step | Who | Needs |
|---|---|---|---|
| 1 | Done: the integration is on main (`6c645e3`), followed by the plan update (`29545fd`) and the pre-packaging cleanup (`3de455e`: code comments removed, a shipped example neutralized, the unverified plugin scaffold deleted) | — | — |
| 2 | Done 2026-10-15: the owner deleted the unpublished v2.0.0 draft; 2.0.1 is the first 2.x release. The 2.0.0 commit `f2c2119` stays in main's history | — | — |
| 3 | Done 2026-10-15: 2.0.1 packaged from `9d2bbde` (after the pnpm lockfile fix) under Node 20.19.0 with a dedicated offline cache; `package:rc` passed (88 files, 1,292 tests; offline smoke) | — | — |
| 4 | Done 2026-10-15: `validation prepare` passed with a populated pnpm store on a public fixture (nvm Node 20.19.0, pnpm 9.15.4) | — | — |
| 5 | Done 2026-10-15/16 on the target: 2.0.1 packaged from git (`44dc6f8`, archive `7978719c…`), installed side by side, pin and `doctor`, one `prepare check` PASS, SDK and native readiness PASS. Hosted: the review rejected on answer quality (one start); the edit rejected on its contract (a second start). Recorded in `docs/acceptance.json` | — | — |
| 6 | Done 2026-10-16 on the target (`347bf79` on `origin/codex/package-kit-identity`): the MCP-client disconnect passed on the installed 2.0.1 candidate | Target agent | — |
| 7 | Done 2026-10-17: Reviewed and merged `origin/codex/package-kit-identity` (`6faee25`, carrying 2.0.1 disconnect PASS and 2.0.2 target readiness PASS) into main; followed by convergence of `explore_project_details` (`f64db99`) into main | Coordinator | Step 6 |
| 8 | Postponed 2026-10-19 by the owner: clean-account installation of the frozen archive (`docs/clean-account-checklist.md`; no separate clean standard macOS account) | Owner | — |
| 9 | Done 2026-10-16: the owner documented worker answer quality as a limit and chose to publish the tested archive from `44dc6f8` as v2.0.1; main's later changes are 2.0.2 | — | — |
| 10 | Done 2026-10-17: Published v2.0.1 as a pre-release from the tested assets (`7978719c…`) tagged at `44dc6f8` with release notes and full asset bundle | Owner | — |
| 11 | Done 2026-10-17 on `origin/explore_project_details`: Phases 1, 2 & 3 hardening, 2.1 unification and target conformance of `AntigravityBackend` (Phase 1 `agy` CLI flags & `settings.json`, Phase 2 `excluded_globs` & `PreToolUse` hook emitting `approvals.json`, Phase 3 `agy 1.4.0` revalidation, zero-inference `prepare check`, ADR 0008, target acceptance gates) | Agents | — |
| 12 | Read the Mistral and OpenAI brand pages (decided 2026-10-19: the repository keeps the name `codex-vibe`) | Owner | Before the article goes out |
| 13 | Read the 2.0 article draft (`marketing/article/devto-2.0.md`) with its [editor notes](marketing/article/editor-notes.md) and [story sources](marketing/sources.md); update it for the workflow features and publish after the release with the AI-Assisted label and the `[UPDATE AT PUBLISH]` markers filled, in the marketing strategy's [order](marketing/strategy.md#6-next-actions-in-order) | Owner reads and publishes; agent fills the markers from the evidence | Step 10 |
| 14 | Done 2026-10-17: Checker repaired, Wave 4 & 5 delivered and verified (`d9c3726`); target zero-inference conformance check verified on local `agy 1.4.0`, closing `antigravity-backend-no-inference-check` (`3bb58cb`). Branch converged into main (`f64db99`) | Agents | Step G |
| 15 | Done 2026-10-19 (`212bd38`): reviewed and merged `claude/antigravity-fixes` (F1–F10, F14–F16, the opt-in, the agy probes in `prepare check`) | Coordinator | — |
| 16 | Run the [Antigravity probes](docs/target-acceptance.md#antigravity-backend-probes) on the 2.1.0 candidate and record the five `antigravity-*` gates; until then the backend stays experimental | Target agent | Step 15 and a 2.1.0 archive |

**2.0.2.** Steps A to D were completed on the target and recorded on `origin/codex/package-kit-identity` (`1f906e8`, `a3c9631`, `6faee25`).

| # | Step | Who | Needs |
|---|---|---|---|
| A | Done (`1f906e8`): Packaged 2.0.2 on the target from git at `b275b1b` under Node 20.19.0 (`84bff941…`, candidate `eaa40320…`) | Target agent | — |
| B | Done (`1f906e8`): Identity check of the 2.0.2 archive and kit, side-by-side install, `pin-manifest` and `doctor` PASS | Target agent | — |
| C | Done (`1f906e8`): One `prepare check` (no-inference conformance) on the 2.0.2 candidate, then installed SDK readiness PASS | Target agent | — |
| D | Done (`a3c9631`): Switched the desktop registration to 2.0.2 (rollback kept) and verified native readiness with `expected_candidate` after desktop restart | Target agent | — |
| E | Done 2026-10-17: Reviewed and merged `origin/codex/package-kit-identity` (`6faee25`) into main | Coordinator | D |
| F | Done 2026-10-17: Proposed carry-over confirmed; published on no-inference evidence without extra hosted runs per owner decision | Owner | E |
| G | Done 2026-10-17: Published v2.0.2 as a pre-release from the checked target-held assets (`84bff941…`) tagged at `b275b1b` with release notes and full asset bundle | Owner | F |

**CI active and verified.** The push token's `workflow` scope is present, `.github/workflows/ci.yml` is active, and GitHub Actions CI runs `verify:release` under Node 20.19 on macOS for every push and release tag (all recent runs verified PASS).

## Testing on another machine

Main is one thread: every former branch, the deleted v2.0.0 draft's commit `f2c2119`, the 2.0.1 cleanup, the workflow line and 2.1 waves are in its history, and GitHub holds `main` only. On another Mac (Apple silicon, Node 20.19 or later, Git):

```bash
git clone https://github.com/crew-lab/codex-vibe.git vibe-supervisor && cd vibe-supervisor && npm ci && npm run verify:release
```

`verify:release` needs no Vibe and no network beyond `npm ci`. To package offline, fill a dedicated npm cache with the locked versions first, then package; `package:rc` also writes `release/preparation-kit-<version>/`, which belongs to that archive:

```bash
CACHE="$PWD/.npm-offline-cache" && node -e 'const l=require("./package-lock.json");const s=new Set();for(const[k,v]of Object.entries(l.packages)){if(!k||v.link||!v.version)continue;s.add((v.name||k.slice(k.lastIndexOf("node_modules/")+13))+"@"+v.version)}console.log([...s].join("\n"))' | xargs -P 8 -n 1 npm cache add --cache "$CACHE" && VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc
```

The historical hosted procedure needed Vibe 2.26.1 and follows [docs/target-acceptance.md](docs/target-acceptance.md): after `pin-manifest`, run `vibe-supervisor prepare check --kit <absolute path of the kit> --config "$CONFIG"` once, because readiness and every start need its pass. The v2.0.0 draft archive (`f2c2119`, SHA-256 `485ecce3…`) is not a useful target build: it lacks the repairs above.

Deleting the remote branches that main already contains: completed on 2026-10-17 (`codex/package-kit-identity` and `claude/2.1-wave-1` deleted; GitHub holds `main` and active worktree branches).

## Open questions

**Only the target can answer** (each fails closed; the consequences are in the [strategy](planning/development-strategy.md#verification-model), and the [procedure](docs/target-acceptance.md) records which way each goes): whether a callback's `relatedEntryId` is filled at the entry or only in `detail`; whether handler-approved effects carry `approvalType` `ask` and `approvalSource` `user`; whether `agentConfig.maxTurns` is enforced; how long Vibe keeps a callback open; whether a large legitimate `write_file` fits the 8 MiB line cap; whether thinking off stops reasoning generation; whether `experiments.enable = false` stops the experiments request (a host-only proxy observation cannot say); which history entry kinds and notification methods a hosted run produces (the one hosted review on main produced `runtime/updated` and `session/updated` as ignored methods, no unknown entry kind, handoff or turn retry; its two approved reads did not fail on `relatedEntryId` or the approval metadata). The workflow candidate's no-inference check already showed that the real server leaves nothing in `tmp` after stdin EOF and sends `runtime/updated` at startup; rerun on this build before relying on either.

**For the owner:** whether to post the Mistral Discussion with the protocol questions (catalogue narrowing, a search builtin, omitting reasoning, honouring budgets, a protocol version, the stable callback name), whose answers would remove work; the vendor-wheel download for the shipped manifest; the next hosted allowance.

**Known limits of this state:** Linux and Windows code paths exist without a support claim; the validation helper blocks project manager configuration, local dependencies and required build scripts until a reviewed profile exists.

## Evidence rules

Vibe is never installed, run or tested on the preparing machine; questions about Vibe are answered from its tagged source, checked against the hashes in [compatibility](docs/compatibility.md#source-basis). Behavior is proven only on the target machine, with the owner's authorization and budget for each step, and the target records evidence. The target may fix code it finds broken, on a branch from main that it pushes for review; it never pushes to main or publishes, a code fix makes a new candidate whose earlier evidence does not transfer, and the coordinator reviews the branch (private-path scan, `npm run verify:release`) and merges it. Evidence names the exact source, archive and installed distribution it belongs to, and never transfers to other bytes. Evidence uses the placeholders in [AGENTS.md](AGENTS.md#recording-target-evidence) from the start, because the repository is public. Missing evidence stays "unverified".

## Pointers

Shipped: [functionality](docs/functionality.md), [reference](docs/reference.md), [security](docs/security.md), [compatibility](docs/compatibility.md) (source basis, gates and diagnostic reasons), [target acceptance](docs/target-acceptance.md), [workflow acceptance](docs/workflow-acceptance.md), [preparation](docs/preparation.md), [validation workspaces](docs/validation-workspace.md), [errors](docs/errors.md) (generated), `docs/acceptance.json` (machine-readable gates), [ADR 0004](docs/adr/0004-app-server-client.md), [ADR 0005](docs/adr/0005-target-conformance-repairs.md), [ADR 0006](docs/adr/0006-bundled-vibe-skills.md), [ADR 0008](docs/adr/0008-antigravity-execution-backend.md), the coordinator skill `skills/vibe-supervisor`.

Source repository only, not shipped: the [development plan](planning/development-plan.md) and its [2.1 design sketches](planning/2.1-designs.md), [marketing/strategy.md](marketing/strategy.md), [marketing/interest.md](marketing/interest.md), [marketing/sources.md](marketing/sources.md), [marketing/article/](marketing/article/editor-notes.md), [research/features-2026-10-14.md](research/features-2026-10-14.md), [research/antigravity-2026-10-14.md](research/antigravity-2026-10-14.md). The workflow candidate's evidence packet is at commit `2e920d3`.

| Area | Code |
|---|---|
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, policy reread and readiness receipts, saved-run routing after `--isolated` reconnect | `src/core/`, `src/config/policy.ts` |
| App-server client: backend, JSON-RPC transport, protocol subset, session configuration and read-back, managed-config endpoint, bundled skills, approval handler, event validator, usage and outcome mapping, pin check, credentials, workspace listing; the reaper | `src/backends/app-server.ts`, `src/backends/app-server/`, `src/process/reaper.ts` |
| Acceptance contracts, assessments and verification | `src/acceptance/` |
| Reports, private-file reads, model observations | `src/reporting/` |
| Preparation evidence and the dispatch gate | `src/preparation/`, `src/cli/prepare.ts` |
| Validation copies | `src/validation/`, `src/cli/validation.ts` |
| Worktrees, private-index export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `pin-manifest`, `serve`, `prepare`, `validation`, `runs` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release, conformance and coordinator scripts (only the conformance script ships, for the kit) | `scripts/` |

## Fixed scope and safeguards

Exactly five one-shot MCP tools; one owned active slot; canonical allowlists; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, extra hosted starts or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Bundled skills stay inside the same tool and path policy. The enforcement points and the pin are listed in the [strategy](planning/development-strategy.md#architecture-and-enforcement-points) and fixed by [AGENTS.md](AGENTS.md). Private runtime state stays private and evidence is sanitized; uncertain cleanup retains files. These are application-policy controls, not an OS sandbox. Missing evidence remains unknown: the frozen archive has its target evidence up to the hosted runs, and no other platform or universal answer-quality guarantee is made.


### Test timeouts made load-robust — 2026-10-16

Six deadline tests in `tests/integration/app-server-backend.test.ts` used a one-second run deadline. The deadline covers the whole run, including spawning the fake server, `initialize` and the startup read-back, and under full parallel load startup can take most of that second, so the deadline fired before the turn started or clamped `initialize` to under a second ("Vibe did not answer initialize within 942 ms"). They now use a three-second deadline, and the late-callback test's delay and interrupt grace move with it so the callback still lands after the deadline and before the forced end. The file passed three runs alone and the full suite passed twice (89 files, 1,305 tests). Test-only; no runtime change. This is the third load-sensitive test fixed rather than retried, after the credential timeout race and the fake server's wedge readiness.

### Native 2.0.2 readiness confirmed — 2026-10-17

After the owner restarted the desktop, native review and edit readiness both passed against frozen source `347bf79`, archive `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09` and candidate `eaa40320873caf810900cf201862695a82e1dc499807bb81ca25235b955d12c1`. Preparation passed; workspace eligible; slot free; no blockers, drift or restart required; exactly five native tools. [Sanitized native addendum](research/evidence/release-2.0.2-347bf79-2026-10-16/NATIVE-READINESS-AFTER-RESTART-2026-10-17.json). Earlier pending records remain unchanged. No hosted start occurred. Clean-account installation and explicit carry-over confirmation remain open; no merge or publication occurred. The prior temporary checkout was absent after restart; the pushed evidence branch was recovered into a fresh isolated checkout, preserving the primary checkout.

### Carry-over review and clean-account blocker — 2026-10-17

The owner requested proceeding after native readiness. Source comparison from `2a49abd` to frozen `347bf79` finds no changes under core, process, backend, security, configuration or Git enforcement paths, supporting the proposed disconnect/handler carry-over; [assessment](research/evidence/release-2.0.2-347bf79-2026-10-16/CARRY-OVER-ASSESSMENT-2026-10-17.json). Original hosted results retain their original identities, and no new hosted PASS is claimed. Clean-account installation is pending because the owner reports no separate account available. The [checklist](docs/clean-account-checklist.md) prepares that step without substituting current-account isolation for a clean login. Carry-over confirmation, merge and publication remain separate decisions.

Coordinator review on Node 20.19.0/npm 10.8.2 passed `verify:release` (89 files, 1,305 tests, lint, typecheck, build, acceptance, secret scan and SBOM). The first sandboxed attempt failed on restricted local listeners/process operations; the unrestricted run passed without a code or policy change. The frozen archive checksum was rechecked and still matches. [Review record](research/evidence/release-2.0.2-347bf79-2026-10-16/REVIEW-2026-10-17.json). This review does not rebuild or replace the frozen delivery.

### Isolated readiness receipt-directory routing repaired — 2026-10-18

Phase 1 target installation identified that `vibe-supervisor serve --isolated` sets `VIBE_SUPERVISOR_HOME` to the per-connection session directory, while `prepare check` writes `preparation-receipt.json` into the selected configuration directory. `getManager`, `RunManager`, `IsolatedRunRouter` and backend construction now pass `preparationDataDir` explicitly from the selected configuration through ordinary serving and saved-session routing. Added official MCP SDK regression in `tests/integration/readiness-connection.test.ts` verifying that review and edit readiness under `--isolated` locate the receipt and report `eligible: true`, while corrupted or missing receipts refuse with `VSUP_INVALID_STATE`.

