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

For the observed draft, actionable feedback would identify the TypeScript environment-object index error, unsupported `VIBE_AGENTS__...` overrides, the missing Keychain account selector and output bounds, and noncanonical test fixture paths. Do not send raw credentials or private reasoning as evidence.

## State and decision table

| Observation | Next action |
|---|---|
| ACP completed with a patch | Independently review and test before acceptance. |
| Candidate fails tests but session is usable | Send specific corrections through `vibe_continue`; fetch fresh results afterward. |
| Running or waiting for permission/input | Poll or answer the current validated request; do not issue another prompt. |
| Failed, cancelled, closed, or expired session | Inspect artifacts and recovery capability; do not assume continuation or replay. |
| Programmatic run | No same-session continuation; preserve/export the candidate before planning a new run. |
| Claimed completion with empty patch | Compare against the task; text generation alone does not establish coding success. |
| Repeated failures | Narrow the task and identify the shared cause; reassess budget and harness before more model calls. |
| New worker changes after verification | Prior patch hashes and check results are stale; export/review again. |
| Missing real MCP tools | Report visibility separately from standalone-client discovery; do not invent tool availability. |

## Known integration failures

These are observed defects from the 2026-10-03 attempts, not instructions to bypass policy. Consult current acceptance evidence before assuming they remain open or have been fixed.

- **Browser-login credential and private HOME:** the login credential was present in normal macOS Keychain lookup but absent with a fresh HOME. Repeating setup did not repair supervisor lookup. A private in-memory diagnostic bridge reached hosted generation, but the normal integration remains unverified. Keep authentication in the provider runtime; never put credentials into tasks, files, or logs. Do not advise an API-plan upgrade solely because the internal credential name is `MISTRAL_API_KEY`.
- **Nested path grants:** Vibe 2.25.8 matches absolute glob allowlists with `PurePath.match`; `<root>/**` did not authorize nested descendants. The installed matcher recognized `vibe-path:directory_recursive:<canonical-root>`. Any implementation must test nested, sibling, outside, sensitive, and symlink paths against the real pinned resolver. Retain `never` fallback and deny patterns.
- **Built-in agent overrides:** Plan replaces the read-file allowlist, and Accept Edits overrides write/edit permission. Effective mode, tool inventory, and permissions must be checked after all configuration layers. Unrecognized environment keys do not establish enforcement.
- **Drafts are proposals:** one generated draft changed fallback to `always`; another failed typecheck, lint, and eight tests. The coordinator rejected them. Passing a model turn is distinct from delivering a verified fix.
- **macOS test paths:** `/tmp` may resolve through a symlink. Use a canonical private `mkdtemp` directory and complete valid contracts. Do not disable the application's symlink protections.

## Research and scope

Reviewed 2026-10-03. Official ACP v1 documentation establishes repeated prompt turns, streamed tool updates, correlated permission choices, cancellation, and capability-gated session loading. The repository's schemas and RunManager further restrict which states accept continuation; those local contracts govern actual MCP calls.

Comparable [acpx session skill](https://github.com/Dwsy/agent/blob/main/skills/acpx/SKILL.md) covers persistent session commands, while [use-acpx](https://github.com/FradSer/dotclaude/blob/main/acpx/skills/use-acpx/SKILL.md) emphasizes assessment of worker proposals. This skill uses the repository's MCP API and coordinator verification, without importing their CLI flags, blanket permission settings, or mandatory subagent workflows. Its gap is the concrete correction loop with isolated artifacts, verification failures, and fail-closed recovery in this supervisor.

See the [Agent Skills specification](https://agentskills.io/specification) for portable skill structure. This repository skill is included by the plugin's existing skills directory and npm files allowlist; authoring it does not demonstrate plugin installation or activate it globally.
