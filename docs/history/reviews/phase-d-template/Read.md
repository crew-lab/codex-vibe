# rc.28 target-machine evidence (template)

Copy this directory to `docs/history/reviews/rc28-target-test-<YYYY-MM-DD>/` before the session and fill it in there; keep this template unchanged. The procedure, expectations and stop rules are in the [rc.28 target runbook](../../rc28-target-runbook.md). Record facts only: exact commands, versions, run IDs, timings and outcomes. Never paste credentials or task text that contains anything sensitive; `security` is only ever called without `-w`. Keep earlier failures next to later passes.

Put raw evidence (redacted tool replies, `doctor --json`, config hashes, timing logs) next to this file and reference it in the Evidence column by file name.

## Environment

| Item | Value |
|---|---|
| Date and operator | |
| macOS version and architecture | |
| Node and npm | |
| Git | |
| `vibe --version` and the Vibe Python path | |
| Codex desktop version | |
| Release tarball and its sha256 (expected `55154e83...3a80`) | |
| `shasum -a 256 -c SHA256SUMS` result | |
| rc.28 prefix, selected config path and its mode | |
| Codex config hash before and after registration | |
| Fixture path, `base_ref` and its commit | |
| Authorizations given (install, hosted spend and budget, clean account) | |

## Gates

Result is PASS, FAIL, SKIP (with the reason) or PARTIAL (with what was and was not shown). Gate names match `docs/acceptance.json`.

| Gate | Runbook | Result | Run IDs | Timing | Evidence | Notes |
|---|---|---|---|---|---|---|
| install-and-registration (checksum, doctor, dry run, rollback tested) | B | | | | | |
| native-readiness-on-candidate (fixture review and edit, Garnebo) | C1 | | | | | |
| live-allowlist-change-without-restart | C2 | | | | | |
| boot-key-change-restart-required | C3 | | | | | |
| hosted-review-edit-matrix (5 runs, each with a receipt) | D | | | | | |
| active-disconnect-hosted | D | | | | | |
| provider-authentication-for-this-candidate | D | | | | | |
| garnebo-review (optional, separately authorized) | D | | | | | |
| clean-account-install | E | | | | | |
| node-floor-20.19.0 (local or CI run) | F | | | | | |

## Readiness replies (C)

| Check | `server_version` | `server_instance_id` | `policy_revision` | `restart_required` | `eligible` | Blockers | Receipt issued |
|---|---|---|---|---|---|---|---|
| Fixture review | | | | | | | |
| Fixture edit (`base_ref`, `base_commit`) | | | | | | | |
| Garnebo review | | | | | | | |
| Root removed (no Codex restart) | | | | | | | |
| Root restored | | | | | | | |
| Boot key changed | | | | | | | |
| Boot key restored | | | | | | | |

## Hosted matrix (D)

| # | Operation | Receipt used | Run ID | `stop_reason` | State | Start to settled | Integrity / patch review | Cleanup |
|---|---|---|---|---|---|---|---|---|
| 1 review | | | | | | | | |
| 2 edit | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |

| Active disconnect | Value |
|---|---|
| Method (desktop quit or official client close) | |
| Run was still running at disconnect (status evidence) | |
| Server exited; worker process group gone; owner lock released | |
| Run state after next start; not relaunched | |
| Worktree kept until `vibe_close` cleanup, cleanup result | |

Usage and reported cost (non-authoritative):

## Outcome

- Gates newly verified (copy into `docs/compatibility.md` "Unverified gates" and `docs/acceptance.json` only with the evidence above):
- Failures and the first failing step:
- What remains uncertain:
- Recommendation:
