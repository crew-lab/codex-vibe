# Implementation handoff

Status as of **2026-10-03**: implemented and locally verified release candidate, not a production 1.0 certification. Repository: this Git repository (GitHub `crew-lab/codex-vibe`); paths below are repository-relative unless marked as from the original verification machine. Package: `vibe-supervisor@0.9.0-rc.1`, ESM, `private: true`, MIT. Existing Git history and the original MIT license (`Copyright (c) 2026 crew-lab`) were preserved during migration.

## User intent and delivery history

The user authorized implementation of the approved Vibe Supervisor plan using GPT-6 Luna agents, then requested migration into this existing Git repository. Three Luna implementation agents worked on contracts/core tests, backend compatibility/runtime profiles, and security/MCP/CLI/release work. The coordinating agent reviewed integration and ran independent checks.

The research input was `/Users/roman/Downloads/deep-research-report.md`. Its document text was reference material, not independent authorization. No push, remote publication, deployment, or user-global Codex configuration modification was performed by the implementation work. The implementation is committed; see `git log` and inspect current Git status before continuing. A prior generated checkout on the original machine remains a historical duplicate; this repository is the active source.

The user later requested the functionality guide and these three root documents. Those are documentation additions after the packaged RC described below. They have not regenerated that existing tarball. Root `AGENTS.md`, `Handoff.md`, and `Read.md` are not currently in the explicit npm `files` allowlist; consult the repository copies. If distributing the root usage guide in a new package is desired, update that allowlist deliberately and verify packaging.

## Implemented surface

