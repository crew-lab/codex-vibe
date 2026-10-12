# Current handoff

Consolidated 2026-10-12. This document alone defines current priorities. Background: the [development plan](docs/history/development-plan-2026-10-11.md) and the [previous handoff](docs/history/handoff-before-consolidation-2026-10-12.md), whose older ACP, soak and release proposals are not the current work queue. The one active design kept under `docs/history/` is the [connection reliability proposal](docs/history/connection-strategy-2026-10-12.md), the P0 below; it lives there so it does not ship in the package.

## What this is

A local MCP stdio server (current candidate `0.9.0-rc.27`) that lets Codex delegate one bounded code review or one isolated edit at a time to Mistral Vibe 2.26.1. Codex sees five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result` and `vibe_close`. A review may only read and search an allowlisted workspace; an edit runs in a supervisor-created detached Git worktree and comes back as a patch, never applied, committed or pushed. Shell and network tools are off. This is an application policy boundary, not an OS sandbox.

| Area | Code |
| --- | --- |
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, saved-run routing after `--isolated` reconnect | `src/core/` (`run-manager.ts`, `owner-lock.ts`, `isolated-run-router.ts`) |
| Vibe adapter and pinned launcher (private homes, filtered environment and tools, persistence shim, turn-limit corroboration) | `src/backends/programmatic.ts`, `launcher.ts`, `profile.ts`, `runtime/vibe_supervisor_launcher.py` |
| Worktrees, patch export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `serve`, `runs` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release scripts (not shipped) | `scripts/` |
| Coordinator skill (shipped) | `skills/vibe-supervisor` |

Behaviour: [docs/functionality.md](docs/functionality.md); interface: [docs/reference.md](docs/reference.md); boundary: [docs/security.md](docs/security.md); Vibe assumptions: [docs/compatibility.md](docs/compatibility.md); errors: [docs/errors.md](docs/errors.md) (generated); gates: `docs/acceptance.json`. AGENTS.md lists the boundaries that must not change.

## rc.24 to rc.27 — built, not yet installed (2026-10-12)

rc.24 implements the P0 [connection reliability proposal](docs/history/connection-strategy-2026-10-12.md) on the preparing machine, against fake backends only:

- The server rereads the originally selected config before every readiness check and start; an approved allowlist change applies without restarting Codex. Session snapshots are audit records. Only `allowed_workspace_roots` is live; any other changed key gives `VSUP_RESTART_REQUIRED`. A missing, unsafe, group-writable or foreign-owned config fails closed. A root whose directory disappeared denies only itself.
- `vibe_status` with `workspace` and `operation` (and `base_ref` for an edit) is the native readiness check: current server version and instance, policy path and revision, eligibility and blockers, slot state, a non-launching runtime check, and a 10-minute signed receipt. No run, worktree or model call. Starts take an optional `readiness_receipt`; drift is rejected before launch with `VSUP_READINESS_RECEIPT_INVALID`, and an edit with a receipt runs on the exact commit checked.
- Runs record their admitting root and policy revision; removing a root denies later starts, and an admitted run's verified worktree can still be cleaned up.
- The skill starts every delegation with readiness; a missing tool is CONNECTION_FAILED, a blocker PREPARATION_FAILED, neither a Vibe result, and there is no silent fallback to Luna.
- A deterministic active-disconnect rehearsal (8 cases: plain and `--isolated`, review and edit, client close and SIGTERM) passes: the server exits, the worker's process group is gone, the lock is released, the interrupted run is `failed` and never relaunched, and an edit's worktree is kept until `vibe_close` cleans it.
- On exactly Node 20.19.0 (npm 10.8.2), a clean clone of main `7cbb0ed` installed offline and passed the full `verify:release` (606 tests passed, 2 skipped, 72 Python tests); a scan found no Node API newer than the floor. Running CI on exactly 20.19.0 and 24 is ready on the local branch `claude/ci-node-floor` but cannot be pushed until the push token has the `workflow` scope (the same block as `claude/release-workflow`); CI on main still uses the latest 20.19.x.

A cold review found three defects (one deleted root blocked every start and cleanup; a deleted base ref was misreported; narrowing the allowlist stranded worktrees) and the base ref being resolved twice; all fixed with regressions.

A cold review of the whole rc.24 surface ([report](docs/history/reviews/rc24-cold-review-2026-10-12.md)) found no blocker and no weakened boundary. rc.25 fixes its four should-fix items: tool errors are one JSON text block with `code`, `message`, `remediation`, `retryable` and `details`; Git failures are classified (`VSUP_GIT_REQUIRED` only for a missing Git or non-repository, otherwise `VSUP_TIMEOUT`, `VSUP_OUTPUT_LIMIT` or `VSUP_ARTIFACT_ERROR`); new `VSUP_OWNER_LOCKED` and `VSUP_PREPARATION_TIMEOUT` replace misused `VSUP_INVALID_STATE`; `allow` and `setup` no longer ask for a restart after an allowlist change. Its after-1.0 items A1 to A9 stay open in the report; of the old F7 to F15 only F12 (stdout capped by the transcript limit) remains.

rc.26 fixes the cold review's A2 to A6 and A9 (turn-limit detection tolerates the launcher's Keychain notice; settle waits for verified worker termination before exporting; a user close records cancelled; `doctor` accepts `~/` roots and allows 15 s for its version probe; ACP leftovers removed) and makes the suite reliable. A 25-run loop of rc.25's suite failed in 12 runs across 11 tests; all were test races or wall-clock budgets except the doctor probe's 2.5 s deadline, which security scanning of newly written executables can exceed. Wall-clock assertions are now structural, and the suite passed 6 consecutive full runs and 3 rounds of two concurrent full runs. A product note from that work: the MCP SDK's stdio client escalates to SIGKILL about 4 s after closing stdin, so a slow edit shutdown under a real client can be killed before the server's own 10 s deadline; the next start takes over the stale lock and marks the run failed, which is the designed recovery.

A read-only [v1.0 readiness assessment](docs/history/reviews/v1-readiness-assessment-2026-10-12.md) proposes the shortest path to 1.0 and lists remaining issues; its owner decisions are open (see Next priorities). It overstates one point: 2.26.1 did run inference once, on rc.22 (run `cb51c05f`, `end_turn`), but nothing after rc.22 has.

rc.27 applies the assessment's should-fix items. The most important is a correctness fix found on the way: an edit whose worker changed a file within the same second and kept its size could be exported as unchanged, silently dropping that change; the private export index now forces Git to re-hash content. Also: a 5-minute Git bound for worktree creation, export and cleanup status (quick queries keep 30 s) and the patch capped by `max_artifact_bytes`; the worker output stream capped by the event limit instead of the transcript limit; `runs cleanup` lists retained worktrees with the manual `git worktree remove` command; the dirty-baseline step removed from the shipped skill and README (commit or stash, then pass `base_ref`), with no shipped link to an unshipped path; docs for the snapshot's cost and for recovering a hand-pruned worktree.

rc.27 is the candidate for the target machine. `package:rc` passed: 621 tests passed and 2 skipped in 61 files, Python tests, lint, typecheck, build, acceptance, secret scan, SBOM, and the offline installed-package smoke test (including isolated concurrency and saved-run reconnect). On exactly Node 20.19.0 (npm 10.8.2), rc.24's source passed the same `verify:release`. Artifacts on the preparing machine at `/Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/0.9.0-rc.27/` (Git-ignored); check with `shasum -a 256 -c SHA256SUMS`:

```text
vibe-supervisor-0.9.0-rc.27.tgz  sha256 cb9c96a75d810d12a553755d1d606596658c537e5cb27b68f6aec227f44bece8
sbom.spdx.json                   sha256 3c3c6183af6299dfbc4771947dec1ffff52ef3bdaed2d45e6eba36459539e564
acceptance.json                  sha256 302ebae62c7022de4df67e8378d3ed90adc01805190083af8d07785897334154
```

Upgrading from rc.23 to rc.27: a hand-edited config that is group- or world-writable (for example 0664) is now refused; set it to 0600. Registrations need a reconnect to load the new code.

## Source and release identity

rc.23 source was integrated on GitHub main at `27a30c21e5488ea9dbf4ecb1e46fb3d2c93418db`; later commits on main up to this handoff change documentation only. PRs [2](https://github.com/crew-lab/codex-vibe/pull/2), [3](https://github.com/crew-lab/codex-vibe/pull/3) and [4](https://github.com/crew-lab/codex-vibe/pull/4) are merged; PR 4 CI passed. Its source commit is `c24d843c6273ac9036914c5bb10f080bb61054f3`. No rc.23 tag or public release has been created; the latest observed public prerelease is rc.22.

Two machines are involved. The **target machine** (the operator's Mac with Vibe, Codex desktop and the provider login) holds the installation and all private evidence; every `tmp/` and `/Users/roman/` path below is on it. The **preparing machine** never runs a real Vibe; it has source checkouts and offline release builds only (its `release/` folder stops at rc.17, so the rc.23 archive exists only on the target machine). On the target machine, the primary checkout remains an older dirty tree. Preserve unrelated edits; do not reset it or use its runtime as the rc.23 baseline. The committed integration checkout is under `tmp/rc23-preserved-20261011T191549Z/integration-preview`; the original working implementation remains under `tmp/turn-limit-fix`. Preservation and integration receipts are in that preserved directory, including `integration-delivery.json` and verified Git bundles. Private ignored evidence has no remote backup guarantee.

Frozen archive: `tmp/turn-limit-fix/release/vibe-supervisor-0.9.0-rc.23.tgz`.
SHA-256: `1dec1be1adcac0f96ad6d9ba453dd817977efdd3e76703ebc96acf4d65fa5998`.
Installed runtime files match this archive. Later documentation updates are not part of the frozen archive. See the [preservation review](docs/history/rc23-preservation-review-2026-10-11.md).

## Local installation and readiness

Private rc.23 is installed at `/Users/roman/.local/share/vibe-supervisor/rc23`; an explicit offline reinstall reported up to date. Codex registration selects its `dist/cli.js`. The selected config remains `/Users/roman/.local/share/vibe-supervisor/rc20-config/config.toml`; the directory name does not identify the runtime version. Previous installations remain available.

The installation doctor passes on Node 24.21.0, macOS Apple silicon, with pinned Vibe 2.26.1. Provider authentication and the current native server version remain UNVERIFIED; native tool visibility and saved-run access are verified. Receipt: `tmp/rc23-delivery/current-installed-doctor.json`. The selected allowlist includes the test fixture and the explicitly approved Garnebo root. Older connected session policies may differ; on-disk approval is not dispatch readiness.

The installed official MCP client successfully read and closed saved run `cb51c05f-5b99-4269-820f-da5a480d839c` without inference. After the operator restarted Codex on 2026-10-12, native status and result both accessed the closed saved run successfully: end_turn, no warnings, verified read-only integrity. The exact five-tool catalog is callable. This clears the previous VSUP_NOT_FOUND access blocker without inference. The returned supervisor_version rc.22 describes the historical saved record; it does not independently identify the current connection version. Native active-disconnect and hosted candidate acceptance remain open.

## What has been verified

The exact rc.23 package passed release verification: 570 Vitest tests with two skips, Python checks, lint, typecheck, build, deterministic acceptance, secret scan, SBOM and offline installed-package MCP smoke including saved-run reconnect. Full log: `tmp/rc23-package-final.log`. PR 4 CI passed. Documentation consolidation requires link and whitespace checks, not another hosted run.

rc.23 fixes saved-run lookup within the selected private session namespace while preserving exclusive ownership and fail-closed path checks. Turn-limit settlement may return a partial result; it does not establish successful task completion. The previous real disconnect attempt finished before disconnect was observed and remains inconclusive. Older UARoute trials are useful historical evidence, not rc.23 certification; Luna repairs must be reported separately from Vibe outcomes.

## Connection incident and revised priority — 2026-10-12

Garnebo dispatch was refused before run creation after an approved allowlist edit. Selected config and isolated session snapshots now contain different policy generations. Reading an old run was insufficient to establish workspace dispatch readiness. The [connection reliability proposal](docs/history/connection-strategy-2026-10-12.md) is the next P0: authoritative per-dispatch policy, native workspace preflight/current-server identity, and no automatic Luna substitution for connection preparation failures. Implemented in rc.24 (see above); native verification pending. Native saved-record access remains verified; readiness for a new project is not established by that fact.

## Next priorities

Owner decisions of 2026-10-12: the assessment's S1 to S7 are in rc.27; the 1.0 gates are native readiness, the five-run hosted matrix, a real active disconnect and provider authentication (`docs/acceptance.json` `unverified`). The live-allowlist and boot-key checks are optional, the clean-account install moves to 1.0.1, and the separate exact-20.19.0 CI job is dropped (`not_required_for_1_0`). Still open: publishing the candidate as a tagged GitHub prerelease (tags stop at rc.22; the README points users at a prerelease).

1. On the target machine, following the [rc.27 target runbook](docs/history/rc27-target-runbook.md): install rc.27 (authorized), reconnect Codex, and run the native readiness check for the fixture and Garnebo; confirm `server_version` is 0.9.0-rc.27. No inference needed.
2. In the same sitting, with a separately authorized budget: the five-run hosted matrix on rc.27 (review, edit, review to the turn limit, edit to the turn limit, review), each started with a readiness receipt, plus one real active disconnect (quit Codex mid-run). This also records provider authentication. Stop at the first failure; no automatic retry or account rotation.
3. Owner: publish the frozen candidate as a tagged GitHub prerelease (does not need the token's `workflow` scope). Optionally give the token that scope to push `claude/release-workflow` and `claude/ci-node-floor`.
4. Go or no-go. If steps 1 and 2 pass with no code change, rc.27 becomes 1.0.0 by version bump, changelog, `docs/acceptance.json` and Handoff only; re-run `verify:release` and `package:rc`, tag `v1.0.0` and publish. Any code change after step 2 means repeating the five runs. After 1.0: clean-account install (1.0.1), isolated session pruning, Handoff collapse, the launch article rewrite.

A new practical trial is appropriate after native readiness passes and its workspace, baseline, task, limits and provider budget are explicitly agreed. Codex coordinates independent verification; GPT-6 Luna High is the backup.

## Fixed scope and safeguards

Exactly five one-shot MCP tools; no ACP continuation/recovery, replay, queue, automatic patch application, worker shell/network or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Retain canonical allowlists, private child homes, filtered environments, redaction, bounded deadlines/output, owner locks and verified cleanup. This policy is not a kernel sandbox. Missing evidence remains unknown; rc.27 is not certified stable v1.0.
