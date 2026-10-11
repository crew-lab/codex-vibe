# One-shot lifecycle acceptance

This candidate has no run recovery. The suite verifies persisted interrupted records remain readable and become failed after startup, with no worker/session load, task replay, permission restoration, or saved-PID signaling. Historical ACP lifecycle reports are retained under `docs/history/` and are not acceptance evidence for the reduced runtime.

Before hosted acceptance, verify these local lifecycle invariants:

- Concurrent starts reserve one instance slot before preparation: exactly one launches and the other receives a capacity error without a queued record or second worker.
- Settlement releases the worker and slot once. A late process exit or callback cannot replace settled state.
- Close, timeout, shutdown, and start/creation races account for every supervisor-owned process and worktree; no unreported resource remains.
- Worktree ownership is derived from the run identity and validated source/base/Git registration. A swapped path or stale export is retained safely.
- A current patch export is always preserved for review. Cleanup removes only a verified pristine, supervisor-owned worktree. Dirty or uncertain worktrees remain with an explicit path and reason; cleanup never force-removes concurrent or residual files.
- Storage faults during settlement leave a truthful readable failure or explicit retained-resource receipt.
- Deadline, no-progress, output overflow, provider/authentication failure, and cancellation produce bounded and truthful outcomes.

Then package one frozen candidate. Hosted acceptance, if separately authorized, is five total runs: one bounded review, one bounded edit, then three additional sequential review or edit runs. Stop after the first failure; do not retry automatically or raise budgets. Independently review each edit patch and verify original-source invariants and cleanup/retention receipts. Native client and clean-account checks are separate gates in [compatibility](compatibility.md#unverified-gates).
