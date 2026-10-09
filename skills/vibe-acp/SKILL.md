---
name: vibe-acp
description: "Use when supervising Mistral Vibe ACP coding tasks, independently verifying worker patches, sending same-session corrections or recovering an existing session through Vibe Supervisor. Do not use for generic ACP clients, unrestricted Vibe CLI execution, credential extraction, deployment or automatic patch application."
license: MIT
---

# Vibe ACP

## When To Use

Use for an ACP implementation/review/test/correction loop or explicit continuation of an existing run. The coordinator owns scope, independent checks and acceptance. Do NOT use for deployment, credentials, unbounded shell/network execution or out-of-root work. Use [vibe-supervisor](../vibe-supervisor/SKILL.md) for connection, baseline, start/wait and cleanup preflight.

## Inputs To Collect First

1. Outcome, acceptance oracle, exact owned/excluded files and reviewed prepared source/base hashes.
2. Independent verifier location, relevant checks and read-only reviewer requirement.
3. Authorized cumulative turns, deadline/waits and cleanup reserve; no automatic budget increase.
4. Existing run_id, owning connection, state, current candidate artifacts and remaining budget when continuing.
5. Any explicitly authorized fallback, with its acceptance and evidence reported separately.

## Procedure

### Step 1 — Verify ACP and the prepared baseline

The configured backend must be `acp` with observed vibe_continue and vibe_respond schemas. If missing, report the connection/config prerequisite rather than substituting a backend or weakening permissions. Distinguish connected version, installed version and recorded creator version; legacy creator absence remains unknown.

Follow the supervisor skill's Step 2 for the reviewed baseline. Required files must exist with reviewed bytes before inference. Never hand baseline hydration to the model, copy into an active worktree or weaken canonical/private-path checks for a fixture. Use the [initial template](references/verification-loop.md#initial-task) for concise outcome/ownership/tool constraints; keep the complete oracle with the coordinator.

### Step 2 — Dispatch one bounded increment

Tell Vibe that it shares the codebase and must preserve others' changes. Only read_file/grep/write_file/edit are available; it cannot run shell checks, commit, merge, push or apply its patch to source. Do not create scratch unless the task requires it; request exact ownership/inventory and removal of only worker-owned scratch before final export. Declare checks the coordinator will run and request an actual concise final answer; do not accept fabricated execution claims.

Start/wait on the same owning connection with the declared bounded waits and status cursor. One worker and one prompt at a time. A soft early-answer instruction does not reserve turns; max_turns is cumulative per session, not a provider daily allowance.

### Step 3 — Inspect requests and settle safely

For waiting_permission/input, inspect pending_request. Permission responses use the matching request_id and offered option_id; elicitation uses a schema-valid action/content. Refuse unknown, incomplete, stale, sensitive, out-of-root, shell or network requests; never grant blanket approval. Missing user decisions remain pending. Do not issue another prompt while running/waiting.

Read stop_reason and warnings, then fresh full result/transcript and patch. Require end_turn and actual final answer for readiness. Failed/cancelled/closed runs are not candidates for assumed continuation. An unavailable-tool response is not proof of Supervisor policy denial or the terminal cause; preserve structured stop_reason separately from diagnostic reason.

### Step 4 — Test, review and correct before closing

Verify exact candidate bytes, changed/new files and base/export hashes in a separate verifier copy; keep tests, dependencies, builds and caches out of the Vibe worktree and original source. Explicitly supply any historical ignored evidence needed by the oracle, with provenance; never disable the oracle for an incomplete copy. Have the read-only reviewer inspect that exact candidate when required. Optional offline audit scope evidence covers arguments only, not candidate acceptance.

Keep the usable worker session open. If checks/review fail, use the [correction template](references/verification-loop.md#correction-request) with concrete defect, expected behavior, owned paths and a short sanitized check excerpt. Batch related findings. Re-read an exact file after a match error; a second repeated failure triggers reassessment, not blind retry or shell escalation. Unless a different plan was agreed, reassess after three correction rounds; remaining authorized budget and deadlines always take precedence.

Call vibe_continue(run_id,message) only from completed/ready/recoverable and within the authorized cumulative ceiling. With max_turn_requests, the ceiling is spent: retain artifacts and stop unless an explicit larger total/replacement is authorized. Never automatically increase max_turns. After correction, fetch fresh artifacts and repeat affected checks/review; previous candidate hashes and results are stale.

### Step 5 — Handle recovery without replay

For VSUP_INVALID_STATE, VSUP_SESSION_NOT_RESUMABLE, VSUP_REQUEST_EXPIRED or process failure, inspect state/artifacts before acting. Recoverable ACP loading needs advertised capability, validated supervisor-owned paths and a free slot; continue only explicitly. Do not replay an uncertain original task, restore pending permission grants or use saved PIDs as kill authority. Programmatic runs cannot continue in the same session. A replacement needs a deliberate reviewed base and explicit authorization; preserve failed evidence and report a blocker if no safe path exists.

### Step 6 — Accept and close with fresh evidence

Accept only the current tested/reviewed patch; validate unchanged original source before authorized manual integration. Identify and account for scratch/residual files. If the session can remove its exact owned scratch within budget, request that correction and verify again; otherwise retain/report it.

Fetch a fresh export matching the final worktree, then close with cleanup_worktree:true. Record closed/worktree_removed and independently check filesystem absence. Never force-delete a retained worktree or start a new worker just to clean it. A final answer is not acceptance; a coordinator/fallback correction after premature close does not pass the original Vibe implementation gate. Report both provider outcomes honestly and leave soak/recovery/desktop/platform gates unverified unless actually exercised.

## Completion Checks

- [ ] Prepared baseline availability/hashes and the real ACP connection were checked.
- [ ] One worker, declared ownership, disabled tools and cumulative budget were preserved.
- [ ] Tests/reviewer inspected the exact candidate before close; corrections used fresh artifacts.
- [ ] No uncertain task replay, restored grants, account rotation or automatic budget increase occurred.
- [ ] Scratch, final export and cleanup are verified or explicitly retained/unverified.
- [ ] Actual worker acceptance and any coordinator/fallback corrections are reported separately.

## References

- [Vibe Supervisor preflight](../vibe-supervisor/SKILL.md)
- [Verification loop, templates and state decisions](references/verification-loop.md)
- [Reference](../../docs/reference.md), [behavior](../../docs/functionality.md), [errors](../../docs/errors.md), [security](../../docs/security.md), [compatibility](../../docs/compatibility.md)
- [ACP prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn), [session setup](https://agentclientprotocol.com/protocol/v1/session-setup), [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)
