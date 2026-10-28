# Editor notes for the dev.to article

Written 2026-10-14 and brought up to date on 2026-10-28 against `main` at `75c0029`. Companion to [devto-2.0.md](devto-2.0.md). Nothing here or in the article has been posted anywhere. The article is a draft for the owner to read in their own voice, fill the `[UPDATE AT PUBLISH]` markers, and publish in the [marketing strategy's](../strategy.md) order: tag, evidence, story, listings.

**Citations.** A `path:line` citation refers to the repository at `75c0029`; the quoted phrase, not the number, is the anchor when lines drift. Facts from the development history that the 2.0.1 cleanup removed from the tree are read with `git show d360f28:<path>` and collected in [../sources.md](../sources.md). Evidence paths under `research/evidence/` are sanitized derivatives; nothing in them or here names a machine path, a credential, a receipt or the private project, which stays `<site-project>`.

Positioning follows `marketing/strategy.md`: the honesty is the marketing; "sandbox" and "the first" are never written (the article says "not operating-system isolation" where the README says "not an operating-system sandbox"); the independence line stays; the landscape wording is "no other Codex-to-Vibe path that supervises", not "no other path"; a number appears only with its conditions; unknown model and cost fields are disclosed as unknown; the article makes no claim about the worker's answer quality. It is a lessons piece with the tool as the worked example, because DEV's AI-assisted guidelines forbid promoting your own program in AI-assisted posts (section 8).

## 1. What the 2026-10-28 revision changed

| Aspect | Before (2026-10-14 draft) | Now, and why |
|---|---|---|
| Version facts | 2.0, Vibe 2.26.1, no release | Vibe 3.0.2 exactly; five one-shot tools; 2.2.0 published 2026-10-27 as a pre-release after two accepted native trials; latest status is a marker (`Handoff.md:3`, `planning/development-strategy.md:138`, `:143`) |
| How a start works | A readiness receipt admitted a start | New section "How a start works now": the single-use grant from `task authorize`, per-field hashes, a refusal that names the differing fields, and the friction stated plainly (`docs/adr/0010-dispatch-attempt-authorization.md`, `CHANGELOG.md:19`, `planning/development-strategy.md:12`) |
| What was proven | Nothing had run against a real Vibe | New section with the two 2.2.0 trials, their numbers and conditions, what they do not prove, and the mixed record before them (`research/evidence/v2.2.0-local-workflow-20261027/`, `planning/development-strategy.md:77`, `:166`) |
| Cold review | The 2.0 engine review only | Adds the 2.1.0 review: the finalization race, timestamp-bound grants, unreachable correction code (`CHANGELOG.md:21-29`, `planning/development-strategy.md:224-225`) |
| Seven guesses | Read at 2.26.1 | Same seven, dated to the 2.26.1 read; the 3.0.2 re-read and the three beliefs the installed server corrected are added (`docs/compatibility-v3.md`, ADR 0005, ADR 0006, `planning/development-strategy.md:79`, `:191`) |
| Two implementations | Its own section | Folded into one sentence at the end of the guesses section to hold the length; the full story stays in `../sources.md` |
| Honest limits | Quality, cost unknown, one platform, protocol, verification | Cost now has two recorded figures with conditions; the protocol paragraph adds 3.0.0's removed RPCs, 3.0.3's renamed edit tool and the 2026-10-27 surfaces review; a frozen Antigravity paragraph is added; the gate-ledger lag is stated |
| What's next | None | New short section: ten real starts, start friction, search only on evidence (`planning/development-strategy.md:20-32`) |
| Checklist | Ten items | Eleven: item 5 (authorize each start once) added; item 10 carries the abbreviated-summary lesson |
| Length | About 2,350 words | About 3,500 words of body text, roughly 13 minutes at DEV's 275 words per minute. The extra carries the grants, the trials and the second review. To shorten: cut the enforcement bullet list first (about 280 words; the checklist repeats it), then the `task authorize` code block and its paragraph (about 120), then the 2.1.0 review paragraph (about 130) |
| Voice, tone, disclosure, format | "We" defined in the disclosure; no em dashes; no hype words | Unchanged. Checked with grep before handoff (section 9) |

## 2. Fact-check table

Every factual claim in the article, in reading order, with where it comes from. "Coordinator" means the fact was observed by the session that orchestrated the draft, not read from a committed file.

| Claim in the article | Source |
|---|---|
| 1,204 tests in 80 files at commit `2006e98`, before the 2.0 engine cold review | Coordinator's observed vitest run at that commit on 2026-10-14; not in a committed file. `marketing/strategy.md:163` records why the static count differs. The release figure is separate (section 4) |
| Eleven numbered findings; ten fixed, one (pin reach) a documented limit; the reaper on a failed start, approvals after a stop, a budget stop skipping the audit, a protocol fault hidden by a cancel | `planning/development-strategy.md:81` ("The eleventh cold-review finding is accepted"), `:196`; `Handoff.md` history (F1 to F11, F2 the limit); `../sources.md` |
| Two runs through the real connection accepted by an independent check; three releases since 2.0 (2.0.1, 2.0.2, 2.1.0, then 2.2.0) | `research/evidence/v2.2.0-local-workflow-20261027/README.md:3`, `:9-10`; `planning/development-strategy.md:134-138` |
| Local MCP server; Codex hands one bounded review or one edit in a throwaway Git worktree to Vibe | `README.md:3`; `planning/development-strategy.md:62` |
| Built largely by orchestrated agents (Claude and Codex) under a human owner who set scope, read every cold review, authorized every hosted run and release | `marketing/strategy.md:61`, `:80`; `planning/development-strategy.md:243`, `:253`; `AGENTS.md` ("Development") |
| Five MCP tools; macOS Apple silicon; Node 20.19 or later; Vibe 3.0.2 exactly | `README.md:3`, `:19-20`; `AGENTS.md` ("Boundaries"); `planning/development-strategy.md:164` |
| Every start needs a single-use grant | `docs/security.md:107`; `docs/reference.md:3`; `AGENTS.md` ("The five MCP tools are always registered") |
| Review can only read files; edit returns a patch never applied, committed or pushed; shell and network off | `README.md:3`, `:65`; `docs/security.md:12` |
| Application policy boundary, not operating-system isolation; Vibe runs as you; what it may read is sent to Mistral | `README.md:5`; `docs/security.md:3`, `:19-20` |
| MIT licensed; independent of Mistral AI and OpenAI | `LICENSE`; `package.json`; `marketing/strategy.md:131`; `planning/development-strategy.md:179` |
| 2.2.0 published 2026-10-27 as a pre-release after two accepted native runs; not yet latest | `Handoff.md:3`; `planning/development-strategy.md:138`, `:143` (latest rule) and `:23`, `:37` (D2: mark latest without the clean account) |
| Small MCP servers that wrap the Vibe CLI exist; no other Codex-to-Vibe path that supervises | `marketing/strategy.md:29` (repository descriptions checked read-only 2026-10-14; not rechecked since) |
| 1.0 used the legacy headless mode with a Python shim; Vibe's source called it a temporary escape hatch | `../sources.md` ("The 1.x engine"); `CHANGELOG.md:138-151` (the 2.0.0 entry) |
| Client of `vibe-app-server`, newline-delimited JSON-RPC, one process per run, the boundary Vibe's own interfaces use | `docs/adr/0004-app-server-client.md`; `docs/security.md:34`; `planning/development-strategy.md:85` |
| No 1.0 evidence transferred; evidence belongs to the exact archive | `CHANGELOG.md:142`; `planning/development-strategy.md:112`, `:198` |
| Read-back before any turn; deny by default; every effect matches an approval; pin hashed before each spawn; drift fails closed | `docs/security.md:36-38`, `:62-64`, `:78`; `planning/development-strategy.md:67` |
| Vibe never run on the preparing machine; facts from the tagged source with SHA-256 per file | `planning/development-strategy.md:247`, `:122`; `docs/compatibility.md` ("Source basis"); `docs/compatibility-v3.md` ("Source basis") |
| Seven guesses read at `v2.26.1`, commit `4ae5c59` | `docs/compatibility.md:23`; `../sources.md` ("Reading the source") |
| 3.0.2 re-read at tag `v3.0.2`, commit `36f7b3a`; approval callback, approval type and source, sequential event ids and redacted effective configuration still present | `docs/compatibility-v3.md:7-23`, `:27`, `:52`; `planning/development-strategy.md:122` |
| Guess 1: camelCase by alias, `filePath` | `planning/development-strategy.md:184`; `../sources.md` |
| Guess 2: `enabledTools` names vs `file_system.read_file`, `file_system.write_file`, `file_system.search_replace` | `planning/development-strategy.md:185`; `docs/security.md:48`; `research/vibe-3.0.3-assessment-2026-10-28.md:3` (confirms `file_system.search_replace` as the 3.0.2 wire name) |
| Guess 3: `read_file` defaults to `always`; allowlist skips the callback; profile sets `permission = "ask"` with a denylist plus per-root exclusions | `planning/development-strategy.md:186`; `docs/security.md:37` (denylist contents and merged `excluded_globs`) |
| Guess 4: allow without asking; approved means `execute`/`ask`/`user` linked to a handler approval; null is unapproved | `planning/development-strategy.md:187`; `docs/security.md:62` |
| Guess 5: no run export; usage from `session/statsUpdated` and `runtime/read`; cost from Vibe's pricing formula; counters reset at a handoff and are carried across | `planning/development-strategy.md:188`, `:98`; `docs/security.md:65` |
| Guess 6: no `max_turns` in `config/effective/read`; MCP `args` and `env` redacted | `planning/development-strategy.md:189`; `docs/compatibility-v3.md:52` |
| Guess 7: `sessionId` and `oldSessionId` after a handoff | `planning/development-strategy.md:190` |
| Fake server from source answers with hashes; refuses snake_case keys; proves the client, not Vibe | `planning/development-strategy.md:123`, `:194` |
| Parallel Codex engine, green on its own fake, would have failed every start at read-back; each branch caught the other's errors; three pieces ported | `../sources.md` ("The two 2.0 engines"); `planning/development-strategy.md:195` |
| The installed server found three wrong beliefs: null harness provenance, remote managed-configuration refresh with a provider key, packaged skills listed; the loopback endpoint serves a disabled policy and is read back | `planning/development-strategy.md:79`, `:191`; `docs/adr/0005-target-conformance-repairs.md`; `docs/adr/0006-bundled-vibe-skills.md`; `docs/security.md:28-30`; `CHANGELOG.md:112-118` |
| Cold review before every merge by a reviewer with no design context | `planning/development-strategy.md:124`, `:196`, `:251` |
| 2.1.0 review: finalization race (deadline or cancel during final history read killed the server), grants bound to timestamps and inodes, unreachable correction code; a new candidate; 2.1.0 published with a known-issue note | `CHANGELOG.md:21-29`; `planning/development-strategy.md:136-137`, `:224-225` |
| Readiness (`vibe_status` workspace mode) launches nothing; reports eligibility and blockers, connected candidate, preparation state, `supervisor_runtime.executable`, a 10-minute receipt | `README.md:61`; `docs/reference.md:61-76`, `:210`; `docs/security.md:11` |
| `task authorize`: private JSON request, owner reference, expiry within 24 hours, same config, `--runtime-node`; returns `authorization_id`, `attempt_id`, `request_sha256`, `expires_at`; starts no worker | `docs/reference.md:190`; `docs/adr/0010-dispatch-attempt-authorization.md` ("Decision"); `docs/local-operation.md` ("Authorize and start") |
| Grant stores a hash per bound field (request fields, base commit or review file contents, candidate, Node runtime, pin manifest, policy); refusal names `details.differing_fields`, never values; one start; competing consumer refused; no refund, retry, replay or MCP creation | `docs/adr/0010-dispatch-attempt-authorization.md` ("Decision", paragraphs 2 to 4); `CHANGELOG.md:19`, `:26` |
| Friction: a hand-assembled command; one wrong field is a refusal; 2.2.0 explains it, nothing prevents it | `planning/development-strategy.md:12`, `:171` |
| `allowed_write_paths`: files and `dir/` prefixes; writes elsewhere denied with `outside_allowed_write_paths` and the run continues; bound into the grant | `CHANGELOG.md:18`; `docs/reference.md:35`; `docs/security.md:49` |
| 2.2.0 qualified 2026-10-27 with two owner-authorized native starts on the exact archive later published; Node 24.21.0, macOS arm64, isolated Vibe 3.0.2; the `PATH` CLI was 3.0.3 and unused | `research/evidence/v2.2.0-local-workflow-20261027/HOSTED-QUALIFICATION.md:3`, `:7`; `README.md:5-7` in that folder; `Handoff.md:3-5` |
| Trial A: contract and one source file read; `>` to `>=`; contract passed; ten independent numeric cases in a disposable copy; fixture unchanged; 8.1 s, 3 model calls, 22,275 tokens, about USD 0.015 | `HOSTED-QUALIFICATION.md:11-15` in that folder; `TRIAL-A-validation.json` |
| Trial B: review of two documents in a real project; three conclusions accepted after excerpt checks; a concurrent commit changed HEAD; 274 file hashes unchanged; no write tool observed; 13.6 s, 2 model calls, 40,194 tokens, about USD 0.044 | `HOSTED-QUALIFICATION.md:19-23`; `TRIAL-B-validation.json`. The project is `<site-project>` in the evidence and is unnamed in the article |
| Ledgers: two reads and one edit for A, two reads for B, zero denials; workers exited, private state removed, slot released | `HOSTED-QUALIFICATION.md:29`, `:15`, `:23`; `README.md:11` in that folder |
| Model label `mistral-vibe-cli-latest`, alias `mistral-medium-3.5`, thinking off; provider and weights unverified; cost is an estimate, not billing | `HOSTED-QUALIFICATION.md:27` |
| Not proven: general reliability, clean account, nested `run_typescript` gating, Antigravity, better answers by delegating | `README.md:3` in that folder; `Handoff.md:5`; `planning/development-strategy.md:11` |
| Mixed record: 2.0.1 review reversed two of five cases; 2.0.1 edit missed its contract; 2.1.0 fixture edit accepted; six 1.x runs, three accepted | `planning/development-strategy.md:77`, `:166`, `:206`; `CHANGELOG.md:93`; `../sources.md` ("Real-project runs") |
| Accepted tasks were narrow and named their inputs | `.agents/skills/vibe-supervisor/SKILL.md:54`; `../sources.md` |
| Session configuration contents and the `VIBE_*` switches | `docs/security.md:36` |
| Read-back fails before any turn on any difference | `docs/security.md:38` |
| Handler: profile tool, `realpath` inside the workspace, denylist, exclusions, `allowed_write_paths`, 5-second deadline, never session or permanent approval | `docs/security.md:46-50` |
| Validator: unapproved effect fatal, fingerprint mismatch fatal, unknown entry kind fatal, watermark gap fails closed, handoff conditions, second read-back | `docs/security.md:62-67` |
| Pin: `mistral_vibe` files hashed before each spawn; server must report 3.0.2; covers `RECORD` only; detects change, not a malicious original | `docs/security.md:78`, `:80`; `planning/development-strategy.md:81` |
| Session logging and thinking off; throwaway store under a private `TMPDIR` deleted at close | `docs/security.md:84`; `docs/compatibility-v3.md:29` |
| Interrupted run marked failed at restart; nothing resumed or replayed | `docs/security.md:90`; `planning/development-strategy.md:102` |
| Catalogue lists `write_file`, `edit`, the shell tool and `run_typescript`; refused and recorded as `tool_denied`; unchanged-source check proves nothing was written | `docs/security.md:13`; `planning/development-strategy.md:81` |
| Validator is detective | `docs/security.md:72` |
| Grant ledger is private local state; rewriting it defeats the accounting | `docs/adr/0010-dispatch-attempt-authorization.md` ("Boundaries and evidence") |
| `uv tool install mistral-vibe==3.0.2`; browser sign-in or `MISTRAL_API_KEY`; archive into a private prefix after checksums; the kit ships beside the archive | `README.md:19-27`, `:38`, `:60`; `docs/preparation.md`; `AGENTS.md` ("Verification and reporting") |
| `allow`, `pin-manifest`, `doctor --json`, `prepare check --kit` sequence; doctor launches nothing; the preparation pass gates dispatch | `README.md:44-50`, `:60`; `docs/reference.md` ("CLI") |
| `setup` registers `serve --stdio --isolated --config <path>`; one private storage directory per connection | `src/cli/codex.ts:31-32`; `README.md:53` |
| The `task authorize` example's flags and the expiry expression | `docs/reference.md:190`; `docs/local-operation.md` ("Authorize and start"). `$NODE_FROM_READINESS` is a placeholder for the readiness-reported executable, not a real variable the CLI knows |
| Skill ships two task templates | `.agents/skills/vibe-supervisor/SKILL.md:52-78` |
| Per-run token and dollar ceilings; per-root daily budget; a ceiling can overshoot by one model call | `docs/reference.md:171`; `CHANGELOG.md:52-53`; `planning/development-strategy.md:81` |
| Linux and Windows code paths exist and are unclaimed | `planning/development-strategy.md:164`; `Handoff.md` ("Known limits of this state") |
| `vibe-app-server` has no version field; no official page names it a third-party boundary; 3.0.0 removed three app-server RPCs | `planning/development-strategy.md:159`; `marketing/strategy.md:128` |
| 3.0.3 four days after 3.0.2 renamed `file_system.search_replace` to `file_system.edit` with no changelog line; an edit would be denied every edit under the pin; re-pin on a trigger | `research/vibe-3.0.3-assessment-2026-10-28.md:3`; `planning/development-strategy.md:30`, `:41`, `:58`, `:147` |
| 2026-10-27 surfaces review: ACP same app-server with fewer controls; the headless prompt mode decides every approval itself; agent socket and `run-server` not supported entry points; Codex delegates only through MCP | `planning/development-strategy.md:7`, `:58`; `docs/compatibility.md:3` ("There is no ACP adapter") |
| Antigravity: experimental, opt-in flag; hook gate the vendor's process must honour; no evidence in the repository; not for production; frozen at one CLI version (agy 1.4.9); removed in the next minor if unused; reads go to Google | `docs/security.md:94-102`; `planning/development-strategy.md:16`, `:29`, `:40`, `:70`; `Handoff.md:22`; `CHANGELOG.md:7` |
| Verified on earlier archives: no-inference conformance, native readiness, client disconnect; not observed: clean account (no spare account), nested `run_typescript`, thinking off effect, experiments fetch | `planning/development-strategy.md:77`, `:23`, `:126`, `:146`; `docs/compatibility.md` ("Unverified gates"); `Handoff.md:5`, `:16` |
| `docs/acceptance.json` still names 2.1.0 while the 2.2.0 trials sit under `research/evidence/` | `docs/acceptance.json:3`; `planning/development-strategy.md:14`, `:214`; `Handoff.md:15` |
| Next: about ten real starts logged with exports and usefulness entries; readiness returning the exact `task authorize` command; search via `context_files` first; sidecar only if nested calls are deniable and the gap stays | `planning/development-strategy.md:24-28`, `:38-39`, `:50-52`; `Handoff.md:17-21` |
| Checklist item 10: a correct patch was once rejected from its abbreviated summary | `planning/development-strategy.md:166`, `:205` |

Numbers deliberately left out: "174 commits in twelve days" and "28 release candidates" (`marketing/strategy.md:55`) are process trivia; the 1.x hosted latencies and the early "$0.02 per edit" figure are legacy-engine numbers superseded by the two recorded 2.2.0 figures; the combined "62,469 tokens, USD 0.059" total (`HOSTED-QUALIFICATION.md:27`) adds nothing the two per-run figures do not say; the "14,442 tokens, about USD 0.022" review in `planning/development-strategy.md:165` belongs to an earlier build and is not dated in that row, so it is not used.

## 3. Claims the owner must confirm or that were dropped

| Claim | Status | Action |
|---|---|---|
| The allowlist incident and the fetch-before-fix CI incident from the 1.0 draft | Never confirmed by the owner (see the 2026-10-14 notes in Git history) | Still out |
| "1,204 tests in 80 files at commit `2006e98`" | Coordinator-observed; not in a committed file | Keep as the count at the review's commit, or replace per section 4 |
| "Written by Claude agents" / "written by Codex" for the two 2.0 branches (now one sentence) | Branch names and the strategy support it; the human share per branch is not recorded | Owner confirms the description of their own role |
| "The author read the text and checked its claims against the cited files before publishing" | True only once done | Owner confirms by doing it; otherwise reword |
| "2.2.0 ... as a pre-release" and the latest marker | True at `75c0029`; the owner decided on 2026-10-28 to mark 2.2.0 latest without a clean-account install (D2) | Fill the marker with what is true on publish day; if latest, say it was marked latest on the target's fresh-prefix install and the offline smoke, with no clean-account installation |
| "A review of two documents in a real project" | True (`HOSTED-QUALIFICATION.md:19`); the project is private | Keep unnamed. Never add the project name or domain |
| "No other Codex-to-Vibe path that supervises" | Checked read-only on 2026-10-14 from repository descriptions; not rechecked | Owner rechecks the landscape on publish day or softens to "as of October 2026" |
| The Antigravity paragraph | The target reports all five probes passing with the skip-permissions flag on, but the evidence is not committed (`CHANGELOG.md:7`, `Handoff.md:22`) | If the evidence lands before publish, change "holds no evidence yet" to what the evidence shows, with the agy version and the flag state |
| Dropped: the "Two implementations are a check" section as a section | Length | The facts stay in `../sources.md` and one sentence of the article |
| Dropped: "Cost is unknown" | Two figures now exist | Replaced by "Cost is barely measured" with both figures and their conditions |

## 4. `[UPDATE AT PUBLISH]` list

The article has three explicit markers and several sentences to re-read on publish day.

| # | Location | What to do |
|---|---|---|
| 1 | "What it is" card, last sentence | Say whether v2.2.0 is marked latest and on what basis (D2: fresh-prefix install and offline smoke, no clean account). If a later release is being announced instead, replace 2.2.0 everywhere (card, trials section, `preparation-kit-2.2.0`, Try it) and re-source the trial numbers from that release's evidence folder |
| 2 | "Honest limits", **Cost is barely measured** | Add later recorded figures from the evidence folders or the usefulness log with their date, build, Vibe version and estimate basis, or delete the marker and keep the two figures |
| 3 | "Honest limits", **Verification is bounded** | Re-read `docs/acceptance.json` and `research/evidence/` for the announced release. Say whether the ledger now carries 2.2.0 and its two trials (Direction step 1), and name any gate that moved: nested `run_typescript`, thinking off, experiments fetch, clean account, the five `antigravity-*` gates |
| 4 | Hook and the cold-review section: "1,204 tests in 80 files at commit `2006e98`" | Keep as the count at the review's commit, or replace with the release commit's `verify:release` count (2.2.0 on Node 20.19.0: 109 files, 1,567 tests, `research/evidence/v2.2.0-local-workflow-20261027/README.md:8`; `main` after the Antigravity merge: 110 files, 1,583 tests, `planning/development-strategy.md:124`). Whichever is used, name the commit and the Node version |
| 5 | Archive identity | The article names no hash. If the owner wants one, it is `6b0a120d1ae16bb102af4bc07bfa11522684f536a3a17fce3f9f93dc70d44984` for the 2.2.0 archive (`Handoff.md:3`); take it from the release's `SHA256SUMS`, not from memory |
| 6 | "Try it" | Confirm the installed CLI's command names, the `prepare check --kit` flag and the `task authorize` flags against the README and `docs/reference.md` at the release tag; confirm the Codex registration shape against `src/cli/codex.ts` (today: `[mcp_servers.vibe-supervisor]`, `startup_timeout_sec = 30`, `tool_timeout_sec = 600`) |
| 7 | "What two accepted runs proved" | If the ten real starts (Direction step 3) have run and are logged, add their count, how many were accepted, and the date range; keep "a pattern to test, not a rate" unless `runs usefulness` is quoted with its sample size |
| 8 | "What comes next" and the Antigravity paragraph | Re-read the Direction table in `planning/development-strategy.md` and the Handoff status table; whatever has landed moves from "next" to "done" or is dropped |
| 9 | Front matter `description` | 285 characters today; shorten to about 160 if the social card truncates it |
| 10 | Closing line and disclosure paragraph | Confirm the sentences describe what the owner did. Set the AI-Assisted label in the DEV editor |
| 11 | Repository link and embed | The repository keeps the name `codex-vibe` (owner 2026-10-19); check both URLs |

## 5. Alternative titles and hooks

Current title: "Delegating between coding agents without taking their word for it" (65 characters).

| Title (length) | Hook, first two sentences |
|---|---|
| "Seven wire-protocol guesses that would have broken every run" (60) | Our fake server passed every test. It was built from seven guesses about Vibe's wire format, and reading the tagged source showed that each one would have failed against the real server. |
| "One grant per start: making agent-to-agent delegation checkable" (63) | When one coding agent hands work to another, every word that comes back is a claim by the thing being checked. We made each start carry a single-use grant bound to the exact request, so that a refusal names the field and nothing is replayed. |
| "Letting Codex delegate to Mistral Vibe, and checking its work" (61) | When Codex hands a task to another agent, everything that comes back is a claim by the thing you are checking. vibe-supervisor is our attempt to make one bounded delegation checkable, and most of its design was wrong when we wrote it down. |

The first is the most DEV-native. The second leads with the newest mechanism and suits Hacker News. The third names the products, which helps search and hurts the "lesson, not pitch" framing under the AI-assisted guidelines.

## 6. Cover image concept

1000 x 420, no vendor logos (strategy section 5), no screenshots of private paths.

Left two thirds: a plain two-column diagram on a neutral background. Left column "what the worker says", three monospace lines: `read_file` ... `write_file` ... `tests pass`. Right column "what the ledger shows": `file_system.read_file  approved  fp:3f2a…`, `file_system.write_file  tool_denied`, `(no shell tool)`. A thin line between the columns labelled "approval handler", and above it a small tag `grant: one start`. Right third: the title in two lines and, smaller, "macOS Apple silicon. Not operating-system isolation."

Alt text: "Two columns: on the left, what a delegated coding agent claims it did; on the right, what the supervisor's approval ledger recorded, with a write call marked denied and a single-use grant above."

## 7. Teasers derived from the article

Drafts; nothing is posted. Numbers follow the article, so update them with section 4.

**Show HN** (title under 80 characters; URL is the published article, otherwise the repository; post the comment immediately):

Title: `Show HN: Letting one coding agent delegate to another without taking its word`

First comment:

```
Author here. I built a local MCP server that lets Codex hand one bounded review, or one edit in a throwaway Git worktree, to Mistral Vibe. It drives Vibe through its own app-server protocol, and every start carries a single-use grant bound to the exact request.

Three things I would pass on to anyone letting one agent drive another:

1. Read the worker's source at the pinned tag and record the hashes. Seven facts we had guessed (camelCase by alias, two names per tool, read_file defaulting to "always" and skipping the approval callback, allow paths that never ask, no run export, a read-back without max_turns, swapped session ids after a handoff) would each have broken every real run. The fake server was green the whole time because it encoded the guesses, and the installed server still corrected three more beliefs.

2. Cold-review before every merge. After 1,204 green tests, a reviewer with no design context found eleven problems; the review of the next pre-release found a finalization race and grants that a touched file could spend.

3. Authorize each start once. A grant stores a hash per field of the request, the install, the runtime and the policy; a refusal names the field, never the value; nothing is replayed.

Limits: macOS Apple silicon only, Vibe 3.0.2 exactly (anything else fails closed), one run at a time, application policy rather than OS isolation: Vibe runs as you and what it reads goes to Mistral. The model still sees the write tools; they are refused, not hidden. Two accepted runs on the current release (an edit, USD 0.015 estimated; a two-document review, USD 0.044), and a mixed record before them. Independent project, not affiliated with Mistral AI or OpenAI. Built largely by orchestrated AI agents under a human owner; the cold reviews, source answers and sanitized run evidence are in the repo.

When your sub-agent executes a tool call, what in your setup proves you approved that exact call?

https://github.com/crew-lab/codex-vibe
```

**LinkedIn** (leads with the method):

```
We let one coding agent delegate to another and tried not to take its word for anything.

vibe-supervisor lets Codex hand one bounded review or one isolated edit to Mistral Vibe. The supervisor answers every approval itself, denies by default, reads the effective configuration back before any turn, binds each approval to one tool effect by fingerprint, and authorizes each start once with a grant bound to the exact request. A patch comes back; it is never applied.

Three lessons from building it, written up with the evidence:
- Read the worker's source instead of guessing its wire format. Seven guesses, each of which would have broken every real run, survived a green test suite.
- Cold-review before every merge. After 1,204 green tests, a reviewer with no design context found eleven problems; the next release's review found three more.
- Make each start a single-use grant. A refusal names the field that differs, never its value.

Limits in the same font size: macOS Apple silicon only, one Vibe version, application policy rather than OS isolation, two accepted runs on the current release and a mixed record before them, cost estimated at a few cents per run and not yet measured at scale. Built largely by orchestrated AI agents (Claude and Codex) under a human owner. Independent of Mistral AI and OpenAI.

Article: [link]   Repo: https://github.com/crew-lab/codex-vibe
```

**X** (two posts, thread):

```
1/ We let Codex delegate one review or one edit to Mistral Vibe and built the supervisor so it never has to take the worker's word for anything. Seven wire-protocol guesses would have broken every run; the tests were green the whole time. [article link]

2/ Cold reviews found eleven problems after 1,204 green tests, then three more a release later. Every start is one single-use grant. macOS only, one Vibe version, application policy rather than OS isolation, two accepted runs so far. The limits are the point. MIT: https://github.com/crew-lab/codex-vibe
```

## 8. dev.to format decisions

Checked read-only on 2026-10-14; re-read both DEV pages on publish day.

- **AI disclosure.** DEV's [AI-assisted article guidelines](https://dev.to/guidelines-for-ai-assisted-articles-on-dev) (last updated 2024-04-08) require disclosure and forbid AI-assisted posts that "Promote any business, program, or course (including your own)". The [disclosure announcement](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk) adds an editor setting with three tiers: Hand Written, AI-Assisted, Fully Autonomous. No front-matter key sets it; pick AI-Assisted in the editor. The disclosure sentence is in the body as well. The "promote your own program" clause is why the article is framed as lessons with the tool as the example and why the CTA asks questions rather than for stars or installs (`../sources.md`, "Positioning and platform rules").
- **Tags.** Four maximum, lowercase. Chosen: `showdev, mcp, ai, security`. `#opensource` was rejected because its guidelines exclude showcases of your own open source work; `#abotwrotethis` would cost a slot that the editor label now covers.
- **Front matter.** `title`, `published: false`, `description`, `tags`, `canonical_url` (commented out), `cover_image` (commented out). If the editor rejects a `#` comment line in the front matter, delete those two lines. Title is 65 characters; `description` is 285 characters and may need shortening (section 4, item 9).
- **Liquid tags.** `{% card %}...{% endcard %}` (two) and `{% embed https://github.com/crew-lab/codex-vibe %}`. Preview in the editor before publishing.
- **Code blocks.** Two shell blocks. No credentials, no private paths; `/Users/you/...` and `/path/to/...` are placeholders, and the real configuration path on the target must not appear. The commands are transcribed from the README, `docs/reference.md` and `docs/local-operation.md`, not executed as a new installation.
- **Headings.** H2 only; the title is the H1. Reading time about 13 minutes at DEV's rate.

## 9. Pre-publish checklist

- [ ] The release being announced is tagged and published; its evidence folder and `docs/acceptance.json` agree on the build (Direction step 1). Nothing is published against an unqualified candidate.
- [ ] Every item in section 4 is done; search the article for `[UPDATE AT PUBLISH]` and find nothing.
- [ ] Section 3 decisions made; the closing line is true.
- [ ] The owner has read the whole text in their own voice and changed "we" to "I" where it was their own act.
- [ ] The repository description and topics are set (`gh repo edit`), so the embed card does not say "Codex ASP client for Mistral Vibe".
- [ ] Mistral and OpenAI brand pages read by the owner (Handoff step 12); the independence sentence kept; product names used descriptively.
- [ ] Cover image uploaded or linked (1000 x 420), alt text set, no vendor logos.
- [ ] Front matter: `published: false` until the final preview; tags exactly four; `canonical_url` only if cross-posting.
- [ ] DEV editor: AI disclosure set to AI-Assisted; preview rendered; the two cards and the embed checked.
- [ ] Grep the final text for em dashes, for the private project's name and domain, and for: seamless, robust, leverage, unlock, empower, streamline, cutting-edge, sandbox, sandboxed, secure, the first, the only, production-ready, saves tokens, saves money. None should appear.
- [ ] Every URL opened once: the repository, the release tag, the two DEV guideline pages.
- [ ] Publish at a time the owner can answer comments for the first hours; the Mistral Discussion goes out the same day (strategy section 2); Show HN a few days later once no corrections are pending.
- [ ] After publishing, record the URL in `marketing/strategy.md` and set `canonical_url` on any cross-post to point at it.
