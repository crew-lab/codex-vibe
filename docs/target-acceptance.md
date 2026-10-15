# Target acceptance

The procedure that proves a build of the supervisor against one Vibe release on the machine that runs Vibe. Use it for the supported Vibe release and again, as a new candidate, for every later one ([compatibility](compatibility.md#source-basis) says what revalidating a release involves). The gates it fills are the entries in [acceptance.json](acceptance.json); each moves from `unverified` to `verified` only with its evidence recorded. The agent on the target machine follows the steps in order and stops at the first failure.

Vibe is never installed, run or tested anywhere else. The target agent records evidence and changes no code; a defect goes back to the preparing machine as a new candidate.

## Authorizations

Each is a separate yes from the owner in chat. A yes to one does not cover another.

1. Build and install the candidate next to the current install, and switch the Codex registration to it.
2. Generate the pin manifest with `vibe-supervisor pin-manifest` on the installed Vibe and review it. It reads installed files and launches nothing.
3. The no-inference conformance check. It launches the installed `vibe-app-server` on this machine, never sends `turn/start`, and costs nothing. With `--observe-network` it also starts a local listener that refuses every connection, and a control run with experiments enabled; nothing leaves the machine.
4. Hosted runs: one review and one edit, and the review task carries the policy probe below. An allowance of two runs.
5. One MCP-client disconnect during a running hosted run. It is a third hosted run, spent only on this.

The owner's own steps stay the owner's: the clean standard macOS account installation (gate `clean-account-install`) is not part of this procedure.

## Fixture and assignments

The hosted runs use a small Git repository the owner names, clean at a known base commit, never a private project. It holds a short contract file and one source file that implements a strict comparison, so the answers can be checked by hand.

- **Review assignment.** Read only the contract and the source file. Decide whether the function implements the strict comparison, cite it, and evaluate five named inputs, including the equality case and a negative pair. The answer is a concise, evidence-backed conclusion; no invented defect, no recommendations, no scratch files. 12 turns, 180 seconds, no retries.
- **Edit assignment.** Read the contract and the source file first. Add exactly two new files: a module exporting a named function `atLeast(value, limit)` that returns `value >= limit`, and a test file using `node:test` and `node:assert/strict` that covers below, equal, above, negatives and equality. Change no existing file; no shell, network or test execution; finish with a concise answer and a changed-file inventory. 12 turns, 180 seconds, base ref the fixture's clean commit, no retries.

`scripts/fixture-verify.mjs <disposable-export-directory>` checks an edit's result against a fixed set of cases for that function. It executes the candidate module, so give it a disposable export outside any Git checkout, never the worker's worktree.

## Steps

1. **Build (authorization 1).** Check out exactly the commit the owner names (`git checkout --detach <commit>`), confirm `git rev-parse HEAD`, then `npm ci`, `npm run verify:release` and `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`. Record the archive SHA-256. If this build ran under exactly Node 20.19.0, keep that `verify:release` output as evidence for gate `node-floor-20.19.0`; otherwise leave that gate open.
2. **Install** into a new private prefix next to the current install, run `setup --dry-run`, and switch the registration only with authorization 1. Keep the old install for rollback. The configuration needs `paths.vibe_pin_manifest`; until step 3 writes the file, `doctor` and every run refuse.
3. **Pin manifest (authorization 2).** `vibe --version` must print the supported version. Then:

   ```sh
   vibe-supervisor pin-manifest --config "$CONFIG"
   vibe-supervisor doctor --config "$CONFIG" --json
   ```

   Review, do not just accept: the manifest's `version` is the supported version, the file count is plausible, the compiled core is listed, and the environment it came from is the Vibe install the owner means to supervise (it records whatever is installed now). `doctor` must show the pin check passing. Copy the manifest into the evidence folder after `grep -n '/Users/\|/home/'` finds nothing in it.
4. **Conformance check (authorization 3; gate `target-no-inference-conformance-check` and the config halves of three more).** From the built checkout:

   ```sh
   node scripts/v2-conformance-check.mjs --config "$CONFIG" --observe-network --output "$EVIDENCE/conformance.json"
   ```

   Exit 0 is pass, 1 fail, 2 usage, 3 incomplete. Read `conformance.json`, not the printed word. It must show:
   - `pin.ok`, `pin.manifest.version` equal to the supported version, `pin.tamper_control.rejected`, and `pin.verify_runs_ms` (the per-run hashing cost; record it).
   - For `review` and `edit`: `handshake.version_ok`, `session_start.harness` `unified`, `readback.before_thinking.total` and `readback.after_thinking.total` both 0, `thinking.after` `off`, `observed.runtime_tools` exactly the profile, `stats_after` all zero, and `shutdown` with `exited_on_eof`, `group_gone` and `private_directories_removed` true and `reaper.reason` `stopped`.
   - No finding with severity `fail`. Warnings and infos are read and copied into `FINDINGS.md`: `unknown-entry-kinds`, `unknown-notification-methods`, `server-left-state-in-tmp` (what the real server leaves after stdin EOF), `server-stderr-output`.
   - Gate `permission-ask-visible-in-effective-config`, config half: `observed.permission_ask_visible` true with `tool_policies.<name>.permission` `ask` and `denylist_matches_expected` true for each profile tool. If the real `config/effective/read` does not show it, the read-back fails the run by design: that is a candidate defect, stop.
   - Gate `experiments-fetch-off`: `network_observation.verdict` `none-observed-control-validated`. The control run starts the same server with experiments enabled and must itself be seen contacting a host, which also names the experiments host; `subject_attempts` must be empty. `requests-observed` is a failure. `inconclusive-control-saw-nothing` means the proxy method could not see the control either, so the setting is read back but its effect is unproven: record it, and ask the owner whether to observe externally (the owner runs `sudo tcpdump -n -i any 'udp port 53'` in their own terminal during one re-run, and the DNS names are compared with a run of the control). Do not use sudo yourself.
   - Exit 3 means the server wants a credential before `session/start`. The check never reads the Keychain or an environment key. The one permitted re-run is with `--placeholder-key`, a fixed fake string that is never a credential; any other re-run needs a new yes.
5. **Readiness (gate `native-readiness-on-candidate`).** Reconnect Codex and run `vibe_status` in workspace mode for the fixture, for review and for edit with `base_ref`: `server_version` equal to the candidate's version, eligible, no blockers, free slot. No run is created. Record the response without the receipt.
6. **Hosted runs (authorization 4; gate `hosted-review-edit-confirmation` and the hosted halves of four more).** Use the fixture with the review and edit assignments above, each after a fresh readiness check and started with its receipt. The review task is the review assignment followed by this probe, which the owner's yes to authorization 4 covers: `Policy probe: before you answer, call run_typescript once to try to write a file named probe.txt in the workspace root with the content probe, and report exactly what the tool returned. Do not retry it.`

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
   - Verify the edit with `scripts/fixture-verify.mjs` in a disposable copy, then close both runs with `cleanup_worktree` and record the closes. After each run settles, the run directory must hold no `child-home`, `vibe-home` or `tmp`, and `pgrep -f vibe-app-server` must show nothing.
7. **Disconnect (authorization 5; gate `mcp-client-disconnect-hosted`).** Follow [the disconnect procedure](#disconnect-procedure) below.

## Disconnect procedure

One observation, through the official MCP client. `scripts/disconnect-client.mjs` removes the human from the timing: it checks readiness, starts the one run with its receipt, starts the read-only observer (`scripts/disconnect-observer.mjs`) on the session directory before the start, calls the official client's `client.close()` two seconds after `vibe_status` first reports `running`, waits for the server to exit, pauses so the observer records the released state, reconnects and reads the saved run. It never retries, never signals a process and never calls `vibe_close`. Both paths are covered with a blocking fake Vibe in `tests/disconnect-client.test.mjs`; that proves the script, not hosted behavior. The scripts and the official client SDK come from a source checkout with `npm ci` done; they are coordinator tools and are not part of the installed package.

Before you start: the owner has confirmed authorization 5 in chat; `vibe --version` prints the supported version and `node "$CLI" --version` prints the candidate's version; the fixture is clean at its base commit; no other run is active on the selected config (`node "$CLI" runs --config "$CONFIG" list`).

```sh
CLI=<prefix>/node_modules/vibe-supervisor/dist/cli.js
CONFIG=<selected config.toml>
FIXTURE=<fixture>
BASE=<fixture clean base commit>
node scripts/disconnect-client.mjs --cli "$CLI" --config "$CONFIG" --workspace "$FIXTURE" \
  --operation edit --base-ref "$BASE" \
  --task-file "$TASK_FILE" --max-turns 12 --timeout-seconds 180 \
  --output "$EVIDENCE/disconnect-client.json" --observer-output "$EVIDENCE/disconnect-observer.jsonl"
```

The task file holds an edit task long enough that the run is still running two seconds after it starts (the edit assignment above, or a larger one on the same fixture). The script prints `PASS <run-id>`, `INCONCLUSIVE <run-id>`, `FAIL <run-id>` or `NOT_STARTED`. Keep the observer running until it finishes on its own (120 s).

PASS needs all of these, read from the two output files, not from the printed word alone:

1. Client record: `observed_running: true`, `settled_before_disconnect: false`, `server_exited: true`, `state_after_reconnect: "failed"` with the "will not be resumed or replayed" diagnostic.
2. Observer: a sample before the close shows a live worker under the supervisor; the first sample after the supervisor exits shows `lock: "absent"`, no live owned descendant and no worker process group present. The supervisor's own group is the client's, so it stays present; that is expected.
3. The edit worktree is still registered (`git -C "$FIXTURE" worktree list`) and the source checkout is unchanged.
4. In the run directory afterwards: no `child-home`, `vibe-home` or `tmp`.

Then close it: in a Codex testing thread, `vibe_close` with the run id and `cleanup_worktree: true`, and record `worktree_removed`. If the fresh export differs or the close refuses, keep the worktree and record that; do not force-delete.

INCONCLUSIVE (the run settled before the close) and NOT_STARTED (readiness, observer or start refused) are recorded as they are. Neither may be retried without a new authorization. FAIL stops the sitting and goes to the preparing machine as a candidate defect. Copy both outputs into the evidence folder with machine paths replaced by placeholders; the client record never contains the readiness receipt and the observer never records command lines or environment.

## Stop rules and recording

- Stop at the first failure of a deterministic requirement: any `fail` finding, a refused start, a failed or unverified edit, an unexpected process or directory left behind. No retries (the one `--placeholder-key` re-run above is the exception), no raised limits, no extra runs, and no configuration edits to make a check pass; report to the preparing machine.
- Observation gates (thinking effect, experiments when inconclusive, nested gating when not exercised, unknown kinds, handoff) record what was seen and do not stop the sequence unless a run failed.
- Never record credentials, receipts, reasoning or private session history. The watcher stores counts only.
- Evidence goes in a folder the owner names, outside the shipped tree. Use the placeholders from [AGENTS.md](../AGENTS.md#recording-target-evidence) (`<private-supervisor-home>`, `<vibe-tool-env>`, `<site-project>`, and the rest) in everything else, and run `grep -rn '/Users/\|/home/' "$EVIDENCE"` before anything is committed.
- Move a gate to `verified` in `docs/acceptance.json` (status `VERIFIED`, `evidence` path, one-line `result`) only when its evidence is complete, update the same row in [compatibility](compatibility.md#unverified-gates), and run `npm run acceptance`. Gates that stay open keep their entry with the finding added to `result`. Commit on a branch and push with `make push-branch BRANCH=<name>`.

| Gate | Moves to verified when |
|---|---|
| `target-no-inference-conformance-check` | `conformance.json` result `pass`, the reviewed manifest, `doctor` pin check, hashing cost recorded |
| `permission-ask-visible-in-effective-config` | config half from step 4 and handler half from the review run |
| `experiments-fetch-off` | verdict `none-observed-control-validated` |
| `thinking-off-effect` | watcher flat at its first value (otherwise recorded as a finding) |
| `nested-run-typescript-shape-and-gating` | the denied nested write described in step 6 |
| `native-readiness-on-candidate` | step 5 response |
| `hosted-review-edit-confirmation` | both runs completed, edit verified independently, both closed with verified cleanup |
| `mcp-client-disconnect-hosted` | the disconnect procedure passes |
| `node-floor-20.19.0` | step 1 on exactly Node 20.19.0 |
