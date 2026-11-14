# Current state — 2026-11-13

**The goal:** Codex hands a task to a worker (Vibe 3.1.2 or later; agy 1.5.8 or later, experimental), the worker reviews or implements it, and it works well every time: stable and efficient. This page holds only what works, what does not, and what is next; the order of work is in the [development strategy](planning/development-strategy.md).

## Where things are

- **Released.** v2.2.0 (2026-10-27) is the latest release.
- **On `main`, unreleased 2.2.1** ([changelog](CHANGELOG.md)): any stable Vibe at or above 3.1.2 and any stable agy at or above 1.5.8; thinking for Vibe reviews (`vibe_review_thinking`, default `high`); agy probe diagnostics; the supervisor's own [worker rules](docs/functionality.md#worker-rules) per tool (Vibe's session system prompt, the head of agy's prompt); no file listing in a review that names `context_files`; the generated `task authorize` command and complete `start_request`; search-first `context_files`; the frozen contract delivered to the worker with the `node_test` check; edit briefs that name the project root, test imports, conflict behaviour and no execution; the export output fix; the Antigravity key from the launchd session; readiness `pinned_version` from the manifest; the [quality pack](docs/quality-pack.md); the opt-in `app_server_wire_trace`; a completion or audited edit at the deadline kept instead of discarded; preparation bound to the Node major version; support for the built-in `vibe:import` skill reported by Vibe 3.1.2.
- **Target machine:** the main-based 2.2.1 candidate `1002bace…` passed no-inference preparation against Vibe 3.1.2 on Node 24.22.1. Release verification passed with 1,738 tests and one skipped. The `vibe:import` skill describes migration from Claude Code, Codex and OpenCode. The supervisor accepts its built-in plugin metadata and applies the run’s existing file-tool policy.
- **The Ollama comparison is dropped** (owner, 2026-11-13). Its notes stay in [research](research/evidence/paired-comparison-protocol-20261108/README.md).

## What works

- **Live Vibe 3.1.2 edit.** The default-order build completed the invalid calendar-date fix for `runs usage` and `runs usefulness` with `end_turn`. Independent CLI checks rejected invalid months, days and non-leap February 29 and accepted a valid leap day. The patch passed lint, typecheck, build and whitespace checks. A separate integration test checked the outgoing edit task and frozen contract using a fake app-server.

- **Boundary.** Reviews stay read-only, edits stay in their worktrees, nothing reaches shell or network, and runs clean up after themselves.
- **Task-first experiment.** On Vibe 3.1.2, the historical dangling-symlink fix completed in 44.6 seconds and passed independent checks on `exp/task-first-prompt`. That result belongs to the experiment build.
- **Edits.** On Vibe 3.1.0, `edit-shipping` fixed the threshold, touched only the two allowed files and passed all 14 tests on the exported patch.

## Changed on 2026-11-13 and run on Vibe 3.1.2

- **Worker rules as Vibe's system prompt.** Sessions send the supervisor's rules as `systemPrompt` in place of Vibe's interactive product prompt (Vibe 3.1.0 and later, so the floor is 3.1.2). Vibe 3.1.2 accepted it, and every run since ended normally. Whether the old prompt caused the earlier stalls and the turn-limit failure is still not shown.
- **Two Vibe settings are switched off:** pull-request monitoring and commit-signature guidance. Vibe 3.1.2 accepted both.
- **A review with `context_files` carries no file listing.** Review prompts fell by about a quarter in tokens.
- **agy 1.5.8.** A version floor replaces the list that ended at 1.4.9; built-in skills are accepted by agy's own flag; reviews keep the pre-1.5.7 default agent mode through `"agentMode": ""`; a print timeout is a timeout. None of this is proven: preparation fails first (below).

## Fixed on 2026-11-13

- **A finished patch lost to the deadline.** A run that reached its timeout always failed with `VSUP_TIMEOUT`, even when Vibe's completion arrived during the interrupt or the edit was already written, because the cancel path tore the server down before the final history audit and the run manager's own timeout overrode the backend. Now the cancel waits for the audit; a turn that finished at the deadline keeps its result with a warning, and an edit cut off after audited writes completes with stop reason `timeout` so its contract and checks decide. A run with no audited writes, or whose audit fails, still times out. This covers the dangling-symlink replay whose correct patch was rejected at 300 seconds.
- **Stale preparation after a Node update.** The receipt was bound to the exact Node version, so 24.21.0 against 24.22.1 blocked dispatch. It now binds the Node major version.

## What does not work well yet

- **Replay with the build from `f963acd`.** The packaged build passed preparation against Vibe 3.1.2. All 15 calendar-date regression tests on that checkout and the fake app-server review-input test passed. A live replay on the original buggy revision again produced a patch that failed TypeScript compilation because parsed date components could be undefined. The run was closed and the patch was left out of main.

- **Calendar-date repeat on Vibe 3.1.2.** Replaying the same task on the original buggy revision reached the turn limit. Vibe read and edited both expected files. The exported patch failed TypeScript compilation because the parsed date components could be undefined. The run was closed and the patch was left out of main.

