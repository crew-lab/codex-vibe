# Current state — 2026-11-19

**The goal:** Codex hands a task to a worker (Vibe 3.1.2 or later; agy 1.5.8 or later, experimental), the worker reviews or implements it, and it works well every time: stable, fault tolerant, resilient, flexible and efficient. This page holds only what works, what does not, and what is next; the reasons and the order of work are in the [development strategy](planning/development-strategy.md).

## Where things are

- **Released.** v2.2.1 (2026-11-15) is the latest release ([changelog](CHANGELOG.md)); `agy` remains opt-in and experimental.
- **Included in v2.2.1:** Vibe at or above 3.1.2 and agy at or above 1.5.8; the supervisor's worker rules as Vibe's system prompt and at the head of agy's prompt; no file listing in a review that names `context_files`; thinking `high` for Vibe reviews (`vibe_review_thinking`); default `max_turns` raised to `25` for reviews and edits (`4a0d0ed`); `allowed_write_paths` enforced in agy's `PreToolUse` hook (`75995d8`) with summarized write-tool ledger reconciliation (`0ed905e`); credential, pin and preparation checked before the grant is spent; review results that show which named files were read; `prepare check` that prints its report path, failing findings and what made a receipt stale; `runs export --include answer` and, in the source repository, `quality-pack.mjs record` and `prompt`; a finished or audited edit kept at the deadline; the correction rule after a failed check.
- **Unreleased 2.2.2:** worker updates repair themselves at readiness (Vibe re-pin gated on `RECORD` hashes, re-preparation for both workers, `VSUP_PREPARING`), the running build in `boot_drift`, `effective_limits` and `worker` in readiness, a receipt bound to boot-bound settings only, the Vibe model named by the supervisor (`vibe_model`), a provider refusal reported as itself, Vibe's provider waits and project context set by the supervisor, failures that name their cause and remedy, a hard edit task in the quality pack and a correction that continues from the rejected patch ([changelog](CHANGELOG.md)).
- **Worker machine & verification:** `412d106` built the `2.2.1` RC archive cleanly (`127` test files, `1,830` passed, `1` skipped, checksums matched), passed `prepare check` from the installed archive for both Vibe `3.1.2` and `agy` `1.5.9` (`antigravity_skip_permissions = true`), passed the installed-RC Vibe calendar-date replay (`7ce9f997…`, `18.6s`, `end_turn`, default `25` turns confirmed), and passed both `agy` `1.5.9` quality-pack edits (`edit-shipping` `14/14`, `edit-reserve-all` `17/17`, both `end_turn`). Earlier `f783860` runs covered Vibe thinking-off sweeps and `agy` `review-total` (`9/9`).

## What works

