# Implementation handoff

## Current delivery — 2026-10-09, rc.14

`vibe-supervisor@0.9.0-rc.14` is implemented and installed locally. Source delivery is on `codex/project-agents-isolation`, based on `8da1c7d`; the dirty primary checkout is preserved. The user authorized committing and pushing this delivery. The package remains private, unpublished, ESM and MIT; no production 1.0 certification or deployment is claimed.

The delivery retains rc.11 project-discovery isolation and rc.12 creator-version provenance, and adds reviewed-baseline preparation, settled edit-run audits, optional private audit scope input and the delegation protocol. Source files/index/refs are preserved by preparation; explicit snapshot commits belong only to a new disposable repository. Canonical allowlists, pinned Vibe 2.25.8, private homes, disabled shell/network and the existing MCP tool interface remain intact.

| Evidence | Actual result |
| --- | --- |
| rc.14 offline release verification | 790 tests passed, two skipped; Python checks, lint/typecheck/build, acceptance, secret scan, SBOM and installed-package smoke passed |
| rc.14 installation and fresh official MCP client | Installed CLI and connection identify rc.14; seven tools; prior versions, allowlists and unrelated settings preserved |
| rc.13 prepared hosted edit/correction pilot | PASS: two end_turn/final-answer rounds in one session, independent candidate checks/review, fresh exports and verified cleanup |
| rc.13 narrow product increment | Original candidate rejected for nested/lone dash paths; coordinator correction tested and reviewed, included in rc.14. Vibe product acceptance gate remains PARTIAL |
| Native desktop reload / rc.14 hosted inference | UNVERIFIED / NOT RUN |

See [delivery evaluation](docs/history/reviews/rc13-worker-adoption-2026-10-09.md), [adoption contract and status](docs/vibe-worker-adoption-plan-2026-10-09.md), and [pilot protocol](docs/acp-edit-pilot-2026-10-09.md). Live public diagnostic fields and runtime intervention on repeated edit failures were not added.

## Next test and remaining gates

Reconnect the desktop MCP integration or use a fresh chat and verify its actual version/catalog before dispatch. Keep the completed worker session open through independent tests and read-only review; send any correction in that session within the existing cumulative budget, then obtain a fresh export and perform verified close/cleanup. The next product test must prove this complete acceptance sequence; the earlier premature close is recorded as a coordinator deviation, not a Supervisor success or a passed product gate.

Do not replay accepted UARoots work, raise budgets automatically, weaken guards or substitute synthetic checks for hosted gates. Full D8/D18/soak, restart/recovery, callbacks, native desktop, Intel and clean-account gates remain unverified. Billing/quota and shared focused-hour balance remain unknown.

## Prior milestones

rc.11 accepted a real project `.agents` directory while disabling pinned Vibe project discovery, after validating harness source/signatures; `.agents` instructions/skills remain unavailable to worker tools. Root `.vibe`, unsafe `.agents` paths and unsafe `.vibeignore` remain refused. The hosted read-only result and its limits are in [the isolation report](docs/history/reviews/project-agents-isolation-2026-10-09.md).

rc.12 records the creating Supervisor version without relabeling legacy/recovered runs and prepared the bounded edit pilot. Its failed SEO run is analyzed in [the worker review](docs/history/reviews/rc12-seo-worker-adoption-2026-10-09.md). Earlier failures remain separate evidence; rc.13 subsequently passed the prepared pilot, and rc.14 is the currently installed candidate.

The rc.10/2026-10-08 sections below are a historical baseline. Their release versions, account observations and planned target-machine steps are not current installation or gate results; use the current delivery table above and preserve their original evidence. Existing Git history and MIT copyright are unchanged. The former rc.2 and 2026-10-05 handoff is in [handoff history](docs/history/handoff-2026-10-05.md).

## Where the project stands and what comes next (2026-10-08)

