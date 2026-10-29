# Artifact intake and recovery

Caller-selected files and supervisor-created state have different trust requirements. Treating both as private persisted state made normal shell-created inputs fail as unexpected internal errors. The tool now owns that distinction; a task prompt does not need to prescribe file modes.

| Boundary | Examples | Tool behavior |
|---|---|---|
| Explicit caller input | task authorize request JSON, task prepare contract JSON, validation prepare patch, runs export validation JSON | Read a bounded immutable snapshot of an owned canonical regular single-link file; permit ordinary 0644/0640/0600 read permissions; reject group/other writes, links, changed identity/content and excessive size. Never chmod the input. |
| Supervisor state | grants, manifests, copied context, receipts, verification blobs, run metadata and patches | Require private owned regular files and stable identity/bytes. Ordinary 0644 saved state remains invalid. Never treat corrupted or exposed state as caller input. |
| Output storage | validation/export/task preparation destinations | Use new owned private files/directories under the selected canonical private parent. Preserve existing-output refusal and conservative cleanup; do not chmod arbitrary parents. |

Selected-input failures use VSUP_INVALID_ARGUMENT with a bounded reason and input role. Unsafe saved-state/private-directory failures use VSUP_ARTIFACT_ERROR. Messages and details identify the condition without quoting file contents. Malformed selected JSON is an input error; unclassified internal failures remain VSUP_INTERNAL. See [error codes](errors.md).

The reader validates path, regular-file type, ownership, link count, permissions and size, then checks opened identity and metadata before and after a bounded read and rechecks the path. It returns stable bytes in memory; there is no extra raw-file persistence just to satisfy a mode check. Symlink aliases remain unsupported. The tool does not silently relocate authorization storage or enlarge workspace access.

## Recovery boundaries

Accepting normal readable input is normal execution, not an inference retry. A missing tool-owned artifact can be created only in the selected permitted storage. Unsafe links, foreign ownership, changes during read, digest mismatch, ambiguous output ownership, host permission refusal and disk exhaustion are not fixed by weakening checks or chmodding caller paths.

Prepared task inputs are fully checked before grant issue and before consumption: policy, workspace/base, manifest scope, source and copied bytes and copy inventory. Launch repeats those checks for races. Known-invalid preparation does not spend an attempt; a change after consumption still fails without replay.

Poor task wording cannot disable the configured profile, path policy, deadlines or grant binding. The supported recovery result is a verified input/operation or a precise prerequisite failure. The current one-shot engine does not automatically execute project scripts, retry rejected output, infer missing user intent or certify its own generated tests. These orchestration features need explicit bounded designs rather than more prompt requirements.
