# Release acceptance status

`npm run verify:release` runs deterministic repository checks, the Vitest suite, the Vibe-free Python tests (`npm run test:python`), build, acceptance checks, a secret-pattern scan, and an SPDX inventory. `npm run smoke:install` packs and installs the tarball offline in a temporary prefix, then initializes the installed stdio server and lists tools with the official MCP client. Supply an existing populated npm cache through `VIBE_SUPERVISOR_TEST_NPM_CACHE`; the smoke test never falls back to network access.

The machine-readable report is `docs/acceptance.json`. Local fake-peer ACP coverage, including the 100-run adversarial lifecycle soak, has passed. It establishes protocol and supervisor lifecycle behavior against the fake peer only. These gates remain **UNVERIFIED** and must not be reported as passing: a 100-run soak against hosted Vibe, hosted ACP cancellation/restart/load and callback behavior, macOS Intel, and a clean OS account. Hosted programmatic review and native Codex desktop visibility passed on 2026-10-05 for the local patched rc.2 build, as recorded below. The integration is currently opt-in; programmatic is the default.

## Live delegation attempt, 2026-10-03

The source CLI (`node dist/cli.js serve --stdio`) was connected to the official MCP client 2.3.0 on Node 24.21.0, macOS arm64, with Vibe 2.25.8. The configured repository allowlist validated. Doctor passed the Vibe version and ACP initialization probes but could not write the configured data directory under the calling session's filesystem restrictions. The delegation test therefore used a private temporary `VIBE_SUPERVISOR_HOME` with the same repository allowlist and default security settings; it did not change user configuration.

MCP initialization and discovery of all eight tools passed. `vibe_review_start` accepted a read-only task to inspect `src/mcp/schemas.ts` (programmatic backend, four turns, 90-second deadline). Run `07fd510c-8de3-498b-bdc0-09c3891c817d` failed before inference with `VSUP_BACKEND_CRASHED`; the redacted diagnostic reported a missing `MISTRAL_API_KEY` for the Mistral provider. Status, result retrieval, and close succeeded, with no changed source files. No edit run was attempted after this authentication failure.

Hosted inference, effective authenticated tool inventory, and desktop tool visibility remain unverified. Authentication must be available to the supervisor's private child environment or Vibe's supported operating-system credential store before repeating review and isolated-edit validation. Discovery through the standalone official client does not establish visibility in Codex desktop.

### Retry after browser login

Browser setup had successfully saved the `ai.mistral.vibe` / `MISTRAL_API_KEY` Keychain entry. An existence-only diagnostic found the entry with normal HOME and could not find it with a fresh isolated HOME. Repeating the review outside the calling session's restrictions also failed to resolve authentication (run `6744cde1-42e5-441a-b8d0-abecf0d691d4`). The private-HOME Keychain lookup is therefore an integration defect, rather than evidence of an unsuccessful user login.

For testing only, a private parent process resolved the existing Keychain credential and supplied `MISTRAL_API_KEY` in the supervisor's environment without printing or persisting it. Hosted generation then succeeded for review run `2209d10b-afcb-40c6-a615-f7827ba32d98`, but the answer reported disabled file tools and did not satisfy the requested file inspection. Isolated edit run `19161f0b-353a-4d59-a4f2-35bd7d0a1679` used six turns and a 120-second deadline; it reached the turn limit, failed, and exported an empty patch. Native public tool-result inspection confirmed `read_file` returned “permanently disabled,” `grep` returned repository matches, and attempted `bash` calls were rejected as an unknown tool. No source edits were applied. The closed edit worktree is retained for diagnosis.

This establishes one successful hosted authentication/generation path via an explicitly supplied environment credential, but successful delegated review/edit behavior remains unverified. Next coding work is private-HOME Keychain authentication and the programmatic file-tool permission integration. Shell rejection must remain intact while addressing file-tool behavior. ACP hosted behavior, full effective-tool inventory, desktop visibility, and the hosted soak remain unverified.

### Coding delegation through Vibe CLI

The user clarified that authentication uses browser login rather than a manually created Studio API key. Mistral's [Vibe authentication documentation](https://docs.mistral.ai/vibe/code/cli/api-keys-profiles) confirms that browser sign-in provisions credentials automatically. The internal `MISTRAL_API_KEY` credential name does not imply that the user must create a Studio API key or upgrade their plan.

