# Brief: 1.0.1-rc.2 on the target machine

One page for the agent on the target Mac. rc.2 changes the launcher and run manager (see the CHANGELOG entry), so nothing from rc.1 transfers. The gates are in `docs/acceptance.json`; this brief fills them in order and stops at the first failure.

## Authorizations, each a separate yes from the owner in chat

1. Build and install rc.2 next to rc.1, and switch the Codex registration to it.
2. The installed-Vibe profile check. It runs the installed Vibe's Python with no provider and no inference, so it costs nothing.
3. Two hosted runs: one review and one edit. No allowance remains from rc.1.

The fresh standard macOS account installation is the owner's, with the [prepared packet](../reviews/rc1-integration-2026-10-14/FRESH-ACCOUNT.md), on this same archive.

## Steps

1. **Build.** Check out exactly `99ec1f0` (`git checkout --detach 99ec1f0`; later commits on main may not change shipped files, but build from this one), confirm `git rev-parse HEAD`, then `npm ci`, `npm run verify:release` and `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`. Record the archive SHA-256 and confirm with `npm pack --dry-run` that no `docs/reviews` or `docs/history` file is in it.
2. **Install** into a new private prefix next to rc.1, run `setup --dry-run`, and switch the registration only with authorization 1. Keep rc.1 for rollback.
3. **Profile check (gate `installed-vibe-profile-check`).** From the checkout:

   ```sh
   VIBE_SUPERVISOR_TEST_VIBE_PYTHON=<vibe-tool-env>/bin/python npx vitest run tests/unit/profile.test.ts
   ```

   It must run the installed-Vibe cases, not skip them, and pass. They confirm the five pinned sources against the installed Vibe, refusal of a tool outside the profile at invocation and through `ToolManager.get`, and that no skill is available or invocable. Any failure here is a launcher bug: stop and report it to the preparing machine.
4. **Readiness (gate `native-readiness-on-candidate`).** Reconnect Codex and run `vibe_status` in workspace mode for the fixture: `server_version` `1.0.1-rc.2`, eligible, no blockers, free slot. No run is created.
5. **Hosted confirmation (gate `hosted-review-edit-confirmation`)**, with authorization 3 only. Use the frozen fixture and the case 1 review and case 2 edit from `docs/history/reviews/rc28-target-test-2026-10-13/assignments.json`, each after a fresh readiness check and started with its receipt. Verify the edit with `scripts/v1-fixture-verify.mjs` in a disposable copy, then close both with cleanup. Turn `VIBE_SUPERVISOR_DIAGNOSTICS=1` on for these runs: the recorded inventory must be exactly the profile, with no `refused` outcomes.

## Stop rules and recording

- Stop at the first failure. No retries, no raised limits, no extra runs.
- Never record credentials, receipts or private session history.
- Evidence goes in `docs/reviews/rc2-target-<date>/`. Use the placeholders from [REDACTION.md](../reviews/REDACTION.md) (`<private-supervisor-home>`, `<vibe-tool-env>`, `<site-project>`, and the rest) from the start, so nothing needs redacting later.
- Move each passed gate to `verified` in `docs/acceptance.json` with its evidence path. Commit on a branch and push with `make push-branch BRANCH=<name>`.