**State.** Release candidate 0.9.0-rc.10 is built from the `Cut 0.9.0-rc.10` commit on main; it is rc.9 plus the pre-1.0 cold-review fixes below. The soak driver and `soak:report` live in `scripts/`, which is not shipped. The supervisor itself has held up on every real run: no wrong state, leak, lost run or broken boundary has been observed on the target machine. Every Phase D failure so far was either a supervisor reporting bug that is now fixed (turn limit reported as a crash in rc.7, the npm-linked command printing nothing in rc.8), a test-driver problem (deadline below the worker's, tasks too broad for the budget) or model behaviour (searching instead of answering, exceeding instructed read counts, resuming an old objective). One real-run event is unexplained: a worker that stayed silent for 15 minutes; rc.9's progress watchdog now ends such a run with `VSUP_NO_PROGRESS` and records what it last saw. A static reading of the Vibe 2.25.8 source found no local cause; the remaining candidate is a stalled or trickling model request, which the watchdog's 600 s default ends before Vibe's own 720 s read timeout ([analysis](docs/history/reviews/vibe-2.25.8-silent-stall-analysis-2026-10-08.md)).

**Pre-1.0 cold review (2026-10-08).** A review of the whole shipped surface ([report](docs/history/reviews/1.0-cold-review-2026-10-08.md)) found every boundary in AGENTS.md holding and six defects to fix before 1.0, fixed in rc.10 and cold-reviewed again: an edit patch refused for ordinary code such as `password: string`, which stranded its worktree (F1); an ACP worker hanging in negotiation that survived close and the deadline (F2); edits from a repository subdirectory exposing the whole repository, now refused (F3); `doctor` running a project-relative `./vibe` (F4); permission codes whose remedy did not apply (F5); input problems reported as generic codes (F6). They change runtime behaviour, so the Phase D steps run on rc.10. A soak attempt already under way on rc.9 still counts as evidence for the success path, which the fixes do not touch; if the full pass was made on rc.9, rc.10 needs only the pilots plus a short confirmation pass (10 reviews, 5 edits, 5 ACP). The review's after-1.0 items (F7 to F15) stay open in the report. `npm run soak:report <dir>` turns a soak's `summary.json` into the Phase D row, the D18 verdict and evidence lines.

**What 1.0 still needs, in order** (P0 blocks 1.0):

| # | Priority | Item | Where | Effort |
|---|---|---|---|---|
| 1 | P0 | D18 soak on rc.10 from main: two pilot reviews, then the full 60/30/10 pass. Passing means the supervisor criteria; truncation within threshold; task compliance is reported, not gated | Target machine | About 2 hours of runs, roughly USD 2 to 4 of inference at the rates seen so far |
| 2 | P0 | D21 recorded under the four-file fixture (already passed three times in controlled runs) and D23, D24 repeated on rc.10 | Target machine | Under 30 minutes |
| 3 | P0 | Codex desktop steps: D2 (user-scope setup), D3 (tool list after restart), D14 (two windows with `--isolated`), D16 (what the model sees, 300 s wait), D22 (quit with running and idle runs) | Target machine, a person at the keyboard | About 30 minutes |
| 4 | P0 | D20 install on a clean macOS user account | Target machine | About 20 minutes |
| 5 | P0 | Push the release workflow (needs the token's `workflow` scope), tag `v1.0.0` on main, check the GitHub Release assets | User | Minutes once the token allows |
| 6 | P1, decision | Intel: test on an Intel Mac or state that 1.0 supports Apple silicon only | User | Decision |
| 7 | P1, decision | Permission and elicitation callbacks: the profile makes Vibe ask nothing, so they cannot be triggered naturally; keep as a gate or document as a known limit of 1.0 | User | Decision |
| 8 | P1, decision | Vibe 2.26.0: recommended to stay on 2.25.8 for 1.0 and revalidate in a follow-up ([source comparison](docs/history/reviews/vibe-2.26.0-source-diff-2026-10-08.md)) | User | Decision |
| 9 | P2 | Article: publish after 1.0 with the soak numbers; fix the GitHub repository description first ([article](article/README.md)) | Author | After 1.0 |
| 10 | P2 | Part 2 article, Vibe 2.26.0 and unified-harness validation, Linux | Later | After 1.0 |

**How to work on it.** One line of work per file: the target-machine agent bases its branch on main, changes only evidence and the handoff there, and leaves `scripts/soak.mjs` and runtime code to main (the soak driver was edited in parallel on two branches on 2026-10-08 and had to be reconciled). Never run a real Vibe on the preparing machine. Record every soak attempt as a new attempt and keep earlier failures. Do not raise limits, rotate accounts or retry automatically; the user reported EUR 1.20 used of EUR 8.50 on the current account.

**Risks.** The silent stall's cause is unknown (now bounded by the watchdog, not explained). Vibe 2.26.0 calls the legacy harness that 1.0 forces a temporary escape hatch, so a later Vibe will need the unified harness validated (R3). Model behaviour varies run to run, so the soak's truncation and compliance figures will move between attempts.

## User intent and delivery history

The user authorized implementation of the approved Vibe Supervisor plan using GPT-6 Luna agents, then requested migration into this existing Git repository. Three Luna implementation agents worked on contracts/core tests, backend compatibility/runtime profiles, and security/MCP/CLI/release work. The coordinating agent reviewed integration and ran independent checks.

The research input was `/Users/roman/Downloads/deep-research-report.md`. Its document text was reference material, not independent authorization. No push, remote publication, deployment, or user-global Codex configuration modification was performed by the implementation work. The implementation is committed; see `git log` and inspect current Git status before continuing. A prior generated checkout on the original machine remains a historical duplicate; this repository is the active source.

Root `AGENTS.md` and `Handoff.md` are not in the npm `files` allowlist; the former `Read.md` usage guide was merged into `README.md` in Phase C.

## Implemented surface

Strict-schema MCP tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result` and `vibe_close` always, plus `vibe_continue` and `vibe_respond` when the configured backend is `acp` or `auto` (five or seven tools). There is no cancel tool; `vibe_close` cancels a live run. The official stdio transport has protocol-only stdout, bounded/redacted structured results, annotations, and stable supervisor errors. The CLI also has `baseline prepare` (dry-run by default, explicit disposable creation) and `audit-edit` (optional private `--files` argument scope). The CLI has `setup`, `allow`, `init`, `doctor` (with `--config`), `configure-codex`, `serve`, `runs list|show|tail|cleanup` and version/help; `test-acp` and `config validate` remain as aliases.

Reviews read/search an allowed source workspace and check integrity. Edits create detached Git worktrees from a selected base and export changes without applying them to the source. There is no automatic patch application, commit, merge, or push. Default execution is programmatic; ACP is opt-in and supports correlated permission callbacks, form input, same-session continuation, cancellation, and conditional session loading.

[README.md](README.md) contains executable setup/usage instructions. [docs/functionality.md](docs/functionality.md) describes all user-visible behavior. [docs/reference.md](docs/reference.md) lists the tool surface; exact fields and limits live in `src/mcp/schemas.ts`.

## Architecture map

| Area | Files and responsibilities |
|---|---|
| Shared contracts | `src/contracts.ts`: versioned runs, events, limits, errors, backend interfaces, artifacts, configuration. |
| Configuration | `src/config/`: defaults, strict validation, private TOML loading, data/config path resolution. |
| Lifecycle | `src/core/run-manager.ts`, `run-state.ts`, `policy-engine.ts`, `serialization.ts`: queue, state, persistence, policy, responses, recovery, cleanup. |
| Backends | `src/backends/programmatic.ts`, `acp.ts`: process/SDK adapters and capability checks; `pinned.ts`: the Vibe version pin; `probe-cache.ts`: availability probes; `worker-deadline.ts`: the deadline file the launcher watchdog re-reads. |
| Launch profile | `src/backends/profile.ts`, `launcher.ts`, `runtime/vibe_supervisor_launcher.py`: isolated homes, filtered tools/environment, installed Python runtime, persistence shim/watchdog. |
| Security primitives | `src/security/`: canonical paths, private filesystem objects, child environment, streaming redaction. |
| Git | `src/git/worktree.ts`: detached worktrees, safe export/cleanup; `reviewed-baseline.ts`: explicit hash-bound reviewed snapshot preparation. |
| Process management | `src/process/managed.ts`: bounded output and managed process-group termination. |
| Storage | `src/persistence/`: atomic private writes and NDJSON recovery. |
| Public interfaces | `src/mcp/`, `src/cli.ts`, `src/cli/` (`setup.ts`, `codex.ts`, `diagnose.ts`), `src/diagnostics/doctor.ts`, `edit-run-audit.ts`: local diagnostics and sanitized settled-edit evidence. |
| Packaging and tools | `scripts/`: runtime asset copy, acceptance, secret scan, SPDX inventory, checksums, install smoke, RC packaging, error docs, `compat-probe.mjs`, the hosted `soak.mjs` driver. |
| Tests | `tests/`: schemas/config/CLI, core and official MCP integration, security/process/Git, fake ACP subprocess integration. |
| Skills and plugin scaffold | `skills/vibe-supervisor`, `skills/vibe-acp` (shipped); `.codex-plugin/plugin.json` and `.mcp.json` stay in the repository only and are out of scope for 1.0. |

## Lifecycle and persistence details

Start returns a run ID asynchronously. Default capacity is two active workers and eight queued runs. Default idle lifetime is 600 seconds. Review defaults are 1,800 seconds and 20 turns (12 before the Phase D soak); edit defaults are 2,400 seconds and 20 turns. Default byte caps are 52,428,800 for events, 10,485,760 for transcripts, and 104,857,600 for artifacts; MCP results are capped at 8,000 characters by default (`limits.max_mcp_result_chars`) and shrink in a fixed order when over the cap.

State includes queued/startup/negotiation/ready/running, permission/input waits, completed/failed/cancelled, closing/closed, and recovery states. Owner-only directories/files use 0700/0600. Persistent records are versioned, writes are atomic, initialization is single-flight, and a data-directory owner lock excludes concurrent supervisors. Defaults retain seven days and preserve failed runs.

The macOS default data/config root is `~/Library/Application Support/VibeSupervisor`; `VIBE_SUPERVISOR_HOME` overrides it. Explicit `paths.data_dir` can select run storage while config resolution still uses the config home. Saved ACP paths must match the trusted `dataDir/runs/<uuid>` layout and source/worktree/profile records. Loading requires advertised `loadSession`, mode/trust validation, and suppression of replay notifications. Recovery does not resubmit an uncertain original task or restore process-local pending grants/input. It waits for explicit continuation. Saved PIDs are never authority to kill arbitrary processes.

## Security and Git behavior

Canonical workspace roots, context paths, recursion guards, explicit child environment allowlists, and bounded/redacted results enforce the application policy. Shell and network tools are disabled with no switch: `allow_shell` is an unknown input field rejected with `VSUP_INVALID_ARGUMENT`, and an ACP permission request for an execute-kind tool is denied by policy (`shell_disabled`). These are application controls, not an OS sandbox. Permitted source can reach the provider; redaction recognizes known formats rather than every possible secret.

Each worker has fresh private HOME and VIBE_HOME; it does not inherit the user's Vibe configuration, project trust, tools, hooks, agents, skills, plugins, MCP servers, or additional directories. Project `.vibe`/`.agents` extensions and symlinked `.vibeignore` are refused. Review enables read/search; edit adds write/edit. Sensitive and reserved path exclusions cover the file/search profile. Grep's returned-result cap does not guarantee a peak-buffering cap inside Vibe's search implementation.

The pinned Python shim checks Vibe version and logger persistence signatures, forces legacy harness behavior, removes reasoning/credential-bearing fields before native history writes, applies private permissions, and watches parent death/run lifetime. Raw ACP wire logging is disabled. Private histories remain for recovery/retention. Secrets are not placed in tool arguments or task text. An explicitly present `MISTRAL_API_KEY` is forwarded to the private child; otherwise, for real runs only, the shim resolves the browser-login Keychain credential itself and keeps it inside the Vibe process (verified in hosted runs on 2026-10-05).

Git operations use direct argument arrays with no shell and disable/refuse hooks, filters, and external diff paths. Snapshot exports cover supported staged, unstaged, untracked, binary, and unusual-name changes without mutating the source index. Artifacts include patch/stat/changed files, public transcript, events, and hashes. Cleanup compares a fresh verified export to the saved patch and refuses stale or secret-bearing exports and unaccounted ignored files. Process-group cleanup is bounded; sandbox EPERM can degrade to known-child termination and is reported as unverified group cleanup, never as proof all descendants died.

## Compatibility and dependencies

Vibe is pinned to **2.25.8**; ACP protocol is v1. Vibe 2.26.0 was released on 2026-10-06 and is refused by the pin; whether it still has the legacy harness that 1.0 forces is unchecked (see the open decisions under Phase D). The launcher obtains the installed entrypoint's Python interpreter from its shebang. Both adapters use the checked runtime shim; version/signature drift aborts. ACP advertises `loadSession: true`; do not infer an unsupported `session/resume` method. The effective tool inventory was confirmed from private session records in the 2026-10-05 hosted runs (review: `grep`, `read_file`; edit: adds `edit`, `write_file`). Supervisor-owned Plan and Accept Edits agent files keep Vibe's built-in agents from overriding these permissions; see [docs/compatibility.md](docs/compatibility.md). Hosted runs used `mistral-medium-3.5`; the supervisor does not pin a model.

Runtime dependencies: ACP SDK 1.7.0, MCP server/client 2.3.0, MCP Node adapter 2.1.1, Zod 4.6.5, smol-toml 1.9.0. TypeScript 5.9.3 was retained for compatibility; TS7 adoption is not part of this RC. The lockfile pins versions. Node engine requirement is >=20.19; the observed verification machine ran Node 24.21.0, macOS 27.0.1 arm64, Git 2.54 Apple, Codex 0.160.0, and Vibe under uv/Python 3.12.

Installed diagnostic paths on the original verification machine (historical evidence):

- `/Users/roman/.local/bin/vibe` and `/Users/roman/.local/bin/vibe-acp`.
- `/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python`.
- Offline npm cache: `/Users/roman/Documents/Codex/2026-10-03/p/work/npm-cache`.

These are local evidence, not portable defaults. `scripts/package-rc.mjs` and `scripts/smoke-install.mjs` require `VIBE_SUPERVISOR_TEST_NPM_CACHE` to be an absolute path to a populated offline npm cache and fail immediately without it; there is no fallback path.

## Verification evidence

Historical: the last full implementation release verification passed **49 tests across 7 files**, lint, typecheck, build, deterministic acceptance, secret-pattern scan, and SPDX inventory. Counts: tool schemas 4; config 7; MCP integration 2; CLI 3; core 8; security 14; ACP integration 11. This is a historical result, not a substitute for checking later changes.

Current suite at rc.10 (2026-10-09): 737 tests in 63 files (`npx vitest run`), of which the 2 installed-resolver profile tests (review and edit) skip when Vibe is not installed. Plus 76 Vibe-free Python tests (`npm run test:python`, also part of `verify:release`). Nothing in the suite runs a real Vibe on the preparing machine.

ACP fake-subprocess coverage includes 100 independently initialized prompt runs, unknown notifications and thought filtering, correlated permissions and expired IDs, form responses, live continuation, loading without original-task replay, malformed JSON, early exit, wrong protocol/mode, and cancellation. It verifies local protocol/lifecycle behavior rather than hosted inference.

Independent checks also passed:

- Real installed Vibe SessionLogger fixture without a prompt, covering append/overwrite/metadata filtering.
- Actual compiled ACP initialization through isolated homes and the privacy launcher, negotiating exact Vibe 2.25.8 and protocol v1 without inference.
- Actual compiled stdio MCP server with the official client, tool discovery (five or seven tools by backend), workspace rejection, and EOF cleanup.
- Isolated CLI/doctor and configure-Codex tests; no user-global config was edited.
- Offline tarball installation with CLI/runtime shim/MCP initialization, discovery, status error, and shutdown checks.
- Destination source comparison after migration; source was unchanged, with license/README metadata aligned to the existing repository.
- Release checksums verified for the package, SBOM, and acceptance report.

Documentation additions were checked for local link targets and whitespace. They do not change runtime behavior.

## Release artifacts and reproduction

`release/` is ignored by Git. The current candidate is **0.9.0-rc.10**, built on 2026-10-09 on the preparing machine (Node 24.19.0, npm 11.17.0, macOS arm64) from the `Cut 0.9.0-rc.10` commit. It adds to rc.9 the fixes for the pre-1.0 cold review: the narrowed patch credential check, killable and bounded ACP negotiation, edits refused outside the repository root, `doctor` resolving bare names on `PATH`, corrected permission and input codes, and input problems refused at start. The release workflow is not in it; it waits on `claude/release-workflow`.

```text
vibe-supervisor-0.9.0-rc.10.tgz  sha256 7c6c3e6b277a6022a8fdf1d5509909e1cde177a29dc11c7f52917e707aaa8894
sbom.spdx.json                   sha256 5d87454085b307b4ed0446f479f46b6b9e5515ba0195e1470433e4a64d37719c
acceptance.json                  sha256 9d17fb22fd167959e3966b510c8baf7b3c26006cd8ea6c8bc455bb86189999d0; 7 deterministic checks PASS; hosted, soak and platform gates listed UNVERIFIED
SHA256SUMS
```

`package:rc` passed end to end, including the offline installed-package smoke test (MCP initialize, the backend-dependent tool listing, EOF shutdown, and two concurrent `--isolated` clients from the installed tarball). The tarball has no `docs/history/`, `.mcp.json` or `.codex-plugin/`. Earlier candidates (rc.1 to rc.9) are superseded. Never edit archive contents manually; rebuild instead.

The delivered copy of these four files is kept on the preparing machine at `/Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/0.9.0-rc.10/` (older candidates are next to it), Git-ignored; verify it with `shasum -a 256 -c SHA256SUMS` in that folder before installing on the target machine. What to check there first: `vibe-supervisor setup --workspace <repo>` end to end including the Codex registration; that Codex lists five tools (programmatic) or seven (`acp`/`auto`); the Phase B measurements P1 to P4; hosted ACP cancellation, restart and lazy reload, and idle expiry (D10 to D12); and that `--isolated` reuses its session directory across Codex restarts. npm 11 warns that the dev dependencies `esbuild` and `fsevents` have install scripts outside `allowScripts`; the project's own `prepare` build still runs.

Populating the offline cache needs two steps. `npm ci --cache /abs/cache` stores package tarballs but not the registry metadata the offline tarball install needs, so the first `package:rc` run fails with `ENOTCACHED`. Warm the metadata once by packing the tarball and installing it online with `--ignore-scripts` into a throwaway prefix using the same cache, then run `package:rc`. The smoke install uses `--ignore-scripts`, so it does not exercise the `prepare` script; a fresh `npm ci` (Phase D, D18 setup) covers that.

```sh
npm ci --cache /absolute/path/to/npm-cache
npm pack --ignore-scripts --pack-destination /tmp/vsup-warm
npm install --cache /absolute/path/to/npm-cache --ignore-scripts --prefix /tmp/vsup-warm/prefix /tmp/vsup-warm/vibe-supervisor-*.tgz
VIBE_SUPERVISOR_TEST_NPM_CACHE=/absolute/path/to/npm-cache npm run package:rc
cd release
shasum -a 256 -c SHA256SUMS
```

`package:rc` repeats verification and performs offline installed-package smoke before packing. Avoid redundant full runs during ordinary small changes. The installed real-logger fixture is optional and machine-dependent:

```sh
/path/to/mistral-vibe/bin/python src/backends/runtime/test_vibe_supervisor_launcher.py
```

Use the Python interpreter from the installed Vibe tool environment (on the original machine, the uv tool path listed above).

## Outstanding validation and next work

The unverified gates are listed once, in [docs/compatibility.md](docs/compatibility.md#unverified-gates), and stay UNVERIFIED until their evidence is recorded: the hosted ACP lifecycle (cancellation, permission and input callbacks, restart and load recovery, idle expiry), the 100-run hosted soak, the effective tool inventory and hosted runs for the current build, macOS Intel and a clean OS account. The [Phase D test plan](#phase-d-test-plan) covers all of them; plugin installation is out of scope for 1.0.

Next work: see [where the project stands and what comes next](#where-the-project-stands-and-what-comes-next-2026-10-08). Results so far are in [Phase D results](#phase-d-results).

### ACP field lessons (2026-10-08)

The user-provided deployment report used Supervisor rc.4 with pinned Vibe 2.25.8. It records successful isolated drafting, three correction rounds, patch export and worktree removal, but exhausted-budget continuation made no useful progress and the official client required explicit shutdown. These observations are hypotheses to reproduce on the patched rc.7 package, not proof of current supervisor defects. Independent review caught a denied-invalidation exit-status bug; worker execution claims were not accepted with shell disabled. Keep coordinator ownership of test execution and policy-sensitive acceptance. See [field observations and scope](docs/history/reviews/deployment-acp-lessons-2026-10-08.md).

Run the next checks in this order:

1. **ACP budget and continuation:** use an isolated synthetic fixture and explicit supported limits; reach the turn cap, then attempt one small correction in the same usable session. Record state, stop reason, per-turn/cumulative budget behavior, patch progress and whether continuation executes. Confirm the pinned Vibe contract before changing code. Do not replay an uncertain task, silently increase limits or enable shell/network.
2. **Client shutdown:** exercise official MCP start/continue/close and connection shutdown with a bounded exit deadline. Record remaining client handles, owned supervisor/worker PIDs, locks and worktrees. Acceptance requires the client to exit and owned resources to settle; attribute any failure to its actual owner before fixing or terminating it. Do not terminate arbitrary saved PIDs.
3. **Hosted soak:** define a separate task plan using known nested fixture paths and available file tools, then rerun all 60 reviews, 30 edits and 10 ACP scenarios with the 20-turn review default (raised from 12 on 2026-10-07 by user decision) and stop-on-failure. Preserve both earlier broad-task failures. Require normal end_turn finishes, verified integrity and cleanup; partial capped results do not pass.
4. **Remaining release gates:** after the soak passes, complete native desktop adoption/tool-result visibility/long waits, callbacks/reject behavior, cancellation after generated output, clean-account installation and Intel evidence. Keep missing evidence unverified.

Use narrow worker contracts: objective, owned files, acceptance criteria, available tools and coordinator-run checks. Validate fake executable interception and denied-command/nonzero-exit cases before executing worker-produced deployment-helper tests, with cloud credentials excluded. Existing skills already state the execution boundary; inspect the installed skill and actual prompt before adding duplicate guidance. Session wall time includes coordinator pauses; cached input totals and estimated provider cost do not establish time savings or contribution percentage. A dev.to launch article is planned in [article/plan.md](article/plan.md); it is published only after a v1.0.0 GitHub Release exists and Phase D has supplied its numbers, and the GitHub repository description ("Codex ASP client for Mistral Vibe") must be corrected first.

### Verify on the target machine, not here (user rule, 2026-10-08)

Nothing is run against a real Vibe on the preparing machine: no hosted runs, no `compat:probe`, no `VIBE_SUPERVISOR_TEST_VIBE_PYTHON`. Work here uses fake backends and reads published Vibe source only (wheels from PyPI unpacked and diffed, hashes checked, never executed). Every behaviour below was derived that way and must be confirmed on the target machine before 1.0; the full list is in [Vibe interactions under test](#vibe-interactions-under-test):

- **Cumulative ACP turn budget (2.25.8 source reading):** Vibe counts turns per session, not per prompt, keeps the count across `session/load`, and answers every further prompt of an exhausted session with `max_turn_requests` without doing work; only `session/set_config_option max_turns` with a larger value lets it continue. On the target machine: run an ACP edit with a small `max_turns` until `max_turn_requests`; confirm a plain `vibe_continue` is refused with `VSUP_TURN_LIMIT_REACHED` and sends no prompt; confirm `vibe_continue` with a larger `max_turns` resumes useful work; repeat after a supervisor restart (lazy `session/load`).
- **Raising `max_turns` on a live session:** confirm Vibe accepts `session/set_config_option max_turns` with values from 2 to 50 on a session that already hit its limit. If Vibe rejects it, the run currently ends `failed` with a generic `VSUP_ACP_PROTOCOL_ERROR`; a specific invalid-argument error would be the follow-up. Known limit: if saving the raised limit fails (storage degraded, warned) and the supervisor then restarts, the saved limit is the old one, so a later small raise can be below the turns Vibe has already used and end at once with `max_turn_requests`.
- **Client shutdown:** with the official MCP client and with Codex desktop, close the connection after start, continue and close, while a run is still running, and with an idle completed ACP session; the client and the server must exit within seconds, with no Vibe process, owner lock or worktree left behind.
- **Vibe 2.26.0:** the [source comparison](docs/history/reviews/vibe-2.26.0-source-diff-2026-10-08.md) finds no broken assumption, but 2.26.0 calls the legacy harness a temporary escape hatch. Recommended: keep 2.25.8 for 1.0 and bump in a follow-up; supporting it needs `compat:probe`, the resolver check and hosted runs on that version.

### Standing decisions

- Review integrity: when a review run's source workspace changes during the run, the run completes with a warning instead of failing, and artifacts (transcript, `result.json`) are always finalized first. The read/search tool profile is the actual control, and users legitimately edit during long reviews. Reviewing a snapshot worktree is a possible later option.
- Timeout: `timeout_seconds` counts from launch, not from submission; time spent queued does not consume it.
- Gate 3 is redefined: the profile is designed so in-root reads and writes resolve to ALWAYS and everything else to NEVER (see [docs/compatibility.md](docs/compatibility.md)), so real Vibe should not issue permission callbacks. The soak asserts zero permission requests in normal runs plus one deliberate out-of-root read that is refused, rather than exercising callbacks. Nested in-root files resolve to ALWAYS since the B1 fix of 2026-10-05 (see the [handoff history](docs/history/handoff-2026-10-05.md)).
- Plugin scaffold: `.mcp.json` and `.codex-plugin/` are not packaged and are out of scope for 1.0. `.mcp.json` points at `./dist/cli.js`, which `npm ci` builds through `prepare`; Claude Code also loads it as a project MCP server and ignores the Codex-only `enabled` field.

## Vibe interactions under test

Every point where the supervisor depends on how Vibe 2.25.8 behaves, and the test on the target machine that proves it. None of these can be shown on the preparing machine: there, the fake programmatic and ACP fixtures model each behaviour and the published wheel was only read. A row passes only on evidence from a real Vibe run recorded in the dated evidence folder; a fixture result or a source reading never closes a row. The test IDs refer to the [Phase D test plan](#phase-d-test-plan).

### Launch and environment (both backends)

| Interaction | Why it matters | Required test | Passes when |
|---|---|---|---|
| Version and pin check by the launcher shim | Any other Vibe must be refused before a run starts | D4 `compat:probe`; D0 `vibe --version` | Probe checks PASS on 2.25.8; a different version gives `VSUP_VIBE_VERSION_UNSUPPORTED` |
| `SessionLogger` signatures the shim patches to redact native history | Reasoning and credentials must not reach Vibe's own session files | D4 launcher logger fixture; D6 inspection of the private session records | Fixture exits 0; no reasoning text or key in native history |
| `--legacy-harness` forced on every launch | 1.0 supports the legacy runtime only | D4, D5, D9 (all runs) | Runs start; the private session metadata shows the legacy runtime |
| Private `HOME`/`VIBE_HOME`, filtered environment, supervisor agent files for Plan and Accept Edits | No user or project tools, hooks, MCP servers or trust records are inherited | D6; session inventory in D5 and D8 | Inventory lists only the profile's tools; no user configuration appears |
| Browser-login credential resolved by the shim from the Keychain | Hosted runs must authenticate without a key in the environment or in task text | D5 without `MISTRAL_API_KEY` in the parent; D17 lookup time | Runs authenticate; no key in argv, events, transcripts or logs |
| Task handed over through a private prompt file (programmatic) | The task must not be visible in `ps` | D6 | No task text in any argv; `task-prompt.txt` is gone once Vibe starts |
| Model used by a fresh private home | The supervisor pins no model | D5 (record from session metadata) | Model name recorded |

### Tools and permissions

| Interaction | Why it matters | Required test | Passes when |
|---|---|---|---|
| Effective tool inventory: `read_file` and `grep` for reviews, plus `write_file` and `edit` for edits | Reviews stay read-only; no shell or network tool exists | Session inventory in D5 and D8 | Exactly those tools; no `bash`, network or MCP tools |
| Recursive workspace grant and path resolver | Nested in-root files readable; everything else refused | D4 manual resolver check; D13 | Nested in-root ALWAYS; outside path, root `.env` and symlink to outside NEVER, in both modes |
| Permission requests from Vibe | The profile is designed so normal runs ask nothing | D13; every D18 run | Zero permission requests in normal runs |
| Vibe's behaviour after a selected reject option, and elicitation forms | Correlated answers must not stall or loop a turn | Only if a request is observed during D13 or D18; record the turn's outcome | Turn continues or ends cleanly after the reject; still unverified if no request occurs |

### Programmatic runs

| Interaction | Why it matters | Required test | Passes when |
|---|---|---|---|
| `--output streaming` events become events, transcript and summary | The coordinator reads results from these | D5; D6 event count (P4) | Events in order; summary matches the final answer; no reasoning text |
| Turn limit: exit 1 with `<vibe_stop_event>Turn limit of N reached</vibe_stop_event>` as the last message and on stderr | Reported as `completed` with `max_turn_requests`, not as a crash | D24 | `completed`, `stop_reason: max_turn_requests`, the partial-result warning, saved `result.json` agrees |
| Other exits: authentication failure, HTTP 429, missing executable | Each needs its own error code and remedy | D15 for the missing executable; record any auth or 429 failure seen during D18 | `VSUP_VIBE_NOT_FOUND`; observed failures carry `VSUP_AUTH_REQUIRED` or `VSUP_RATE_LIMITED` |
| Edits produce files in the detached worktree | The patch is the deliverable | D8 | Patch applies to the base; source untouched; `worktree_removed: true` after close |

### ACP runs

| Interaction | Why it matters | Required test | Passes when |
|---|---|---|---|
| `initialize`: protocol 1, exact agent version, `loadSession` advertised | Recovery depends on it | D4 | All three as expected |
| `session/new` in Plan or Accept Edits mode with untrusted project state | Mode decides the tool profile | D9 | Mode and trust verified; tools as in the inventory |
| `session/set_config_option max_turns` at session start | The turn limit reaches Vibe | D9; D21 | Turn ends at the configured limit |
| Cumulative turn budget across prompts and across `session/load` | Continuing a spent session does nothing unless the limit is raised | D21 | Plain continue refused with no prompt sent; raised continue does useful work and ends `end_turn`, also after restart |
| Raising `max_turns` on a spent session | Only supported way to continue it | D21 | Vibe accepts every value used; any rejection recorded with its error |
| Streaming updates: message chunks, tool calls, thought filtering | Events and transcript stay accurate and private | D9 | Events in order; no thought text persisted |
| Stop reasons `end_turn`, `max_turn_requests`, `cancelled` | The coordinator trusts a result only on `end_turn` | D9, D10, D21 | Each reported as Vibe sent it |
| `session/cancel` during a turn | `vibe_close` must stop work promptly | D10 | `cancelled` then `closed`; never `failed`; no Vibe process left |
| `session/load` after a supervisor restart | Completed and interrupted runs continue without replaying the task | D11 | Lazy reload; the original task is never resent |
| Idle expiry of a completed session | Bounded resources | D12 | `idle_expired` event; continuation reloads |
| Worker deadline file re-read by the launcher watchdog | A continued session must not be killed mid-turn by the launch lifetime | D23 | The continuation finishes or times out by the supervisor's own deadline (`VSUP_TIMEOUT`), never `VSUP_BACKEND_CRASHED` |

### Shutdown and clients

| Interaction | Why it matters | Required test | Passes when |
|---|---|---|---|
| Client disconnect or quit with idle, running and closed runs | The field report saw a client that did not exit | D22, in the Codex desktop app and the official client | Client and server exit within seconds; no Vibe process, owner lock or worktree left |
| Two Codex clients with `--isolated` | Separate private directories, adopted after restart | D14 | Both work; `adopted` on restart; earlier run reachable by ID |
| What the coordinator model sees in a tool reply, and long waits | Result shaping and timeouts assume this | D16 | R1 answered; a 300 s wait returns before the 600 s tool timeout in both clients |

### Volume and platforms

| Interaction | Why it matters | Required test | Passes when |
|---|---|---|---|
| 100 mixed runs with the bounded tasks, the 20-turn review default and the progress watchdog | Stability over volume | D18 | Every soak criterion PASS: no unexpected failure, truncated runs within the threshold, zero permission requests, no leaks, bounded artifacts, retention keeps recent runs |
| A worker that stays silent while running | A coordinator must not wait out a 30 to 40 minute deadline | D18 (any occurrence), or a run observed silent for `worker_progress_timeout_seconds` | `failed` with `VSUP_NO_PROGRESS` and a `no_progress` diagnostic, worker gone, edit exported, slot freed |
| Clean macOS account, Intel Mac | Installation without leftovers from development | D20 | Same results as D0 to D5 |
| Vibe 2.26.0 (only if it is to be supported) | It makes the unified harness the default | D4, D5, D8, D9, D13 and the turn-limit run on 2.26.0, after changing the pin | All as above on 2.26.0 |

## Plan for 1.0 (2026-10-06)

Three read-only audits (latency, user-facing surface, stability) were run against `f9d34da` after the stop-reason fix. The verdict: the happy path is correct and defended, but 1.0 needs the unhappy paths (restart, storage failure, a second Codex session, a Vibe upgrade) to work, the cold-start and review-snapshot latency reduced, and the configuration, tool and documentation surface cut down. Phases A–C are testable here with fake backends; D needs the target machine.

Findings verified directly on this machine, not previously recorded:

- `src/` installs no `unhandledRejection` handler, and `void this.fail(...)` / `void this.deadline(...)` at `run-manager.ts:692`, `:713`, `:945`, `:981` are unguarded, so a persist failure (disk full, EACCES) in those paths terminates the server on Node 20. `setState` mutates before persisting, so a failed persist in the completion branch also leaks a concurrency slot.
- Recovery promotes only `recoverable` to `ready` (`run-manager.ts:154`); a run persisted as `running` or `waiting_*` stays there after restart, holds a slot and rejects `vibe_continue`. ACP `recover()` awaits `session/load` with no timeout (`acp.ts:445`) and runs before stdio opens; `configure-codex` writes no `startup_timeout_sec`.
- Nine config keys written by `init` are never read by the runtime: `limits.review_timeout_seconds`, `limits.edit_timeout_seconds`, `limits.max_turns_review`, `limits.max_turns_edit` (the effective defaults are the schema constants in `src/mcp/schemas.ts`), `phase1.allow_temporary_trust`, `security.allow_shell_in_review`, `security.log_raw_acp`, `security.persist_reasoning`; `security.allow_shell_in_edit` can never take effect because `allow_shell: true` is rejected first.
- The repository `.mcp.json` fails in any checkout that has not run `npm ci` (no `dist/`); it also declares `tool_timeout_sec = 3600` while `configure-codex` writes 600.

Audit findings relied on with file:line evidence (not independently re-verified): reviews hash the whole workspace twice (launch and completion), serially, excluding only `.git`; cold start spends 3–6 `which` spawns, a full extra Vibe launch as the probe on cache miss, and up to two 5-second Keychain lookups; every ACP event fsyncs; `describeArtifact` re-reads and hashes all artifacts at completion; `vibe_result` never waits. Dead-process lock recovery trusts `kill(pid, 0)` alone; a crash inside the recovery lock blocks every later start; a second Codex session on the same data directory loses the tools with one stderr line. `close(cleanup_worktree)` is a silent no-op after restart (`verifiedPatch` is memory-only), a refused cleanup leaves the run in `closing` with no exit, and `record.worktree` is set before `git worktree add` succeeds. A Vibe exit 0 without a result can be reported `completed`; programmatic hard-codes `end_turn`. After a Vibe upgrade every run fails with `VSUP_BACKEND_UNAVAILABLE` and the version remedy says "upgrade" for an exact pin; launch failures write no diagnostic and `vibe_status` strips diagnostic text.

### Phase A, survive failures (blockers)

Status: done on 2026-10-06 in `463be60` (settle and storage faults), `b017d67` (lazy recovery and owner lock), `9d639aa` (close and failure reporting) and the cold-review fix commit that follows them, all against fake backends only. Decisions taken: lazy recovery everywhere; crashed queued and starting runs become `cancelled`; a persist failure mid-run keeps the in-memory state and marks the run storage-degraded; `unhandledRejection` is logged and survived, `uncaughtException` is logged, shut down within 5 s and exits 1; reused owner PIDs are detected from `ps -o etime=`; lock refusals stay `VSUP_INVALID_STATE` with `details`; programmatic runs keep `end_turn` and warn on an empty final message; `vibe_status` shows supervisor diagnostic text up to 400 characters.

A cold review of `f9d34da..9d639aa` raised thirteen findings, all fixed with tests that failed first: stderr tails could leak the API key (redaction now runs on the whole buffer before the cut, and the child's key is a known secret in probes, git and doctor); a continued review kept the first turn's integrity; the owner lock misread `ps` start times under a different `TZ`, and two processes could both clear a stale recovery lock; `runs cleanup <id>` removed a resumable run's worktree; a backend `completed` could override a supervisor cancel or timeout; continuing an ACP session whose process had exited hung until the deadline; a worktree created just before a crash could never be removed; overlapping or failing `vibe_close` calls could stick in `closing`; and four error labels were misleading (session-load timeout, missing interpreter, mid-turn ACP error, `EMFILE`). The session-load timeout is now 30 s. Residual: the stale-recovery-lock claim has a narrow third-racer window between the claim and a put-back; it needs three simultaneous starts on one data directory.

Behavior changes worth knowing for rc.4: `vibe_close` always ends `closed` and returns `worktree_removed`, `worktree_retained_reason` and, when a step failed, `error`; closing a closed run with `cleanup_worktree` retries only the removal; `runs cleanup <id>` refuses unless the run is `failed`, `cancelled` or `closed`; a missing `diff.patch` is exported before a worktree is removed.

### Phase B, latency

Status: implemented on 2026-10-07 against fake backends, together with a follow-up to rc.4 isolation. A cold review of `0882ff6..b69fe9d` raised nine findings, all fixed with tests that failed first: patch export wrote a `sharedindex.*` into the source `.git` when `core.splitIndex` was on (now disabled for every git call, verified byte-for-byte on a split-index repository and a linked worktree); `retention.days = 0` let the automatic sweep delete unread completed runs (completed runs now need at least one day); a missing or replaced events path looped until a wrong `VSUP_OUTPUT_LIMIT` (now bounded retries and `VSUP_STORAGE_ERROR`, stderr only); an unreadable event log made a run impossible to close (now closable, with coded errors); a Vibe upgrade looked like a lost session on `vibe_continue` (now `VSUP_VIBE_VERSION_UNSUPPORTED`); cleanup of runs exported by rc.4 refused on patch order (now compared per file section); a review continued after a restart reported `changed` without paths (the launch manifest is now persisted, and a run without one is `unverified`); a failed `close()` after a synced write duplicated events; and the retention test did not reach its guards. The snapshot entry cap counts files again, with a separate one-million total-entry bound. Known limit: a run directory deleted mid-run loses its earlier events. Decisions: hybrid review snapshot; no availability probe for an explicitly selected backend (kept for `auto`, `doctor`, `test-acp`); event fsync coalesced to at most every 100 ms; `vibe_status` embeds the compact result once a run settles. The `which` and Keychain items were dropped after measurement (2.7 ms per `which`; browser login needs one `security` call).

Measured on the preparing machine (macOS arm64, Node 24.19), before → after:

| Path | Before | After |
|---|---|---|
| Review snapshot, 156,169-file tree (mostly `node_modules`), per pass, two passes per review | 30.2 s | 2.6 s (almost all stat scan) |
| Patch export, 1 modified + 50 untracked files | 1.6–2.1 s | 0.13 s |
| Event persistence, 1,000 events | 4.8 s (4.8 ms each) | 18 ms |
| Explicit-backend start | probe launch + session launch | session launch only |
| `initialize` with 200 retained runs, 1 MiB logs each | reads every log | < 300 ms, logs load on demand |
| Test suite | ~35 s | ~26 s |

Isolation follow-up: `serve --stdio --isolated` now adopts the most recently used `mcp-sessions/session-*` directory whose owner lock is free (claiming the lock before use and handing it to the run manager), refreshes its `config.toml`, and creates a new directory only when every existing one is held by a live server. Directories are bounded by simultaneous clients and runs survive a reconnect.

Behavior changes for the next release notes: settled `vibe_status` includes `result`; the compact result carries `next_action`; retention runs automatically after the server is serving (first sweep after 5 s, then every 24 h) and also removes `completed` runs past retention without a live session; `configure-codex` writes `startup_timeout_sec = 30`; an explicit backend reports version mismatches from the real start; a recovered review run reports `changed` without paths, even after a mere touch, because only a digest of the launch manifest is persisted; nested repositories and submodules are compared by stat only.

Target-machine measurements still needed: P1 time to first event and to completion, cold and warm, both backends; P2 probe cost before and after B5; P3 `import vibe` and `security` lookup time; P4 events per hosted run.

### Phase C, lean surface

Status: implemented on 2026-10-07 against fake backends. A cold review of `6397e2c..988dc5d` raised nine findings plus test gaps, all fixed with tests that failed first: lossless `vibe_status` paging through the MCP result cap (events are trimmed from the end and `next_after_seq` follows the last delivered event); `next_action` offers `vibe_continue` only for runs whose own backend can continue; `allow`/`setup` say a server restart (or reconnect for `--isolated`) is needed; auth and missing executables are classified before rate limits, and only an explicit 429 or "too many requests" counts; `setup`/`allow` keep a backup before rewriting the config, expand `~` when comparing roots, refuse `/` and the home directory, and plan every change before writing; roots must be absolute or `~`-prefixed and executables absolute or bare names. The release workflow is kept in a separate local commit on `claude/release-workflow` until the push token has the `workflow` scope. Decisions: removed config keys load with a warning; no tool-side `backend`; `vibe_continue`/`vibe_respond` only with `acp` or `auto`; `vibe_cancel` folded into `vibe_close`; `test-acp` and `config validate` kept as aliases; this handoff stays at the root while evidence history moved to `docs/history/`; releases through GitHub Releases with `private: true`. The release workflow has not run yet (it runs on the first `v*` tag). The package is 194 kB packed, 137 files, without history, `.mcp.json` or `.codex-plugin`. Breaking changes for coordinators are listed in `CHANGELOG.md` under "Unreleased".

### Phase D, target machine and release

See [Phase D test plan](#phase-d-test-plan). Cut rc.10 or 1.0 after it.

Open decisions: whether to support Vibe 2.26.0 (released 2026-10-06) in 1.0, which needs the revalidation in [docs/compatibility.md](docs/compatibility.md) and a check that it still has the legacy harness; until then 2.26.0 is refused and the README's exact install command stays the only supported path. Whether the Keychain key may live in supervisor memory (dropped from Phase B because measurement showed no gain, kept open only if P3 shows a slow lookup). Settled: R3 (user, 2026-10-07): 1.0 supports the legacy harness only and the unified harness is validated before supporting a Vibe release that removes the legacy harness; hybrid snapshot (Phase B), ACP ships alongside programmatic (Phase C), GitHub Releases with `private: true` (Phase C).

## Platform research (2026-10-05)

Gathered from official release pages and docs via summarized fetches; treat exact wording as lightly verified and recheck on the target machine.

- **Codex:** CLI 0.160.0 (2026-10-01) is the latest stable release; 0.162.0-alpha.14 is a pre-release. No separate desktop-app version was found. Models are now GPT-6 branded: Astra (most capable), GPT-6.1 Sol (default since 0.159.1), and GPT-6 Luna (efficient, about 100x cheaper per input token than Astra). GPT-5.5 retires from ChatGPT products on 2026-10-14; nothing in this repository pins it. Usage is metered in credits per token, MCP tool results count toward it, and cached input costs about 10%. MCP server options include `tool_timeout_sec` (default 60), `startup_timeout_sec` (default 10), `enabled_tools`, `disabled_tools`, and per-tool `tools.<tool>.output_token_limit`.
- **Vibe:** 2.25.8 (2026-09-23) was the latest release at the time; 2.26.0 followed on 2026-10-06 (PyPI, checked 2026-10-07), so the pin is now one release behind. Since 2.25.5 the unified harness is stable and the legacy harness, which this supervisor forces with `--legacy-harness`, is an escape hatch reported as deprecated. The changelog does not mention the nested-glob (B1) or Keychain (B2) issues. Vibe supports `--max-price`, `--max-tokens`, and per-agent `active_model`; the supervisor pins no model, so the model used in a fresh isolated home is undefined.
- **Mistral models:** Devstral 2 (256K context, $0.40 input / $2 output per million tokens) and Devstral Small 2 ($0.10 / $0.30).
- **ACP:** v1 is the stable version and v2 is a draft (2026-07-20). A user rejection is `selected` with a reject-kind option; `cancelled` is only for a cancelled prompt turn, and the client must answer pending permission requests with `cancelled` when it cancels the turn.

Token and speed work decided after the research, all implemented and tested against fake backends only:

1. Done: `vibe_status`, `vibe_review_start` and `vibe_edit_start` take `wait_seconds` (0–300) and return on a new event, a state change, a pending request, or a state where the coordinator must act. The wait is event-driven and honors MCP request cancellation and shutdown. `configure-codex` writes `tool_timeout_sec = 600`.
2. Done: `limits.mcp_result_format` (`text` default, `structured`, `both`) sends the JSON once; `max_mcp_result_chars` defaults to 8000; `vibe_result` defaults to `detail: "compact"` with patches up to 4000 bytes inline (`summary` is kept as a deprecated alias); `vibe_status` defaults to 10 events. Measured on a typical edit run: status 4912 → 1403 bytes, result 4102 → 2115, start 1064 → 559. The `text` default assumes Codex reads the text block (check R1).
3. Done: probes are cached per backend instance (10 minutes on success, 30 s on failure, keyed on the executable and launcher interpreter path and stat, single-flight, with a `fresh` bypass). In the fixture setup, a run's availability checks drop from two spawns to none once the cache is warm.
4. Done: rejections are sent as the selected reject option; `cancel()` and `close()` answer a pending permission request `cancelled` (an elicitation `cancel`), send `session/cancel`, and allow up to 500 ms for the turn to end before terminating. Uncorrelated or duplicate permission requests also get the selected reject option, with `cancelled` only when no reject option is offered. Unverified against real Vibe: that it continues after a selected reject, and that 500 ms is enough.

Also found while fixing item 4: the fake ACP fixture read `answer.result.outcome`, so allow and reject both ended the turn `cancelled`. Both the permission and elicitation modes are now fixed. The old elicitation backend test had passed under the bug because it only waited for `completed`; it now asserts `end_turn` after accept and `cancelled` after decline or cancel.

Test isolation: the compat-probe tests ran `scripts/compat-probe.mjs` against the shared `dist/`, so a concurrent `npm run build` (for example inside `verify:release`) could make them fail with exit code 2. This was reproduced with a background rebuild loop and is the most likely cause of an earlier one-off failure. A vitest global setup now builds once per run into a private directory under `node_modules/.cache` and passes it through `VIBE_SUPERVISOR_DIST_DIR`.

Considered but not implemented: a Codex profile that runs the coordinator on Luna with low reasoning effort (user configuration, not repository code), pinning Vibe's `active_model` and passing `--max-price` per run (needs a model choice), and replacing the full-tree review hash with a git-based fingerprint.

Target-machine checks added by the research (run alongside the field test plan):

- **R1:** confirm whether Codex passes a tool result's text, its structured content, or both to the model, and whether it forwards MCP progress notifications. This decides how far result shaping can go.
- **R2:** confirm a waiting `vibe_status` call completes within the registered `tool_timeout_sec` in both the CLI and the desktop app.
- **R3** (settled 2026-10-07: 1.0 supports the legacy harness only; this check is optional D19): validate the permission profile under Vibe's unified harness (without `--legacy-harness`) before Vibe removes the legacy harness: repeat T4, T9 and T12 in both harnesses and record any differences.
- **R4** (answered 2026-10-05: `mistral-medium-3.5`): record which model a fresh isolated home actually uses (from the run's private session records) before deciding whether to pin `active_model`.

## Phase D test plan

This plan replaces the 2026-10-05 field plan (now in the [handoff history](docs/history/handoff-2026-10-05.md)) for the surface introduced in rc.6 and current in rc.7: `setup`, five tools for programmatic or seven for `acp`/`auto`, no `vibe_cancel`, no `test-acp` as a primary command. It also absorbs the open research checks R1 to R3 and the Phase B measurements P1 to P4. Its goal is the evidence for the 1.0 decision.

Ground rules:

- **Machine:** the target Mac with Vibe 2.25.8 installed (`uv tool install mistral-vibe==2.25.8`) and browser login done once with `vibe`. Install rc.10 (or later) from `release/0.9.0-rc.9/` after `shasum -a 256 -c SHA256SUMS`. Vibe 2.26.0 is already out: before the session confirm `vibe --version` prints 2.25.8 and reinstall with the pinned command if it changed; a newer Vibe makes every run fail with `VSUP_VIBE_VERSION_UNSUPPORTED`.
- **Workspace:** a throwaway Git repository with no secrets, containing nested source files, a root `.env` with a fake value, an ignored `node_modules/` (any size; a large one also serves D7), and one file outside the repository to try to read.
- **Cost and consent:** hosted steps send that repository and the tasks to Mistral and are billed; run them only with the owner's authorization. Earlier hosted edits cost about $0.02 each, so the soak (D18) is the only step with noticeable cost.
- **Stop rule:** stop at the first failing step, record it, and never work around it by weakening policy (no `always` fallback, no shell, no network, no project trust, no editing the generated agent profiles).
- **Recording:** one dated section per session in [docs/history/acceptance.md](docs/history/acceptance.md), machine-readable status in `docs/acceptance.json`, raw evidence (redacted JSON replies, timings, logs) in `docs/history/reviews/rc7-target-test-<date>/`, started as a copy of the [evidence template](docs/history/reviews/phase-d-template/Read.md). Record exact commands, versions, run IDs, timings, PASS or FAIL, and what stays uncertain. Never record credentials; `security` is only ever called without `-w` in these steps.

### Install and setup

| ID | Step | Expected | Covers |
|---|---|---|---|
| D0 | Record macOS version and arch, Node, npm, Git, `vibe --version`, the Vibe Python path, Codex CLI and desktop versions, the rc.10 tarball sha256. | All recorded. | Baseline |
| D1 | `npm install -g ./vibe-supervisor-0.9.0-rc.10.tgz` (or `--prefix` into a private prefix); run the installed `vibe-supervisor --version` directly, not through `node`. | Installs offline-capable files only; prints `0.9.0-rc.9` from the installed executable. | Release install |
| D2 | `vibe-supervisor setup --workspace <repo>` without `--yes`, then again with `--yes`; then `vibe-supervisor doctor --json`. | First run prints the planned Codex change and writes nothing to `~/.codex`; second run writes it, keeps a `.bak` of an existing supervisor config, prints the restart note; `[paths]` holds absolute `vibe`/`vibe-acp`; doctor has no required failure and no ignored-key warning. Running `setup` a third time changes nothing. | C3 setup, plan-then-write |
| D3 | Restart Codex desktop; open a new chat; list the supervisor tools. Then set `backend = "acp"`, restart, list again. | Five tools for programmatic; seven for `acp` (adds `vibe_continue`, `vibe_respond`); no `vibe_cancel`; the descriptions mention `wait_seconds`, `stop_reason` and closing. | C2 surface, registration |
| D4 | From a source checkout of the `Cut 0.9.0-rc.10` commit: `npm run compat:probe -- --out <file>`; repeat the manual `tool_path_resolver` check for a nested file, root `.env`, an outside path and a symlink to outside, in review and edit mode. | Probe checks PASS; nested in-root files ALWAYS, the others NEVER, in both modes. | Pin, B1 regression |

### Hosted programmatic runs (backend `programmatic`)

| ID | Step | Expected | Covers |
|---|---|---|---|
| D5 | In Codex, ask for a review of a nested file. Let the coordinator follow the skill: `vibe_review_start` with `wait_seconds` 120 to 300, then `vibe_status` with `wait_seconds`, then `vibe_close`. Do it once right after a supervisor start (cold) and once again (warm). | Three tool calls per run; the settled `vibe_status` carries `result` with `stop_reason: end_turn`, `next_action`, `integrity.status: verified`; P1: record time to first event and to `completed`, cold and warm. | B4 loop, P1, R2 |
| D6 | While D5 runs: `ps -axww -o pid,command` and a listing of the run directory. Afterwards inspect `transcript.md`, `events.ndjson`, `result.json`, `launch-manifest.json`. | No task text in any argv; `task-prompt.txt` gone once Vibe starts; no reasoning text; events in order; manifest owner-only. Record the event count (P4). | T7, T8, P4 |
| D7 | Two reviews: during the first, edit a tracked file by hand; during the second, only `touch` a tracked file and rewrite a file under `node_modules/` with the same content. Time the launch snapshot on the large `node_modules/` (from the run's events or by timestamps). | First: `changed` with that path; second: `changed` with only the ignored `node_modules/` path. The tracked touch is ignored after content-hash comparison, but the ignored rewrite changes its stat and is reported even when content is identical. Snapshot time recorded against the 2.6 s preparing-machine figure. | B1 hybrid snapshot |
| D8 | Edit run that changes one file and creates at least ten new files; read the result; `vibe_close` with `cleanup_worktree: true`. | Patch exported and applies to the base; source checkout untouched; worktree removed with `worktree_removed: true`. Record export time. | B2 export, close |

### Hosted ACP runs (backend `acp`)

| ID | Step | Expected | Covers |
|---|---|---|---|
| D9 | Review, then `vibe_continue` with a follow-up after it completes. | Same session continues; each turn has its own `stop_reason` and integrity; zero permission requests. | Continuation |
| D10 | Start a longer task and call `vibe_close` mid-turn. | Run ends `cancelled`, then `closed`; never `failed`; no Vibe process left (`pgrep -fl vibe`). | T11 cancel via close |
| D11 | Restart the supervisor (quit and reopen Codex) once after a run completed and once while a run is in progress; then `vibe_continue` on each. | Startup is fast and starts no Vibe process; the completed run reloads lazily and continues; the interrupted run is `recoverable` and continues, or fails with an accurate code; never a replay of the original task. | T11 restart, lazy recovery |
| D12 | Set `worker_idle_ttl_seconds = 60`, restart, complete a run, wait more than 60 s, then `vibe_continue`. | `idle_expired` event; the continuation reloads the session lazily. | T11 idle expiry |
| D13 | Policy probes in a review: ask Vibe to read the outside file, read `.env`, and write a file; in Codex try to pass `allow_shell: true` to `vibe_edit_start`. | Outside and `.env` reads refused; review write refused; `allow_shell` rejected as an unknown field; permission requests counted (expected zero). | T12, gate 3 premise |

### Clients, failures and research checks

| ID | Step | Expected | Covers |
|---|---|---|---|
| D14 | `vibe-supervisor setup --workspace <repo> --isolated --yes`; use Codex desktop and the Codex CLI at the same time; then restart Codex desktop. | Both clients work; the desktop's stderr line says `adopted` after the restart and its earlier run is reachable by ID; at most two `mcp-sessions/session-*` directories. | Isolation reuse |
| D15 | Without `--isolated`, open a second client on the shared directory; point `paths.vibe` at a missing file and start a run; restore it. | The second client fails with a message naming the lock path and owner PID; the missing executable gives `VSUP_VIBE_NOT_FOUND`. | Lock, error labels |
| D16 | R1: record what the model sees from a tool reply (text, structured content, or both) and whether progress notifications appear. R2: a `vibe_status` call with `wait_seconds: 300` in both the desktop app and the CLI. | R1 answered; R2 returns before the 600 s `tool_timeout_sec`. | R1, R2 |
| D17 | Measurements: P2 `time vibe-supervisor doctor` (probe cost, cold); P3 Vibe import time with the Vibe interpreter (`python -X importtime -c "import vibe"`, total only) and `time /usr/bin/security find-generic-password -s ai.mistral.vibe -a MISTRAL_API_KEY` (no `-w`, output discarded); P4 event counts from D5, D8 and D9. | Numbers recorded next to the Phase B table. | P2 to P4 |

### Soak and platforms

| ID | Step | Expected | Covers |
|---|---|---|---|
| D18 | Hosted soak of 100 runs through the official MCP client with `scripts/soak.mjs` (four hosted attempts so far, all FAIL; see [Phase D results](#phase-d-results)): 60 programmatic reviews, 30 programmatic edits and 10 ACP runs with continuations, mid-turn `vibe_close` and supervisor restarts spread through them. On the target machine, from a source checkout after `npm ci && npm run build`, with the workspace already allowed (`vibe-supervisor allow <repo>`): `node scripts/soak.mjs --workspace <repo> --reviews 60 --edits 30 --acp 10 --out <evidence-dir> --server-command node --server-arg dist/cli.js --server-arg serve --server-arg --stdio --yes` (omit `--yes` to print the plan, run count and cost warning and start nothing; omit `--server-command` to use `vibe-supervisor` from PATH; `--seed`, `--tasks <file.json>`, `--wait-seconds`, `--run-timeout`, `--stop-on-fail` are optional). The driver copies the template `config.toml` (`VIBE_SUPERVISOR_HOME` or the default home) into private `home-programmatic` and `home-acp` under `--out` with only `backend` changed, runs one server per home, follows the coordinator loop (start with `wait_seconds`, `vibe_status` with `after_seq`, `vibe_close`, `cleanup_worktree` for edits), and never approves a request: a permission request is answered with the offered reject option, recorded, and fails the criterion. It writes `runs.ndjson` (per run: task id only, tool calls, events, time to first event and to settled, final state, `stop_reason`, error code, warnings, integrity, usage and cost, worktree removal, restart and mid-turn-close outcome, failures), `summary.json` (totals per kind and backend, p50 and p95 latencies, failures by code, leftover processes by `pgrep -fl vibe` against a baseline counting only orphaned or driver-descended ones, leftover worktrees, artifact bytes per home, retention check, PASS or FAIL per criterion) and the redacted server stderr; the exit code is 0 only when every criterion passes. Limits: runs execute one at a time (no concurrency stress), cost is the supervisor's non-authoritative figure, and the restart scenarios stop the server gracefully (as quitting Codex does), not by SIGKILL. | Zero unexpected failures, truncated runs (truthful `max_turn_requests` or `max_tokens` with the partial warning) at or under `--max-truncated-percent` (default 10), zero permission requests, no leaked processes or worktrees, bounded artifacts, retention leaves recent runs. Use the built-in bounded tasks; a `VSUP_NO_PROGRESS` run is an unexpected failure to investigate, not a pass. Report each attempt separately and never rewrite earlier failures. | Gate 3 hosted soak |
| D19 | Optional, not a 1.0 criterion (R3 decision, 2026-10-07: 1.0 supports the legacy harness only): repeat D4, D9 and D13 with the unified harness (a build without `--legacy-harness`). | Record differences. | R3 |
| D20 | Repeat D0 to D5 on an Intel Mac and on a clean macOS account. | Same results. | Gate 6 |
| D21 | ACP turn budget: use a four-file sequential pointer chain ending in one small result-file write (each next filename learned from the preceding read), with an ACP edit at `max_turns: 3` driven to `max_turn_requests`; `vibe_continue` without `max_turns`, then with `max_turns` equal to and below the limit; then with `max_turns: 10` and a same-objective continuation; repeat the last step after a supervisor restart. Preserve changed fixtures as separate attempts and reserve steps for the final answer. See the [controlled continuation follow-up](docs/history/reviews/rc8-continuation-followup-2026-10-08/Read.md). | The first three are refused (`VSUP_TURN_LIMIT_REACHED`, `VSUP_INVALID_ARGUMENT`) and send no prompt (no new Vibe activity); the raised continuation does useful work and ends `end_turn`, also after restart. Record whether Vibe accepted every `set_config_option` value. | Field lesson 1 |
| D22 | Client shutdown in the Codex desktop app and the official client: quit or disconnect after start, continue and close; while a run is running; with an idle completed ACP session. | The client and the server exit within seconds; no Vibe process (`pgrep -fl vibe`), owner lock or worktree remains. Attribute any residue to its owner before acting. | Field lesson 2 |
| D23 | ACP worker lifetime: start an ACP review with `timeout_seconds: 60`, let it complete, wait 90 s (inside `worker_idle_ttl_seconds`), then `vibe_continue` with a task that runs longer than a minute. | The continuation finishes, or ends by the supervisor's own deadline as `VSUP_TIMEOUT`; never `VSUP_BACKEND_CRASHED` from the launcher killing the worker. | rc.7 W14 fix |
| D24 | Programmatic turn limit: a programmatic review of the whole repository with `max_turns: 2`. | `completed` with `stop_reason: max_turn_requests` and the partial-result warning; the saved `result.json` matches the reply; no crash code. | Turn-limit report |

Exit criteria for 1.0: D0 to D18 and D21 to D24 pass; D20 passes at least on a clean account; D19 is optional because 1.0 supports the legacy harness only; the release workflow is pushed and its first tagged run produces the release assets. The workflow is ready on the local branch `claude/release-workflow` but cannot be pushed until the push token has the `workflow` scope, so this criterion is blocked independently of the target machine. The plugin scaffold is no longer packaged and stays out of scope for 1.0.

Before the session: rc.10 is built with the bounded soak tasks, the truncation threshold, the progress watchdog and the pre-1.0 cold-review fixes. After it: fix what failed, cut rc.11 or 1.0 accordingly.

Fixed after the hosted ACP continuation (2026-10-06): a turn that stopped with `max_turn_requests` used to be reported with the generic summary "Vibe completed the delegated task." The default summary now follows the stop reason (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`, or an unknown reason), any non-`end_turn` stop adds a warning naming it, and each continuation's result replaces the previous turn's summary and stop-reason warning while keeping unrelated warnings. The run state stays `completed`; the skills tell the coordinator to check `stop_reason` and warnings, not the summary.

Test fragility: the suite runs its files in parallel, and the Git worktree and soak tests take 1–3 s alone but could exceed the 5-second default under CPU load; `vitest.config.ts` sets `testTimeout` to 15 s (2026-10-07). Two real races found while chasing such failures were fixed instead of timed out: a test that read temporary files mid-rename (`stderr-secrets`) and ACP deadline writes after close (W14).

A next maintainer should inspect Git status, read this handoff and `README.md`, reproduce local checks when making code changes, and finish those gates before claiming production readiness. Hosted validation sends source/tasks to a provider and may incur usage charges; keep it within user-authorized scope. Record exact versions, commands, outcomes, and remaining uncertainty in acceptance/compatibility docs. Any new version support requires renewed shim, profile, protocol, and effective-tool validation.

## Phase D results

### rc.8 sessions (2026-10-08)

Target machine, macOS arm64, Vibe 2.25.8 with the existing browser login, official MCP client, synthetic repository. Full notes as written during the sessions are in [rc.8 handoff notes](docs/history/handoff-rc8-2026-10-08.md); evidence in `docs/history/reviews/rc8-*`.

| Step | Result |
|---|---|
| D1 install | FAIL for the original rc.8 package: the npm-linked `vibe-supervisor` printed nothing because the main-module check compared a resolved URL with the unresolved symlink path. Fixed (realpath before the comparison), with subprocess regressions and an offline smoke that now runs the installed executable. [Evidence](docs/history/reviews/rc8-cli-entry-fix-2026-10-08/Read.md) |
| D2, D3, D4 | PASS within scope: project-scoped setup plan, write and repeat; five and seven tools through the official client; compatibility checks and installed-profile tests. Codex desktop not exercised |
| D5 reviews | PASS: cold and warm nested reviews found the arithmetic bug, `end_turn`, integrity verified |
| D15 | PASS: second shared client refused with owner PID and lock path; `VSUP_VIBE_NOT_FOUND` saved identically in `result.json` |
| D21 turn budget | First trial FAIL (run `c20da652`): refusals correct and nothing sent, but after raising 3 to 10 the worker resumed its original nine-file chain and hit the cap again. Diagnosis: the correction and the new ceiling were delivered; the fixture did not fit. Three controlled runs then PASS (explicit cancel of the old objective; four-file same-objective continuation; same after a restart). The plan now uses the four-file fixture. [Evidence](docs/history/reviews/rc8-continuation-followup-2026-10-08/Read.md) |
| D22 shutdown | PASS through the official client: disconnect while running leaves `recoverable`, idle session's worker removed, closed sessions' servers exit in 3 to 5 ms. Codex desktop not exercised |
| D23 worker lifetime | PASS: continuation after 90 s idle ended by the supervisor's `VSUP_TIMEOUT` at 61.3 s, not by the launcher |
| D24 programmatic cap | PASS: `completed`, `max_turn_requests`, partial warning, matching saved result |
| D18 soak, attempt 3 | FAIL at 20/100: 19 passed, then an edit emitted no event until the driver's 900 s deadline; worker alive with an open HTTPS connection; cause unknown, not recurred. The driver deadline was below the worker's 2400 s deadline; fixed in the driver. |
| D18 soak, attempt 4 (with diagnostics) | FAIL at 1/100: a review made 16 `grep` and 4 `read_file` calls and hit `max_turn_requests` at 20 turns after 21.4 s; truthful report, model-side. [Evidence](docs/history/reviews/rc8-stall-diagnostics-2026-10-08/Read.md) |
| Bounded follow-up | PASS: a review capped at 2 reads and no searches found the bug with `end_turn`; an ACP edit, a same-session correction and a cleanup-inventory turn passed independent scope and numeric checks; worktree removed. Two coordinator harness errors kept as such. [Evidence](docs/history/reviews/rc8-bounded-followup-2026-10-08/Read.md) |
| Bounded pilot before a new soak | FAIL on the private tool-count audit: the review ended `end_turn` in 21.5 s, verified integrity, found the bug, but made 5 `read_file` calls against an instructed limit of 3 and claimed compliance. No full soak started. Since merged into main, that audit is reported as task compliance in `summary.json` and no longer fails the soak. [Evidence](docs/history/reviews/rc8-bounded-pilots-2026-10-08/Read.md) |
| D19, D20, callbacks, Intel | Not run |

Follow-ups decided on 2026-10-08: bounded soak tasks with a final-answer instruction, a separate count for truthful truncation instead of failing the soak, and a supervisor progress watchdog so a silent worker ends with its own error instead of waiting for the run deadline.

### Target-machine housekeeping

On the target machine the managed checkout is `/Users/roman/.codex/worktrees/rc7-target-tests/codex-vibe`; its ignored `release/` archives must be preserved before archiving it. Keep `/private/tmp/codex-vibe-rc2-npm-cache` (the populated packaging cache). The private test roots `/private/tmp/rc8-phase-d-6n1ney4v` and `/private/tmp/rc8-diagnostic-soak-o3bq8bg_` are kept for diagnosis and hold private native histories that must stay out of public artifacts. An end-of-thread cleanup there was interrupted during inventory and removed nothing.


### Phase D results, first session (2026-10-07, rc.7)

Fetched and tested `f30f8d7` in an isolated checkout while preserving the dirty primary checkout. Offline source installation, release packaging/checksums, 596 TypeScript tests (including the two real installed-Vibe profile tests), Python tests and compatibility checks passed. Hosted nested reviews, an independently verified eleven-file edit, ACP continuation, completed/in-progress graceful restart loading, idle expiry and synthetic policy refusals passed through the official MCP client. Native desktop registration, long waits in native clients, clean-account/Intel and callbacks remain unverified.

The D7 test-plan expectation was corrected to match the existing hybrid snapshot contract: a tracked touch is unchanged after hash comparison; an ignored same-content rewrite reports changed by stat. No runtime policy changed. D18 then stopped at run 1/100: Vibe reached the 12-turn cap and exited 1, classified as VSUP_BACKEND_CRASHED. The saved result lacks the error that remains in run metadata. The hosted soak gate did not pass; investigate before rc.8/1.0. See [dated evidence and exact scopes](docs/history/reviews/rc7-target-test-2026-10-07/Read.md). No commit, push, global registration or upstream release was performed.

### Turn-limit and saved-result correction (2026-10-07)

The two defects from the first D18 attempt are corrected in the isolated f30f8d7 checkout: a strictly confirmed pinned programmatic limit exit now reports completed/max_turn_requests with an incomplete-result warning, and result.json includes settlement/fallback errors before state finalization. Seven process-backed marker/conflict tests and saved-error assertions across settlement paths passed; full release verification passed 603 tests in 53 files, Python tests, real installed-Vibe profiles, lint/typecheck/build, offline package smoke and checksums. A locally patched rc.7 package is preserved; no upstream release was cut.

The original 60/30/10 hosted soak was retried with unchanged tasks, seed, workspace and limits. It stopped at run 1/100, d9ce1a35-e7c4-43d4-b619-32383d3353af, now accurately rejected by the driver as driver:stop_reason_max_turn_requests rather than a backend crash. No requests/leaks were recorded. The code defects are resolved; reliable task completion within the declared budget remains the release blocker. Preserve the failure, explicitly scope the soak tasks to the available tools/fixture paths or document a deliberate budget decision, then rerun the full plan. Native desktop/platform/callback gates remain unverified. See [implementation and verification evidence](docs/history/reviews/rc7-turn-limit-fix-2026-10-07/Read.md).

### Follow-up decisions (2026-10-07)

The user chose both remedies for the soak blocker. The default review budget `limits.max_turns_review` is now 20, matching edits, because a broad hosted review exhausted 12 turns in 15 to 27 seconds. The soak driver's built-in review tasks now name a starting file, state that only the file read and search tools exist (the hosted transcripts show attempts to call `bash` and repeated filename greps) and cap the files read. The two failed attempts stay recorded as failures; the next soak runs with the new defaults and tasks against rc.8 and is reported as a new attempt, not a rerun of the original plan.

**Delivery status:** the rc.7 fixes, handoff and dated test evidence were committed as `042f641` on `codex/rc7-testing-fixes` on 2026-10-07 and merged into main the same day; the field lessons followed as `b76f6b6` on 2026-10-08. Earlier “no commit/push” statements describe their original test sessions. No new package was published. This field-lessons update changes documentation only; no new runtime tests, hosted runs, configuration changes or deployment were performed.

## Design references

- [Private RC decision](docs/history/adr/0001-private-release.md).
- [Protocol and security boundary](docs/adr/0002-protocol-security-boundary.md).
- [Pinned launcher decision](docs/adr/0003-vibe-launcher.md).
- [Detailed compatibility findings](docs/compatibility.md).
- [Security contract](docs/security.md) and [release acceptance](docs/history/acceptance.md).
- [Plugin scaffold status](README.md#status-and-plugin-scaffold).