- **Vibe 3.1.2 passes the whole quality pack, 12 of 12:** `review-total` 5 of 5, `review-stock` 5 of 5, `edit-shipping` and `edit-reserve-all`. Every review read exactly its three named files, ran with thinking `high` and ended with `end_turn` ([evidence](research/evidence/vibe-312-quality-e429-20261114/README.md)). The 30 earlier review answers, re-scored with the same checker, still fail 30 of 30, so the briefs made the difference, not the checker.
- **The correction after a failed check.** The calendar-date patch that failed TypeScript was fixed by one correction carrying the exact diagnostic (one run; see below for why it was still closed rejected).
- **Vibe calendar-date replay and 25-turn defaults.** On `412d106`, the installed `2.2.1` RC passed the calendar-date replay (`7ce9f997…`) with omitted `max_turns` (confirming the `25`-turn default), finishing normally (`end_turn`) in `18.6s` after `5` model calls and passing independent checks. Earlier on `f783860`, replay `b87be6bb…` with the old `20`-turn default was accepted at the 120s timeout after 8 model calls, and local trial `1aeb5d44…` first verified `25` turns (`end_turn`, 5 model calls).
- **agy 1.5.9 passes hosted reviews and quality-pack edits** (`antigravity_skip_permissions = true`): `review-stock` (`a825aa60…`, `4/4` checks), `review-total` (`9/9` checks), `edit-shipping` (`412d106`: `end_turn`, `33.5s`, `6` executed calls, `14/14` hidden tests), and `edit-reserve-all` (`412d106` under default `25` turns: `end_turn`, `79.0s`, `10` executed calls, `17/17` hidden tests). `settings.json` stays at workspace scope while `PreToolUse` enforces `allowed_write_paths` (verified in unit/fake-worker denial tests), and `readAntigravityHookLedger` reconciles `step_update`-summarized write calls (`edit_file`, `write_file`) by `(tool, path, turnId)`. The supervisor sets `modelProvider: "gemini"` and leaves model selection to agy.
- **Evidence comes back.** Twelve record files, the 30 old answers and agy's strict-mode diagnostics were committed from the worker machine.
- **Boundary.** Reviews stay read-only, edits stay in their worktrees, nothing reaches shell or network, and runs clean up after themselves.
- **At the deadline.** A turn that finishes as the timeout cancels it keeps its result, and an edit cut off after audited writes is judged by its contract and checks.
- **Vibe 3.1.3 on 2.2.2.** All four quality-pack tasks passed on `mistral-medium-3.5`. Two 3.1.3 stock reviews and one 3.1.2 stock review each scored 4/4. The total review scored 9/9 and the shipping and reserve-all edits passed 14/14 and 17/17 hidden tests. Every review read exactly its three named files. Each run ended with `end_turn`. The preview and final archive shared byte-identical files and the final archive added the SBOM. The final candidate was separately prepared and used for both copy-rules runs. Release verification passed 1,930 tests with one skip across 131 files. [Trial details and quality records](research/evidence/vibe-313-model-pin-20261118/README.md)
- **Worker recovery on a real Vibe install.** The first automatic re-pin from 3.1.2 to 3.1.3 still required the new build's matching preparation kit. The subsequent downgrade and upgrade each re-pinned and re-prepared automatically in about 18 seconds. Same-version file drift blocked startup with `file-mismatch` and left the grant unspent. Restoring the original file let that grant start successfully. [Recovery evidence](research/evidence/vibe-313-model-pin-20261118/README.md#preparation-and-recovery)
- **At the turn limit.** The November 19 copy-rules correction reached the 25-turn limit, passed the supervisor contract after the final audit and was rejected on independent tests. A Vibe edit that stops at its turn limit is judged by its contract and checks: the stop is reported only after a clean final history audit. Token and price limit stops stay `incomplete`, as do agy turn-limit edits, where a write in flight at the stop cannot be confirmed.

## What does not work well yet

