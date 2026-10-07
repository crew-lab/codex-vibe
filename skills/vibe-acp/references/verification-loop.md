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
| Missing real MCP tools | Report visibility separately from standalone-client discovery; do not invent tool availability. |
