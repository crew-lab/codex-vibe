# Reduced stable release plan

Date: 2026-10-09. Status: implementation plan; runtime unchanged.

The owner approved reducing functionality after the Celle task fell back to Luna before Vibe inference. The first stable release supports one-shot review and isolated edit, followed by coordinator verification and explicit cleanup. Same-session correction is no longer a release requirement. Freeze unrelated feature work until this path passes.

## Baseline and implementation location

Plan against rc.18 source at `0e0cb6c9909952dbc915af57d13752c90ea63770`, whose release cut is `88bb58c8340815ca78f95ab90252a284c229072e`. The installed CLI reports rc.18. The current primary checkout is main at `291fc8c`, package rc.2, with unrelated dirty documentation and evidence. Do not implement the reduction on that obsolete runtime or overwrite its dirty files. Start an isolated checkout from the reviewed rc.18 source; preserve historical evidence and installed configuration. No commit, push, installation or release is authorized by this planning document.

The rc.18 lifecycle triage is stored at `docs/history/reviews/lifecycle-triage-2026-10-09.md` in that source revision. It reproduces denial selection (F8), response ordering (F7), saved-worktree identity (F15) and late creation after close (F11). Cutting ACP eliminates the supported F7/F8/F9 request paths; F11/F15 remain shared blockers and must be fixed, not deferred.

## Supported contract

| Surface | Reduced contract |
| --- | --- |
| Backend | Programmatic only, pinned Vibe 2.25.8 and existing legacy harness |
| MCP | Exactly five tools: review_start, edit_start, status, result, close, each with the existing vibe_ prefix |
| Capacity | One active run per owning server/storage instance; a second start is rejected immediately, never queued |
| Execution | One task, fixed turn/deadline/output limits, no interactive grants or input |
| Review | Approved workspace, read/search tools, explicit integrity result |
| Edit | Git repository root, explicit base_ref, supervisor-created detached worktree, reviewable export |
| Completion | Worker process released on settlement; completed means execution ended, not independently accepted |
| Close | Cancels live work; exports available work and performs cleanup only when ownership and fresh-export checks pass |
| Restart | Saved artifacts remain inspectable; interrupted runs are marked failed with an interruption diagnostic, never resumed or replayed |
| Corrections | New explicitly authorized run from a reviewed Git base; previous uncommitted patch is never silently assumed present |
| Platform | First release claims only macOS Apple silicon, after its documented installation and client checks pass |

Keep canonical allowlists (empty starter), source/path validation, disabled shell/network, private HOME/VIBE_HOME, filtered child environment, project discovery isolation, pinned shim/signature checks, secret/reasoning filtering, output limits, deadlines/watchdog, owner locking, atomic persistence, bounded retention and safe Git export/cleanup. Keep the MIT license and copyright. Retain TypeScript 5.9.3 and existing pinned dependencies except dependencies made genuinely unused by deletion; no upgrades.

One active run is a per-instance guarantee. Separate isolated Codex connections can still exist; do not imply machine-wide scheduling. Owner locking must continue to refuse a second manager for the same storage.

## Delete rather than hide

| Area in rc.18 | Action |
| --- | --- |
| `src/backends/acp.ts` | Delete ACP adapter and its registration/imports |
| `src/contracts.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts` | Remove continue/respond, pending-request/ACP session contracts and backend selection surface; preserve five-tool result and error bounds |
| `src/core/run-manager.ts` | Remove continuation, reattachment/session loading, permission responses, queue/draining, idle-session eviction/TTL and ACP capability routing |
| `src/core/run-state.ts`, `src/core/serialization.ts` | Remove new-run states for queueing, negotiation, pending input and recoverability; handle old saved records without launching or rewriting them |
| `src/core/policy-engine.ts` | Delete interactive request policy if unused after ACP removal; retain/rehome any shared path validation before deletion |
| `src/backends/programmatic.ts` | Remove unsupported continue/respond/recover stubs after simplifying the backend interface; keep managed termination and truthful stop reporting |
| `src/backends/launcher.ts`, `profile.ts`, runtime Python shim | Remove ACP-only branches after identifying shared code; keep private profiles, auth isolation, programmatic prompt-file handoff, watchdog and source validation |
| `src/config/*`, `src/cli/*`, `src/diagnostics/doctor.ts` | Remove ACP probing/paths, selectable backend, concurrency/idle options; retain setup, allow, explicit config diagnostics and isolated connection storage |
| `scripts/prepare-acp-edit-pilot.mjs` | Remove from active tooling |
| `scripts/audit-edit-run.mjs`, `soak*.mjs` | Remove ACP lifecycle/private-session audit machinery from release acceptance; retain historical reports outside release package |
| `skills/vibe-acp/` | Remove from the new package; replace shared skill guidance with a short one-shot workflow |
| Package and release docs | Remove ACP claims and plugin scaffolds from shipped surface; keep checked offline package/smoke/checksum/SBOM tools |

