# Implementation handoff

## rc.23 source integration — 2026-10-11

The user authorized commit, push and merge. PR #2 was merged as 49ba043b83afd8a7706a9addd53448f18887a505; PR #3 was retargeted to main and merged as b6a110179d11d2d3ce6cb7480a6866e983a33631. That main tree exactly equals the reviewed rc.22 base. This source revision records the rc.23 reconnect fix and updated plan on that integrated base; its PR must pass CI before merge. Earlier pending/no-commit statements below describe the preservation review before this integration.

The frozen installed rc.23 archive remains SHA-256 1dec1be1adcac0f96ad6d9ba453dd817977efdd3e76703ebc96acf4d65fa5998. Source documentation changed after the artifact freeze; no runtime changes or new hosted calls were added during integration. Private restoration, source equality and installed-package evidence are preserved in tmp/rc23-preserved-20261011T191549Z. Public release publication is separate from source integration and has not been performed for rc.23.

After CI and merge, the next development priority is P1: native saved-record access after reload and deterministic disconnect rehearsal without provider spend. Active hosted-disconnect, fresh-account, Node-floor and candidate-specific hosted acceptance remain open; v1.0 is not certified. Use the current development plan, preserve unrelated primary edits and prior candidates, and keep private histories/credentials out of public reports.

## rc.23 preservation and integration review — 2026-10-11

P0 preservation/review is complete. The frozen rc.23 archive, base Git bundle, delivered patch, separate later documentation patch, configuration/baseline and verification receipts are retained privately in `tmp/rc23-preserved-20261011T191549Z`. Reconstruction passed, 118 runtime/test/script/package files match, and installed files match the archive. Focused reconnect review found no blocking defect; its scope and limits are in the [review report](rc23-preservation-review-2026-10-11.md).

Upstream PR #2 and stacked PR #3 remain OPEN with CLEAN merge state and successful listed CI checks, as observed today; no formal review decision was recorded. The local `codex/rc23-reconnect-hotfix` integration preview is staged in a separate preserved checkout. No commit/push/merge/publication occurred. Integrate PR #2 → PR #3 → rc.23 only after the applicable authorization and fresh upstream checks; compare source trees if ancestry changes.

Next independent priority is P1: verify native saved-record access after reload and rehearse deterministic disconnect without provider spending. Installed official-client access to the prior rc.22 run is already proven; native reload, active hosted-disconnect, Node-floor, fresh-account and rc.23 hosted acceptance remain open. Preserve the exact archive identity and unrelated primary changes. Current source location remains `tmp/turn-limit-fix`; the staged preview path is recorded in the review report.

## Isolated UUID reconnection routing — 2026-10-11

An isolated MCP connection can select a different free session directory after a desktop restart, leaving a previously returned run UUID outside that connection's current store. `vibe_status`, `vibe_result` and `vibe_close` now search only the same private `mcp-sessions` namespace and route to a unique safe match while holding that directory's owner lock. Duplicate IDs, unsafe paths, active owners and namespaces over the scan bound fail closed. The temporary manager uses the active configuration and existing recovery rules; it does not replay work or start a backend. New runs remain in the current session. This does not identify the originating desktop connection or search other config roots.

Focused regression coverage exercises saved-run status/result/close, interrupted-run recovery without backend start, concurrent borrowed operations and shutdown draining, live-owner contention, duplicate IDs, symlinked paths and invalid UUIDs. Source checks in the clean implementation clone passed: 18 tests in `tests/unit/isolated-home.test.ts`, lint, typecheck, build and `git diff --check`. The coordinator's installed-package reconnect regression separately reproduced the old `VSUP_NOT_FOUND` behavior before the fix. Final rc.23 package verification and installed-package reconnect smoke passed (570 Vitest tests, two skips, Python and release checks). The installed official client also read and closed the original saved rc.22 run without inference. rc.23 is installed/registered locally; native Codex reload, real active disconnect, fresh-account and candidate-specific hosted acceptance remain unverified. See the [current development plan](development-plan-2026-10-11.md) for the ordered remaining work.

## rc.22 turn-limit diagnostic correction — 2026-10-10

The rc.22 candidate includes a narrow diagnostic correction on top of frozen rc.21. The pinned Vibe 2.26.1 legacy CLI exits with code 3 for a runtime turn-limit stop and prints `Stopped: turn_limit`; it can first print its workspace trust warning. The backend now corroborates that runtime outcome with the exact assistant stop marker for the configured turn limit. It reports `max_turn_requests` with an incomplete-result warning instead of `VSUP_BACKEND_CRASHED`. Other exits, conflicting diagnostics, wrong limits and signal termination are not treated as a turn-limit completion. Existing legacy code-1 marker handling remains supported.

No hosted inference, retry, budget increase, continuation or dependency upgrade is part of this runtime correction. Offline regressions reproduce the previously misclassified output and check persisted results, close and slot reuse. Validation evidence belongs to this changed source; it does not certify the installed rc.21 artifact or close the native-disconnect and clean-account gates.