- **Provider refusal and model pin.** The first 3.1.3 run on the earlier build reported the subscription refusal as an API-key error. Its selected model remains inferred. On the new build, preparation and hosted read-back confirmed `mistral-medium-3.5`. Explicitly selecting `mistral-large-4-0` reproduced the HTTP 403 subscription refusal as `provider_refused`, with the model and provider message and zero file reads. The default was restored. [Original trial](research/evidence/vibe-313-worker-update-20261118/README.md) · [Reproduction](research/evidence/vibe-313-model-pin-20261118/README.md#preparation-and-recovery)
- **Copy-rules replay and correction both rejected.** The frozen replay ended in 404.4 seconds, with more than five minutes between the last tool event and settlement. It failed the named-test contract check and nine of ten focused tests. One bounded correction from the same base ended in 84.7 seconds and passed all four built-in contract checks. Independent checks still reproduced rejection of valid `--vault-path`, and all eight focused tests failed during setup because `mkdtempSync()` had no prefix. Both runs attempted shell access and policy blocked it. The correction trace accepted the completion frame within 1 ms. [Replay and correction evidence](research/evidence/vibe-313-model-pin-20261118/README.md#copy-rules-ci-replay)
- **Whether the account may use a model is known only at the first model call.** Readiness and the preparation check make no model call, so a model outside the account's plan still passes both; the run then fails within seconds, before any file is read, now with the true reason.
- **agy still chooses its own model.** The supervisor sets the provider and nothing else.
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

## Latest worker trial (2026-11-19)

Tested the installed 2.2.2 archive from `093cee5` with Vibe 3.1.3 and `mistral-medium-3.5`. Release verification passed 1,953 tests with one skip across 132 files. The archive and kit checksums matched. Installed preparation passed in 14.8 seconds and checked project context disabled and provider waits of 300 seconds for first output, 120 seconds for stream idle and 180 seconds for retrying a failed call. A disposable no-inference probe passed with `VIBE_STRICT_CONFIG=1` in Vibe's child environment. The installed preparation command filters out that flag. [Trial details and nine run records](research/evidence/vibe-313-stock-export-20261119/README.md)

- **Existing pack passed 4/4.** Both reviews read exactly their three named files and both edits passed independent checks. The two edits took about the same time as before. In the single total-review comparison, time rose from 40.5 to 75.4 seconds, model calls from two to four, and tokens from 20,409 to 38,500. Review timing was already variable, and this sample cannot attribute the change to project context.
- **Stock-export passed 3/5 on patch checks and 2/5 end to end.** One passing patch came from a failed run. It emitted `turn_retrying`, then reported that the model stopped producing output for 120 seconds. It settled after 343.4 seconds with incomplete verification. The other two rejected patches used the wrong flag key and a malformed expected CSV literal, respectively. The brief ran as written without a stand-in study.
- **Continuation from the rejected patch was rejected.** The correction started from an unreferenced commit containing the prior patch and could change only two files. It reached the 25-turn limit in 61.4 seconds and passed the supervisor contract. Four of eight focused tests failed, including the exporter reaching an undefined `source_sha256`. The earlier correction from the original base took 84.7 seconds and 18 calls and failed all eight focused tests at setup.
- **The older five-minute tail included a retry.** The saved copy-rules events recorded `turn_retrying` about 305 seconds after the last tool event and seven seconds before verification. The underlying provider error was absent from that run's evidence.

## Next

The order of work and the failure behind each step are in the [development strategy](planning/development-strategy.md#what-we-work-on). Written and tested here with the fake worker on 2026-11-20, none of it run on a worker yet:

- an edit keeps its audited writes after a late provider failure (`stop_reason: provider_error`), for `backend_error`, `incomplete_stream` and `rate_limit` with no HTTP status or a 5xx, 408, 409, 425 or 429;
- records with the duration, cached tokens, tool kinds, error, warnings and retry notices;
- the stock-export brief with exact spellings and bytes, passed by four stand-in workers ([answers](research/evidence/stock-export-brief-standin-20261120/README.md));
- compaction checkpoints dropped, where a compaction would have failed the run, with a check that the final history still holds every earlier entry (never seen on a worker: if Vibe trims its history, a run that compacts still fails closed);
- a refresh that names the Vibe settings a new version added or removed;
- `vibe_edit_thinking`, `off` by default;
- `doctor` checking the Codex registration;
- the coordinator skill and agent file with one home for each rule.

### On the worker machine, on a build from the current `main`

Record every run with `quality-pack.mjs record` and commit the records under `research/evidence/`. A new build needs its `prepare check --kit` once.

1. **The wire code of the stall.** Export the failed stock-export sample of 2026-11-19 (the record `next-6`) and report `error.details.error_code`. The new rule keeps an edit only for `backend_error`, `incomplete_stream` and `rate_limit`; if the stall arrived with another code, say so before anything else.
2. **Preparation and the pack.** `prepare check`, then the four existing tasks once each. No task may get worse; the records now show seconds, cached tokens and tool kinds.
3. **The hard edit with the new brief, five times.** Record the hidden-test result of each. The earlier brief passed 3 of 5 on its patch and 2 of 5 end to end. Change nothing else in this set.
4. **A stall after the writes.** When one happens in step 3, the run must end `completed` with `stop_reason: provider_error`, a warning naming the provider code, and a verification that ran. It cannot be forced; report it when it is seen. Also report how long each stall lasted, and whether a thinking-`high` review is ever cut at the 120-second idle wait.
5. **Thinking for edits, its own five runs.** Set `vibe_edit_thinking = "high"`, restart, let readiness re-prepare, and run the hard edit five times. Compare the pass rate, tokens and seconds with step 3. Remove the setting afterwards.
6. **One delegation through Codex itself,** a review and an edit, once on the build from `719e21c` and once on this one, with the skill and the agent file of each: note whether the skill loads, the approval prompts, and the tool timeout in force. `doctor` should report the registration items. This is the test for the skill changes and for the read-only mark on `vibe_status`.
7. **After the next Vibe update:** the refresh warning should name any setting the new version added or removed.
8. **Still open:** `install_unsettled` during an in-flight Vibe upgrade, and re-preparation on a newer agy.

Copy-rules stays open in the owning project: carry forward the undefined digest reference, the missing snapshot parent and the stdout/stderr assertion, reproduce the documented command and run the focused tests before acceptance.

### Development still to do

1. **Release 2.2.2** once steps 1 to 4 above have run.
2. **A worker rule that spellings agree** where an option, key or field is defined, parsed and used, as its own five-run set after the brief's.
3. **The correction's turn budget,** once a record shows where its 25 turns went.
4. **The skill's templates and correction procedure as reference files,** after the delegation through Codex.
5. **agy preparation runs the run's own audit:** the stream-shape probe requires a call ID or arguments for every executed call and verifies write-tool ledger reconciliation rules so stream changes fail at `prepare check`, before any inference.
6. **agy diagnostics and strict mode:** keep the whole remedy line from stderr, read the tool list from agy's real `init` shape, and find the allow-rule form agy accepts, so two gates stand instead of one.
7. **Owner:** ask GitHub Support to purge the pre-rewrite commits ([rewrite notes](research/history-rewrite-2026-11-04.md)).

### From the architecture review of 2026-11-18: candidates, order not decided

Three read-only reviews of `a035d77`: what the worker decides for the supervisor, what Codex is told when a run fails, and setup. The reviewers reported each line with file references in this repository or in the Vibe 3.1.3 source; not every line was read a second time, and the ones marked inferred were not confirmed. Crash recovery, locks and run state were not re-reviewed, and agy's own defaults were not reached.

- **A sixth bundled skill fails every preparation.** The read-back compares five names, although `disabled_skills` already keeps all of them from the model.
- **The preparation check is laxer than a run** on a missing hook or skill count.
- **agy has no auth, quota or rate classification** of its own failures (reported by the review, not re-read).
- **The Vibe key in the macOS Keychain is checked only at a start,** after the grant; agy's key is checked at readiness.
- **`prepare check` requires `--kit`** although the script ships in the package, and the readiness blocker prints a placeholder for the kit path. The first `pin-manifest` is manual as well.

## Build, install and prepare

On a Mac with Apple silicon, Node 20.19 or later and Git:

```bash
git clone https://github.com/crew-lab/codex-vibe.git vibe-supervisor && cd vibe-supervisor && npm ci && npm run verify:release
```

`verify:release` needs no Vibe and no network beyond `npm ci`. To package offline, fill a dedicated npm cache with the locked versions, then package; `package:rc` writes the archive, the SBOM and `release/preparation-kit-<version>/`, which belongs to that archive:

```bash
CACHE="$PWD/.npm-offline-cache" && node -e 'const l=require("./package-lock.json");const s=new Set();for(const[k,v]of Object.entries(l.packages)){if(!k||v.link||!v.version)continue;s.add((v.name||k.slice(k.lastIndexOf("node_modules/")+13))+"@"+v.version)}console.log([...s].join("\n"))' | xargs -P 8 -n 1 npm cache add --cache "$CACHE" && VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc
```

Install the archive and configure it as in [local operation](docs/local-operation.md). Vibe runs only on the machine that has it installed: run `vibe-supervisor pin-manifest`, then `vibe-supervisor prepare check --kit <absolute path of the kit> --config "$CONFIG"` once, because readiness and every start need its pass. After a Vibe or agy update, readiness re-pins and re-prepares by itself ([preparation](docs/preparation.md#after-a-worker-update)); rerun the quality pack.

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
