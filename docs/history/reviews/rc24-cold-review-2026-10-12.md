# rc.24 cold review (2026-10-12)

Read-only review of `vibe-supervisor` 0.9.0-rc.24 (main at 7cbb0ed). Scope: all of `src/`, the Python shim, `skills/vibe-supervisor/SKILL.md`, README and `docs/{reference,functionality,security,compatibility,errors}.md`. Nothing was executed against real Vibe. No tests were run, so this review is static only.

## Findings

### Blocker for 1.0

None in code. I found no path that weakens an AGENTS.md boundary. The allowlist is reread and canonicalised on both sides. Review runs get only `read_file` and `grep`. Edits get a detached worktree under `dataDir/worktrees/<runId>`. Shell and network stay off. HOME and VIBE_HOME are private and the environment is allowlisted. Recovery marks runs failed and never respawns them or signals a saved PID. Removal re-derives the worktree path and re-exports before deleting. The hosted, native and clean-account gates in `docs/compatibility.md` stay open. That is a verification gap, not a code gap.

### Should fix before 1.0

**S1. Tool errors drop `details` and `retryable`. High confidence.** `src/mcp/tools.ts:216-217` turns every thrown error into the text `CODE: message remediation`, and the reply has no `structuredContent`. Readiness blockers also drop details (`src/core/run-manager.ts:414`). The docs promise more: `docs/errors.md:5` says errors carry `details`, `:13` names `details.unavailable_root`, and `docs/reference.md:65` says "`details.reason` names which". Example: a start whose receipt has a stale `base_commit` fails, but the coordinator gets only prose. It cannot branch on `reason`, `boot_drift` or `unavailable_root`. Fix: return the sanitised error object as structured content, or change the docs.

**S2. `VSUP_GIT_REQUIRED` is attached to every Git failure. High confidence.** `src/git/worktree.ts:14` hard-codes the code on `GitOperationError`. That includes timeouts (`:57`), stdout overflow (`:58`) and refused filters (`:87`). At settle the error is treated as coded (`src/core/run-manager.ts:1085`). Example: an edit in a large repository whose `git diff --binary` runs past 30 s or 100 MiB. The worker finished normally, but the run settles `failed` / `VSUP_GIT_REQUIRED` with the remedy "Install Git…" (`src/contracts.ts:233`), and `docs/errors.md` says "git executable is missing". Fix: map these cases to `VSUP_ARTIFACT_ERROR` or `VSUP_OUTPUT_LIMIT`, and keep `VSUP_GIT_REQUIRED` for `missing`.

**S3. The `VSUP_INVALID_STATE` remedy is wrong for most of its uses. High confidence.** The code is raised for preparation-deadline expiry (`src/core/run-manager.ts:1530,1535`), owner-lock contention (`src/core/owner-lock.ts:98-100,207,225`; `src/core/isolated-run-router.ts:99`) and shutdown. All of them get "Check the run status and use an action valid for its current state" (`src/contracts.ts:245`). Example: a readiness check on a slow filesystem passes the 30 s preparation deadline. The blocker then tells the coordinator to inspect a run that does not exist. Fix: give these cases their own code, or override the remediation per case, as `storage-error.ts` already does.

**S4. `allow` and `setup` print a stale restart instruction. High confidence.** `src/cli/setup.ts:30,141` prints "Restart the Codex MCP server to apply the new allowlist…; a running server keeps the list it started with." That contradicts the live-allowlist contract in rc.24 (`docs/reference.md:95`, README step 2). Operators will restart for no reason, and the text undermines the documented authority model. Fix: say that the change applies on the next check or start.

### After 1.0

**A1. Raw stdout is still capped by the transcript limit (old F12, remaining part). Medium confidence.** `src/backends/programmatic.ts:125` sets `maxStdoutBytes` to `max_transcript_bytes`. In `--output streaming` mode, stdout carries every JSON message, including tool results. A review with many reads can fail with `VSUP_OUTPUT_LIMIT` ("exceeded the configured transcript limit", `:129`) while the transcript itself is small.

**A2. Settle can run before the worker is dead on the output-limit and parser-failure paths. Medium-low confidence.** `src/backends/programmatic.ts:127-135` reports `failed` while `terminate()` is still in its SIGTERM grace period (`src/process/managed.ts:67`). Settle then exports the patch and checks review integrity against a worker that may still be writing. A later `cleanup_worktree` refuses with "changed after export". This fails safe, but the saved patch can be stale.

