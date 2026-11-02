# vibe-supervisor

A local MCP server for one bounded Mistral Vibe review or isolated edit. It exposes exactly five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, and `vibe_close`. Edits run in a supervisor-created detached Git worktree and return a patch for review; the supervisor never applies, commits, merges, or pushes it automatically.

This is an application policy boundary, **not an operating-system sandbox**. A delegated run uses your account's permissions, and permitted workspace content is sent to Mistral. Review [SECURITY.md](SECURITY.md) before use.

This is `vibe-supervisor`. v2.2.0 is the published, supported release and is being marked latest by the owner's decision D2 of 2026-10-28; `main` carries unreleased 2.2.1 work. By default the supervisor is a client of Vibe 3.0.2's `vibe-app-server` protocol (one server process per run); Vibe 3.0.2 is the sole accepted and default version, and any other version fails closed. Google Antigravity (`agy` CLI) is an optional, **experimental** execution backend, off by default (`backend = "antigravity"` with `experimental.antigravity = true`) and frozen at agy 1.4.9 on 2026-10-28. Its tool gate is a hook that agy itself must honour, and that has not been recorded through agy: it is not for production until the [Antigravity probes](docs/target-acceptance.md#antigravity-backend-probes) in `prepare check` are recorded for the candidate (see [security](docs/security.md#antigravity-backend-experimental)). The supervisor verifies installed Vibe against a pin manifest before each run, reads the effective configuration back before the model sees a prompt, answers every approval itself, and refuses any tool outside the profile. The model's tool catalogue still lists write tools that are refused when called, not hidden. Only the latest release is supported.

Around the five tools sit the coordinator's workflow pieces: an optional frozen [acceptance contract](docs/workflow-acceptance.md) checked against the exact exported patch, an append-only assessment on close, sanitized `runs verify` and `runs export` reports, a [version-matched preparation check](docs/preparation.md) that ordinary dispatch requires, and [owned validation copies](docs/validation-workspace.md) for the coordinator's own checks. Workspace eligibility and preparation are reported separately. Every start needs a single-use grant from `vibe-supervisor task authorize`, and a refused grant names the fields that differ. Each run record saves its token, model-call and tool-call counts and the ceilings in force; `excluded_globs` per allowed root keeps further paths away from the worker; an edit can be bounded with `allowed_write_paths`; `runs list` also covers isolated sessions; `runs usefulness` reports how often edit runs were accepted; `runs export` adds the run's approval ledger and pin identity; reviews can return structured findings with `runs sarif`; and per-root daily cost budgets feed `runs usage`. See [reference](docs/reference.md) and the [changelog](CHANGELOG.md).

Two claims, each with its own evidence. Supervision: deny by default, the read-back before any turn, effects matched to approvals, pin drift failing closed and no replay have held on every target sitting since 2.0.1 and in both 2.2.0 trials. Usefulness: whether Codex gets a better answer by delegating has no real-use data yet. The 2.0.1 hosted review and edit were rejected (a wrong answer, a missed contract); the 2.1.0 fixture edit and both 2.2.0 trials were accepted. That is a pattern, not a rate, and worker answer quality is not a supervisor gate. Verify every result independently: the acceptance contract, the export and your own checks decide, never the worker's summary.

The 2.2.0 archive (SHA-256 `6b0a120d…`, candidate `81df8140…`) passed release verification on Node 20.19.0 (109 files, 1,567 tests), the no-inference preparation check and native readiness, then one accepted native edit and one accepted native review under Node 24.21.0 with an isolated Vibe 3.0.2 (source repository: `research/evidence/v2.2.0-local-workflow-20261027/`). The [acceptance record](docs/acceptance.json) lists, per build, what was observed and what stays open, among them the client disconnect, the nested `run_typescript` probe, the thinking-off effect, the clean-account installation and every Antigravity probe; [compatibility](docs/compatibility.md#unverified-gates) says why each is open. Evidence never transfers to a different archive. 2.0.1, 2.0.2 and 2.1.0 are earlier pre-releases, historical and unsupported; their Vibe 2.26.1 evidence applies only to the named archives.

## Requirements

- Node.js 20.19 or newer, npm, and Git. Release checks cover Node 20.19.0 and Node 24.21.0. Preparation remains specific to the actual server runtime.
- Mistral Vibe exactly 3.0.2, driven through its `vibe-app-server`. The installed files must match a pin manifest you generate on the machine that runs Vibe. Other versions fail closed:

  ```sh
  uv tool install mistral-vibe==3.0.2
  vibe
  ```

  Complete Vibe sign-in in the browser before a real run, or provide `MISTRAL_API_KEY` in the supervisor's environment. Doctor checks local prerequisites and the pin, not provider authentication.

## Source setup

For local source work:

```sh
npm ci
npm run build
```

This builds the checkout for local inspection; it does not install the package. Install the exact tarball from the matching GitHub release into a private local prefix, using a populated offline npm cache and `--ignore-scripts`. Review its checksums and the exact executable/config paths before updating Codex registration; retain the previous prefix and a configuration backup for rollback. Source setup does not update an existing installation.

## Configuration and connection

The starter workspace allowlist is empty. On a fresh source checkout, initialize the explicit private config by allowing the canonical repository first. `allow` creates a missing config and adds only the requested root:

```sh
CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
node dist/cli.js allow --config "$CONFIG" "$PWD"
node dist/cli.js pin-manifest --config "$CONFIG"
node dist/cli.js doctor --config "$CONFIG" --json
node dist/cli.js serve --stdio --isolated --config "$CONFIG"
```

Replace `$PWD` with the intended canonical repository path if it is not the current directory. To keep paths such as fixtures with real data, dumps or `*.tfvars` away from every run under a root, list them under `[excluded_globs]` in that config, keyed by the root exactly as written in `allowed_workspace_roots` (see [reference](docs/reference.md#excluded-paths); write `dir/**`, not `dir`, to cover a directory's contents). `paths.vibe_pin_manifest` is required in the config; `allow` on a new config sets it beside the config file, and `pin-manifest` writes that file from the installed Vibe (review what it recorded, since it records whatever is installed). The `backend` key defaults to `"app-server"` (Mistral Vibe 3.0.2). The experimental `"antigravity"` backend (with optional `paths.antigravity`) also needs `experimental.antigravity = true`; running agy headless under a consumer Google sign-in may be outside Antigravity's consumer terms, so prefer an API key or enterprise authentication. An explicit missing or invalid config fails for doctor/serve and never falls back. Without an override, it uses `~/Library/Application Support/VibeSupervisor-oneshot` on macOS, `%APPDATA%/VibeSupervisor-oneshot` on Windows, or `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` on Linux. `VIBE_SUPERVISOR_HOME` explicitly selects another root.
Codex `setup` generates `--isolated` registrations by default. Each connection owns a separate private storage directory, so another chat can connect without competing for the same owner lock. Existing registrations need the flag added and the connection reloaded; setup previews that change before writing it. Each instance still permits one active run. Direct `serve` without `--isolated` remains available for a deliberately shared storage owner.

Bind preparation, doctor, allow, and serve to the same explicit config. For a separately installed artifact, use its exact executable path and config for every command. Identify the connection that will own the run with a `vibe_status` readiness call and its `server_version`, which does not depend on an MCP initialization handshake; an installed CLI or doctor result cannot identify a previously open desktop connection.

## One-shot workflow

1. Review the config and choose a clean Git base: select an existing immutable commit and pass it as `base_ref`, preserving unrelated uncommitted changes. Uncommitted bytes are never an edit base.
2. Once per installed candidate, pin manifest, Node runtime and policy, run `vibe-supervisor prepare check --kit <preparation-kit-VERSION> --config "$CONFIG"` with the kit shipped beside the archive. It runs the no-inference conformance check once with a fixed fake key and no model turn, and saves private evidence; without a matching PASS, readiness is not eligible and starts are refused. Changing only the allowed roots keeps the evidence.
3. Check readiness on the owning connection with `vibe_status` in workspace mode (`workspace`, `operation`, and `base_ref` for an edit). It starts nothing; it reports `workspace_eligible`, the connected `candidate`, the `preparation` state and, when you pass `expected_candidate`, whether the connection runs the build you meant. A blocker is a preparation failure, not a Vibe result. Allowlist changes in the selected config are picked up without a restart. The reply's `task_authorize` holds the exact `vibe-supervisor task authorize` command for that server (its Node, its CLI and its `--config`) and a request template: add the task text, write the private request file, run the command, then pass its `authorization_id` and `attempt_id`, the exact authorized request, and the returned `readiness_receipt` to the matching start tool. Assembling the command by hand instead, pass `supervisor_runtime.executable` as `--runtime-node` when the CLI may use a different Node installation. A second start on the same server/storage instance is rejected while the first run is active. Grants are local and single-use; there are no interactive Vibe permission grants, continuation tools, or restart recovery. A run interrupted by server restart is marked failed; its task is never replayed. An edit may carry an `acceptance_contract` (exact allowed and required paths, text and hash assertions, required validation IDs), frozen before launch.
4. Wait with `vibe_status`, inspect `vibe_result`, and verify the result independently. `completed` means execution ended, not that the work was accepted; read the stop reason (`turn_limit`, `token_limit`, `price_limit` and `refusal` are incomplete or non-answers). For edits, inspect the fresh patch and exact changed files while the worktree is available. For your own checks, `vibe-supervisor validation prepare` builds independent baseline and candidate copies from the base and the exact patch, with dependencies installed only from a populated offline cache and lifecycle scripts off.
5. Call `vibe_close` after review, optionally with an `assessment` bound to the patch and contract hashes and your validations. Assessments append, so a mistaken decision is corrected without erasing it. Cleanup is reported only after current-export and ownership checks; inspect any retained-worktree reason. `vibe-supervisor runs verify|export <run-id> --out <new directory>` re-checks the saved patch against the contract and writes a sanitized report.

Patches are never applied automatically. The worker has no shell or network tools, and a review has a read tool but no search tool: the prompt carries a bounded listing of the workspace's files (without reserved, secret and `excluded_globs` files), so still name the files that matter in the task or `context_files`. Run checks in a separate verification copy. It cannot guarantee that a prompt will finish within the declared turn or time limit.

## Skills and references

The package ships one coordinator skill at `.agents/skills/vibe-supervisor`, where Codex and Antigravity load it from this repository; `.claude/skills/vibe-supervisor` links to it for Claude Code. It describes the explicit config workflow, five-tool catalog, one-shot limits, verification, and close procedure. `.codex/agents/vibe-reviewer.toml` is a Codex custom agent that runs that sequence for one bounded review or edit; copy it into `~/.codex/agents/` yourself (see [the reference](docs/reference.md#codex-custom-agent)), the supervisor never writes there.

- [Tool, config, and CLI reference](docs/reference.md)
- [Behavior and lifecycle](docs/functionality.md)
- [Local operating procedure](docs/local-operation.md) for the qualified installation
- [Acceptance contracts, assessments and reports](docs/workflow-acceptance.md), [preparation](docs/preparation.md) and [validation workspaces](docs/validation-workspace.md)
- [Security](docs/security.md) and [error codes](docs/errors.md)
- [Vibe compatibility and unverified gates](docs/compatibility.md)
- [Acceptance record](docs/acceptance.json) and the [target acceptance procedure](docs/target-acceptance.md)


Contract delivery, structured Node test checks, complete authorization payloads and bounded fresh repair preparation are described in [contract workflow](docs/workflow-acceptance.md). Explicit coordinator test execution uses the [validation profile](docs/validation-workspace.md). These mechanisms preserve separate grants, one-shot runs and coordinator acceptance.
