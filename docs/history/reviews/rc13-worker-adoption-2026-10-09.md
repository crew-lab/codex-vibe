# Reviewed-baseline worker adoption delivery

Date: 2026-10-09. rc.13 implements deterministic reviewed-baseline preparation, offline edit-run audits and the delegation protocol. rc.14 adds optional private CLI scope input after a separately reviewed coordinator correction. Source delivery is maintained on `codex/project-agents-isolation`; the dirty primary checkout and previous runtime installations are preserved. After verification, the user authorized documentation reconciliation, commit and push. No publication or deployment is included.

## Implementation and review

The baseline helper uses an existing allowed source/output root, an immutable Git base and selected hash/mode-bound UTF-8 overlays. Dry-run is default; explicit creation writes snapshot commits only in a new private independent repository. Bounds: 64 overlays, 4096 files, 2 MiB/file, 100 MiB/tree. Source/index/ref preservation includes a regression with inherited GIT_INDEX_FILE pointing at the original index. The independent Luna High reviewer found that index issue before installation; it was corrected and accepted.

Audits distinguish assistant messages, unique calls, failed updates, unique failed calls and known wrapper-based failure classes. Unknown evidence stays unverified. Request-level policy denials are counted without guessed call correlation. Declared candidate scope stays unverified; optional argument-path evidence is labeled separately. Native histories, command/replacement text and reasoning are not copied here. Safe-read checks cover ownership, permissions, links, bounds and before/after identity; hostile concurrent mutation by the same account is outside this application boundary.

The first post-review release attempt failed in sandbox process-owner checks with EPERM. It did not authorize installation of that candidate. The subsequent authorized offline rc.13 package verification passed: 766 tests, two skipped; Python tests, lint/typecheck/build, deterministic acceptance, secret scan, SBOM and installed-package MCP smoke. The rc.13 archive SHA-256 is `d160b40bb0eadcdce857f460662668c4248dec6d29db38c8c6a6131ae1fb8313`. Installation preserved rc.12, the original config and all five allowlist roots. A fresh official MCP client independently confirmed rc.13 and exactly seven tools with no backend/allow_shell start parameters. Native desktop reload was not observed.

## Hosted edit and same-session correction: PASS

Run `c0af69a2-9ca7-496b-bae3-7f869a417c8a`, connected Supervisor rc.13 / pinned Vibe 2.25.8. Limits: 12 cumulative turns, 240 seconds, 30-second waits; no increases or retries. Coordinator elapsed 10.658 seconds is not focused time, billable usage or a long-wait gate.

The coordinator deliberately prepared a dirty reviewed docstring overlay before inference; the worker was not asked to hydrate baseline files. Initial candidate changed subtraction to addition and preserved `Reviewed baseline.`. Same-run correction changed only the docstring to `Return the sum of two integers.`. Both turns ended with end_turn and an actual final answer. Cumulative evidence: five assistant messages, three unique calls (one read, two edits), zero failed calls, no shell/search/other calls. No project-instruction/discovery marker was observed in saved system/user messages.

Each exported patch was applied in a separate verifier clone; verifier bytes matched worker bytes. Exact AST/docstring and six numeric cases passed per round. Only calc.py changed; source fixture/prepared baseline stayed unchanged. The independent read-only reviewer checked candidate, manifest and patch hashes and accepted both rounds. Final patch SHA-256: `8581ab34605a500f01badde7ed8319ceca1bc7b114b7ab6f18a0e607c0dbd92d`. Close returned closed/worktree_removed true; filesystem absence and owner-lock absence were checked. Native records remain private under the rc.13 runtime.

## Narrow product increment: coordinator-corrected acceptance; Vibe gate PARTIAL

Run `4e492e03-e5c2-4b78-b147-58eba5d63bb3`, connected rc.13 / pinned Vibe. Limits: 20 cumulative turns, 240 seconds, 30-second waits. Prompt 1201 characters. Task: optional `audit-edit ... --files /absolute/private/scope.json`; ownership restricted to src/cli/worker-tools.ts. Prepared baseline included two reviewed source modules, with a selected dirty comment overlay, and no model-based reconstruction.

A full source snapshot was first refused before inference because security-test fixtures contain recognized credential patterns. The guard was retained. The coordinator selected only the two clean modules needed for this task; that explicit reduced baseline passed preparation. It was not a full repository image; full product validation used a separate complete verifier copy.

Vibe returned end_turn and a final answer: three assistant messages, two calls (one read/one edit), no failures, only the owned file changed. Patch SHA-256 `b354029a6266f54518c57a84f612052a40e381636741d616c2d39e335e4ce18f`. Source preservation and cleanup were verified.

The coordinator prematurely closed this product run before independent acceptance checks. The candidate permitted nested/lone dash segments (a/-b and -); focused tests and the reviewer rejected it. The original candidate and patch remain unchanged as failure evidence. Same-session correction was consequently unavailable. No hosted replay or budget increase was attempted.

The coordinator corrected the per-segment check and added regressions. All 24 CLI scope tests passed in the independent verifier, as did lint/typecheck; the independent Luna High reviewer accepted the corrected exact candidate. Integration checked original source bytes before replacing the owned file. rc.14 contains that reviewed correction, not an unqualified Vibe implementation pass. Future product runs must keep the session open through independent tests/review before close; this is an existing protocol requirement and an observed coordinator deviation.

## Remaining gates

No hosted soak, restart/load recovery, crash recovery, permission callback, Intel, clean-account, native desktop or full D8/D18 claim. Provider billing/quota and the shared focused-hour balance remain unknown. The next product test must demonstrate independent acceptance and any required correction before verified close. Existing accepted UARoots SEO/city work was not replayed or modified.

Private sanitized delivery evidence is retained under each installed version's installation-evidence directory; raw native histories remain only in private runtime storage. Source helpers, unit/integration regressions and the updated protocol are reviewable in this worktree.

## Final rc.14 delivery

Full offline package verification passed: 790 tests, two skipped, Python tests, lint/typecheck/build, acceptance, secret scan, SBOM and installed-package smoke. Archive SHA-256 `4e5d866411dbc86ca7f03c4f3550f07df548f3a8f88817f65aa4b99f4ef60c88`. rc.14 is installed locally with previous versions retained; a fresh official client confirmed seven tools. The installed CLI scope option successfully audited the rc.13 pilot while preserving its creator version and unverified candidate-scope field. No rc.14 hosted inference is claimed.

An installation preflight detected a concurrent model_reasoning_effort change and refused before writes. The sequential shell wrapper nevertheless switched the CLI alias prematurely; it was restored to rc.13 immediately. The installer then verified the MCP entry was unchanged, preserved the concurrent setting and installed rc.14; the final alias was changed only after installation succeeded. No guard, allowlist or unrelated setting was weakened or overwritten.

## Documentation reconciliation and Git delivery

The user subsequently authorized updating all delivery documents, committing and pushing `codex/project-agents-isolation`. Current summaries now replace stale planning/pilot states while preserving dated historical observations. The shipped rc.14 documentation archive was regenerated with the required offline package checks: 790 tests passed, two skipped, plus Python/release/install checks. Updated-document local links and whitespace checks passed. The regenerated archive SHA-256 is `75a0c66ffdcf7c33418d8c9298d61a78e8e1033d068f466e1802ed0404b4f49e`; the installed original artifact hash above remains its historical installation receipt. All 43 compiled JavaScript/Python runtime files match the installed rc.14 bytes; only documentation/package metadata was refreshed. No additional hosted inference or gate pass is claimed.
