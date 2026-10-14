# Current handoff

Updated 2026-10-14. This document alone defines current priorities. [docs/history/](docs/history/) keeps what the current work uses: the [2.0 path](docs/history/v2-path-2026-10-14.md), the [design note](docs/history/app-server-client-design.md), the [protocol audit](docs/history/app-server-protocol-audit-2026-10-14.md) and the [source answers](docs/history/app-server-source-answers-2026-10-14.md), with [ADR 0004](docs/adr/0004-app-server-client.md); the [usefulness log](docs/history/usefulness-log.md); the [outreach drafts](docs/history/outreach-drafts.md) and the [article draft](docs/history/article/draft-1.0.md). Target-machine evidence lives in [docs/reviews/](docs/reviews/), with placeholders from [REDACTION.md](docs/reviews/REDACTION.md). Everything older than 2026-10-12 is in Git history at `c510513`.

## Release identity and acceptance

**Owner decisions 2026-10-14:** 1.0.1 is skipped; 2.0.0 is the next release and the stable major version; 2.0.1 drops every other version and removes the development history ([2.0 path](docs/history/v2-path-2026-10-14.md#201-one-version-no-history-owner-goal-2026-10-14)). 1.0.0 stays the last 1.x release, with no maintenance line. The 1.0.1 candidates (rc.1, rc.2) were never released; their records stay in `docs/acceptance.json` and `docs/reviews/` until 2.0.1 removes them.

**1.0.0 is published:** [GitHub release](https://github.com/crew-lab/codex-vibe/releases/tag/v1.0.0), archive SHA256 `4e91e90bb7cb48c4411e1dc02820e91abddd690fc430f15a65ad6a9f3bd1c610`, source `f0f317e10d5d021f171ed38f5a85bb8e2354f12d`.

## 2.0 status

2.0 lives on branch `claude/app-server-design`: one engine, a client of Vibe's `vibe-app-server` protocol. The legacy `vibe -p --legacy-harness` path, the Python launcher, the `backend` config key and the programmatic backend are removed. Steps 1 to 9 of the [design note](docs/history/app-server-client-design.md#10-work-breakdown) are done. A comparison with the parallel `codex/unified-harness-v2` branch chose this branch as the base and ported three of its pieces, now done: handoff re-validation with usage continuity, more read-back checks, and effect-to-callback fingerprints. The bounded workspace file listing in the prompt, approved by the owner, is done too. The target kit (step 10) is [docs/history/v2-target-brief.md](docs/history/v2-target-brief.md) with `scripts/v2-conformance-check.mjs`. Everything was exercised against the scripted fake only; nothing was run against a real Vibe.

**What remains for 2.0.0:**
1. A cold review of the branch.
2. Step 10 is done; the target kit waits for the target machine.
3. Merge the branch to main, which becomes the 2.0 line, and set the version to 2.0.0.
4. Target gates, all unverified and listed in [compatibility](docs/compatibility.md#unverified-gates) and `docs/acceptance.json`, each with the owner's separate authorization: the pin manifest and the conformance check, native readiness, one hosted review and one edit, an observed MCP-client disconnect, `permission = "ask"` in the effective configuration, the effect of thinking off, the experiments fetch off, nested `run_typescript` calls, Node 20.19.0, and a clean-account installation.
5. Owner decisions, delegated to Claude and settled on 2026-10-14 (each keeps what is built and tested):
   - **Error codes:** `invalid_api_key` → `VSUP_AUTH_REQUIRED`; `invalid_model` → `VSUP_BACKEND_ERROR` classified as configuration; `context_too_long`, `response_too_long` and a `length` stop → `VSUP_OUTPUT_LIMIT`; `rate_limit` → `VSUP_RATE_LIMITED`.
   - **Pin reach for 2.0.0:** the installed Vibe package's `RECORD` files only, against the manifest generated on the target; dependencies, `.pth`, the interpreter and `__pycache__` are documented as not covered. 2.0.1 adds a shipped manifest derived from the published wheel.
   - **Off-profile calls:** a call Vibe or the handler denies is recorded and the run continues; a call that runs without the handler's approval ends the run.
   - **Refusal:** completed, with a refusal warning.
   - **Design choices:** the Node reaper, the Keychain lookup in Node, and the per-candidate manifest stay.
   - **Readiness:** checks that `vibe-app-server` exists, not the full pin; the full pin runs at each run start and in `doctor`, so readiness stays fast.
   - **Budgets:** `limits.max_tokens` and `limits.max_cost_usd` stay optional and unset by default.
6. Mistral questions from the audit (narrowing the catalogue, a search builtin, omitting reasoning, honouring budgets) would remove work if answered.

## What this is

A local MCP stdio server that lets Codex delegate one bounded code review or one isolated edit at a time to Mistral Vibe 2.26.1, through its `vibe-app-server`. Codex sees five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result` and `vibe_close`. A review may only read files in an allowlisted workspace, with no search tool; an edit runs in a supervisor-created detached Git worktree and comes back as a patch, never applied, committed or pushed. Shell and network tools are off. This is an application policy boundary, not an OS sandbox. Supported: macOS Apple silicon, Node 20.19 or later, Vibe 2.26.1 exactly.

| Area | Code |
| --- | --- |
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, policy reread and readiness receipts, saved-run routing after `--isolated` reconnect | `src/core/`, `src/config/policy.ts` |
| App-server client: backend, JSON-RPC transport, protocol subset, session configuration and read-back, approval handler, event validator, usage and outcome mapping, pin check, credentials; the reaper | `src/backends/app-server.ts`, `src/backends/app-server/`, `src/process/reaper.ts` |
| Worktrees, private-index export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `pin-manifest`, `serve`, `runs` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release and coordinator scripts (not shipped) | `scripts/` |
| Coordinator skill (shipped) | `skills/vibe-supervisor` |

Behaviour: [docs/functionality.md](docs/functionality.md); interface: [docs/reference.md](docs/reference.md); boundary: [docs/security.md](docs/security.md); Vibe assumptions and gates: [docs/compatibility.md](docs/compatibility.md); errors: [docs/errors.md](docs/errors.md) (generated); machine-readable gates: `docs/acceptance.json`. AGENTS.md lists the boundaries that must not change.

## Current priorities

1. **2.0.0 on the branch:** the ports, the file listing, the cold review and the target kit ([2.0 status](#20-status)).
2. **Merge to main** and set the version to 2.0.0.
3. **2.0.0 on the target**, with the brief from step 10 and the owner's authorizations; then a frozen archive, the clean-account installation and the owner's publish authorization. Do not replace or retag existing releases.
4. **2.0.1** on a branch prepared in advance: drop every other version and remove the development history, plus the items in the [2.0 path](docs/history/v2-path-2026-10-14.md).
5. **Owner actions that unblock tooling:** delete the merged or superseded remote branches with the prepared command.
   - **Skipped by the owner on 2026-10-14: the `workflow` token scope.** Until it is added, no workflow file can be pushed, so `claude/ci-checks` and `claude/release-workflow` stay local and the 2.0 line has no CI; every check runs locally with `npm run verify:release`. To unblock: at https://github.com/settings/tokens give the push token the `workflow` scope (fine-grained: "Workflows: Read and write" on `crew-lab/codex-vibe`), update the Keychain entry `crew-lab-codex-vibe-github-token` if the value changed, then push `claude/ci-checks` (rebased onto the 2.0 line) and watch its first run.
6. **Article:** the owner reads [the draft](docs/history/article/draft-1.0.md); publish after 2.0.0 with the AI-assisted label, or drop it with 2.0.1.

**Decisions that shaped 2.0 (2026-10-14):** an exact Vibe pin, with a new candidate, manifest and short target check for every Vibe release; the five MCP tools and every boundary stay (ADR 0004); the client owns the approval decision, denying by default, and rebuilds usage and cost from events because `vibe-app-server` writes no run export; review is `read_file` only, the catalogue's write tools stay listed and are refused, and reasoning stays off disk by construction.

**Later.** The MCP tasks extension (`tasks/get` polling) once clients use it by default. Byte-reproducible release archives. `claude/release-workflow`, a tag-triggered release. `claude/ci-checks` (`8904c13`): a Linux job for lint, types, the error reference, whitespace and the secret scan; workflow lint; `verify:release` on macOS with Node 20.19.0 and 24; dependency review; read-only permissions, pinned actions and Dependabot.

## Working rules

- Never install, run or test Vibe on the preparing machine, including the installed-Vibe fixture. Questions about Vibe's code are answered from its tagged source, after checking it against the launcher's pinned hashes. Hosted and installed-Vibe evidence comes from the target machine only, with the owner's authorization and budget.
- Evidence uses the placeholders in [REDACTION.md](docs/reviews/REDACTION.md) from the start; the repository is public.
- Version numbers and runtime code change on main (2.0 on its branch until it merges); the target machine records evidence and changes no code.
- Push with `make push` (main) or `make push-branch BRANCH=<name>`. Before a release candidate, `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`.
- Keep credentials and private session histories out of every committed file.

## Fixed scope and safeguards

Exactly five one-shot MCP tools; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Retain canonical allowlists, private child homes, filtered environments, redaction, bounded deadlines and output, owner locks, the app-server enforcement points and verified cleanup. Missing evidence remains unknown; 2.0 has no acceptance evidence yet. No other platform or universal answer-quality guarantee is made.
