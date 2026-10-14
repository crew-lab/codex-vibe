# rc.28 target-machine runbook

Operational procedure for the target machine (macOS Apple silicon, Vibe 2.26.1 installed and logged in, Codex desktop). It is history so it does not ship. Behaviour: [reference](../reference.md#workspace-readiness), [functionality](../functionality.md). Gates: `docs/acceptance.json`. Evidence: section F.

Known paths (from the [Handoff](../../Handoff.md) and the [rc.18 installation](reviews/rc18-release-installation-2026-10-09.md)): rc.23 at `<private-supervisor-home>/rc23`; selected config `<private-supervisor-home>/rc20-config/config.toml`. Unknown on this side and written as placeholders: `<rc28-prefix>` (use `<private-supervisor-home>/rc28`, a sibling of rc23, only if the operator agrees), `<fixture>` (the test fixture repository), `<site-project-root>` (the approved <site-project> root), `<artifact-dir>` (where `release/0.9.0-rc.28/` was copied), `<codex-config>` (the Codex config file printed by the setup dry run).

## A. Preconditions and stop rules

1. The operator authorizes in chat, separately: install and registration change (B), any hosted spend with its budget (D), and, after 1.0, the clean-account install (E). Without a yes for a part, skip it.
2. Stop at the first failure. No retry, no budget or limit increase, no account rotation, no Luna substitution; a connection or readiness failure is not a Vibe result.
3. Never record credentials, tokens or task text containing anything sensitive. Check provider login only through a run, never by reading Keychain values (`security` without `-w` at most).
4. Keep earlier failures in the evidence next to later passes; do not overwrite them.
5. Do not run anything on the primary dirty checkout; use only the frozen tarball. Run <site-project> only after the fixture matrix and only if separately authorized.

## B. Install rc.28 next to rc.23

```sh
cd <artifact-dir>
shasum -a 256 -c SHA256SUMS
shasum -a 256 vibe-supervisor-0.9.0-rc.28.tgz
```

The tarball must be `61ca4ee91067e2bbf8a7dbf2f14baf3f3667a661c8c587d4fd9b02323fe7e6cd` (sbom `5224499a...`, acceptance `4ce3e82b...` per the Handoff). Stop on any mismatch.

```sh
mkdir -m 700 -p <rc28-prefix>
npm install --prefix <rc28-prefix> --ignore-scripts --offline <artifact-dir>/vibe-supervisor-0.9.0-rc.28.tgz
CLI=<rc28-prefix>/node_modules/vibe-supervisor/dist/cli.js
CONFIG=<private-supervisor-home>/rc20-config/config.toml
node "$CLI" --version
stat -f '%Lp %Su' "$CONFIG"
```

Use the populated npm cache as in the rc.18 install; the exact prefix layout of rc.23 may differ (its `dist/cli.js` is at the path the existing registration names), so confirm `$CLI` exists. Expect `0.9.0-rc.28`. If the config mode is not `600` or the owner is not the operator, `chmod 600 "$CONFIG"` (rc.28 refuses group- or world-writable configs; a symlinked config or parent is also refused). Back up the config first: `cp -p "$CONFIG" "$CONFIG.rc23-backup"`.

```sh
node "$CLI" doctor --config "$CONFIG" --json > doctor-rc28.json
node "$CLI" setup --workspace <fixture> --config "$CONFIG" --codex user --dry-run
```

Review the dry run: only `[mcp_servers.vibe-supervisor]` changes, with the rc.28 `dist/cli.js`, `serve --stdio --config "$CONFIG" --isolated`, and the same allowlist. Record the hash of `<codex-config>` and keep the dry-run output. With authorization:

```sh
node "$CLI" setup --workspace <fixture> --config "$CONFIG" --codex user --yes
node "$CLI" setup --workspace <fixture> --config "$CONFIG" --codex user --dry-run
```

The second dry run must show no change. Refresh the skill links to the rc.28 package as in the rc.17 and rc.18 installs and compare bytes with `skills/vibe-supervisor/SKILL.md` of the tarball.

Rollback to rc.23: quit Codex; if `<codex-config>` still equals the reviewed post-change file, restore the timestamped backup setup made (otherwise change only the `[mcp_servers.vibe-supervisor]` args back to the rc.23 `dist/cli.js` after review); point the skill links back to rc23; restore `$CONFIG.rc23-backup` only if the config was altered; reopen Codex. rc.23 and rc.28 installs, saved runs and provider state stay in place.

## C. Native readiness gate (no inference)

Reconnect: quit and reopen Codex desktop, open a testing thread, and confirm exactly the five tools `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, `vibe_close`.

1. `vibe_status` with `workspace: <fixture>`, `operation: review`. Then `operation: edit` with `base_ref: <ref>`. Then the same two for `<site-project-root>` (review; edit only if edits there are in scope). Expect each: `server_version` `0.9.0-rc.28`, a `server_instance_id`, `policy_path` equal to `$CONFIG`, a `policy_revision`, `restart_required: false`, `eligible: true`, empty `blockers`, `active_slot.busy: false`, `runtime` with `executable_found: true` and `version_verified: false`, a `readiness_receipt` and `receipt_expires_at`; an edit also `base_commit`. No run id appears and `node "$CLI" runs --config "$CONFIG" list` shows nothing new.
2. Optional (covered by deterministic tests, not a 1.0 criterion). Live allowlist change, without restarting Codex: record `policy_revision`, remove one root (use `<site-project-root>`) with a reviewed edit of `$CONFIG` (keep mode 0600), re-run readiness for it. Expect `eligible: false`, a blocker naming the workspace not allowlisted, a new `policy_revision`, same `server_instance_id`. Restore the root (`node "$CLI" allow --config "$CONFIG" <site-project-root>`), re-run: `eligible: true`, a revision different from the removed state, a fresh receipt, same instance.
3. Optional (covered by deterministic tests, not a 1.0 criterion). Boot-key change: change one boot-bound value in `$CONFIG` (for example `limits.max_mcp_result_chars`), re-run readiness. Expect `restart_required: true` with the key in `boot_drift`; a start with the old receipt would fail `VSUP_RESTART_REQUIRED` (do not start one). Restore the value, re-run: `restart_required: false`. Confirm `diff "$CONFIG" "$CONFIG.rc23-backup"` shows only the intended allowlist state.

Record every reply (redacted) and the config hashes before and after. Any deviation: stop, record, roll back if needed.

## D. Hosted matrix (separately authorized and budgeted)

Preconditions: C passed on this connection; operator has stated the fixture, baseline `base_ref`, tasks, limits (`max_turns`, `timeout_seconds`) and the provider budget. Five sequential runs on `<fixture>`: (1) initial review, (2) initial edit, (3 to 5) three more reviews or edits. Before every run call readiness again and pass that `readiness_receipt` to the start. One active run at a time. Do not raise limits.

Per run record: run id, operation, receipt used, `policy_revision`, state and `stop_reason` (read the stop reason before trusting the summary), timings (start, first status, settled), review integrity or edit changes, usage where reported, warnings. For edits also: independent check of the patch (apply it to a scratch clone, run the fixture's tests), the source checkout unchanged, and cleanup through `vibe_close` with `cleanup_worktree: true` followed by `node "$CLI" runs --config "$CONFIG" show <run-id>`. After the five runs, `runs list` must show no active run and no stray worktree.

Real active disconnect (one run, during run 3 or later, with a task long enough to still be running):

- Desktop: start the run with `wait_seconds: 0`, confirm `vibe_status` shows it `running` with events, then fully quit Codex desktop (Cmd+Q, not a reconnect) before it settles. Reopen Codex, reconnect, read the run.
- Official client: run `serve --stdio --config "$CONFIG" --isolated` from a Node script using `@modelcontextprotocol/client`'s `StdioClientTransport` (from the rc.28 install), start a run, then `client.close()` while `vibe_status` shows `running`.

Expected outcome ([functionality](../functionality.md)): the server exits; the worker's process group is gone (`pgrep -f` for the run shows nothing); the owner lock is released; on the next start or `runs show` the run is `failed` with an interruption diagnostic and is never relaunched or replayed; for an edit the worktree is kept and `vibe_close` with `cleanup_worktree: true` removes it only after the fresh-export check. If the run settled before the disconnect was observed, the attempt is inconclusive: record it and repeat only with new authorization.

Then one narrow <site-project> review if separately authorized: one readiness call with receipt, one review with a small task and tight limits, same recording; no edit.

## E. Clean macOS account install (deferred to 1.0.1 by owner decision 2026-10-12)

With a person present, in a fresh standard macOS Apple silicon account. No credentials copied from another account; the provider login is done by the person in that account.

1. Record macOS version, architecture, Node (20.19.0 or later), Git, Vibe version.
2. Copy the frozen tarball and `SHA256SUMS`; verify as in B.
3. Install into a private prefix as in B, run `--version`, then `allow` for a throwaway repository, `doctor --json`, `setup --dry-run`, then (authorized) `setup --yes`, and the Codex reconnect with the exact five tools.
4. Native readiness for the throwaway repository. A hosted run only if D was authorized for this account.
5. Record the exact config and registration diff, then roll back and record the rollback outcome and cleanup.

## F. Evidence recording

- Narrative in `docs/history/acceptance.md` under a dated section for rc.28, linking the evidence folder.
- Raw evidence in `docs/history/reviews/rc28-target-test-<YYYY-MM-DD>/`, copied from [phase-d-template](reviews/phase-d-template/Read.md): filled `Read.md` plus redacted tool replies, `doctor-rc28.json`, hashes and timing logs.
- Gates in `docs/acceptance.json` flip only with that evidence, one at a time. The four required for 1.0 are C1 `native-readiness-on-candidate`, D runs 1 to 5 `hosted-review-edit-matrix`, D disconnect `active-disconnect-hosted`, and the first authenticated run `provider-authentication-for-this-candidate`. C2, C3 and E are under `not_required_for_1_0` (optional or deferred); record them there if observed. `node-floor-20.19.0` is PASSED_LOCALLY. Move a passed gate from `unverified` to a new `verified` list with the evidence path; failed or partial gates stay UNVERIFIED with the failure noted. Rebuild and re-run `npm run acceptance` after editing.
- Update the Handoff priorities and `docs/compatibility.md` "Unverified gates" in the same change.
