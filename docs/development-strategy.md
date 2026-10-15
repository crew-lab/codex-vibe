# Development strategy

The strategy defines the stable operating model. [Handoff](../Handoff.md) owns current status and the [consolidated plan](../planning/development-plan.md) owns the remaining backlog. Main's historical 2.1/2.2 roadmap is reconciled there with the seven implemented workflow enhancements; it must not schedule them again as wholly future work.

## Vision and scope

A local MCP supervisor delegates one bounded review or isolated edit to pinned Mistral Vibe. Exactly five tools, one active run per owning instance, supervisor-owned detached edit worktrees and explicit independent integration remain the product boundary. Reviews expose the permitted file-read profile; write-capable and other tools may remain visible but are denied outside policy. The application policy is not an OS sandbox.

There is one worker engine and one supported Vibe pin per candidate. Coordinator use of Luna/high after a verified failure does not add a Supervisor backend or authorize another hosted start. A different client or platform earns a version-specific support statement through its own evidence. Another Vibe release requires a new source audit, manifest and candidate.

## Current implementation

The workflow implementation at `91afad4` has frozen acceptance contracts, sanitized export, runtime model/usage observations, matched preparation evidence, conformance-aware readiness and reproducible validation copies. The [evidence packet](reviews/workflow-2026-10-15/README.md) records rc.5 release checks, actual no-inference conformance and official-SDK installed readiness. It records zero new hosted starts. Main is separately at source version 2.0.1; integration and release identity reconciliation remain in the plan. Package version, published release, selected installation and connected server are separate facts.

## Architecture and enforcement points

| Point | Enforcement and evidence |
|---|---|
| Admission | Canonical allowlist and immutable edit base; selected policy reread; one owned slot, strict schemas, owner lock and boot drift checks. Workspace eligibility is separate from conformance and expected-candidate agreement. |
| Preparation | Candidate-bound kit and private PASS receipt; no-inference script uses a fixed fake key and refusing observer. Starting a new check invalidates an older PASS. Pin/platform/Node/policy drift invalidates the binding; roots-only changes may reuse it. |
| Launch | Installed Vibe pin checked again; provider credential stays in private runtime; filtered environment, private HOME/VIBE_HOME/TMPDIR and owned process group. The task is sent only after read-back. |
| Configuration | Supervisor profile, exact tool denylist/permission checks, no inherited user/project tools/hooks/agents/MCP/trust/skills; only the exact pinned bundled catalogue is permitted. Owned loopback managed config does not enable worker network tools. |
| Permissions and events | Every grant is correlated to a validated call and offered option; unknown, stale or unsafe requests fail closed. Effects and histories are independently audited; watermark gaps, unapproved effects and unsafe handoffs stop the run. |
| Budgets and observations | Bounded turns/deadlines/output; usage continuity across validated handoffs; actual reported model name/alias/thinking and price observations. Costs are estimates and ceilings may overshoot one model call. Missing fields stay unknown. |
| Patch acceptance | Frozen exact path/text/hash assertions evaluate committed base plus exported patch in a private index. Saved bounded inputs support later verification. Worker summaries do not decide acceptance. |
| Coordinator decision | Execution, automated verification and assessment are separate. Acceptance binds patch/contract hashes and required coordinator validations. Corrections append rather than erase history. |
| Validation | Owned independent baseline/candidate copies; pinned offline managers/caches, hooks and scripts disabled, explicit unsupported-profile blockers. General project checks remain deliberate coordinator work. |
| Export | Sanitized projected metadata/diagnostics, evidence hashes and optional exact patch; no raw transcript, reasoning, provider secrets or private receipts. A sensitive patch is refused rather than rewritten. |
| Stop and cleanup | Revoked grants, bounded stop and owned-group termination, reaper backstop, private-state cleanup. Worker worktrees require a matching fresh export and residual-file checks; validation roots require ownership/content proof. Uncertainty causes retention. |
| Restart | Interrupted work fails; it is never replayed, resumed or granted saved permissions. Saved PIDs do not authorize arbitrary termination. |

[Security](security.md) and [behavior](functionality.md) describe the detailed boundaries. [ADR 0004](adr/0004-app-server-client.md), [ADR 0005](adr/0005-target-conformance-repairs.md) and [ADR 0006](adr/0006-bundled-vibe-skills.md) explain the engine and preparation/skill decisions.

## Verification model