Remove `@agentclientprotocol/sdk` once no imports remain and update the lockfile through npm. Audit `@modelcontextprotocol/node` for actual use before removing it; keep official MCP SDKs still used by server/client smoke tests. Do not introduce replacement frameworks.

No dormant feature flags, compatibility wrappers that still launch ACP, or second backend retained “for later.” Historical Git revisions preserve removed functionality.

## Major fix: deterministic configuration and reviewed baseline preparation

The owner selected this fix explicitly. The Celle attempt failed before inference: the coordinator's default doctor invocation rejected configuration keys, then preparation was not executed because connection identity was unknown and snapshot commits were treated as prohibited. An explicit rc.18 doctor invocation using Codex's registered template configuration subsequently accepted its schema and passed pinned-Vibe/ACP initialization. That check encountered a separate filesystem write restriction; it did not establish hosted authentication or the native connection's runtime identity. Preserve these distinctions in the regression and report.

The fix is complete when the documented operator path can select an artifact/configuration, prepare reviewed dirty bytes, verify them and dispatch one isolated edit without consulting unrelated default configuration or requiring a live connection to prepare the baseline. It must not weaken path, secret, ownership or snapshot validation.

### M1 — One configuration resolver

- Use one shared resolver for CLI doctor, serve, setup output and coordinator preparation. Selection precedence is explicit `--config`, then the existing `VIBE_SUPERVISOR_HOME` config, then the platform default. An explicit invalid/missing config fails with its path; never silently fall back.
- Extend existing CLI/coordinator entry points to accept explicit config selection where absent. Preserve the preparation helper's default dry run and explicit `--create`; do not introduce another configuration store or MCP tool.
- Setup's generated registration must bind the exact executable and configuration through supported arguments/environment. Isolated server storage derives from that selected configuration while retaining canonical allowlists and private per-connection data. Doctor distinguishes template selection from effective isolated storage; template writability must not be mistaken for actual native-session writability.
- Return sanitized provenance through existing doctor/setup/preparation receipts: executable/runtime version, canonical selected config path and semantic config fingerprint. Define the fingerprint over a whitelist of nonsecret operational fields; do not include credentials, full environment or a config dump. Record the actual private data path separately, where available.
- Local CLI/version, registered executable/config and actual MCP handshake remain separate observations. Use existing handshake identity to verify the server version and five-tool catalog when dispatching. Missing configuration telemetry is recorded as unknown, not proof of broken preparation. Do not add a public identity tool or require hosted inference for configuration validation.

### M2 — Prepare first, connect second

Retain `scripts/prepare-reviewed-baseline.mjs` as a coordinator-only helper for reviewed dirty overlays. Its dry run validates selected bytes and source allowlisting against the explicitly selected configuration/runtime from M1. Preparation requires no live server, connection identity, provider authentication or ACP capability.

Document two supported inputs: a clean reviewed Git base, or the helper's independently verified disposable snapshot. Permission to execute preparation with `--create` includes its private snapshot commits and does not authorize commits, staging or ref changes in the original source repository. Make that distinction explicit in CLI help, the skill and the implementation task template; never combine a blanket no-commit instruction with a required snapshot workflow.

- Capture original HEAD, index hash, relevant refs, selected dirty/untracked file hashes and required file inventory. Revalidate source bytes before creating the snapshot; concurrent source changes invalidate the manifest rather than produce a mixed baseline.
- Create the snapshot in a coordinator-owned private repository within existing allowed roots. Independently verify the resulting base_ref, complete required-file inventory, file modes and hashes. A candidate is dispatchable only when the original source/index/refs remain unchanged and required snapshot bytes match.
- Keep strict refusal of secrets, reserved paths, unsafe links, unsupported entries and unreviewed ignored files. Preserve any existing narrowly reviewed public-template exception; add no blanket exceptions. Do not hydrate the baseline through Vibe or copy files into an active worker worktree.
- For partial preparation failure, return the actual failed stage and sanitized code plus exact owned resources retained or removed. Do not label an unexecuted helper as a script failure. Do not remove unowned files or begin inference with an incomplete snapshot.

