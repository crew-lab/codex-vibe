# Stable v1 follow-up: current-state audit — 2026-10-13

Goal remains active. Published 1.0.0 is unchanged; the practical tool-access mitigation is now a distinct local **1.0.1-rc.1** candidate. Previous turn classification: progress (runtime mitigation, tests, independent review and completed <site-project> export lane). This turn: progress (frozen offline package, exact Node-floor verification and reviewable dispatch/installation contracts).

Later same-turn update: the owner explicitly authorized installation and six bounded runs. Private installation/registration is complete, all 140 installed archive files match and doctor passes. **Zero hosted runs used.** The current native connection remains 1.0.0; restart and exact-candidate native readiness are next. [Resume checkpoint](RC1-RESUME.json), [installed bytes](rc1-installed-files.json), [doctor](rc1-installed-doctor.json), [registration and rollback receipt](rc1-registration-receipt.json). The table below retains the earlier pre-authorization audit as dated provenance.

## Candidate identity

Source base: `7b30feaf60e7b6038e2bd80c14974d7ff270330e`, also the current GitHub main revision observed read-only during this audit. Runtime differs from published 1.0.0; historical hosted evidence is retained, not transferred.

Archive: `tmp/practical-tool-diagnosis/release/vibe-supervisor-1.0.1-rc.1.tgz`.
SHA256: `2442e35579d30dbc9b28bab4abaddfbb0a7c1e782055ba83cc4187ca24946b98`.
Tracked source patch: [rc1-source.patch](rc1-source.patch), SHA256 `d0f7ef5314f93e4946a2e03d75859c5d9cc11b4ed1655c0ba96c6838af90e2b9`.
Original runtime patch remains byte-identical to the independently reviewed `f638bea4…` patch.

## Requirement-by-requirement state

| Requirement | Current evidence / verdict |
| --- | --- |
| Preserve shared work and current source | Isolated candidate on the current main base; older dirty primary preserved. No dependency-version change; package/lock root version metadata only. |
| MIT/private package and fixed five-tool scope | Retained. Offline installed-package smoke PASS; scaffold version alignment does not prove plugin installation. |
| Effective tool inventory and drift rejection | Pinned actual ToolManager fixture PASS for review/edit, missing/extra inventory negatives, ordinary and hidden YAML reads; independent source review accepted. Historical failure cause UNKNOWN. |
| Bounded safe diagnostics | Regression checks PASS for metadata-only records, limits/truncation, final flush and concurrent descriptor lifecycle. Pre-invoke denials remain outside this trace. |
| Existing allowlists, isolation, shell/network disablement, locking, redaction, deadlines/export/cleanup | Existing full deterministic suite PASS. No policy widening or global changes. Hosted candidate observations still required. |
| Lint/typecheck/build/tests/acceptance/secret scan/SBOM | PASS on Node 24.21 and exact Node 20.19: 650 Node tests and 77 Python tests per run. Preserved earlier restricted-process and dependency-symlink verification failures. |
| Offline packaging and installed MCP smoke | `package:rc` PASS using populated offline cache; no network fallback. Frozen archive/SBOM/acceptance checksums match. |
| Frozen archive/source consistency | [Independent package audit](rc1-package-audit.json): all 140 safe regular entries match candidate bytes. [Node-floor supplement](rc1-node20-supplement.json): all 18 changed tracked source files match the independent verification copy. Archive unchanged after later evidence. |
| Current native registration | [Readiness](current-installed-readiness.json) proves current connection is 1.0.0, eligible/free/no restart. It does not prove native 1.0.1-rc.1 readiness. |
| Candidate private install and registration | NOT RUN; exact [proposal and rollback](rc1-installation-proposal.json) prepared. Explicit user-global authorization pending. |
| Candidate native readiness, authentication and useful hosted review/edit | NOT RUN. No remaining previous hosted allowance. [Six proposed assignments](proposed-hosted-assignments.json) prepared; separate paid authorization pending. Cases 1/2 also cover exact-archive confirmation, avoiding hidden additional runs. |
| Low-turn outcomes and active official-client disconnect | Deterministic regressions PASS; candidate hosted cases 3/4/6 NOT RUN. Case 6 is an edit, retaining worktree coverage. No replay/retry or extra desktop case is assumed. |
| Fresh-account installation | REQUIRED_NOT_RUN before stable 1.0.1, consistent with the earlier owner deferral. Human-operated setup and any fresh-account paid task need their applicable authorization; no account creation or credential copying is included. |
| Source integration, CI, tag/release/public install | NOT RUN for this candidate. No new commit/push/merge/publication was performed. Frozen reviewed bytes must be retained; publication requires its applicable authorization. |

The packaged acceptance report retains Node-floor UNVERIFIED at freeze. The later exact-floor PASS is an external supplement, not a silent archive rebuild. Local acceptance labels do not constitute hosted inference.

## Ordered continuation

1. After the pending installation authorization, install only the frozen archive into its proposed private prefix, verify all installed archive bytes, record doctor/provenance and the exact registration diff, then reconnect. Refresh native candidate readiness before dispatch.
2. Only with the pending paid allowance, run the six prepared cases sequentially, stop at the first unexpected failure and preserve all failures. Observe costs only if supplied. Verify the workflow edit independently in a disposable copy using the prepared 16-case actual-command harness; never repair a failed worker patch into a Vibe PASS.
3. Complete the human-operated fresh-account lane before stable 1.0.1. Prepare any separate review/edit allowance only after installation/readiness succeeds in that account.
4. Recheck integration against main, obtain applicable delivery authorization, then verify CI/tag/artifact/installed identity. Do not retag or replace the published 1.0.0 archive.

<site-project> privacy and production release remain a separate lane. Its independent export review is now PASS; unavailable collector interception is not turned into a hidden Supervisor gate.
