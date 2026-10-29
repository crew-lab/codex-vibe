# Stable skill-driven Vibe workflow EDD

Revision 1, 2026-10-28. Phase: implementation. Coordinator owns this record.

## Outcome and baseline

Make the existing Mistral Vibe subagent stable and easy to run through its shipped coordinator skill. Assess current state, exercise temporary bounded tasks, repair demonstrated defects, and independently verify the resulting candidate. Do not replace the five-tool architecture or expand the experimental backend.

Startup: clean index/worktree on `codex/antigravity-agy-148`, HEAD `018f17b2d8f93bc3b5acd3c843d395b311fbd4b3`, source version 2.2.0. Preserve this branch's Antigravity work. Connected native server: 2.2.1, candidate `65dbafd0700891c72978e35df8a599a1c110ba37d13ff68bb19a3004cbe1e716`, app-server, preparation passed, eligible and slot free. Installed discoverable skill resolves to the older 2.2.0 operational installation. These facts do not establish equivalent bytes or hosted reliability.

Environment: Node 24.22.1/npm 11.19.1 locally; connected server Node 24.21.0, macOS arm64; lock pins TypeScript 5.9.3. Representative `npx vitest run tests/integration/preparation-help.test.ts`: passed, one test. Release-floor Node 20.19 evidence is separate.

## Authority and budget

User explicitly requests autonomous implementation, testing, fixes and subagents. Local task edits and necessary scoped preparation are authorized. Initial hosted test allowance is bounded to one review and one edit (two starts total); no replay or extra hosted starts. Preserve settings/rollback; no commit, push, merge, publication, deployment, broad allowlist or unrelated global changes. Temporary fixtures stay within the named repository or owned temporary validation copies. Do not integrate test-worker patches into product source automatically.

Three product rounds total for this implementation; consumed 0, round 1 open. Recovery per blocking cause: initial execution plus at most one justified retry. Hosted starts cannot exceed two regardless of product rounds. A deterministic preparation failure stops unchanged retries.

## Required criteria and stages

S1: assess and repair local usability. R1: distinguish checkout, installed skill and connected candidate with current evidence. R2: shipped skill gives an executable short path for prepared installations, exact request authorization, bounded review/edit tasks, independent validation and safe close; references resolve and no policy is weakened. R3: any product repairs have meaningful regression checks; `npm run verify:release` passes for code changes, or local link validation and `git diff --check` for documentation-only changes. Evidence: task-scoped records under `research/evidence/vibe-usability-20261028/` and private raw logs outside the published tree.

S2 depends on prepared connected candidate: R4: one hosted review identifies a seeded, deterministic defect without modifying its inputs; one hosted edit returns only its frozen allowed paths and passes independent semantic cases. Record exact candidate, request hashes, outcome, usage when exposed, export hashes, cleanup and free-slot result. Failed hosted tasks remain failures; fixing the skill does not retroactively pass them. A changed distribution needs its own matched preparation and later hosted allowance.

S3 depends on deterministic gates: R5: fresh independent read-only EDD verifier maps R1–R4 to raw evidence, with exactly VERIFIED/INCOMPLETE/BLOCKED. Scope local and connected qualification separately; no claim of universal stability or clean-account success. Missing hosted evidence blocks S2 and overall completion, not independent S1 work.

Advisory/later: clean-account installation, release promotion, broad real-task reliability, nested run_typescript gate, reproducible packaging and Antigravity are not silently certified by these tasks.

## Assignments and dispatch

Coordinator: EDD, test fixtures, serialized builds/native calls, integration and evidence. Assessment subagent: gpt-6.1-sol/high, read-only analysis of source/installed mismatch and concrete workflow gaps, no edits. Skill specialist: gpt-6.1-terra/high after assessment, owns only assigned skill/docs. At most two independent workers; no worker delegates. All share this checkout and must preserve others' changes.

Fresh verifier: exposed `edd_verifier` adapter, gpt-6.1-sol/high, fresh context. Adapter enforces read-only filesystem; shell and delegation prohibited by role instructions. No generic writer substitution. Skill source: invoked edd-loop in the agentskills repository, contracts and models-and-clients read before dispatch. Shared filesystem supplies exact inputs; briefs require evidence of input comprehension. Candidate hashes and raw check evidence frozen before verification.

## Current state

Assessment underway. Next: reconcile newer installed candidate and older source/skill, define exact temporary task oracle, then dispatch bounded work. No hosted starts consumed. No acceptance verdict yet.

## Amendment 1 — current-source reconciliation

