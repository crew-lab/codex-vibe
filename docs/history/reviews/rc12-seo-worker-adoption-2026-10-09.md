# rc.12 SEO worker execution review

Reviewed the UARoots evaluation, sanitized failed-event inventory, and retained private Supervisor/native records for run `4127dc44-fb72-4274-b51d-b02e4e380934`. This is an offline review; no new hosted run, source integration, configuration change or package rebuild was performed. Native histories, commands, file bodies and reasoning are not reproduced here.

## Established observations

- Supervisor metadata records `0.9.0-rc.12`, process version `2.25.8`, closed state and structured stop reason `max_turn_requests`.
- Native history contains one user prompt, 20 assistant turns and 35 tool calls: 13 read_file, six write_file, 15 edit and one bash. There is no final-answer turn. Multiple calls per assistant turn mean a 20-turn ceiling is not a 20-tool-call ceiling.
- The user prompt has 79,243 characters and five embedded diff headers. This measures the prompt, not tokens, provider consumption or cost.
- Seventeen of 35 calls target page.tsx (five reads, ten edits, two writes). Calls target the baseline file set. No accepted S1/S2/Gemini implementation was established by the product evaluation.
- Retained private supervisor agent profile and native effective configuration both list read_file, grep, write_file and edit; bash is absent. The bash result reports Unknown tool, with no permission-request text. Calls after it continue. Thus this attempt was a worker request for an unavailable tool, not evidence of exposed shell execution, a Supervisor permission callback, or the terminal cause. The earlier shorthand "Supervisor blocked shell" should be qualified when reporting this run.
- The sanitized inventory records 12 failed tool updates: three reads, eight edits and one other update. Its reasons are null, so it alone cannot identify precise errors or tool names. Private history confirms absent-file reads and editing failures; not every failure fits the same string classifier. Preserve updates, unique calls and turns as distinct counts.
- The product report establishes exact-base export verification and independent worktree absence after close. It establishes neither successful Vibe implementation nor continuation, reload/recovery, soak or broad acceptance gates. Luna's accepted candidate and corrections remain separate evidence.

## Workflow changes supported by the evidence

1. Prepare the reviewed effective baseline deterministically before inference. A detached worktree from a Git ref excludes dirty/untracked source changes. Do not ask Vibe to reconstruct them from pasted patches. With the current API, use a deliberate existing ref or an explicitly prepared local snapshot in a disposable repository under an existing allowed root. Include only declared reviewed files and bind them by hashes. Keep the source checkout unchanged and exclude credentials/private ignored data from the snapshot. Never modify a live worker worktree from a coordinator while Vibe is running.
2. Verify baseline byte equality and file availability before dispatch. The coordinator handles missing known baseline files; worker reads should contribute to the new task. A model's import-only patch is not an accepted feature delta.
3. Delegate S1, S2 and Gemini as separate bounded increments, one worker at a time, each with explicit files and independent criteria. Pass concise behavior, known current snippets and expected cases; reference baseline files already present. Keep the complete acceptance contract with the coordinator/reviewer rather than copying the effective baseline into the worker prompt.
4. After an edit-match failure, re-read the exact current file before retrying. After a second repeated match failure on the same file without a successful corrective step, pause dispatch and reassess from artifacts. Do not escalate to shell or blindly repeat an old replacement. A deliberate complete rewrite of a small owned file requires preservation of all baseline bytes that should remain.
5. Keep total task allowance separate from execution rounds. An initial implementation should leave room for independent verification and same-session correction within the cumulative cap. End_turn is required for a usable completed candidate. Do not increase limits merely to replay failed baseline hydration.
6. Preserve the successful verification architecture: tests/builds in an exact candidate copy, read-only independent reviewer, fresh source invariants before manual integration, fresh export before close, verified cleanup. Candidate-specific ignored historical evidence must be supplied explicitly with provenance; don't bypass the oracle when the archive omits it.

## Next test

Run the already prepared small rc.12 edit/correction/cleanup pilot before another full product task. Use a fresh seven-tool connection and a complete tracked baseline; do not repeat completed UARoots work. Record whether initial implementation, final answer, correction, updated export and cleanup all pass. Then try one small product increment with coordinator-prepared baseline. Do not run a full soak or raise provider/turn limits as part of this review.

## Product follow-ups, not diagnosed runtime defects

A supported coordinator-owned baseline preparation facility and pre-dispatch baseline manifest could reduce setup errors. It requires explicit snapshot scope, secret/reserved-path checks, provenance and no automatic source application; weakening guards is not an acceptable shortcut. A sanitized per-run summary could distinguish assistant turns, actual tool calls, failed updates, unique failed calls and unavailable-tool attempts. Current private records already permit this audit, but the public failed-event inventory loses the distinguishing reason. Runtime changes require their own implementation and regression work; this report does not certify those features.

## Subsequent delivery update

The recommended prepared edit/correction pilot subsequently passed on rc.13. The helper/audit/protocol are implemented in rc.14, installed and offline release-verified. The narrow product run required a coordinator correction after premature close, so its Vibe acceptance gate remains partial. See [the adoption evaluation](rc13-worker-adoption-2026-10-09.md); the earlier SEO failure and its counts remain unchanged.
