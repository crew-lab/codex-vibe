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

Current suite as of the lifecycle fixes after Phase 4: 10 files / 75 tests (`npx vitest run`), plus 11 Vibe-free Python tests in `src/backends/runtime/test_prompt_file.py` (`python3 src/backends/runtime/test_prompt_file.py`).

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
- Gate 3 is redefined: under the current profile in-root reads and writes resolve to ALWAYS and everything else to NEVER (see [docs/compatibility.md](docs/compatibility.md)), so real Vibe should not issue permission callbacks. The soak asserts zero permission requests in normal runs plus one deliberate out-of-root read that is refused, rather than exercising callbacks.
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

A next maintainer should inspect Git status, read this handoff and the usage guide, reproduce local checks when making code changes, and finish those gates before claiming production readiness. Hosted validation sends source/tasks to a provider and may incur usage charges; keep it within user-authorized scope. Record exact versions, commands, outcomes, and remaining uncertainty in acceptance/compatibility docs. Any new version support requires renewed shim, profile, protocol, and effective-tool validation.

## Design references

- [Private RC decision](docs/adr/0001-private-release.md).
- [Protocol and security boundary](docs/adr/0002-protocol-security-boundary.md).
- [Pinned launcher decision](docs/adr/0003-vibe-launcher.md).
- [Detailed compatibility findings](docs/compatibility.md).
- [Security contract](docs/security.md) and [release acceptance](docs/acceptance.md).
- [Plugin scaffold status](docs/plugin-scaffold.md).
