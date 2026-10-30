---
name: vibe-supervisor
description: "Use for one bounded Mistral Vibe review or isolated edit through the local Vibe Supervisor MCP tools. Do not use for deployment, credential handling, or automatic patch application."
license: MIT
---

# Vibe Supervisor

The supervisor exposes exactly five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. It accepts only Vibe 3.0.2 through its pinned `vibe-app-server`; the server version and installed files must match the per-candidate pin manifest, and any other version or file drift fails closed. Check the selected candidate’s hosted qualification against its recorded target-gate evidence; preparation alone does not establish it. Each review or edit start requires a short-lived local dispatch grant created with `vibe-supervisor task authorize` and the grant's unique `attempt_id`; the grant authorizes one exact request and one start. This is not an interactive Vibe permission or continuation protocol. Each owning server/storage instance accepts one active run; a competing start is rejected immediately. A run is one-shot: there are no follow-up prompts or restart recovery. If the supervisor restarts during work, the run is marked failed and its task is never replayed. Completed means execution ended; the coordinator still owns acceptance and cleanup. The Antigravity backend is experimental and opt-in (`experimental.antigravity = true`); use it only when the configuration selects it, and see [security](../../../docs/security.md#antigravity-backend-experimental).

Vibe's packaged plugin skills are accepted only when the runtime reports their required plugin provenance; user/project/registry skill entries are refused. Skill instructions never grant extra tool or path permissions. Shell and network tools are disabled. The supervisor's policy is not an OS sandbox. Reviews are read-only (`read_file`) over an allowlisted workspace, with a bounded workspace file listing in the prompt and no search tool; edits can read, write and edit inside the worktree, need a Git repository root and explicit `base_ref`, and run in a detached supervisor-owned worktree. The worker's patch is exported for review and is never applied, committed, merged, or pushed automatically.


## Prepared installation: short path

Match this skill to the selected installed candidate; updating skill text does not update a connected server. If the installation predates the artifact-intake repair described below, upgrade the candidate before relying on that behavior; see [current state](../../../Handoff.md). For an already prepared installation, call `vibe_status` on the intended connection with the canonical workspace, operation, immutable edit base and expected candidate. Require the expected candidate, preparation PASS, eligibility and a free slot. Freeze the complete request and acceptance criteria, authorize it with the returned `task_authorize.argv`, then forward the returned complete `start_request` with a fresh readiness receipt. Follow status, inspect the result and exported artifact, independently verify it, and close. Each grant permits one start; a refusal or failure is not permission for an additional hosted attempt. For setup, blockers and details, follow the sections below and [local operation](../../../docs/local-operation.md).


## Coordinator, acceptance and fallback

The main chat coordinates and independently verifies. Vibe is the bounded implementer. A fallback implementer is used only after verified artifact rejection and within the user's authorized workflow; do not appoint it coordinator by default. Never infer failure from an abbreviated worker summary. Preserve the original patch/export hashes and inspect deterministic checks first. If the patch is correct, validate it unchanged. A mistaken rejection must be corrected in append-only assessment history, with the review error attributed to the coordinator. Keep Vibe and fallback changes/evidence separate; never claim fallback edits were applied when they were discarded.

The owner's implementation request already authorizes necessary task-scoped installation/switching, no-inference preparation and adding only the named task root while preserving settings and rollback. Do not ask again for these steps. It does not authorize extra hosted starts, broader access, commit/push/merge/deploy or publication. Keep original budgets and no-replay rules. A deterministic preparation failure stops that check: diagnose and repair, then verify the changed artifact. Preparation/infrastructure failure is not implementation rejection and does not automatically trigger fallback.

