# Development plan toward v1.0

Updated 2026-10-11. This is the current priority plan. It supersedes the execution order in the 2026-10-09 reduction plan and the historical ACP/100-run soak and efficiency proposals. Those records remain historical evidence.

## Goal and scope

Deliver a stable, useful one-shot review and isolated-edit workflow on macOS Apple silicon. Reliability and truthful outcomes come first; coordinator efficiency follows only after acceptance. Keep exactly five MCP tools, pinned Vibe 2.26.1, TypeScript 5.9.3 and existing dependencies. Codex coordinates, verifies patches and decides integration; GPT-6 Luna High is the implementation backup. A Luna repair is reported separately from a successful Vibe edit.

No ACP, continuation, task replay, queues, automatic patch application, worker shell/network, verification service, new platforms or plugin certification enters v1.0. Preserve allowlists, private child homes, filtered environments, source isolation, bounded output/deadlines, ownership, persistence and safe cleanup. Do not trade these controls for fewer features.

## Current state and evidence

| Area | Observed state | Remaining implication |
| --- | --- | --- |
| Runtime reduction and config/baseline preparation | Implemented in the reduced candidate line; offline checks pass | Verify the short operator workflow on the frozen candidate; do not reimplement the original reduction |
| Turn-limit diagnostics | rc.22 recognizes the corroborated runtime stop and reports partial completion truthfully | A capped result is not a completed task |
| Saved-run reconnect routing | rc.23 resolves a unique UUID across the same private session namespace under exclusive ownership | Live owners, unsafe paths, duplicate UUIDs and more than 128 entries fail closed |
| rc.23 local package | Final package verification passed: 570 Vitest tests, two skips, Python, lint, typecheck, build, acceptance, secret scan, SBOM and offline installed MCP smoke | Evidence applies to this archive and documented local environment |
| Previous real run | Installed rc.23 official client read and closed saved rc.22 run cb51c05f-5b99-4269-820f-da5a480d839c without starting a model | Saved-record access works; this is not hosted rc.23 or native Codex reload evidence |
| Local registration | Private rc.23 installed; only Codex CLI path updated with backup | Native reload/visibility remains to be demonstrated on the actual connection |
| Hosted/native disconnect | Previous run completed before the observer saw its Supervisor owner exit | UNVERIFIED; neither a passed disconnect test nor proof of a disconnect defect |
| Fresh macOS account | No candidate-specific acceptance receipt | UNVERIFIED |
| Minimum Node runtime | Declared floor 20.19.0; local rc.23 checks used 24.21.0 | Verify the actual floor before claiming it |
| Source/public delivery | This revision records rc.23 on integrated rc.22 main; no rc.23 release publication performed | Resolve source integration and release identity before calling it stable |

Exact implementation location: `tmp/turn-limit-fix`, based on rc.22 commit `d94541e3c4a495306b6575758593164e6e28527e`. The primary checkout is older and contains unrelated changes; it is not the runtime implementation baseline.

Frozen rc.23 archive SHA-256: `1dec1be1adcac0f96ad6d9ba453dd817977efdd3e76703ebc96acf4d65fa5998`.
Implementation patch SHA-256 at delivery: `bc27b5c04d882142e2218e7caf700d19143f11e4a666e54f0750644c8b843ff6`.
Private installation: `/Users/roman/.local/share/vibe-supervisor/rc23`.
Selected config remains `/Users/roman/.local/share/vibe-supervisor/rc20-config/config.toml`; its name does not indicate the installed runtime version.
Private local evidence is in `tmp/rc23-delivery/REPORT.md` and `tmp/rc23-delivery/report.json`; preserve it separately from public source. Documentation updated after the delivery freeze does not alter the installed archive.

## Priorities and exit conditions

### P0 — Establish one source of truth and preserve the candidate

Status 2026-10-11: preservation, reconstruction and focused rc.23 review completed. A separate local integration preview is prepared; the user has now authorized commit/push/merge. PR #2 and PR #3 were merged into main; this rc.23 revision proceeds through its own CI/merge workflow. See the [preservation and integration review](rc23-preservation-review-2026-10-11.md). Next independent priority: P1.

1. Use this plan for current work; preserve old Handoff/reduction/efficiency records with clear historical status.
2. Review the rc.23 source delta and its exact patch/archive identity. Inspect upstream branch/PR state before integration; this plan does not assume a merge or authorize one.
3. Preserve unrelated primary edits, retained dirty worker exports, previous archives, registration backup and private diagnostic receipts. Do not clean resources whose ownership/disposition is uncertain.
4. Create a reviewable source integration path for the reduced implementation and fixes. Publish or merge only with applicable explicit authorization. Avoid issuing another candidate for each documentation edit.

Exit: one identified source tree, one artifact/configuration/baseline bundle, clear ownership and a documented rollback. rc.23 offline work is already complete; rerun only checks justified by a changed source, failure or unresolved concern.

