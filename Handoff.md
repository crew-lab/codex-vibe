# Current handoff

Updated 2026-10-17. Status only: what the source, the archives and the installations are, what remains and who does it, what is open, and where the records are. The picture and the rules are in the [development strategy](docs/development-strategy.md); the sequenced work is in the [development plan](planning/development-plan.md); the boundaries are in [AGENTS.md](AGENTS.md).

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

The owner chose option (a): no further hosted allowance for the review and edit. `hosted-review-edit-confirmation` is recorded as `OWNER_ACCEPTED_LIMITATION` in `docs/acceptance.json`, not passed, and the limit is stated in the README, [security](docs/security.md#what-is-not-isolated), compatibility and the changelog. Publishing follows the evidence: the bytes the target tested are archive `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e` from `44dc6f8`, so v2.0.1 is tagged at `44dc6f8` and published from the target-held assets; main's later changes (`2a49abd` reporting fixes, the run schema's `execution_state`, documentation) go into 2.0.2. While the disconnect and the clean-account installation are open, v2.0.1 is published as a pre-release; it becomes the latest release once both are recorded. Release notes: [planning/release-notes-2.0.1.md](planning/release-notes-2.0.1.md).

To publish, on the target Mac, from a checkout of main and the folder that holds the tested delivery (the archive `7978719c…`, `preparation-kit-2.0.1.tar.gz`, the SBOM, the packaging report and their `SHA256SUMS`). The first command asks for that folder; the second refuses unless the archive hash matches the tested one, then creates the tag at `44dc6f8` and the pre-release:

```bash
read -r DELIVERY
```

```bash
cd "$DELIVERY" && test "$(shasum -a 256 vibe-supervisor-2.0.1.tgz | cut -d' ' -f1)" = 7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e && shasum -a 256 -c SHA256SUMS && gh release create v2.0.1 --repo crew-lab/codex-vibe --target 44dc6f815c1b80ac75c0ce2613373e38ed2421c8 --prerelease --title "Vibe Supervisor 2.0.1" --notes-file "$OLDPWD/planning/release-notes-2.0.1.md" vibe-supervisor-2.0.1.tgz preparation-kit-2.0.1.tar.gz sbom.spdx.json acceptance.json SHA256SUMS
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

Main's changes after `44dc6f8` are version 2.0.2, unreleased: the reporting fixes of `2a49abd` and `41070f5` (execution outcome and start time kept through close, the structured `reasoning_observation` counts, the run schema's `execution_state`, a reworded export message) and documentation. Launch, the pin, the read-back, approvals, the event validator, cleanup, packaging and the conformance script are unchanged. Both package manifests say 2.0.2. `docs/acceptance.json` now names 2.0.2 as the candidate with `frozen_archive_sha256` and `packaging_time_snapshot` null; the 2.0.1 archive's identity and snapshot are under `evidence_builds`, its passed gates are the `v2.0.1-archive-*` entries, and each open 2.0.2 gate's `carry_over` proposes whether the 2.0.1 evidence is a basis and what 2.0.2 still needs. Changelog entry `## 2.0.2`; notes: [planning/release-notes-2.0.2.md](planning/release-notes-2.0.2.md).

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
- Reaper test: the reaper's deadline is fixed before startup begins, so the test of the reaper killing a wedged group (`tests/integration/app-server-backend.test.ts`) gave the run no room to start under parallel load. It now takes the startup allowance into the reaper margin. Test only; no runtime change.

Not done: items 5, 7, 8 and 9 of the plan. Four hosted observations are open as `UNVERIFIED` gates in `docs/acceptance.json` (`hosted-usage-recorded`, `hosted-excluded-glob-readback-and-denial`, `hosted-run-exported`, `hosted-close-acceptance-recorded`); they ride one hosted review and one hosted edit on a 2.1 archive, which needs a new owner allowance. The conformance script and schemas changed, so 2.1 ships its own candidate identity and kit.

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
  - **ADR 0008 & Target Acceptance Gates**: Recorded the four-layer defense-in-depth isolation architecture in [ADR 0008](docs/adr/0008-antigravity-execution-backend.md), added deterministic check `antigravity-backend-settings-pretool-hook-ledger-and-prepare` and target gates `antigravity-backend-no-inference-check` and `antigravity-backend-hosted-review-edit` in `docs/acceptance.json` and `docs/compatibility.md`. Target evidence from 2026-10-17 in `research/evidence/antigravity-backend-2026-10-17/` is preserved; independent verification (report `01a13c77`) identified preparation checker gaps (mock exit-42 fallback, invented control validation), and the gate is marked UNVERIFIED pending checker repair.
- **Verification**: Tests in `tests/unit/antigravity-backend.test.ts`, `tests/unit/config.test.ts`, and full release verification pass cleanly.

## Release identity

- **Source.** `vibe-supervisor` 2.0.2 on main (`b275b1b`) and on `origin/explore_project_details` (with hardened `AntigravityBackend`). Vibe remains pinned to 2.26.1. The source, distributed archive, installed candidate and connected desktop server are distinct identities and need their own evidence.
- **2.0.1 archive.** Source `44dc6f8`, archive SHA-256 `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`, candidate and kit identity `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`, packaged on the target under Node 20.19.0/npm 10.8.2.
- **2.0.2 target archive (`origin/codex/package-kit-identity`).** Source `347bf79`, archive SHA-256 `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09`, candidate and kit identity `eaa40320873caf810900cf201862695a82e1dc499807bb81ca25235b955d12c1`, packaged on the target under Node 20.19.0/npm 10.8.2, with native desktop 2.0.2 readiness verified on 2026-10-17.
- **Release status.** The owner deleted the unpublished v2.0.0 draft on 2026-10-15. The earlier published major remains untouched. v2.0.1 is the tested archive from `44dc6f8`, tagged there and published as a pre-release by the owner from the target-held delivery (commands above). 2.0.2 is packaged and verified on `origin/codex/package-kit-identity`, awaiting clean-account confirmation and release publication.
- **The workflow candidate's evidence.** Source `91afad4`, frozen archive SHA-256 `d1fd22ec04e50048c052cdf013b4d235b525dffc2efb11596dd29f8253003f6a`, installed distribution identity `a3600f7632ea42a221d342734dd1b6cb17deaaf072211693a728e31c0437b053`, on macOS arm64 with Node 24.21.0 and the installed Vibe 2.26.1, 2026-10-15: release verification passed (1,260 tests in 87 files), the offline installed-package smoke passed, the no-inference conformance check passed once with a fixed fake key and no inference, installed readiness through the official SDK passed and rejected a wrong expected candidate, and the validation helper passed a real npm offline fixture. Zero hosted starts. The sanitized records are the evidence packet at commit `2e920d3`; `docs/acceptance.json` summarizes them under `evidence_builds` and the `workflow-candidate-*` entries.
- **Installations.** Version 2.0.2 from frozen source `347bf79` is installed and selected with persistent Node 20.19.0, matched preparation PASS and installed SDK readiness. Native desktop readiness passed after restart on 2026-10-17 for both review and edit, with the exact installed candidate, matching preparation PASS, eligible workspace, free slot, no blockers and all five tools. Earlier installations, deliveries and rollback backups remain. No hosted allowance remains.
- **Owner decisions on record:** only the latest release is supported; the push token's `workflow` scope is skipped, so verification is local; Antigravity is supported both as an execution backend (`backend = "antigravity"`) and as a verified MCP client alongside Mistral Vibe; the bounded workspace file listing in the prompt is in; ADR 0005's managed-configuration isolation and ADR 0006's bundled skills ("Let vibe have own skills"); a Vibe implementation request already authorizes its task-scoped preparation (installing or switching the candidate, the no-inference check, adding only the named task root, settings and rollback kept), while extra hosted starts, broader roots, publication, deployment and unrelated global changes need their own yes; the main chat coordinates and verifies, Vibe implements, and GPT-6 Luna/high is the fallback only after a verified rejection of the exported bytes.

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
| 7 | Review and merge `origin/codex/package-kit-identity` (`6faee25`, carrying 2.0.1 disconnect PASS and 2.0.2 target readiness PASS) into main | Coordinator | Step 6 |
| 8 | Clean-account installation of the frozen archive (`docs/clean-account-checklist.md`) | Owner | — |
| 9 | Done 2026-10-16: the owner documented worker answer quality as a limit and chose to publish the tested archive from `44dc6f8` as v2.0.1; main's later changes are 2.0.2 | — | — |
| 10 | Publish v2.0.1 as a pre-release from the tested assets with [planning/release-notes-2.0.1.md](planning/release-notes-2.0.1.md), per the commands in the owner decision above; `--latest` once steps 7 and 8 are recorded | Owner | — |
| 11 | Done 2026-10-17 on `origin/explore_project_details`: Phases 1, 2 & 3 hardening, 2.1 unification and target conformance of `AntigravityBackend` (Phase 1 `agy` CLI flags & `settings.json`, Phase 2 `excluded_globs` & `PreToolUse` hook emitting `approvals.json`, Phase 3 `agy 1.4.0` revalidation, zero-inference `prepare check`, ADR 0008, target acceptance gates) | Agents | — |
| 12 | Decide the repository rename (`codex-vibe` → `vibe-supervisor`) and read the Mistral and OpenAI brand pages | Owner | Before the article goes out |
| 13 | Read the 2.0 article draft (`marketing/article/devto-2.0.md`) with its [editor notes](marketing/article/editor-notes.md) and [story sources](marketing/sources.md); update it for the workflow features and publish after the release with the AI-Assisted label and the `[UPDATE AT PUBLISH]` markers filled, in the marketing strategy's [order](marketing/strategy.md#6-next-actions-in-order) | Owner reads and publishes; agent fills the markers from the evidence | Step 10 |
| 14 | In progress 2026-10-17 on `origin/explore_project_details`: Phase 3 unification completed (`prepare check` extension, ADR 0008, target evidence preserved in `research/evidence/antigravity-backend-2026-10-17/`); independent review `01a13c77` identified preparation checker gaps, repairing checker before re-running gate per the [development plan](planning/development-plan.md#61-antigravity-execution-backend-hardening--21-unification-plan-phases-13) | Agents | Step G |

**2.0.2.** Steps A to D were completed on the target and recorded on `origin/codex/package-kit-identity` (`1f906e8`, `a3c9631`, `6faee25`).

| # | Step | Who | Needs |
|---|---|---|---|
| A | Done (`1f906e8`): Packaged 2.0.2 on the target from git at `b275b1b` under Node 20.19.0 (`84bff941…`, candidate `eaa40320…`) | Target agent | — |
| B | Done (`1f906e8`): Identity check of the 2.0.2 archive and kit, side-by-side install, `pin-manifest` and `doctor` PASS | Target agent | — |
| C | Done (`1f906e8`): One `prepare check` (no-inference conformance) on the 2.0.2 candidate, then installed SDK readiness PASS | Target agent | — |
| D | Done (`a3c9631`): Switched the desktop registration to 2.0.2 (rollback kept) and verified native readiness with `expected_candidate` after desktop restart | Target agent | — |
| E | Review and merge `origin/codex/package-kit-identity` (`6faee25`) into main | Coordinator | D |
| F | Confirm the proposed carry-over in `docs/acceptance.json` (`6faee25`) and decide whether one hosted review shows the reporting fix on a real run (`execution-provenance-on-hosted-run`, optional) | Owner | E |
| G | Publish v2.0.2 from the checked target-held assets with [planning/release-notes-2.0.2.md](planning/release-notes-2.0.2.md), tagged at `b275b1b` | Owner | F |

**The skipped `workflow` scope.** Until it is added, no workflow file can be pushed, so the repository has no CI. To unblock: at https://github.com/settings/tokens give the push token the `workflow` scope (fine-grained: "Workflows: Read and write" on `crew-lab/codex-vibe`), update the Keychain entry `crew-lab-codex-vibe-github-token` if the value changed, then push the local CI branch rebased onto the current line and watch its first run.

## Testing on another machine

Main is one thread: every former branch, the deleted v2.0.0 draft's commit `f2c2119`, the 2.0.1 cleanup and the workflow line are in its history, and GitHub holds `main` only. On another Mac (Apple silicon, Node 20.19 or later, Git):

```bash
git clone https://github.com/crew-lab/codex-vibe.git vibe-supervisor && cd vibe-supervisor && npm ci && npm run verify:release
```

`verify:release` needs no Vibe and no network beyond `npm ci`. To package offline, fill a dedicated npm cache with the locked versions first, then package; `package:rc` also writes `release/preparation-kit-<version>/`, which belongs to that archive:

```bash
CACHE="$PWD/.npm-offline-cache" && node -e 'const l=require("./package-lock.json");const s=new Set();for(const[k,v]of Object.entries(l.packages)){if(!k||v.link||!v.version)continue;s.add((v.name||k.slice(k.lastIndexOf("node_modules/")+13))+"@"+v.version)}console.log([...s].join("\n"))' | xargs -P 8 -n 1 npm cache add --cache "$CACHE" && VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc
```

Hosted behaviour needs Vibe 2.26.1 and follows [docs/target-acceptance.md](docs/target-acceptance.md): after `pin-manifest`, run `vibe-supervisor prepare check --kit <absolute path of the kit> --config "$CONFIG"` once, because readiness and every start need its pass. The v2.0.0 draft archive (`f2c2119`, SHA-256 `485ecce3…`) is not a useful target build: it lacks the repairs above.

Deleting the remote branches that main already contains (owner; it skips any branch that is not an ancestor of main):

```bash
git fetch --prune origin && for b in $(git for-each-ref --format='%(refname:strip=3)' refs/remotes/origin | grep -v -x -e HEAD -e main); do git merge-base --is-ancestor "origin/$b" origin/main && git push origin --delete "$b"; done
```

## Open questions

**Only the target can answer** (each fails closed; the consequences are in the [strategy](docs/development-strategy.md#verification-model), and the [procedure](docs/target-acceptance.md) records which way each goes): whether a callback's `relatedEntryId` is filled at the entry or only in `detail`; whether handler-approved effects carry `approvalType` `ask` and `approvalSource` `user`; whether `agentConfig.maxTurns` is enforced; how long Vibe keeps a callback open; whether a large legitimate `write_file` fits the 8 MiB line cap; whether thinking off stops reasoning generation; whether `experiments.enable = false` stops the experiments request (a host-only proxy observation cannot say); which history entry kinds and notification methods a hosted run produces (the one hosted review on main produced `runtime/updated` and `session/updated` as ignored methods, no unknown entry kind, handoff or turn retry; its two approved reads did not fail on `relatedEntryId` or the approval metadata). The workflow candidate's no-inference check already showed that the real server leaves nothing in `tmp` after stdin EOF and sends `runtime/updated` at startup; rerun on this build before relying on either.

**For the owner:** whether a second verified MCP client (Antigravity) is documentation plus evidence or the platform scope AGENTS.md forbids (the strategy recommends the former; 2.1 does not start without it); the repository rename; whether to post the Mistral Discussion with the protocol questions (catalogue narrowing, a search builtin, omitting reasoning, honouring budgets, a protocol version, the stable callback name), whose answers would remove work; the vendor-wheel download for the shipped manifest; the next hosted allowance.

**Known limits of this state:** Linux and Windows code paths exist without a support claim; `docs/development-strategy.md` ships inside `docs/` while pointing at unshipped files (`Handoff.md`, `planning/`, `marketing/`, `research/`), which should be settled by excluding it from `files` or moving it; the validation helper blocks project manager configuration, local dependencies and required build scripts until a reviewed profile exists.

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

Exactly five one-shot MCP tools; one owned active slot; canonical allowlists; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, extra hosted starts or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Bundled skills stay inside the same tool and path policy. The enforcement points and the pin are listed in the [strategy](docs/development-strategy.md#architecture-and-enforcement-points) and fixed by [AGENTS.md](AGENTS.md). Private runtime state stays private and evidence is sanitized; uncertain cleanup retains files. These are application-policy controls, not an OS sandbox. Missing evidence remains unknown: the frozen archive has its target evidence up to the hosted runs, and no other platform or universal answer-quality guarantee is made.


### Test timeouts made load-robust — 2026-10-16

Six deadline tests in `tests/integration/app-server-backend.test.ts` used a one-second run deadline. The deadline covers the whole run, including spawning the fake server, `initialize` and the startup read-back, and under full parallel load startup can take most of that second, so the deadline fired before the turn started or clamped `initialize` to under a second ("Vibe did not answer initialize within 942 ms"). They now use a three-second deadline, and the late-callback test's delay and interrupt grace move with it so the callback still lands after the deadline and before the forced end. The file passed three runs alone and the full suite passed twice (89 files, 1,305 tests). Test-only; no runtime change. This is the third load-sensitive test fixed rather than retried, after the credential timeout race and the fake server's wedge readiness.

### Native 2.0.2 readiness confirmed — 2026-10-17

After the owner restarted the desktop, native review and edit readiness both passed against frozen source `347bf79`, archive `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09` and candidate `eaa40320873caf810900cf201862695a82e1dc499807bb81ca25235b955d12c1`. Preparation passed; workspace eligible; slot free; no blockers, drift or restart required; exactly five native tools. [Sanitized native addendum](research/evidence/release-2.0.2-347bf79-2026-10-16/NATIVE-READINESS-AFTER-RESTART-2026-10-17.json). Earlier pending records remain unchanged. No hosted start occurred. Clean-account installation and explicit carry-over confirmation remain open; no merge or publication occurred. The prior temporary checkout was absent after restart; the pushed evidence branch was recovered into a fresh isolated checkout, preserving the primary checkout.

### Carry-over review and clean-account blocker — 2026-10-17

The owner requested proceeding after native readiness. Source comparison from `2a49abd` to frozen `347bf79` finds no changes under core, process, backend, security, configuration or Git enforcement paths, supporting the proposed disconnect/handler carry-over; [assessment](research/evidence/release-2.0.2-347bf79-2026-10-16/CARRY-OVER-ASSESSMENT-2026-10-17.json). Original hosted results retain their original identities, and no new hosted PASS is claimed. Clean-account installation is pending because the owner reports no separate account available. The [checklist](docs/clean-account-checklist.md) prepares that step without substituting current-account isolation for a clean login. Carry-over confirmation, merge and publication remain separate decisions.

Coordinator review on Node 20.19.0/npm 10.8.2 passed `verify:release` (89 files, 1,305 tests, lint, typecheck, build, acceptance, secret scan and SBOM). The first sandboxed attempt failed on restricted local listeners/process operations; the unrestricted run passed without a code or policy change. The frozen archive checksum was rechecked and still matches. [Review record](research/evidence/release-2.0.2-347bf79-2026-10-16/REVIEW-2026-10-17.json). This review does not rebuild or replace the frozen delivery.
