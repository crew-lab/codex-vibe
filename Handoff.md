# Current state — 2026-11-05

**The goal:** Codex hands a task to Vibe, Vibe reviews or implements it, and it works well every time. This page holds only what works, what does not, and what is next; the order of work is in the [development strategy](planning/development-strategy.md).

## Where things are

- **Released.** v2.2.0 (2026-10-27) is the latest release.
- **On `main`, unreleased 2.2.1** ([changelog](CHANGELOG.md)): any stable Vibe at or above 3.0.2; the generated `task authorize` command and complete `start_request`; search-first `context_files`; the frozen contract delivered to the worker with the `node_test` check; edit briefs that name the project root, test imports, conflict behaviour and no execution; the export output fix; the Antigravity key from the launchd session; readiness `pinned_version` from the manifest; the [quality pack](docs/quality-pack.md).
- **Checked here.** CI is green on Node 20.19.0 and 24.21.0. `verify:release` passes on both, `package:rc` runs end to end with an offline cache, and the quality pack's checkers pass correct solutions and fail wrong ones on both Node versions.
- **Target machine prepared against Vibe 3.1.0.** Vibe was upgraded from 3.0.4 to 3.1.0 (`mistral-vibe v3.1.0`). Manifest generated with `pin-manifest --force` (747 files, RECORD SHA-256 `0e7fb0930517c6d46d07adbd90a9de666ee733cc19d3c4125864e10171b8ba3d`). Candidate `package:rc` built (candidate SHA-256 `c34bf3f0ead29d40b83b30a54171ec96a9ba1323dd5a9d0e1a32ac282d281bdf`, archive SHA-256 `3196a417a139bea525a94d9009604fe13c326ffa897a122817ff11eebbb03a17`) and installed at `~/.local/share/vibe-supervisor/2.2.1-vibe-310-c34bf3f0/`. `doctor --json` and `prepare check` passed with `status: passed` (report SHA-256 `3306bbf5c488204dce2badb110423da7a8d035e16074b9168736f847deec6807`, network verdict: `none-observed-control-validated`). Codex MCP registration updated to the new candidate. Next is running the quality pack through Codex.

## What works

The boundary has held on every real run: reviews stay read-only, edits stay in their worktree, nothing reaches shell or network, and runs clean up after themselves.

## What does not work well yet

- **Edit quality.** Real edits were rejected for content the worker could have got right: missing named `node:test` cases, a broken test import, the wrong project root, partial writes on a conflict. The brief and the delivered contract target each; the quality pack's two edits show whether that is enough.
- **Review quality.** Reviews stay in bounds but sometimes reach the wrong answer; they read only the files given as `context_files` and cannot search.
- **Antigravity probes.** With `antigravity_skip_permissions` on, the agy probes exercise the hook on a read only, not on a review-mode write or a shell tool. Adding those needs agy's real tool names and argument schemas, so it is done on the machine that has agy.

## Next

1. **On the machine that runs Vibe:** replace any existing checkout with a fresh `git clone` (history was rewritten on 2026-11-04; never push from an older clone), build, install and prepare as below, then run the [quality pack](docs/quality-pack.md) and real tasks through Codex. Fix whatever breaks, on a branch.
2. **Compare quality-pack results** across changes; they decide whether reviews need a search tool ([design](planning/review-search-tool.md)) and whether the Antigravity backend stays.
3. **Release 2.2.1** once real runs work.
4. **Owner:** ask GitHub Support to purge the pre-rewrite commits of `crew-lab/codex-vibe`; they stay reachable through the twelve pull-request refs and GitHub's cache. The old-to-new commit map is in [research](research/history-rewrite-2026-11-04.md).

## Build, install and prepare

On a Mac with Apple silicon, Node 20.19 or later and Git:

```bash
git clone https://github.com/crew-lab/codex-vibe.git vibe-supervisor && cd vibe-supervisor && npm ci && npm run verify:release
```

`verify:release` needs no Vibe and no network beyond `npm ci`. To package offline, fill a dedicated npm cache with the locked versions, then package; `package:rc` writes the archive, the SBOM and `release/preparation-kit-<version>/`, which belongs to that archive:

```bash
CACHE="$PWD/.npm-offline-cache" && node -e 'const l=require("./package-lock.json");const s=new Set();for(const[k,v]of Object.entries(l.packages)){if(!k||v.link||!v.version)continue;s.add((v.name||k.slice(k.lastIndexOf("node_modules/")+13))+"@"+v.version)}console.log([...s].join("\n"))' | xargs -P 8 -n 1 npm cache add --cache "$CACHE" && VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc
```

Install the archive and configure it as in [local operation](docs/local-operation.md). Vibe runs only on the machine that has it installed: run `vibe-supervisor pin-manifest`, then `vibe-supervisor prepare check --kit <absolute path of the kit> --config "$CONFIG"` once, because readiness and every start need its pass. After a Vibe upgrade, refresh the manifest with `pin-manifest --force`, pass `prepare check` again and rerun the quality pack.

## Pointers

Shipped: [functionality](docs/functionality.md), [reference](docs/reference.md), [security](docs/security.md), [compatibility](docs/compatibility.md) (source basis and diagnostic reasons), [compatibility for 3.0.2](docs/compatibility-v3.md), [workflow acceptance](docs/workflow-acceptance.md), [preparation](docs/preparation.md), [validation workspaces](docs/validation-workspace.md), [local operation](docs/local-operation.md), [quality pack](docs/quality-pack.md), [errors](docs/errors.md) (generated), the ADRs under `docs/adr/` (past decisions), the coordinator skill `.agents/skills/vibe-supervisor` and the Codex agent `.codex/agents/vibe-reviewer.toml`.

Source repository only, not shipped: the quality pack's `scripts/quality-pack.mjs` and `scripts/quality-pack/`, the [development strategy](planning/development-strategy.md), the [search tool design](planning/review-search-tool.md), `marketing/`, `research/`.

| Area | Code |
|---|---|
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, policy reread and readiness receipts, saved-run routing after `--isolated` reconnect | `src/core/`, `src/config/policy.ts` |
| App-server client: backend, JSON-RPC transport, protocol subset, the per-version wire table, session configuration and read-back, managed-config endpoint, bundled skills, approval handler, event validator, usage and outcome mapping, pin check, credentials, workspace listing; the reaper | `src/backends/app-server.ts`, `src/backends/app-server/`, `src/process/reaper.ts` |
| Antigravity backend, its hook and probes (experimental) | `src/backends/antigravity.ts`, `src/backends/antigravity/`, `src/preparation/antigravity-*.ts` |
| Acceptance contracts, assessments and verification | `src/acceptance/` |
| Reports, private-file reads, model observations | `src/reporting/` |
| Preparation evidence and the dispatch gate | `src/preparation/`, `src/cli/prepare.ts` |
| Validation copies | `src/validation/`, `src/cli/validation.ts` |
| Worktrees, private-index export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `pin-manifest`, `serve`, `prepare`, `validation`, `runs`, `task` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release, conformance and coordinator scripts (only the conformance script ships, for the kit) | `scripts/` |
