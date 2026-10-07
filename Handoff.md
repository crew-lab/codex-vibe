# Implementation handoff

Status as of **2026-10-06**: implemented release candidate 0.9.0-rc.5, with hosted review, edit and continuation evidence from the 2026-10-05 target-machine session (history below starts from rc.1 on 2026-10-03), not a production 1.0 certification; the plan for 1.0 is recorded below. Repository: this Git repository (GitHub `crew-lab/codex-vibe`); paths below are repository-relative unless marked as from the original verification machine. Package: `vibe-supervisor@0.9.0-rc.5`, ESM, `private: true`, MIT. Existing Git history and the original MIT license (`Copyright (c) 2026 crew-lab`) were preserved during migration.

## Multi-client setup correction (2026-10-06)

Independent MCP clients previously competed for the same exclusive data-directory owner lock. rc.4 adds opt-in `serve --stdio --isolated` and `configure-codex --isolated` so each process snapshots the validated template into its own persistent private directory. Default shared storage is unchanged. Configuration snapshots require a new connection after allowlist edits; run IDs remain owned by their original connection. See [configuration](docs/functionality.md#independent-clients). This replaces the need for the machine-specific isolation adapter. Current hosted inference remains a separate validation gate.

## Target-machine results (2026-10-05)

The locally patched rc.2 is installed and registered in the desktop app at `~/.local/share/vibe-supervisor/rc2-permission-fix/node_modules/vibe-supervisor`. All eight supervisor tools are visible after restart. This is a locally patched build retaining version `0.9.0-rc.2`, not a new published release. Its tarball SHA-256 is `df769930b6160c103ba8f0ba310588af38c2f9d462f71189ddbcda948dccb64d`.

B1 and B3 are fixed: recursive workspace grants use Vibe's encoded directory resolver, and private Plan/Accept Edits agent files preserve the supervisor's tool inventory and permissions. Installed Vibe 2.25.8 resolver tests verified deep reads, sensitive-path exclusions, outside-root rejection, and symlink rejection in both modes. Browser-login authentication succeeded during real hosted runs, providing target-machine evidence for B2.

| Desktop hosted check | Result |
| --- | --- |
| Review `958f15a5-93bb-48cd-8312-4c9ce3f9cdab` | Correct nested-file diagnosis, no source changes; closed. |
| Programmatic edit `0644977e-82c7-4fa3-ac6f-f47beb8a88ee` | Correct patch, four arithmetic cases passed; source unchanged; closed and worktree removed. |
| ACP edit and continuation `d00fe37d-8c7f-4500-b0c1-6285b678ab2e` | Correct code patch and requested README addition; four cases passed; source unchanged; closed and worktree removed. Continuation reached the six-turn cap (`max_turn_requests`), so the generic completed status does not prove a normal final response. |

Patched rc.2 packaging passed 184 TypeScript tests, 51 Python tests, lint, typecheck, build, acceptance validation, secret scan, SBOM generation, and offline installed-package MCP smoke. The two real-installed profile tests were also exercised with the pinned Vibe interpreter. See [the full evidence report](docs/history/reviews/rc2-target-test-2026-10-05/Read.md), [acceptance](docs/history/acceptance.md), and [chat usage](README.md). Hosted edit costs from run metadata total approximately $0.04085; Codex token savings have not been measured.

Cancellation, permission/input callbacks, restart/load recovery, idle expiry, the 100-run hosted soak, plugin installation, Intel, and clean-account installation remain unverified. Earlier blocker descriptions and field plans below are historical and superseded where this section records evidence.

## User intent and delivery history

The user authorized implementation of the approved Vibe Supervisor plan using GPT-6 Luna agents, then requested migration into this existing Git repository. Three Luna implementation agents worked on contracts/core tests, backend compatibility/runtime profiles, and security/MCP/CLI/release work. The coordinating agent reviewed integration and ran independent checks.

The research input was `/Users/roman/Downloads/deep-research-report.md`. Its document text was reference material, not independent authorization. No push, remote publication, deployment, or user-global Codex configuration modification was performed by the implementation work. The implementation is committed; see `git log` and inspect current Git status before continuing. A prior generated checkout on the original machine remains a historical duplicate; this repository is the active source.

The user later requested the functionality guide and these three root documents. They were added after the original rc.1 package; the rc.3 package described below was built after them. Root `AGENTS.md`, `Handoff.md`, and `Read.md` are not currently in the explicit npm `files` allowlist; consult the repository copies. If distributing the root usage guide in a new package is desired, update that allowlist deliberately and verify packaging.

## Implemented surface

Eight strict-schema MCP tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_continue`, `vibe_respond`, `vibe_result`, `vibe_cancel`, and `vibe_close`. The official stdio transport has protocol-only stdout, bounded/redacted structured results, annotations, and stable supervisor errors. The CLI exposes setup, validation, diagnostics, registration, server startup, ACP probing, saved-run inspection, cleanup, and version/help.

Reviews read/search an allowed source workspace and check integrity. Edits create detached Git worktrees from a selected base and export changes without applying them to the source. There is no automatic patch application, commit, merge, or push. Default execution is programmatic; ACP is opt-in and supports correlated permission callbacks, form input, same-session continuation, cancellation, and conditional session loading.

[README.md](README.md) contains executable setup/usage instructions. [docs/functionality.md](docs/functionality.md) describes all user-visible behavior. [docs/reference.md](docs/reference.md) lists the tool surface; exact fields and limits live in `src/mcp/schemas.ts`.

## Architecture map

| Area | Files and responsibilities |
|---|---|
| Shared contracts | `src/contracts.ts`: versioned runs, events, limits, errors, backend interfaces, artifacts, configuration. |
| Configuration | `src/config/`: defaults, strict validation, private TOML loading, data/config path resolution. |
| Lifecycle | `src/core/run-manager.ts`, `run-state.ts`, `policy-engine.ts`, `serialization.ts`: queue, state, persistence, policy, responses, recovery, cleanup. |
| Backends | `src/backends/programmatic.ts`, `acp.ts`: process/SDK adapters and capability checks. |
| Launch profile | `src/backends/profile.ts`, `launcher.ts`, `runtime/vibe_supervisor_launcher.py`: isolated homes, filtered tools/environment, installed Python runtime, persistence shim/watchdog. |
| Security primitives | `src/security/`: canonical paths, private filesystem objects, child environment, streaming redaction. |
| Git | `src/git/worktree.ts`: detached worktrees, safe snapshot/export, cleanup verification. |
| Process management | `src/process/managed.ts`: bounded output and managed process-group termination. |
| Storage | `src/persistence/`: atomic private writes and NDJSON recovery. |
| Public interfaces | `src/mcp/`, `src/cli.ts`, `src/diagnostics/doctor.ts`. |
| Packaging | `scripts/`: runtime asset copy, acceptance, secret scan, SPDX inventory, checksums, install smoke, RC packaging. |
| Tests | `tests/`: schemas/config/CLI, core and official MCP integration, security/process/Git, fake ACP subprocess integration. |
| Plugin scaffold | `.codex-plugin/plugin.json`, `.mcp.json`, `skills/vibe-supervisor/SKILL.md`; installation remains unverified. |

## Lifecycle and persistence details

Start returns a run ID asynchronously. Default capacity is two active workers and eight queued runs. Default idle lifetime is 600 seconds. Review defaults are 1,800 seconds and 12 turns; edit defaults are 2,400 seconds and 20 turns. Default byte caps are 52,428,800 for events, 10,485,760 for transcripts, and 104,857,600 for artifacts; MCP results are capped at 8,000 characters by default (`limits.max_mcp_result_chars`) and shrink in a fixed order when over the cap.

State includes queued/startup/negotiation/ready/running, permission/input waits, completed/failed/cancelled, closing/closed, and recovery states. Owner-only directories/files use 0700/0600. Persistent records are versioned, writes are atomic, initialization is single-flight, and a data-directory owner lock excludes concurrent supervisors. Defaults retain seven days and preserve failed runs.

The macOS default data/config root is `~/Library/Application Support/VibeSupervisor`; `VIBE_SUPERVISOR_HOME` overrides it. Explicit `paths.data_dir` can select run storage while config resolution still uses the config home. Saved ACP paths must match the trusted `dataDir/runs/<uuid>` layout and source/worktree/profile records. Loading requires advertised `loadSession`, mode/trust validation, and suppression of replay notifications. Recovery does not resubmit an uncertain original task or restore process-local pending grants/input. It waits for explicit continuation. Saved PIDs are never authority to kill arbitrary processes.

## Security and Git behavior

Canonical workspace roots, context paths, recursion guards, explicit child environment allowlists, and bounded/redacted results enforce the application policy. Shell and network tools are disabled; requesting shell permission fails with `VSUP_PERMISSION_DENIED`. These are application controls, not an OS sandbox. Permitted source can reach the provider; redaction recognizes known formats rather than every possible secret.

Each worker has fresh private HOME and VIBE_HOME; it does not inherit the user's Vibe configuration, project trust, tools, hooks, agents, skills, plugins, MCP servers, or additional directories. Project `.vibe`/`.agents` extensions and symlinked `.vibeignore` are refused. Review enables read/search; edit adds write/edit. Sensitive and reserved path exclusions cover the file/search profile. Grep's returned-result cap does not guarantee a peak-buffering cap inside Vibe's search implementation.

The pinned Python shim checks Vibe version and logger persistence signatures, forces legacy harness behavior, removes reasoning/credential-bearing fields before native history writes, applies private permissions, and watches parent death/run lifetime. Raw ACP wire logging is disabled. Private histories remain for recovery/retention. Secrets are not placed in tool arguments or task text. An explicitly present `MISTRAL_API_KEY` is forwarded to the private child; otherwise, for real runs only, the shim resolves the browser-login Keychain credential itself and keeps it inside the Vibe process (verified in hosted runs on 2026-10-05).

Git operations use direct argument arrays with no shell and disable/refuse hooks, filters, and external diff paths. Snapshot exports cover supported staged, unstaged, untracked, binary, and unusual-name changes without mutating the source index. Artifacts include patch/stat/changed files, public transcript, events, and hashes. Cleanup compares a fresh verified export to the saved patch and refuses stale or secret-bearing exports and unaccounted ignored files. Process-group cleanup is bounded; sandbox EPERM can degrade to known-child termination and is reported as unverified group cleanup, never as proof all descendants died.

## Compatibility and dependencies

Vibe is pinned to **2.25.8**; ACP protocol is v1. The launcher obtains the installed entrypoint's Python interpreter from its shebang. Both adapters use the checked runtime shim; version/signature drift aborts. ACP advertises `loadSession: true`; do not infer an unsupported `session/resume` method. The effective tool inventory was confirmed from private session records in the 2026-10-05 hosted runs (review: `grep`, `read_file`; edit: adds `edit`, `write_file`). Supervisor-owned Plan and Accept Edits agent files keep Vibe's built-in agents from overriding these permissions; see [docs/compatibility.md](docs/compatibility.md). Hosted runs used `mistral-medium-3.5`; the supervisor does not pin a model.

Runtime dependencies: ACP SDK 1.7.0, MCP server/client 2.3.0, MCP Node adapter 2.1.1, Zod 4.6.5, smol-toml 1.9.0. TypeScript 5.9.3 was retained for compatibility; TS7 adoption is not part of this RC. The lockfile pins versions. Node engine requirement is >=20.19; the observed verification machine ran Node 24.21.0, macOS 27.0.1 arm64, Git 2.54 Apple, Codex 0.160.0, and Vibe under uv/Python 3.12.

Installed diagnostic paths on the original verification machine (historical evidence):

- `/Users/roman/.local/bin/vibe` and `/Users/roman/.local/bin/vibe-acp`.
- `/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python`.
- Offline npm cache: `/Users/roman/Documents/Codex/2026-10-03/p/work/npm-cache`.

These are local evidence, not portable defaults. `scripts/package-rc.mjs` and `scripts/smoke-install.mjs` require `VIBE_SUPERVISOR_TEST_NPM_CACHE` to be an absolute path to a populated offline npm cache and fail immediately without it; there is no fallback path.

## Verification evidence

Historical: the last full implementation release verification passed **49 tests across 7 files**, lint, typecheck, build, deterministic acceptance, secret-pattern scan, and SPDX inventory. Counts: tool schemas 4; config 7; MCP integration 2; CLI 3; core 8; security 14; ACP integration 11. This is a historical result, not a substitute for checking later changes.

Current suite after Phase B (2026-10-07): 483 tests (`npx vitest run`, about 27 s), of which the 2 installed-resolver profile tests (review and edit) skip when Vibe is not installed. Plus 51 Vibe-free Python tests in `src/backends/runtime/test_prompt_file.py` and `src/backends/runtime/test_keychain_credential.py` (`npm run test:python`, also part of `verify:release`).

ACP fake-subprocess coverage includes 100 independently initialized prompt runs, unknown notifications and thought filtering, correlated permissions and expired IDs, form responses, live continuation, loading without original-task replay, malformed JSON, early exit, wrong protocol/mode, and cancellation. It verifies local protocol/lifecycle behavior rather than hosted inference.

Independent checks also passed:

- Real installed Vibe SessionLogger fixture without a prompt, covering append/overwrite/metadata filtering.
- Actual compiled ACP initialization through isolated homes and the privacy launcher, negotiating exact Vibe 2.25.8 and protocol v1 without inference.
- Actual compiled stdio MCP server with the official client, eight-tool discovery, workspace rejection, and EOF cleanup.
- Isolated CLI/doctor and configure-Codex tests; no user-global config was edited.
- Offline tarball installation with CLI/runtime shim/MCP initialization, discovery, status error, and shutdown checks.
- Destination source comparison after migration; source was unchanged, with license/README metadata aligned to the existing repository.
- Release checksums verified for the package, SBOM, and acceptance report.

Documentation additions were checked for local link targets and whitespace. They do not change runtime behavior.

## Release artifacts and reproduction

`release/` is ignored by Git. The current candidate is **0.9.0-rc.5**, built on 2026-10-07 on the preparing machine (Node 24.19.0, macOS arm64) from the working tree that bumps the version on top of `be7bb6a`, so it contains Phase A, Phase B, the isolation follow-up and both cold-review fix rounds:

```text
vibe-supervisor-0.9.0-rc.5.tgz  sha256 03a113702d0200b01426402e5a4dd6892c1282bd0ac6e026d40d3dd53f6c226f
sbom.spdx.json                  sha256 190a5865e1ebd2ad85b526c9c5fcc5b071a6b22200e5c64cdc4433eadc5a1f7d
acceptance.json                 sha256 64d6be108108197c2a8aeb6adad2d9635062e061e4f556ce222efa0e44e3e2b0; 7 deterministic checks PASS; hosted, soak and platform gates listed UNVERIFIED
SHA256SUMS
```

`package:rc` passed end to end, including the offline installed-package smoke test (MCP initialize, tool listing, EOF shutdown, and two concurrent `--isolated` clients from the installed tarball). The rc.4 tarball was built on the target machine and is not in the preparing machine's release folder; rc.1, both rc.2 tarballs (`37a97be…`, `df76993…`) and rc.3 (`82eb6a4…`) are superseded. Never edit archive contents manually; rebuild instead.

The delivered copy of these four files is kept on the preparing machine at `/Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/0.9.0-rc.5/` (older candidates are next to it), Git-ignored; verify it with `shasum -a 256 -c SHA256SUMS` in that folder before installing on the target machine. What to check there first: the Phase B target-machine measurements P1–P4, T11 (hosted ACP cancellation, restart and lazy reload, idle expiry), and that `configure-codex --isolated` reuses its session directory across Codex restarts.

Populating the offline cache needs two steps. `npm ci --cache /abs/cache` stores package tarballs but not the registry metadata the offline tarball install needs, so the first `package:rc` run fails with `ENOTCACHED`. Warm the metadata once by packing the tarball and installing it online with `--ignore-scripts` into a throwaway prefix using the same cache, then run `package:rc`. The smoke install uses `--ignore-scripts`, so it does not exercise the `prepare` script; field test T1 covers that.

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

The following must remain **UNVERIFIED** until performed and recorded:

1. Hosted cancellation, permission/input callbacks, restart/load recovery, and idle expiry.
2. A 100-run real hosted Vibe/ACP soak, including refused out-of-root reads, continuation, cancellation, and reconnect/load.
3. Plugin scaffold installation and visibility.
4. macOS Intel and clean OS account installation; other platforms are not certified by config-path support alone.

Hosted authentication, effective mode/tool inventory, desktop registration, review, isolated edits, and ACP continuation now have the scoped evidence above. This does not certify the remaining lifecycle gates.

Decisions and sequence recorded after the project review:

- Review integrity: when a review run's source workspace changes during the run, the run completes with a warning instead of failing, and artifacts (transcript, `result.json`) are always finalized first. The read/search tool profile is the actual control, and users legitimately edit during long reviews. Reviewing a snapshot worktree is a possible later option.
- Timeout: `timeout_seconds` counts from launch, not from submission; time spent queued does not consume it.
- Gate 3 is redefined: the profile is designed so in-root reads and writes resolve to ALWAYS and everything else to NEVER (see [docs/compatibility.md](docs/compatibility.md)), so real Vibe should not issue permission callbacks. The soak asserts zero permission requests in normal runs plus one deliberate out-of-root read that is refused, rather than exercising callbacks. Historical caveat (B1 fixed and installed-resolver verified on 2026-10-05): the hosted attempt in [docs/history/acceptance.md](docs/history/acceptance.md) showed that the current `<root>/**` allowlist does not authorize nested descendants (blocker B1 below), so "in-root resolves to ALWAYS" is only true for immediate children today.
- Plugin scaffold: `.mcp.json` (referenced by `.codex-plugin/plugin.json`) points at `./dist/cli.js`, so a fresh checkout without `npm run build` fails to start the server. Claude Code also loads it as a project MCP server and ignores the Codex-only `enabled` field.

Implementation sequence:

1. Phase 0, hygiene: done (no machine-specific cache fallback, portable docs; the `files` allowlist change was later reverted).
2. Phase 1: done (realistic fake-ACP fixture and regression tests in `tests/integration/run-manager-regressions.test.ts`; they were red until Phase 2).
3. Phase 2: done (per-turn streaming redaction with newlines only at turn boundaries and no per-event meta persists; completed runs reloaded lazily with idle sessions capped at `maxConcurrentRuns`; review source changes reported as a warning; timeout counted from launch via `launchedAt`; closing or evicting a completed ACP run no longer reports `failed`). Original scope: streamed message chunks (per-turn streaming redaction, newlines only at turn boundaries, fewer meta persists); a single owner for live session handles with idle expiry and a cap that includes recovered completed runs; review integrity as a warning with artifacts finalized first; timeout counted from launch; and closing a completed ACP run must not report `failed` afterwards.
4. Phase 3: done on 2026-10-05 (hosted review, programmatic edit, and ACP edit with continuation in Codex desktop; effective tool inventory recorded). The reject decision was made from the ACP spec instead: rejections are sent as the selected reject option.
5. Phase 4: done (`npm run compat:probe`, see "Revalidating a Vibe release" in `docs/compatibility.md`; the pin now lives in `src/backends/pinned.ts`). The script was NOT run against a real Vibe on this machine (none installed), so it is untested against real Vibe until someone runs it; the tool-path resolver check, tool inventory and hosted inference stay MANUAL.
6. Phase 5: hosted soak (gate 3 as redefined above), then the next release candidate.
7. Gate 4 (desktop registration) passed on 2026-10-05; gate 5 (plugin install) can happen at any time; gate 6 (Intel and clean account) comes last.

Recorded gaps after Phase 4:

1. Large or unreadable repos failing review at launch: fixed (a failed launch snapshot becomes a result warning and the integrity comparison is skipped).
2. Failed runs keeping a live session: fixed (every path to `failed` releases the backend session once).
3. Message events are emitted at newline or turn end, so `vibe_status` does not stream text live: accepted, end-of-turn delivery is fine.
4. The programmatic backend passed the task via `--prompt` argv, visible in `ps`: fixed (the task goes through an owner-only prompt file that the shim reads and deletes; ACP is unchanged). The hosted programmatic review and edit on 2026-10-05 ran through this path successfully; the `ps` argv check (T7) was not recorded.
5. `verify:release` ran tests before build: fixed (order is now lint, typecheck, build, test, acceptance, secret-scan, sbom; the compat-probe self-build fallback is kept for standalone `npx vitest run`).
6. `.mcp.json` needed `npm run build` in a fresh checkout: fixed (`prepare` runs the build on `npm ci` / `npm install`). `package:rc` with its offline smoke install has since passed on both machines, and a fresh `npm ci` on the target machine ran the `prepare` build. The smoke install itself uses `--ignore-scripts`, so `prepare` does not run there.

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


1. Crash safety: `unhandledRejection` handler in `serve`; `.catch` on every `void` call site; `releaseSlot`/`notify` in `finally`; filesystem errors mapped to `VSUP_STORAGE_ERROR`; a test with a forced EACCES on the run directory.
2. One `settle(runtime, state, error)` replacing the seven divergent end-of-run sequences (launch failure, backend states, cancel, deadline, output limit, policy failure, shutdown), so artifacts, integrity, session release and slot release always happen in the same order. Timed-out and policy-failed reviews then also get `result.json` and an integrity record.
3. Recovery: recovered non-completed runs become `ready` (handle recovered) or `recoverable` (no handle), stale `waiting_*` states are cleared, idle recovered sessions hold no slot; `recover()` runs under a bounded timeout or lazily on first `vibe_continue`; stdio opens before recovery.
4. Owner lock: compare the PID start time with the lock's `started_at`, age out a stale recovery lock, retry briefly on an empty freshly created lock, and make the error name the lock path, owner PID and remedy; document one Codex session per data directory.
5. Worktree and close: rebuild `verifiedPatch` from the saved artifact path and hash; a refused cleanup still transitions to `closed` and reports `worktree_retained` with the reason; `record.worktree` is set only after the worktree exists.
6. Honest failure reporting: exit 0 without a stop reason fails with `VSUP_BACKEND_CRASHED`; an empty summary adds a warning; every launch failure appends a redacted diagnostic event; `vibe_status` returns capped diagnostic text; `VSUP_VIBE_VERSION_UNSUPPORTED` carries the detected version with a downgrade remedy; the probe cache is invalidated when a start fails before session initialization; `test-acp` and `doctor` include the shim stderr tail.

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


1. Review snapshot: hash with bounded parallelism overlapped with probe, profile and launch preparation; at completion re-hash only files whose stat changed (decision pending: this misses same-size, same-mtime writes); consider excluding gitignored heavy directories (decision pending: this misses writes to ignored paths such as `.env`).
2. Remove the separate availability probe and validate `agentInfo.version` and the protocol on the real run's `initialize`; the shim already enforces the pin. Resolve executables in-process once per launch instead of spawning `which` 3–6 times.
3. Keychain: try the last service that succeeded first, or cache the resolved key in supervisor memory (decision pending).
4. Git: pass the resolved root and base into `createDetachedWorktree`; replace the two spawns per untracked file with a temporary index, `add -N` and one `diff --binary`.
5. Coalesce event appends and fsync at state and turn boundaries; hash artifacts incrementally; embed the compact result in `vibe_status` once a run is settled.
6. Write `startup_timeout_sec` in `configure-codex`; prune retained runs automatically.

### Phase C, lean surface

Status: implemented on 2026-10-07 against fake backends, uncommitted at the time of writing; cold review pending. Decisions: removed config keys load with a warning; no tool-side `backend`; `vibe_continue`/`vibe_respond` only with `acp` or `auto`; `vibe_cancel` folded into `vibe_close`; `test-acp` and `config validate` kept as aliases; this handoff stays at the root while evidence history moved to `docs/history/`; releases through GitHub Releases with `private: true`. The release workflow has not run yet (it runs on the first `v*` tag). The package is 194 kB packed, 137 files, without history, `.mcp.json` or `.codex-plugin`. Breaking changes for coordinators are listed in `CHANGELOG.md` under "Unreleased".


1. Delete the nine dead config keys and `security.allow_network_tools` (all hard-off); either read the four `limits.*` defaults from config or delete them; `init` writes only `version`, `allowed_workspace_roots` and `[paths]`.
2. Tools: drop `allow_shell` (the strict schema keeps rejecting it), `detail: "summary"` and the tool-side `auto` (an omitted `backend` means the configured one); return `next_action` from every tool and `next_after_seq` from `vibe_status`; expand tool descriptions with the wait, `stop_reason` and close guidance so Codex does not need the skills installed; fold `vibe_cancel` into `vibe_close`; register `vibe_continue` and `vibe_respond` only when ACP is configured.
3. CLI: `setup --workspace <dir> [--codex user|project]` (init, canonical allowlist, `[paths]` autodetect from the shell PATH, validate, doctor, confirmed Codex write) and `allow <dir>`; fold `test-acp` and `config validate` into `doctor`; read the version from `package.json`.
4. Documentation: README with prerequisites first (exact Vibe install command, browser login), `docs/reference.md` (tools, lifecycle, live config keys, CLI), `docs/security.md`, `docs/compatibility.md`, `docs/errors.md` generated from `REMEDIATION`, `CHANGELOG.md`; move this handoff, `docs/acceptance.md` and `docs/reviews/` to `docs/history/` outside the package; exclude history from `files`; reconcile or drop the `.mcp.json` scaffold until plugin installation is verified.
5. Release: a workflow that attaches the tarball, `SHA256SUMS` and SBOM to a GitHub Release, and a documented `npm i -g <url>.tgz` install (works today because `dist/` ships and `prepare` does not run for tarballs).

### Phase D, target machine and release

T7, T8, T11, T12, R1–R3, restart, stale-lock and upgrade-path checks added to the field plan, the hosted soak as redefined in gate 3, then T14–T16; cut rc.4 after Phases A–C and 1.0 after D.

Open decisions: integrity versus speed for the review snapshot (B1); whether 1.0 ships programmatic-only with ACP marked experimental (removes `continue`, `respond`, the `auto` fallback and most recovery surface, but also continuation); whether the Keychain key may live in supervisor memory; whether R3 (unified harness) gates 1.0 or "legacy only" is documented with the flag made conditional; whether `private: true` with GitHub Releases stays the install story.

## Platform research (2026-10-05)

Gathered from official release pages and docs via summarized fetches; treat exact wording as lightly verified and recheck on the target machine.

- **Codex:** CLI 0.160.0 (2026-10-01) is the latest stable release; 0.162.0-alpha.14 is a pre-release. No separate desktop-app version was found. Models are now GPT-6 branded: Astra (most capable), GPT-6.1 Sol (default since 0.159.1), and GPT-6 Luna (efficient, about 100x cheaper per input token than Astra). GPT-5.5 retires from ChatGPT products on 2026-10-14; nothing in this repository pins it. Usage is metered in credits per token, MCP tool results count toward it, and cached input costs about 10%. MCP server options include `tool_timeout_sec` (default 60), `startup_timeout_sec` (default 10), `enabled_tools`, `disabled_tools`, and per-tool `tools.<tool>.output_token_limit`.
- **Vibe:** 2.25.8 (2026-09-23) is the latest release, so the pin is current. Since 2.25.5 the unified harness is stable and the legacy harness, which this supervisor forces with `--legacy-harness`, is an escape hatch reported as deprecated. The changelog does not mention the nested-glob (B1) or Keychain (B2) issues. Vibe supports `--max-price`, `--max-tokens`, and per-agent `active_model`; the supervisor pins no model, so the model used in a fresh isolated home is undefined.
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
- **R3:** validate the permission profile under Vibe's unified harness (without `--legacy-harness`) before Vibe removes the legacy harness: repeat T4, T9 and T12 in both harnesses and record any differences.
- **R4:** record which model a fresh isolated home actually uses (from the run's private session records) before deciding whether to pin `active_model`.

## Cold review before delivery (2026-10-05)

A context-free review of `ee0b7cb..3b10f88` raised nine findings. All are fixed and covered by tests against fake backends:

- **F1:** a review whose source changes still completes (by decision), but the result now carries an `integrity` object (`verified` / `changed` / `unverified`, up to 50 changed paths from per-file manifests, `write_tool_observed`). A write-capable tool call by the review worker is reported as a possible read-only boundary violation with an error-severity `review_integrity` event; an unchecked snapshot says a violation would go undetected.
- **F2:** results shrink in a fixed order (inline patch, transcript, diff stat, lists, summary head and tail) and never drop `run_id`, `state`, `error`, `warnings`, `integrity`, `pending_request`, `patch_path` or `next_action`; `truncated_fields` lists what was reduced.
- **F3:** the streaming redactor emits over-long lines instead of replacing them with `[REDACTED]`, holding back a tail so a secret across the cut is still caught.
- **F4:** cancel, close and crashes flush the agent's partial last line before the process stops.
- **F5:** a task prompt file the shim never consumed is removed after the child exits or fails to spawn; a symlink in its place is refused, never followed.
- **F6:** only real runs receive the original HOME; probes, `compat:probe` and `doctor` make no Keychain lookup.
- **F7:** Keychain failures are classified (not found 44, locked 36, denied 51/128, otherwise `error-<code>`) with per-service detail. The code meanings are derived from OSStatus values and unverified against a real Keychain.
- **F8:** a trailing slash in HOME is accepted, and every skipped lookup reports a specific reason.
- **F9:** `detail: "summary"` returns the full shape again, with a deprecation note.

Also added from the review's open questions: redaction patterns for `API key: <value>`, `x-api-key` and `*_API_KEY=<value>` (requiring a value-looking token), because a Keychain-resolved key is unknown to the Node redactor.

Open questions left as is: a probe cached as available after an in-place Vibe upgrade still fails safe at start because the shim re-checks the version; queued time does not count toward the timeout by decision; there is no cap on concurrent `wait_seconds` calls; after a completed run's session dies, a later `vibe_continue` reloads lazily without reporting why the earlier session ended.

## Known blockers from the hosted attempts

The 2026-10-03 hosted attempts in [docs/history/acceptance.md](docs/history/acceptance.md) and the correction request in [docs/history/reviews/vibe-draft-corrections.md](docs/history/reviews/vibe-draft-corrections.md) found three P1 defects in the unmodified supervisor. The target-machine work on 2026-10-05 fixed B1/B3 and verified hosted authentication for B2; the descriptions below preserve the original diagnosis:

- **B1, nested path grants.** Vibe 2.25.8 matches absolute glob allowlists with `PurePath.match`, so the `<root>/**` patterns written by `src/backends/profile.ts` authorize immediate children but not nested files. Hosted reviews saw `read_file` report "permanently disabled". The intended fix is Vibe's encoded `vibe-path:directory_recursive:<canonical-root>` grant, keeping the `never` fallback, denylist, and sensitive patterns. It must be verified against the installed resolver, not by environment-string assertions.
- **B2, browser-login credential under private HOME.** Fixed, and confirmed by browser-login authentication in the 2026-10-05 hosted runs. Original problem: The `ai.mistral.vibe` / `MISTRAL_API_KEY` Keychain item is found with the real HOME but not with the worker's fresh HOME, so hosted runs fail authentication unless `MISTRAL_API_KEY` is exported. The correction request specifies the fix: a bounded, exact-argv Keychain lookup in the shim using the original HOME context only for that subprocess, run after version/entrypoint validation, with explicit nonempty environment credentials taking precedence, and the context removed before Vibe starts.
- **B3, agent-layer permission overrides.** The Plan (review) and Accept Edits (edit) agents can override tool permissions. The previous draft's `VIBE_AGENTS__...` environment overrides are not a supported mechanism. The effective permissions after all configuration and agent layers must be inspected for both modes; this needs the installed Vibe source.

## Pre-delivery work possible without hosted access

- ~~Fix B2 with a mocked `security` binary~~ Done: `src/backends/runtime/test_keychain_credential.py` and `tests/unit/original-home.test.ts`.
- Vibe cannot be installed on the preparing machine, so B1 and B3 move to the target machine (see "Work on the target machine before hosted tests" below). Anything that needs the installed Vibe package belongs in the field test plan, not here.
- ~~Build a fresh RC with an explicitly populated offline npm cache~~ Done: rc.2 on 2026-10-05, superseded by rc.3 (see "Release artifacts and reproduction").
- ~~Run the Vibe-free Python tests from `verify:release` so CI covers them~~ Done: `npm run test:python` runs `test_prompt_file.py` and `test_keychain_credential.py`, and `verify:release` calls it right after `npm test`. `test_vibe_supervisor_launcher.py` is excluded because it needs an installed Vibe.
- ~~Run a cold review of `ee0b7cb..HEAD` before delivery~~ Done; see "Cold review before delivery".

## Work on the target machine before hosted tests

Status 2026-10-05: all three items below are done (B1 and B3 fixed in `291fc8c` and verified against the installed resolver; B2 confirmed by hosted authentication). Kept for the record.

These need the installed Vibe 2.25.8 package but no credential or inference, so do them after T3 and before T6:

- **B1:** confirm the nested-path failure with the T4 resolver check, switch `src/backends/profile.ts` to the `vibe-path:directory_recursive:<canonical-root>` grant, add a regression test that exercises the installed resolver (immediate child, nested file, sibling root, outside path, symlink to outside, root `.env`), and repeat T4.
- **B3:** inspect the installed Vibe source for how the Plan and Accept Edits agents layer permissions over the tool configuration, then record the effective permissions for both modes. Fix only through a mechanism the pinned source supports; never through `VIBE_AGENTS__...` overrides or an `always` fallback.
- **B2:** the B2 fix was tested only with a mocked or fake `security` on the preparing machine. Before T6, confirm the real Keychain lookup finds the browser-login item without exporting `MISTRAL_API_KEY`.

## Field test plan for the target machine

Run on a macOS machine with Vibe 2.25.8 installed and browser login completed. Hosted steps (T6 onward) send source and tasks to Mistral and incur usage; run them only with the owner's authorization and only against a throwaway repository containing no secrets. Stop at the first failing step, record it, and do not work around a blocker by weakening policy (no `always` fallback, shell, network, or project trust).

Record every step in a new dated section of [docs/history/acceptance.md](docs/history/acceptance.md) (and `docs/acceptance.json` for machine-readable status): exact commands, versions, run IDs, PASS/FAIL, and remaining uncertainty. Never record credentials, and redact task text only if it contains anything sensitive.

Status after the 2026-10-05 target-machine session ([evidence](docs/history/reviews/rc2-target-test-2026-10-05/Read.md)): T1 (fresh `npm ci` with the `prepare` build, on the existing account), T2, T3, T5, T6, T9, T10 and T13 passed; T4 failed on nested files and passed after the B1 fix; T11 is covered only for live continuation; T12 is covered only for a refused review write (`Unknown tool 'write_file'`); T7, T8, T14, T15 and T16 are not yet run. R4 is answered: hosted runs used `mistral-medium-3.5`. R1, R2 and R3 remain open; the Codex registration shows the 600-second `tool_timeout_sec`, but no long `wait_seconds` call has been recorded.

| ID | Step | Expected result | Covers |
|---|---|---|---|
| T0 | Record the environment: macOS version and arch, Node, Git, Vibe (`vibe --version`), the Vibe Python path, Codex version, and the repository commit. | All recorded. | Evidence baseline |
| T1 | Fresh clone, `npm ci`, `npm run verify:release` (includes `npm run test:python`). | `npm ci` builds `dist/` through `prepare`; all checks green. | Gap 6, gap 5, regression suite |
| T2 | Populate an offline cache explicitly (`npm ci --cache /abs/cache`), then `VIBE_SUPERVISOR_TEST_NPM_CACHE=/abs/cache npm run package:rc`, then `cd release && shasum -a 256 -c SHA256SUMS`. | RC built, offline install smoke passes, checksums verify. | Gap 6, packaging |
| T3 | `npm run compat:probe -- --out /tmp/compat.json`. | `vibe_cli_version`, `acp_initialize`, `acp_load_session_advertised`, `launcher_logger_fixture`, and `shim_pin_consistent` PASS. | Phase 4, pinned launcher |
| T4 | Perform the probe's MANUAL `tool_path_resolver` steps for both `read_file` and `grep`, including a nested file such as `src/a/b.ts`, a root `.env`, an outside path, and a symlink to outside. | In-root immediate and nested files ALWAYS; the others NEVER. Expected to FAIL on nested files until B1 is fixed. | B1, gate 3 premise |
| T5 | Configure the allowlist (`node dist/cli.js init`, `config validate`, `doctor --json`, `test-acp`) as in [README.md](README.md). | Validation and doctor pass; `test-acp` negotiates 2.25.8 / protocol 1. | Setup path |
| T6 | Hosted programmatic review of a throwaway repository with nested files, without exporting `MISTRAL_API_KEY`. | Authenticates through the browser login, reads nested files, completes. B2 is fixed only against a mocked `security`, so this step is the first real Keychain check; if it fails on authentication, repeat once with `MISTRAL_API_KEY` supplied in the supervisor's environment from a private parent process to continue the remaining checks. | Gate 1, B2, B1 |
| T7 | During T6, run `ps -axww -o pid,command` and inspect the run directory. | No task text in any process argv; `task-prompt.txt` is gone once Vibe starts. | Gap 4 |
| T8 | Inspect T6 artifacts: `transcript.md`, `events.ndjson`, `result.json`. | Transcript has no per-chunk newlines; no reasoning text; warnings only if the source changed; record message chunk shapes. | Phase 2 streaming, Phase 3 data |
| T9 | Inspect the run's private Vibe session records for the effective tool list in review and edit. | Review: only `read_file` and `grep`. Edit: also `write_file` and `edit`. No `bash`, network, or MCP tools. | Gate 2, B3 |
| T10 | Hosted programmatic edit on the throwaway repository, then `vibe_result` and `vibe_close` with `cleanup_worktree: true`. | Patch exported, source checkout untouched, worktree removed only after verified re-export. | Gate 1 (edit), worktree safety |
| T11 | Hosted ACP review: `vibe_continue` after completion, `vibe_cancel` during a turn, restart the supervisor and continue the completed run, wait past the idle TTL. | Continuation works; cancel ends `cancelled`; after restart the run reloads lazily on continue; idle sessions expire and never exceed `maxConcurrentRuns`; no `failed` after close. | Phase 2 lifecycle on real ACP |
| T12 | Policy probes in a review: ask Vibe to read a file outside the root, read `.env`, write a file; start an edit with `allow_shell: true`. | Outside and `.env` reads refused; review write refused; shell request rejected with `VSUP_PERMISSION_DENIED`. Count permission requests (expected zero). | Gate 3 premise, shell boundary |
| T13 | Register with Codex (`configure-codex --user --dry-run`, then for real only with the owner's consent) and open Codex desktop. | Eight `vibe_*` tools visible and callable. | Gate 4 |
| T14 | Install the plugin scaffold as documented in [README.md](README.md#status-and-plugin-scaffold). | Plugin and its MCP server visible. | Gate 5 |
| T15 | 100-run hosted soak per the redefined gate 3, mixing reviews, edits, continuation, cancellation, and restart/load. | Zero unexpected failures, zero permission requests in normal runs, no leaked processes (`pgrep -fl vibe`), bounded artifacts. | Gate 3, Phase 5 |
| T16 | Repeat T1–T6 on an Intel Mac and on a clean OS account. | Same results. | Gate 6 |

After T6 to T12 pass, decide whether ACP reject options should be sent as `selected` reject option IDs instead of `cancelled` (this only matters if T12 shows Vibe issuing permission requests). After T15 passes, cut the next release candidate per [docs/history/acceptance.md](docs/history/acceptance.md).

Fixed after the hosted ACP continuation (2026-10-06): a turn that stopped with `max_turn_requests` used to be reported with the generic summary "Vibe completed the delegated task." The default summary now follows the stop reason (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`, or an unknown reason), any non-`end_turn` stop adds a warning naming it, and each continuation's result replaces the previous turn's summary and stop-reason warning while keeping unrelated warnings. The run state stays `completed`; the skills tell the coordinator to check `stop_reason` and warnings, not the summary.

Test fragility: four full-suite runs launched at the same time on one machine occasionally time out (5 s) in the Git worktree tests in `tests/unit/core-run-manager.test.ts` and `tests/security/security-primitives.test.ts`. Sequential runs and `verify:release` pass. This is CPU oversubscription, not a product defect; raise those test timeouts if parallel runs are needed.

A next maintainer should inspect Git status, read this handoff and the usage guide, reproduce local checks when making code changes, and finish those gates before claiming production readiness. Hosted validation sends source/tasks to a provider and may incur usage charges; keep it within user-authorized scope. Record exact versions, commands, outcomes, and remaining uncertainty in acceptance/compatibility docs. Any new version support requires renewed shim, profile, protocol, and effective-tool validation.

## Design references

- [Private RC decision](docs/history/adr/0001-private-release.md).
- [Protocol and security boundary](docs/adr/0002-protocol-security-boundary.md).
- [Pinned launcher decision](docs/adr/0003-vibe-launcher.md).
- [Detailed compatibility findings](docs/compatibility.md).
- [Security contract](docs/security.md) and [release acceptance](docs/history/acceptance.md).
- [Plugin scaffold status](README.md#status-and-plugin-scaffold).