Read-only inspection found newer source at 939ba8a860e5fad5fd682d0dc7f061bda048aa0a on codex/qualification-221-evidence. Work now uses an owned detached worktree of that commit, leaving the initial branch untouched except this planning record. Current skill lives at .agents/skills/vibe-supervisor/SKILL.md; custom adapter at .codex/agents/vibe-reviewer.toml. Existing readiness-command/context-selection improvements are preserved. Same user authorization, criteria and total budget; no reset. Initial worktree creation was denied by filesystem policy, scoped host approval succeeded (one recovery).

Observed historical edit passed semantics but failed a frozen literal import assertion. Preserve that rejection. New trial must freeze a semantic oracle and exact required syntax deliberately before dispatch; never change its oracle after seeing output. Skill specialist owns only the current skill, adapter instructions, docs/local-trial templates and docs/local-operation.md in this isolated worktree. Documentation changes need links, diff check, skill validation and independent behavioral walk-through; custom adapter instructions must forward every frozen field. Local source changes do not change the already-connected candidate.

## Round 1 evidence and round 2 repair

Hosted starts used: 2/2. Review 7ec365ea-3701-4266-a89f-4eef5477d0f5 completed end_turn, two reads, no warnings, integrity verified; identified seeded <= defect with all five cases correct. Closed; slot free before edit. Edit ee4f8b14-a3a7-41d4-ab11-a77317772d5f completed end_turn; automated path/text contract passed, 14 independent function cases passed, but required worker-tests failed because the named export was imported as default. Original patch ec630a3291a01667906ce55137efda29f98773f52277958a5ce62793b4159b53 rejected and retained. Close kept dirty worktree with explicit reason. This is a product-output failure, consuming round 1. Round 2 open; no extra hosted starts without response to pending allowance question.

Coordinator corrected only that import in a separate validation copy after rejection: nine worker tests and 14 independent cases pass. This is attributed fallback diagnostic evidence, not Vibe success and not integrated product code. Prompt/skill repair now requires export/import consistency before final answer. Historical frozen contract and rejected artifacts remain unchanged.

Infrastructure/harness accounting: skill validator initially unavailable under system Python (missing PyYAML), then passed with already-installed Vibe Python containing PyYAML; no dependency/global changes. Export initially used unsupported --include-patch (coordinator command error), corrected once to documented --include patch; export succeeded. Neither changes product-round accounting.

Behavioral walkthrough by a fresh Sol/high explorer confirmed exact request forwarding, unknown count handling, no new grant when allowance exhausted and required assertion gating. It found abbreviated adapter verification instructions and an ambiguous retry prohibition; specialist is repairing these. No acceptance verdict yet.

## Amendment 2 — hosted test allowance

Owner explicitly authorized any number of tests required for autonomous work after round 1. Prior two-start ceiling is replaced by necessary task-scoped hosted tests within the unchanged three-product-round limit and no unchanged retries. Round 2 uses a new exact request, same two-file scope/contract/14-case semantic oracle, with explicit named import and source consistency check. No historical assessment is altered.

## Round 2 deterministic gate

All required local checks pass: skill quick_validate under installed Python, TOML parse, 14 links/anchors, diff check. Hosted round 2 b77d2ce9-388a-48ff-ba1a-e90b4552bba4 exported patch d30759eb2f2fce78f2ebc6edf44a2edba1b55df33ec844b68987ccb58e8e81f7; unchanged output passes nine node:test cases and 14 independent cases under connected runtime Node 24.21.0, six automated contract checks, exact two-file scope. Closed with accepted assessment; dirty worktree retained. Connection prepared/eligible, slot free. Evidence at research/evidence/vibe-usability-20261028, with sanitized raw exports and command logs; candidate-source-sha256.json binds changed product files.

S3 now ready: fresh edd_verifier gpt-6.1-sol/high, enforced read-only filesystem, no shell/delegation. R1–R4 have raw evidence; R5 is its pending independent verdict. Round 2 remains open through acceptance; 1/3 rounds consumed. Planned task-scoped activation after VERIFIED: retain source worktree durably and update discoverable skill link with rollback, preserving installed server bytes and selected configuration. User authorization for necessary task-scoped installation applies; no release or global unrelated change.

## Verification capability blocker

