# Current state — 2026-11-15

**The goal:** Codex hands a task to a worker (Vibe 3.1.2 or later; agy 1.5.8 or later, experimental), the worker reviews or implements it, and it works well every time: stable, fault tolerant, resilient, flexible and efficient. This page holds only what works, what does not, and what is next; the reasons and the order of work are in the [development strategy](planning/development-strategy.md).

## Where things are

- **Released.** v2.2.0 (2026-10-27) is the latest release.
- **On `main`, unreleased 2.2.1** ([changelog](CHANGELOG.md)): Vibe at or above 3.1.2 and agy at or above 1.5.8; the supervisor's worker rules as Vibe's system prompt and at the head of agy's prompt; no file listing in a review that names `context_files`; thinking `high` for Vibe reviews (`vibe_review_thinking`); default `max_turns` raised to `25` for reviews and edits (`4a0d0ed`); `allowed_write_paths` enforced in agy's `PreToolUse` hook (`75995d8`) with summarized write-tool ledger reconciliation (`0ed905e`); credential, pin and preparation checked before the grant is spent; review results that show which named files were read; `prepare check` that prints its report path, failing findings and what made a receipt stale; `runs export --include answer` and, in the source repository, `quality-pack.mjs record` and `prompt`; a finished or audited edit kept at the deadline; the correction rule after a failed check.
- **Worker machine & verification:** `412d106` built the `2.2.1` RC archive cleanly (`127` test files, `1,830` passed, `1` skipped, checksums matched), passed `prepare check` from the installed archive for both Vibe `3.1.2` and `agy` `1.5.9` (`antigravity_skip_permissions = true`), passed the installed-RC Vibe calendar-date replay (`7ce9f997…`, `18.6s`, `end_turn`, default `25` turns confirmed), and passed both `agy` `1.5.9` quality-pack edits (`edit-shipping` `14/14`, `edit-reserve-all` `17/17`, both `end_turn`). Earlier `f783860` runs covered Vibe thinking-off sweeps and `agy` `review-total` (`9/9`).

## What works

- **Vibe 3.1.2 passes the whole quality pack, 12 of 12:** `review-total` 5 of 5, `review-stock` 5 of 5, `edit-shipping` and `edit-reserve-all`. Every review read exactly its three named files, ran with thinking `high` and ended with `end_turn` ([evidence](research/evidence/vibe-312-quality-e429-20261114/README.md)). The 30 earlier review answers, re-scored with the same checker, still fail 30 of 30, so the briefs made the difference, not the checker.
- **The correction after a failed check.** The calendar-date patch that failed TypeScript was fixed by one correction carrying the exact diagnostic (one run; see below for why it was still closed rejected).
- **Vibe calendar-date replay and 25-turn defaults.** On `412d106`, the installed `2.2.1` RC passed the calendar-date replay (`7ce9f997…`) with omitted `max_turns` (confirming the `25`-turn default), finishing normally (`end_turn`) in `18.6s` after `5` model calls and passing independent checks. Earlier on `f783860`, replay `b87be6bb…` with the old `20`-turn default was accepted at the 120s timeout after 8 model calls, and local trial `1aeb5d44…` first verified `25` turns (`end_turn`, 5 model calls).
- **agy 1.5.9 passes hosted reviews and quality-pack edits** (`antigravity_skip_permissions = true`): `review-stock` (`a825aa60…`, `4/4` checks), `review-total` (`9/9` checks), `edit-shipping` (`412d106`: `end_turn`, `33.5s`, `6` executed calls, `14/14` hidden tests), and `edit-reserve-all` (`412d106` under default `25` turns: `end_turn`, `79.0s`, `10` executed calls, `17/17` hidden tests). `settings.json` stays at workspace scope while `PreToolUse` enforces `allowed_write_paths` (verified in unit/fake-worker denial tests), and `readAntigravityHookLedger` reconciles `step_update`-summarized write calls (`edit_file`, `write_file`) by `(tool, path, turnId)`. The supervisor sets `modelProvider: "gemini"` and leaves model selection to agy.
- **Evidence comes back.** Twelve record files, the 30 old answers and agy's strict-mode diagnostics were committed from the worker machine.
- **Boundary.** Reviews stay read-only, edits stay in their worktrees, nothing reaches shell or network, and runs clean up after themselves.
- **At the deadline.** A turn that finishes as the timeout cancels it keeps its result, and an edit cut off after audited writes is judged by its contract and checks.
- **At the turn limit** (owner decision, 2026-11-15; unit and integration tests only, not yet seen on a worker). A Vibe edit that stops at its turn limit is judged by its contract and checks: the stop is reported only after a clean final history audit. Token and price limit stops stay `incomplete`, as do agy turn-limit edits, where a write in flight at the stop cannot be confirmed.

## What does not work well yet

