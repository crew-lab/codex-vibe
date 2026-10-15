# Current handoff

Updated 2026-10-15. Status only: what the source, the archives and the installations are, what remains and who does it, what is open, and where the records are. The picture and the rules are in the [development strategy](docs/development-strategy.md); the sequenced work is in the [development plan](planning/development-plan.md); the boundaries are in [AGENTS.md](AGENTS.md).

## Release identity

- **Source.** `vibe-supervisor` 2.0.1, unreleased: the one-version cleanup merged on main, plus the coordinator workflow line (acceptance contracts and assessments, sanitized reports, version-matched preparation, owned validation copies, the managed-configuration repair of ADR 0005 and the bundled skills of ADR 0006), integrated from `2e920d3` on branch `claude/integrate-workflow` and not yet on main. On the uncommitted merge, under Node 20.19.0 and npm 10.8.2, lint, typecheck, build, the full suite (88 files, 1,285 tests), `npm run acceptance` and the secret scan passed; that is not the node-floor gate, which needs the frozen source. Version 2.0.1 in `package.json` and `package-lock.json`; Vibe pinned to 2.26.1 (`src/backends/app-server/supported-vibe.ts`). One engine, a client of `vibe-app-server`. The tree describes and accepts no other supervisor version and no other Vibe version, and holds no development history; a guard test in `tests/unit` keeps it so.
- **The v2.0.0 draft on GitHub.** Created by the owner on 2026-10-15 with target `f2c2119` (`0101f28` plus a test-race fix and a packaging fix) and archive `vibe-supervisor-2.0.0.tgz` SHA-256 `485ecce329560507e54f1450790629f877e3623754e56ea11343a81dc753576f`. It has none of the workflow features and no target evidence. Its `src/` is byte-identical to the 2.0.0 runtime whose first no-inference target check failed: `config/read` parsing rejected the null `harnessSelectionSource` that Vibe 2.26.1 reports, and startup connections were seen ([ADR 0005](docs/adr/0005-target-conformance-repairs.md)); the next check found Vibe's packaged skills listed where that runtime requires none ([ADR 0006](docs/adr/0006-bundled-vibe-skills.md)). Published as it is, every start would fail before the first turn on the real Vibe. **Recommendation: do not publish it**; build the stable release from the integrated line after that build's own target sitting. One release of the previous major stays published and untouched.
- **The workflow candidate's evidence.** Source `91afad4`, frozen archive SHA-256 `d1fd22ec04e50048c052cdf013b4d235b525dffc2efb11596dd29f8253003f6a`, installed distribution identity `a3600f7632ea42a221d342734dd1b6cb17deaaf072211693a728e31c0437b053`, on macOS arm64 with Node 24.21.0 and the installed Vibe 2.26.1, 2026-10-15: release verification passed (1,260 tests in 87 files), the offline installed-package smoke passed, the no-inference conformance check passed once with a fixed fake key and no inference, installed readiness through the official SDK passed and rejected a wrong expected candidate, and the validation helper passed a real npm offline fixture. Zero hosted starts. The sanitized records are the evidence packet at commit `2e920d3`; `docs/acceptance.json` summarizes them under `evidence_builds` and the `workflow-candidate-*` entries. The packet's own README says it does not certify an integrated package, and it does not: every gate of this build is open until rerun.
- **Installations.** The selected desktop installation is still on an earlier workflow candidate, the one that first permitted the bundled skills; the workflow candidate above was installed only in a disposable prefix, and the desktop connection was not switched or checked on it. Recheck the live state before another task. Earlier hosted work on `<site-project>` belongs to that earlier candidate and its own evidence; the owner supplied its outcome in chat, and no fallback edits were applied to that website patch. It verifies nothing here.
- **Owner decisions on record:** only the latest release is supported; the push token's `workflow` scope is skipped, so verification is local; Antigravity is a client candidate only, never a worker; the bounded workspace file listing in the prompt is in; ADR 0005's managed-configuration isolation and ADR 0006's bundled skills ("Let vibe have own skills"); a Vibe implementation request already authorizes its task-scoped preparation (installing or switching the candidate, the no-inference check, adding only the named task root, settings and rollback kept), while extra hosted starts, broader roots, publication, deployment and unrelated global changes need their own yes; the main chat coordinates and verifies, Vibe implements, and GPT-6 Luna/high is the fallback only after a verified rejection of the exported bytes.

