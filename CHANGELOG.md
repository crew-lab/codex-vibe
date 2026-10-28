# Changelog

## 2.2.1 — unreleased

- Changed: the experimental Antigravity backend supports `agy` 1.4.7, 1.4.8, and 1.4.9 (1.4.0, 1.4.3 and 1.4.4 stay), with `1.4.9` as the default pin. Its preparation read-back accepts only the pinned built-in skill catalogue in ADR 0008 (accepting both hyphenated and underscored forms `antigravity-guide` and `antigravity_guide`), each with `builtin: true`, and normalizes tool aliases (`view_file` -> `read_file`, `write_to_file` -> `write_file`) and tolerates omitted `deny` arrays in global permissions.
- Changed: an Antigravity start requires a non-blank `GEMINI_API_KEY`, `GOOGLE_API_KEY` or `ANTIGRAVITY_API_KEY`; the first one reaches agy as `GEMINI_API_KEY` and `GOOGLE_API_KEY`. Workers and probes run with `BROWSER=false` and `open`/`xdg-open` shims on `PATH`. The scripted probe model answers title-generation requests with plain text, keeping the probe tool call for the agent turn.
- Added: `[experimental] antigravity_skip_permissions`. `--dangerously-skip-permissions` is passed to workers and preparation probes only when `[experimental] antigravity_skip_permissions = true` (default off); the run then logs a warning `diagnostic` with reason `antigravity_permission_layer_bypassed` and one stderr line, every `tool_call` and `tool_denied` event carries `agy_permission_layer`, a completed result carries a warning, and `doctor`, readiness and the preparation report show the layer. It exists because headless agy 1.4.9 auto-denied tool prompts in target probes; with it on, agy's own permission layer is off and the `PreToolUse` hook is the only tool gate. The target reported all five probes passing with agy 1.4.9 and the flag on; that evidence is not yet recorded in the repository, so the five `antigravity-*` gates stay unverified.
- Changed: `npm run package:rc` is reproducible. The SBOM and acceptance report date comes from `SOURCE_DATE_EPOCH`, else the HEAD commit time; the SBOM namespace is derived from the package name, version and lockfile hash. A clean rebuild at the same commit can be compared by `SHA256SUMS`.

## 2.2.0 — unreleased

- Fixed: administrative grant permission failures identify registration and the failed operation, with scoped-command guidance. Already-private owned directories are verified without redundant chmod; ownership and symlink checks remain enforced.

- Fixed: dispatch grant expiry accepts ISO timestamps with optional milliseconds and explicit timezone offsets, normalizes them to UTC, and names invalid or expired `--expires-at` input. The 24-hour ceiling and single-use enforcement remain unchanged.

- Added: Node 20.19.0 and 24.21.0 release-test coverage, connected supervisor runtime identity, and explicit administrative `task authorize --runtime-node` selection for a CLI using a different Node than the server. Runtime binding, preparation and one-use enforcement remain unchanged.

- Added: `vibe_edit_start` accepts `allowed_write_paths`, a list of repository-relative files and `dir/` prefixes. The approval handler denies writes and edits elsewhere with reason `outside_allowed_write_paths` and the run continues; the prompt names the writable paths; the list is bound into the dispatch authorization and kept in the run record. App-server backend only.
- Changed: a start refused by its dispatch authorization now says why. A grant stores a hash per bound field, and a mismatch lists the differing field names in the message and in `details.differing_fields` (for example `task`, `limits`, `review_content`, or `node_executable` with a hint to run `task authorize` from the same install, Node and configuration as the server). An unknown authorization, a mismatched `attempt_id` and an expired grant each have their own message, and a change between consumption and launch names its fields too. Grants registered by an earlier version keep the generic refusal.

## 2.1.1 — unreleased

Fixes found in review of the 2.1.0 pre-release. A new candidate: 2.1.0's target evidence does not carry over.

- Fixed: a deadline or cancel that arrived after the worker's turn had completed, while the supervisor was still reading the final history, took the startup-abort path and killed the server mid-finalization; a completed run could end as failed.
- Fixed: a review's dispatch authorization is bound to the content of the files Git does not ignore (every file outside a Git work tree) instead of their timestamps and inodes, so a touched file or ignored build output no longer spends a single-use attempt.
- Fixed: the stop after three consecutive denied shell or network calls also counts web fetch and search tools.
- Changed: `task authorize --expires-at` must be within 24 hours; a start against a data directory with no registered authorization says so instead of reporting an invalid authorization.
- Removed: the unreachable same-session correction code (ADR 0009); records it created stay readable.