Both integration fixes were assigned to installed Vibe 2.25.8. Supervisor edit run `8d130faa-f042-405f-8858-097cf1d3ab43` reached its 30-turn limit and exported a draft that changed the file-tool fallback to `always`; that draft was rejected and not applied. Installed-source inspection then established that `path_pattern_matches` uses `PurePath.match` for absolute globs: `<root>/**` matches immediate children but not nested descendants. Vibe's encoded `vibe-path:directory_recursive:<root>` grant correctly matches descendants while refusing sibling roots.

A temporary pinned-shim CLI bootstrap used that recursive grant and the neutral built-in `ask` agent in a supervisor-created detached worktree. Private HOME/VIBE_HOME, environment filtering, deny patterns, `never` fallback, untrusted project state, and disabled shell/network tools were retained. The existing browser-login credential was supplied only in memory for this bootstrap. Native public tool records confirmed successful nested reads and rejection of attempted shell calls. Vibe produced a second draft before reaching its 35-turn limit; it did not complete either fix.

Independent draft validation failed: TypeScript rejected an environment-object index, lint reported two unused declarations, and eight of twelve new tests failed because their `/tmp` fixture crossed a symlink boundary on macOS. Review additionally found unrecognized agent environment overrides, incomplete Keychain account selection/output bounding, and insufficient meaningful regression coverage. Neither draft was applied to the source checkout. The isolated worktrees and private draft patch are retained for diagnosis; the original supervisor export for the bootstrap worktree predates these additional CLI edits, so cleanup requires a fresh export. Production delegation remains unverified; this attempt demonstrates hosted coding and reviewable changes through a temporary bootstrap profile, not successful end-to-end operation of the unmodified supervisor.

## 2026-10-05 — local patched rc.2 in Codex desktop

After restarting Codex, all eight Vibe Supervisor tools appeared in the chat. Native review-start, result, and close calls completed a hosted programmatic review of the approved synthetic README.md and nested src/a/add.js. Run `958f15a5-93bb-48cd-8312-4c9ce3f9cdab` identified the arithmetic bug, verified source integrity with no changes, and closed normally. This verifies desktop registration/visibility and hosted programmatic review on macOS arm64 for the local permission-fix build; it does not certify the untouched GitHub rc.2 candidate, hosted edits, ACP lifecycle/soak, plugin installation, Intel, or clean-account installation. See the [dated field-test evidence](reviews/rc2-target-test-2026-10-05/Read.md).

### Hosted edits and ACP follow-up

Native programmatic run `0644977e-82c7-4fa3-ac6f-f47beb8a88ee` and ACP run `d00fe37d-8c7f-4500-b0c1-6285b678ab2e` exported the intended minimal arithmetic fix in detached worktrees. An ACP same-session follow-up added the requested README example; it hit the six-turn cap after making the requested change, so it is a verified artifact outcome with a `max_turn_requests` caveat. Independent arithmetic and exact-file checks passed, the source fixture remained unchanged, and both worktrees and Git registrations were removed after close. Review/edit tool inventories matched the intended modes. [Evidence and remaining gates](reviews/rc2-target-test-2026-10-05/Read.md). These results do not certify cancellation, callbacks, restart/load recovery, idle expiry, or hosted soak.

## 2026-10-07 — rc.7 target-machine follow-up

Source f30f8d7, macOS 27.0.1 arm64, Node 24.21.0, Vibe 2.25.8. Offline installation, release verification (596 TypeScript tests including installed-Vibe resolver checks, plus the Python suite), packaging, checksums and compatibility passed. Official-client hosted review/edit, ACP continuation, close in running state, graceful completed/in-progress restart/load, idle expiry and synthetic policy probes have scoped evidence.

D18 FAIL: stopped at run 1/100 on the 12-turn limit; Vibe exited 1 and the supervisor classified VSUP_BACKEND_CRASHED. Zero requests/leaks were recorded for that attempt; the full hosted soak remains unverified. D7's original expectation conflicted with the intentional stat-only handling of ignored files and was corrected without changing runtime behavior. Native desktop restart/client long waits, callbacks, clean-account and Intel remain unverified. See [session report](reviews/rc7-target-test-2026-10-07/Read.md) and [machine-readable results](reviews/rc7-target-test-2026-10-07/session.json).

