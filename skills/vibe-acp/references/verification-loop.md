# Verification loop reference

## Prompt templates

### Initial task

```text
Outcome: <observable behavior>.
Prepared cwd/base_ref: <verified snapshot repository and immutable reference>.
Reviewed baseline: already present; implement only the new delta.
Budget: <authorized cumulative turns/deadline; coordinator owns cleanup reserve>.
Ownership: <exact files/modules>; excluded files: <list>.
You share the codebase. Preserve other contributors' changes.
Constraints: <versions, path boundaries, lifecycle and security requirements>.
Acceptance: <regressions and exact checks the coordinator will execute>.
Permitted tools: read_file, grep, write_file, edit. Shell/network are unavailable.
Do not claim to have run shell checks. Avoid scratch; inventory any required scratch.
Produce a scoped patch and an actual concise final answer with limitations.
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

## State and decision table

| Observation | Next action |
|---|---|
| ACP completed/end_turn with an actual final answer and patch | Candidate-ready only: independently review/test while session remains open. |
| max_turn_requests | Preserve partial artifacts; no automatic budget increase or replacement run. |
| Candidate fails tests but session is usable | Send specific corrections through `vibe_continue`; fetch fresh results afterward. |
| Running or waiting for permission/input | Call `vibe_status` with `wait_seconds` or answer the current validated request; do not issue another prompt. |
| Failed, cancelled, closed, or expired session | Inspect artifacts and recovery capability; do not assume continuation or replay. |
| Programmatic run | No same-session continuation; preserve/export the candidate before planning a new run. |
| Claimed completion with empty patch | Compare against the task; text generation alone does not establish coding success. |
| Repeated failures | Narrow the task and identify the shared cause; reassess budget and harness before more model calls. |
| New worker changes after verification | Prior patch hashes and check results are stale; export/review again. |
| Missing real MCP tools | Report visibility separately from standalone-client discovery; do not invent tool availability. |

## Baseline, scope and closure

Prepare selected reviewed overlays before inference with the coordinator script `scripts/prepare-reviewed-baseline.mjs` from a source checkout (not in the installed package); use the returned immutable snapshot/ref and verify file hashes. Optional `scripts/audit-edit-run.mjs` scope files describe tool-call argument paths only. Tests/builds run in a separate exact candidate copy. Keep the session open until independent checks and reviewer acceptance, including any same-session correction within the authorized cumulative ceiling; obtain a fresh export before cleanup. A premature close followed by coordinator correction is a partial worker gate, not a passed same-session implementation loop.

## Baseline and audit inputs

Use the baseline script only with explicit existing allowed source/output roots and an owner-private manifest of selected operations/hashes/modes; dry-run precedes creation. Keep original-source provenance with the coordinator. An edit worktree is not a place for dependency installs or test caches.

The optional audit scope JSON is an owner-private array of 1–64 unique repository-relative strings, each at most 1024 characters. Reject absolute/traversal/dot/empty/leading-dash segments, backslashes, controls and colons. `argument_scope` checks call arguments only; `declared_scope` remains unverified until independent candidate/export checks. Assistant messages, tool calls, failed updates and provider requests/billing are different measurements.

## Preparation diagnostics and public templates

Use the source checkout's documented preparation prerequisites; these scripts are not shipped with the installed package. Record source/script hashes and the explicitly selected compiled runtime/configuration identity. Do not substitute a default legacy configuration for the active native session configuration.

On refusal, preserve the sanitized diagnostic code/stage and any private retained-output receipt. Diagnose the failed stage before changing inputs; never weaken guards or reconstruct the baseline through a worker. An old manifest becomes stale when reviewed bytes change.

Only an explicitly reviewed, hash-bound root `.env.example` can use the public-template exception. Default refusal remains; real environment/credential files, unsafe content, paths and ownership stay blocked. Verify the effective snapshot bytes independently before inference. The exception changes coordinator preparation only, not worker tool permissions.
