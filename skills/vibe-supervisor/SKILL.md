---
name: vibe-supervisor
description: "Use when delegating a bounded code review or isolated edit to Mistral Vibe through the local Vibe Supervisor MCP tools. Do not use for unrestricted shell/network execution, deployment, credentials, or automatic patch application."
license: MIT
---

# Vibe Supervisor

## When To Use

Use for bounded review/edit delegation and version/catalog preflight. Use [vibe-acp](../vibe-acp/SKILL.md) when an edit requires same-session verification and correction. Do NOT use for deployment, credential extraction or work outside existing allowed roots. This is an application policy boundary, not an OS sandbox.

## Inputs To Collect First

1. Observable outcome, acceptance criteria, canonical allowed workspace and explicit Git base for edits.
2. Exact owned files, exclusions and reviewed changes to preserve; never put secrets in task text.
3. Authorized cumulative turns, deadline, bounded wait and cleanup reserve. Turn limits are not daily provider quotas.
4. Connected server version/catalog, distinct from installed CLI version and saved run creator version.
5. For existing work: run_id, source/worker paths, current state and fresh artifacts on its owning connection.

## Procedure

### Step 1 — Verify the actual connection and boundary

Inspect the connected schemas before dispatch. The `acp` backend exposes review_start, edit_start, status, result, close, continue and respond, all prefixed `vibe_`; programmatic exposes five without continue/respond. There is no vibe_cancel, tool-side backend or allow_shell parameter. Use only observed tools and schema fields; do not invoke a cached older catalog. If handshake metadata is unavailable, a fresh official client can verify the executable separately, but does not prove native desktop reload.

The workspace must already be inside an allowed canonical root; edits require its Git repository root. A real root .agents directory is supported with project discovery disabled and reserved file paths denied. Root .vibe, unsafe .agents, symlinked .vibeignore and glob-containing roots remain refused. Preserve project files; never bypass a guard or broaden an allowlist silently. Run `vibe-supervisor doctor --json` for missing tools/launch prerequisites; it does not prove hosted authentication. Configuration changes require their applicable authorization and a server restart/reconnection.

### Step 2 — Prepare reviewed state before inference

A detached edit starts at base_ref; dirty/untracked changes are not copied. Commit or otherwise fix the reviewed state first. If reviewed overlays are required and a source checkout of Vibe Supervisor is available, its coordinator script takes an owner-private manifest of selected path operations, base/reviewed hashes and modes (see `scripts/README.md` there; it is not part of the installed package):

```bash
node scripts/prepare-reviewed-baseline.mjs /absolute/private/manifest.json
node scripts/prepare-reviewed-baseline.mjs /absolute/private/manifest.json --create
```

Dry-run first. Explicit creation makes a new private snapshot repository and local commits there, preserving original files/index/refs and existing allowlists. Verify the manifest, required files and actual prepared bytes; dispatch with its source_workspace as cwd and its base_ref. Keep original provenance with coordinator evidence. Refused credential/reserved/ignored/binary/link inputs need a scope decision, not a weaker guard. Never ask Vibe to reconstruct baseline files from pasted diffs or modify an active worker worktree.

### Step 3 — Delegate and wait within the declared budget

Give one worker one bounded increment, exact relative file ownership, preservation rules and the actual inventory: reviews read_file/grep; edits also write_file/edit. State that it shares the codebase, shell/network/check execution are unavailable, and no commit/merge/push/source application is permitted. Request a concise final answer and an inventory of any worker-owned scratch. Reviews need concrete findings with file/location, trigger and incorrect behavior, or an explicit no-defect result for the inspected scope; never require a finding count.

Start with wait_seconds within the execution plan. Use cursor-based vibe_status waits and carry next_after_seq into after_seq; avoid rapid polling. Short pilots retain their declared waits/deadlines. Keep all calls for an isolated run on its owning connection. Do not increase budgets, rotate accounts or replay tasks automatically; a prompt requesting an early answer cannot guarantee reserved turns.

### Step 4 — Verify while the session remains open

Read stop_reason, warnings and compact result first. Completed/end_turn plus an actual final answer means candidate-ready, not accepted. A max_turn_requests result is incomplete; the cumulative session ceiling is spent and any increase/replacement requires explicit authorization. For review integrity changed/unverified, inspect changed_paths and qualify findings.

For edits, obtain the full result/transcript and fresh patch; inspect changed/new/residual files and hashes. Run tests, builds, dependencies and caches only in a separate exact candidate verification copy, never in the Vibe worktree or original source. Keep the usable session open through tests and independent read-only review; use vibe-acp for focused corrections within the remaining budget. Re-read after an edit-match failure and reassess after a second repeated match failure; this is coordinator guidance, not an automatic runtime stop.

For settled pinned ACP edits, a source checkout can optionally audit private records with its coordinator script:

```bash
node scripts/audit-edit-run.mjs /canonical/private/home run-id --files /absolute/private/scope.json
```

The optional scope file is owner-private JSON with 1–64 unique normalized repository-relative paths. argument_scope describes call arguments only; declared_scope stays unverified until independent export checks. With a scope file, a write outside it or a successful call to any other tool makes the report unverified with a non-zero exit. Counts distinguish messages, calls, failed updates and unique failures; Unknown tool differs from Supervisor policy denial. Unsafe/incomplete evidence stays unverified. Never publish raw histories, arguments, replacement text, credentials or reasoning; do not infer billing from counts.

### Step 5 — Accept, export and close

Accept only the exact tested/reviewed delta. Source integration, commit/push and deployment require their applicable authorization; delegation does not grant them. Verify original source invariants before manual integration. If scratch remains and the session is usable, request removal of exact worker-owned paths and re-export; never start a new run merely to clean an old worktree.

Obtain a fresh export matching the final worktree before vibe_close(cleanup_worktree:true). Record closed state, worktree_removed and independent path absence; retain/report cleanup refusal rather than force-delete. A premature close followed by coordinator correction is a partial worker gate, not an accepted original Vibe candidate. Report stop reasons, actual checks, limits and remaining gates; keep old failures separate.

## Completion Checks

- [ ] Actual connection/catalog and prepared source/base provenance were checked.
- [ ] Scope, tool boundaries and cumulative limits were preserved.
- [ ] Exact candidate checks and required reviewer acceptance preceded close.
- [ ] Fresh export, scratch accounting and cleanup outcomes were recorded.
- [ ] Candidate-ready, worker acceptance, coordinator correction and unverified gates are distinguished.
- [ ] No private histories, reasoning or credentials were exposed; no unsupported hosted claim was made.

## References

- [ACP correction workflow](../vibe-acp/SKILL.md)
- [Reference](../../docs/reference.md), [behavior](../../docs/functionality.md), [security](../../docs/security.md), [compatibility](../../docs/compatibility.md), [errors](../../docs/errors.md)
- [Agent Skills specification](https://agentskills.io/specification)