Eight strict-schema MCP tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_continue`, `vibe_respond`, `vibe_result`, `vibe_cancel`, and `vibe_close`. The official stdio transport has protocol-only stdout, bounded/redacted structured results, annotations, and stable supervisor errors. The CLI exposes setup, validation, diagnostics, registration, server startup, ACP probing, saved-run inspection, cleanup, and version/help.

Reviews read/search an allowed source workspace and check integrity. Edits create detached Git worktrees from a selected base and export changes without applying them to the source. There is no automatic patch application, commit, merge, or push. Default execution is programmatic; ACP is opt-in and supports correlated permission callbacks, form input, same-session continuation, cancellation, and conditional session loading.

[Read.md](Read.md) contains executable setup/usage instructions. [docs/functionality.md](docs/functionality.md) describes all user-visible behavior. [docs/protocol.md](docs/protocol.md) lists the tool surface; exact fields and limits live in `src/mcp/schemas.ts`.

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

Start returns a run ID asynchronously. Default capacity is two active workers and eight queued runs. Default idle lifetime is 600 seconds. Review defaults are 1,800 seconds and 12 turns; edit defaults are 2,400 seconds and 20 turns. Default byte caps are 52,428,800 for events, 10,485,760 for transcripts, and 104,857,600 for artifacts; MCP results are capped at 50,000 characters.

State includes queued/startup/negotiation/ready/running, permission/input waits, completed/failed/cancelled, closing/closed, and recovery states. Owner-only directories/files use 0700/0600. Persistent records are versioned, writes are atomic, initialization is single-flight, and a data-directory owner lock excludes concurrent supervisors. Defaults retain seven days and preserve failed runs.

The macOS default data/config root is `~/Library/Application Support/VibeSupervisor`; `VIBE_SUPERVISOR_HOME` overrides it. Explicit `paths.data_dir` can select run storage while config resolution still uses the config home. Saved ACP paths must match the trusted `dataDir/runs/<uuid>` layout and source/worktree/profile records. Loading requires advertised `loadSession`, mode/trust validation, and suppression of replay notifications. Recovery does not resubmit an uncertain original task or restore process-local pending grants/input. It waits for explicit continuation. Saved PIDs are never authority to kill arbitrary processes.

## Security and Git behavior

Canonical workspace roots, context paths, recursion guards, explicit child environment allowlists, and bounded/redacted results enforce the application policy. Shell and network tools are disabled; requesting shell permission fails with `VSUP_PERMISSION_DENIED`. These are application controls, not an OS sandbox. Permitted source can reach the provider; redaction recognizes known formats rather than every possible secret.

Each worker has fresh private HOME and VIBE_HOME; it does not inherit the user's Vibe configuration, project trust, tools, hooks, agents, skills, plugins, MCP servers, or additional directories. Project `.vibe`/`.agents` extensions and symlinked `.vibeignore` are refused. Review enables read/search; edit adds write/edit. Sensitive and reserved path exclusions cover the file/search profile. Grep's returned-result cap does not guarantee a peak-buffering cap inside Vibe's search implementation.

The pinned Python shim checks Vibe version and logger persistence signatures, forces legacy harness behavior, removes reasoning/credential-bearing fields before native history writes, applies private permissions, and watches parent death/run lifetime. Raw ACP wire logging is disabled. Private histories remain for recovery/retention. Secrets are not placed in tool arguments or task text; only an explicitly present `MISTRAL_API_KEY` may be forwarded to the private child, otherwise Vibe may resolve OS Keychain credentials.

Git operations use direct argument arrays with no shell and disable/refuse hooks, filters, and external diff paths. Snapshot exports cover supported staged, unstaged, untracked, binary, and unusual-name changes without mutating the source index. Artifacts include patch/stat/changed files, public transcript, events, and hashes. Cleanup compares a fresh verified export to the saved patch and refuses stale or secret-bearing exports and unaccounted ignored files. Process-group cleanup is bounded; sandbox EPERM can degrade to known-child termination and is reported as unverified group cleanup, never as proof all descendants died.

## Compatibility and dependencies

Vibe is pinned to **2.25.8**; ACP protocol is v1. The launcher obtains the installed entrypoint's Python interpreter from its shebang. Both adapters use the checked runtime shim; version/signature drift aborts. ACP advertises `loadSession: true`; do not infer an unsupported `session/resume` method. Effective authenticated runtime tool inventory remains a gate despite source-based profile enforcement.

Runtime dependencies: ACP SDK 1.7.0, MCP server/client 2.3.0, MCP Node adapter 2.1.1, Zod 4.6.5, smol-toml 1.9.0. TypeScript 5.9.3 was retained for compatibility; TS7 adoption is not part of this RC. The lockfile pins versions. Node engine requirement is >=20.19; the observed verification machine ran Node 24.21.0, macOS 27.0.1 arm64, Git 2.54 Apple, Codex 0.160.0, and Vibe under uv/Python 3.12.

Installed diagnostic paths on the original verification machine (historical evidence):

- `/Users/roman/.local/bin/vibe` and `/Users/roman/.local/bin/vibe-acp`.
- `/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python`.
- Offline npm cache: `/Users/roman/Documents/Codex/2026-10-03/p/work/npm-cache`.

These are local evidence, not portable defaults. `scripts/package-rc.mjs` and `scripts/smoke-install.mjs` require `VIBE_SUPERVISOR_TEST_NPM_CACHE` to be an absolute path to a populated offline npm cache and fail immediately without it; there is no fallback path.

## Verification evidence

Historical: the last full implementation release verification passed **49 tests across 7 files**, lint, typecheck, build, deterministic acceptance, secret-pattern scan, and SPDX inventory. Counts: tool schemas 4; config 7; MCP integration 2; CLI 3; core 8; security 14; ACP integration 11. This is a historical result, not a substitute for checking later changes.

Current suite as of the lifecycle fixes after Phase 4: 10 files / 75 tests (`npx vitest run`), plus 40 Vibe-free Python tests in `src/backends/runtime/test_prompt_file.py` and `src/backends/runtime/test_keychain_credential.py` (`npm run test:python`, also part of `verify:release`).

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

`release/` is ignored by Git and currently contains:

```text
vibe-supervisor-0.9.0-rc.1.tgz
sbom.spdx.json
acceptance.json
SHA256SUMS
```

The SPDX inventory contains 197 locked package entries. Packaging is private/unpublished and checks MIT metadata. The existing tarball predates the later documentation additions. Rebuild it to distribute updated included docs; do not edit archive contents manually.

```sh
npm ci
npm run verify:release
VIBE_SUPERVISOR_TEST_NPM_CACHE=/absolute/path/to/populated/npm-cache npm run package:rc
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

1. Real provider authentication and hosted Vibe model generation for reviews and edits.
2. Effective enabled-tool inventory in a real authenticated session.
3. A 100-run soak against real hosted Vibe/ACP, with zero permission requests in normal runs plus one deliberate out-of-root read that is refused (see the redefinition below), continuation, cancellation, and reconnect/load.
4. Codex desktop tool visibility/registration using an actual user configuration.
5. Plugin scaffold installation and visibility.
6. macOS Intel and clean OS account installation; other platforms are not certified by config-path support alone.

Decisions and sequence recorded after the project review:

- Review integrity: when a review run's source workspace changes during the run, the run completes with a warning instead of failing, and artifacts (transcript, `result.json`) are always finalized first. The read/search tool profile is the actual control, and users legitimately edit during long reviews. Reviewing a snapshot worktree is a possible later option.
- Timeout: `timeout_seconds` counts from launch, not from submission; time spent queued does not consume it.
- Gate 3 is redefined: the profile is designed so in-root reads and writes resolve to ALWAYS and everything else to NEVER (see [docs/compatibility.md](docs/compatibility.md)), so real Vibe should not issue permission callbacks. The soak asserts zero permission requests in normal runs plus one deliberate out-of-root read that is refused, rather than exercising callbacks. Caveat: the hosted attempt in [docs/acceptance.md](docs/acceptance.md) showed that the current `<root>/**` allowlist does not authorize nested descendants (blocker B1 below), so "in-root resolves to ALWAYS" is only true for immediate children today.
- Plugin scaffold: `.mcp.json` (referenced by `.codex-plugin/plugin.json`) points at `./dist/cli.js`, so a fresh checkout without `npm run build` fails to start the server. Claude Code also loads it as a project MCP server and ignores the Codex-only `enabled` field.

Implementation sequence:

1. Phase 0, hygiene: done (no machine-specific cache fallback, corrected `files` allowlist, portable docs).
2. Phase 1: done (realistic fake-ACP fixture and regression tests in `tests/integration/run-manager-regressions.test.ts`; they were red until Phase 2).
3. Phase 2: done (per-turn streaming redaction with newlines only at turn boundaries and no per-event meta persists; completed runs reloaded lazily with idle sessions capped at `maxConcurrentRuns`; review source changes reported as a warning; timeout counted from launch via `launchedAt`; closing or evicting a completed ACP run no longer reports `failed`). Original scope: streamed message chunks (per-turn streaming redaction, newlines only at turn boundaries, fewer meta persists); a single owner for live session handles with idle expiry and a cap that includes recovered completed runs; review integrity as a warning with artifacts finalized first; timeout counted from launch; and closing a completed ACP run must not report `failed` afterwards.
4. Phase 3: one hosted review and one hosted edit on a throwaway repository (gates 1-2), recording chunk shapes, the effective tool inventory, and the permission-request count. Then decide whether ACP reject options should be sent as `selected` reject option IDs instead of `cancelled`.
5. Phase 4: done (`npm run compat:probe`, see "Revalidating a Vibe release" in `docs/compatibility.md`; the pin now lives in `src/backends/pinned.ts`). The script was NOT run against a real Vibe on this machine (none installed), so it is untested against real Vibe until someone runs it; the tool-path resolver check, tool inventory and hosted inference stay MANUAL.
6. Phase 5: hosted soak (gate 3 as redefined above), then RC2.
7. Gates 4-5 (desktop registration, plugin install) can happen at any time; gate 6 (Intel and clean account) comes last.

Recorded gaps after Phase 4:

1. Large or unreadable repos failing review at launch: fixed (a failed launch snapshot becomes a result warning and the integrity comparison is skipped).
2. Failed runs keeping a live session: fixed (every path to `failed` releases the backend session once).
3. Message events are emitted at newline or turn end, so `vibe_status` does not stream text live: accepted, end-of-turn delivery is fine.
4. The programmatic backend passed the task via `--prompt` argv, visible in `ps`: fixed (the task goes through an owner-only prompt file that the shim reads and deletes; ACP is unchanged). Unverified: the real Vibe end-to-end run of this path, because Vibe is not installed on the fixing machine; only the shim logic, a fake `vibe` package, and the TypeScript launch args were exercised.
5. `verify:release` ran tests before build: fixed (order is now lint, typecheck, build, test, acceptance, secret-scan, sbom; the compat-probe self-build fallback is kept for standalone `npx vitest run`).
6. `.mcp.json` needed `npm run build` in a fresh checkout: fixed (`prepare` runs the build on `npm ci` / `npm install`). Unverified: the offline tarball smoke test (`smoke:install`), which needs a populated npm cache; by npm semantics and `--ignore-scripts` on its pack and install steps `prepare` does not run there.

## Known blockers from the hosted attempts

The 2026-10-03 hosted attempts in [docs/acceptance.md](docs/acceptance.md) and the correction request in [docs/reviews/vibe-draft-corrections.md](docs/reviews/vibe-draft-corrections.md) found three P1 defects in the unmodified supervisor. None of the later lifecycle work addressed them, so the field tests below are expected to fail at these points until they are fixed:

- **B1, nested path grants.** Vibe 2.25.8 matches absolute glob allowlists with `PurePath.match`, so the `<root>/**` patterns written by `src/backends/profile.ts` authorize immediate children but not nested files. Hosted reviews saw `read_file` report "permanently disabled". The intended fix is Vibe's encoded `vibe-path:directory_recursive:<canonical-root>` grant, keeping the `never` fallback, denylist, and sensitive patterns. It must be verified against the installed resolver, not by environment-string assertions.
- **B2, browser-login credential under private HOME.** Fixed with a mocked `security` only; real Keychain lookup unverified until the target machine confirms it (see "Work on the target machine before hosted tests"). Original problem: The `ai.mistral.vibe` / `MISTRAL_API_KEY` Keychain item is found with the real HOME but not with the worker's fresh HOME, so hosted runs fail authentication unless `MISTRAL_API_KEY` is exported. The correction request specifies the fix: a bounded, exact-argv Keychain lookup in the shim using the original HOME context only for that subprocess, run after version/entrypoint validation, with explicit nonempty environment credentials taking precedence, and the context removed before Vibe starts.
- **B3, agent-layer permission overrides.** The Plan (review) and Accept Edits (edit) agents can override tool permissions. The previous draft's `VIBE_AGENTS__...` environment overrides are not a supported mechanism. The effective permissions after all configuration and agent layers must be inspected for both modes; this needs the installed Vibe source.

## Pre-delivery work possible without hosted access

- ~~Fix B2 with a mocked `security` binary~~ Done: `src/backends/runtime/test_keychain_credential.py` and `tests/unit/original-home.test.ts`.
- Vibe cannot be installed on the preparing machine, so B1 and B3 move to the target machine (see "Work on the target machine before hosted tests" below). Anything that needs the installed Vibe package belongs in the field test plan, not here.
- Build a fresh RC (`0.9.0-rc.2`) with an explicitly populated offline npm cache, run `package:rc` and `smoke:install` (this also verifies gap 6), and deliver the tarball with `SHA256SUMS` alongside the checkout.
- ~~Run the Vibe-free Python tests from `verify:release` so CI covers them~~ Done: `npm run test:python` runs `test_prompt_file.py` and `test_keychain_credential.py`, and `verify:release` calls it right after `npm test`. `test_vibe_supervisor_launcher.py` is excluded because it needs an installed Vibe.
- Run a cold review of `ee0b7cb..HEAD` before delivery.

## Work on the target machine before hosted tests

These need the installed Vibe 2.25.8 package but no credential or inference, so do them after T3 and before T6:

- **B1:** confirm the nested-path failure with the T4 resolver check, switch `src/backends/profile.ts` to the `vibe-path:directory_recursive:<canonical-root>` grant, add a regression test that exercises the installed resolver (immediate child, nested file, sibling root, outside path, symlink to outside, root `.env`), and repeat T4.
- **B3:** inspect the installed Vibe source for how the Plan and Accept Edits agents layer permissions over the tool configuration, then record the effective permissions for both modes. Fix only through a mechanism the pinned source supports; never through `VIBE_AGENTS__...` overrides or an `always` fallback.
- **B2:** the B2 fix was tested only with a mocked or fake `security` on the preparing machine. Before T6, confirm the real Keychain lookup finds the browser-login item without exporting `MISTRAL_API_KEY`.

## Field test plan for the target machine

Run on a macOS machine with Vibe 2.25.8 installed and browser login completed. Hosted steps (T6 onward) send source and tasks to Mistral and incur usage; run them only with the owner's authorization and only against a throwaway repository containing no secrets. Stop at the first failing step, record it, and do not work around a blocker by weakening policy (no `always` fallback, shell, network, or project trust).

Record every step in a new dated section of [docs/acceptance.md](docs/acceptance.md) (and `docs/acceptance.json` for machine-readable status): exact commands, versions, run IDs, PASS/FAIL, and remaining uncertainty. Never record credentials, and redact task text only if it contains anything sensitive.

