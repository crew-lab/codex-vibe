# vibe-supervisor 2.0.1

The first published 2.x release. vibe-supervisor is a local MCP server that lets Codex delegate one bounded code review, or one isolated edit returned as a patch and never applied, to Mistral Vibe 2.26.1 exactly. It is an independent project, not affiliated with Mistral AI or OpenAI. Application policy, not an OS sandbox. macOS on Apple silicon only.

Published as a **pre-release** until the MCP-client disconnect and the clean-account installation are recorded; see Acceptance.

## What changed since 1.0.0

- **One engine.** The supervisor is a client of Vibe's own `vibe-app-server` JSON-RPC protocol, one server process per run. It reads the effective configuration back before the first turn, answers every approval itself (only the profile's tool on an in-workspace path, five-second deadline, never a session or permanent grant), and fails a run on any effect it did not approve, an unknown entry kind or a gap in event ids. The old launcher, its backend key and every other engine are gone.
- **Target repairs.** Each worker gets an owned loopback endpoint that serves only a disabled managed-configuration policy and is read back (ADR 0005); Vibe's four packaged skills are accepted with their provenance, and no skill grants a tool, path, shell or network access (ADR 0006).
- **Coordinator workflow.** Acceptance contracts on the exported patch and append-only assessments; `runs verify` and `runs export`; per-run usage, model and price observations; owned validation copies with offline dependency preparation.
- **Preparation gate.** A version-matched preparation kit ships beside the archive; one no-inference `prepare check` per installed candidate, pin, runtime and policy must pass before dispatch, and the pin is still checked at launch.
- **Breaking.** A 1.0 configuration needs `paths.vibe_pin_manifest` and loses any `backend` key. Only the latest release is supported.

## Install

1. Vibe first, exactly 2.26.1, and sign in once (or provide `MISTRAL_API_KEY` in the supervisor's environment):

   ```sh
   uv tool install mistral-vibe==2.26.1
   vibe
   ```

2. Download the archive, the preparation kit and the checksum file, and check them:

   ```sh
   gh release download v2.0.1 --repo crew-lab/codex-vibe --pattern vibe-supervisor-2.0.1.tgz --pattern preparation-kit-2.0.1.tar.gz --pattern SHA256SUMS
   shasum -a 256 -c --ignore-missing SHA256SUMS
   tar -xzf preparation-kit-2.0.1.tar.gz
   ```

3. Install into a private prefix, without install scripts:

   ```sh
   PREFIX="$HOME/.local/vibe-supervisor-2.0.1"
   npm install --ignore-scripts --prefix "$PREFIX" ./vibe-supervisor-2.0.1.tgz
   VSUP="$PREFIX/node_modules/.bin/vibe-supervisor"
   "$VSUP" --version
   ```

4. From the root of the repository you want to delegate in, allow it, write the pin manifest for your installed Vibe (review it: it hashes whatever is installed now), check, and run the preparation check once:

   ```sh
   WORKSPACE="$PWD"
   CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
   "$VSUP" allow --config "$CONFIG" "$WORKSPACE"
   "$VSUP" pin-manifest --config "$CONFIG"
   "$VSUP" doctor --config "$CONFIG" --json
   "$VSUP" prepare check --kit "$PWD/preparation-kit-2.0.1" --config "$CONFIG"
   ```

5. Register it with Codex: preview first, then write (a backup of your Codex configuration is kept), and restart Codex:

   ```sh
   "$VSUP" setup --workspace "$WORKSPACE" --config "$CONFIG" --codex user --dry-run
   "$VSUP" setup --workspace "$WORKSPACE" --config "$CONFIG" --codex user --yes
   ```

6. In Codex, check readiness with `vibe_status` before the first start; it runs nothing and costs nothing. The skill in `skills/vibe-supervisor` describes the whole workflow.

Keep your previous prefix and the configuration backup until 2.0.1 works for you; removing the prefix and restoring the backup is the rollback.

## Exact tested artifact

- Source: commit `44dc6f815c1b80ac75c0ce2613373e38ed2421c8` (this release's tag).
- Archive: `vibe-supervisor-2.0.1.tgz`, SHA-256 `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`, packaged by the target agent under Node 20.19.0 and npm 10.8.2 (89 files, 1,296 tests); installed candidate `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`.
- The archive is not byte-reproducible on another machine (the SBOM records a creation time and a random namespace); these are the bytes that were tested.

## Acceptance

| Gate | Result |
|---|---|
| Release verification, offline installed-package smoke, package and kit identity | Passed on this archive |
| No-inference conformance check against the installed Vibe 2.26.1 | Passed |
| Installed SDK readiness; native desktop readiness | Passed |
| Node 20.19.0 floor | Passed |
| Populated pnpm validation | Passed locally on a public fixture |
| Hosted review and hosted edit | **Not passed; documented limitation (owner decision).** The review ran read-only with verified cleanup but its answer was wrong; the edit was reported rejected by its acceptance contract. Supervisor isolation, approvals, events and cleanup were observed working |
| MCP-client disconnect | Open: authorized, not yet run |
| Clean-account installation | Open |
| `permission = "ask"` read-back of per-tool fields; thinking-off effect; experiments fetch attribution; nested `run_typescript` gating | Open or not exercised |

The machine-readable record is `docs/acceptance.json` at the tag.

## Limits

- Worker answer quality is not guaranteed and is not a supervisor gate. Verify every result independently: the acceptance contract, the export and your own checks decide, never the worker's summary.
- Application policy, not an OS sandbox: Vibe runs as you, and what it reads goes to Mistral.
- The model-visible tool catalogue cannot be narrowed: write and shell tools stay listed and are refused when called, never hidden. Reviews have no search tool.
- The pin covers the installed `mistral_vibe` distribution's `RECORD`, not its dependencies, `.pth` files, the interpreter or `__pycache__`.
- Token and cost ceilings can overshoot by one model call; cost is an estimate from Vibe's reported prices, not a bill.
- macOS on Apple silicon, Vibe 2.26.1 exactly, Node 20.19 or later, one active run per server.

## What comes next

2.0.2 carries the reporting fixes already on main (execution outcome and start time kept in closed-run exports; structured reasoning counts) and the run schema's `execution_state`. 2.1 adds what the coordinator workflow does not yet measure: a usefulness summary over assessments, per-workspace exclusions, review findings with SARIF, the approval ledger in exports, and Antigravity as a verified MCP client.
