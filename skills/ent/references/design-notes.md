# /ent design and review scenarios

Created 2026-10-04 from this repository's completed investigation cleanup. This is an instruction-only Codex workflow, not an automatic deletion script. No Claude companion/global configuration is needed for the requested Codex workflow.

## Research and scope

Local skills cover delegation, authoring, and coordination but not ownership-aware cleanup with conditional archival. Comparable skills focus on continuity:

- [mattpocock handoff](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md) favors concise handoff and existing artifact references. `/ent` also verifies cleanup and preserves handoff outside deleted temporary storage.
- [EveryInc ce-handoff](https://github.com/EveryInc/compound-engineering-plugin/blob/main/skills/ce-handoff/SKILL.md) preserves resume context. `/ent` adds ownership checks and conditional app archival.

These were reviewed as examples, not imported as instructions. No external commit, transcript-reading, or CLI assumptions are adopted.

Authoritative sources:

- [Official Codex skills](https://learn.chatgpt.com/docs/build-skills): user discovery, symlinks, explicit invocation, and `agents/openai.yaml` policy. Documented Codex syntax includes `$ent`; `/ent` is the requested name/display label, not a claim of universal CLI slash-command registration.
- [Agent Skills specification](https://agentskills.io/specification): portable frontmatter and progressive loading.
- [Git worktree documentation](https://git-scm.com/docs/git-worktree): clean checkout removal and missing-checkout administrative pruning. Git alone does not establish thread ownership.
- Runtime app tool descriptions govern `list_artifacts`, `archive_worktree`, and `set_thread_archived`; capabilities vary by client.

## Lessons

Updated 2026-10-06: `/ent` now reads a relevant project cleanup skill/procedure before its default resource decisions, explicitly accounts for this thread's disposable plans/worktrees/fixtures, and asks usable owned Mistral ACP workers for bounded self-cleanup or inventory. The coordinator still owns verification and supervisor worktree cleanup. Programmatic/closed runs cannot be continued, reviews cannot delete files, and worker tools cannot manage runtime homes/locks/processes. A pasted other-chat run ID does not establish ownership. Editing `/ent` itself does not run cleanup or archive.

Temporary supervisor/bootstrap paths disappeared before cleanup. Two stale registrations remained. A dry run identified them; pruning needed a narrow metadata-write escalation. The rejected patch was already unavailable, so the handoff and correction report recorded that instead of claiming preservation/resumability. Broad app-cache cleanup was inappropriate. Durable reports and skills survived.

## Review scenarios

These are manual instruction-review cases, not hosted model evaluations or destructive integration tests.

| Input/state | Expected behavior |
|---|---|
| “Create /ent” | Author/install; do not execute cleanup or archive. |
| `/ent`, completed work | Preserve, clean verified owned resources, verify, archive current thread. |
| `$ent cleanup only` | Clean and report; keep open. |
| Documented future backlog only | Preserve backlog; archive if current work/cleanup complete. |
| Unfinished request or active goal | Catch-up list; keep open without false completion. |
| Dirty candidate with useful ignored files | Preserve content/history or retain checkout. |
| App-managed worktree | Recoverable app archive, no raw removal. |
| Supervisor export predates edits | Fresh verified export or retain candidate. |
| Missing paths and owned stale registrations | Record absence, review dry run, prune eligible entries. |
| Unrelated entry in prune dry run | Do not run repository-wide prune. |
| Similar name in shared temp/cache | Retain without ownership evidence. |
| Failed close, cleanup, or archival | Report failure; leave open. |
| Completed uncommitted primary-checkout docs | Preserve and report; no unsolicited commit. |
| New instruction before archive | Reassess completion. |
| Project has a local cleanup skill | Read and apply its applicable constraints first; skip recursive ent invocation and preserve ownership safeguards. |
| Temporary plan created in this thread | Preserve decisions, close plan items, then remove the exact disposable file. Durable roadmaps remain. |
| Usable owned ACP edit session | Ask Mistral for bounded self-cleanup/inventory using local rules; inspect fresh artifacts, then supervisor close/cleanup. |
| Read-only Vibe session | Inventory only, no deletion or edit-mode request. |
| Programmatic, closed or expired worker | No cleanup replay/new run; coordinator/supervisor cleanup with preserved ownership evidence. |
| Worker claims cleanup with no removal tool | Verify supported operations; coordinator handles proven disposables or reports a blocker. |
| Isolated home or run belongs to another client/chat | Preserve it; NOT_FOUND and pasted IDs do not authorize deletion. |
