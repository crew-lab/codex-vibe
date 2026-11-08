# Current state — 2026-11-08

The goal is for Codex to hand a task to Vibe and reliably get back a useful review or an isolated patch. Feature work and the 2.2.1 release are on hold while we compare that workflow with using an Ollama model directly in Codex. See the [development strategy](planning/development-strategy.md).

## Where things are

- **Released.** v2.2.0 (2026-10-27) is the latest release.
- **On `main`, unreleased 2.2.1** ([changelog](CHANGELOG.md)): any stable Vibe at or above 3.0.2; the generated `task authorize` command and complete `start_request`; search-first `context_files`; the frozen contract delivered to the worker with the `node_test` check; edit briefs that name the project root, test imports, conflict behaviour and no execution; the export output fix; the Antigravity key from the launchd session; readiness `pinned_version` from the manifest; the [quality pack](docs/quality-pack.md).
- **Checked here.** CI is green on Node 20.19.0 and 24.21.0. `verify:release` passes on both, `package:rc` runs end to end with an offline cache, and the quality pack's checkers pass correct solutions and fail wrong ones on both Node versions.
- **Target machine prepared against Vibe 3.1.0 on 2026-11-08.** Candidate `c34bf3f0ead29d40b83b30a54171ec96a9ba1323dd5a9d0e1a32ac282d281bdf` passed `doctor` and the no-inference `prepare check`. The Codex MCP registration was updated to that candidate. The repository has no recorded real-task result for that build or paired result against Ollama. [Preparation details](https://github.com/crew-lab/codex-vibe/commit/0caf629)
- **Paired comparison fixtures prepared.** Fixtures initialized at `$ROOT/orders-quality` (Track A, allowed in candidate config) and `$ROOT/orders-quality-ollama` (Track B, isolated clone for direct in-place edits) at base `dcc431785a4cce5e238a4603d4d0e58306913cd9`. Phase 1 baseline tasks (`review-total`, `edit-shipping`) prepared with Track B fairness adjustment (permitting standard test execution). [Protocol and scorecard](research/evidence/paired-comparison-protocol-20261108/README.md)

## What works

In recorded default-backend runs, reviews stayed read-only and edits stayed in their worktrees. An independently checked review and edit were accepted on the released 2.2.0 build. [2.2.0 run evidence](research/evidence/v2.2.0-local-workflow-20261027/README.md)

## What does not work well yet

- **Edit quality.** Real edits were rejected for missing named `node:test` cases, a broken test import, the wrong project root and partial writes on a conflict. The updated brief and contract target those failures. [Real-use edit evidence](research/evidence/real-use-design-20261028/README.md) and [linking-helper trial](research/evidence/linking-helper-backends-20261102/REPORT.md)
- **Review quality.** Reviews sometimes reach the wrong answer. The worker can read files and has no search tool.
- **Antigravity probes.** With `antigravity_skip_permissions` enabled, the probes exercise the hook on a read. Coverage for review-mode writes and shell calls remains open. Antigravity is outside this comparison.

## Next

1. Pick one real review and one small real edit with independently checkable outcomes. Use a repository suitable for both providers. Run each task through the prepared Vibe candidate and directly in Codex with one Ollama model. Use the same committed base, brief and acceptance criteria, with separate clean copies for edits.
2. Record correctness, elapsed time from starting the task to a verified result, and hands-on interventions such as gathering context, retrying or repairing output. Use each workflow as it is normally used and count that effort in the comparison. The [quality pack](docs/quality-pack.md) remains available to diagnose a specific failure.
3. Keep working on the supervisor if its handoff produces useful results with less effort. Shelve it if direct use through Ollama is at least as useful and easier. Keep the release, review search and backend work on hold until the comparison is in.

The 2026-11-04 history rewrite still requires a fresh clone for pre-rewrite checkouts. The owner follow-up with GitHub Support about cached commits and pull-request refs is tracked in the [rewrite notes](research/history-rewrite-2026-11-04.md).

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
