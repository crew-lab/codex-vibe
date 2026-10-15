# Current handoff

Updated 2026-10-15. Status only: what the release is, what remains and who does it, what is open, and where the records are. The picture, the plan, the lessons and the rules are in the [development strategy](docs/development-strategy.md); the boundaries are in [AGENTS.md](AGENTS.md).

## Release identity

- **Prepared:** `vibe-supervisor` 2.0.1 on branch `claude/v2.0.1-cleanup`; version 2.0.1 in `package.json`, `package-lock.json` and `.codex-plugin/plugin.json`; Vibe pinned to 2.26.1 (`src/backends/app-server/supported-vibe.ts`). One engine, a client of `vibe-app-server`. The tree describes and accepts no other supervisor version and no other Vibe version, and holds no development history; a guard test in `tests/unit` keeps it so.
- **Evidence:** the 2.0.0 target gates in `docs/acceptance.json` are still open. The runtime has been exercised against the scripted fake only; nothing has run against a real Vibe. `node-floor-20.19.0` is the one gate recorded (`PASSED_LOCALLY`).
- **Owner decisions on record:** only the latest release is supported; the push token's `workflow` scope is skipped, so verification is local; the settled decisions below; Antigravity is a client candidate only, never a worker; the bounded workspace file listing in the prompt is in.

**Settled decisions** (delegated to Claude by the owner; each keeps what is built and tested):
- Error codes: `invalid_api_key` → `VSUP_AUTH_REQUIRED`; `invalid_model` → `VSUP_BACKEND_ERROR` classified as configuration; `context_too_long`, `response_too_long` and a `length` stop → `VSUP_OUTPUT_LIMIT`; `rate_limit` → `VSUP_RATE_LIMITED`.
- Pin reach: the installed Vibe package's `RECORD` files only, against the manifest generated on the target; dependencies, `.pth`, the interpreter and `__pycache__` are documented as not covered. A shipped manifest derived from the published wheel is planned for 2.1.
- Off-profile calls: a call Vibe or the handler denies is recorded and the run continues; a call that runs without the handler's approval ends the run.
- Refusal: `completed`, with a refusal warning.
- Design choices: the Node reaper, the Keychain lookup in Node and the per-candidate manifest stay.
- Readiness checks that `vibe-app-server` exists, not the full pin; the full pin runs at each run start and in `doctor`.
- Budgets: `limits.max_tokens` and `limits.max_cost_usd` stay optional and unset by default.

## Remaining