### P1 — Validate native reconnect and lifecycle without provider spend

1. After native reload, inspect the actual five-tool catalog and use status/result on the existing closed run. CLI version and official-client checks do not substitute for native visibility. Record the owning connection's version when observable; leave it unknown when unavailable.
2. Keep the passing installed MCP reconnect regression. Verify interrupted synthetic records become failed without backend launch, and active owner contention leaves records/locks unchanged.
3. Prepare a deterministic, test-only active-worker/disconnect fixture and observer. Arm observation before the disconnect trigger. Validate shutdown, saved state, owner-lock disposition and no replay without Mistral inference. Keep this test harness outside the production tool surface.
4. Account for owned processes and worktrees using live validated identities and fresh exports. Never signal a saved arbitrary PID or delete a live owner lock.

Exit: native saved-record access is recorded, the local disconnect procedure is reproducible, and cleanup/retention receipts are complete. Deterministic or official-client evidence does not close the real hosted native-disconnect gate.

### P2 — Close the remaining compatibility and fresh-account gaps

1. Exercise the frozen package on the declared Node 20.19.0 floor. Record exact runtime/OS/architecture and artifact hash. Do not silently change the declared floor or upgrade dependencies.
2. Prepare the fresh-account installation instructions, artifact, explicit config/allowlist, registration diff and rollback before asking the operator to create/sign in to a standard macOS Apple silicon account.
3. Perform install/config/doctor/native catalog checks there. Authentication remains unknown until a separately authorized real run; do not copy credentials or existing private histories into the new account.

Exit: floor-runtime and clean-account receipts have concrete outcomes. Account creation/sign-in and hosted use require the appropriate human participation/authorization; missing evidence stays UNVERIFIED.

### P3 — Perform one deliberately budgeted acceptance pass

Use one frozen runtime/artifact/config/baseline bundle. Define all tasks and expected outcomes before dispatch. The current documented hosted gate remains five sequential runs: one review, one isolated edit, then three additional review/edit runs. Do not quietly drop it or substitute older-candidate results.

Inventory previous authorizations and consumed runs before requesting a concrete allowance. The already spent disconnect attempt authorizes no retry. This planning update starts no hosted work. Fresh-account hosted work and real native active-disconnect work must be included explicitly in the approved test matrix or receive a separate bounded allowance; do not hide extra calls outside the five-run accounting.

A review needs a useful supported final answer and source integrity. An edit needs the expected nonempty patch, original checkout unchanged and independent coordinator verification. Record Vibe claims, Vibe outcomes and Luna repairs separately. Partial turn-limit completion fails task acceptance even when lifecycle settlement is correct.

For the native active-disconnect case, use the rehearsed observer and an explicit restart trigger. Evidence must show the original owner exiting while the worker is active, followed by verified termination and readable saved state after native reconnect. If the task finishes first, mark the case inconclusive and stop; do not grow the task or retry automatically.

Stop at the first failure. Preserve diagnostics and exports, then fix only a demonstrated defect with a meaningful regression. No account rotation, automatic retry, automatic budget increase or return to a 100-run soak.

Exit: candidate-specific hosted, authentication, native lifecycle and fresh-account gates are recorded with useful outputs and verified cleanup or explicit safe retention. Unknown usage/cost remains UNKNOWN.

### P4 — Make the v1.0 decision and deliver

Review the evidence as a whole: source/artifact/config identities, required offline and hosted outcomes, native lifecycle, fresh account, declared runtime compatibility and resource disposition. v1.0 requires all in-scope gates to pass; a prerelease with an explicit blocker is the outcome when a required gate remains unknown or failed.

Prepare final source integration, release notes, exact install/rollback instructions and a concise acceptance report. Tag/publish only with explicit release authorization. A v1.0 version change produces a new archive identity; verify/package that archive and state which evidence validates unchanged runtime behavior versus exact final-package installation. A material runtime change requires renewed relevant acceptance rather than relabeling old results.

## Deferred until after v1.0

Coordinator token/call measurements, additional context/polling optimizations, automated verification profiles, new agent orchestration features, ACP/continuation, broader platform support and plugin installation remain outside this sequence. Existing bounded waits and compact results remain supported. Make no savings claim without comparable accepted tasks and observed measurements.

## Operating and reporting rules

Every task has a small objective, owned paths, acceptance criteria and relevant context. Luna implementation must preserve other contributors' edits; the coordinator owns test execution, source integration and final acceptance. Reports separate source checks, installed official-client evidence, native Codex evidence, hosted inference and account installation.

A progress report names the frozen candidate, what passed, what failed/was inconclusive, what was not run, owned-resource disposition and the next single decision. Keep private histories, credentials and reasoning out of public bundles. This plan update changes documentation only and grants no additional spending, deployment, publication or account changes.
