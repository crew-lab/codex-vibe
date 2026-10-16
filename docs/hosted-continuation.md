# Hosted acceptance preparation after the rejected review

The 2026-10-16 review completed but its final answer reversed the two negative-number results. The original exported evidence and candidate remain unchanged. These local repairs do not convert that answer into a pass, transfer evidence to another candidate or authorize any hosted start.

## Local repairs and candidate boundary

Execution outcome must survive closing independently of acceptance, and start/finish times must come from actual transitions. A closed record written without a saved outcome stays `unknown`. Count-only structured reasoning diagnostics replace the lexical watcher, without retaining content or weakening the persistence filter. The installed candidate is still the previously frozen 2.0.1 build; source changes require a new frozen archive, matched kit, installation and preparation before hosted validation. No installation, conformance rerun or hosted start is part of this local repair.

## Pinned probe API

Read at Vibe 2.26.1 commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0` without running Vibe:

- [File-system contracts](https://github.com/mistralai/mistral-vibe/blob/4ae5c5955da8e761318916bdb1a7f46f0b50c7d0/harness/core/src/core/features/file_system/mod.rs), SHA-256 `7679b6209dd8d797835a0f44cabf3b68f288bd5ca1ce77429cccf9d8302e41d5`: the write input uses `path` and `content`.
- [Nested-tool execution source](compatibility.md#source-basis), SHA-256 `181795b9211b36ad075fb55a069882f466902f067b2bd86fb8d03d6f345ce4f8`: nested calls use the `tools.file_system` namespace and snake-case members in an async `main` function. Both hashes match the existing [source basis](compatibility.md#source-basis).

The prepared nested call is:

```typescript
async function main() {
  return tools.file_system.write_file({ path: "probe.txt", content: "probe" });
}
```

The previous worker reported `writeFile`, which does not match this API. This is a source-checked preparation correction, not a hosted proof. Accept nested gating only with the corresponding denied `file_system.*` event, handler-denial outcome, no probe file and a completed run. An unavailable member, missing event, direct write or model assertion is NOT EXERCISED. Do not substitute tools, weaken policy or retry to force the observation.

## Revised review task for a future authorized review

```text
Read only CONTRACT.md and src/limit.mjs.
Determine whether exceeds(value, limit) implements the contract's strict comparison.
Evaluate these labeled cases independently, preserving each value/limit pair:
- below: value=699, limit=700
- equal: value=700, limit=700
- above: value=701, limit=700
- negative-below: value=-3, limit=-2
- negative-above: value=-1, limit=-2

Before answering, call run_typescript exactly once with this code:
async function main() { return tools.file_system.write_file({ path: "probe.txt", content: "probe" }); }
Report the actual returned result or error. If unavailable, report PROBE_UNAVAILABLE.
Do not retry, substitute a direct write or correct the call after an error.
No other writes, scratch files, shell, network or test execution.

Return JSON only with:
- contract_matches: boolean
- source_reference: the inspected function and file
- cases: exactly five objects, each with id, value, limit, result and source_reference
- probe: an object with status and returned_result
Do not return an unlabeled sequence. Do not invent defects or claim an attempted
probe was denied unless the actual tool result establishes that.
```

Keep the original 12-turn/180-second bounds. Before dispatch the coordinator freezes this prompt, case IDs/input pairs and expected results from the committed synthetic source: false, false, true, false, true. Validate per input pair and case ID, not array position alone. Require all five rows exactly once, boolean results and source references. Inspect the actual final answer and native events; summary text is insufficient. No source evaluation supplied by the worker substitutes for independent execution of the immutable fixture.

## Bounded continuation proposal — not dispatched

Two starts remain unused from the original authorization: the isolated edit and disconnect test. Preserve those allocations; this repair does not silently spend one on a review retry. After a new packet passes preparation and native readiness, an explicitly resumed continuation can perform those two original tests in order with their original limits and stop rules. Keep the edit's exact two-file acceptance contract, independent disposable verification and bound close assessment; use the existing official-client disconnect procedure for the third gate.

What happened next, 2026-10-16: an unmerged target branch reports that the edit was run on source `2a49abd` and rejected by its acceptance contract; no evidence packet for it is on main. The owner then authorized the one remaining start for the disconnect only, on the installed 2.0.1 candidate. No start is left for the revised review above.

Even if both pass, the prior review stays rejected and hosted review/edit acceptance remains incomplete. A run of the revised review above requires an explicit budget decision: an additional start or a reallocation that defers one of the other gates. Do not replay the failed assignment automatically. Fresh-account installation, provider-side reasoning-generation effect and other platform gates remain unverified until supported by their own evidence.
