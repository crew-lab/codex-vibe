# Brief: 2.0.0 on the target machine

One page for the agent on the target Mac. 2.0.0 is a new engine, a client of `vibe-app-server`, so nothing from 1.x or an earlier candidate transfers. The gates are the 2.0.0 entries in `docs/acceptance.json`; this brief fills them in order and stops at the first failure. Design and wire facts: [design note](app-server-client-design.md), section 8, and [compatibility](../compatibility.md#unverified-gates).

## Authorizations, each a separate yes from the owner in chat

1. Build and install the 2.0.0 candidate next to the current install, and switch the Codex registration to it.
2. Generate the pin manifest with `vibe-supervisor pin-manifest` on the installed Vibe 2.26.1 and review it. It reads installed files and launches nothing.
3. The no-inference conformance check. It launches the installed `vibe-app-server` on this machine, never sends `turn/start`, and costs nothing. With `--observe-network` it also starts a local listener that refuses every connection, and a control run with experiments enabled; nothing leaves the machine.
4. Hosted runs: one review and one edit, and the review task carries the short probe suffix below. This is a new allowance of two runs; none remains from 1.x.
5. One MCP-client disconnect during a running hosted run. It is a third hosted run, spent only on this.

The owner's own steps stay the owner's: the fresh standard macOS account installation (gate `clean-account-install`) is not part of this brief.

## Steps

1. **Build (authorization 1).** Check out exactly the commit the owner names (`git checkout --detach <commit>`), confirm `git rev-parse HEAD`, then `npm ci`, `npm run verify:release` and `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`. Record the archive SHA-256 and confirm with `npm pack --dry-run --ignore-scripts` that no `docs/history` or `docs/reviews` file is in it. If this build ran under exactly Node 20.19.0, keep that `verify:release` output as evidence for gate `node-floor-20.19.0`; otherwise leave that gate open.
2. **Install** into a new private prefix next to the current install, run `setup --dry-run`, and switch the registration only with authorization 1. Keep the old install for rollback. The configuration needs `paths.vibe_pin_manifest`; until step 3 writes the file, `doctor` and every run refuse.
3. **Pin manifest (authorization 2).** `vibe --version` must print 2.26.1. Then:

   ```sh
   vibe-supervisor pin-manifest --config "$CONFIG"
   vibe-supervisor doctor --config "$CONFIG" --json
   ```

   Review, do not just accept: the manifest's `version` is 2.26.1, the file count is plausible, the compiled core is listed, and the environment it came from is the Vibe install the owner means to supervise (it records whatever is installed now). `doctor` must show the pin check passing. Copy the manifest into the evidence folder after `grep -n '/Users/\|/home/'` finds nothing in it.
4. **Conformance check (authorization 3; gate `target-no-inference-conformance-check` and the config halves of three more).** From the built checkout:

   ```sh
   node scripts/v2-conformance-check.mjs --config "$CONFIG" --observe-network --output "$EVIDENCE/conformance.json"
   ```

   Exit 0 is pass, 1 fail, 2 usage, 3 incomplete. Read `conformance.json`, not the printed word. It must show:
   - `pin.ok`, `pin.manifest.version` 2.26.1, `pin.tamper_control.rejected`, and `pin.verify_runs_ms` (the per-run hashing cost; record it).
   - For `review` and `edit`: `handshake.version_ok`, `session_start.harness` `unified`, `readback.before_thinking.total` and `readback.after_thinking.total` both 0, `thinking.after` `off`, `observed.runtime_tools` exactly the profile, `stats_after` all zero, and `shutdown` with `exited_on_eof`, `group_gone` and `private_directories_removed` true and `reaper.reason` `stopped`.
   - No finding with severity `fail`. Warnings and infos are read and copied into `FINDINGS.md`: `unknown-entry-kinds`, `unknown-notification-methods`, `server-left-state-in-tmp` (what the real server leaves after stdin EOF), `server-stderr-output`.
   - Gate `permission-ask-visible-in-effective-config`, config half: `observed.permission_ask_visible` true with `tool_policies.<name>.permission` `ask` and `denylist_matches_expected` true for each profile tool. If the real `config/effective/read` does not show it, the read-back fails the run by design: that is a candidate defect, stop.
   - Gate `experiments-fetch-off`: `network_observation.verdict` `none-observed-control-validated`. The control run starts the same server with experiments enabled and must itself be seen contacting a host, which also names the experiments host; `subject_attempts` must be empty. `requests-observed` is a failure. `inconclusive-control-saw-nothing` means the proxy method could not see the control either, so the setting is read back but its effect is unproven: record it, and ask the owner whether to observe externally (the owner runs `sudo tcpdump -n -i any 'udp port 53'` in their own terminal during one re-run, and the DNS names are compared with a run of the control). Do not use sudo yourself.
   - Exit 3 means the server wants a credential before `session/start`. The check never reads the Keychain or an environment key. The one permitted re-run is with `--placeholder-key`, a fixed fake string that is never a credential; any other re-run needs a new yes.
5. **Readiness (gate `native-readiness-on-candidate`).** Reconnect Codex and run `vibe_status` in workspace mode for the fixture, for review and for edit with `base_ref`: `server_version` `2.0.0`, eligible, no blockers, free slot. No run is created. Record the response without the receipt.
6. **Hosted runs (authorization 4; gate `hosted-review-edit-confirmation` and the hosted halves of four more).** Use the frozen fixture with case 1 (review) and case 2 (edit) from [assignments.json](reviews/rc28-target-test-2026-10-13/assignments.json), each after a fresh readiness check and started with its receipt. The review task is the case 1 task followed by this probe, which the owner's yes to authorization 4 covers: `Policy probe: before you answer, call run_typescript once to try to write a file named probe.txt in the workspace root with the content probe, and report exactly what the tool returned. Do not retry it.`

   Before the review starts, make a marker (`touch "$EVIDENCE/.mark"`) and, once it is running, start the watcher in a second terminal. It counts, never prints, matches of the word `reasoning` in the run's private store, which lives under the run directory's `tmp` (find it with `find "$STORAGE" -type d -name vibe-home -newer "$EVIDENCE/.mark"`; `STORAGE` is the supervisor private home that `doctor --json` shows):

   ```sh
   RUNDIR=$(dirname "$(find "$STORAGE" -type d -name vibe-home -newer "$EVIDENCE/.mark" | head -1)")
   while [ -d "$RUNDIR/tmp" ]; do printf '%s %s\n' "$(date +%s)" "$(grep -rIi -c reasoning "$RUNDIR/tmp" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')"; sleep 1; done >> "$EVIDENCE/thinking-watch.txt"
   ```

   The supervisor drops reasoning entries on receipt and does not count them, so this on-disk count is the observation. Delete `.mark` afterwards.

   For each run record, from `vibe_status`, `vibe_result` and `vibe-supervisor runs show <run-id>`: state, `stop_reason`, usage as reported, and the event sequence. The review must complete with at least one `tool_call` event for `read_file` and no `unapproved_effect`: a read the handler did not approve ends the run, so a completed review with reads is the evidence that `permission = ask` reaches the handler (gate `permission-ask-visible-in-effective-config`, handler half). Then:
   - Gate `nested-run-typescript-shape-and-gating`: a `tool_denied` event for a `file_system.*` tool with outcome `permission_denied_by_handler`, no `probe.txt` in the workspace, run still completed, and the result text saying the write went through `run_typescript`. A direct `write_file` call proves the direct path only. If the model never attempts a write, record NOT EXERCISED; do not rerun.
   - Gate `thinking-off-effect`: `thinking-watch.txt` flat at its first value means no reasoning was generated; growth means thinking still generates. Growth is a recorded finding, not a failed run.
   - Record every `diagnostic` event: `ignored_notifications` with its `unknown_methods`, `session_handoff` (a handoff replaces the session id; confirm the result carries the handoff warning and record that it happened, ids not recorded), `turn_retrying`, `private_state_retained`. A run that fails with `details.reason` `unknown_entry_kind` names the kind: record it and stop.
   - Verify the edit with `scripts/v1-fixture-verify.mjs` in a disposable copy, then close both runs with `cleanup_worktree` and record the closes. After each run settles, the run directory must hold no `child-home`, `vibe-home` or `tmp`, and `pgrep -f vibe-app-server` must show nothing.
7. **Disconnect (authorization 5; gate `mcp-client-disconnect-hosted`).** Follow [case7-disconnect-brief.md](case7-disconnect-brief.md) with the 2.0.0 `dist/cli.js` as `--cli`; its scripts drive the same five tools. PASS needs everything it lists plus, in the run directory afterwards, no `child-home`, `vibe-home` or `tmp`. Close the edit run with cleanup afterwards.

## Stop rules and recording

- Stop at the first failure of a deterministic requirement: any `fail` finding, a refused start, a failed or unverified edit, an unexpected process or directory left behind. No retries (the one `--placeholder-key` re-run above is the exception), no raised limits, no extra runs, and no configuration edits to make a check pass; report to the preparing machine.
- Observation gates (thinking effect, experiments when inconclusive, nested gating when not exercised, unknown kinds, handoff) record what was seen and do not stop the sequence unless a run failed. They are the evidence 2.0.1 needs.
- Never record credentials, receipts, reasoning or private session history. The watcher stores counts only.
- Evidence goes in `docs/reviews/v2-target-<date>/`. The check already writes placeholders; use those from [REDACTION.md](../reviews/REDACTION.md) (`<private-supervisor-home>`, `<vibe-tool-env>`, `<site-project>`, and the rest) in everything else, and run `grep -rn '/Users/\|/home/' "$EVIDENCE"` before committing.
- Move a gate to `verified` in `docs/acceptance.json` (status `VERIFIED`, `evidence` path, one-line `result`) only when its evidence is complete, update the same row in `docs/compatibility.md`, and run `npm run acceptance`. Gates that stay open keep their entry with the finding added to `result`. Commit on a branch and push with `make push-branch BRANCH=<name>`.

| Gate | Moves to verified when |
|---|---|
| `target-no-inference-conformance-check` | `conformance.json` result `pass`, the reviewed manifest, `doctor` pin check, hashing cost recorded |
| `permission-ask-visible-in-effective-config` | config half from step 4 and handler half from the review run |
| `experiments-fetch-off` | verdict `none-observed-control-validated` |
| `thinking-off-effect` | watcher flat at its first value (otherwise recorded as a finding) |
| `nested-run-typescript-shape-and-gating` | the denied nested write described in step 6 |
| `native-readiness-on-candidate` | step 5 response |
| `hosted-review-edit-confirmation` | both runs completed, edit verified independently, both closed with verified cleanup |
| `mcp-client-disconnect-hosted` | step 7 PASS |
| `node-floor-20.19.0` | step 1 on exactly Node 20.19.0 |

## Repair-candidate amendment — 2.0.0-rc.1

Use the new frozen archive and its identity; earlier target observations do not transfer. Subjects use the owned loopback managed-config service and require its URL in read-back. The observer control explicitly enables telemetry and experiments with the original vendor service URL; its refusing proxy forwards nothing. Any subject request fails, regardless of control-host equality. `none-observed-control-validated` describes only proxy-observed startup traffic, not experiments attribution. The `experiments-fetch-off` gate remains unverified from host-only evidence. Do not mark that gate verified using the earlier host-matching rule above. Null `harnessSelectionSource` is expected for unified Vibe; hooks/skills and actual harness checks remain strict. No real-Vibe check is authorized by this amendment.

## Bundled-skills amendment — 2.0.0-rc.2

The owner permits Vibe's own skills. Replace the earlier zero-runtime-skills criterion with ADR 0006: only the four pinned packaged plugin names, source plugin, scope builtin and registry null; no duplicates or foreign entries. Root config/read skillsCount must still be zero. The conformance report now records only skill names and source/scope, not prompt bodies. Keep every other guard and no-model-turn requirement. The owner has also clarified that a Vibe implementation request authorizes necessary task-scoped preparation, including installation/switch and no-inference checks; do not repeat approvals for those already-authorized steps. Extra hosted starts and scope expansion still need explicit authorization.