- **Reviews fail on Vibe.** Both review tasks failed 0 of 5 on the earlier build, with thinking off and with thinking high ([below](#review-repair-handoff)). The briefs and the checker were reworked on 2026-11-14 and have not been run on Vibe yet.
- **Small slips reject good edits.** Patches were rejected for a new code comment and for a wrong prefix in a regression test, while the source itself was right.
- **Default-order replay on Vibe 3.1.2.** The same historical dangling-symlink task reached its 300-second deadline. The completion frame arrived 16 ms after the deadline was recorded, and the supervisor exported the audited patch with stop reason `timeout`. The reproduction, link-safety controls, validation suite, lint, typecheck and build passed. The patch was rejected for trailing whitespace and the run was closed.
- **Turns that stall.** Two task-first runs stalled until the deadline after their patches were ready; with the deadline fix they now complete with stop reason `timeout`, but why Vibe kept the turn open is unexplained. Run with `app_server_wire_trace` when it recurs.
- **agy 1.5.8 has not run a task.** Preparation passes only with `antigravity_skip_permissions = true`; in strict mode the allowed read never executes. The one hosted attempt failed before inference because no Google key was available to the supervisor.
- **Antigravity probes.** With `antigravity_skip_permissions` on, the probes exercise the hook on a read only, not a review-mode write or a shell tool; that needs agy's real tool schemas.

## Quality-pack results

Vibe 3.1.2 ran identical requests on the prepared baseline (`f963acd`) and the new build (`ff4e23b`). All eight runs ended with `end_turn`. Durations are coordinator wall time.

| Task | Baseline verdict / seconds / model calls / tokens | New build verdict / seconds / model calls / tokens |
| --- | --- | --- |
| edit-shipping | Pass / 17.2 / 4 / 38,011 | Pass / 13.4 / 5 / 38,241 |
| edit-reserve-all | Pass / 22.7 / 7 / 74,132 | Pass / 20.8 / 6 / 53,272 |
| review-total | Fail / 5.6 / 2 / 15,310 | Fail / 7.1 / 2 / 11,619 |
| review-stock | Fail / 4.9 / 2 / 14,951 | Fail / 5.2 / 2 / 11,052 |

- **Total review.** The new build found the tax defect and quoted the strict shipping comparison, but called the shipping behavior correct and failed all three expected-versus-actual checks. A rerun at listing commit `021e468` found the tax defect and missed the shipping boundary. One run per build cannot attribute the difference to the system prompt.
- **Stock review.** Both builds correctly concluded there was no defect but omitted the required error behavior and source citation.
- **Calendar-date replay.** The new build passed preparation and the live replay ended normally. Its patch still failed TypeScript compilation because parsed month and day values could be undefined. The run was closed and the patch left out of main.
- **Antigravity 1.5.8.** Strict-mode preparation failed the hook invocation and denial, hook failure denial, and tool-event parsing probes. The allowed-read control ended without a function response. Hosted tasks could not start, leaving strict-mode edit behavior and review mode unverified.

## Changed after the first results; run on Vibe 3.1.2 with no effect on reviews

- **Reviews think.** Vibe review sessions ask for thinking `high` by default (owner decision, 2026-11-13); `vibe_review_thinking = "off"` switches it off, and edit sessions are always off. The supervisor's own files never hold reasoning (a test with a sentinel in reasoning text, summaries and streamed updates finds nothing in its data directory). Vibe's own private session store can hold it while a review lasts and is deleted at close.
- **Review rules ask for evidence:** the code's result and deciding line for every input the task names, the threshold value itself and either side of it, and the task's exact output format.
- **After a failed check.** The skill says to compile an exported edit first and allows one separately authorized correction that carries the exact failure.
- **agy probes record what agy emitted** (`agy_probes.<probe>.<run>.diagnostics` in the saved preparation report). Nothing about the hook, flags or settings changed.

## Review repair handoff

On `48227ac` with Vibe 3.1.2, the `ff4e23b` baseline, thinking off and thinking high each passed 0/5 on both reviews. All 30 turns ended normally. The two latest-build edits passed the independent quality checker. Use separate pin directories for the thinking configurations because preparation receipts are stored beside the pin.

- Start with the review briefs in `scripts/quality-pack/`. Run the exact outgoing review context test in `tests/integration/app-server-wiring.test.ts`, then compare the requested context files with actual read paths for one live run of each review with thinking off.
- For total, require a trace through `shippingFor` at exactly 5000 cents and all three expected and actual tax, shipping and total triples. In a failed run the answer reported actual shipping as 0 at the boundary (verified 499) and expected total as 1379 on input 1 (verified 1579). The checker distinguishes missing findings from incorrect numbers and malformed answers.
- For stock, the no-defect conclusion needs evidence that shortage and over-release throw `RangeError` and unknown SKU throws `UnknownSkuError`, with a citation to `src/inventory.mjs`.
- Keep the independent checker unchanged while adjusting the briefs. Save its full output for each failed run before expanding the sample. The separate date correction still needs the compiler diagnostic about potentially undefined month and day under `noUncheckedIndexedAccess`.

## Antigravity 1.5.8 on 48227ac

Both checks used candidate `6717dfd56b15580217e875f80423b5373a48ac966ae4c137a38315932b96ab18`. The strict preparation report is `9b145330d8db4c77b420437f722c589a6a2f2dcec1a3cddc497b6e1df1997de7`. The optional mode passed in report `c29f018bd01b6c6cbe45af1076d5dbaa05c4c200807cd48370187a997c1f03a4`.


- Strict preparation still fails the hook invocation and denial, hook failure denial, and stream tool shape probes.
- Preparation passes with `antigravity_skip_permissions = true`, where the supervisor hook enforces tool policy. A live read-only `review-stock` attempt was admitted and then failed before inference with `VSUP_BACKEND_ERROR` (`missing_gemini_api_key`). Run `9b5b92e9-e1e8-4d55-8fec-6c81746ac84e` failed after about one second and was closed. Headless execution requires one of `GEMINI_API_KEY`, `GOOGLE_API_KEY` or `ANTIGRAVITY_API_KEY` in the supervisor environment or macOS user launchd session. Once a key is available to the supervisor, rerun the read-only review with the prepared policy. Hosted review quality and edit behavior remain unverified.

## Changed on 2026-11-14, not yet run on a worker

**Why the reviews failed, as far as it can be seen from here.** The exact worker input was given to small stand-in models and scored by the pack's checker. On the old `review-total` brief only 1 of 3 passed although all three found both defects with every number right: the answer layout and the checker's wording patterns failed them. One stand-in also slipped on a single addition. The brief asked a worker that cannot run code for nine exact numbers and scored the layout. This is a floor test of the brief, not proof for Vibe: the stand-ins passed `review-stock` on the old brief where Vibe did not.

- **Review briefs.** `review-total` now gives the totals observed by running the code, asks for the working first and returns a fill-in form; `review-stock` asks for one evidence line per input. Both ask for the wrong source line quoted exactly. With the stand-ins: 5 of 5 on `review-total`, 2 of 2 on `review-stock`.
- **Checker.** `review-total` reads only the filled-in form and no longer counts the same headings in the working. Its details quote the nearest line when a value line is malformed. Scores from before this change are not comparable.
- **Checks before the grant.** Readiness reports the credential's status, the pin manifest and preparation as blockers. Every start checks the credential, verifies the installed files and rechecks preparation before the grant is spent; a refused start leaves the grant usable. A launch that fails before the task is sent is `not_started`.
- **Review results show what was read:** `context_reads`, tool-call counts, and warnings for unread named files, an empty answer or a missing findings block.
- **Preparation explains itself:** `prepare check` prints the report path and failing findings; a stale receipt names what changed; agy's strict-mode failure names its remedy.
- **One command for evidence:** `runs export --include answer`, then `quality-pack.mjs record`.

## Next

1. **Re-score what already exists.** With `main` checked out, run `node scripts/quality-pack.mjs check review-total --answer <file>` and `check review-stock --answer <file>` on the answers saved from the 30 earlier runs, and commit the outputs. This costs no inference and shows how many failures were layout and how many were wrong values.
2. **Confirm thinking really ran.** For one earlier thinking-high review, report the recorded thinking level and the `reasoning_observation` counts from its export. An identical 0 of 5 with thinking off and high is worth explaining.
3. **Build `main`,** install it and run `prepare check`. Its output now names the report path and any failing finding.
4. **Reviews, five runs each on the new briefs,** with the default configuration. After each run:

   ```bash
   vibe-supervisor runs export <run-id> --out <new-directory> --include answer
   ```

   ```bash
   node scripts/quality-pack.mjs record <task-id> --export <that-directory> --out <record-file>.json
   ```

   Commit every record file, passed or failed. Each holds the verdict, every check's detail, the answer, usage, the thinking level and which named files were read.
5. **Edits once each,** exported with `--include patch` and recorded the same way.
6. **Calendar-date replay,** compiler first; on a failure close the run as rejected and start one correction with the exact compiler output ([skill](.agents/skills/vibe-supervisor/SKILL.md)).
7. **agy 1.5.8.** Make a Google key available to the supervisor (`GEMINI_API_KEY`, `GOOGLE_API_KEY` or `ANTIGRAVITY_API_KEY` in its environment or the launchd session); readiness now lists a missing key as a blocker before any grant is spent. With `antigravity_skip_permissions = true`, run `review-stock` and record it. Commit the `diagnostics` objects from the strict-mode preparation report.
8. **Owner:** ask GitHub Support to purge the pre-rewrite commits ([rewrite notes](research/history-rewrite-2026-11-04.md)).
9. **Release 2.2.1** once the reviews pass on Vibe.

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