## 2.1.0 — unreleased

Unreleased; source on main. Line 2.1 introduces an experimental, opt-in Google Antigravity execution backend (`agy 1.4.0`), full auditability via tool-call accounting and approval ledgers, root-anchored exclusion globs, daily cost budgets, structured review findings with SARIF 2.1.0 export, and cross-session inspection. All record fields remain backwards-compatible (2.0 records load cleanly, and 2.0 supervisors ignore unknown fields). Pre-releases v2.0.1 and v2.0.2 are published on GitHub.

### Execution backends & Google Antigravity ([ADR 0008](docs/adr/0008-antigravity-execution-backend.md))

- Added: Google Antigravity execution backend (`backend = "antigravity"`, `paths.antigravity`), supporting the `agy 1.4.0` CLI alongside the default `vibe-app-server` engine. Experimental and off by default: `backend = "antigravity"` is rejected unless the configuration also sets `[experimental] antigravity = true`. Its tool gate is a hook agy itself must honour; it is not for production until the five Antigravity probes pass on the target.
- Added: Pre-seeded per-run CLI configuration (`$HOME/.gemini/antigravity-cli/settings.json`) with `toolPermission = "strict"`, `enableTerminalSandbox = true`, `allowNonWorkspaceAccess = false`, unified permission syntax, and refusal of shell, commands, web, browser, and MCP.
- Added: Deterministic supervisor-owned `PreToolUse` hook (`pre-tool-hook.mjs` + `hooks.json`) enforcing mode profiles and workspace path containment (`judgeWorkspacePath`), and outputting an audited `ApprovalLedgerEntry` ledger (`hook-ledger.jsonl`).
- Added: Zero-inference preparation check for Antigravity (`vibe-supervisor prepare check`) validating settings and hooks, running zero-inference slash command read-backs (`/config`, `/hooks`, `/permissions`, `/skills` through a refusing loopback proxy), executing synthetic hook evaluations, running five probes through agy itself with a fixed fake key and a scripted loopback model (hook invoked and deny honoured, hook failure modes deny, stream tool-event shape, proxy honoured, project configuration above the workspace not loaded), and issuing a preparation receipt bound to the `agy` binary SHA-256 digest. Any probe that does not pass fails the receipt.
- Added: Untrusted workspace extensions guard (`assertNoProjectAntigravityExtensions`) rejecting projects with `.gemini`, `.agents/hooks.json`, `.agents/mcp_config.json`, or `.agents/plugins`.
- Fixed (cold review before release): an unreadable path argument now denies for every tool; only known visible-answer stream shapes are kept and other text is withheld and counted; Google API keys are redacted; agy gets an exact environment without `ANTIGRAVITY_HOME` or `MISTRAL_API_KEY`; one executable resolver binds the receipt to the spawned binary, re-hashed before spawn, and the version probe runs without secrets; budgets use canonical roots and count every session; output overflow fails as an output limit instead of a timeout; leftover helper processes are terminated and verified.

### Access control & exclusions

- Added: `excluded_globs` configured per allowed workspace root, anchored at root, evaluated in linear time, dropped from review listings, merged into worker denylists, verified in read-backs, and enforced by approval handlers (`path_excluded`).
- Added: Protection against nested roots removing parent exclusions, invalid canonicalization, or exceeding the 100-glob limit.

### Observation, ceilings & accounting

- Added: Audited tool-call counts in every run record and event stream (`usage.tool_calls` holding `executed`, `denied_by_handler`, and `denied_by_policy`).
- Added: Limits enforcement in run records (`limits.max_tokens`, `limits.max_cost_usd`, and `limits.max_model_calls` backstop).
- Added: Daily cost ledger (`daily_cost_ledger.json`) and per-root spending limits (`budgets.<root>.max_cost_usd_per_day`), enforcing 24-hour rolling ceilings across standard and isolated session runs and surfacing budget blockers in `vibe_status`. A USD budget is rejected with `backend = "antigravity"`, which reports no cost.
- Added: `vibe-supervisor runs usage [--since <YYYY-MM-DD>] [--root <path>] [--json]` CLI command.

### Verification, auditing & standardized exports