- **A correct patch was closed rejected at the turn limit.** The calendar-date correction passed build, lint, typecheck and both checks. Its request capped the turns at 12, the figure the skill gives for reviews; after finishing, Vibe twice tried a shell tool it does not have and ran out of turns. Since then a Vibe edit that stops at its turn limit is judged by its contract and checks (see What works); that run keeps its verdict, so the replay below still stands.
- **The worker does not always stop when told.** Under the supervisor's rules it still tried to run something after the work was done.
- **The first brief of the calendar-date replay left out the type-check line** the skill asks for, and its patch failed TypeScript under `noUncheckedIndexedAccess`.
- **Reviews with thinking off drop pass rate (`8/10`).** With `vibe_review_thinking = "off"`, `review-total` dropped from ~29k–33k to 13.1k–13.4k tokens (2 model calls) and `review-stock` from ~17.3k to 11.6k–12.3k, but each passed only 4 of 5 runs (one answer lost `src/inventory.mjs` to path redaction; one missed the strict `>` check). Thinking `high` stays the review default.
- **agy strict mode refuses the allowed read.** The hook approves it, then headless agy denies it because no allow rule matches; which rule form agy accepts is not known. agy runs only with `antigravity_skip_permissions = true`, where the supervisor's hook is the only tool gate.
- **agy preparation is easier to pass than an agy run.** Preparation probes count a read call by name; they do not yet verify ID/arguments or summarized write-tool ledger reconciliation rules across future `agy` upgrades.
- **agy coverage gaps.** `edit-reserve-all` now completes on `end_turn` under the `25`-turn default (`412d106`), so only explicit lower turn caps (`turn_limit`, as in the earlier `max_turns: 20` run `6d9c9601…`) leave `verification: "incomplete"` on agy; live out-of-scope write refusals are verified in deterministic hook/fake-worker tests rather than a live model slip.
- **Two gaps in agy's diagnostics:** the remedy text in stderr is cut at 240 characters, and the tool names from `init` come back empty.
- **Small slips reject good edits.** Patches were rejected for a new code comment and for a wrong prefix in a regression test, while the source itself was right.
- **Turns that stall.** Two task-first runs stalled until the deadline after their patches were ready; they now complete with stop reason `timeout`, but why Vibe kept the turn open is unexplained. Run with `app_server_wire_trace` when it recurs.

## Runs on `e429a9b` (2026-11-14)

