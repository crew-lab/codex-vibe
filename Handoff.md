# Current handoff

Consolidated 2026-10-12. This document and the [development plan](docs/development-plan-2026-10-11.md) define current priorities. The [previous handoff](docs/history/handoff-before-consolidation-2026-10-12.md) preserves historical evidence; its older ACP, soak and release proposals are not the current work queue.

## Source and release identity

rc.23 source is integrated on GitHub main at `27a30c21e5488ea9dbf4ecb1e46fb3d2c93418db`. PRs [2](https://github.com/crew-lab/codex-vibe/pull/2), [3](https://github.com/crew-lab/codex-vibe/pull/3) and [4](https://github.com/crew-lab/codex-vibe/pull/4) are merged; PR 4 CI passed. Its source commit is `c24d843c6273ac9036914c5bb10f080bb61054f3`. No rc.23 tag or public release has been created; the latest observed public prerelease is rc.22.

The primary checkout remains an older dirty tree. Preserve unrelated edits; do not reset it or use its runtime as the rc.23 baseline. The committed integration checkout is under `tmp/rc23-preserved-20261011T191549Z/integration-preview`; the original working implementation remains under `tmp/turn-limit-fix`. Preservation and integration receipts are in that preserved directory, including `integration-delivery.json` and verified Git bundles. Private ignored evidence has no remote backup guarantee.

Frozen archive: `tmp/turn-limit-fix/release/vibe-supervisor-0.9.0-rc.23.tgz`.
SHA-256: `1dec1be1adcac0f96ad6d9ba453dd817977efdd3e76703ebc96acf4d65fa5998`.
Installed runtime files match this archive. Later documentation updates are not part of the frozen archive. See the [preservation review](docs/rc23-preservation-review-2026-10-11.md).

## Local installation and readiness

Private rc.23 is installed at `/Users/roman/.local/share/vibe-supervisor/rc23`; an explicit offline reinstall reported up to date. Codex registration selects its `dist/cli.js`. The selected config remains `/Users/roman/.local/share/vibe-supervisor/rc20-config/config.toml`; the directory name does not identify the runtime version. Previous installations remain available.

The installation doctor passes on Node 24.21.0, macOS Apple silicon, with pinned Vibe 2.26.1. Provider authentication and the current native server version remain UNVERIFIED; native tool visibility and saved-run access are verified. Receipt: `tmp/rc23-delivery/current-installed-doctor.json`. The selected allowlist includes the test fixture and the explicitly approved Garnebo root. Older connected session policies may differ; on-disk approval is not dispatch readiness.

The installed official MCP client successfully read and closed saved run `cb51c05f-5b99-4269-820f-da5a480d839c` without inference. After the operator restarted Codex on 2026-10-12, native status and result both accessed the closed saved run successfully: end_turn, no warnings, verified read-only integrity. The exact five-tool catalog is callable. This clears the previous VSUP_NOT_FOUND access blocker without inference. The returned supervisor_version rc.22 describes the historical saved record; it does not independently identify the current connection version. Native active-disconnect and hosted candidate acceptance remain open.

## What has been verified

The exact rc.23 package passed release verification: 570 Vitest tests with two skips, Python checks, lint, typecheck, build, deterministic acceptance, secret scan, SBOM and offline installed-package MCP smoke including saved-run reconnect. Full log: `tmp/rc23-package-final.log`. PR 4 CI passed. Documentation consolidation requires link and whitespace checks, not another hosted run.

rc.23 fixes saved-run lookup within the selected private session namespace while preserving exclusive ownership and fail-closed path checks. Turn-limit settlement may return a partial result; it does not establish successful task completion. The previous real disconnect attempt finished before disconnect was observed and remains inconclusive. Older UARoute trials are useful historical evidence, not rc.23 certification; Luna repairs must be reported separately from Vibe outcomes.

## Connection incident and revised priority — 2026-10-12

Garnebo dispatch was refused before run creation after an approved allowlist edit. Selected config and isolated session snapshots now contain different policy generations. Reading an old run was insufficient to establish workspace dispatch readiness. The [connection reliability proposal](docs/connection-strategy-2026-10-12.md) is the next P0: authoritative per-dispatch policy, native workspace preflight/current-server identity, and no automatic Luna substitution for connection preparation failures. This is proposed, not implemented. Native saved-record access remains verified; readiness for a new project is not established by that fact.

## Next priorities

1. Implement and verify the P0 connection proposal before another project trial: authoritative policy, workspace-specific native readiness and dispatch revalidation. Then rehearse active disconnect with a deterministic local fixture.
2. Verify exact Node 20.19.0 compatibility and prepare fresh standard macOS account acceptance with human participation and no credential copying.
3. Run a separately authorized, bounded candidate-specific hosted matrix, accounting explicitly for active disconnect and fresh-account inference. Stop at the first failure; no automatic retry or account rotation.
4. Decide v1.0 only after required gates pass. Tagging and release publication need explicit authorization.

A new practical trial is appropriate after native preflight passes and its workspace, baseline, task, limits and provider budget are explicitly agreed. The current readiness request starts no hosted work. Codex coordinates independent verification; GPT-6 Luna High is the backup.

## Fixed scope and safeguards

Exactly five one-shot MCP tools; no ACP continuation/recovery, replay, queue, automatic patch application, worker shell/network or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Retain canonical allowlists, private child homes, filtered environments, redaction, bounded deadlines/output, owner locks and verified cleanup. This policy is not a kernel sandbox. Missing evidence remains unknown; rc.23 is not certified stable v1.0.
