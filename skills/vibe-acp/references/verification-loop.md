# Verification loop reference

## Prompt templates

### Initial task

```text
Outcome: <observable behavior>.
Workspace/base: <canonical source path and selected Git reference>.
Ownership: <exact files/modules>; excluded files: <list>.
You share the codebase. Preserve other contributors' changes.
Constraints: <versions, path boundaries, lifecycle and security requirements>.
Acceptance: <regressions and exact checks the coordinator will execute>.
Shell/network tools are disabled. Do not claim to have run shell checks.
Local cleanup rules: <relevant coordinator-read requirements>.
Track exact scratch/plan files you create; preserve deliverables and others’ work.
Clean only your disposable in-worktree files when permitted tools support it;
report unsupported removals. Do not manage worktrees, processes or runtime locks.
Produce a scoped patch and concise explanation of changes and limitations.
Do not commit, merge, push, or apply changes to the source checkout.
```

### Correction request

```text
Continue the same task and preserve correct existing edits.
Verification failed on the current candidate:
1. <command>: <short sanitized error, file/line>.
2. <review finding>: <concrete trigger, expected versus observed behavior>.
Required corrections: <specific minimal changes>.
Regression criterion: <behavior the coordinator must verify>.
Keep the original ownership and security constraints. Do not weaken checks
or change permission defaults merely to make the task succeed.
The coordinator will rerun <affected tests/checks> and review the new patch.
Explain what changed and anything still unresolved.
```

For the observed draft, actionable feedback would identify the TypeScript environment-object index error, unsupported `VIBE_AGENTS__...` overrides, the missing Keychain account selector and output bounds, and noncanonical test fixture paths. Do not send raw credentials or private reasoning as evidence.

## Final read-only review template

```text
Deliver the final read-only review now, not an implementation plan or mode switch.
Scope: <exact approved files and context limitations>.
Report only correctness defects supported by inspected files and observed checks.
Each finding needs file/location, concrete trigger and incorrect behavior.
Label conditions and assumptions. Exclude naming, placement, barrel exports and
other style preferences unless they cause a demonstrated behavioral defect.
If none is supported, say “No correctness defects found in the inspected scope”
and state limitations. Never invent findings to meet a count. Do not edit.
```

## Cleanup request

Send only through the same owning, usable ACP edit session after preserving the candidate:

```text
Finish cleanup for this assignment only; do not change feature behavior.
Local cleanup constraints: <applicable rules read by the coordinator>.
Owned disposable paths: <exact paths supported by recorded ownership evidence>.
Preserve: <deliverables, final patch, reports, user/other contributors’ files>.
Inventory scratch files and temporary plans you created. Remove only proven
in-worktree disposables when an enabled permitted tool supports the operation;
otherwise report the limitation and leave them intact.
Do not use shell/network, remove the worktree, terminate processes, delete
runtime homes/locks, or alter exports/digests. Return exact removed/retained/
unsupported dispositions. The coordinator will verify, export and close the run.
```

Read-only workers receive an inventory/report request, never a deletion request. Closed/programmatic runs have no cleanup continuation; use supervisor/coordinator interfaces with ownership evidence instead of replaying work.

## State and decision table

| Observation | Next action |
|---|---|
| ACP completed with a patch | Independently review and test before acceptance. |
| Candidate fails tests but session is usable | Send specific corrections through `vibe_continue`; fetch fresh results afterward. |
| Running or waiting for permission/input | Call `vibe_status` with `wait_seconds` or answer the current validated request; do not issue another prompt. |
| Failed, cancelled, closed, or expired session | Inspect artifacts and recovery capability; do not assume continuation or replay. |
| Programmatic run | No same-session continuation; preserve/export the candidate before planning a new run. |
| Claimed completion with empty patch | Compare against the task; text generation alone does not establish coding success. |
| Repeated failures | Narrow the task and identify the shared cause; reassess budget and harness before more model calls. |
| New worker changes after verification | Prior patch hashes and check results are stale; export/review again. |
| Independent client returns NOT_FOUND for a known run | Check the owning connection/private home before declaring the run missing. |
| Worker cleanup claim | Inspect exact paths and fresh exports; do not assume removal succeeded. |
| Review returns a plan/mode-switch request | Reject as incomplete; request the final read-only answer when safe continuation exists. |
| Missing real MCP tools | Report visibility separately from standalone-client discovery; do not invent tool availability. |

