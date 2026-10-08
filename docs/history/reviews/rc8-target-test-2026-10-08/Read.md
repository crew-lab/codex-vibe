# rc.8 target-machine test — 2026-10-08

Tested source `e71f9182eb37e728cc522881811ed9168cca331c` in the existing managed checkout, preserving the dirty primary checkout. The user authorized testing with the currently logged-in Vibe account. Parent MISTRAL_API_KEY was absent; browser-login hosted inference worked. Account identity, available credit and the claim of USD 10 per account were not inspected; no rotation or login modification occurred.

## Outcome

**D21 FAIL; hosted testing stopped.** In run `c20da652-74e3-4eb9-9e66-5b5874a72991`, a dependent file chain reached max_turn_requests at 3. Plain continuation, equal limit 3 and lower limit 2 were refused with the expected VSUP_TURN_LIMIT_REACHED / VSUP_INVALID_ARGUMENT, and events.ndjson stayed exactly 12,545 bytes across all three refusals. An explicit raised limit of 10 resumed six successful reads but stopped at max_turn_requests with zero changed files instead of end_turn and the requested budget-raised.txt.

Selective local inspection of the sanitized native public messages confirmed that the exact new correction prompt was appended as a user message. Native metadata and the stop marker show max_turns 10. This rules out an omitted continuation prompt or an unchanged ceiling for this trial. It does not establish why the worker kept reading the original chain: instruction compliance and fixture/budget suitability require investigation before a runtime fix. Do not silently mark this pass or raise limits to erase it. The restart variant, full soak and later hosted tests were not run.

## Passed and limited evidence

Offline npm ci and full package:rc passed: 615 tests /55 files including both installed-Vibe profile tests, 66 Python tests, lint/typecheck/build, acceptance, secret scan, SBOM, offline installed MCP smoke and checksums. The locally rebuilt rc.8 tarball SHA-256 is 9f0bf89da655679bbd3acf701bd774b01f77e40bf5cf2aec16cbfdc7742736b0. This rebuild from e71f918 differs from the preparing-machine aa921aa artifact/hash in Handoff; that original tarball was not available here. Release logs and environment.json record the tested build.

Project-only setup plan/write/idempotence and doctor passed; no user-global config or desktop restart was performed. Compatibility automatic checks passed, and the real installed profile regressions passed. Five programmatic/seven ACP tools appeared through the official MCP client. Cold and warm hosted nested reviews identified the arithmetic defect, ended end_turn, retained verified integrity and closed. The driver also reads status to capture evidence; this does not prove the strict three-call native desktop loop or first-token latency.

Official-client close after the exercised closed sessions exited their servers in 3-5 ms; the complete harness processes exited naturally. That is scoped D22 evidence only: running, idle-completed and native desktop disconnect variants remain untested. All five runs are closed, their owned processes are absent, all three worker worktrees removed, no owner locks remain, and the synthetic source is clean. Private homes/test fixture/packages are retained for investigation. See cleanup.json, session.json and metrics.json. No raw native history, credentials or reasoning was copied.

## Harness setup issues, preserved separately

The initial release run failed four fake CLI probe tests because the coordinator prepended the actual Vibe Python environment to PATH. Fake entrypoints then imported real Vibe; removing that override restored all tests. This was a test-environment error, not a source fix. The initial install command had a duplicated release path; the corrected offline install passed.

The first hosted D21 task completed within three model turns because calls could batch; it did not establish exhaustion. A sequential pointer-chain fixture replaced it in a fresh run. The first capped trial then stopped in the harness because a plain-text MCP error was parsed as JSON. The corrected harness handles both JSON and plain errors. These trials were closed and retained; they do not count as product failures. Only the final raised-budget failure is the recorded D21 result.

## Next work

Investigate the confirmed delivered correction and resumed original-chain behavior without guessing a supervisor defect. Specify the smallest reproducible cap/recovery fixture and an explicit contract for whether continuation cancels the unfinished original objective. Preserve this failed case. Once resolved or a documented acceptance-plan correction is justified, repeat D21 live/restart, then D22/D23/D24 and the scoped 60/30/10 soak with the new 20-turn review default. Native desktop, callbacks, clean OS account and Intel gates remain unverified. A different provider login is not a clean OS account installation test.

No source code, global configuration, Vibe pin or worker policy was changed; no commit/push/release publication occurred in this session.

## Installation acceptance correction

The initial D1 claim was too broad: direct Node CLI calls succeeded, but later direct invocation of the installed npm symlink returned exit 0 with empty stdout (bin-version.txt); node-version.txt contains 0.9.0-rc.8. D1 is corrected to FAIL for that original package. Its main-module guard compared a resolved module URL with an unresolved symlink argv path. The previous smoke used Node plus the real file, so it missed this defect. A separate source fix and direct-executable package smoke are being verified; no past package acceptance is retroactively claimed.