| ID | Step | Expected result | Covers |
|---|---|---|---|
| T0 | Record the environment: macOS version and arch, Node, Git, Vibe (`vibe --version`), the Vibe Python path, Codex version, and the repository commit. | All recorded. | Evidence baseline |
| T1 | Fresh clone, `npm ci`, `npm run verify:release` (includes `npm run test:python`). | `npm ci` builds `dist/` through `prepare`; all checks green. | Gap 6, gap 5, regression suite |
| T2 | Populate an offline cache explicitly (`npm ci --cache /abs/cache`), then `VIBE_SUPERVISOR_TEST_NPM_CACHE=/abs/cache npm run package:rc`, then `cd release && shasum -a 256 -c SHA256SUMS`. | RC built, offline install smoke passes, checksums verify. | Gap 6, packaging |
| T3 | `npm run compat:probe -- --out /tmp/compat.json`. | `vibe_cli_version`, `acp_initialize`, `acp_load_session_advertised`, `launcher_logger_fixture`, and `shim_pin_consistent` PASS. | Phase 4, pinned launcher |
| T4 | Perform the probe's MANUAL `tool_path_resolver` steps for both `read_file` and `grep`, including a nested file such as `src/a/b.ts`, a root `.env`, an outside path, and a symlink to outside. | In-root immediate and nested files ALWAYS; the others NEVER. Expected to FAIL on nested files until B1 is fixed. | B1, gate 3 premise |
| T5 | Configure the allowlist (`node dist/cli.js init`, `config validate`, `doctor --json`, `test-acp`) as in [Read.md](Read.md). | Validation and doctor pass; `test-acp` negotiates 2.25.8 / protocol 1. | Setup path |
| T6 | Hosted programmatic review of a throwaway repository with nested files, without exporting `MISTRAL_API_KEY`. | Authenticates through the browser login, reads nested files, completes. B2 is fixed only against a mocked `security`, so this step is the first real Keychain check; if it fails on authentication, repeat once with `MISTRAL_API_KEY` supplied in the supervisor's environment from a private parent process to continue the remaining checks. | Gate 1, B2, B1 |
| T7 | During T6, run `ps -axww -o pid,command` and inspect the run directory. | No task text in any process argv; `task-prompt.txt` is gone once Vibe starts. | Gap 4 |
| T8 | Inspect T6 artifacts: `transcript.md`, `events.ndjson`, `result.json`. | Transcript has no per-chunk newlines; no reasoning text; warnings only if the source changed; record message chunk shapes. | Phase 2 streaming, Phase 3 data |
| T9 | Inspect the run's private Vibe session records for the effective tool list in review and edit. | Review: only `read_file` and `grep`. Edit: also `write_file` and `edit`. No `bash`, network, or MCP tools. | Gate 2, B3 |
| T10 | Hosted programmatic edit on the throwaway repository, then `vibe_result` and `vibe_close` with `cleanup_worktree: true`. | Patch exported, source checkout untouched, worktree removed only after verified re-export. | Gate 1 (edit), worktree safety |
| T11 | Hosted ACP review: `vibe_continue` after completion, `vibe_cancel` during a turn, restart the supervisor and continue the completed run, wait past the idle TTL. | Continuation works; cancel ends `cancelled`; after restart the run reloads lazily on continue; idle sessions expire and never exceed `maxConcurrentRuns`; no `failed` after close. | Phase 2 lifecycle on real ACP |
| T12 | Policy probes in a review: ask Vibe to read a file outside the root, read `.env`, write a file; start an edit with `allow_shell: true`. | Outside and `.env` reads refused; review write refused; shell request rejected with `VSUP_PERMISSION_DENIED`. Count permission requests (expected zero). | Gate 3 premise, shell boundary |
| T13 | Register with Codex (`configure-codex --user --dry-run`, then for real only with the owner's consent) and open Codex desktop. | Eight `vibe_*` tools visible and callable. | Gate 4 |
| T14 | Install the plugin scaffold as documented in [docs/plugin-scaffold.md](docs/plugin-scaffold.md). | Plugin and its MCP server visible. | Gate 5 |
| T15 | 100-run hosted soak per the redefined gate 3, mixing reviews, edits, continuation, cancellation, and restart/load. | Zero unexpected failures, zero permission requests in normal runs, no leaked processes (`pgrep -fl vibe`), bounded artifacts. | Gate 3, Phase 5 |
| T16 | Repeat T1–T6 on an Intel Mac and on a clean OS account. | Same results. | Gate 6 |

After T6 to T12 pass, decide whether ACP reject options should be sent as `selected` reject option IDs instead of `cancelled` (this only matters if T12 shows Vibe issuing permission requests). After T15 passes, cut RC2 per [docs/acceptance.md](docs/acceptance.md).

A next maintainer should inspect Git status, read this handoff and the usage guide, reproduce local checks when making code changes, and finish those gates before claiming production readiness. Hosted validation sends source/tasks to a provider and may incur usage charges; keep it within user-authorized scope. Record exact versions, commands, outcomes, and remaining uncertainty in acceptance/compatibility docs. Any new version support requires renewed shim, profile, protocol, and effective-tool validation.

## Design references

- [Private RC decision](docs/adr/0001-private-release.md).
- [Protocol and security boundary](docs/adr/0002-protocol-security-boundary.md).
- [Pinned launcher decision](docs/adr/0003-vibe-launcher.md).
- [Detailed compatibility findings](docs/compatibility.md).
- [Security contract](docs/security.md) and [release acceptance](docs/acceptance.md).
- [Plugin scaffold status](docs/plugin-scaffold.md).
