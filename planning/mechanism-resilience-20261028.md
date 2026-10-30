# Mechanism resilience review and first repairs

2026-10-28. Implementation EDD and technical specification. Coordinator owns this record.

## Outcome, baseline and authority

The owner requests review of the whole mechanism after repeated Unsafe artifact failures, and resilient tool-owned preparation/recovery rather than correctness depending on skill/prompt details. This explicitly expands scope from the previously completed usability EDD. Its 3/3 historical product rounds and original trial failures remain unchanged. This is a new bounded mechanism stage, not a reset of those rounds.

Worktree: retained codex/vibe-usability-20261028 at 939ba8a. Preserve all existing dirty skill/adapter/Handoff/local-operation/local-trial/validation/workflow/strategy/source/test changes and evidence. Main checkout remains clean at 018f17b. Existing local Node 24.22.1, pinned dependencies/lock, TypeScript 5.9.3. Code changes affect a local candidate only; installed/archive/hosted qualification does not transfer. No commit, push, publish, automatic patch integration, provider retry, tool/profile broadening or global configuration change. Existing authority permits local task repair and necessary tests; this stage needs no hosted starts.

## Architecture and findings

Coordinator chooses task/criteria and holds external validation; five MCP tools own admission/lifecycle, grants bind exact requests, Vibe owns bounded reads/edits, independent copies own coordinator execution. Review has read_file; edit adds write_file/edit; shell/network remain disabled. One instance owns one active slot. Private runtime, pin, preparation, approval/event checks and no replay remain intact.

F1: readOwnedFile conflates external inputs and private state. External boundaries are task authorize --request, task prepare --contract, validation prepare --patch and runs export --validation. Normal 0644 files raise generic Error and reach users as VSUP_INTERNAL. Private grants/manifests/blobs/receipts must stay strict.

F2: prepared-input admission checks only the manifest envelope/scope before granting/consuming an attempt. Full source/copy/inventory/base/policy verification happens at launch, after consumption. Known-invalid preparation should be rejected without issuing or consuming a grant; race checks remain at launch.

F3: acceptance contracts are verified after output but not supplied to the worker launch prompt, so criteria must be duplicated into prose. F4: complete requests are manually forwarded from an authorization artifact into MCP start. F5: project-check execution remains coordinator-owned, validation subprocess failures discard useful diagnostics, and validation IDs are not executable recipes. These gaps need explicit subsequent designs; this first candidate does not claim arbitrary-prompt correctness or a full automated repair loop.

## First candidate design and required criteria

R1: document the full trust/data flow, automatic-repair versus closed-failure matrix and dependency-ordered remaining work. Evidence: independent source audits, this specification and development strategy/Handoff.

R2: separate selected external inputs from strict saved-state reads. Add a bounded external reader accepting ordinary owned, single-link regular 0644/0640/0600 files with no group/other write permissions. Consume an immutable validated Buffer; do not chmod original files or parent directories or persist an unnecessary extra raw copy. Switch exactly the four external call sites. Keep canonical/no-symlink restrictions, ownership/link/type/size checks and before/open/after identity verification. Read at most maxBytes+1, checking opened/final metadata so growth/replacement/mutation fail closed. Preserve existing internal readOwnedFile privacy requirements.

R3: known artifact/input faults use existing typed codes (INVALID_ARGUMENT for selected input, ARTIFACT_ERROR for unsafe stored artifact/private directory) with bounded reason/role details and actionable messages, never contents or raw secret-bearing error text. Missing, permission, unsafe link/type/owner/mode, size and changed-input cases are distinguishable. Unknown faults retain INTERNAL behavior. No hidden automatic retry or filesystem permission repair. Regenerate docs/errors.md if remedies change.

R4: share full prepared-input preflight before grant issue and before consumption, using the current admitted policy/base/source and existing deadline. Keep launch verification to close races. Invalid source/copy/inventory/scope/base/policy inputs issue/consume no grant; unchanged valid inputs dispatch exactly once; a race after consumption fails without replay. Preserve slot release and bounded admission.

R5: relevant regression tests and npm run verify:release pass, including negative controls for internal 0644 refusal and unsafe input refusal. Exercise external 0644 patch/contract/request/validation input cases unchanged, private output artifacts, CLI/MCP typed error behavior, and grant-before/after-consumption boundaries. Bind evidence to hashes. Obtain fresh independent Sol/high local acceptance under the owner's prior explicit instruction-based read-only amendment; tools remain exposed, no writes/commands/delegation by that reviewer.

## Assignments and validation budget

Two read-only Sol/high audit agents mapped artifact and orchestration paths; no edits. Worker A, gpt-6.1-terra/high, owns private-files.ts, the four external call sites and their tests; Worker B, gpt-6.1-sol/high for state/authorization integration, owns run-manager.ts and dispatch-authorization tests. Both share the worktree, preserve prior work, do not delegate, and do not run shared builds. Coordinator owns docs/contracts remedies/integration, serialized builds and raw evidence. Exact briefs establish owned paths and current bytes.

