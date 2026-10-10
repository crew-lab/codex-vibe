# Implementation handoff

## Candidate scope

The development candidate is `0.9.0-rc.21`, reduced to one-shot review and isolated edit through exactly Mistral Vibe 2.26.1 using the validated legacy programmatic harness. It exposes exactly five MCP tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. One active run is allowed per owning server/storage instance; another start is rejected immediately. A run has one task, bounded turns/deadline/output, no interactive grants or input, and no continuation. After restart, interrupted work is marked failed and never resumed or replayed.

Reviews use allowlisted workspaces and read/search tools. Edits require a Git repository root and explicit `base_ref`, then execute in a supervisor-created detached worktree and return a patch for review. The supervisor does not apply, commit, merge or push worker changes. Shell/network remain disabled. This is application policy, not an OS sandbox.

## Configuration and reviewed baseline

Configuration is strict. Supported keys are version, canonical workspace allowlist, retention, bounded limits and `paths.vibe`; backend, capacity/queue, idle-session and ACP settings are removed. Explicit `--config` takes precedence, then `VIBE_SUPERVISOR_HOME`, then the reduced candidate's platform default root. Explicit missing/invalid configuration fails without fallback. Setup, allow, doctor, serve and preparation use the same selection rule. The reduced data root is separate from the earlier `VibeSupervisor` root.

Preparation is a coordinator-only source helper and runs before connection or inference. Its dry-run records selected config/runtime provenance, source HEAD/index/ref invariants, and selected input hashes/modes. Snapshot creation requires the dry-run manifest digest, revalidates the original source, and writes only to a private coordinator-owned snapshot repository. Verify the resulting complete inventory and base ref independently. A clean reviewed Git base skips snapshot creation. This authorization does not stage or commit the original checkout.

The documented operator path is: select artifact/config → initialize the explicit config with `allow` if absent → explicit doctor → baseline dry run → explicit snapshot creation when needed → independent byte verification → connect and verify handshake/catalog → one-shot edit → verify export → safe close. Doctor is not an authentication check. An existing desktop connection is not identified by a CLI or doctor report.

## Implementation and verification

The reduction removes ACP adapter and schemas, pending permission/input flows, continuation/recovery, queues and idle sessions. It also removes the ACP skill, ACP probe, pilot/audit/soak tooling, and the unused ACP SDK. Historical reports stay under `docs/history/` and do not transfer to this candidate. The MCP SDK and the lockfile remain pinned; no dependency upgrade is authorized. The Vibe source audit applies to the installed macOS/CPython 3.12 build only; other builds and OSes are not certified.

Preserve canonical allowlists (empty starter), private child homes, filtered environments, project isolation, pinned shim/signature checks, prompt-file handoff, secret/reasoning filtering, bounded output/deadline/watchdog, owner locking, atomic persistence, retention, process cleanup, fresh-export validation and safe worktree ownership. Interrupted records must remain inspectable without worker launch, task replay, session loading, permission restoration or saved-PID signaling. Settlement releases a slot only after backend close is verified; uncertain worker termination retains its handle, slot, worktree and owner lock for bounded retries through that live handle. Shutdown has bounded attempts but no fixed total-exit guarantee while ownership remains unresolved.

For code changes, run relevant focused tests, lint, typecheck and build. Local offline packaging and the installed-package smoke test are allowed as implementation verification. The exact proposed local installation/registration diff and rollback plan are drafted in [docs/local-install-registration-plan.md](docs/local-install-registration-plan.md); installation for use, Codex configuration changes, publication, hosted inference, and account-budget actions remain separate actions requiring authorization.

## Acceptance status

`docs/acceptance.json` is the source of the candidate-specific machine-readable gates. Hosted review/edit, native five-tool lifecycle, provider authentication, and clean macOS Apple silicon account installation remain unverified until evidence is recorded against an exact frozen artifact. No successful earlier-release result certifies rc.21. Hosted acceptance is five total runs: one initial review, one initial edit, then three additional sequential review or edit runs. Stop at the first failure; no automatic retry, account rotation, or budget increase.

Record the exact source/tree and archive hashes, config/runtime provenance, implementation stages, removed surface/dependencies, checks actually run, source invariants, hosted stop reasons/run IDs when authorized, independent patch review, and verified cleanup or explicit retention reasons. Remove a worktree only after fresh artifact and ownership checks establish it is pristine; retain a dirty or uncertain worktree with its path and reason for review. Report unknown authentication, connection identity, platform support and model outcomes as unknown. Do not publish private histories, credentials or reasoning.

Historical implementation and test evidence is retained under [`docs/history/`](docs/history/). The [reduced-release plan](docs/reduced-release-plan-2026-10-09.md) is the current source-only implementation plan; it is excluded from the published package.
