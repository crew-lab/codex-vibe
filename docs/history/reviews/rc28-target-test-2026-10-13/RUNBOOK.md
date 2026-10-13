# Frozen rc.28 acceptance execution

The user approved the exact seven-case budget on 2026-10-13. Five cases have passed; two disconnect cases remain. No retries, limit raises or hidden extra runs. All seven use the frozen fixture in assignments.json. Existing real Garnebo review is separate evidence.

1. Verify archive SHA256 and installed-file identity. Capture current fixture HEAD, tracked-file hashes and clean status. Require frozen c83c01e4c5987fbe0e18afcfcccfea2d0a3a3e00 and original two files. Do not modify that fixture.
2. Native readiness: require rc.28, intended policy, eligible, empty blockers, free slot and no restart required; use a fresh matching receipt on the same connection. Never preserve receipt bodies in durable reports.
3. Execute cases sequentially. Stop on first unexpected failure. A legitimate early completion in a limit case is NOT DEMONSTRATED; a finished-before-disconnect case is INCONCLUSIVE and consumes the run allowance. Neither may be silently retried.
4. Reviews: verify named cases and untouched input hashes. Edits: preserve full filtered result and fresh patch; inspect paths and residuals. Export/apply only into a disposable verification copy. Run scripts/v1-fixture-verify.mjs against that copy and node --test tests/at-least.test.mjs there. Never test in the worker worktree, original fixture or site checkout.
5. Close each settled run after verification. Cleanup only with current verified export; retained dirty/uncertain worktree is an explicit result. Termination-unverified blocks the slot and next case.
6. Disconnect cases require an independent external observer BEFORE start, run ID and ownership/process-group evidence, then native status proving running. Desktop: user must be ready to quit Codex immediately while the run is active. Official client: close only the owning test-client transport while its own run is active. Do not kill arbitrary persisted PIDs, delay the worker artificially or replay it. Record actual termination timestamps, process-group disappearance and lock release, reconnect and inspect the saved run. A normal completed run cannot be counted as a disconnect test.
7. Save redacted request, instance/session/policy identity, run ID, start/settle/close timestamps, stop reason, warnings, integrity, patch/input/output hashes, independently checked outcomes, cleanup and missing usage as UNKNOWN.

The observer is a required execution prerequisite, not yet a proved lifecycle result. Confirm its independence and process ownership before spending that case's credit. Complete lifecycle observer setup after hosted budget authorization and before its run; no hosted call may be used simply to troubleshoot observer setup.

## Final release identity

Keep rc.28 unchanged through acceptance. Version/docs changes for v1.0 create different bytes. Test the final archive on the required exact-artifact contract; do not transfer hosted PASS to new bytes automatically. An owner-approved runtime-equivalence waiver must be explicit if that approach is selected. No waiver is assumed here. Packaging, native check, source/tag/artifact checks, publish authorization and rollback verification remain separate gates.
