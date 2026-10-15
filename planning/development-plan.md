# Consolidated development plan

Updated 15 October 2026. This is the remaining-work plan for the workflow branch. [Handoff](../Handoff.md) holds current status, [strategy](../docs/development-strategy.md) holds enduring rules and [acceptance](../docs/acceptance.json) holds candidate gates. This file is source-only and is not shipped in npm.

Main's earlier [plan at 881464c](https://github.com/crew-lab/codex-vibe/blob/881464cf4a86a030775a47104171853f9aecd3df/planning/development-plan.md) remains provenance for the release/outreach roadmap. Its repeated preparation approvals and statements that all branches are merged are superseded here by the owner's instructions and the current graph. Its frozen artifacts and historical results retain their original identities.

## Delivered milestones

| Milestone | Scope | Evidence |
|---|---|---|
| rc.3 | Deterministic patch acceptance and standardized export | 1,256 tests, release checks, offline installed smoke |
| rc.4 | Model/usage reporting, matched preparation kit and conformance-aware readiness | 1,258 tests, release checks, offline installed smoke |
| rc.5 | Owned validation copies, offline dependency preparation and explicit coordinator/fallback workflow | 1,260 tests, release checks, offline installed smoke; actual no-inference conformance and installed SDK readiness |

The seven requested improvements are implemented at `91afad4`. [Evidence](../docs/reviews/workflow-2026-10-15/README.md) distinguishes implemented behavior from unverified hosted/platform claims. Do not reimplement these as future roadmap items. Aggregated usefulness, SARIF, a daily cost ledger and other items below remain separate from the implemented per-run primitives.

## Critical path

| ID | Work and owner | Completion evidence | Depends on |
|---|---|---|---|
| I1 | Coordinator: integrate workflow changes with current main in an isolated checkout | Main's neutral disconnect/fixture script names, packaging/SBOM and credential-timeout fixes preserved; history/version guard reconciled; new workflow branch not mistakenly pruned; complete reviewed diff and chosen package identity | Fresh branch graph and main at `881464c` or newer |
| I2 | Coordinator: validate integrated source and freeze a new candidate | Relevant regressions, lint/typecheck/build, full release verification, offline package smoke; exact source/archive/kit identity and checksums | I1 |
| V1 | Coordinator: validate representative offline dependencies, especially populated pnpm stores | Frozen lockfile; exact Node/manager pins; dependencies inside owned copies; lifecycle/project hooks and automatic fetches disabled; clear blockers for unsupported profiles; source preserved and cleanup refusal demonstrated | Integrated helper or reviewed focused branch |
| V2 | Coordinator: exercise exact Node 20.19.0 floor | Full verification log for the exact candidate/source; newer Node results stay separate | I2; exact runtime available |
| T1 | Task-scoped preparation: install/select candidate with backup and rollback, run matched kit, reconnect intended desktop client | Candidate identity agrees on disk, kit and native connection; preparation PASS; workspace eligible; free slot; exact five tools | I2; selected final artifact |
| T2 | Coordinator: bounded hosted fixture review/edit, with declared policy/thinking/nested-tool observations | Explicit tasks and start budget; no replay; exported hashes/contracts; independent validation and append-only assessment; sanitized standardized report | T1 and owner's hosted allowance |
| T3 | Coordinator: hosted disconnect/soak as a distinct bounded observation | Worker group gone, owner lock released, interrupted task failed, no replay, private state cleaned, uncertain/dirty worktree retained | T1 and its own remaining hosted allowance |
| T4 | Owner: fresh standard account installation and applicable platform/client verification | Exact archive installed, registration/readiness, rollback and cleanup recorded; platform claims remain limited to demonstrated environments | Frozen selected artifact |
| R1 | Coordinator prepares; owner publishes | Gate matrix refers to exact archive; installation docs complete; stable/prerelease label reflects remaining evidence; release assets verified; explicit publication authorization | Applicable T/V gates and owner's promotion decision |

I1 is a real integration task: current main's version is 2.0.1 and the workflow package is 2.0.0-rc.5. Choose the integrated release identity explicitly during that work; do not silently downgrade main, label this branch merged, or reuse an old preparation receipt for changed bytes. This consolidation changes documentation/evidence only and does not perform I1 or rebuild a frozen package.

The existing `v2.0.0` GitHub release is a draft, confirmed through release metadata. Keep its archive/release history distinct from rc.5. Publication and release/tag replacement are not implied by committing or pushing source changes.

## One coordinator workflow

1. The main chat establishes task scope, immutable base, exact assertions, manual validation IDs and hosted budget. An implementation request using Vibe already covers its necessary scoped preparation; preserve settings and rollback.
2. Check the actual connection and candidate. Diagnose a deterministic preparation failure, repair the candidate, and verify the changed artifact. Do not blindly repeat an unchanged failure or substitute Luna for an infrastructure problem.
3. Start the bounded Vibe task once. Preserve original output and allowance. Vibe's own pinned bundled skills are allowed; skills never expand tools or roots.
4. Independently verify exported bytes/hashes and deterministic assertions. A concise final message is not evidence of missing code. Execution completion and automated PASS do not themselves mean coordinator acceptance.
5. Prepare owned validation copies; run declared checks deliberately. Export sanitized reports and record the decision. Correct mistaken decisions by appending history, preserving who made the error.
6. Use GPT-6 Luna/high only for an evidence-backed implementation failure, within the authorized fallback scope. Attribute Vibe and Luna changes separately. Extra hosted starts need explicit remaining allowance. Integration and remote delivery retain the user's scope and authorization.

