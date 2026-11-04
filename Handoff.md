# Current state — 2026-11-04

**The goal:** Codex hands a task to Vibe, Vibe reviews or implements it, and it works well every time. This page holds only what works, what does not, and what is next.

**Released.** v2.2.0 (2026-10-27) is the latest release. `main` carries unreleased 2.2.1; the [changelog](CHANGELOG.md) lists it: any stable Vibe at or above 3.0.2, the generated `task authorize` command, search-first `context_files`, contract delivery to the worker with the `node_test` check, the export output fix, the Antigravity key from launchd, and fixes from the 2026-11-03 code review.

**What works.** The boundary has held on every real run: reviews stay read-only, edits stay in their worktree, nothing reaches shell or network, and runs clean up after themselves.

**What does not work well yet.**

- Edit quality. Real edits were rejected for content the worker could have got right: missing named `node:test` cases, a broken test import, the wrong project root, partial writes on a conflict. The edit brief in the [skill](.agents/skills/vibe-supervisor/SKILL.md) now asks for each of these, and the frozen contract now reaches the worker; neither has run on a real edit yet.
- Review quality. Reviews stay in bounds but sometimes reach the wrong answer; they cannot search the code, only read the files given as `context_files`.
- With `antigravity_skip_permissions` on, the agy probes exercise the hook on a read only, not on a review-mode write or a shell tool. Adding those needs agy's real tool names and argument schemas, so it is done on the machine that has agy.

**Next.**

1. On the machine that runs Vibe: a fresh `git clone` (history was rewritten on 2026-11-04, so older clones must go), then `npm ci`, `npm run package:rc`, install the archive, `pin-manifest`, `prepare check`, and run the [quality pack](docs/quality-pack.md) (two edits and two reviews with independent checks) plus real tasks through Codex. Fix whatever breaks, on a branch.
2. Compare quality-pack results across changes; that decides whether reviews need a search tool ([design](planning/review-search-tool.md)) and whether the Antigravity backend stays.
3. Release 2.2.1 once real runs work.

## Testing on another machine

On another Mac (Apple silicon, Node 20.19 or later, Git):

```bash
git clone https://github.com/crew-lab/codex-vibe.git vibe-supervisor && cd vibe-supervisor && npm ci && npm run verify:release
```

`verify:release` needs no Vibe and no network beyond `npm ci`. To package offline, fill a dedicated npm cache with the locked versions first, then package; `package:rc` also writes `release/preparation-kit-<version>/`, which belongs to that archive:

```bash
CACHE="$PWD/.npm-offline-cache" && node -e 'const l=require("./package-lock.json");const s=new Set();for(const[k,v]of Object.entries(l.packages)){if(!k||v.link||!v.version)continue;s.add((v.name||k.slice(k.lastIndexOf("node_modules/")+13))+"@"+v.version)}console.log([...s].join("\n"))' | xargs -P 8 -n 1 npm cache add --cache "$CACHE" && VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc
```

Vibe runs only on the machine that has it installed. After `pin-manifest`, run `vibe-supervisor prepare check --kit <absolute path of the kit> --config "$CONFIG"` once, because readiness and every start need its pass.

## Pointers

Shipped: [functionality](docs/functionality.md), [reference](docs/reference.md), [security](docs/security.md), [compatibility](docs/compatibility.md) (source basis and diagnostic reasons), [compatibility for 3.0.2](docs/compatibility-v3.md), [workflow acceptance](docs/workflow-acceptance.md), [preparation](docs/preparation.md), [validation workspaces](docs/validation-workspace.md), [local operation](docs/local-operation.md), [errors](docs/errors.md) (generated), `docs/acceptance.json` (machine-readable gates), the ADRs under `docs/adr/`, the coordinator skill `skills/vibe-supervisor`.

Source repository only, not shipped: the [development strategy](planning/development-strategy.md), `marketing/`, `research/`.

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