Before dispatch, map every required acceptance criterion to the user request, an applicable repository rule or an explicit task constraint. Keep coordinator preferences advisory. Use text/hash assertions only when the exact bytes are required; check behavior and equivalent implementations through named coordinator validations. For example, both `import assert from "node:assert/strict"` and `import { strict as assert } from "node:assert"` provide strict assertions. A requirement for named `node:test` cases still requires named callbacks; an import string or a passing `node --test` command alone does not prove that structure. Freeze an acceptance_contract with exact allowed/required paths, genuinely required text/hash assertions and coordinator validation IDs. For an edit, also pass `allowed_write_paths` naming the files or `dir/` prefixes the worker may write, so the handler refuses writes elsewhere during the run. Require version-matched preparation PASS via `prepare check --kit ... --config ...`; inspect workspace_eligible, preparation, candidate and optional expected_candidate on the native connection. These checks are separate from hosted acceptance. Caller-selected request/contract/patch/validation files use the tool's bounded input reader: normal owned, canonical, single-link `0644` or `0600` files are accepted without manual permission repair when group/other write access is absent. Internal grants, manifests, receipts and saved artifacts remain private and strictly validated. Do not chmod unknown files or parents; follow typed input/artifact diagnoses. See [artifact handling](../../../docs/artifact-handling.md). Preflight the selected validation path on the actual baseline before any hosted start: establish required manifests, manager/cache availability and executable checks. Use `validation prepare` for owned baseline/candidate copies and explicit offline dependency preparation; blockers do not authorize scripts or network fetches. In a build supporting copy-only preparation, `--no-install` needs no package manifest, lockfile or manager and records no dependency readiness; older installations may still require these inputs. Diagnose that mismatch before dispatch, rather than discovering it after a hosted edit.

After the bounded run, compare exported bytes and hashes, then run the declared coordinator checks. Record execution outcome, automated verification and coordinator decision separately. `vibe_close` assessments bind patch/contract hashes and coordinator validation results; accepted requires automated PASS plus all required validations. Preserve failed/incomplete evidence. Use `runs export --out ...` for sanitized reporting, with optional patch/projected events only. Never collect raw transcripts, reasoning, credentials or private receipt histories for reports. New hosted attempts require remaining explicit allowance; no summary-driven rejection or blind retry. See [acceptance](../../../docs/workflow-acceptance.md), [preparation](../../../docs/preparation.md) and [validation workspaces](../../../docs/validation-workspace.md).

## Administrative permission and the current procedure

Follow [local operation](../../../docs/local-operation.md) for the current path. Grant registration writes Supervisor-private state; a restricted project command environment needs the host-supported scoped administrative command permission for the selected CLI, runtime and configuration. Native readiness does not establish that command permission. An approval rejection is a host-policy blocker, not a worker failure or reason to rebuild. Do not bypass it through alternate storage or execution.

## Prepare before connecting

1. Select the intended installed artifact and configuration. If the explicit config does not exist, initialize it first with `vibe-supervisor allow --config <selected-config> <canonical-workspace>`; this creates a private config and adds only that workspace. Then use the same config for doctor and serve. An explicitly selected missing or invalid file on doctor/serve must fail with its path; do not fall back to another home configuration. The default data root is `~/Library/Application Support/VibeSupervisor-oneshot` on macOS, `%APPDATA%/VibeSupervisor-oneshot` on Windows, or `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` on Linux. `VIBE_SUPERVISOR_HOME` is an explicit override.
2. Run `vibe-supervisor doctor --config <selected-config> --json`. This checks local prerequisites and pinned Vibe compatibility, not provider authentication or hosted inference. Keep the reported selected config and data path as separate facts.
3. Choose a clean reviewed Git base: select its existing immutable commit and pass it as `base_ref`; preserve unrelated uncommitted changes. The supervisor never uses uncommitted source bytes as an edit base.
4. For Codex, use the default isolated setup registration; an existing registration needs `--isolated` and reconnection to prevent other chats from competing for its storage lock. This does not change allowed roots. Connect to the selected server; the readiness call below identifies it by `server_version` and proves the tools are callable, with or without a protocol handshake. A CLI version or doctor result does not establish the identity of an already-open desktop connection. Authentication is observed only during a real run.

## Check readiness on the connection

Every delegation starts with a native workspace readiness call on the connection that will run it: `vibe_status` with `workspace` (absolute canonical path), `operation` (`review` or `edit`) and, for an edit, `base_ref`. It starts nothing and costs no inference. Read `server_version`, `server_instance_id`, `policy_path`, `policy_revision`, `restart_required`, `eligible` and `blockers`; `supervisor_version` in run output describes a saved run, not this server.

- If the Vibe tools are absent from the connected catalog, or the call cannot reach the server, classify the attempt as CONNECTION_FAILED.
- If `eligible` is false, classify it as PREPARATION_FAILED and report each blocker's code and remediation. An allowlist approval in the selected config is seen on the next check without a restart; `VSUP_RESTART_REQUIRED` needs a deliberate server restart or reverting the boot-bound setting.
- Neither is a Vibe run result, a failed inference run or a successful Vibe test. Route it to repair, and do not silently fall back to another implementer. Handing the work to another implementer despite an infrastructure failure is an explicit, separately reported decision that leaves the Vibe test blocked.
- When `eligible` is true, pass its `readiness_receipt` to the matching start before `receipt_expires_at`. A receipt rejection (`VSUP_READINESS_RECEIPT_INVALID`) created no run: check readiness again rather than retrying the start blindly. A receipt is not authorization for the task and does not prove provider authentication.

