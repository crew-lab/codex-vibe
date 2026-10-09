# Vibe worker adoption enhancements

Date: 2026-10-09. Status: **Implemented in rc.14. Offline verification and the rc.13 hosted pilot passed; the product Vibe gate remains partial after coordinator correction.**

Basis: [rc.12 SEO execution review](history/reviews/rc12-seo-worker-adoption-2026-10-09.md). Implementation starts from the preserved rc.12 source candidate in `codex/project-agents-isolation`, not the old dirty primary checkout or rc.10 HEAD alone. Record the full starting source patch/hash before any delegation. Preserve the existing rc.11/rc.12 work, installed versions, private failures and unrelated changes. The planning request did not authorize commit or push; the user subsequently authorized both for this delivery. Publication, provider changes and account rotation remain outside scope.

## Delivery status

Steps 1–4 are implemented and release-verified in rc.14. Step 5 passed on rc.13 with one same-session correction and verified cleanup. Step 6 produced a narrow CLI candidate on rc.13, but the coordinator closed before independent checks; the original candidate was rejected and a tested/reviewed coordinator correction is included in rc.14. The Vibe product gate is PARTIAL, not complete. Keep future product sessions open through acceptance and correction before close. See [evaluation](history/reviews/rc13-worker-adoption-2026-10-09.md).

The sections below retain the acceptance contract and workflow rules; they do not claim unperformed hosted gates or guaranteed provider request counts.

## Outcome

Give Vibe an already correct baseline and a small implementation increment. Make tool failures and actual candidate acceptance visible without exposing private histories. Complete the same-session implementation/verification/correction/cleanup loop before a larger product task. Retain the 20-turn ceiling used for product tasks unless the user explicitly chooses a different budget; the prepared synthetic pilot retains its 12-turn ceiling.

The observed run contained a 79,243-character initial prompt, 20 assistant messages, 35 tool calls and no final answer. Seventeen calls targeted page.tsx. The unavailable bash request was rejected by Vibe's tool lookup; subsequent calls continued and the terminal reason was max_turn_requests. These facts support baseline/workflow improvements, not permission weakening or a provider quota change.

## Roles and authority

The coordinator prepares the baseline, checks hashes, dispatches bounded ACP work, runs checks in a verifier copy and manually integrates only accepted changes. Its preparation helper writes only a new owned disposable repository and private manifests. The Mistral worker has read_file/grep plus write_file/edit in its detached worktree; shell/network and project discovery remain disabled. The independent reviewer reads the exact candidate and evidence without changing code. Supervisor owns process lifecycle, detached worktree creation/export and verified cleanup. None of these changes introduces permission grants or automatic source integration.

Data flow: reviewed overlay manifest → deterministic prepared snapshot/ref → bounded Vibe candidate → separate verifier copy and read-only review → focused same-session correction if needed → fresh accepted delta/export → coordinator integration and verified cleanup. Each handoff binds the base/candidate hashes; an uncertain handoff stays unresolved rather than replaying the task.

## Delivery sequence

| Step | Deliverable | Acceptance before proceeding |
| --- | --- | --- |
| 1 | Coordinator-owned baseline preparation helper and manifest | Exact reviewed bytes present; source/index unchanged; unsafe inputs refused; dry-run is default |
| 2 | Safe edit-run audit and classified failure evidence | Unique calls/updates/messages distinguished; known error classes verified; unknown evidence stays unknown; no secret/reasoning leakage |
| 3 | Updated delegation/verification protocol | Small scope, baseline-first preflight, bounded retries, explicit cumulative budget and separate verifier copy |
| 4 | Offline regression/release verification | Relevant checks plus full package verification and offline installed-package smoke pass |
| 5 | One prepared synthetic hosted edit/correction pilot | Initial implementation and final answer, one same-run correction, fresh exports and verified cleanup pass |
| 6 | One narrow product increment against prepared baseline | New feature delta accepted independently; no model-based baseline reconstruction |

Stop on the first hosted failure and preserve evidence. Do not run a full soak as part of these steps. No successful small pilot substitutes for native desktop, callbacks, restart/recovery, Intel, clean-account or D18 gates.

## 1. Baseline preparation: coordinator tooling first

Implement `scripts/prepare-reviewed-baseline.mjs` backed by a focused source module, proposed `src/git/reviewed-baseline.ts`. Reuse canonical-path, private-file, bounded-process, Git-filter and redaction primitives where their contracts fit. Do not use blanket `git add --all` or captureDirtySnapshot as an implicit file-selection policy.

Inputs:

- canonical source repository under an existing allowed root;
- explicitly resolved base commit;
- an exact reviewed overlay manifest: repository-relative path, add/replace/delete operation, expected base hash or expected absence, reviewed content hash, and file mode where relevant;
- explicit private output parent under an existing allowed root;
- dry-run by default; explicit creation flag for a disposable snapshot repository.

The coordinator supplies selected reviewed regular text files, not an entire dirty checkout. Initial implementation refuses binary overlays, symlinks, special files, submodules, traversal, ambiguous/case-colliding paths, undeclared changes, ignored/private files and reserved-path overlays. Root AGENTS.md and tracked .agents content already in the base retain current isolation policy; this helper does not accept new overlays to those reserved paths. A legitimate broader case requires a separate design decision rather than a bypass.

Validate size/count bounds using existing limits where possible; document fixed defaults before implementation. Check recognized credentials in selected content/patches. Never print content on a failure. A credential scan is a bounded check, not a promise that arbitrary data is secret-free.

Resolve the base before reading; verify expected hashes and unchanged source inputs before and after capture. Stable reads must use no-follow/private-file practices and fresh identity/hash checks. A change during preparation fails closed, leaving an explicitly inventoried disposable for recovery or safely removing only proven owned outputs.

Create an independent local repository from the declared base with source-local hooks, filters, user tools and configuration inactive. Do not use shared writable object storage or a copied source .git directory. Stage only the declared overlay in that disposable repository. An explicit creation invocation may create a local fixture/snapshot commit there to make the prepared state addressable by base_ref; it never changes the original branch, index, files or refs, and never pushes. Clearly disclose this behavior in the command help/protocol. Existing-ref preparation needs no new commit.

Output an owner-private immutable manifest containing original source/base provenance, overlay path operations and hashes, prepared snapshot path/ref, capture status and aggregate digest. After creation, independently compare the prepared tree to declared bytes and ensure a clean snapshot repository. The actual MCP source_workspace is the snapshot repository; do not mislabel it as the original product checkout.

Start Vibe against that prepared repository/ref. Keep the original manifest with coordinator evidence; send the worker concise scope/acceptance and paths already present. Do not copy files into an active worker worktree. Compare the worker candidate to the prepared baseline; export only the new implementation delta. Before manual source integration, verify the original reviewed baseline still matches the source and preserve any intervening foreign changes.

Meaningful regressions: dirty/new/deleted reviewed files; multiple overlay files; byte/mode preservation; source/index/ref invariance; missing base/hash mismatch; concurrent changes; ignored/reserved/secret/binary/symlink/submodule/traversal cases; hostile hooks/filters; interrupted creation and ownership-safe cleanup; no implicit allowlist broadening.

## 2. Diagnostics: classify evidence, not speculation

First add an offline edit-run audit alongside the existing review audit, with shared safe-read primitives. Proposed ownership: `scripts/audit-edit-run.mjs`, a shared audit module, audit tests. Do not change ACP permission correlation or lifecycle states in this phase.

Retained native records and normalized events are inputs. Require supervisor-owned canonical paths, owner/private permissions, no symlinks/hardlinks, bounded sizes and stable reads. Audit a settled turn; never treat a partly written live history as a complete snapshot. Missing/unsafe/truncated/ambiguous data returns unverified with an explicit reason, not a fabricated pass or a fabricated failure cause.

Public allowlisted outputs:

- recorded creator Supervisor version and separately known connected server version;
- backend, structured stop reason, final-answer presence and warnings;
- assistant-message count, unique tool-call count by validated name, failed update count and unique failed-call count;
- classification enum: missing_file, edit_no_match, edit_ambiguous_match, unavailable_tool, policy_denied, other, unknown;
- per-round counts where validated user-turn boundaries allow separation;
- declared-scope outcome, baseline/candidate/export digests and cleanup evidence.

Do not equate assistant messages with provider requests or billing. Distinguish a streamed update from a unique call, retries from successful work, and a Vibe Unknown tool response from a Supervisor permission denial. Correlate results by toolCallId/tool_call_id before classification; do not infer tool identity from ACP kind=other. Only proven formats get a specific class. Never persist raw commands, replacement strings, file contents, native messages, credentials or reasoning in the sanitized report.

After proving the classifier offline, add additive sanitized diagnostic fields to public status/result evidence if needed. Keep unknown/unavailable distinctly represented, preserve old records without guessing missing fields, retain structured stop_reason independently of diagnostic reason, and protect essential errors/stop/warnings under output truncation. This later integration is a separate reviewable patch, not a requirement to invent a new MCP tool immediately.

Regressions: duplicate streamed updates; multiple calls in one assistant message; repeated attempts with different IDs; malformed/missing IDs; unknown bash response; actual policy denial; benign strings resembling error messages; unavailable history; incomplete writes; restart/legacy evidence; output caps and secret/reasoning canaries.

