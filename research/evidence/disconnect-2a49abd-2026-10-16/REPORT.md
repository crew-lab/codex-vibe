# Hosted disconnect acceptance — 2026-10-16

**PASS on the exact installed reporting-repair candidate.** The official MCP client disconnected while its one bounded edit was running. Server, worker group, owner lock and private runtime directories were released. Reconnect read the saved run as failed with an explicit no-replay diagnostic. Native close later succeeded and removed the clean worktree. The original allowance is exhausted: three starts used, no extras or retries.

## Bound build and assignment

Source `2a49abdb0fda49aada8ea4724361d64c46664c92`, archive SHA-256 `133e77bdf20fc1cc839d3f0e5bfcdc644aa5ec09e4eb02558fb43cd1b8d191a8`, candidate SHA-256 `1c3c135862e2fe888428a2bf67fc6cd02fe9852259a494e7d624e2a3e96a45c0`. Node 20.19.0, Vibe 2.26.1, macOS arm64. Native expected-candidate readiness passed before dispatch. Public synthetic fixture was clean at `c8c255cbb838b541b11d01983551a84d945ca457`.

This was a distinct interruption task (classification module and tests), not a retry or repair of the rejected atLeast edit. Limits stayed 12 turns/180 seconds. The committed official disconnect-client/observer scripts were used unchanged. They sent one start, called client.close() two seconds after running was observed, reconnected only to read the saved result, and never manually signaled a process or replayed a task.

## Independent evidence checks

- Client observed running; task had not settled before disconnect; server exited. Saved state after reconnect was failed, code VSUP_BACKEND_CRASHED, with the explicit statement that the task will not be resumed or replayed. Expected failed execution is the successful disconnect outcome, not a second worker acceptance rejection.
- The read-only observer completed its full 120-second window with 479 samples. A live worker identified by persisted process PID/start identity was observed under the owning supervisor while the run was running before close.
- The first sample after supervisor exit shows lock absent, zero live owned descendants and no worker process groups present. The supervisor/client group persisted as expected and was excluded from worker-group checks. No arguments, environment or lock token were collected.
- The edit worktree remained registered after interruption, source fixture stayed clean, and run-private tmp, child-home and vibe-home directories were absent.
- A native saved-run read initially returned VSUP_OWNER_LOCKED because another live Supervisor had claimed that sibling session. Its lock later released externally. No lock bypass, process termination or repeated hosted work was used. After checking fresh lock absence, native vibe_close with cleanup_worktree succeeded; worktree_removed=true and the worktree is no longer registered. Final saved state is closed with execution_state failed.

## Reporting and usage

The standard run export is preserved in run/: failed execution remains separate from closed lifecycle, and startup/finish times remain recorded. No acceptance contract was requested for this interruption task and no generated patch was accepted or applied. Its exported diff is empty.

Recorded duration: 4,103 ms total; 1,757 ms startup and 2,339 ms execution/finalization. Inference-only duration and turn count unavailable. Runtime alias mistral-medium-3.5, reported name mistral-vibe-cli-latest, thinking off; provider and underlying weights unavailable. Runtime reports 6,937 prompt tokens, 28 completion tokens, zero cached tokens and one model call. Estimated cost USD 0.0106155 is not an authoritative bill.

## Scope of the result

This closes the disconnect observation for this identified build only. It does not accept the previously rejected review or edit, certify hidden reasoning-generation behavior or prove fresh-account installation. Hosted review/edit confirmation remains unverified. No allowance remains; any further hosted run needs new authorization. No merge, publication, deployment or automatic integration occurred.

CLIENT.sanitized.json and OBSERVER.sanitized.jsonl are sanitized copies; CHECKS.json records hashes of the private raw originals. Private receipts, credentials, reasoning content and raw transcripts are excluded. The standard export's SHA256SUMS remains unchanged; PACKET-SHA256SUMS covers the complete packet. No machine paths were committed.
