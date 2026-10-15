# Changelog

## 2.0.1 — one version; acceptance, preparation and validation

Unreleased; on main since 2026-10-15. It combines the one-version cleanup with the coordinator workflow built in parallel on the 2.0 line. The five MCP tools, the one active slot, the detached edit worktrees and the no-replay rule are unchanged. No target gate of 2.0.0 or of an earlier build transfers to this one; its gates are open in `docs/acceptance.json` until its own target sitting.

One version:

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