## Run one bounded task

Collect the desired outcome, concrete acceptance criteria, canonical allowed workspace, exact file scope, exclusions, and explicit Git base for edits. Never put credentials in task text. Check the real connected tool schemas and do not invoke fields or tools absent from that catalog. The sequence is fixed:

1. Readiness, as above. The eligible reply carries `task_authorize`: `argv` is the exact `task authorize` command bound to the connected server (its Node executable, its CLI entrypoint and its `--config`), `request_template` is `{ "operation", "request": { cwd, context_files | base_ref } }` for this workspace and operation, and `expires_at` is the grant expiry the command carries (30 minutes). No `--runtime-node` is needed with it.
2. Write the request file privately outside the repository (mode 0600): start with `request_template`, then add every intended field supported by that operation: `task`, `max_turns`, `timeout_seconds` and `wait_seconds`; for reviews, any `context_files` and `output`; for edits, `acceptance_contract`, `allowed_write_paths` and any `prepared_inputs`. Freeze omissions and values before authorization. The start must forward the complete `request` unchanged, not just the template and task.
3. Run `task_authorize.argv` with only `<private-request-file>` and `<owner-reference>` replaced. The host's command permission is the owner's per-start check: a refusal is a stop, not something to route around. The command prints `authorization_id` and `attempt_id`; keep them private.
4. Start with exactly the same request plus `authorization_id`, `attempt_id` and the `readiness_receipt`, before `receipt_expires_at`, on the same connection. On `VSUP_AUTHORIZATION_INVALID`, inspect `details.differing_fields` and determine the cause; re-check readiness for runtime drift. Only after an identified correction and within the authorized attempt budget may a new grant be registered. Never retry blindly or reuse identifiers; stop if the cause or allowance is unclear.
5. Follow the run with cursor-based `vibe_status` calls, read `vibe_result`, then close as described below.

The readiness receipt is admission evidence and does not replace the grant; the grant authorizes one start of one exact request. One started run owns the instance's active slot until backend close verifies termination. If close reports termination unverified, keep the run inspectable and do not start another run on that slot. Do not queue, retry automatically, or replay a task after restart or failure. The Codex custom agent in [.codex/agents/vibe-reviewer.toml](../../../.codex/agents/vibe-reviewer.toml) runs this sequence for one bounded task.

Files matched by the root's `excluded_globs` or the fixed secret denylist are refused to the worker; leave them out of the file scope. A root with a daily budget refuses a start with `VSUP_BUDGET_EXCEEDED` once its 24-hour spending reaches the ceiling; do not move the task to another root to get around it.

Start one review or edit with bounded turns, deadline, output limits, wait, and the readiness receipt. Do not raise limits or rotate accounts after a failure. Write the task text from a template below.

## Choose the review context

The worker cannot search: it has `read_file` and a bounded file listing, nothing else. You can search, so do it before the grant is registered and hand the worker the result as `context_files`.

1. Search the repository yourself (`rg`, or your own tools) for the symbols the question names, their call sites and the tests that cover them. Open what you find; a file that only mentions the symbol in a comment or an import is not context.
2. Choose at most 8 files: the definitions, the callers whose behaviour the question depends on, and the tests that pin the current contract. Fewer is better. The schema takes 50, but each file is one `read_file` turn before the worker can answer, so 8 files fit `max_turns` 30 with room for the answer, and a longer list is a sign the question is too wide for one review; split it instead.
3. Put their repository-relative paths in `context_files` in the request file. The supervisor checks each at admission (it must exist, resolve inside the workspace and match no `excluded_globs`), lists each in the prompt as an approved context path, and binds its path and content digest into the grant.
4. Name the same files in the task text, in reading order, with one clause each on why they matter, so the worker reads them first and knows what to look for in each.
5. Never include a secret-named file (`.env*`, `.envrc*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`), an excluded file (`VSUP_WORKSPACE_INVALID` refuses the start) or a generated one (`dist/`, lockfiles, build output): a generated file spends a read on nothing and never answers a question about the source.