| Layer | Proves | Does not prove |
|---|---|---|
| Tagged source audit | Wire/config assumptions with source hashes | Behavior of a running build or a different release |
| Deterministic fixtures | Contract, lifecycle, permission, recovery, Git and reporting regressions against defined observations | Provider behavior or another platform |
| Local release/package checks | Lint, strict types, build, tests, acceptance, secret scan, SBOM and offline installed catalog | Hosted inference, desktop registration, fresh-account installation or a different Node floor |
| Actual no-inference conformance | Pin, handshake, initialization, configuration read-back and cleanup for identified bytes/runtime | Hosted tool behavior, model thinking generation, or experiments attribution from host-only observation |
| Native/client readiness | Intended connection identity, eligibility and callable catalog | Authentication, answer quality or completed hosted work |
| Bounded hosted tasks | Recorded task behavior and independent artifact acceptance | Unlimited reliability, transfer to changed artifacts, unsupported clients/platforms |
| Clean-account/platform sitting | Installation, registration, rollback and applicable behavior for that environment | Other environments |

Record evidence against exact source/archive/distribution identity in [acceptance.json](acceptance.json). Partial observations stay partial. rc.2's earlier hosted Crew Bravo result and a Node floor result from another source do not verify rc.5. Main's release metadata and a CLI version do not establish the selected native connection.

## Releases

The published release, main source version, workflow candidate and selected install can differ. [Handoff](../Handoff.md) records their checked identities. The next integration must preserve main's completed cleanup and packaging fixes, reconcile versions and guard tests, and freeze new bytes after full verification. Candidate-specific receipts and hosted evidence do not silently transfer.

Frozen archives are immutable. A documentation update does not replace an accepted archive or retag a release. Packaging is regenerated only when delivering a new tarball, with a populated offline cache and no implicit network fallback. A stable claim needs the applicable floor, client, hosted and installation gates or an explicit limited prerelease description. Publication is an owner action with explicit authorization.

## Risks and dependencies

- Keep the dirty primary checkout, other chats and original worker outputs intact while integrating in isolation.
- The pin covers Vibe's installed RECORD distribution, not the interpreter, all dependencies, .pth or bytecode. It detects drift and is not proof of a trustworthy original build.
- Tool/catalog restrictions are application enforcement, and event checks can detect a breach without undoing it.
- No-inference network observation cannot attribute a purpose solely from a host name. Managed-config and experiments claims require their own observations.
- Offline validation currently rejects unsupported project manager configuration, local dependencies and required build scripts. It cannot promise every project builds; populated pnpm graphs still need demonstration.
- Keep source-only plans/evidence out of the npm package and reconcile documentation packaging during integration. Main's existing guard and neutral script names need explicit treatment.

## Marketing and partnerships

The [marketing strategy](../marketing/strategy.md), [interest note](../marketing/interest.md) and [research](../research/features-2026-10-14.md) inform the plan. Drafts are allowed within task scope; publishing, outreach, security messages, registry submissions and account actions require direct user instructions. Claims use exact version-bound outcomes and disclose unknown model/cost fields. Refresh external guidance before relying on old research. Repository naming and vendor independence remain owner decisions.

## Lessons from building 2.0

A fake tests our assumptions; source audit and actual observations must remain distinct. Strict wire fields, effective permissions, denied-vs-executed effect metadata and counter resets matter more than a plausible final message. Cold review caught lifecycle and approval defects after green tests.

The Crew Bravo patch exposed a coordinator mistake: its code contained the required disclosure while its final summary abbreviated it. The response is deterministic artifact acceptance, append-only correction history and accurate attribution. Do not spend another allowance or invoke fallback until the exported bytes establish a real implementation failure.

Preparation should be version-matched, bounded and observable. A missing installed script, dependency symlink outside a build copy, ambiguous readiness or accidental model-role assignment is workflow evidence to repair. It is not a reason to silently broaden permissions or replay a task. Keep Vibe's bundled skills within the existing tool/path policy.

## Working rules

- The main chat coordinates and independently verifies; Luna/high is fallback after verified implementation failure. Delegate only when the user or applicable instructions call for it, with named ownership and preservation of others' edits.
- An explicit Vibe implementation request covers necessary task-scoped preparation, installation/switching and the named root, preserving settings and rollback. No repeated separate approvals for those steps. Hosted starts still require their explicit budget; broader roots, publication/deployment and unrelated global changes remain outside scope.
- Keep deterministic failure stop rules and no replay. Diagnose, repair, then check changed artifacts; do not retry unchanged failures blindly.
- Select checks appropriate to the change. Runtime/release changes get the required regressions and release verification; documentation-only updates need links, consistency, JSON and diff checks. Report only checks actually run.
- Work on isolated branches; preserve the primary checkout. Commit/push under the user's authorization. Main integration, deletion of other work and release publication require their own scope.
- Sanitize evidence before persistence/export. No raw private transcript, reasoning, credentials, receipt tokens or runtime histories enter committed reports.