| # | Step | Who | Needs |
|---|---|---|---|
| 1 | Cold review of this branch, merge to main, `make push` | Agent reviews and merges; owner authorizes the push | Nothing else |
| 2 | `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`; release notes from the changelog | Agent; owner gives the cache path | Step 1 |
| 3 | Target sitting per the [target acceptance procedure](docs/target-acceptance.md), stopping at the first failure: build and install next to the current prefix; `pin-manifest` and `doctor`; the conformance check (`--observe-network`); native readiness; one hosted review (with the nested-write probe and the reasoning watcher) and one hosted edit, verified independently; one MCP-client disconnect (a third hosted run) | Target agent runs; owner gives five separate authorizations and the allowance of three hosted runs | Step 2 |
| 4 | Clean-account installation on the frozen archive (gate `clean-account-install`) | Owner | Step 2 |
| 5 | Record the evidence: gates to `VERIFIED` in `docs/acceptance.json` with their rows in `docs/compatibility.md`, `npm run acceptance`, placeholders from [AGENTS.md](AGENTS.md#recording-target-evidence); frozen archive SHA-256 | Agent | Steps 3, 4 |
| 6 | Tag and publish with checksums and the acceptance record | Owner | Step 5; nothing already published is retagged or replaced |
| 7 | Delete the stale remote branches (every remote branch except main, the current one and `codex/unified-harness-v2`, after a last look); keep `codex/unified-harness-v2` until its remaining ideas are ported | Owner | Any time |
| 8 | Decide the repository rename (`codex-vibe` → `vibe-supervisor`) and read the Mistral and OpenAI brand pages | Owner | Before the article goes out |
| 9 | Read the 2.0 article draft (`marketing/article/devto-2.0.md`) with its [editor notes](marketing/article/editor-notes.md) and [story sources](marketing/sources.md); publish after the release with the AI-Assisted label and the `[UPDATE AT PUBLISH]` markers filled, in the marketing strategy's [order](marketing/strategy.md#6-next-actions-in-order) | Owner reads and publishes; agent fills the markers from the evidence | Step 6 |
| 10 | 2.1: Antigravity as a verified MCP client (docs and four target gates) | Agent docs; owner decides the scope reading, provides the account and runs the sitting | Release tagged |

**The skipped `workflow` scope.** Until it is added, no workflow file can be pushed, so the CI branches (`claude/ci-checks`, `claude/release-workflow`) stay local and the repository has no CI. To unblock: at https://github.com/settings/tokens give the push token the `workflow` scope (fine-grained: "Workflows: Read and write" on `crew-lab/codex-vibe`), update the Keychain entry `crew-lab-codex-vibe-github-token` if the value changed, then push `claude/ci-checks` rebased onto the current line and watch its first run.

## Open questions

**Only the target can answer** (each fails closed; the consequences are in the [strategy](docs/development-strategy.md#verification-model), and the [procedure](docs/target-acceptance.md) records which way each goes): whether a callback's `relatedEntryId` is filled at the entry or only in `detail`; whether handler-approved effects carry `approvalType` `ask` and `approvalSource` `user`; whether `agentConfig.maxTurns` is enforced; how long Vibe keeps a callback open; whether a large legitimate `write_file` fits the 8 MiB line cap; whether thinking off stops reasoning generation; whether `experiments.enable = false` stops the experiments request; what the real server leaves in `tmp` after stdin EOF; which history entry kinds and notification methods a real run produces.

**For the owner:** whether a second verified MCP client (Antigravity) is documentation plus evidence or the platform scope AGENTS.md forbids (the strategy recommends the former; 2.1 does not start without it); the repository rename; whether `.codex-plugin/plugin.json` and `.mcp.json` are deleted now and rebuilt in the current plugin layout in 2.2 (the recommended default) or kept; whether to post the Mistral Discussion with the protocol questions (catalogue narrowing, a search builtin, omitting reasoning, honouring budgets, a protocol version, the stable callback name), whose answers would remove work.

**Known limits of this state:** `.codex-plugin/plugin.json` is an unverified scaffold outside the npm package; Linux and Windows code paths exist without a support claim; `docs/development-strategy.md` ships inside `docs/` while pointing at unshipped files (`Handoff.md`, `marketing/`, `research/`), which should be settled by excluding it from `files` or moving it.

## Evidence rules

Vibe is never installed, run or tested on the preparing machine; questions about Vibe are answered from its tagged source, checked against the hashes in [compatibility](docs/compatibility.md#source-basis). Behavior is proven only on the target machine, with the owner's separate authorization and budget for each step, and the target records evidence and changes no code. Evidence uses the placeholders in [AGENTS.md](AGENTS.md#recording-target-evidence) from the start, because the repository is public. Missing evidence stays "unverified".

## Pointers

Shipped: [functionality](docs/functionality.md), [reference](docs/reference.md), [security](docs/security.md), [compatibility](docs/compatibility.md) (source basis, gates and diagnostic reasons), [target acceptance](docs/target-acceptance.md), [errors](docs/errors.md) (generated), `docs/acceptance.json` (machine-readable gates), [ADR 0004](docs/adr/0004-app-server-client.md), the coordinator skill `skills/vibe-supervisor`.

Source repository only, not shipped: the [implementation plan](planning/v2-implementation-plan.md), [marketing/strategy.md](marketing/strategy.md), [marketing/interest.md](marketing/interest.md), [marketing/sources.md](marketing/sources.md), [marketing/article/](marketing/article/editor-notes.md), [research/features-2026-10-14.md](research/features-2026-10-14.md), [research/antigravity-2026-10-14.md](research/antigravity-2026-10-14.md).

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

Exactly five one-shot MCP tools; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, or new platform scope. Reviews are read-only; edits use isolated detached worktrees. The enforcement points and the pin are listed in the [strategy](docs/development-strategy.md#architecture-and-enforcement-points) and fixed by [AGENTS.md](AGENTS.md). Missing evidence remains unknown: there is no acceptance evidence yet, and no other platform or universal answer-quality guarantee is made.