Fresh edd_verifier dispatch returned `agent type is currently not available`; no verifier started. The installed role link resolves, but file presence does not establish a loaded adapter. Current official Codex subagent documentation says custom roles inherit parent permissions and cannot override sandbox settings. Original preflight assumption of available enforced read-only adapter is invalidated. No repeated dispatch, adapter modification or generic substitution performed. Pending owner amendment permits or refuses instruction-only read-only reviewer at the unchanged Sol/high selection; all required criteria remain unchanged. S3 blocked pending this dependency; round 2 stays open (infrastructure-only interruption).

## Amendment 3 — independent verifier permissions

Owner explicitly replied “Permit this verifier amendment” to fresh gpt-6.1-sol/high independent verification with no-write/no-command instructions and no separately enforced read-only filesystem. Replace only the unavailable edd_verifier enforcement requirement with an available explorer role at the same exact model/reasoning, fresh context, no commands/writes/delegation. Parent workspace-write permissions remain exposed; behavioral restrictions are instructions, not enforcement. All criteria, test gates and round budgets unchanged. Original failed role dispatch remains evidence. This is an explicit owner-authorized alternative, not proof the original adapter worked.

## Final current state — 2026-10-28

VERIFIED for local skill candidate and named connected review/edit tests, independently assessed by fresh gpt-6.1-sol/high under owner Amendment 3. R1–R5 passed. Product rounds consumed: 2/3 (round 1 rejected output; round 2 repaired and verified). Hosted starts: three total, one review and two edits; rejected original retained, accepted round 2 unchanged. No additional starts needed.

Verified source retained on local branch codex/vibe-usability-20261028 in the dedicated Codex worktree; discoverable vibe-supervisor skill link activated, previous link retained as .vibe-supervisor-before-usability-20261028. Link target and all four product hashes checked after activation; skill validator passed through the discoverable link. No claim of hot-reloading another active chat. Connected candidate remains 65dbafd0700891c72978e35df8a599a1c110ba37d13ff68bb19a3004cbe1e716, eligible/preparation PASS, no blockers, free slot after activation. See activation.json and post-activation-readiness.json.

No product runtime code, running server bytes, pin or configuration changed. No commit/push/merge/publication. Initial checkout and branch preserved. Two supervisor-owned dirty trial worktrees retained with current exports and explicit reasons. Private original exports retained separately; public evidence sanitized and checksummed. Owned review seed removed after preserving exact input copies.

Next routine use: invoke $vibe-supervisor with one narrow question or edit, named files, acceptance criteria and immutable edit base. Continue measuring real-task usefulness; these fixtures establish bounded workflow operation, not universal answer correctness. Packaging/release, broad reliability and nested-effect qualification remain separate future tasks.

## Follow-up amendment 4 — reported integration-test failures

Owner reports repeated tests rejected on coordinator-added literal assertion imports and copy preparation requiring package manifests/lockfiles even with --no-install; asks how to resolve the failures. Continue the authorized autonomous repair within the existing remaining round 3/3; rounds 1–2 and their acceptance remain historical. No hosted replay is required to diagnose this: reuse the exact preserved second patch (SHA-256 5723b5e04558a63b4b7f601afbfabfade16547257198bebcd3276bd731fe3e7b). Its original frozen-contract failure remains recorded. Revised semantic evaluation is a separate diagnostic; it cannot mark that original contract passed.

Required R6: skill, adapter and example contract require traceability to requested outcomes, use exact text only for genuinely required syntax/bytes, and use coordinator validations for semantic equivalence. Keep path limits, user-required node:test cases, immutable grants, original assessment and hashes. Check documentation links/diff and independently execute the preserved generated tests and boundary negative controls. Negative controls must reject the unfixed threshold and missing named tests; strict assertion import equivalence must pass.

Required R7: validation --no-install creates owned independent baseline/candidate copies with exact patch without invoking a package manager or requiring package.json, packageManager, lockfile or cache. Offline installation retains existing exact-manager/lock/cache and unsupported-profile safeguards; ownership/fingerprint/cleanup remain fail-closed and legacy manifests remain readable. Regression tests cover package-free and no-lock fixtures, no manager execution, install prerequisites and cleanup/tamper protection. Gate: relevant validation tests, npm run verify:release, exact retained-patch CLI reconstruction and tests. Changed helper source is local only, not the installed hosted candidate; no hosted qualification transfers.

Assignments: coordinator owns this EDD, .agents/skills/vibe-supervisor/SKILL.md, .codex/agents/vibe-reviewer.toml, docs/workflow-acceptance.md, docs/local-operation.md and docs/local-trial examples plus Handoff/development strategy/evidence. Bounded implementation worker gpt-6.1-terra/high owns src/validation/workspace.ts, src/cli/validation.ts, tests/unit/validation.test.ts and docs/validation-workspace.md only. All preserve existing edits; no delegation. Fresh independent gpt-6.1-sol/high verifier after deterministic gate under the owner's existing Amendment 3 no-write/no-command permission amendment. Product round 3 open; 2/3 consumed. Recovery still initial plus one justified recovery per cause.

