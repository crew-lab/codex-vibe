# Local operating procedure

Use this procedure for the five one-shot tools. Current installation and qualification status belongs in [Handoff](../Handoff.md); historical runbooks do not authorize new work. Source, archive, installed candidate and native connection are separate identities.

## Select and prepare

Read the connected tool schemas and call workspace readiness with the intended operation, immutable edit base and expected candidate. Require the correct candidate, version-matched preparation PASS, eligible workspace, no blocking drift and a free slot. Record the selected configuration and `supervisor_runtime.executable`. Readiness describes the server; it does not establish the command environment's administrative write permissions or provider authentication.

Use the matching installed CLI, reported Node executable and explicit selected configuration for every administrative command. Preserve settings, allowed roots and rollback. Prepare only explicit reviewed inputs; quoted context is not an overlay. See [task inputs](task-inputs.md).

## Authorize and start

Before dispatch, trace required criteria to the request or repository rules. Keep optional spelling/style preferences advisory, and use coordinator validations for semantic equivalence. The tool distinguishes caller-selected request/contract/patch/validation files from saved supervisor state. Normal owned `0644` inputs are accepted without a chmod step, while unsafe links, foreign ownership, group/other writes, oversized or changed files fail with a specific input diagnosis. Generated state stays private. Prepare output only in an owned private parent; the tool must not change permissions on arbitrary existing directories. See [artifact handling](artifact-handling.md). Preflight the selected validation command on the baseline, including its actual artifact-permission and package/lockfile/manager requirements; a preparation PASS for Vibe does not prove the project validation path is ready.

Freeze the exact request and acceptance criteria: take `task_authorize.request_template` from the readiness reply, add every intended field supported by that operation: `task`, `max_turns`, `timeout_seconds` and `wait_seconds`; for reviews, any `context_files` and `output`; for edits, `acceptance_contract`, `allowed_write_paths` and any `prepared_inputs`. Freeze values and omissions, then write the complete request to a private file (mode 0600). Register it by running `task_authorize.argv` from the same reply with `<private-request-file>` and `<owner-reference>` replaced; it already names the server's Node executable, CLI and `--config` and carries a fresh expiry. Assembling the command by hand, use `task authorize --runtime-node <reported-node> --request <private-json> --owner-reference <instruction-reference> --expires-at <fresh-ISO-expiry> --config <selected-config>` and generate the expiry with `node -p "new Date(Date.now() + 10 * 60 * 1000).toISOString()"`.

This command writes Supervisor-private grant state. In a restricted project environment, request the host-supported scoped administrative command permission for this exact CLI, runtime, configuration and task. Existing task authorization permits necessary preparation; it does not bypass the host approval mechanism. If approval is refused, stop and report its stated reason. Do not relocate state, weaken ownership checks or reroute execution to evade the refusal. A delegated chat instruction may not be recognized as direct owner approval by the host.

Save the returned authorization and attempt identifiers privately. Forward every frozen request field unchanged with those identifiers and the fresh readiness receipt to one matching start on the same native connection. A start refused with `VSUP_AUTHORIZATION_INVALID` names the differing bound fields in `details.differing_fields`; identify and correct the cause, checking readiness again for runtime drift. Register a new grant only after an identified correction and within the authorized attempt budget; stop if either is unclear. Never retry blindly or reuse identifiers. A grant permits one start, never automatic replay; an unused diagnostic grant must not later be dispatched. A receipt is not task authorization. No sixth tool or continuation exists.

## Verify and settle

Observe cursor-based status and inspect the actual result/export. Retrieve a transcript only when needed to resolve a specific uncertainty; keep it private and out of reports. New review exports report context_file_count, including zero; older exports use null for unknown, which is not zero. Independently verify exported bytes, changed scope and declared semantics in an owned reconstruction. Execution completed, verification passed and coordinator acceptance are separate outcomes. Record actual model/usage only where reported; unavailable values remain unavailable.

Close with the supported assessment, preserve the original patch and verify process/private-state cleanup and slot release. Retain uncertain or dirty worktrees with a reason rather than forcing deletion. No automatic integration, commit or publication follows acceptance.

## Classify failures before changing the candidate

| Category | Action |
|---|---|
| Host permission or automatic approval refusal | Use the supported scoped permission route when authorized; on rejection stop. Do not rebuild solely for this reason. |
| Installation or configuration mismatch | Repair the selected installation/configuration within authorization; renew preparation only when bound inputs changed. |
| Product defect | Make the smallest source repair with regression coverage; changed distribution bytes require a new frozen candidate and matched preparation. |
| Provider authentication, availability or quota | Preserve the outcome; no account rotation or automatic retry. |
| Coordinator verification error | Correct the assessment with attributed history; inspect original bytes before rejecting. |
| Rejected worker output | Preserve evidence; use only the authorized fallback or fresh allowance. Do not call fallback success a Vibe success. |

Qualification requires the real caller's administrative path and a complete bounded native run. Scripted backends and initialization probes prove their named checks only. Publication and clean-account qualification remain separate decisions.
