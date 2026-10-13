# Brief: the official-client active disconnect (case 7, rc.28)

One page for the agent on the target Mac. It produces the last 1.0 gate, `active-disconnect-hosted`, under the owner's recommended decision of one observation, official client. It spends the one hosted run still authorized on 2026-10-13 (case 7 in [assignments.json](reviews/rc28-target-test-2026-10-13/assignments.json)) and nothing else. Procedure background: [rc.28 runbook](rc28-target-runbook.md) section D.

## Why it is scripted now

Case 6 was INCONCLUSIVE because the edit reached `end_turn` before a person could quit Codex. [`scripts/v1-disconnect-client.mjs`](../../scripts/v1-disconnect-client.mjs) removes the human from the timing: it checks readiness, starts the one run with its receipt, starts the read-only [disconnect observer](../../scripts/v1-disconnect-observer.mjs) on the session directory before the start, calls the official client's `client.close()` two seconds after `vibe_status` first reports `running`, waits for the server to exit, pauses so the observer records the released state, reconnects and reads the saved run. It never retries, never signals a process and never calls `vibe_close`. Both paths are covered with a blocking fake Vibe in `tests/v1-disconnect-client.test.mjs`; that proves the script, not hosted behaviour.

## Before you start

- The owner confirms in chat that case 7 is still authorized. Nothing else is.
- `vibe --version` prints 2.26.1. The rc.28 install is the one from the sitting (archive `9179a091…`); `node "$CLI" --version` prints `0.9.0-rc.28`.
- The fixture is clean at `c83c01e4c5987fbe0e18afcfcccfea2d0a3a3e00` with its original two files.
- A checkout of this repository at main, with `npm ci` done, supplies the two scripts and the official client SDK. They are coordinator tools and are not part of the installed package.
- No other run is active on the selected config (`node "$CLI" runs --config "$CONFIG" list`).

## Run

```sh
CLI=<rc28-prefix>/node_modules/vibe-supervisor/dist/cli.js
CONFIG=<selected config.toml>
FIXTURE=<fixture>
OUT=docs/history/reviews/rc28-target-test-2026-10-13
jq -r '.cases[] | select(.case == 7) | .task' "$OUT/assignments.json" > /tmp/case-7-task.txt
node scripts/v1-disconnect-client.mjs --cli "$CLI" --config "$CONFIG" --workspace "$FIXTURE" \
  --operation edit --base-ref c83c01e4c5987fbe0e18afcfcccfea2d0a3a3e00 \
  --task-file /tmp/case-7-task.txt --max-turns 12 --timeout-seconds 180 \
  --output /tmp/case-7-client.json --observer-output /tmp/case-7-observer.jsonl
```

It prints `PASS <run-id>`, `INCONCLUSIVE <run-id>`, `FAIL <run-id>` or `NOT_STARTED`. Keep the observer running until it finishes on its own (120 s).

## What counts

PASS needs all of these, read from the two output files, not from the printed word alone:

1. Client record: `observed_running: true`, `settled_before_disconnect: false`, `server_exited: true`, `state_after_reconnect: "failed"` with the "will not be resumed or replayed" diagnostic.
2. Observer: a sample before the close shows a live worker under the supervisor; the first sample after the supervisor exits shows `lock: "absent"`, no live owned descendant and no worker process group present. The supervisor's own group is the client's, so it stays present; that is expected.
3. The edit worktree is still registered (`git -C "$FIXTURE" worktree list`) and the source checkout is unchanged.

Then close it: in a Codex testing thread, `vibe_close` with the run id and `cleanup_worktree: true`, and record `worktree_removed`. If the fresh export differs or the close refuses, keep the worktree and record that; do not force-delete.

INCONCLUSIVE (the run settled before the close) and NOT_STARTED (readiness, observer or start refused) are recorded as they are. Neither may be retried without a new authorization. FAIL stops the 1.0 path and goes to the preparing machine as a new candidate question.

## Recording

- Copy both outputs into the evidence folder as `matrix-7-client.json` and `matrix-7-observer.jsonl`, with machine paths replaced by the same placeholders as the other records. The client record never contains the readiness receipt; the observer never records command lines or environment.
- Add the case 7 outcome to `STATUS.md` and `target-acceptance.json`, and a line to [acceptance.md](acceptance.md).
- In `docs/acceptance.json` on main, move `active-disconnect-hosted` to verified with the evidence path only on PASS. Usage stays UNKNOWN.
- Commit on a branch and push it with `make push-branch BRANCH=<name>`; the preparing machine merges.
