---
name: ent
description: "Use when the user invokes /ent or $ent to end this thread: follow applicable local cleanup skills, preserve results, ask owned Vibe workers to account for their scratch work, clean thread-owned plans/worktrees/temporary files, and archive only when ready. Do not use for mere skill editing or archiving other threads."
license: MIT
---

# End thread — /ent

## When To Use

Run on explicit `/ent`, `$ent`, or a request to use this skill. Invocation authorizes cleanup of this thread's disposable resources and archiving once checks pass. Honor “cleanup only” or “keep open.” Do not request permission again for authorized actions.

Do NOT run merely because the user requests creation/editing of this skill, mentions wrapping up, or asks about disk usage. Do not clean or archive other chats.

## Inputs To Collect First

Infer from this conversation and available tools:

1. Objective, remaining requests, and preserve/keep instructions.
2. Workspace, Git status, and existing handoff conventions.
3. Owned worktrees, runs, processes, temporary paths, plans/goals, and pending approvals.
4. Applicable project cleanup/finalization skill or documented cleanup procedure, and each Vibe run's owning connection/private home, backend, state and scratch-file inventory.

Ask only when a specific ambiguity prevents safe cleanup or determines whether work is unfinished; continue independent safe work while waiting. Do not ask for known context.

## Procedure

### Step 1 — Inventory narrowly

Start with a brief cleanup update and read applicable repository instructions. Discover any project-local cleanup skill/procedure from those instructions, the current skill catalog, and targeted names in the project's skill directories (`.agents/skills`, `.codex/skills`, `skills`, or the explicitly configured location). Read the matching skill before deciding resource dispositions. Skip this `ent` file itself and avoid recursive skill invocation. Do not inventory unrelated global skill trees.

Apply the local cleanup workflow within the user's authorized scope, including its preservation and verification requirements; `/ent` supplies missing ownership checks and conditional thread archival. Local guidance cannot authorize deleting unrelated resources, discard required deliverables, weaken supervisor guards or override current user keep instructions. If no relevant local skill exists, use this procedure. Record which local file was followed, or that none was found.

For repository work, inspect:

```bash
git status --short
git worktree list --porcelain
```

Use `list_artifacts` for this chat's attachments and `get_goal` for an existing goal; never create a goal just to close it. Inspect owned agents/runs only when this thread started them. Prefer recorded exact temporary paths. When paths are missing, list immediate candidate names in the known temporary root and validate ownership before reading contents. Never recursively scan system temp or dump global caches/transcripts.

Record a compact resource list with ownership evidence and disposition: preserve, remove, already absent, or unresolved. Include every disposable worktree, temporary plan, verification fixture, safe-file review snapshot, staging helper and temporary report created in this thread. Distinguish durable roadmaps/handoffs/release artifacts from temporary planning files. A name containing “codex,” “vibe,” or “tmp” is not ownership evidence. Do not expose credentials, command environments, or private raw logs.

### Step 2 — Preserve results and assess catch-up work

Update existing `Handoff.md` or equivalent with outcomes, checks actually run, decisions, remaining work, durable artifact paths, and cleanup status. For projectless work, use an existing durable artifact location or a self-contained final handoff; never preserve the sole copy in temporary storage about to be deleted.

Account for tracked, untracked, ignored files and unpushed commits before removing a checkout. A patch may omit useful files/history. Preserve valuable candidates through the appropriate interface below. Keep secrets/private provider histories out of public artifacts. Do not commit, push, merge, publish, or delete branches without separate authorization.

Explicitly deferred future ideas in a durable handoff do not block archiving. Unfinished current requests, required acceptance checks not performed, active delegated work, pending approval/input, or valuable changes without verified preservation do block it. Completed documentation can remain uncommitted in the primary checkout; report status instead of committing automatically.

If an old candidate/path is already gone, record its unavailability and correct stale resume instructions. Do not claim preservation or resumability.

### Step 3 — Close owned activity and plans