On Node 24.21.0/macOS Apple silicon, the focused result-reporting suite passed 25 tests. Before the source fix, two realistic code-3 regressions failed. Full `npm run verify:release` then passed lint, typecheck, build, 57 Vitest files (564 passed, two skipped), 72 Python tests, deterministic acceptance, secret scanning and SBOM generation. Delivery packaging and local registration are separate from these source checks.

## Candidate scope

The development candidate is `0.9.0-rc.23`, reduced to one-shot review and isolated edit through exactly Mistral Vibe 2.26.1 using the validated legacy programmatic harness. It exposes exactly five MCP tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. One active run is allowed per owning server/storage instance; another start is rejected immediately. A run has one task, bounded turns/deadline/output, no interactive grants or input, and no continuation. After restart, interrupted work is marked failed and never resumed or replayed.

Reviews use allowlisted workspaces and read/search tools. Edits require a Git repository root and explicit `base_ref`, then execute in a supervisor-created detached worktree and return a patch for review. The supervisor does not apply, commit, merge or push worker changes. Shell/network remain disabled. This is application policy, not an OS sandbox.

## Configuration and reviewed baseline

Configuration is strict. Supported keys are version, canonical workspace allowlist, retention, bounded limits and `paths.vibe`; backend, capacity/queue, idle-session and ACP settings are removed. Explicit `--config` takes precedence, then `VIBE_SUPERVISOR_HOME`, then the reduced candidate's platform default root. Explicit missing/invalid configuration fails without fallback. Setup, allow, doctor, serve and preparation use the same selection rule. The reduced data root is separate from the earlier `VibeSupervisor` root.

Preparation is a coordinator-only source helper and runs before connection or inference. Its dry-run records selected config/runtime provenance, source HEAD/index/ref invariants, and selected input hashes/modes. Snapshot creation requires the dry-run manifest digest, revalidates the original source, and writes only to a private coordinator-owned snapshot repository. Verify the resulting complete inventory and base ref independently. A clean reviewed Git base skips snapshot creation. This authorization does not stage or commit the original checkout.

The documented operator path is: select artifact/config → initialize the explicit config with `allow` if absent → explicit doctor → baseline dry run → explicit snapshot creation when needed → independent byte verification → connect and verify handshake/catalog → one-shot edit → verify export → safe close. Doctor is not an authentication check. An existing desktop connection is not identified by a CLI or doctor report.

## Implementation and verification

The reduction removes ACP adapter and schemas, pending permission/input flows, continuation/recovery, queues and idle sessions. It also removes the ACP skill, ACP probe, pilot/audit/soak tooling, and the unused ACP SDK. Historical reports stay under `docs/history/` and do not transfer to this candidate. The MCP SDK and the lockfile remain pinned; no dependency upgrade is authorized. The Vibe source audit applies to the installed macOS/CPython 3.12 build only; other builds and OSes are not certified.

Preserve canonical allowlists (empty starter), private child homes, filtered environments, project isolation, pinned shim/signature checks, prompt-file handoff, secret/reasoning filtering, bounded output/deadline/watchdog, owner locking, atomic persistence, retention, process cleanup, fresh-export validation and safe worktree ownership. Interrupted records must remain inspectable without worker launch, task replay, session loading, permission restoration or saved-PID signaling. Settlement releases a slot only after backend close is verified; uncertain worker termination retains its handle, slot, worktree and owner lock for bounded retries through that live handle. Shutdown has bounded attempts but no fixed total-exit guarantee while ownership remains unresolved.

For code changes, run relevant focused tests, lint, typecheck and build. Local offline packaging and the installed-package smoke test are allowed as implementation verification. The exact proposed local installation/registration diff and rollback plan are drafted in [docs/local-install-registration-plan.md](local-install-registration-plan.md); installation for use, Codex configuration changes, publication, hosted inference, and account-budget actions remain separate actions requiring authorization.

## Acceptance status

`docs/acceptance.json` is the source of the candidate-specific machine-readable gates. Hosted review/edit, native five-tool lifecycle, provider authentication, and clean macOS Apple silicon account installation remain unverified until evidence is recorded against an exact frozen artifact. No successful earlier-release result certifies rc.23. Hosted acceptance is five total runs: one initial review, one initial edit, then three additional sequential review or edit runs. Stop at the first failure; no automatic retry, account rotation, or budget increase.

Record the exact source/tree and archive hashes, config/runtime provenance, implementation stages, removed surface/dependencies, checks actually run, source invariants, hosted stop reasons/run IDs when authorized, independent patch review, and verified cleanup or explicit retention reasons. Remove a worktree only after fresh artifact and ownership checks establish it is pristine; retain a dirty or uncertain worktree with its path and reason for review. Report unknown authentication, connection identity, platform support and model outcomes as unknown. Do not publish private histories, credentials or reasoning.

Historical implementation and test evidence is retained under [`docs/history/`](.). The [current development plan](development-plan-2026-10-11.md) supersedes the historical [reduction implementation specification](reduced-release-plan-2026-10-09.md). This documentation update is after the rc.23 delivery freeze; the installed archive is unchanged.
