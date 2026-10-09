# Implementation handoff

Status as of **2026-10-09**: release candidate `vibe-supervisor@0.9.0-rc.17` on main. Private, unpublished, ESM, MIT (`Copyright (c) 2026 crew-lab`). Not a production 1.0 certification. Repository: GitHub `crew-lab/codex-vibe`. Earlier handoffs and all dated evidence are in [docs/history/](docs/history/); the last long-form handoff is [the rc.15 snapshot](docs/history/handoff-rc15-2026-10-09.md).

The [v1.0 stable development strategy](docs/v1-stable-strategy.md) consolidates adoption evidence, delivery priorities and acceptance criteria. Execute exact installation/connection checks and bounded desktop review/edit acceptance before the full soak; keep the release gates below.

The [latest UARoute S5 adoption reconciliation](docs/history/reviews/uaroute-s5-adoption-update-2026-10-09.md) confirms another native rc.12 connection under an expected rc.15 install and a review defect missed by Vibe but caught by Luna. The next review must verify usefulness against an independent oracle, as well as lifecycle and exact runtime identity; do not rerun the completed S5 review for a new version label.

## What this is

A local MCP stdio server that lets Codex delegate bounded code reviews and isolated edits to Mistral Vibe 2.25.8. Codex sees five tools (`vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, `vibe_close`) with the default `programmatic` backend, and seven (adding `vibe_continue`, `vibe_respond`) with `acp`. Reviews may only read and search an allowlisted workspace; edits run in a supervisor-created detached Git worktree and are exported as a patch, never applied, committed or pushed. Shell and network tools are off. This is an application policy boundary, not an OS sandbox.

| Area | Code |
| --- | --- |
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, queue, deadlines, watchdog, retention, recovery, owner lock | `src/core/` (`run-manager.ts` is the centre) |
| Vibe adapters and the pinned launcher (private homes, filtered environment and tools, persistence shim) | `src/backends/`, `src/backends/runtime/vibe_supervisor_launcher.py` |
| Worktrees, patch export, verified cleanup | `src/git/worktree.ts` |
| Paths, private files, child environment, redaction, patch credential check | `src/security/` |
| Configuration and `--isolated` homes | `src/config/` |
| CLI: `setup` (`--dry-run`), `allow`, `doctor`, `serve`, `runs list/show/tail/cleanup` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release, soak and coordinator scripts (not shipped) | `scripts/` ([scripts/README.md](scripts/README.md)) |
| Coordinator skills (shipped) | `skills/vibe-supervisor`, `skills/vibe-acp` |

Behaviour is specified in [docs/functionality.md](docs/functionality.md), the interface in [docs/reference.md](docs/reference.md), the boundary in [docs/security.md](docs/security.md), Vibe assumptions in [docs/compatibility.md](docs/compatibility.md), error codes in [docs/errors.md](docs/errors.md) (generated), decisions in ADRs [0002](docs/adr/0002-protocol-security-boundary.md) and [0003](docs/adr/0003-vibe-launcher.md). AGENTS.md lists the boundaries that must not change.

## Where it stands

The goal for 1.0 is a supervisor that works stably, so new surface waits until the remaining gates pass. Historical sessions provide version-bound evidence for policy refusals, exports and cleanup; they also record reporting defects, driver failures, incomplete model results and a premature coordinator close. Do not generalize those observations into a current-build stability pass. One silent 15-minute stall is unexplained; the progress watchdog (600 s) is designed to end such a run with `VSUP_NO_PROGRESS`, before Vibe's own 720 s read timeout ([analysis](docs/history/reviews/vibe-2.25.8-silent-stall-analysis-2026-10-08.md)). This does not establish the original stall's cause.

Hosted evidence below comes from the target machine on macOS arm64 through the official MCP client and synthetic repositories. Native desktop evidence exists for the older patched rc.2 scope in [compatibility](docs/compatibility.md#unverified-gates); current-build desktop coverage remains unverified.

| Version | Passed | Failed or open |
| --- | --- | --- |
| rc.8 ([results](docs/history/handoff-rc15-2026-10-09.md#phase-d-results)) | D2 to D5, D15, D21 (four-file fixture, three controlled runs), D22 to D24 through the official client | D1 install (fixed), D18 soak attempts 3 and 4 (driver deadline, then a model-side turn cap; both followed up) |
| rc.13 ([evaluation](docs/history/reviews/rc13-worker-adoption-2026-10-09.md)) | Prepared ACP edit, same-session correction, fresh export, verified cleanup | The narrow product run needed a coordinator correction: product gate PARTIAL |
| rc.14, local "rc.15" | Offline release verification, fresh seven-tool MCP check | No hosted inference |

Changes since rc.10 have automated coverage; their hosted verification is limited to the version-bound scopes above:

- **rc.11 to rc.14** (target machine): a real project `.agents` directory is accepted while pinned Vibe project discovery is disabled; run records carry the creating supervisor version.
- **rc.15**: no `backend = "auto"` or probe cache; the CLI is five commands; reviewed-baseline preparation and the edit audit became scripts.
- **rc.16**: settings keys from before rc.6 and the unused options `limits.mcp_result_format`, `max_queued_runs` (fixed at 8), `retention.preserve_failed_runs` and `paths.data_dir` are rejected like any unknown key.
- **rc.17**: retention sweeps run directories whose record cannot be loaded (only a missing or non-JSON record is deleted, never one that still owns a worktree); shutdown on disconnect has a 10 s deadline, then terminates the supervisor's own worker process groups and releases the owner lock; an undeliverable automatic policy denial resolves the ACP permission request instead of hanging the turn; both skills carry the target machine's verification guidance ([receipt](docs/history/reviews/rc15-skills-refresh-2026-10-09.md)).

The target machine's historical "rc.15" was built from rc.14 plus the skills; it is not main's rc.15 and still has `auto` and removed CLI commands. It is retained. On 2026-10-09 the target installed an offline rc.17 rebuild from ac81280, migrated obsolete settings without changing its ACP backend, five roots or declared limits, and linked the refreshed skills. A fresh official MCP client confirmed rc.17 and seven tools. The subsequent [native desktop preflight](docs/history/reviews/rc17-desktop-preflight-2026-10-09.md) created a read-only run whose creator was still **rc.12** despite the correct rc17 registration; it was closed and execution stopped before editing. A complete desktop restart and fresh connection are the next prerequisite. Native rc.17 hosted acceptance remains unverified. See the [exact installation receipt](docs/history/reviews/rc17-local-installation-2026-10-09.md); its archive hash differs from the preparing-machine artifact below.

Upgrading any other install to rc.17: `backend = "auto"` becomes `programmatic` or `acp`; anything that called `init`, `configure-codex` or `test-acp` calls `setup` or `doctor`; a configuration that still sets a removed key fails validation, and `vibe-supervisor doctor` names the key.

## What 1.0 still needs

| # | Priority | Item | Who |
|---|---|---|---|
| 1 | P0 | Identify the exact rc.17 artifact, migrate removed settings and verify installation, skills and the actual desktop connection (D0 to D4) | Target machine; a fresh official-client check is separate from desktop proof |
| 2 | P0 | Re-triage cold-review F7 to F15 against current source; fix reproduced boundary/lifecycle blockers before hosted acceptance | Preparing maintainer; rc.17's F13 remedy still needs target evidence |
| 3 | P0 | Bounded desktop review and complete D25 acceptance, then remaining D5 to D17 and D21 to D24; include native D14, D16, D22 | Target machine, a person at the keyboard for desktop steps |
| 4 | P0 | D18 hosted soak after readiness: two pilot reviews, then 60 reviews, 30 edits, 10 ACP runs | Target machine; provisional estimate about 2 hours, USD 2 to 4, to calibrate from pilots rather than treat as an allowance |
| 5 | P0 | D20 install on a clean macOS user account | Target machine |
| 6 | P0 | Review and push the release workflow (local branch `claude/release-workflow`; push permissions required); authorize `v1.0.0` only after gates pass, then check Release assets | User and preparing maintainer |
| 7 | P1, decision | Intel: test on an Intel Mac, or state Apple silicon only | User |
| 8 | P1, decision | Permission and elicitation callbacks cannot be triggered naturally with this profile: keep as a gate or document as a 1.0 limit, retaining fail-closed regression coverage | User |
| 9 | P1, decision | Stay on Vibe 2.25.8 for 1.0 ([2.26.0 comparison](docs/history/reviews/vibe-2.26.0-source-diff-2026-10-08.md)) | User |

Exit criteria for 1.0: D0 to D18 and D21 to D25 pass on rc.17 or later; D20 passes at least on a clean account; the release workflow's first tagged run produces the assets. D19 is optional (1.0 supports the legacy harness only). The plugin scaffold (`.mcp.json`, `.codex-plugin/`) is not packaged and is out of scope.

## Phase D test plan (rc.17)

Ground rules:

- **Machine:** the target Mac with Vibe 2.25.8 (`uv tool install mistral-vibe==2.25.8`) and browser login done once with `vibe`. Confirm `vibe --version` prints 2.25.8 before each session; a newer Vibe fails every run with `VSUP_VIBE_VERSION_UNSUPPORTED`. Install rc.17 from `release/0.9.0-rc.17/` after `shasum -a 256 -c SHA256SUMS`.
- **Workspace:** a throwaway Git repository with no secrets: nested source files, a root `.env` with a fake value, an ignored `node_modules/`, and one file outside the repository to try to read.
- **Cost and consent:** hosted steps send the repository and tasks to Mistral and are billed; run them only with the owner's authorization. Do not raise limits, rotate accounts or retry automatically.
- **Stop rule:** stop at the first failing step, record it, never weaken policy to get past it (no `always` fallback, shell, network, project trust or edited agent profiles).
- **Recording:** one dated section per session in [docs/history/acceptance.md](docs/history/acceptance.md), raw redacted evidence in `docs/history/reviews/<version>-target-test-<date>/`, started from the [evidence template](docs/history/reviews/phase-d-template/Read.md). Exact commands, versions, run IDs, timings, PASS or FAIL, and what stays uncertain. Never record credentials; `security` is only called without `-w`. Keep earlier failures; each soak attempt is a new attempt.

**Install and setup**

| ID | Step | Expected |
|---|---|---|
| D0 | Record macOS version and arch, Node, npm, Git, `vibe --version`, the Vibe Python path, Codex CLI and desktop versions, the rc.17 tarball sha256. | All recorded. |
| D1 | `npm install -g ./vibe-supervisor-0.9.0-rc.17.tgz` (or `--prefix` into a private prefix); run the installed `vibe-supervisor --version` directly. | Prints `0.9.0-rc.17`. |
| D2 | `vibe-supervisor setup --workspace <repo> --dry-run`, then without `--yes`, then with `--yes`; then `vibe-supervisor doctor --json`. | Dry run and the plan write nothing to `~/.codex`; `--yes` writes it, keeps a `.bak` of an existing config, prints the restart note; `[paths]` holds absolute `vibe` and `vibe-acp`; doctor has no required failure. A further `setup` changes nothing. |
| D3 | Restart Codex desktop, new chat, list the supervisor tools; set `backend = "acp"`, restart, list again. | Five tools, then seven; no `vibe_cancel`; descriptions mention `wait_seconds`, `stop_reason` and closing. |
| D4 | From a source checkout of `Cut 0.9.0-rc.17`: `npm run compat:probe -- --out <file>`; the manual `tool_path_resolver` check for a nested file, root `.env`, an outside path and a symlink to outside, in review and edit mode. | Probe checks PASS; nested in-root files ALWAYS, the others NEVER. |

**Hosted programmatic runs**

| ID | Step | Expected |
|---|---|---|
| D5 | Review a nested file following the skill (`vibe_review_start` with `wait_seconds` 120 to 300, `vibe_status` with `wait_seconds`, `vibe_close`), cold and warm. | Settled `vibe_status` carries `result` with `stop_reason: end_turn`, `next_action`, `integrity.status: verified`; record time to first event and to `completed`. |
| D6 | During D5: `ps -axww -o pid,command` and a run-directory listing; afterwards inspect `transcript.md`, `events.ndjson`, `result.json`, `launch-manifest.json`. | No task text in any argv; `task-prompt.txt` gone once Vibe starts; no reasoning text; manifest owner-only; record the event count. |
| D7 | Two reviews: edit a tracked file by hand during the first; during the second only `touch` a tracked file and rewrite a `node_modules/` file with the same content. | First `changed` with that path; second `changed` with only the ignored path. Record the snapshot time. |
| D8 | Edit run changing one file and creating ten or more; read the result; `vibe_close` with `cleanup_worktree: true`. | Patch applies to the base; source untouched; `worktree_removed: true`. Record export time. |

**Hosted ACP runs (`backend = "acp"`)**

| ID | Step | Expected |
|---|---|---|
| D9 | Review, then `vibe_continue` with a follow-up. | Same session; each turn has its own `stop_reason` and integrity; zero permission requests. |
| D10 | Start a longer task, `vibe_close` mid-turn. | `cancelled`, then `closed`, never `failed`; no Vibe process left (`pgrep -fl vibe`). |
| D11 | Quit and reopen Codex once after a run completed and once mid-run; `vibe_continue` each. | Fast start with no Vibe process; completed run reloads lazily; interrupted run is `recoverable` and continues or fails with an accurate code; the original task is never replayed. |
| D12 | `worker_idle_ttl_seconds = 60`, restart, complete a run, wait over 60 s, `vibe_continue`. | `idle_expired` event; the continuation reloads the session. |
| D13 | In a review ask Vibe to read the outside file, read `.env`, write a file; pass `allow_shell: true` to `vibe_edit_start`. | Reads and the write refused; `allow_shell` rejected as an unknown field; zero permission requests. |

**Clients, failures and measurements**

| ID | Step | Expected |
|---|---|---|
| D14 | `setup --workspace <repo> --isolated --yes`; use Codex desktop and the Codex CLI together; restart the desktop. | Both work; the desktop's stderr says `adopted` and its earlier run is reachable; at most two `mcp-sessions/session-*` directories. |
| D15 | Without `--isolated`, open a second client on the shared directory; point `paths.vibe` at a missing file and start a run. | Second client refused naming the lock path and owner PID; `VSUP_VIBE_NOT_FOUND`. |
| D16 | Record what the model sees of a tool reply (one JSON text block) and whether progress notifications appear; `vibe_status` with `wait_seconds: 300` in desktop and CLI. | Returns before the 600 s `tool_timeout_sec` that `setup` writes. |
| D17 | `time vibe-supervisor doctor`; Vibe import time (`python -X importtime -c "import vibe"`, total); `time /usr/bin/security find-generic-password -s ai.mistral.vibe -a MISTRAL_API_KEY` without `-w`; event counts from D5, D8, D9. | Numbers recorded. |

**Soak, budgets, shutdown and platforms**

| ID | Step | Expected |
|---|---|---|
| D18 | From a source checkout after `npm ci && npm run build`, with the workspace allowed: two pilot reviews, then `node scripts/soak.mjs --workspace <repo> --reviews 60 --edits 30 --acp 10 --out <evidence-dir> --server-command node --server-arg dist/cli.js --server-arg serve --server-arg --stdio --yes` (without `--yes` it prints the plan and cost warning only). The template `config.toml` it copies must not contain removed keys. `npm run soak:report <evidence-dir>` gives the row, the verdict and evidence lines. | Zero unexpected failures; truthful truncation at or under `--max-truncated-percent` (default 10); zero permission requests; no leaked processes or worktrees; bounded artifacts; retention keeps recent runs. A `VSUP_NO_PROGRESS` run is an unexpected failure to investigate. Task compliance is reported, not gated. |
| D19 | Optional: D4, D9, D13 with the unified harness. | Differences recorded. |
| D20 | D0 to D5 on a clean macOS account (and on an Intel Mac if decided). | Same results. |
| D21 | ACP edit at `max_turns: 3` on the four-file pointer chain ([fixture](docs/history/reviews/rc8-continuation-followup-2026-10-08/Read.md)) driven to `max_turn_requests`; `vibe_continue` without `max_turns`, with `max_turns` equal to and below the limit, then with `max_turns: 10`; repeat the last after a restart. | First three refused (`VSUP_TURN_LIMIT_REACHED`, `VSUP_INVALID_ARGUMENT`) with no prompt sent; the raised continuation ends `end_turn`, also after restart. |
| D22 | Codex desktop and the official client: quit or disconnect after start, continue and close; while a run is running; with an idle completed ACP session. | Client and server exit within seconds (the server's own deadline is 10 s); owned workers stop and the owner lock is released. Recoverable edits may retain their owned worktrees, which must be inventoried; an interrupted run is `recoverable` on the next start. After verified close/cleanup, require removal or an explicit retention reason, with no unexplained residue. |
| D23 | ACP review with `timeout_seconds: 60`, wait 90 s, `vibe_continue` with a task longer than a minute. | Finishes, or `VSUP_TIMEOUT` from the supervisor; never `VSUP_BACKEND_CRASHED`. |
| D24 | Programmatic review of the whole repository with `max_turns: 2`. | `completed`, `stop_reason: max_turn_requests`, partial warning, matching `result.json`. |
| D25 | Product acceptance sequence through Codex desktop with the `vibe-acp` skill: verify the connected version and tool catalog, prepare the baseline, ACP edit, independent tests in a separate copy and read-only review while the session stays open, any required same-session correction within the budget, fresh export, `vibe_close` with cleanup. Separately demonstrate one deliberate same-session edit correction on a controlled fixture; do not force a correct product candidate to need correction. | Product acceptance and controlled correction both pass without a coordinator production-code rewrite; worktrees are removed. A premature close or a coordinator production-code correction is recorded as PARTIAL. |

Target-machine housekeeping: the managed checkout is `/Users/roman/.codex/worktrees/rc7-target-tests/codex-vibe` (preserve its ignored `release/` before archiving it); keep `/private/tmp/codex-vibe-rc2-npm-cache` (packaging cache); `/private/tmp/rc8-phase-d-6n1ney4v` and `/private/tmp/rc8-diagnostic-soak-o3bq8bg_` hold private native histories kept for diagnosis and must stay out of public artifacts.

## After 1.0

- **Simplification phase 3**, after stable: consider ACP as the default and removal of programmatic only after required ACP scenarios pass and a migration decision is reviewed. Ten ACP soak jobs alone do not establish equivalence to the other ninety programmatic jobs. This could remove about 400 lines, including fragile exact-match turn-limit detection. Separately consider folding the ACP negotiation timer into the progress watchdog and regrouping tests by subject.
- Non-blocking [cold-review F7 to F15](docs/history/reviews/1.0-cold-review-2026-10-08.md) items may follow stable only after current-source triage. rc.17 implements a shutdown remedy for F13; a reproduced boundary/lifecycle blocker cannot be deferred under its old severity label.
- Record ACP `_session/retrying` notifications as a diagnostic (silent-stall follow-up).
- Vibe 2.26.0 or later: needs the version, the harness source hash and the launcher signatures updated together, then `compat:probe`, the resolver check and hosted runs on that version.
- Linux support; the launch article ([drafts](docs/history/article/README.md)) after the `v1.0.0` release, once the GitHub repository description is fixed.

## How to work on it

- Never run a real Vibe on the preparing machine: no hosted runs, no `compat:probe`, no `VIBE_SUPERVISOR_TEST_VIBE_PYTHON`. Published Vibe wheels may be read, never executed. Hosted evidence comes from the target machine.
- The target-machine agent bases its branch on main and changes only evidence and this handoff there; runtime code, skills and `scripts/soak.mjs` change on main. Version numbers are cut on main only.
- Code changes: lint, typecheck, build and the relevant tests; after changing a remedy run `npm run docs:errors`. Before a release candidate: `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`, which runs release verification and the offline installed-package smoke test. Push with `make push`.
- The suite runs files in parallel; `vitest.config.ts` sets a 15 s test timeout for Git and process tests under load.

## Release artifacts

`release/` is ignored by Git. The current candidate is **0.9.0-rc.17**, built on 2026-10-09 on the preparing machine (Node 24.19.0, npm 11.17.0, macOS arm64) from the `Cut 0.9.0-rc.17` commit.

```text
vibe-supervisor-0.9.0-rc.17.tgz  sha256 5e25afc6ab0c292e6db2abf5ebaccd92b2fe957c283a34c3d0156a29e235b1b0
sbom.spdx.json                   sha256 cbcd54543497f804b918927e331c9d563b6d405e6924f1d43e0576562042eab3
acceptance.json                  sha256 4901ce23e11b9d3305c28476453cc7cba745320c63145d28a5979d99db70245d; 7 deterministic checks PASS; hosted, soak and platform gates UNVERIFIED
SHA256SUMS
```

`package:rc` passed: 761 tests passed and 2 skipped in 68 files, 83 Python tests, lint, typecheck, build, secret scan, SBOM, and the offline installed-package smoke test (MCP initialize and tool listing, EOF shutdown, two concurrent `--isolated` clients). The tarball has no `docs/history/`, `.mcp.json` or `.codex-plugin/`. A copy is at `/Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/0.9.0-rc.17/` on the preparing machine; check it with `shasum -a 256 -c SHA256SUMS` before installing. Never edit archive contents; rebuild instead.