- Added: Run approval ledger saved as `artifacts/approvals.json` (up to 4,096 entries) and included in `runs export`, with sanitization of out-of-workspace paths to `<outside-workspace>` and digest verification (`source_sha256`, `exported_sha256`).
- Added: structured review findings: `vibe_review_start` takes `output: "findings"`, the worker is asked to end with a JSON findings block, and the supervisor validates each finding (path inside the workspace and not excluded, line bounds within the file) and saves `artifacts/findings.json` with the rejected entries counted.
- Added: SARIF 2.1.0 export of those findings (`vibe-supervisor runs sarif <run-id> [--output <file>]`), with stable per-finding fingerprints.
- Added: `vibe-supervisor runs usefulness [--since YYYY-MM-DD] [--json]` calculating decided edit run acceptance rates.
- Added: Multi-session run enumeration (`runs list` scanning up to 128 isolated session directories; `runs show` and `runs tail` read the data root's runs).

### Fixed

- Fixed: under `serve --isolated`, readiness and starts looked for the preparation receipt in the per-connection session directory instead of the selected configuration's directory, so an installed candidate with a passing `prepare check` reported not eligible.
- Fixed: on macOS a process group whose only members were zombies counted as running, so a naturally exited worker could be reported as `worker_termination_unverified`.

### Releases

- Documented: Pre-release `v2.0.1` published at `44dc6f8` with tested archive `7978719c…`.
- Documented: Pre-release `v2.0.2` published at `b275b1b` with tested archive `84bff941…`.

## 2.0.2 — run reporting after the 2.0.1 sitting

Release: the tested archive from `b275b1b` (SHA-256 `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09`), published as a pre-release by the owner. Everything after `44dc6f8`, the commit 2.0.1's tested archive was built from. The runtime changes are reporting only: launch, the pin, the session configuration and read-back, the approval handler, the event validator, cleanup, packaging and the conformance script are unchanged from 2.0.1, and restart recovery only also records the failed outcome; it still launches, resumes and replays nothing. No target gate of 2.0.1 transfers to this archive; `docs/acceptance.json` records, gate by gate, which 2.0.1 evidence is a reasonable basis and what 2.0.2 still needs.

- Fixed: closing a run lost its outcome, so an exported report showed `execution.state` `unknown` and no start time for a review that had completed. The run record now keeps `execution_state` (`completed`, `failed` or `cancelled`) beside the close state, records `started_at` when the run is first observed running, and restart recovery sets both to failed; a record written without the field still reports `unknown`. The run schema lists `execution_state`.
- Changed: a count-only `reasoning_observation` diagnostic at the end of each turn records the structured reasoning entries dropped from the stream (`streamed_entries`) and from the audited history (`history_entries`), and whether that audit completed (`history_audited`); `runs export --include events` keeps the three fields. It replaces scanning private files for a word, which cannot attribute anything to generated reasoning. No content is kept.
- Changed: an export without recorded cleanup evidence says the evidence was not recorded or the run has not settled.

Documentation:

- The nested-write probe in the [target acceptance procedure](docs/target-acceptance.md) names `tools.file_system.write_file` with `path` and `content`, as Vibe 2.26.1's source defines it, and asks for labeled review rows instead of an unlabeled sequence ([hosted continuation](docs/hosted-continuation.md)). The thinking-off gate reads the structured counts instead of the word-count watcher.
- Worker answer quality is stated as a limit in the README, [security](docs/security.md#what-is-not-isolated) and [compatibility](docs/compatibility.md): the supervisor reports what the worker did, not whether its answer is right.
- The target machine may fix code it finds broken on a branch pushed for review; the fix is a new candidate whose earlier evidence does not transfer.
- The recorded target evidence of 2.0.1 is in `docs/acceptance.json` and [compatibility](docs/compatibility.md#candidate-acceptance).

## 2.0.1 — one version; acceptance, preparation and validation

Release: the tested archive from `44dc6f8` (SHA-256 `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`), published as a pre-release by the owner. On main since 2026-10-15. It combines the one-version cleanup with the coordinator workflow built in parallel on the 2.0 line. The five MCP tools, the one active slot, the detached edit worktrees and the no-replay rule are unchanged. No target gate of 2.0.0 or of an earlier build transfers to this one; `docs/acceptance.json` records which gates its own target sitting closed and which stay open.

Known limit (owner decision 2026-10-16): Worker answer quality is not guaranteed and is not a supervisor gate. On the target, the hosted review ran with read-only integrity and verified cleanup but its answer was wrong, and the hosted edit was reported rejected by its acceptance contract; the supervisor's isolation, permissions, events and cleanup were observed working in both. Verify every result independently: the acceptance contract, the export and your own checks decide, never the worker's summary.

Fixes from the target sitting:

- Fixed: the preparation kit could name different bytes than the archive it shipped with. npm runs `prepare` during `npm pack` even with `--ignore-scripts`, which rebuilt `dist` without its SBOM, and packaging hashed the candidate only after regenerating the external SBOM. `package:rc` now captures the candidate identity right after packing, installs the exact archive offline with lifecycle scripts off into a temporary private prefix, and announces success only when the installed identity, version and conformance-script hash match the kit and every kit checksum verifies; the delivery `SHA256SUMS` now lists the kit files, and the temporary installation is removed on success or failure ([preparation](docs/preparation.md)).

One version:

- Fixed: the validation helper's lockfile check matched `excludeLinksFromLockfile`, which every pnpm 9 lockfile contains, so every pnpm project was blocked; it now matches only dependency specifiers.
- One supported version: only the latest release is supported, and Vibe 2.26.1 is the only Vibe release described or accepted.
- The development history, the recorded evidence of earlier candidates and the superseded launcher decision record are removed from the tree. The wire facts keep their basis in [compatibility](docs/compatibility.md#source-basis): the Vibe tag commit and the SHA-256 of every file read.
- New [target acceptance procedure](docs/target-acceptance.md): the reusable steps, authorizations and stop rules that prove a build against one Vibe release on the machine that runs Vibe, including the disconnect procedure. The evidence placeholders are in AGENTS.md.
- The disconnect and fixture-verification scripts and their tests carry neutral names: `scripts/disconnect-client.mjs`, `scripts/disconnect-observer.mjs`, `scripts/fixture-verify.mjs`.
- The unverified Codex plugin scaffold is removed; Codex plugin packaging returns in 2.2 in the current layout.
- Saved run records with an unknown engine are skipped by the same rule as any other unreadable record, without a special case.
- `docs/acceptance.json` keeps the 2.0 gates, verified and unverified, and drops every record of other candidates. A test fails the build when a document, script or source file refers to another supervisor version, another Vibe version or the removed history.

Target conformance repairs ([ADR 0005](docs/adr/0005-target-conformance-repairs.md)), from the first no-inference check of 2.0.0 against the installed Vibe:

- A null `harnessSelectionSource` in `config/read` is accepted as provenance; the unified-harness, hooks and skills checks stay strict.
- Vibe 2.26.1 refreshes a remote managed configuration at session open whenever a provider key is present. Each worker now gets an owned loopback `vibe_base_url` that answers only `GET /api/v1/code/managed-config` with a disabled policy and refuses everything else; the URL is required in the effective read-back before the first turn, and the listener closes with the worker. Remote organization policy is excluded by design. Provider inference URLs are unchanged.
- The conformance check's network control enables telemetry and experiments, every request a subject run makes fails the check, and the experiments-specific gate stays unverified from host-only observations.

Vibe's own skills ([ADR 0006](docs/adr/0006-bundled-vibe-skills.md), owner decision):

- The read-back accepts Vibe 2.26.1's packaged plugin skills `vibe:create-plugin`, `vibe:skill-creator`, `vibe:vibe` and `vibe:worktree`, each with source `plugin`, scope `builtin`, no registry and a unique name. Unknown, duplicate, provenance-free and user/project/registry entries still fail. User and project skills stay disabled, and the tool profiles and approval rules do not change.

Acceptance and reporting ([workflow acceptance](docs/workflow-acceptance.md)):

- `vibe_edit_start` takes an optional strict `acceptance_contract`: exact allowed and required changed paths, `file_exists`, `file_absent`, `text_contains`, `text_not_contains` and `file_sha256` assertions, and required coordinator validation IDs. It is normalized, hashed and frozen before launch, and evaluated on the committed base plus the exact exported patch in a private index. Checks never run project code; missing, unsafe or changed inputs give `incomplete`, never a pass.
- Execution, automated verification and the coordinator's assessment are separate. `vibe_close` takes an optional `assessment` bound to the patch and contract hashes and the coordinator's validations; assessments append, including corrections after close.
- `vibe-supervisor runs verify|export <run-id> --out <directory>` writes a sanitized report (`report.json`, `checks.json`, `diagnostics.json`, `REPORT.md`, `SHA256SUMS`), optionally with the exact patch and projected events; no transcript, reasoning, receipt or credential is exported, and a patch that trips the credential check is refused rather than rewritten.
- Run records keep prompt, completion and cached tokens, model calls and the source of the cost estimate, the model name, alias, thinking setting and prices reported at startup and after each verified handoff, and the cleanup outcome. Unknown identities, prices and phase boundaries stay unknown.

Preparation ([preparation](docs/preparation.md)):

- `npm run package:rc` writes a version-matched `preparation-kit-<version>/` beside the archive. `vibe-supervisor prepare check --kit <dir> --config <file>` verifies the kit against the installed candidate, runs the no-inference conformance check once with a fixed fake key and the refusing network observer, and saves a private receipt and report beside the pin manifest. Starting a check invalidates an earlier pass.
- Ordinary dispatch requires a matching preparation pass for the candidate, pin manifest, Node runtime, platform and policy (allowed roots excepted). Readiness reports `workspace_eligible` separately from `eligible`, the connected `candidate` and the `preparation` state, and an optional `expected_candidate` detects a connection running another build. The pin is still checked at launch.

Validation copies ([validation workspaces](docs/validation-workspace.md)):

- `vibe-supervisor validation prepare` creates independent baseline and candidate Git copies from an immutable base and the exact patch bytes, with hooks and global Git configuration off, a filtered environment and an exact package-manager pin; dependencies install only from a private copy of a populated offline cache with lifecycle scripts off, and unsupported project configurations are explicit blockers. It runs no project checks. `validation clean` removes only an owned copy whose content still matches its manifest.

The coordinator skill describes the main-chat coordinator, deterministic acceptance before any rejection, append-only corrections, preparation and validation, and the evidence-backed fallback rule.

## 2.0.0 — one engine: a client of Vibe's app-server

Version set on 2026-10-14. The GitHub release follows the target-machine acceptance recorded in `docs/acceptance.json`.

The supervisor drives Mistral Vibe 2.26.1 as a client of `vibe-app-server` (JSON-RPC over stdio, one process per run). The five MCP tools and every boundary are described in [ADR 0004](docs/adr/0004-app-server-client.md). The runtime has only been exercised against a scripted fake server, and every 2.0 gate in `docs/acceptance.json` is open.

- No `backend` configuration key, no second backend, no worker diagnostics file or `VIBE_SUPERVISOR_DIAGNOSTICS`, and no `grep` tool. Tool names and outcomes are in the event log instead.
- Breaking: `paths.vibe_pin_manifest` is required, and a configuration with a `backend` key is rejected. Generate the manifest with `vibe-supervisor pin-manifest` on the machine that runs Vibe; `setup` adds the default path.
- Pin: before each spawn the installed `mistral_vibe` files are hashed against the manifest, and the server must report exactly 2.26.1. Drift fails closed. The check covers that distribution's `RECORD` only, not dependencies, `.pth` files, the interpreter or `__pycache__`.
- Enforcement: the session configuration and `VIBE_*` environment disable subagents, shell, connectors, skills, MCP, telemetry and session logging; a supervisor-written agent profile asks for every profile tool and denies reserved and secret paths; the startup read-back fails the run on any difference before the first turn; the supervisor answers every approval, approving only the profile's tool on an in-workspace path and denying anything else after 5 seconds; and the event validator fails a run on any allowed effect it did not approve, any unknown history entry kind, or a gap in event ids.
- Reviews have `read_file` only and no search or listing tool. The model's catalogue still lists `write_file`, `edit`, the shell tool and `run_typescript`, which the protocol cannot hide; they are refused when called and recorded as `tool_denied` events (fields `tool`, `outcome`, `reason`, `entry_id`, `path`).
- Stop reasons `turn_limit`, `token_limit`, `price_limit`, `refusal` and `cancelled`. New optional `limits.max_tokens` and `limits.max_cost_usd`, enforced by the supervisor because the Vibe server does not enforce them. Usage and cost are rebuilt from the session statistics.
- Run records, events and results name the engine as `backend: app-server`. `doctor` runs the pin check, and its provenance records the backend.
- Reasoning stays off disk: session logging is off, thinking is off, Vibe's throwaway store lives in a private `TMPDIR` that is deleted at close, and restart recovery deletes the private directories of interrupted runs and warns when it cannot. A reaper process kills the worker group if the supervisor disappears or the deadline passes. The credential reaches the worker only in its environment, resolved from `MISTRAL_API_KEY` or the macOS Keychain by Node.
