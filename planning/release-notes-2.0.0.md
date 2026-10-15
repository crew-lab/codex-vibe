# Release notes template: vibe-supervisor 2.0.0

> **Template notes (delete this block before publishing).** Source: the 2.0.0 changelog entry and the documents at `0101f28`, the merged `docs/acceptance.json` on main, and the evidence summary. Used by the [development plan](development-plan.md), section 3.7: copy to `release/2.0.0/release-notes.md`, fill every `[FILL]` from the recorded results and hashes, nothing else. A gate that stayed open keeps its row with the finding instead of a pass, and its finding moves into "Limits". If the repository was renamed (plan section 3.6), replace `crew-lab/codex-vibe` with `crew-lab/vibe-supervisor` throughout. If the target found a code defect and 2.0.0 is skipped, this text becomes the 2.0.1 notes with the version changed and the 2.0.1 changelog entry added.

vibe-supervisor 2.0.0 is a local MCP server that lets Codex delegate one bounded review or one isolated edit to Mistral Vibe 2.26.1. Edits run in a detached Git worktree and return a patch that is never applied, committed, merged or pushed. Shell and network tools are off. This is an application policy boundary, not an OS sandbox: a delegated run uses your account's permissions, and the workspace content it reads is sent to Mistral. Supported: macOS on Apple silicon, Node.js 20.19 or later, Git, and Mistral Vibe exactly 2.26.1.

An independent project, not affiliated with Mistral AI or OpenAI.

## What changed since 1.0.0

2.0 has one engine. The supervisor is a client of Vibe's `vibe-app-server` protocol (JSON-RPC over stdio, one server process per run) instead of patching Vibe's Python internals. The five MCP tools stay: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, `vibe_close`. No hosted evidence from 1.0.x transfers to it; 2.0.0 has its own, below.

- **Removed:** the `vibe -p --legacy-harness` path, the Python launcher and its source pins, the `backend` configuration key and the programmatic backend, the worker diagnostics file and `VIBE_SUPERVISOR_DIAGNOSTICS`, and the `grep` tool. Tool names and outcomes are in the event log instead.
- **Pin:** before each run the installed `mistral_vibe` files are hashed against a manifest you generate with the new `vibe-supervisor pin-manifest`, and the server must report exactly 2.26.1. Drift fails closed.
- **Enforcement the supervisor owns:** the session configuration and `VIBE_*` environment turn off subagents, shell, connectors, skills, MCP, telemetry and session logging; a supervisor-written agent profile asks for every profile tool and denies reserved and secret paths; the effective configuration is read back and any difference fails the run before the first turn; the supervisor answers every approval, approving only the profile's tool on an in-workspace path and denying anything else after 5 seconds; and the event validator fails a run on any allowed effect it did not approve, any unknown history entry kind, or a gap in event ids.
- **Reviews** have `read_file` only, with a bounded listing of the workspace's files in the prompt; edits add `write_file` and `edit`.
- **Stop reasons** `turn_limit`, `token_limit`, `price_limit`, `refusal` and `cancelled`. New optional `limits.max_tokens` and `limits.max_cost_usd`, enforced by the supervisor because the Vibe server does not enforce them. Usage and cost are rebuilt from the session statistics.
- **Reasoning stays off disk:** session logging off, thinking off, Vibe's throwaway store in a private `TMPDIR` deleted at close and by restart recovery. A reaper process kills the worker's process group if the supervisor disappears or the deadline passes. The credential reaches the worker only in its environment, from `MISTRAL_API_KEY` or the macOS Keychain.
- **Breaking:** `paths.vibe_pin_manifest` is required, and a configuration with a `backend` key is rejected (below).

## Install

1. Vibe first, exactly 2.26.1, and sign in once (or provide `MISTRAL_API_KEY` in the supervisor's environment):

   ```sh
   uv tool install mistral-vibe==2.26.1
   vibe
   ```

2. Download the archive and the checksum file from this release and check the archive:

   ```sh
   gh release download v2.0.0 --repo crew-lab/codex-vibe --pattern vibe-supervisor-2.0.0.tgz --pattern SHA256SUMS
   grep ' vibe-supervisor-2.0.0.tgz$' SHA256SUMS | shasum -a 256 -c -
   ```

3. Install into a private prefix, without install scripts:

   ```sh
   PREFIX="$HOME/.local/vibe-supervisor-2.0.0"
   npm install --ignore-scripts --prefix "$PREFIX" ./vibe-supervisor-2.0.0.tgz
   VSUP="$PREFIX/node_modules/.bin/vibe-supervisor"
   "$VSUP" --version
   ```

4. From the root of the repository you want to delegate in, allow it, write the pin manifest for your installed Vibe (review what it recorded: it hashes whatever is installed now), and check:

   ```sh
   WORKSPACE="$PWD"
   CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
   "$VSUP" allow --config "$CONFIG" "$WORKSPACE"
   "$VSUP" pin-manifest --config "$CONFIG"
   "$VSUP" doctor --config "$CONFIG" --json
   ```

5. Register it with Codex: preview first, then write (a backup of your Codex configuration is kept), and restart Codex:

   ```sh
   "$VSUP" setup --workspace "$WORKSPACE" --config "$CONFIG" --codex user --dry-run
   "$VSUP" setup --workspace "$WORKSPACE" --config "$CONFIG" --codex user --yes
   ```

6. In Codex, check readiness with `vibe_status` (`workspace`, `operation`) before the first start; it runs nothing and costs nothing. The skill in `skills/vibe-supervisor` describes the whole workflow.

Keep your previous prefix and the configuration backup until 2.0.0 works for you; removing the prefix and restoring the backup is the rollback.

## Upgrading a 1.0 configuration

A 1.0 file is rejected until it sets `paths.vibe_pin_manifest` and drops any `backend` key. Remove `backend`, add `paths.vibe_pin_manifest` with an absolute path (`allow` and `setup` add the default, `vibe-pin-manifest.json` next to the config), and write that file with `pin-manifest` on the machine that runs Vibe. Nothing else in a 1.0 file changes meaning.

## Exact tested artifact

- Package SHA-256: `[FILL: archive SHA-256]`.
- Source: commit `0101f28691139307ee74e7b0295b7c622c336e41`, the tag `v2.0.0`.
- This archive was built once on the preparing machine, installed and tested on the target and on a clean account, and not rebuilt afterwards. Its bytes cannot be reproduced by a rebuild, because the SBOM inside it carries its creation time.
- Assets: `vibe-supervisor-2.0.0.tgz`; `SHA256SUMS` (archive, SBOM and packaging report, written at packaging); `sbom.spdx.json`; `acceptance.json`, the packaging-time report, which shows the target gates as open because they were recorded after packaging; `release-evidence.json`, the recorded results for this same archive; `asset-checksums.json`, covering every asset.

## Acceptance

Verified locally: lint, typecheck, build, 83 test files with 1,244 tests, the acceptance report, secret scan and SBOM, on exactly Node 20.19.0, and the offline installed-package smoke test with its exact five-tool catalogue.

Verified on the target machine (macOS Apple silicon, Vibe 2.26.1), on this archive, each step with its own authorization, stopping at the first failure, with no retries:

| Gate | Result |
|---|---|
| No-inference conformance check: pin manifest generated and verified, version, handshake, session start, the complete read-back, no turn | [FILL: result, date, pin hashing cost] |
| `permission = "ask"` visible in the effective configuration and reaching the approval handler | [FILL: result] |
| Experiments request off | [FILL: verdict] |
| Thinking off stops reasoning generation | [FILL: watcher result] |
| Native readiness on the Codex desktop connection, `server_version` 2.0.0 | [FILL: result] |
| One hosted review and one hosted edit, the edit verified independently, both closed with verified cleanup | [FILL: run outcomes, stop reasons, independent checks, usage as reported] |
| A write attempted from inside `run_typescript` arrives as a file-system effect and is denied | [FILL: result or NOT EXERCISED] |
| One MCP-client disconnect during a running hosted run: server exits, worker group gone, lock released, run failed and never replayed, private directories deleted, worktree kept until close | [FILL: result] |
| Clean macOS account installation, registration, rollback and cleanup | [FILL: result, date] |

Hosted runs used: [FILL: number] of three authorized, no retries. Usage and cost as the supervisor reported them: [FILL: tokens, model calls, cost estimate per run, or "not reported"]. The full record is `docs/acceptance.json` on main at [FILL: evidence commit] and `release-evidence.json` in this release.

## Limits

- macOS Apple silicon only. Linux and Windows code paths exist without a support claim.
- Vibe exactly 2.26.1. Any other version, and any drift in the installed files, fails closed. Each new Vibe release needs a new supervisor candidate.
- Application policy, not an OS sandbox. The worker runs with your account's permissions; the supervisor prevents what it can (approvals, the read-back) and detects the rest (the event validator can stop a run and record a breach, not undo it).
- The model's tool catalogue still lists `write_file`, `edit`, the shell tool and `run_typescript`; the protocol cannot hide them, so they are refused when called and recorded as `tool_denied`, not hidden.
- Reviews have no search tool; name the files that matter in the task or `context_files`.
- The pin covers the installed `mistral_vibe` distribution's `RECORD` only, not dependencies, `.pth` files, the interpreter or `__pycache__`, and it runs before the process starts: it detects drift, not a modified original.
- Token and cost ceilings can overshoot by one model call; cost is an estimate from Vibe's reported prices.
- One active run per server instance; no continuation, no interactive approvals, no replay after a restart; patches are never applied for you.
- A completed run proves execution, not that the answer is correct. Verify every answer yourself.
- `.codex-plugin/plugin.json` is an unverified scaffold outside the package; plugin installation is not supported.
- [FILL: each target finding accepted as a limit, for example reasoning still generated with thinking off, or the experiments request]

## What comes next

2.0.1 follows: the same runtime, with every reference to other supervisor and Vibe versions and the development history removed from the tree, and the reusable target acceptance procedure. Only the latest release is supported.

An independent project, not affiliated with Mistral AI or OpenAI.
