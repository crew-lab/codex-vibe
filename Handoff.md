# Current handoff

Updated 2026-10-14. Status only: what the release is, what is done, what remains and who does it, what is open, and where the records are. The picture, the plan, the lessons and the rules are in the [development strategy](docs/development-strategy.md); the boundaries are in [AGENTS.md](AGENTS.md).

## Release identity

- **Candidate:** `vibe-supervisor` 2.0.0 on branch `claude/app-server-design` at `e88c2f0`; version 2.0.0 in `package.json`, `package-lock.json` and `.codex-plugin/plugin.json`; Vibe pinned to 2.26.1 (`src/backends/app-server/supported-vibe.ts`). One engine, a client of `vibe-app-server`; the legacy harness path, the Python launcher, the `backend` key and the programmatic backend are removed. Exercised against the scripted fake only; nothing has run against a real Vibe, and every target gate in `docs/acceptance.json` is open.
- **Main** is at `d9d9dae`, which the branch does not contain. A merge conflicts in `Handoff.md` only; the branch version wins.
- **Owner decisions on record (2026-10-14):** 1.0.1 is skipped; 2.0.0 is the next release and the stable major version; 2.0.1 drops every other version and removes the development history; the push token's `workflow` scope is skipped, so verification is local; the open 2.0.0 decisions are settled as listed below; Antigravity is a client candidate only, never a worker; the bounded workspace file listing in the prompt is in.
- **Published:** 1.0.0, the last 1.x release with no maintenance line ([GitHub release](https://github.com/crew-lab/codex-vibe/releases/tag/v1.0.0), archive SHA256 `4e91e90bb7cb48c4411e1dc02820e91abddd690fc430f15a65ad6a9f3bd1c610`, source `f0f317e10d5d021f171ed38f5a85bb8e2354f12d`). The 1.0.1 candidates (rc.1, rc.2) were never released; their records stay in `docs/acceptance.json` and `docs/reviews/` until 2.0.1 removes them.

## Done

| What | Commits |
|---|---|
| Design note and ADR 0004; design cold review applied; wire facts closed from the v2.26.1 source | `fa74147`, `c3da259`, `1eea01b` |
| Scripted fake `vibe-app-server` with scenarios and tests | `bb2ba78` |
| Transport, protocol, pin, credentials, reaper; session configuration, read-back, approvals, event validation, usage and outcome; the backend against the fake; wiring, config keys, restart cleanup, `doctor`, `pin-manifest` | `d4ae9c4`, `9a2dee3`, `dddf42e`, `437fa3b` |
| Documentation for the engine (reference, functionality, security, compatibility, acceptance gates, ADR statuses); legacy engine removed | `170a8b8`, `6430537` |
| Read-back of the active agent, default and enabled agents, MCP discovery errors and an idle session at start | `3b93d4d` |
| Target kit: the brief and the no-inference conformance check (`scripts/v2-conformance-check.mjs`), with a non-key-shaped fake credential in its test | `0573178`, `24ed294` |
| Ports from `codex/unified-harness-v2`: handoff re-validation with usage continuity, effect-to-callback fingerprints; the review file listing | `2006e98` |
| Doc gaps from the verification pass: no 1.x maintenance line, read-only reviews, local verification, every diagnostic reason, no shipped doc linking into history | `3655cff` |
| Decisions recorded: the 2.0 path, 1.0.1 skipped, the settled 2.0.0 decisions, the skipped `workflow` scope | `f836351`, `eafb32d`, `fc05bbf`, `0b4a994` |
| Cold-review fixes: ten of eleven findings fixed with regression tests; the pin's reach stays the documented limit (the list is in the [strategy](docs/development-strategy.md#where-200-stands)) | `4716747` |
| Release wording, the changelog's 2.0.0 entry, version 2.0.0; `verify:release` on exactly Node 20.19.0 (83 files, 1244 tests) recorded as gate `node-floor-20.19.0`, `PASSED_LOCALLY` | `e486030` |
| Development strategy, marketing strategy, the 2.0 article draft with editor notes, the Antigravity research (all unshipped except the strategy under `docs/`) | `21c3e41`, `c57bf46`, `2a3198a`, `b3a8278`, `e88c2f0` |

**Settled 2.0.0 decisions** (delegated to Claude by the owner, 2026-10-14; each keeps what is built and tested):
- Error codes: `invalid_api_key` → `VSUP_AUTH_REQUIRED`; `invalid_model` → `VSUP_BACKEND_ERROR` classified as configuration; `context_too_long`, `response_too_long` and a `length` stop → `VSUP_OUTPUT_LIMIT`; `rate_limit` → `VSUP_RATE_LIMITED`.
- Pin reach for 2.0.0: the installed Vibe package's `RECORD` files only, against the manifest generated on the target; dependencies, `.pth`, the interpreter and `__pycache__` are documented as not covered. 2.0.1 adds a shipped manifest derived from the published wheel.
- Off-profile calls: a call Vibe or the handler denies is recorded and the run continues; a call that runs without the handler's approval ends the run.
- Refusal: `completed`, with a refusal warning.
- Design choices: the Node reaper, the Keychain lookup in Node and the per-candidate manifest stay.
- Readiness checks that `vibe-app-server` exists, not the full pin; the full pin runs at each run start and in `doctor`.
- Budgets: `limits.max_tokens` and `limits.max_cost_usd` stay optional and unset by default.

## Remaining

| # | Step | Who | Needs |
|---|---|---|---|
| 1 | Merge `claude/app-server-design` to main (take the branch `Handoff.md`), `make push` | Agent merges; owner authorizes the push | Nothing else |
| 2 | `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`; release notes from the changelog | Agent; owner gives the cache path | Step 1 |
| 3 | Target sitting per the [brief](docs/history/v2-target-brief.md), stopping at the first failure: build and install next to the current prefix; `pin-manifest` and `doctor`; the conformance check (`--observe-network`); native readiness; one hosted review (with the nested-write probe and the reasoning watcher) and one hosted edit, verified independently; one MCP-client disconnect (a third hosted run) | Target agent runs; owner gives five separate authorizations and the allowance of three hosted runs | Step 2 |
| 4 | Clean-account installation on the frozen archive (gate `clean-account-install`) | Owner | Step 2 |
| 5 | Record the evidence: gates to `VERIFIED` in `docs/acceptance.json` with their rows in `docs/compatibility.md`, `npm run acceptance`, placeholders from [REDACTION.md](docs/reviews/REDACTION.md); frozen archive SHA-256 | Agent | Steps 3, 4 |
| 6 | Tag and publish 2.0.0 with checksums and the acceptance record | Owner | Step 5; nothing else is retagged or replaced |
| 7 | 2.0.1 on a branch from main, in the strategy's [order](docs/development-strategy.md#releases): move the dependencies out of `docs/history/`, remove the history and every other version, rename the `v1-*` scripts and tests | Agent | Step 6 |
| 8 | Delete the stale remote branches (list below); confirm `claude/v1.0.0` first, since its tip (`90ded78`) is two commits ahead of the `v1.0.0` tag; keep `codex/unified-harness-v2` until its remaining ideas are ported | Owner | Any time; `codex/unified-harness-v2` after 2.0.1 |
| 9 | Decide the repository rename (`codex-vibe` → `vibe-supervisor`) and read the Mistral and OpenAI brand pages | Owner | Before the article goes out |
| 10 | Read the 2.0 article draft (`marketing/article/devto-2.0.md`) with its [editor notes](marketing/article/editor-notes.md); publish after 2.0.0 with the AI-Assisted label and the `[UPDATE AT PUBLISH]` markers filled, in the marketing strategy's [order](marketing/strategy.md#6-next-actions-in-order). The 1.0 draft in `docs/history/article/` leaves with 2.0.1 | Owner reads and publishes; agent fills the markers from the evidence | Step 6 |
| 11 | 2.1: Antigravity as a verified MCP client (docs and four target gates) | Agent docs; owner decides the scope reading, provides the account and runs the sitting | 2.0.1 tagged |

**Stale remote branches.** Merged into main: `claude/v1.0.0-bump`, `claude/v1.0.1-docs`, `claude/v1.0.1-rc.2`, `claude/v1.0.1-unblock` and eleven `codex/*` branches (`connection-readiness-handoff`, `devto-development-article`, `lifecycle-triage`, `preparation-diagnostics`, `rc21-multichat-hotfix`, `rc23-reconnect-hotfix`, `rc7-testing-fixes`, `rc8-stall-diagnostics`, `turn-limit-diagnostics`, `v1-release-confirmation`, `v1-stable-strategy`). Superseded and unmerged: `codex/project-agents-isolation`, `codex/rc1-runtime-consolidation`, `codex/rc28-target-evidence`, `codex/skill-cleanup-update`, `claude/session-pruning`, `claude/v1.0.0`.

**The skipped `workflow` scope.** Until it is added, no workflow file can be pushed, so `claude/ci-checks` (`8904c13`) and `claude/release-workflow` stay local and the 2.0 line has no CI. To unblock: at https://github.com/settings/tokens give the push token the `workflow` scope (fine-grained: "Workflows: Read and write" on `crew-lab/codex-vibe`), update the Keychain entry `crew-lab-codex-vibe-github-token` if the value changed, then push `claude/ci-checks` rebased onto the 2.0 line and watch its first run.

## Open questions

**Only the target can answer** (each fails closed; the consequences are in the [strategy](docs/development-strategy.md#verification-model), and the brief records which way each goes): whether a callback's `relatedEntryId` is filled at the entry or only in `detail`; whether handler-approved effects carry `approvalType` `ask` and `approvalSource` `user`; whether `agentConfig.maxTurns` is enforced; how long Vibe keeps a callback open; whether a large legitimate `write_file` fits the 8 MiB line cap; whether thinking off stops reasoning generation; whether `experiments.enable = false` stops the experiments request; what the real server leaves in `tmp` after stdin EOF; which history entry kinds and notification methods a real run produces.

**For the owner:** whether a second verified MCP client (Antigravity) is documentation plus evidence or the platform scope AGENTS.md forbids (the strategy recommends the former; 2.1 does not start without it); the repository rename; whether to post the Mistral Discussion with the protocol questions (catalogue narrowing, a search builtin, omitting reasoning, honouring budgets, a protocol version, the stable callback name), whose answers would remove 2.0.1 work.

**Known to be untouched by this candidate:** `.codex-plugin/plugin.json` is an unverified scaffold outside the npm package; Linux and Windows code paths exist without a support claim; `docs/development-strategy.md` ships inside `docs/` while pointing at unshipped files (`Handoff.md`, `marketing/`, `research/`), which 2.0.1 should settle by excluding it from `files` or moving it.

## Pointers

Shipped: [functionality](docs/functionality.md), [reference](docs/reference.md), [security](docs/security.md), [compatibility](docs/compatibility.md) (gates and diagnostic reasons), [errors](docs/errors.md) (generated), `docs/acceptance.json` (machine-readable gates), [ADR 0004](docs/adr/0004-app-server-client.md), the coordinator skill `skills/vibe-supervisor`.

Source repository only, in [docs/history/](docs/history/): the [2.0 path](docs/history/v2-path-2026-10-14.md), the [design note](docs/history/app-server-client-design.md), the [protocol audit](docs/history/app-server-protocol-audit-2026-10-14.md) and the [source answers](docs/history/app-server-source-answers-2026-10-14.md) with their file hashes, the [target brief](docs/history/v2-target-brief.md), the [disconnect brief](docs/history/case7-disconnect-brief.md), the [usefulness log](docs/history/usefulness-log.md), the [outreach drafts](docs/history/outreach-drafts.md) and the [1.0 article](docs/history/article/draft-1.0.md). Target-machine evidence is in [docs/reviews/](docs/reviews/). Unshipped planning and strategy material: the [implementation plan](planning/v2-implementation-plan.md) for 2.0.0 and 2.0.1, [marketing/strategy.md](marketing/strategy.md), [marketing/interest.md](marketing/interest.md), [research/features-2026-10-14.md](research/features-2026-10-14.md), [marketing/article/](marketing/article/editor-notes.md), [research/antigravity-2026-10-14.md](research/antigravity-2026-10-14.md). Everything older than 2026-10-12 is in Git history at `c510513`.

| Area | Code |
|---|---|
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, policy reread and readiness receipts, saved-run routing after `--isolated` reconnect | `src/core/`, `src/config/policy.ts` |
| App-server client: backend, JSON-RPC transport, protocol subset, session configuration and read-back, approval handler, event validator, usage and outcome mapping, pin check, credentials, workspace listing; the reaper | `src/backends/app-server.ts`, `src/backends/app-server/`, `src/process/reaper.ts` |
| Worktrees, private-index export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `pin-manifest`, `serve`, `runs` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release, conformance and coordinator scripts (not shipped) | `scripts/` |

## Fixed scope and safeguards

Exactly five one-shot MCP tools; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, or new platform scope. Reviews are read-only; edits use isolated detached worktrees. The enforcement points and the pin are listed in the [strategy](docs/development-strategy.md#architecture-and-enforcement-points) and fixed by [AGENTS.md](AGENTS.md). Missing evidence remains unknown: 2.0 has no acceptance evidence yet, and no other platform or universal answer-quality guarantee is made.