- **Quality pack & thinking verification.** Candidate `c3f0ea7b…` passed all 12 trials (`records/` in [evidence](research/evidence/vibe-312-quality-e429-20261114/README.md)). Re-scoring the 30 pre-`e429a9b` review summaries confirmed 0/30 passed (`old/`). Exporting earlier thinking-high run `4acc9415-0ccf-46a2-991f-7ee3ed0961dc` confirmed `requested_thinking: "high"`, `thinking: "high"`, and `reasoning_observation` (`streamed_entries: 2`, `history_entries: 2`, `history_audited: true`).
- **Calendar-date replay & correction.** Replay `6af4334a…` failed `tsc` (`TS18048`/`TS2769`) because the brief did not warn about `noUncheckedIndexedAccess`. Single correction `7f1b4533…` passed `build`, `lint`, `typecheck`, `cli-dates`, and `hygiene` (`dates=0 hygiene=0`), but its request capped `max_turns` at `12` instead of the default `20`; after twice attempting denied `file_system.bash`, it hit `turn_limit` and was closed `rejected`.
- **Verification `timeout` fix on `main`.** `src/acceptance/verify.ts` now judges patches completed with `stop_reason: "timeout"` (edits cut off after audited writes with a clean history audit), matching [behavior docs](docs/functionality.md#settlement-and-close), while keeping `turn_limit` `incomplete`.
- **Antigravity 1.5.8 -> 1.5.9.** Strict-mode preparation (`745c651a…`) failed `probe_control_not_executed` (`read_file` auto-denied under `toolPermission: "strict"`, diagnostics committed in [evidence](research/evidence/vibe-312-quality-e429-20261114/agy-strict-diagnostics.json)). Earlier skip-permissions attempts failed with HTTP 400 `API_KEY_INVALID` (`9067c914…`) and then, with a valid `GEMINI_API_KEY` on `agy` 1.5.9, hit `VSUP_INTERNAL` hook-ledger reconciliation failure (`a128ce7c…` / `b69db930…`) because `agy` reported arguments in `step_update.tool_info.parameters`. Fixing `parseCallObj` resolved reconciliation and passed live `review-stock` (`0f0cb3af…`, candidate `9468b08a…`).

## Latest runs (2026-11-15)

- **2.2.1 RC verification & hosted trials (`412d106`).** The `2.2.1` RC build passed `lint`, `typecheck`, `build`, `127` test files (`1,830` passed, `1` skipped), `release-checks`, `secret-scan`, and `sbom`, with matching archive checksums and `prepare check` passing from the installed archive for both Vibe `3.1.2` and `agy` `1.5.9` (`antigravity_skip_permissions = true`). Installed-RC Vibe calendar-date replay (`7ce9f997-3462-4ac3-8ece-c20ffbd06662`) omitted `max_turns`, confirmed the `25`-turn default, finished normally (`end_turn`) in `18.6s` after `5` model calls, and passed independent checks (`Accepted`). Source-build `agy` `1.5.9` edits with `PreToolUse` `allowed_write_paths` enforcement both passed normally: `edit-shipping` (`end_turn`, `33.5s`, `6` executed calls, `25,492` prompt / `2,519` completion tokens, `14/14` hidden tests) and `edit-reserve-all` (`end_turn`, `79.0s`, `25`-turn default, `10` executed calls, `41,694` prompt / `6,319` completion tokens, `17/17` hidden tests).
- **Clean release verification & replay (`f783860`, `5a06b26`).** `f783860` passed Vibe `3.1.2` preparation (`1,826` passed, `1` skipped) and `20`-turn calendar-date replay `b87be6bb-42e6-4ec3-becd-00b60d15f6af` (`timeout` at 120s after 8 model calls, accepted). `5a06b26` also passed clean-clone `verify:release` (`1,830` passed, `1` skipped), matching separate local `25`-turn trial `1aeb5d44-fb31-4f67-be80-6b1aa917365b` (`end_turn`, 5 model calls).
- **Vibe thinking-off sweep (`f783860`).** Passed `8/10` (`4/5` `review-stock`, `4/5` `review-total`), 2 model calls each (`11.6k–12.3k` and `13.1k–13.4k` tokens). Two failures missed a source citation (`review-stock-3` path redaction) or strict `>` comparison (`review-total-3`). Thinking `high` stays the default.
- **Earlier Antigravity 1.5.9 progression.** `review-stock` repeat on `a2f3cba` (`a825aa60-38c0-4504-ba96-e15d34daaf14`, `4/4` checks, 41.3s) and `review-total` on `f783860` (`9/9` checks, `end_turn`) passed. Initial `edit-shipping` on `75995d8` (`32b28d5e-0ad3-4687-a2ed-58c8c17cba75`) hit `VSUP_INTERNAL` until `0ed905e` reconciled `isPathOnlyWriteCall` against `PreToolUse`, passing `edit-shipping` (`9edc6ee2-8460-4ea3-a4dd-86316128467d`, `14/14`) and `edit-reserve-all` (`6d9c9601-e63c-46b1-8fe9-c8751b413d5b` with `max_turns: 20`: `turn_limit` -> `incomplete`, `17/17` on patch) before `412d106` cleared `end_turn` under `25` turns.

## Next

### On the worker machine

1. **Tag/ship `2.2.1` when ready.** `412d106` RC build, checksum verification, installed-archive `prepare check` (Vibe `3.1.2` and `agy` `1.5.9`), installed-RC 25-turn calendar replay, and `agy` `1.5.9` edit trials all passed cleanly. If re-packaging after docs-only handoff commit, re-run `package:rc` from the tagged commit.
2. **After any Vibe or agy update:** `prepare check`, then the quality pack, recorded. That run is the regression test for the worker.

### Development, in this order, each its own commit

1. **Turn limits by mode** in the skill and the Codex agent: the 12-turn figure is for a review of two or three files; an edit or a correction takes the configured default (`25`).
2. **Stop after a refusal.** Worker rules: a refused tool will be refused again; do not retry it or look for another way to run something; give the final answer. If the approval reply can carry a reason to the worker, say it there too. Check with `quality-pack.mjs prompt` and stand-in workers, then on Vibe.
3. **agy preparation runs the run's own audit:** the stream-shape probe requires a call ID or arguments for every executed call and verifies write-tool ledger reconciliation rules so stream changes fail at `prepare check`, before any inference.
4. **agy diagnostics:** keep the whole remedy line from stderr and read the tool list from agy's real `init` shape.
5. **agy strict mode:** try allow-rule target forms through the control probe on the worker machine until agy runs the allowed read without the bypass. The aim is two gates instead of one.
6. **Candidates:** judging an agy edit that stopped at its turn limit (for explicit lower caps); fewer model calls for a review of small named files; `context_reads` and explicit model selection verification for agy; agy `--json-schema` for findings.
7. **Owner:** ask GitHub Support to purge the pre-rewrite commits ([rewrite notes](research/history-rewrite-2026-11-04.md)).
8. **Release 2.2.1.** Ready to tag/publish (`412d106` met all release criteria across Vibe `3.1.2` and experimental `agy` `1.5.9`).

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
