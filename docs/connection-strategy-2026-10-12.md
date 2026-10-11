# Connection reliability proposal

Date: 2026-10-12. Status: PROPOSED, NOT IMPLEMENTED. This is the next reliability priority, before another project trial. No runtime, registration, allowlist, provider budget or release was changed by this investigation.

## Evidence and diagnosis

The Garnebo execution ledger records VSUP_WORKSPACE_INVALID before run creation, with zero inference and no worker worktree. Its claim of cached roots is consistent with the source and local files, but the exact refusing connection was not identified by a live provenance receipt.

In integrated rc.23:
- src/config/isolated-home.ts reads the selected template and writes a session config snapshot at startup/adoption.
- src/cli.ts switches VIBE_SUPERVISOR_HOME to that session and calls serve without the original selected config path.
- src/core/run-manager.ts holds a constructor configuration and validates dispatch against its allowedWorkspaceRoots.
- There is no native workspace-specific readiness operation; vibe_status requires an existing run UUID.
- supervisor_version in saved-run output belongs to the recorded run, not necessarily the currently serving process.

Read-only inspection on 2026-10-12 found the authoritative template hash 2163b69e8725c01367abb05a35584d4b60800bfd90618fbb5703efe8ca735e4c with Garnebo allowed. Eleven session snapshots exist: three include Garnebo; eight retain the older hash 03d919af2dc2925cb91f91817f1d35f7716c42253db75db360a5536e0123b913 without it. This inventory does not establish which sessions are live or which refused dispatch. Do not delete or signal them on that evidence.

The mechanism is configuration divergence: editing the template cannot change an already constructed manager. Restart-dependent synchronization, weak readiness checks and immediate infrastructure fallback allow a coding task to finish while the intended Vibe test never starts. Luna does not repair this connection path; it routes around it. Earlier absent-tool, saved-run lookup and turn-limit issues are separate failures, not evidence of a single provider defect.

## Recommended design

Keep local stdio, private per-connection storage, exactly five tools and one active run per owning instance. Change configuration authority and readiness rather than adding a daemon, HTTP service, ACP, task replay or retry framework.

### One authoritative policy source

Preserve the explicit original config selection throughout isolated startup. Separate policy source from private session storage. Session snapshots are audit records, never the authority for a future dispatch. No environment/default fallback when an explicit source fails.

Before every preflight and new start, securely reread and validate that selected owner-controlled source. Apply approved workspace-policy changes without requiring a Codex restart. Keep executable, storage and other boot-bound settings pinned: unsupported live changes return an explicit restart-required result, not partial adoption.

Use atomic config writes; validate owner, permissions, size, canonical paths and no unsafe links. Do not grant roots from task input, project configuration, worker output or model suggestions. Existing approval requirements for owner configuration edits remain intact. Invalid or missing policy fails closed; do not retain permissive stale policy as a fallback.

Freeze a validated policy generation per run. Do not mutate worker permissions in flight or replay anything. Roots removed from the authoritative policy deny subsequent starts. Define and test active-run revocation/close behavior explicitly, including preserving verified exports and safe termination. Cleanup must use fresh path/policy validation; revocation may intentionally retain a worktree for manual review.

### Workspace readiness on the actual connection

Add an explicit server/workspace mode to vibe_status while retaining its current run-status contract and the five-tool catalog. This is a proposed additive schema change, not an available rc.23 argument. Keep run identity and live server identity separately named.

The proposed response includes current server version and instance ID, selected policy path, semantic revision, boot-setting drift, session identity, canonical requested workspace, review/edit eligibility, exact base identity where applicable, active-slot state, pinned runtime compatibility and structured blockers. It must not expose credentials or private histories. Provider authentication remains unknown until a real authorized call.

Preflight and dispatch share the same validators. No model call, run record, worktree or provider cost is created by preflight. Validate config, workspace, context paths, forbidden project extensions, edit-root/base requirements and runtime prerequisites rather than checking merely that tools exist.

Return a short-lived opaque receipt bound to instance, policy generation and requested operation/workspace/base/file scope and limits. Dispatch revalidates and atomically claims the slot; stale receipts, policy/path/base drift and a newly busy instance reject before inference with concrete remediation. A receipt is neither user authorization nor guaranteed provider availability. Bound receipt retention and reject cross-instance use. Update old-client behavior explicitly and test schema compatibility; do not silently make legacy calls spend against a different preparation contract.

### Make Vibe mandatory for Vibe trials

