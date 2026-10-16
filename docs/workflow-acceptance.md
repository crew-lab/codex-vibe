# Patch acceptance and reporting

Edit requests may supply an optional strict `acceptance_contract` before dispatch:

```json
{"schema_version":1,"allowed_changed_paths":["src/app/page.tsx"],"required_changed_paths":["src/app/page.tsx"],"checks":[{"id":"heading","kind":"text_contains","path":"src/app/page.tsx","value":"Release notes"}],"required_validations":["build"]}
```

Supported assertions are `file_exists`, `file_absent`, `text_contains`, `text_not_contains`, and `file_sha256`. Paths are exact repository-relative names, not globs. The normalized contract is hashed and frozen before launch. Exact checks inspect the committed base plus exported patch using a private Git index; worker summaries and subsequent worktree edits are not evidence. Checks never execute project code. Private bounded file snapshots allow re-verification after worktree cleanup. Missing, unsafe or changed inputs produce `incomplete`, never PASS.

Execution state, automated verification, and coordinator assessment are separate. Normal `completed/end_turn` is required for automated PASS. Existing callers without a contract receive `not_requested`. `vibe_close` accepts an optional `assessment` containing decision, reason, patch_sha256, contract_sha256 and validations. Acceptance requires matching artifact hashes, a fresh automated PASS and passed coordinator validations for every required ID. Assessments append; corrections after closure preserve earlier decisions and do not restart inference. Coordinator validations are reported evidence, not independently executed by Supervisor.

```text
vibe-supervisor runs verify RUN_UUID --out /private/report-parent/new-report
vibe-supervisor runs export RUN_UUID --out /private/report-parent/new-report --include patch,events --validation /private/validation.json
```

The output parent must already be canonical, owner-private and writable. Destinations must not exist. Read-only lookup supports direct and isolated session records without borrowing live owner locks. Bundles include report.json, checks.json, diagnostics.json, REPORT.md and SHA256SUMS. Optional patch export preserves exact bytes or refuses inclusion when credential detection triggers. Optional events expose only projected diagnostic fields; raw transcripts, tool arguments, receipts, histories and reasoning are excluded. Private paths are replaced in public reports. Exports do not integrate patches, run project commands, infer missing model identities, or assert hosted acceptance.

Validation manifests use schema_version 1, the exported patch_sha256 and unique validations with id/status (`passed`, `failed`, `incomplete`), optional evidence_sha256 and reference. Treat exports containing project patches as private project material.

Runtime observations record the reported session model, alias and thinking setting at startup and each verified handoff. Reports leave provider and underlying weights unknown. Usage preserves prompt/completion/cache tokens and model calls when available, with non-authoritative cost from runtime snapshot prices. Model calls are distinct from tool calls and Supervisor turn limits. Phase durations use saved timestamps and remain null when missing or inconsistent; execution includes finalization because the current lifecycle does not separately timestamp inference completion. Legacy records do not invent missing observations.

## Execution lifecycle and reasoning observations

Closing a run is a resource lifecycle action. Reports preserve the recorded execution outcome separately from closed status and retain actual start/finish timestamps; missing legacy evidence remains unknown. Coordinator rejection of a completed answer is a separate assessment and must not relabel execution as failed. Inference-only duration is not estimated from total wall time.

The `reasoning_observation` diagnostic contains only structured-entry counts: `streamed_entries`, `history_entries` (or null) and `history_audited`. Export with `--include events` to retain those fields. Content is discarded, and existing reasoning/secret filtering remains unchanged. Stream/history counts overlap and must not be summed. A count of zero means none observed, not proof that no provider reasoning was generated. Private-file word searches are not a measurement of reasoning generation.