## Known integration failures

The original items are historical 2026-10-03 findings, not instructions to bypass policy. Later rc.2 acceptance recorded hosted browser-login reviews/edits and recursive/profile fixes; current ACP recovery, model identity and soak need separate evidence.

- **Concurrent ownership (2026-10-06):** direct servers competed for one owner lock. rc.4’s opt-in `--isolated` gives independent clients persistent private snapshots; all calls for one run stay on its connection. Template edits need new connections.
- **Project extensions (2026-10-06):** root `.agents`/`.vibe` fail the launch guard, including Codex-only skills. An authorized narrow safe-file copy can establish bounded hosted review, not full-project support or edits.
- **Hosted review quality (2026-10-06):** a two-file programmatic run passed inference/integrity/close, but style findings and a mode-switch plan failed acceptance. Focused instructions produced a conditional correctness finding. Model identity was not supplied.

- **Browser-login credential and private HOME:** the login credential was present in normal macOS Keychain lookup but absent with a fresh HOME. Repeating setup did not repair supervisor lookup. A private in-memory diagnostic bridge reached hosted generation, but later hosted acceptance supersedes that original normal-integration uncertainty within its tested scope. Keep authentication in the provider runtime; never put credentials into tasks, files, or logs. Do not advise an API-plan upgrade solely because the internal credential name is `MISTRAL_API_KEY`.
- **Nested path grants:** Vibe 2.25.8 matches absolute glob allowlists with `PurePath.match`; `<root>/**` did not authorize nested descendants. The installed matcher recognized `vibe-path:directory_recursive:<canonical-root>`. Any implementation must test nested, sibling, outside, sensitive, and symlink paths against the real pinned resolver. Retain `never` fallback and deny patterns.
- **Built-in agent overrides:** Plan replaces the read-file allowlist, and Accept Edits overrides write/edit permission. Effective mode, tool inventory, and permissions must be checked after all configuration layers. Unrecognized environment keys do not establish enforcement.
- **Drafts are proposals:** one generated draft changed fallback to `always`; another failed typecheck, lint, and eight tests. The coordinator rejected them. Passing a model turn is distinct from delivering a verified fix.
- **macOS test paths:** `/tmp` may resolve through a symlink. Use a canonical private `mkdtemp` directory and complete valid contracts. Do not disable the application's symlink protections.

## Research and scope

Reviewed 2026-10-06. Official ACP v1 documentation establishes repeated prompt turns, streamed tool updates, correlated permission choices, cancellation, and capability-gated session loading. The repository's schemas and RunManager further restrict which states accept continuation; those local contracts govern actual MCP calls.

Comparable [acpx session skill](https://github.com/Dwsy/agent/blob/main/skills/acpx/SKILL.md) covers persistent session commands, while [use-acpx](https://github.com/FradSer/dotclaude/blob/main/acpx/skills/use-acpx/SKILL.md) emphasizes assessment of worker proposals. This skill uses the repository's MCP API and coordinator verification, without importing their CLI flags, blanket permission settings, or mandatory subagent workflows. Its gap is the concrete correction loop with isolated artifacts, verification failures, and fail-closed recovery in this supervisor.

See the [Agent Skills specification](https://agentskills.io/specification) for portable skill structure. This repository skill is included by the plugin's existing skills directory and npm files allowlist; authoring it does not demonstrate plugin installation or activate it globally.