Three product rounds for this new mechanism candidate: 2 consumed, round 2 accepted. Historical round results remain below. Recovery per cause remains initial plus one justified recovery; no unchanged retries. No hosted validation is required for deterministic filesystem/admission changes. Representative current task-inputs/validation baseline suite is running before implementation. Gate: focused pinned Vitest suites, full npm run verify:release, real rebuilt-CLI copy-only preparation with an unchanged 0644 input and unsafe-input negative, local link/diff check, fresh independent review. Release/archive/installed/hosted promotion remain later dependencies.

## Remaining mechanism work and principles

Priority after this candidate: contract-derived worker requirements; canonical start payload generated from one frozen request; structured task preflight report; explicit reviewed validation profiles with baseline/candidate checks and hash-bound results; bounded corrective runs only under newly registered grants and an explicit task allowance. A general runner or automatic inference loop is not introduced here.

Tool-owned normal mechanics should not depend on prompt wording. Repair by validating/normalizing controlled inputs and creating private outputs; never guess missing user intent, weaken artifact or workspace integrity, rerun a consumed attempt, bypass host refusal, execute arbitrary project scripts or claim generated tests prove their own semantics. Missing information should yield a precise prerequisite or explicit assumption, not an internal failure. An arbitrary bad prompt cannot make an incorrect implementation acceptable.

Current status: VERIFIED for local R1–R5 in round 2; installation/archive/hosted promotion and later orchestration work remain separate.

## Resume — 2026-10-29

The prior interruption was a worker usage limit. Saved source/tests/docs are intact, no commit/publication or hosted call occurred. Current account tool reports ordinary usage allowed (primary 2%); resume the same exact Terra/high artifact and Sol/high admission assignments for one justified recovery. Round 1 remains open, no product/recovery budget reset. The external-input reader and pre-consumption helper exist; finish safe UTF-8 and typed prepared-input validation failures, then run focused/full gates and fresh independent verification. Earlier private temporary fixtures are unavailable; recreate the deterministic before/after CLI case and retain sanitized evidence promptly. The current built CLI still reproduces the original 0644 Unsafe artifact failure, before rebuilding the new source.

## Round 1 result and round 2 integration repair

Full verify:release failed two existing missing-receipt status checks: typed ARTIFACT_ERROR(reason=missing) was no longer recognized by checkPreparation's legacy ENOENT branch, so missing became stale. Both still blocked dispatch, but status classification regressed. Preserve release.log as the original failed gate. Round 1 consumed; round 2 open (1/3 consumed). Coordinator integration fix owns src/preparation/evidence.ts and recognizes only the explicit typed missing reason in addition to native ENOENT; all other unsafe/stale cases remain blocked. Rerun the two affected suites, then the broad gate because this shared reader integration is cross-cutting. No oracle/criterion change, hosted start or budget reset.

## Round 2 deterministic gate — 2026-10-29

Full npm run verify:release passed on Node 24.22.1: 118 test files, 1,657 tests passed and one skipped, plus lint/typecheck/build, acceptance, secret scan and SBOM. Affected missing-receipt suites pass 29 tests. Original round-1 failed log retained. Rebuilt-CLI before/after evidence accepts the same unchanged 0644 patch, preserves bytes/mode, rejects writable inputs and malformed JSON with typed diagnoses, and removes validation copies after fingerprint checks. Skill syntax, 72 local links/anchors, adapter TOML/example JSON and diff check pass. No hosted starts or installation.

Source/evidence frozen under research/evidence/mechanism-resilience-20261029; listed-file manifest has explicit coverage. Round 2 remains open through fresh independent Sol/high R1–R5 local acceptance under the existing user-authorized instruction-only read-only amendment. No prior reviewer verdict supplied.

## Final local state — 2026-10-29

Fresh independent Sol/high review returned VERIFIED for frozen R1–R5. It verified listed source/evidence hashes and inspected raw tests/CLI results without commands/writes/delegation under the owner-approved instruction-based permission amendment. Round 2 consumed: total 2/3 product rounds, no reset. Local phase complete; original round-1 failure retained. No hosting/installation/publication claim.

The initial checkout remains clean at its startup HEAD. All prior dirty work remains in the retained task worktree. Disposable CLI validation copies were removed by the fingerprint-checked helper; private fixture/logs retained for reproduction and sanitized evidence saved in research/evidence/mechanism-resilience-20261029. The active skill explicitly warns that skill text does not upgrade an older installed tool. No commit, push, new archive, selected-installation switch or hosted start occurred.

Remaining broader self-healing work is explicit: contract-derived worker requirements, one canonical authorization/start payload, structured task preflight, reviewed executable validation profiles and bounded correction under fresh grants. These are not implemented or qualified by this first mechanism candidate.