**Settled decisions** (delegated to Claude by the owner; each keeps what is built and tested):
- Error codes: `invalid_api_key` → `VSUP_AUTH_REQUIRED`; `invalid_model` → `VSUP_BACKEND_ERROR` classified as configuration; `context_too_long`, `response_too_long` and a `length` stop → `VSUP_OUTPUT_LIMIT`; `rate_limit` → `VSUP_RATE_LIMITED`.
- Pin reach: the installed Vibe package's `RECORD` files only, against the manifest generated on the target; dependencies, `.pth`, the interpreter and `__pycache__` are documented as not covered. A shipped manifest derived from the published wheel is planned for 2.1.
- Off-profile calls: a call Vibe or the handler denies is recorded and the run continues; a call that runs without the handler's approval ends the run.
- Refusal: `completed`, with a refusal warning.
- Design choices: the Node reaper, the Keychain lookup in Node and the per-candidate manifest stay.
- Readiness checks that `vibe-app-server` exists, not the full pin; the full pin runs at each run start and in `doctor`. Readiness also requires the matching preparation pass.
- Budgets: `limits.max_tokens` and `limits.max_cost_usd` stay optional and unset by default.

## Remaining

| # | Step | Who | Needs |
|---|---|---|---|
| 1 | Done: the integration is on main (`6c645e3`), followed by the plan update (`29545fd`) and the pre-packaging cleanup (`3de455e`: code comments removed, a shipped example neutralized, the unverified plugin scaffold deleted) | — | — |
| 2 | Done 2026-10-15: the owner deleted the unpublished v2.0.0 draft; 2.0.1 is the first 2.x release. The 2.0.0 commit `f2c2119` stays in main's history | — | — |
| 3 | Done 2026-10-15: 2.0.1 packaged from `9d2bbde` (after the pnpm lockfile fix) under Node 20.19.0 with a dedicated offline cache; `package:rc` passed (88 files, 1,292 tests; offline smoke). Assets in `release/2.0.1/` on the preparing machine with `SHA256SUMS`: `vibe-supervisor-2.0.1.tgz` `73c28081bfad86d1cd2b2ec16d7ba22c28a4e82b4e5f903e5c9341ff4acf4010`, `preparation-kit-2.0.1.tar.gz` `4c0fdc17d4a6e483431642fd94d28e97959a2c913e8f3549685026a9d25206ae`, `sbom.spdx.json`, `acceptance.json`. It supersedes the earlier `3de455e` package | — | — |
| 4 | Done 2026-10-15: `validation prepare` passed with a populated pnpm store on a public fixture (nvm Node 20.19.0, pnpm 9.15.4); it first exposed and then confirmed the fix for a lockfile check that blocked every pnpm 9 project (gate `validation-populated-pnpm-dependencies`, PASSED_LOCALLY) | — | — |
| 5 | On the target machine, from git: fetch main at `eb52ce3` or later (the [section below](#testing-on-another-machine) has the commands), fill an offline npm cache with the locked versions, `npm run package:rc` under exactly Node 20.19.0, and record the archive and kit SHA-256 the target produced. `release/` is not in git and archives are not byte-reproducible across machines (the SBOM's time and namespace), so the target tests, and the release publishes, the target-built archive; the preparing machine's package (`73c28081…`) is the reference build. Then the [target acceptance procedure](docs/target-acceptance.md) on that archive, stopping at the first failure: install next to the current prefix with rollback; `pin-manifest` and `doctor`; `prepare check` with the kit; native readiness with `expected_candidate`; one hosted review (nested-write probe, reasoning watcher) and one hosted edit with an acceptance contract, verified independently, closed and exported; one MCP-client disconnect (a third hosted run) | Target agent runs; owner gives the authorizations (1 to 3 are covered when the sitting serves a Vibe implementation request) and three hosted runs | Steps 1 to 4 |
| 6 | Clean-account installation of the target-built archive (gate `clean-account-install`) | Owner | Step 5 |
| 7 | Record the evidence on an evidence branch from main: the target-built archive and kit SHA-256 as `frozen_archive_sha256` and `packaging_time_snapshot`, gates to `VERIFIED` in `docs/acceptance.json` with their rows in `docs/compatibility.md`, `npm run acceptance`, placeholders from [AGENTS.md](AGENTS.md#recording-target-evidence); push the branch for review and merge | Target agent; coordinator reviews and merges | Steps 5 and 6 |
| 8 | Publish v2.0.1 from the target-built assets (archive, kit, SBOM, packaging report, `SHA256SUMS`) with release notes adapted from [planning/release-notes-2.0.0.md](planning/release-notes-2.0.0.md), tagged at the commit the target packaged; a pre-release label if any gate is still open | Owner | Step 7 |
| 9 | Done: GitHub holds `main` only; the merged branches and local worktrees are removed | — | — |
| 10 | Decide the repository rename (`codex-vibe` → `vibe-supervisor`) and read the Mistral and OpenAI brand pages | Owner | Before the article goes out |
| 11 | Read the 2.0 article draft (`marketing/article/devto-2.0.md`) with its [editor notes](marketing/article/editor-notes.md) and [story sources](marketing/sources.md); update it for the workflow features and publish after the release with the AI-Assisted label and the `[UPDATE AT PUBLISH]` markers filled, in the marketing strategy's [order](marketing/strategy.md#6-next-actions-in-order) | Owner reads and publishes; agent fills the markers from the evidence | Step 8 |
| 12 | 2.1 per the [plan](planning/development-plan.md): what the workflow line did not already deliver, Antigravity as a verified MCP client included | Agents; owner decides the Antigravity scope reading and the wheel download | Step 8 |

**The skipped `workflow` scope.** Until it is added, no workflow file can be pushed, so the repository has no CI. To unblock: at https://github.com/settings/tokens give the push token the `workflow` scope (fine-grained: "Workflows: Read and write" on `crew-lab/codex-vibe`), update the Keychain entry `crew-lab-codex-vibe-github-token` if the value changed, then push the local CI branch rebased onto the current line and watch its first run.

## Testing on another machine

Main is one thread: every former branch, the deleted v2.0.0 draft's commit `f2c2119`, the 2.0.1 cleanup and the workflow line are in its history, and GitHub holds `main` only. On another Mac (Apple silicon, Node 20.19 or later, Git):

```bash
git clone https://github.com/crew-lab/codex-vibe.git vibe-supervisor && cd vibe-supervisor && npm ci && npm run verify:release
```

`verify:release` needs no Vibe and no network beyond `npm ci`. To package offline, fill a dedicated npm cache with the locked versions first, then package; `package:rc` also writes `release/preparation-kit-<version>/`, which belongs to that archive:

```bash
CACHE="$PWD/.npm-offline-cache" && node -e 'const l=require("./package-lock.json");const s=new Set();for(const[k,v]of Object.entries(l.packages)){if(!k||v.link||!v.version)continue;s.add((v.name||k.slice(k.lastIndexOf("node_modules/")+13))+"@"+v.version)}console.log([...s].join("\n"))' | xargs -P 8 -n 1 npm cache add --cache "$CACHE" && VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc
```

Hosted behaviour needs Vibe 2.26.1 and follows [docs/target-acceptance.md](docs/target-acceptance.md): after `pin-manifest`, run `vibe-supervisor prepare check --kit <absolute path of the kit> --config "$CONFIG"` once, because readiness and every start need its pass. The v2.0.0 draft archive (`f2c2119`, SHA-256 `485ecce3…`) is not a useful target build: it lacks the repairs above.

Deleting the remote branches that main already contains (owner; it skips any branch that is not an ancestor of main):

```bash
git fetch --prune origin && for b in $(git for-each-ref --format='%(refname:strip=3)' refs/remotes/origin | grep -v -x -e HEAD -e main); do git merge-base --is-ancestor "origin/$b" origin/main && git push origin --delete "$b"; done
```

## Open questions

**Only the target can answer** (each fails closed; the consequences are in the [strategy](docs/development-strategy.md#verification-model), and the [procedure](docs/target-acceptance.md) records which way each goes): whether a callback's `relatedEntryId` is filled at the entry or only in `detail`; whether handler-approved effects carry `approvalType` `ask` and `approvalSource` `user`; whether `agentConfig.maxTurns` is enforced; how long Vibe keeps a callback open; whether a large legitimate `write_file` fits the 8 MiB line cap; whether thinking off stops reasoning generation; whether `experiments.enable = false` stops the experiments request (a host-only proxy observation cannot say); which history entry kinds and notification methods a hosted run produces. The workflow candidate's no-inference check already showed that the real server leaves nothing in `tmp` after stdin EOF and sends `runtime/updated` at startup; rerun on this build before relying on either.

**For the owner:** whether a second verified MCP client (Antigravity) is documentation plus evidence or the platform scope AGENTS.md forbids (the strategy recommends the former; 2.1 does not start without it); the repository rename; whether to post the Mistral Discussion with the protocol questions (catalogue narrowing, a search builtin, omitting reasoning, honouring budgets, a protocol version, the stable callback name), whose answers would remove work; the vendor-wheel download for the shipped manifest; the next hosted allowance.

**Known limits of this state:** Linux and Windows code paths exist without a support claim; `docs/development-strategy.md` ships inside `docs/` while pointing at unshipped files (`Handoff.md`, `planning/`, `marketing/`, `research/`), which should be settled by excluding it from `files` or moving it; the validation helper blocks project manager configuration, local dependencies and required build scripts until a reviewed profile exists.

## Evidence rules

Vibe is never installed, run or tested on the preparing machine; questions about Vibe are answered from its tagged source, checked against the hashes in [compatibility](docs/compatibility.md#source-basis). Behavior is proven only on the target machine, with the owner's authorization and budget for each step, and the target records evidence and changes no code. Evidence names the exact source, archive and installed distribution it belongs to, and never transfers to other bytes. Evidence uses the placeholders in [AGENTS.md](AGENTS.md#recording-target-evidence) from the start, because the repository is public. Missing evidence stays "unverified".

## Pointers

Shipped: [functionality](docs/functionality.md), [reference](docs/reference.md), [security](docs/security.md), [compatibility](docs/compatibility.md) (source basis, gates and diagnostic reasons), [target acceptance](docs/target-acceptance.md), [workflow acceptance](docs/workflow-acceptance.md), [preparation](docs/preparation.md), [validation workspaces](docs/validation-workspace.md), [errors](docs/errors.md) (generated), `docs/acceptance.json` (machine-readable gates), [ADR 0004](docs/adr/0004-app-server-client.md), [ADR 0005](docs/adr/0005-target-conformance-repairs.md), [ADR 0006](docs/adr/0006-bundled-vibe-skills.md), the coordinator skill `skills/vibe-supervisor`.

Source repository only, not shipped: the [development plan](planning/development-plan.md) and its [2.1 design sketches](planning/2.1-designs.md), [marketing/strategy.md](marketing/strategy.md), [marketing/interest.md](marketing/interest.md), [marketing/sources.md](marketing/sources.md), [marketing/article/](marketing/article/editor-notes.md), [research/features-2026-10-14.md](research/features-2026-10-14.md), [research/antigravity-2026-10-14.md](research/antigravity-2026-10-14.md). The workflow candidate's evidence packet is at commit `2e920d3`.

| Area | Code |
|---|---|
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, policy reread and readiness receipts, saved-run routing after `--isolated` reconnect | `src/core/`, `src/config/policy.ts` |
| App-server client: backend, JSON-RPC transport, protocol subset, session configuration and read-back, managed-config endpoint, bundled skills, approval handler, event validator, usage and outcome mapping, pin check, credentials, workspace listing; the reaper | `src/backends/app-server.ts`, `src/backends/app-server/`, `src/process/reaper.ts` |
| Acceptance contracts, assessments and verification | `src/acceptance/` |
| Reports, private-file reads, model observations | `src/reporting/` |
| Preparation evidence and the dispatch gate | `src/preparation/`, `src/cli/prepare.ts` |
| Validation copies | `src/validation/`, `src/cli/validation.ts` |
| Worktrees, private-index export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `pin-manifest`, `serve`, `prepare`, `validation`, `runs` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release, conformance and coordinator scripts (only the conformance script ships, for the kit) | `scripts/` |

## Fixed scope and safeguards

Exactly five one-shot MCP tools; one owned active slot; canonical allowlists; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, extra hosted starts or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Bundled skills stay inside the same tool and path policy. The enforcement points and the pin are listed in the [strategy](docs/development-strategy.md#architecture-and-enforcement-points) and fixed by [AGENTS.md](AGENTS.md). Private runtime state stays private and evidence is sanitized; uncertain cleanup retains files. These are application-policy controls, not an OS sandbox. Missing evidence remains unknown: this build has no target evidence yet, and no other platform or universal answer-quality guarantee is made.