The Crew Bravo run demonstrated why step 4 matters: Vibe's exact patch contained the disclosure that its summary abbreviated. The initial rejection was a review error; no Luna fallback edits reached the accepted website patch. The generic regression is now automated; that historical website result does not certify a different Supervisor candidate.

## Remaining product backlog

| Priority | Item | Existing foundation and remaining work |
|---|---|---|
| Next | Isolated-session summaries and measured usefulness | Per-run usage and append-only decisions exist. Aggregate `runs list` / usefulness over safe isolated lookup, preserve patch/model attribution and unavailable metrics; fixture and hosted export evidence needed. |
| Next | Reporting refinements | Improve explicit tool/permission totals, evidence completeness and portability where needed; keep safe projections, no receipts/raw reasoning/transcripts, and exact patch bytes or refusal. No approval-ledger export was added by this session. |
| Next | Dependency preparation profiles | Demonstrate populated pnpm graphs and representative projects; add narrowly reviewed support for required build scripts, project manager config or workspaces only if authorized. Existing blockers must not become implicit script/network permission. |
| Next | Per-workspace exclusions | Add declared excluded globs consistently to listing, profile, handler and read-back, with boundary tests and hosted observation. |
| Next | Structured review findings and SARIF | Findings schema, artifact validation, optional SARIF conversion; independent fixture results and hosted review. |
| Next | Release packaging closure | Reconcile main's no-history guard, source-only planning/research links and shipped documentation; preserve offline cache behavior and shipped SBOM. Byte-reproducible archives remain future work because SBOM metadata varies. |
| Next | Wheel-derived pin manifest / next-Vibe candidate tooling | A matched preparation kit exists; it is not a wheel-authenticated trust root or support for another Vibe. Vendor download, exact source/wire re-audit, manifest generation and new conformance/hosted evidence remain. |
| Conditional | Review search sidecar | ADR and confirmed route/inventory/permission model first; no shell-based search or hidden policy expansion. |
| Conditional | Antigravity as a verified MCP client | Owner scope decision and account; current client docs/skill wording, versioned readiness, hosted review/edit, disconnect and receipt/approval latency evidence. No worker adapter or generic support claim. |
| Later | Allowed write paths and per-root cost ledger | Separate runtime policy features; consistent enforcement, fail-closed readiness and budget semantics, meaningful boundary regressions and hosted observation. |
| Later | Linux, Intel/other platforms, MCPB/registry and current Codex plugin packaging | Each platform/client/install surface earns its own evidence; manifests remain scaffolds until installation is demonstrated. Owner decides scaffold retention and publication. |
| Later | Watch view and task templates | Build on real run metrics; fixtures, accessibility/operational review and per-language acceptance criteria. |
| Conditional | CI and reproducible archives | Confirm workflow permissions before introducing CI; then verify first real workflow run. Normalize SBOM timestamps/namespaces before claiming byte reproducibility. |

Release numbers for backlog items are provisional until I1 resolves the relationship with main's existing 2.1/2.2 plan. Do not leave completed usage, close assessment, export or preparation-kit primitives marked wholly unimplemented in that plan.

MCP Tasks, inline images, a repair turn, turn steering and any non-MCP CI entry point require their own trigger and design review/ADR. No implicit continuation, recovery replay, queue, extra active slot, worker shell/network, automatic patch application or Vibe version range is part of this plan.

## Outreach and adjacent work

The [marketing strategy](../marketing/strategy.md), [interest note](../marketing/interest.md) and [feature research](../research/features-2026-10-14.md) remain inputs, not instructions to publish or grant access.

| Work | Owner and dependency |
|---|---|
| Repository rename, description/topics, vendor branding and independence wording | Owner decision; prepare concrete edits after checking current vendor guidance. |
| Contributor/issue templates, article, Mistral Discussion and bug/protocol reports, private security note, one-page brief, Multica/Paperclip drafts | Agents may draft within scope. Use exact version-bound evidence, distinguish errors from capability gaps, retain application-policy limits and unknown cost/model data. |
| Release notes, demo/social preview, dev.to, Show HN, Reddit/LinkedIn, newsletters/curated lists | Owner publishes under explicit instruction, after applicable release/installation evidence; no messages or posts are sent by this consolidation. |
| MCPB/registry release, Antigravity forum note, SARIF/reviewdog outreach, funds/ambassador/CFP applications and monthly usefulness reports | Follow demonstrated product/client capabilities and measured data; owner controls accounts/publication. Research citations must be refreshed when used. |
| Crew Bravo PR #86 | Previously accepted copy/metadata patch is a separate repository/task. Its delivery authorization and status must be checked there before commit/push/PR updates. No website code changed here. |
| Crew Bravo first-visit consent overlap | Separate UX follow-up. Define first-visit mobile expectations, preserve consent/measurement gates, compare light/dark viewport evidence; the copy task left it unchanged. |

## Completion and evidence rules

Run only the checks warranted by changes: docs links/diff/JSON for documentation; relevant regressions and release checks for runtime changes; freeze a new package only when delivering it. Evidence records actual source, archive, kit, runtime, transport, budget, outcome and limitations. Source review, fixtures, initialization, native readiness, hosted behavior and clean-account/platform installation are distinct layers.

No new hosted allowance is created by a plan. Retain frozen old artifacts and failure/correction history. Do not move, stage, delete or reset unrelated primary-checkout work, private evidence or another chat's worktree. Branch cleanup follows a fresh reachability check and the owner's scope; a stale statement that all branches are merged is insufficient.