The list must be final before `task authorize`: adding, removing or reordering an entry, or a change to a listed file's content, after registration refuses the start with `VSUP_AUTHORIZATION_INVALID` and `differing_fields: ['context_files']`, and a new grant is needed only after the cause is corrected and within the authorized attempt budget.

For each real review, log beside its usefulness entry how many context files were passed and how many `read_file` calls the run executed (`usage.tool_calls.executed` in the result, or the `tool_call:read_file:executed` count in `runs export`), with whether the answer was accepted. New review records and sanitized exports report `context_file_count` (including zero); older exports report `null` for unknown. Preserve the request-side count when available and never interpret unknown as zero.

## Write the task from a template

A completed run is not a useful answer. The tasks that produced accepted answers on the target were narrow and checkable; the one real-project review ran safely but its answer was not accepted. Fill one in: replace each `<...>` and keep every line.

Review:

```text
Read only <file>, <file>[, <file>]. Do not open other files.
Question: <one question, e.g. whether parseLimit(value) rejects negative input as CONTRACT.md requires>.
Evaluate these inputs or paths: <input>, <input>, <input>.
For each finding give the file, the function or line, the input that triggers it, and the wrong behaviour against the stated requirement.
"No defect found in the inspected scope" is a valid answer; do not invent a finding.
No style advice, refactors or recommendations outside the question. No scratch files.
Final answer: the conclusion first, then the findings, under <n> lines.
```

Edit:

```text
Read <file>, <file> first.
Then create or change only: <path>, <path>. Do not touch any other file.
Change: <what to add or change, with the exact function names and semantics>.
Must reject or preserve: <each edge case, e.g. a trailing blank line, CRLF, an unsafe path>.
Tests: <test file> using <framework>, covering <cases>. Match named or default imports to the declared exports.
Before the final answer, check the source and tests for consistent export and import names without executing tests.
No shell, network or test execution.
Final answer: what changed, then an inventory of changed and scratch files.
```

Match the limits to the template: a review of two or three files fits `max_turns` 12; raise turns only with the number of files to read. Record whether the answer was accepted, so the template can be improved; `vibe-supervisor runs usefulness` summarizes the recorded assessments of edits and counts reviews without assessing them.

## Check the result

For a review, check the final answer, stop reason, warnings, integrity result and `usage.tool_calls` (a review that read nothing answered from nothing); `vibe-supervisor runs sarif <run-id>` exports its findings as SARIF. For an edit, inspect the result, fresh exported patch, changed and residual files, and hashes while the worktree remains available. Request a transcript only if needed to resolve a specific uncertainty; keep it private and out of reports. Verify the exact candidate in a separate disposable copy; do not run commands or tests inside the worker worktree or original source checkout. Accept only the reviewed delta. Coordinator verification does not turn an unsuccessful Vibe run into a Vibe success.

Close the run after verification. Request cleanup only when the exported artifact is current. A pristine worktree can be removed after ownership checks; a dirty or uncertain one is retained with its path and reason for review. Keep the exported patch available and do not force-delete retained data. Report the server version, source/base, actual checks, stop reason, authentication outcome if observed, and any unresolved cleanup or acceptance gate. macOS Apple silicon is the supported platform; a clean-account installation is not yet verified. A run proves execution, not that the answer is correct.

## References

- [Tool and configuration reference](../../../docs/reference.md)
- [Behavior](../../../docs/functionality.md)
- [Security](../../../docs/security.md)
- [Compatibility and unverified gates](../../../docs/compatibility.md)
- [Errors](../../../docs/errors.md)
- [Agent Skills specification](https://agentskills.io/specification)


## Contract-bound repair candidate

Builds implementing ADR0011 deliver structured contracts automatically. Encode named Node cases with a node_test check (path,min_cases), then run independent behavior checks. Use `validation check` for the explicitly authorized fixed Node test profile in owned copies. A failed contract must never be accepted because assertions happened to pass.

For a closed completed rejected edit, `task repair --run ID --request ORIGINAL.json --out NEW.json --max-corrections 2 --config CONFIG` prepares a complete fresh request from verified failures and unchanged scope/base/contract. It consumes a durable bounded preparation slot, never grants/starts/applies. Authorize the generated request with a fresh grant; forward its returned start_request plus new readiness receipt. No unchanged retry or budget reset. Stop at exhaustion and preserve original output. Check installed candidate identity before relying on these new capabilities.