Toolchain preflight: this retained documentation worktree had no node_modules. npx vitest offered an unpinned download; interrupted before any test executed. Repaired by copying existing installed dependencies from the sibling qualification worktree only after byte-identical package-lock comparison. Use pinned local tools thereafter; no dependency/version change. Evidence and failed original reports stay private; public summaries redact machine paths.

## Follow-up round 3 deterministic gate

R6/R7 local checks passed: focused validation suite 13 tests; skill validation; adapter TOML/example JSON; 53 local links/anchors; diff check; full npm run verify:release on Node 24.22.1 exit 0. The actual retained trial base and exact original patch were reconstructed through the rebuilt CLI without manager/cache/lockfile. Five generated named tests and eight independent cases pass. Strict import forms are the same runtime object; negative controls reject missing registrations and the unfixed threshold. Original frozen-contract FAIL is unchanged; diagnostic requirement PASS is separately labeled. No hosted starts spent. Public raw evidence is in research/evidence/vibe-usability-20261028/followup; private diagnostic script retained outside the repository. Fresh Sol/high independent verification is next under Amendment 3; round 3 remains open through its verdict.

## Follow-up final state — round 3

VERIFIED: fresh independent gpt-6.1-sol/high reviewer accepted R6/R7 for all 11 frozen source hashes, under Amendment 3 instruction-based read-only/no-command/no-delegation conditions. Original temporary candidate inputs existed during successful diagnostic execution and were unavailable later; no actor or removal time is known. Exact patch/check bytes and raw results are preserved. No required local follow-up criterion remains open. Product rounds consumed 3/3; no additional hosted starts.

The active skill link already resolves to this worktree, so future chats can load the corrected guidance. The installed server/CLI still belongs to its previous frozen distribution; the copy-only repair was tested through this worktree's rebuilt CLI and has not been packaged or installed. No release/hosted evidence transfers. Validation copies were removed after content-fingerprint verification; private diagnostic script/logs and original hosted worktrees remain retained. Initial checkout remains clean at its startup HEAD. No commit, push, merge or publication.

## Routine integration-test preparation recovery — 2026-10-28

The owner's subsequent fresh-chat integration test stopped before dispatch because a coordinator-created patch was mode 0644. No grant/start/configuration change occurred. Resume this operational test against the unchanged product candidate; no product repair round, model or prior acceptance is reset. Preserve the stopped preflight. Inspect ownership, canonical regular-file identity and nlink, change only mode to 0600, verify unchanged SHA-256 and retry preflight once (initial failure plus one justified recovery). Clarify the minor skill/docs omission: private patch files, private parents and bounded diagnosed pre-start repair. No artifact-policy or runtime code change.

The original authorized one-review/one-edit allowance is unspent. After successful preflight, use exactly these two starts with frozen semantic criteria, no additional import/style constraints, independent exported-patch tests and mutation control. A hosted failure is retained and not replayed. Add only the exact retained fixture to the selected allowlist with rollback, then restore it. User authorization for necessary tests and scoped preparation remains valid; no publication or integration. This is ordinary measured use after local R6/R7 acceptance, not new hosted qualification of the helper's rebuilt distribution.

### Operational recovery outcome

Mode-only preflight recovery passed. Two starts used once each: review bf6eca97-4c5f-446c-9f46-0d593510703f accepted independently; edit 6ed771c3-ba20-4242-9e73-d3a6e02e1460 rejected for missing node:test import. The original exported patch remains unchanged, with eight numeric cases passing and worker tests failing. One coordinator-only import correction in separate copies passes five tests and fails against the original at 100; it is diagnostic fallback evidence, not Vibe success. Both runs closed, dirty supervisor worktree retained, selected config restored exactly and slot free. Evidence-script stream assumption (stderr rather than combined output) was corrected once; no code/oracle change. Runtime source and previous product-round accounting unchanged; only minor guidance edits. No further hosted replay. Public evidence: research/evidence/vibe-usability-20261028/preflight-recovery.

Operational diagnostic audit supports the recovery/rejection/repair attribution. All three validation roots were removed after full fingerprint checks; original exports, logs, corrected-test snapshot and dirty supervisor-owned edit worktree retained. No extra hosted starts, product source changes or publication.
