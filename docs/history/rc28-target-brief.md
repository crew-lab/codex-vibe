# Brief for the target-machine sitting (rc.28 → 1.0.0)

One page for the agent or person on the target Mac. The detailed steps are in the [rc.28 runbook](rc28-target-runbook.md); this says what to do, in what order, and when to stop.

## Goal

Produce the four pieces of evidence 1.0.0 needs, on the exact rc.28 artifact, in one sitting:

1. **Native readiness** on the Codex desktop connection.
2. **Five hosted runs**, each started with a readiness receipt.
3. **One real active disconnect.**
4. **Provider authentication**, which the first hosted run records.

Nothing else is a 1.0 gate. The clean-account install is 1.0.1; the live-allowlist and restart observations are optional.

## Before you start

- Get the owner's explicit yes, in chat, for three separate things: installing rc.28 and switching the Codex registration; the hosted budget; and Garnebo, if it is used at all.
- Confirm `vibe --version` prints 2.26.1. Anything else: stop.
- Get the artifact: the `v0.9.0-rc.28` GitHub prerelease if it exists, otherwise `release/0.9.0-rc.28/` copied from the preparing machine. Run `shasum -a 256 -c SHA256SUMS`; the tarball's sha256 is `61ca4ee91067e2bbf8a7dbf2f14baf3f3667a661c8c587d4fd9b02323fe7e6cd`.
- Set the selected `config.toml` to mode 0600; rc.24 and later refuse a group- or world-writable config.

## Order

1. **Install** rc.28 next to rc.23 and switch the registration (runbook B). Keep rc.23 for rollback.
2. **Reconnect** Codex desktop (quit and reopen) and open a new testing thread. Confirm exactly five tools.
3. **Readiness** (runbook C1): `vibe_status` with `workspace` and `operation` for the fixture (review, and edit with `base_ref`). Expect `server_version` `0.9.0-rc.28`, `eligible: true`, no blockers, a `readiness_receipt`. No inference is spent.
4. **Five hosted runs** on the fixture, in this order, each after a fresh readiness check and started with its receipt:
   1. a review;
   2. an edit;
   3. a review with a low `max_turns` so it stops at the turn limit;
   4. an edit with a low `max_turns` so it stops at the turn limit;
   5. a review.

   For each: record the run ID, state, `stop_reason`, timings and warnings. For edits, apply the patch in a separate scratch clone and check it, then `vibe_close` with `cleanup_worktree: true` and record `worktree_removed`. A turn-limit run must end `completed` with `stop_reason: max_turn_requests` and the incomplete-result warning, not as a crash.
5. **Active disconnect** (runbook D): start a sixth run, or reuse run 5 while it is still running. Quit Codex while the worker is active. Reopen it. Expect: no Vibe or supervisor process left, the lock released, and the run `failed` and never relaunched. If it was an edit, its worktree is kept until `vibe_close` cleans it.
6. **Garnebo**, only if separately authorized: readiness, then one narrow review.

## Stop rules

- Stop at the first failure and record it. No retry, no raised limits, no other account, no Luna substitution.
- A missing tool is CONNECTION_FAILED and a readiness blocker is PREPARATION_FAILED. Neither is a Vibe result; fix the connection or configuration and check readiness again.
- Never record credentials or private session histories. `security` only without `-w`.
- Do not change code. Any code change means a new candidate built on the preparing machine and all five runs again.

## Recording

- Raw evidence goes in `docs/history/reviews/rc28-target-test-<date>/`, started from the [template](reviews/phase-d-template/Read.md): redacted tool replies, run IDs, timings, hashes, cleanup checks.
- Add a dated rc.28 section to [acceptance.md](acceptance.md) that links the evidence folder.
- On branch **`claude/v1.0.0`** (it is on GitHub), replace every `[EVIDENCE: …]` placeholder in `README.md`, `CHANGELOG.md`, `docs/compatibility.md` and `docs/acceptance.json` with what was observed. Commit on that branch only. Push it with `make push-branch BRANCH=claude/v1.0.0`.
- If anything failed, leave the placeholders, record the failure in the evidence folder and in the Handoff on main, and stop. The owner decides the next candidate.

## After a clean sitting

On the preparing machine: `verify:release` and `package:rc` on `claude/v1.0.0`, merge it into main, `make push`, then tag `v1.0.0` and publish the release with the owner's authorization.