Use a Vibe-required testing mode. Where supported by the installed client, a trusted project-local Codex MCP entry can set required=true so initialization failure stops startup/resume. Verify this on the actual desktop before relying on it. Do not make unrelated chats depend on Vibe or alter global registration silently.

Every testing thread begins with native workspace preflight. Installed CLI version, doctor success, an official client in a different process and old-run readability are supporting checks, not substitutes. If tools are absent, classify CONNECTION_FAILED. If policy rejects the workspace, classify PREPARATION_FAILED. Neither is a failed inference run or a successful Vibe test.

Connection preparation failures go to the coordinator's repair path; they must not automatically select Luna. Resolve prerequisites before implementation begins. Luna remains the authorized implementation fallback after an actual bounded Vibe task fails acceptance. If production work must proceed with Luna despite infrastructure failure, make that an explicit separately reported lane and leave the Vibe test blocked.

A start call with an uncertain outcome must never be repeated automatically. Status and cleanup use validated run identities when available. Configuration/preflight checks are free of inference and may be rechecked after a deliberate repair; that does not authorize replay of a hosted task.

## Why retain stdio

Official Codex documentation supports stdio command/args, trusted project configuration and required initialization. Nothing reviewed establishes automatic desktop refresh of this supervisor's in-memory policy. The policy snapshot issue belongs to our server.

A persistent HTTP daemon would add authentication, service lifecycle, shared ownership and migration scope while still needing policy refresh and readiness. A launcher-only repair or project-specific static registration would reduce ambiguity but still leave stale policy after a new approval. A second hidden CLI execution route would mask native failures. Keep one production path; official-client probes remain explicitly diagnostic.

Runtime upgrades still require reconnecting: do not replace loaded code mid-run or force-kill desktop-managed processes. Native preflight must identify an old executable and block before the task. Project allowlist changes on a correctly upgraded connection should no longer require a restart.

Sources: [official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [required/startup configuration](https://learn.chatgpt.com/docs/config-file/config-reference). These support client configuration options, not a guarantee about the current desktop implementation.

## Implementation sequence and acceptance

1. On a clean branch from integrated main 27a30c21e5488ea9dbf4ecb1e46fb3d2c93418db, define additive status/receipt contracts, current-server provenance and the authoritative policy source. Preserve the older primary dirty checkout. Review boundaries before coding.
2. Implement source separation, validated per-dispatch policy reads and serialized admission. Add native no-inference readiness and generation-bound admission. Update setup diagnostics and skill instructions.
3. Run targeted regressions, full release checks and offline installed-package smoke; preserve exact archive/source identity. No hosted inference is needed to reproduce stale-policy failures.
4. Install/register only with authorization. In the actual desktop testing thread, verify version and project preflight before any paid run. Then perform a separately authorized narrow hosted review. Candidate authentication remains unverified until then.

Required regression evidence:

| Case | Required outcome |
| --- | --- |
| Connect with fixture-only roots; owner approves/adds Garnebo afterward | Same connection preflight sees Garnebo without restart; mocked start uses new policy |
| Remove Garnebo | Next preflight/start deny it without inference; cleanup retains evidence safely if necessary |
| Malformed, missing, oversized, foreign-owned or symlinked config | Fail closed, actionable reason, no stale permissive fallback |
| Two already connected servers | Both see the same approved policy revision while retaining isolated ownership |
| Old installed runtime/boot-setting drift | Current provenance identifies mismatch; readiness false; no task launch |
| Receipt drift, instance change, expired receipt, concurrent slot claim | Reject before inference; no automatic retry |
| Change policy during a live run | Frozen run contract preserved; subsequent admission follows current policy; tested revocation behavior |
| Existing run-status/result/close, reconnect lookup and retained dirty worktree | Existing supported behavior and safe ownership remain intact |
| Native tools missing or selected wrong config | Setup/test fails visibly rather than defaulting to Luna |
| Garnebo native preflight then authorized review | Concrete native receipt and actual run ID; useful accepted result; closure evidence |

## Operator outcome

The future workflow is: select task -> authorize its narrow workspace/budget -> native preflight -> start one bounded Vibe run -> independently verify -> accept or deliberately hand remaining work to Luna.

The guarantee we can enforce is that a test cannot be declared ready or silently substituted when its connection/policy prerequisites fail. Provider outages and inference-quality failures remain possible and are recorded separately. The stale allowlist mechanism must be demonstrably removed before another project trial is advertised as ready.