## 3. Delegation and correction protocol

Update README, functionality/reference docs and the two delegation skills after the helper/audit behavior is defined. The coordinator must first verify live version/catalog, prepared baseline manifest and required-file availability. The worker receives one bounded increment, explicit ownership, a concise behavior contract and the real permitted tool inventory. The coordinator retains the full acceptance contract.

Keep one implementation worker at a time. Independent reviewer is read-only and reviews the exact candidate. Dependencies, tests, builds and caches belong to a separate candidate verification copy. Required historical ignored evidence is supplied explicitly with provenance; never disable the oracle to compensate for an incomplete archive.

On an edit-match failure, the worker re-reads the exact current file before a retry. A second consecutive match failure on that file without a successful corrective step triggers coordinator reassessment. This is initially a workflow rule, not a claimed hard runtime stop: no polling race, new lifecycle state, unsolicited replay or blanket cancellation is introduced. A later enforceable intervention requires its own lifecycle design and tests. Full-file rewriting is allowed only for a small owned file with explicit preservation checks; it is not the default response to failed matches.

Budget: max_turns is cumulative. A prompt asking for an early final answer is soft guidance and cannot guarantee reserved turns. Start with the agreed ceiling, record actual evidence, and continue only from a usable state with budget available. No automatic raising, account switching or replay. If a staged initial ceiling followed by an explicit larger correction ceiling is desired, approve the total and each transition in the execution plan before dispatch; do not present that as unchanged limits. Keep the current no-increase policy as the default.

Completed + end_turn + actual final answer is a candidate-ready condition, not acceptance. Initial candidate scope/tests and reviewer findings determine a focused same-run correction. Stop and report a failed preparation/unsupported runtime before consuming inference. Keep Luna fallback explicit and report its result separately from Vibe gate outcomes.

## 4. Verification and release

Perform targeted baseline/audit/lifecycle/privacy/Git checks while implementing. Once integrated, run lint, typecheck, build and the repository-required `package:rc` with the populated offline cache; it includes full release verification and installed-package smoke. Do not silently fetch dependencies from the network or edit generated dist as source.

Package the next candidate only after these checks. Preserve prior rc.12 installation and archive, config/allowlist values, source patch and failed evidence. Update behavior/security documentation and an ADR if a new baseline/runtime boundary is introduced. New optional metadata must preserve legacy absence. Commit/push/install changes require their applicable existing or new user authorization; installation was subsequently authorized and completed; commit/push were subsequently authorized for this delivery.

## 5. Hosted acceptance, in order

The first execution is the [prepared edit/correction pilot](acp-edit-pilot-2026-10-09.md), adapted only for the newly verified candidate version if necessary. Its tracked baseline is already complete. Keep 12 turns, 240 seconds, 30-second waits and the coordinator cleanup reserve. No automatic retries or budget changes. Record exact artifacts after each round, validate numeric behavior and corrected docstring independently, and verify final export/cleanup. Preserve native histories privately.

Only after that pass, select one narrow new product increment; do not redo accepted S1/S2/Gemini work. Use the preparation helper on a deliberately reviewed overlay to exercise real uncommitted-baseline support. Acceptance requires that worker files initially equal the declared baseline, the model is not asked to hydrate it, only the new feature delta changes, end_turn/final answer exists, independent tests/reviewer accept it, and source/cleanup invariants hold. Declare the task's limits before launch and stop on failure.

Useful measurements: prompt characters/bytes, helper preparation time, declared overlay count, assistant messages, tool calls/retries, failure classes, final-answer presence, correction rounds, candidate acceptance and cleanup. Cost is recorded only when an authoritative observation is available. One pass establishes that scoped run; it is not a comparative efficiency benchmark or a guarantee that every larger task fits 20 turns.

## Definition of done

The baseline helper safely produces an exact, provenance-bound starting state; the audit distinguishes actual failure classes without leakage or guessed evidence; the delegation protocol uses both; offline release checks pass; the small hosted correction/cleanup pilot passes; and one scoped product increment succeeds from a prepared reviewed baseline. Until hosted steps execute, mark them prepared/unverified. Larger soak and remaining Handoff gates stay separate.

Implementation note: scope acceptance remains coordinator/export evidence. The offline audit deliberately reports `declared_scope: unverified`; optional argument-path evidence is labeled separately. Request-level policy denials are counted without guessing tool-call correlation. No live status/result fields or lifecycle intervention were added.

Delivery evidence: [rc.13 hosted adoption evaluation](history/reviews/rc13-worker-adoption-2026-10-09.md). The original product candidate was retained and rejected; the independently reviewed coordinator correction is included in rc.14. No further hosted retry was made.