## 2026-10-07 — locally patched rc.7 turn-limit follow-up

Turn-limit classification and missing saved errors were corrected and verified (603 TypeScript tests, Python suite, installed-Vibe profile checks, lint/typecheck/build, offline package smoke and checksums). The unchanged original hosted soak stopped at run 1/100, now reporting max_turn_requests and driver:stop_reason_max_turn_requests. This confirms the classification correction but does not pass the hosted soak. See [implementation, hashes, commands and outcomes](reviews/rc7-turn-limit-fix-2026-10-07/Read.md). Source corrections remain uncommitted in the isolated checkout; no upstream release was cut.

## 2026-10-08 — rc.8 target-machine stop at D21

Full offline release verification passed 615 TypeScript and 66 Python tests, including installed-Vibe profiles. Hosted cold/warm reviews passed. D21 refusal gates passed with no event activity, but explicitly raising 3 to 10 resumed the unfinished file chain and reached max_turn_requests again with no patch. The correction prompt and raised limit were confirmed locally; root cause remains unresolved. Hosted testing stopped before restart/soak/later checks. Official-client closed-session shutdown and cleanup have scoped evidence only. See [report](reviews/rc8-target-test-2026-10-08/Read.md) and [results](reviews/rc8-target-test-2026-10-08/session.json). No credit balance, desktop adoption, callbacks, clean OS account or Intel acceptance is claimed.

## 2026-10-08 — controlled rc.8 continuation and reliability follow-up

The original D21 failure remains recorded. Explicit task replacement and a bounded four-file 3-to-10 continuation passed live and after lazy reload, with verified files and end_turn. Official-client running/idle/closed shutdown and D24 saved cap reporting passed. D23 exercised the expected supervisor timeout at 61.268 seconds after 90 seconds idle, without a launcher-lifetime crash. No runtime change; the separately scoped soak is pending. See [evidence](reviews/rc8-continuation-followup-2026-10-08/Read.md). Native/platform/callback gates remain unverified.

### rc.8 scoped soak result and installation correction

The new soak stopped at run 20/100: 19 passed (11 reviews, 8 edits), then edit-add-file emitted no event and exceeded the 900-second driver deadline. No explicit auth/quota error was observed. Zero requests/owned leaks; ACP soak scenarios not reached. All test runs closed and worktrees removed. Separately, D1 is corrected to FAIL for the original package: its npm symlink silently exits, while direct Node invocation works. A CLI entry fix and stronger offline smoke are under validation. The earlier acceptance evidence is preserved with this correction.

## 2026-10-08 — locally patched rc.8 CLI entry correction

Original D1 failed for the npm executable symlink despite successful direct Node calls. The corrected entry guard and stronger direct-executable package smoke passed 618 TypeScript tests /56 files, Python tests, installed-Vibe profiles, lint/typecheck/build and offline packaging/checksums. Independent npm executable installation prints rc.8. See [CLI evidence](reviews/rc8-cli-entry-fix-2026-10-08/Read.md). No new hosted inference or upstream release; the 20/100 soak failure and remaining gates are unchanged.

### rc.8 deadline follow-up

The installed CLI entry fix remains verified. The initial soak worker deadline now fits below the driver budget. Full offline packaging passed 620 TypeScript tests and Python/installed-profile checks. Two hosted edits passed; patches and cleanup were verified. The original silent stall remains unresolved and the full soak failure is preserved. See [follow-up evidence](reviews/rc8-finding-fixes-2026-10-08/Read.md).

### rc.8 instrumented bounded soak

Candidate 8e5c963 passed offline release checks (623 TypeScript tests, 76 Python cases, installed profiles and executable/MCP smoke). The single 60/30/10 pass stopped at 1/100 on max_turn_requests; startup finished within 99 ms and the original silent stall did not reproduce. Cleanup passed. Full hosted soak remains FAIL, ACP scenarios were not reached, and native/platform gates remain separate. [Report](reviews/rc8-stall-diagnostics-2026-10-08/Read.md).