### M3 — One short operational workflow

Document one path: select installed artifact/config → explicit doctor → baseline dry run → explicit snapshot creation if needed → independent byte verification → connect and verify catalog → one-shot edit → verify export → safe close. A clean Git base skips snapshot creation. Authentication is checked by the real run and reported separately from doctor.

Keep preparation instructions in the shared one-shot skill. The instruction to preserve dirty security changes must name the reviewed snapshot/base actually supplied to the worker. Unavailable prerequisites generate a specific blocker; they must not trigger global-config edits, guard bypasses, invented identity or automatic fallback to an unrelated default config.

Use one documented rc-specific config/data root for the new artifact. Retain current registration/configuration until installation of the reviewed replacement is separately authorized.

### Major-fix regression oracle

1. Default home contains Celle's obsolete keys, explicit new-artifact config is valid: explicit doctor and preparation select the valid file and pass their local checks; the default file remains byte-identical.
2. Explicit config missing, malformed or containing unsafe roots: named-file/stage diagnostic, no fallback, snapshot or worker.
3. Doctor, preparation and serve given the same selection: same effective policy fingerprint; server's private isolated storage is separately identified. No additional roots or inherited project configuration.
4. No live MCP server/authentication available: a valid manifest can still dry-run and prepare safely. Preparation's success makes no hosted-acceptance claim.
5. Dirty security changes plus an untracked required source/test file: snapshot bytes match, source HEAD/index/refs/files remain unchanged, base_ref includes all reviewed inputs.
6. Source changes between dry run and creation: preparation refuses stale hashes; no mixed snapshot is accepted.
7. Secrets/reserved paths/symlinks, permission failure or interrupted snapshot creation: fail closed, stage-specific receipt, exact resource disposition and no inference.
8. Fresh official client uses the selected reduced artifact/config: expected handshake version and five tools. Native desktop reload remains a separate check.

## Shared defects to resolve before hosted acceptance

1. **Worktree ownership (F15):** derive the expected canonical run-owned path and validate source/base/Git registration before close and retention removal. Matching patches or mutable saved metadata alone cannot authorize deletion. A swapped saved path must leave both worktrees untouched.
2. **Close during creation (F11):** serialize/track creation so close/shutdown accounts for a late worktree. Return a verified removal outcome or an explicit retained path/reason; never report complete cleanup and then leave an unreported worktree.
3. **Settlement/shutdown:** completed processes are released immediately; a late exit cannot overwrite settled state. Close/deadline races settle once. Interruptions never create a resumable promise. Saved PIDs never authorize termination.
4. **Capacity:** reserve the single slot before asynchronous preparation/launch and release it exactly once. Parallel starts must create no hidden queue or second worker.
5. **Direct-config roots (F10):** align validation with setup/allow restrictions, including broad/unsafe roots. Never grandfather a broader allowlist silently.

Simplify lifecycle only after these invariants have tests. Do not remove persistence, fault handling or process ownership merely because recovery is removed.

## Configuration and saved-data transition

Use a new isolated data/config root for the reduced artifact. Do not run migration, retention or cleanup against rc.18 storage. Old installations, configurations, worktrees and evidence remain available through the corresponding old executable.

Reject removed configuration keys with a clear remedy naming the selected file and supported replacement; do not ignore unknown keys. Update setup, examples, doctor, CLI help and offline smoke together. New startup validates its own saved records and marks its interrupted one-shot runs failed without worker launch, session load, task replay, restored grants or PID signaling.

Historical ACP records are outside the new runtime's mutation/cleanup contract. Do not add a general migration subsystem for this release. Any later migration requires a separate decision and tests.

## Implementation order