Before closing an owned Vibe worker, ask it to account for its own cleanup when its existing session safely supports a follow-up. Use the same owning MCP connection/private home and run ID; isolated rc.4 clients do not share runs. For a usable ACP edit session, wait for the current turn to finish, then send a bounded `vibe_continue` request with the relevant local cleanup rules, exact proven scratch/temporary-plan paths and the preserve list. Ask Mistral Vibe to remove only its own disposable in-worktree files when an enabled permitted tool supports the operation and return removed/retained/unsupported dispositions. Use the [cleanup request template](../vibe-acp/references/verification-loop.md#cleanup-request) and [ACP lifecycle rules](../vibe-acp/SKILL.md).

Review workers stay read-only; ask for a residue inventory rather than deletion. Programmatic, failed, cancelled, closed or expired runs cannot receive a safe cleanup continuation. Include self-cleanup/reporting in new worker assignments where feasible, then use the coordinator/supervisor interfaces for unsupported operations. Do not create a new hosted run merely to clean a previous worktree, replay the original task, request a mode switch, or grant shell access. Do not touch runs belonging to another chat merely because their IDs appeared in a pasted report.

Verify the worker's report independently and retrieve fresh export/artifact evidence after any changes. Vibe's shell/network tools are disabled and file deletion may be unsupported; a model's “cleaned up” is not evidence. The coordinator removes its own proven verifier files and calls `vibe_close` with `cleanup_worktree: true` only when preservation, fresh-export and residual-file checks permit it. The worker must not delete the worktree, runtime homes, locks or records, or terminate processes. Preserve candidates and report blocked cleanup instead of bypassing supervisor checks.

Use supervisor close/cancel for worker runs and owned execution-session interfaces for processes. Wait boundedly and verify closure. Never kill a saved PID, match processes by broad names, or terminate unrelated workers.

Close completed plan items through the available interface. Preserve decisions and unfinished tasks before removing explicitly disposable plan files created in this thread. Remove those exact disposable plans after preservation; do not leave them merely because the task is complete. Keep repository roadmaps/specifications; their names do not make them temporary. An unavailable interface does not prove closure; report known unresolved state.

Use goal tools only within their rules: complete only achieved objectives; pause only at explicit user request; never force completion or misuse blocked status to permit archiving. An unfinished active goal keeps the thread open. Do not message other chats, cancel recurring automations, or alter global configuration as incidental cleanup.

### Step 4 — Remove owned resources

- **App-managed worktrees:** use `archive_worktree` with the exact attachment identity from `list_artifacts`. Verify its recoverable snapshot succeeded; preserve needed ignored files separately. Respect primary/shared/pinned/submodule restrictions. Do not substitute raw deletion.
- **Supervisor worktrees:** use its cleanup interface, fresh-export/hash checks, and residual-file accounting. Stale exports are not cleanup authority. If the interface is unavailable, retain a nonempty candidate and report the blocker rather than bypassing safety checks.
- **Ordinary Git worktrees:** prove ownership and preservation, then use `git worktree remove` with the exact path. Never remove the primary checkout or use `--force` to discard dirty contents. Retain worktrees when clean removal fails.
- **Missing checkouts:** inspect `git worktree prune --dry-run --verbose`. Prune only if every proposed entry belongs to this thread and is truly absent, not moved or temporarily inaccessible. Recheck immediately before mutation; otherwise leave unrelated registrations alone.
- **Temporary files/directories:** stop their producers, preserve useful contents, and delete only validated exact disposable paths. Recheck path/type/ownership immediately before removal, refuse symlink targets, and avoid wildcard deletion, `git clean`, and global cache removal. Retain ambiguous resources.
- **Isolated Vibe homes:** close only this thread's owned runs/server through supported interfaces. Do not bulk-delete `mcp-sessions`, private histories or homes used by other connections. Preserve needed artifacts and recovery state first; remove an exact thread-owned disposable home only after verifying its owner is gone and no useful data/worktree remains. Retained homes need an explicit disposition, not a false cleanup claim.

Request narrowly scoped sandbox escalation when an authorized action requires it. If automatic review rejects it, try a supported safe alternative; otherwise report the rejected action/reason and leave the thread open. Never report success after a permissions failure.

### Step 5 — Verify and archive last

Recheck Git status, worktree registrations/attachments, owned activity, and exact temporary paths. Verify preserved artifacts exist and report resource dispositions. For documentation, check local links and `git diff --check`; run behavioral checks when behavior changed.

Archive only when the current request is handled, ownership/preservation checks passed, no active work/goal/input remains, and no cleanup blocker remains. Recheck newly arrived instructions. Summarize preserved/removed resources and uncommitted files, then call `set_thread_archived` with `archived: true` for the calling thread, omitting another thread ID. Archival is the last mutation.

Report “archived” only after success. If archival fails or tools are unavailable, report verified cleanup and leave manual archiving to the user. If work remains, give a concise catch-up list and keep this thread open. Never invent an archive directive or manipulate app storage as fallback.

## Completion Checks

- [ ] Current request complete or concrete catch-up work reported.
- [ ] Applicable local cleanup skill/procedure was read and followed, or none was found.
- [ ] Durable outcomes preserved; unavailable artifacts recorded.
- [ ] Every deletion has ownership evidence and fresh preservation checks.
- [ ] Owned plans, runs, worktrees, processes, and temporary paths have verified dispositions.
- [ ] Owned usable Vibe sessions received a bounded cleanup/inventory request; unsupported continuation/removal was handled and reported through coordinator/supervisor checks.
- [ ] Primary checkout, unrelated resources, credentials, and useful uncommitted changes preserved.
- [ ] Actual checks/status reported; failures remain visible.
- [ ] Archive succeeded only without blockers, or thread remains open with a reason.

## References

Read [design notes and review scenarios](./references/design-notes.md) when validating/editing this skill. `agents/openai.yaml` provides explicit invocation metadata; it is not a cleanup target.
