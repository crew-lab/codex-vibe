# rc.27 cold review (2026-10-12)

Range `47bbfc4..84f4421` (rc.25 to rc.27), source and tests, reviewed without design context; experiments in throwaway repositories only, no real Vibe. Verdict: nothing introduced in rc.25 to rc.27 blocks freezing rc.27 for hosted testing. F1 predates the range and deletes user edits in repositories with a non-default setting; it should be fixed before 1.0.

## Findings

| ID | Where | Defect | Confidence |
| --- | --- | --- | --- |
| F1 | `src/git/worktree.ts:146-151`, `:251-257` | With `core.ignoreStat=true` in the user's repository, `git worktree add` marks every entry assume-unchanged, so worker edits to tracked files are absent from `diff`; the exported patch is empty, the run reports completed, and `vibe_close` with `cleanup_worktree: true` finds a matching (empty) fresh export and a clean `status`, then removes the worktree and the edits. Reproduced with Git 2.54. Predates rc.25; the racy-clean fix does not cover it. Fix: clear assume-unchanged in the private index (or refresh with it ignored) before export and cleanup status, or refuse repositories that set `core.ignoreStat`. | High |
| F2 | `src/git/worktree.ts:130-138` | With `core.splitIndex=true` and `splitIndex.sharedIndexExpire=now`, the private-index export writes a new `sharedindex.*` into the gitdir and expires the one the real index points to; the worktree's index is then broken (cleanup fails closed, the retained worktree is unusable). With the default expiry it still writes a stray file into the gitdir. Fix: disable split index for the private-index commands (`-c core.splitIndex=false`) or copy the shared index too. | High (reproduced) |
| F3 | `src/git/worktree.ts:89` | A missing worktree directory makes `spawn` fail with ENOENT for the cwd, which is classified as a missing Git binary: `VSUP_GIT_REQUIRED`, "the git executable must be on PATH". | High |
| F4 | `src/git/worktree.ts:166-168` | A worktree-creation timeout is reported as `VSUP_WORKTREE_CREATE_FAILED` with no `kind`, while the `VSUP_TIMEOUT` remedy names the 5-minute creation bound. | High |
| F5 | `src/core/run-manager.ts:622` | The printed manual cleanup command quotes paths with `JSON.stringify` (double quotes), which still expand `$(...)`, backticks and `$VAR` in a shell if pasted. Use single-quote shell escaping. | Medium |
| F6 | `src/git/worktree.ts:135` | Setting the private index mtime to 1 makes every entry racy, so `add -N` and each `diff` re-hash the whole tracked tree; export plus cleanup is about eight full reads, each bounded only by the 5-minute heavy bound. A very large repository can fail a completed run with `VSUP_TIMEOUT`. | Medium |

Open question: `editBaseCommit` (`run-manager.ts:347`) turns every Git failure, including a timeout or a missing binary, into "base_ref does not resolve".

## Checked without a defect

The racy-clean fix is correct for normal configurations (the same-size regression fails without it); `core.trustctime` and `core.checkStat` do not matter; fsmonitor stays correct through the copied token. Query and heavy bounds are assigned correctly, and the patch cap applies to export and cleanup re-export. Settle ordering has no deadlock; slot and handle are kept when termination is unverified. `closeRun` recording `cancelled` is correct. The Keychain-notice tolerance only matters when the summary marker also matches. JSON error replies are bounded and redacted.

Tests: no product assertion was weakened; the structural replacements for wall-clock budgets still discriminate. Two weak spots: the "missing binary" test in `worktree-close.test.ts` never exercises a missing binary, and an `expect.not.stringContaining` also passes if the note is dropped.

## Suite stability

Ten consecutive full `npx vitest run` passes on a clean clone of main at `84f4421` (621 passed, 2 skipped each), meeting the assessment's exit criterion.