**A3. `closeRun` does not record a requested outcome. Low confidence.** `src/core/run-manager.ts:557-561` sets only `cancelRequested`. `cancel()` uses `requestOutcome` (`:486-487`). If the backend's exit report reaches the serial queue first, a run the user closed records `VSUP_BACKEND_CRASHED`. It can also record `AUTH_REQUIRED` or `RATE_LIMITED`, because classification reads the stderr tail (`programmatic.ts:172`). In practice the close path usually wins, so the window is narrow.

**A4. The turn-limit check rejects any extra stderr line. Low confidence.** `src/backends/programmatic.ts:38-45` accepts only the exact stop line, plus trust warnings when the exit code is 3. The shim's own "no Keychain credential resolved" line (`vibe_supervisor_launcher.py:558`) or any Python warning turns a genuine turn-limit stop into `failed`. This fails closed.

**A5. Doctor does not expand `~/` roots. High confidence, low impact.** `src/diagnostics/doctor.ts:110` calls `realpath(root)` on the raw entry. A valid home-relative root (accepted by `src/config/validation.ts:9`) is reported invalid, and doctor fails.

**A6. Failed runs that are never closed are never pruned. High confidence.** `src/core/run-manager.ts:700` keeps them, which is intentional per older handoffs. `docs/reference.md:81` does not say so.

**A7. A problem in any sibling session blocks the current session. Low confidence.** In isolated routing, one unsafe sibling session directory, or more than 128 entries (`src/core/isolated-run-router.ts:51,56-57`), fails every `run_id` operation. That includes runs in the current session. Session directories are never pruned.

**A8. Receipts can be reused within their TTL. Low confidence.** `src/core/readiness-receipt.ts:69-87` does not consume a receipt on use, while the remedy says "start once". The receipt grants nothing, so this is a wording issue.

**A9. Leftover dead code and stale docs:**
- `BackendRespondInput` (`src/contracts.ts:182-188`) is ACP dead code.
- `pending_request` (`src/mcp/tools.ts:133`) is ACP dead code.
- `VSUP_CANCELLED` is documented (`scripts/errors-doc.mjs:19`) but never emitted.
- The hand-written `ERROR_CODES` (`src/core/serialization.ts:124`) is already missing `VSUP_RESTART_REQUIRED` and `VSUP_READINESS_RECEIPT_INVALID`. This is harmless today, because those codes never reach a run record.

## F7–F15 (1.0-cold-review-2026-10-08) against rc.24

| ID | Status | Evidence |
|---|---|---|
| F7 `respond()` reopens finished run | Gone with ACP | No `respond` path. Only `BackendRespondInput` remains, unused (`src/contracts.ts:182`). |
| F8 deny-option name vs kind | Gone with ACP | `policy-engine.ts` and `acp.ts` were removed. |
| F9 elicitation validator mismatch | Gone with ACP | No elicitation surface. |
| F10 allowlist accepts `/` and `~` | Fixed | `src/config/validation.ts:31-34` → `src/security/paths.ts:33-45` rejects the root, home, home parents and temp directories. |
| F11 worktree created after close is orphaned | Fixed | Close waits for `runtime.starting` (`run-manager.ts:1070`). Launch persists the worktree before it checks for cancel (`:879-883`), and settle exports it. Shutdown drains starts under the lock (`:728-736`). |
| F12 stdout capped by transcript limit | Still open (programmatic only) | `src/backends/programmatic.ts:125,129`. The ACP half is gone. |
| F13 shutdown has no deadline | Fixed (by design, with one exception) | `src/core/run-manager.ts:711-744` (10 s drain, bounded terminate, 180 s start drain) and `src/cli.ts:51`. The process stays alive on purpose only while worker termination is unverified. |
| F14 unused `@modelcontextprotocol/node` | Fixed | `package.json` dependencies are `server`, `smol-toml` and `zod`. |
| F15 cleanup trusts saved path | Fixed | `src/core/run-manager.ts:1249-1251` and `src/git/worktree.ts:202` require the derived path. Related: `serialization.ts:124` still hand-copies the code list (A9). |

## Verdict

rc.24 is fit for the hosted matrix: no blocker, and no boundary weakened. S1 to S4 are small, so fix them before freezing the artifact. Hosted evidence binds to the exact build, so changing the code after the matrix would mean rerunning it.
