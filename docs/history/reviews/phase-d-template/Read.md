# Phase D target-machine evidence (template)

Copy this directory to `docs/history/reviews/rc7-target-test-<YYYY-MM-DD>/` before the session and fill it in there; keep this template unchanged. The steps, expectations and ground rules are in the [Phase D test plan](../../../../Handoff.md#phase-d-test-plan-rc6). Record facts only: exact commands, versions, run IDs, timings and outcomes. Never paste credentials or task text that contains anything sensitive; `security` is only ever called without `-w`.

Put raw evidence (redacted tool replies, `doctor --json`, timing logs, the soak `summary.json` and `runs.ndjson`) next to this file and reference it in the Evidence column by file name.

## Environment (D0)

| Item | Value |
|---|---|
| Date and operator | |
| macOS version and architecture | |
| Node and npm | |
| Git | |
| `vibe --version` and the Vibe Python path | |
| Codex CLI version / Codex desktop version | |
| Release tarball and its sha256 | |
| Source checkout commit (for D4 and D18) | |
| Throwaway workspace path and how it was prepared | |
| Model used by hosted runs (from the run's private session records) | |

## Steps

Result is PASS, FAIL, SKIP (with the reason) or PARTIAL (with what was and was not shown).

| ID | Step (short) | Result | Run IDs | Timing | Evidence | Notes |
|---|---|---|---|---|---|---|
| D0 | Environment recorded | | | | | |
| D1 | Install from the tarball, `--version` | | | | | |
| D2 | `setup` without and with `--yes`, rerun, `doctor --json` | | | | | |
| D3 | Tool list: five for programmatic, seven for `acp` | | | | | |
| D4 | `compat:probe` and the manual resolver check | | | | | |
| D5 | Review loop: start, status, close; cold and warm | | | | | |
| D6 | No task text in argv; artifacts and event count | | | | | |
| D7 | Integrity: real change vs touch; snapshot time | | | | | |
| D8 | Edit with ten or more new files, close with cleanup | | | | | |
| D9 | ACP continuation | | | | | |
| D10 | ACP `vibe_close` mid-turn | | | | | |
| D11 | Restart after a completed and during a running run | | | | | |
| D12 | Idle expiry with `worker_idle_ttl_seconds = 60` | | | | | |
| D13 | Policy probes: outside read, `.env`, review write, `allow_shell` | | | | | |
| D14 | `--isolated` with desktop and CLI, restart adoption | | | | | |
| D15 | Second shared client refused; missing executable label | | | | | |
| D16 | R1 (what the model sees), R2 (`wait_seconds: 300`) | | | | | |
| D17 | Measurements P2 to P4 | | | | | |
| D18 | Hosted soak, 100 runs | | | | | |
| D19 | Unified harness (optional, not a 1.0 criterion) | | | | | |
| D20 | Clean account (required), Intel (if available) | | | | | |

## Measurements

| Measure | Preparing machine (fake backends) | Target machine |
|---|---|---|
| P1 time to first event, programmatic cold / warm | not measurable there | |
| P1 time to `completed`, programmatic cold / warm | not measurable there | |
| P1 time to first event and to `completed`, ACP cold / warm | not measurable there | |
| P2 availability probe (`time vibe-supervisor doctor`) | not measurable there | |
| P3 `import vibe` total (`python -X importtime`) | not measurable there | |
| P3 `security find-generic-password` lookup (no `-w`) | not measurable there | |
| P4 events per review / edit / ACP continuation | not measurable there | |
| Review snapshot on the large `node_modules/` tree | 2.6 s per pass on 156,169 files | |
| Patch export with ten or more new files | 0.13 s with 50 new files | |

## Soak (D18)

Command used (without credentials):

```text

```

| Criterion from `summary.json` | Result |
|---|---|
| Zero unexpected failures | |
| Zero permission requests | |
| No leaked processes or worktrees | |
| Bounded artifacts | |
| Retention keeps recent runs | |

| Figure | Value |
|---|---|
| Runs by kind and backend | |
| Time to first event p50 / p95 | |
| Time to settled p50 / p95 | |
| Failures by code | |
| Restart outcomes (reloaded / error code / not exercised) | |
| Reported cost (non-authoritative) | |

## Outcome

- Gates newly verified (copy into `docs/compatibility.md` "Unverified gates" and `docs/acceptance.json` only with the evidence above):
- Failures and the first failing step:
- What remains uncertain:
- Recommendation (rc.8 with fixes, or 1.0):
