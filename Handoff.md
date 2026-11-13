# Current state — 2026-11-13

**The goal:** Codex hands a task to Vibe, Vibe reviews or implements it, and it works well every time. This page holds only what works, what does not, and what is next; the order of work is in the [development strategy](planning/development-strategy.md).

## Where things are

- **Released.** v2.2.0 (2026-10-27) is the latest release.
- **On `main`, unreleased 2.2.1** ([changelog](CHANGELOG.md)): any stable Vibe at or above 3.0.2; the generated `task authorize` command and complete `start_request`; search-first `context_files`; the frozen contract delivered to the worker with the `node_test` check; edit briefs that name the project root, test imports, conflict behaviour and no execution; the export output fix; the Antigravity key from the launchd session; readiness `pinned_version` from the manifest; the [quality pack](docs/quality-pack.md); the opt-in `app_server_wire_trace`; a completion or audited edit at the deadline kept instead of discarded; preparation bound to the Node major version.
- **Target machine:** prepared against Vibe 3.1.0 on 2026-11-08 (candidate `c34bf3f0…`). After installing a build with the 2026-11-13 fixes, run `prepare check` once more: the receipt identity changed to the Node major version.
- **The Ollama comparison is dropped** (owner, 2026-11-13). Its notes stay in [research](research/evidence/paired-comparison-protocol-20261108/README.md).

## What works

- **Boundary.** Reviews stay read-only, edits stay in their worktrees, nothing reaches shell or network, and runs clean up after themselves.
- **Edits.** On Vibe 3.1.0, `edit-shipping` fixed the threshold, touched only the two allowed files and passed all 14 tests on the exported patch.

## Fixed on 2026-11-13

- **A finished patch lost to the deadline.** A run that reached its timeout always failed with `VSUP_TIMEOUT`, even when Vibe's completion arrived during the interrupt or the edit was already written, because the cancel path tore the server down before the final history audit and the run manager's own timeout overrode the backend. Now the cancel waits for the audit; a turn that finished at the deadline keeps its result with a warning, and an edit cut off after audited writes completes with stop reason `timeout` so its contract and checks decide. A run with no audited writes, or whose audit fails, still times out. This covers the dangling-symlink replay whose correct patch was rejected at 300 seconds.
- **Stale preparation after a Node update.** The receipt was bound to the exact Node version, so 24.21.0 against 24.22.1 blocked dispatch. It now binds the Node major version.

## What does not work well yet

- **Review quality.** `review-total` found the tax defect and missed the shipping defect at exactly 5000 cents in three runs with different briefs, including one given the observed values. [Review evidence](research/evidence/paired-comparison-protocol-20261108/README.md#vibe-review-follow-up)
- **Small slips reject good edits.** Patches were rejected for a new code comment and for a wrong prefix in a regression test, while the source itself was right.
- **Turns that stall.** Two task-first runs stalled until the deadline after their patches were ready; with the deadline fix they now complete with stop reason `timeout`, but why Vibe kept the turn open is unexplained. Run with `app_server_wire_trace` when it recurs.
- **Antigravity probes.** With `antigravity_skip_permissions` on, the probes exercise the hook on a read only, not a review-mode write or a shell tool; that needs agy's real tool schemas.

## Next

1. **On the Vibe machine:** a fresh `git clone` (history was rewritten on 2026-11-04), build, install, `prepare check`, then real tasks through Codex. Fix whatever breaks, on a branch.
2. **Review quality:** include the failing command and its error in a review brief, and accept a proposed fix only after its reproduction passes.
3. **Owner:** ask GitHub Support to purge the pre-rewrite commits ([rewrite notes](research/history-rewrite-2026-11-04.md)).
4. **Release 2.2.1** once real runs work.

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
