# rc.8 stall diagnostics and bounded soak, 2026-10-08

Implemented and committed bounded diagnostics plus an overall soak budget on `codex/rc8-stall-diagnostics`. Previous CLI/deadline fixes and failure reports are preserved; article-only revision 7d68f3d is incorporated. No main push, upstream release, version bump, global configuration change or account rotation.

## Candidate and verification

Tested commit: `8e5c963c798d973783e2022b23c20657cf7dca22`. Installed rc.8 archive SHA-256: `6a67fcba46259b43e0acce4cbe0ae02220ba241f8c07a969d7c0d152ee8536c4`. The installed npm executable prints 0.9.0-rc.8. [Manifest](manifest.json) records source hashes, fixture commit and exact run options. The archive was built before the excluded handoff/history notes were updated; runtime and driver source match the candidate. Earlier archives are retained in the private release directory.

Full offline package verification passed 623 TypeScript tests in 56 files, the 76-case Python suite, both installed-Vibe profiles, lint/typecheck/build, acceptance/secret scan/SBOM and installed executable/MCP smoke. New checks cover stage allowlists, snapshot timing and size, exclusion of frame locals/source/arguments, known-secret filtering, unsafe paths/files, write failure, private evidence filtering and overall-budget cleanup. See [full package log](package-verification.log).

## Single hosted pass: FAIL, stopped at 1/100

Requested 60 reviews, 30 edits and 10 ACP scenarios with built-in tasks, the same synthetic fixture and seed soak. Options: diagnostics on, stop-on-fail, initial wait 0, status wait 30, driver timeout 900 and total timeout 7200 seconds with the final minute reserved for cleanup. The initial review received max_turns 20 and timeout 870 seconds.

Run `7115aa99-c1d6-4b82-b95d-41434feae1f0` completed with `max_turn_requests` after 21.401 seconds; the driver correctly rejected this incomplete answer and stopped. Public review integrity was verified, with no write observed and no file changes. All six startup stages completed by 99 ms. This was not a silent timeout; no 60-second snapshot was due. [Preserved diagnostic](diagnostics/7115aa99-c1d6-4b82-b95d-41434feae1f0.json), [public result](failed-run/result.json), [summary](summary.json) and [run record](runs.ndjson) contain the evidence.

A whitelisted inspection of native recovery data found four read_file calls and sixteen grep calls, with 21 recorded steps. These observations show budget exhaustion after repeated searches, not a proved supervisor or provider defect. Native reported cost was 0.03486 USD and is non-authoritative; the MCP reply supplied no usage. A zero cost in the driver summary therefore means missing reported usage, not free inference. No private native histories, account identity or credentials were copied. See [safe observations](safe-native-observations.json).

The earlier intermittent silent stall remains unresolved and did not reproduce. The full soak is still FAIL/incomplete; edits and ACP continuation/reload/mid-turn-close scenarios were not reached. The two-hour limit was not reached. No hosted retry was started. Native desktop, callbacks, clean OS-account and Intel gates retain their separate status.

## Cleanup and next investigation

The run is closed, its owned worker is absent, owner locks and worktrees are absent, and the synthetic source is clean. Baseline and final Vibe process counts were both five, with zero owned leaks. Public evidence and private runtime directories are retained. [Cleanup checks](cleanup.json).

Next investigate the repeated-search review independently of the silent stall: inspect the existing synthetic tool-call sequence and results to identify repeated patterns or tool failures, then design a bounded review task requiring a final answer and an explicit search-call cap. Add a regression only if a concrete driver/profile defect is established. Do not automatically increase turn limits, rotate accounts or rerun inference. Another full hosted pass requires a deliberate revised test decision.