| Stage | Owned work | Exit condition |
| --- | --- | --- |
| P0 | Isolated rc.18 checkout; baseline and source invariants | Reviewed source identity, unrelated files preserved, no installed-runtime changes |
| P1 | M1 resolver/provenance in config, CLI, doctor and preparation entry point | Explicit-selection/default-home regression passes without global mutation |
| P2 | M2/M3 preparation and concise operator/skill instructions | Dirty-baseline, stale-input and failure-disposition regressions pass; source invariants verified |
| P3 | Shared F11/F15 ownership/creation fixes and settlement/capacity tests | Unsafe cleanup refused; close accounts for late worktree; no second worker |
| P4 | ACP/request/recovery/idle/queue deletion; contracts/config/state/tests | Five-tool programmatic-only surface; no dormant ACP paths; retained invariants pass |
| P5 | Launcher/dependency/docs/package alignment | No removed-feature imports or active instructions; offline verification and installed-package smoke pass |
| P6 | Separately authorized installation and bounded hosted/client checks | Exact frozen artifact/config/baseline tested; truthful outcomes and cleanup recorded |

P1/P2 fix the operational blocker before feature deletion; P4 updates their schema fixtures to the reduced configuration. P3 must pass before cleanup is exercised in hosted acceptance. Keep each stage independently reviewable. Do not cut a release candidate or change installed skills/configuration after every stage; package one integrated candidate after P5.

No additional functionality, runtime support or efficiency features enter this sequence. Implement in small reviewable deltas; no worker is required to implement the whole reduction in a single task.

## Verification that remains required

Retain meaningful security, process, Git, serialization, storage fault, secret filtering, prompt-file, profile, watchdog, artifact size, review-integrity and cleanup tests. Remove obsolete ACP/continuation/elicitation acceptance tests after replacing shared cases with programmatic equivalents; do not relabel their old results as evidence for the new candidate.

Required focused scenarios:

- Five-tool discovery and strict input rejection; no continue/respond/backend-selection fields.
- Simultaneous starts: exactly one launches, the other receives a capacity error, no queued record/worker.
- One-shot review with unchanged-source integrity and an actual final answer.
- Detached nested-file edit, nonempty exact patch, original checkout unchanged and independent candidate verification.
- Turn limit, deadline, no-progress, output overflow, auth/backend failure: truthful outcome and bounded release of owned workers.
- Close during preparation/creation/execution; late callback/exit; shutdown while active; storage failure during settlement.
- Restart with interrupted records: readable artifacts, explicit failure, zero task replay/session loading/PID signaling.
- F15 swapped metadata, unsafe paths, stale export and residual files: cleanup refused without deleting another run's data.
- Reviewed dirty-baseline helper: source/index/refs unchanged, reviewed bytes verified, unsafe inputs refused.
- Explicit config selection: valid artifact config passes parsing even when the default home contains obsolete keys; unsafe roots still fail.
- All eight major-fix regression cases above, with config/preparation/connection outcomes reported independently.

Run lint, typecheck, build, TypeScript/Python suites, acceptance, secret scan and SBOM; package offline with the populated cache and verify the installed executable's version, five tools and smoke result. Preserve the existing release verification commands; revise their acceptance oracle to this scope.

Replace the 100-run ACP soak gate with a small candidate-specific hosted session: one bounded review and one bounded edit, then three additional sequential review/edit runs on the same frozen artifact. Stop on the first failure; preserve diagnostic/artifact/cleanup evidence. No automatic retry, budget increase or account rotation. This plan does not authorize hosted spending; obtain a concrete allowance before inference. Fix a demonstrated failure and repeat the relevant scenario against a newly identified candidate before making a stability claim.

Native Codex checks must exercise actual five-tool discovery, one useful task, close and client disconnect while a run is active. Perform installation checks in a clean macOS Apple silicon account. Official-client tests do not substitute for these claims. No Intel/Linux/plugin/ACP gates apply to the reduced release because those capabilities are not claimed.

## Acceptance and report

Acceptance requires the reduced offline suite and installed-package smoke to pass, the bounded hosted/client/clean-account evidence to be recorded, and zero unexplained owned workers or unreported worktrees. A useful final answer and correct patch are separate from lifecycle correctness. A coordinator/Luna correction is not a Vibe success.

Deliver exact source/tree and archive hashes, configuration provenance, M1–M3 and P0–P6 results, removed public surface and dependency delta, actual check outcomes, hosted run IDs/stop reasons, independent patch verification, original-source invariants and verified cleanup or explicit retention receipts. Include a Celle-blocker regression receipt separating default-config refusal, explicit-config success, preparation execution and connection/authentication observations. Unknown authentication, connection identity, platform support and model outcomes remain unknown until observed. Never publish private histories, credentials or reasoning.

This replaces the larger stable-release acceptance scope for the proposed reduced candidate, not historical evidence. Runtime deletion, packaging, installation and publication remain future actions; this planning change performs none of them.
