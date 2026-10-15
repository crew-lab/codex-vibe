# Current handoff

Updated 15 October 2026. This is the current status; the [development plan](planning/development-plan.md) owns remaining work and the [strategy](docs/development-strategy.md) owns enduring rules. Earlier stacked checkpoints are preserved in Git history, including commit `91afad4`.

## Repository and release state

| Item | Verified state |
|---|---|
| Workflow implementation | `91afad4a9b6c598d2486c5d22e902f32972e4cac`, pushed on `codex/workflow-acceptance-reporting`; package identity `2.0.0-rc.5`, Vibe pin `2.26.1` |
| Main | Fetched at `881464cf4a86a030775a47104171853f9aecd3df`; package version `2.0.1`. It is 32 commits beyond the workflow base `2ae8e86`. Workflow changes have not been integrated into main. |
| Published release | GitHub metadata checked today: `v1.0.0` is published; `v2.0.0` is a draft. Main's source version does not establish a published release. |
| Selected desktop installation | rc.2 was retained during this session. rc.5 was installed only in a disposable prefix; the intended desktop connection was not switched or verified on rc.5. Recheck live state before another task. |
| Primary checkout | Contains unrelated staged and unstaged work. It was preserved; implementation and documentation work use the isolated checkout. |

Do not delete the workflow branch under the old main handoff's statement that every branch is merged. Recheck branch ancestry before any cleanup. Do not retag or replace a frozen artifact.

## Completed workflow work

| Enhancement | Delivered behavior |
|---|---|
| Deterministic acceptance | Frozen path/text/hash contract; check committed base plus exact exported patch; bounded saved inputs; execution, verification and append-only coordinator assessment are distinct. |
| Standard reporting | `runs verify` / `runs export`; sanitized diagnostics and hashes; optional exact patch and projected events; no raw transcript or private receipt export. |
| Model/usage observations | Runtime-reported model name/alias/thinking and prices at startup/handoffs; prompt/completion/cache/model-call metrics, estimated cost provenance and known phase durations. Unavailable identities and timings remain unknown. |
| Matched preparation | Separate candidate kit, one-shot fake-key/no-inference check, private evidence; new checks invalidate older PASS before launch. |
| Readiness | Workspace eligibility, candidate identity, conformance state and expected-candidate drift are separate; matching preparation PASS gates ordinary dispatch. |
| Validation copies | Independent baseline/candidate Git copies, immutable input hashes, pinned offline dependency preparation without lifecycle scripts, owned manifest and conservative cleanup. |
| Coordinator/fallback | Main chat coordinates; Vibe implements; Luna/high is fallback only after verified artifact rejection. Preserve the original Vibe output, corrections, budgets and attribution. |

Task-scoped preparation is already covered by the owner's Vibe implementation request: required candidate installation/switching, no-inference checks and only the named repository root, preserving settings and rollback. Do not repeat separate-approval gates for those steps. Additional hosted starts, broader roots, publication, deployment and unrelated global changes need their own authorization. Vibe's exact pinned bundled catalogue is permitted; user/project/registry skills remain disabled.

## Evidence and limits

The [version-bound evidence packet](docs/reviews/workflow-2026-10-15/README.md) records:

- rc.3: 1,256 tests; rc.4: 1,258; rc.5: 1,260 across 87 files. Release verification and offline installed-package smoke passed for each.
- rc.5 actual installed Vibe 2.26.1 conformance passed once with a fixed fake key, no inference and no real credentials. Subject proxy requests were absent and the control was observed; experiments-specific attribution remains unverified.
- rc.5 official-SDK stdio readiness passed and rejected the wrong expected-candidate hash. This is distinct from native desktop readiness.
- The real npm dependency-free offline fixture passed with a deliberately failing lifecycle script suppressed. A populated pnpm dependency installation has not been demonstrated.
- The exported source patch reconstructed 542 source files byte-for-byte.

Frozen rc.5 archive SHA-256: `d1fd22ec04e50048c052cdf013b4d235b525dffc2efb11596dd29f8253003f6a`.
Installed distribution identity: `a3600f7632ea42a221d342734dd1b6cb17deaaf072211693a728e31c0437b053`.
These identify different things. Local packages/logs/snapshots are under `output/workflow-2026-10-15/`; the source-only evidence packet is committed, sanitized and excluded from the npm package.

Exact Node floor, native rc.5 desktop readiness, new hosted fixture/permission/thinking/nested-tool tests, hosted disconnect/soak, fresh-account installation and additional platforms remain open for rc.5. Earlier rc.2 Crew Bravo work and main's earlier floor test do not close those gates.

## Next steps

1. Reconcile the workflow implementation with current main in an isolated integration checkout. Preserve main's neutral script names, history cleanup, packaging and test fixes; resolve candidate naming and guard tests. Review the complete diff, then verify and freeze the integrated source as a new artifact. rc.5's receipt cannot certify it.
2. Validate the populated pnpm profile and representative project dependencies, then exercise the exact Node floor on the selected final candidate.
3. Select/install that exact candidate with rollback, run its matched preparation kit and verify the intended desktop connection. A hosted sitting follows only with explicit task limits and allowance; use deterministic acceptance and standardized reporting.
4. Complete fresh-account and applicable client/platform gates before stable promotion. Record evidence against the exact frozen archive; publish only under the owner's release authorization.

The [plan](planning/development-plan.md) carries dependencies, acceptance criteria, future product work, outreach and the separate Crew Bravo consent UX follow-up. No new hosted run, merge into main, release publication, deployment or branch deletion is implied by this status update.

## Open questions

The integration needs a coherent release identity alongside main's 2.0.1 source. The owner still decides publication/promotion, repository rename and vendor wording, plugin scaffold disposition, additional client/platform scope, vendor-wheel downloads and the next hosted allowance. Protocol questions about thinking generation, attributable experiments requests, nested-tool behavior and hosted disconnect remain evidence tasks, not assumptions resolved by initialization.

## Fixed scope and safeguards

Exactly five one-shot MCP tools; one owned active slot; canonical allowlists; detached worker edit worktrees; pinned Vibe 2.26.1. No automatic patch integration, worker shell/network, recovery replay, continuation or extra hosted starts. Bundled skills stay inside the same tool/path policy. Keep private runtime state and sanitized evidence; uncertain cleanup retains files. These are application-policy controls, not an OS sandbox.

## Operating references

[Acceptance/reporting](docs/workflow-acceptance.md) · [Preparation](docs/preparation.md) · [Validation workspaces](docs/validation-workspace.md) · [Tool/CLI reference](docs/reference.md) · [Behavior](docs/functionality.md) · [Security](docs/security.md) · [Compatibility and gates](docs/compatibility.md) · [Machine-readable acceptance](docs/acceptance.json)
