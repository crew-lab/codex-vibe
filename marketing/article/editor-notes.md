# Editor notes for the dev.to 2.0 article

**Citations.** Every `path:line` citation in this file refers to the repository at commit d360f28, before the 2.0.1 cleanup removed `docs/history/` and `docs/reviews/` and shortened `CHANGELOG.md`, `Handoff.md` and the docs. Read them with `git show d360f28:<path>`. The story facts the article takes from the removed history are collected, with their citations, in [../sources.md](../sources.md).

Written 2026-10-14 for the owner. Companion to [devto-2.0.md](devto-2.0.md). Nothing here or in the article has been posted anywhere. The article is a draft for the owner to read in their own voice, fill the `[UPDATE AT PUBLISH]` markers, and publish after 2.0.0 is tagged with its target gates recorded, as the [marketing strategy](../strategy.md) launch calendar requires.

Positioning follows `marketing/strategy.md`: the honesty is the marketing; "sandbox" and "the first" are never written; the independence line stays; the landscape wording is "no other Codex-to-Vibe path that supervises", not "no other path". The article is a lessons piece with the tool as the worked example, because DEV's AI-assisted guidelines forbid promoting your own program in AI-assisted posts (see the format section below).

## 1. Copywriter review of the 1.0 draft

Source: `docs/history/article/draft-1.0.md` at commit d360f28 (the 1.0 draft, no longer in the tree).

| Aspect | What the 1.0 draft did | What changed in the 2.0 draft and why |
|---|---|---|
| Hook | A soak test stopping at run 1 with a misreported crash. Good: concrete, dated, admits an error. Weak: the detail (exit code 1, 27.4 s, `VSUP_BACKEND_CRASHED`) belongs to the legacy engine, which 2.0 removed. | The hook is now the thing 2.0 is about: seven protocol facts that would have broken every run, found by reading the source, then eleven cold-review findings after 1,204 green tests. Both are current and both carry a transferable lesson in the first paragraph. |
| Structure | Problem, eight-item checklist, evidence, what is next, checklist again, try it, your turn. The checklist arrived before the reader knew what the tool was; the evidence section was a flat list of passes and failures. | Problem, what 2.0 is, three lessons (read the source, two implementations, cold review), enforcement and limits, try it, honest limits, checklist, your turn. The checklist is now the payoff, not the body. |
| Claims vs evidence | Every number was in `evidence.md`, which was good. Two claims had never been confirmed by the owner: the allowlist incident (item 2) and the fetch-before-fix CI incident (item 8). The hosted evidence is 1.x and no longer transfers. | The two unconfirmed claims are dropped (section 3 below). Every 1.x hosted number that no longer applies is gone. The remaining 1.x numbers (six usefulness-log runs, $0.02 edits) are labelled as 1.x. 2.0 numbers that do not exist yet are `[UPDATE AT PUBLISH]` markers, never placeholders that read as facts. |
| Clarity | Items 3 and 4 (the export blind spot and `core.ignoreStat`) were the strongest material but needed the reader to know Git index internals. Items 6 and 7 mixed process history with product behaviour. | The export blind spot story is not in the 2.0 article: it is a 1.x fix that still holds but is not what changed. Checklist items 6 to 9 keep the lessons without the history. It is good material for blog piece 3 in the strategy (cold reviews). |
| Length | About 1,750 words plus two cards. | About 2,350 words, at the upper end of the 1,500 to 2,200 brief, 8 to 9 minutes at DEV's 275 words per minute. If the owner wants it shorter, cut the "Two implementations are a check" section first (about 170 words), then the enforcement bullet list (about 200 words); both are summarized in the checklist. |
| Voice | First person singular throughout, with "I built", "I removed", "I asked". The project was built largely by agents under the owner, so "I removed more than I kept" overclaims the human share. | "We" throughout, defined in the disclosure sentence as the owner plus the orchestrated agents. The owner should switch to "I" only where it was their own act: decisions, authorizations, reading the review. |
| Tone | Plain, no hype, numbers with conditions. Kept. | Same rules: no em dashes, none of seamless, robust, leverage, unlock, empower, streamline, cutting-edge, sandboxed, secure, the first, the only, production-ready. Checked with grep before handoff. |
| Disclosure | One closing sentence. | One factual sentence near the top (what the strategy asks for: owner's actual role, agents named), repeated in short at the end. The DEV label is set in the editor, not by text. |
| Format | `showdev, mcp, ai, security`; one `{% card %}`; `{% embed %}` of the repo. | Same tags (reasoning below), two cards, one embed, three code blocks, no images except the cover. |

## 2. Fact-check table

Every factual claim in the article, with where it comes from. Paths are relative to the repository root at branch `claude/app-server-design` on 2026-10-14. Other agents were editing `README.md`, `CHANGELOG.md`, `docs/compatibility.md` and `AGENTS.md` while this was written; the line numbers were re-resolved after those edits on the same day, and the quoted phrase, not the number, is the anchor. "Coordinator" means the fact was observed by the session that orchestrated this draft, not read from a committed file.

| Claim in the article | Source |
|---|---|
| 1,204 tests in 80 files at commit `2006e98` | Coordinator's observed `npm test` (vitest) run at that commit, 2026-10-14. Not in a committed file. `marketing/strategy.md:153` records that the static count of `it`/`test` declarations is 961 (964 to 977 on 2026-10-14 depending on how `test.each` is counted) because parameterized tests expand at run time. Re-check against the `verify:release` output on the release commit before publishing (see section 4). |
| Eleven numbered cold-review findings; ten fixed, one (pin reach) kept as a documented limit; the specific findings listed (reaper on failed start, approvals after a stop, budget stop skipping the audit, protocol fault hidden by cancel, executed-then-cancelled effects, watermark past queued notifications, quadratic stdout copying) | `Handoff.md:17` (F1 to F11, with F2 as the documented limit); `docs/development-strategy.md:50` |
| Cold review before every merge, by a reviewer with no design context | `docs/development-strategy.md:50`, `:67`; `marketing/strategy.md:57` |
| Five MCP tools; macOS Apple silicon; Node 20.19 or later; Vibe 2.26.1 exactly | `README.md:3`, `:11-12`; `Handoff.md:40`; `docs/compatibility.md:5` |
| Review can only read files (`read_file`, no search); edit returns a patch never applied, committed or pushed; shell and network off | `README.md:3`, `:57`; `docs/security.md:11`; `docs/adr/0004-app-server-client.md:9` |
| Application policy boundary, not an OS sandbox; Vibe runs as you; what it reads goes to Mistral | `README.md:5`; `docs/security.md:3`, `:18-19` |
| MIT licensed | `LICENSE:1`; `package.json:6` |
| Independent of Mistral AI and OpenAI | `marketing/strategy.md:22`, `:125`; `docs/history/outreach-drafts.md:35` |
| Small MCP servers that wrap the Vibe CLI exist; no other Codex-to-Vibe path that supervises | `marketing/strategy.md:29` (checked read-only 2026-10-14, from repository descriptions only) |
| 1.0 used the legacy headless mode with a Python shim that patched Vibe's internals | `CHANGELOG.md:7`, `:9` (the 2.0.0 entry); `docs/adr/0004-app-server-client.md:5`, `:13` |
| Vibe's source called `--legacy-harness` a temporary escape hatch | `docs/history/outreach-drafts.md:28`; `docs/history/article/draft-1.0.md:92`; `marketing/strategy.md:123` |
| 2.0 is a client of `vibe-app-server`, newline-delimited JSON-RPC over stdio, one process per run, the boundary Vibe's own surfaces use | `docs/adr/0004-app-server-client.md:5`; `docs/compatibility.md:3` |
| No 1.0 evidence transfers to 2.0 | `CHANGELOG.md:7`; `docs/compatibility.md:62` |
| Read-back before the first turn, deny-by-default approvals, effect-to-approval fingerprints, pin hashed before each spawn, drift fails closed | `docs/security.md:27-33`, `:37-43`, `:52-53`, `:68`; `docs/adr/0004-app-server-client.md:19-25` |
| Vibe is never run on the preparing machine; source read at tag `v2.26.1`, commit `4ae5c59...`, with file hashes | `docs/development-strategy.md:64`; `Handoff.md:72`; `docs/compatibility.md:15`; `docs/history/app-server-source-answers-2026-10-14.md:3`, `:108-135` |
| Guess 1: camelCase by alias, `filePath` | `docs/development-strategy.md:39`; `docs/history/app-server-source-answers-2026-10-14.md:27`, `:35` |
| Guess 2: `enabledTools` takes `read_file`/`write_file`/`edit`; callbacks and effects use `file_system.read_file`, `file_system.write_file`, `file_system.search_replace` | `docs/development-strategy.md:40`; `docs/history/app-server-source-answers-2026-10-14.md:7-23`; `docs/compatibility.md:20` |
| Guess 3: `read_file` defaults to `always`; allowlist resolves to `always`; both skip the callback; profile sets `permission = "ask"` with a denylist only | `docs/development-strategy.md:41`; `docs/security.md:28` (denylist contents: `.git`, `.vibe`, `.agents`, `.vibeignore`, `.env*`, `.envrc*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`) |
| Guess 4: scratchpad paths, session grants, bypass gate allow without asking; approved means exactly `execute`/`ask`/`user` linked to a handler approval; null is unapproved; any other executed effect is fatal | `docs/development-strategy.md:42`; `docs/security.md:52`; `docs/history/app-server-source-answers-2026-10-14.md:76-93`; `docs/compatibility.md:21` |
| Guess 5: legacy wrote `export.json` with usage and cost; app-server writes no run export; usage rebuilt from `session/statsUpdated` and `runtime/read`; cost from Vibe's pricing formula; counters reset at a handoff | `docs/history/article/draft-1.0.md:90`; `docs/development-strategy.md:43`; `docs/adr/0004-app-server-client.md:24`; `docs/compatibility.md:24`; `docs/security.md:54` |
| Guess 6: `config/effective/read` has no `max_turns`; server redacts MCP `args` and `env` | `docs/development-strategy.md:44`; `docs/history/v2-path-2026-10-14.md:7` |
| Guess 7: after a handoff the new session is `sessionId`, the old one `oldSessionId` | `docs/development-strategy.md:45` |
| Fake server written from source answers with hashes; refuses snake_case keys; fakes prove the client, not Vibe; grep audits miss behaviour | `docs/development-strategy.md:48`, `:51`, `:65`; `docs/compatibility.md:56` |
| Two 2.0 engines on the same day; Codex branch would fail every start at read-back (`max_turns`, redacted MCP args); `rate_limited` vs `rate_limit`; experiments and auto-update on; thinking `high`; its fake mirrored its own shapes | `docs/history/v2-path-2026-10-14.md:3-7` |
| Three pieces ported: handoff re-validation with usage continuity, more read-back checks, effect-to-callback fingerprints; each branch caught the other's errors | `docs/history/v2-path-2026-10-14.md:13-15`; `Handoff.md:13`; `docs/development-strategy.md:49` |
| Session configuration contents and `VIBE_*` environment switches | `docs/security.md:27` |
| Startup read-back fails before the first turn on a missing field or any difference | `docs/security.md:29`; `docs/compatibility.md:48` |
| Approval handler: profile tool, `realpath` inside the workspace, no denylisted name, 5-second deadline, never session or permanent approval | `docs/security.md:37-41` |
| Event validator: unapproved executed effect fatal, fingerprint mismatch fatal, unknown entry kind fatal, gap in event ids fails closed, handoff conditions, second read-back | `docs/security.md:52-56` |
| Pin: `mistral_vibe` files hashed against a manifest generated on the Vibe machine; server must report 2.26.1; covers only `RECORD`, not dependencies, interpreter or bytecode; detects change, not a malicious original | `docs/security.md:68`; `docs/compatibility.md:9-11`; `Handoff.md:30` |
| Session logging off, thinking off, throwaway store under private `TMPDIR` deleted at close | `docs/adr/0004-app-server-client.md:11`; `docs/security.md:74`; `CHANGELOG.md:16` |
| Catalogue still lists `write_file`, `edit`, the shell tool and `run_typescript`; refused when called; recorded as `tool_denied`; unchanged-source check proves a review wrote nothing | `docs/security.md:12`; `docs/adr/0004-app-server-client.md:9`; `docs/functionality.md:5`, `:96` |
| Validator is detective; can stop and record, not undo | `docs/security.md:25` and the last paragraph of its "Event validator" section |
| `uv tool install mistral-vibe==2.26.1`; browser sign-in; install tarball into a private prefix after checking checksums | `README.md:15-19`, `:30` |
| Config example keys (`version`, `allowed_workspace_roots`, `paths.vibe`, `paths.vibe_pin_manifest`); `~/` roots allowed; `vibe_pin_manifest` required and absolute | `schemas/config.schema.json` (`paths.required = ["vibe_pin_manifest"]`, pattern `^/`); `docs/reference.md:81-95`; `CHANGELOG.md:224` (`~/` roots, 0.9.0-rc.6 entry) |
| `allow`, `pin-manifest`, `doctor --json` sequence; doctor hashes files and launches nothing | `README.md:37-44`; `docs/reference.md` "CLI" section (from `:113`); `docs/compatibility.md:54` |
| `setup` registers `serve --stdio --isolated --config <path>` in Codex's `config.toml`, one private storage directory per connection | `src/cli/codex.ts:26`, `:31-32`; `README.md:46`; `docs/reference.md:126` |
| Readiness call fields (`workspace`, `operation`), launches nothing, returns server version, eligibility, blockers, 10-minute receipt | `docs/reference.md:13`, `:52-67`; `docs/security.md:10` |
| Skill ships two task templates; accepted tasks were narrow and named their inputs | `skills/vibe-supervisor/SKILL.md:35-63`; `docs/history/usefulness-log.md:16` |
| Six real-project runs, three accepted, three not; all on 1.x-era versions; accepted runs narrow with enumerated inputs; the two edits differ only in how explicitly edge cases were listed; a pattern, not a rate | `docs/history/usefulness-log.md:5-16` (rows are rc.28, pre-rc.1, 1.0.0, 1.0.0, 1.0.1-rc.1, 1.0.1-rc.1) |
| 1.x recorded no usage; early edits about $0.02 each as Vibe reported | `docs/history/usefulness-log.md:3`; `docs/history/article/evidence.md:34` (rc.2, 2026-10-05); `docs/compatibility.md:93` |
| 2.0 rebuilds usage and cost from session statistics; optional token and cost ceilings; no real-Vibe figure | `docs/reference.md:91-92`, `:97`; `Handoff.md:13` ("nothing was run against a real Vibe") |
| Linux and Windows code paths exist and are unclaimed | `docs/compatibility.md:79`; `marketing/strategy.md:129` |
| `vibe-app-server` has no version field; Mistral's README does not name it as a supported third-party boundary | `docs/adr/0004-app-server-client.md:5`; `docs/compatibility.md:5`; `marketing/strategy.md:30`, `:123` (README checked read-only 2026-10-14) |
| Each new Vibe release is a new candidate with its own manifest and conformance check | `docs/development-strategy.md:10`, `:20`; `docs/compatibility.md:5` |
| Built largely by orchestrated agents (Claude and Codex) under a human owner who set scope, read every cold review, authorized every hosted run and release | `marketing/strategy.md:57`, `:76`; `Handoff.md:72`, `:74`; `AGENTS.md` ("Development" section) |
| Claude on the preparing branch (`claude/app-server-design`), Codex on the parallel branch (`codex/unified-harness-v2`) | `docs/history/v2-path-2026-10-14.md:3`; `Handoff.md:13` |

Numbers deliberately left out: "174 commits in twelve days" and "28 release candidates" (`marketing/strategy.md:51`, `CHANGELOG.md`) are true but are process trivia; the 1.x hosted latencies and the €1.20 of €8.50 account observation in `evidence.md` are legacy-engine figures and would mislead under a 2.0 headline.

## 3. Claims the owner must confirm or that were dropped

| Claim | Status | Where it was | Action |
|---|---|---|---|
| "An allowlist was updated on disk to approve a new project, and the next delegation was refused" (the allowlist incident) | Never confirmed by the owner. The mechanism (policy reread before every start, `VSUP_RESTART_REQUIRED`) is documented in `CHANGELOG.md:87` (0.9.0-rc.24 entry) and `docs/reference.md:103-105`, but the incident as a story is not in any evidence file. | 1.0 draft, item 2 | Dropped from the 2.0 article. If the owner confirms it happened, it fits blog piece 1 or a one-line aside in "The problem". |
| "One CI run went red because both agents fixed the same test runner. Now each fetches and checks open pull requests before fixing a shared problem" (the fetch-before-fix rule) | Never confirmed by the owner. There is no CI on the 2.0 line (`docs/development-strategy.md:63`), so the sentence would also read as stale. `marketing/strategy.md:66` still mentions the rule for the talk abstract. | 1.0 draft, item 8 | Dropped from the 2.0 article. Owner to confirm before it is used anywhere. |
| "1,204 tests in 80 files at commit `2006e98`" | Reported by the coordinator as observed; not in a committed file. | 2.0 article, hook and cold-review section | Keep, but re-run on the release commit and replace with that figure (section 4). |
| "The author read the text and checked its claims against the cited files before publishing" (closing line) | True only once the owner has done it. | 2.0 article, last line | Owner confirms by doing it; otherwise reword to what actually happened. |
| "We" as owner plus agents; "written by Claude agents" / "written by Codex" for the two branches | Branch names and the strategy support it; the exact share of human edits on each branch is not recorded. | 2.0 article, disclosure and the two-implementations section | Owner to confirm the description of their own role matches reality. |
| Early edits cost about $0.02 each | Vibe-reported figure from rc.2 on 2026-10-05, legacy engine, synthetic repository (`evidence.md:34`). | 2.0 article, honest limits | Keep only with "as Vibe reported them"; drop if the owner prefers no 1.x cost figure at all. |

## 4. `[UPDATE AT PUBLISH]` list

The article has two explicit markers and four sentences that must be re-read at publish time.

| # | Location in the article | What to do at 2.0.0 stable |
|---|---|---|
| 1 | "Honest limits", **Cost is unknown**, marker at the end | If the 2.0.0 target runs recorded usage or cost (they would be in `docs/acceptance.json` and the target report), replace the paragraph with those figures and their conditions. If not, delete the marker and keep the paragraph. |
| 2 | "Honest limits", **Verification is bounded**, the whole paragraph is a marker | Write what `docs/acceptance.json` records for the 2.0.0 gates: conformance check, native readiness, one hosted review and one edit, the observed MCP-client disconnect, `permission = "ask"` visible, thinking off, experiments fetch, nested `run_typescript`, Node 20.19.0, clean-account install. Name any gate still open. If the article goes out before the gates are verified, which the strategy says not to do, the paragraph must say every gate is open and nothing has run against a real Vibe. |
| 3 | Hook (paragraph 1) and the cold-review section heading and first paragraph: "1,204 tests", "80 files", "commit `2006e98`" | Replace with the vitest count from `npm run verify:release` on the release commit and that commit's hash. If the owner prefers the number from the commit the review actually ran on, keep `2006e98` and say so. |
| 4 | "What changed in 2.0": "no 1.0 evidence transfers" and the **Answer quality** paragraph: "2.0 has no entries yet" | If the 2.0.0 target review and edit were recorded in the usefulness log, update the count ("six real-project runs" becomes the new total) and say how many of the 2.0 runs were accepted. |
| 5 | Front matter `description` | Mentions "1,204 green tests"; change with item 3. |
| 6 | "Try it": release tarball, checksums, `vibe-supervisor` commands | Confirm the installed-CLI command names and the `allow`, `pin-manifest`, `doctor` sequence against the 2.0.0 README at the tag; confirm the Codex registration shape against `src/cli/codex.ts` at the tag (today: `[mcp_servers.vibe-supervisor]`, `startup_timeout_sec = 30`, `tool_timeout_sec = 600`). |
| 7 | Closing line and disclosure paragraph | Confirm the sentences describe what the owner did. Set the AI-Assisted label in the DEV editor. |
| 8 | Repository link and embed | Confirm the repository has not been renamed (the strategy suggests renaming to `vibe-supervisor` at 2.0.1). If it has, update the two URLs and the embed. |

## 5. Alternative titles and hooks

Current title: "Delegating between coding agents without taking their word for it" (65 characters).

| Title (length) | Hook, first two sentences |
|---|---|
| "Seven wire-protocol guesses that would have broken every run" (60) | Our fake server passed every test. It was built from seven guesses about Vibe's wire format, and reading the tagged source showed that each one would have failed the first real run. |
| "A cold review found eleven bugs after 1,204 green tests" (55) | The suite was green: 1,204 tests at commit `2006e98`. Then a reviewer who had never seen the design read the diff and found a reaper that quit on a failed start, approvals still granted after a stop, and a protocol fault hidden by a later cancel. |
| "Letting Codex delegate to Mistral Vibe, and checking its work" (61) | When Codex hands a task to another agent, everything that comes back is a claim by the thing you are checking. vibe-supervisor 2.0 is our attempt to make one bounded delegation checkable, and most of its design was wrong the first time we wrote it down. |

The first alternative is the most DEV-native (specific, a number, a lesson). The second is the strongest for Hacker News. The third names the products in the title, which helps search and hurts the "lesson, not pitch" framing under the AI-assisted guidelines; use it only if the owner wants the showdev angle to lead.

## 6. Cover image concept

1000 x 420, no vendor logos (strategy section 5 on naming), no screenshots of private paths.

Left two thirds: a plain two-column diagram on a dark or light neutral background. Left column "what the worker says" with three lines in a monospace face: `read_file` ... `write_file` ... `tests pass`. Right column "what the ledger shows": `file_system.read_file  approved  fp:3f2a…`, `file_system.write_file  tool_denied`, `(no shell tool)`. A thin line between the columns labelled "approval handler". Right third: the title in two lines and, smaller, "macOS Apple silicon. Not an OS sandbox." The point of the image is the article's point: claims on one side, the approval ledger on the other.

Alt text for the editor: "Two columns: on the left, what a delegated coding agent claims it did; on the right, what the supervisor's approval ledger recorded, with a write call marked denied."

## 7. Teasers derived from the article

All three are drafts; nothing is posted. Numbers follow the article, so update them with section 4.

**Show HN** (title under 80 characters; URL is the published article, otherwise the repository; post the comment immediately):

Title: `Show HN: Seven wire-protocol guesses that would have broken every agent-to-agent run`

First comment:

```
Author here. I built a local MCP server that lets Codex hand one bounded review, or one edit in a throwaway Git worktree, to Mistral Vibe. 2.0 drives Vibe through its own app-server protocol instead of patching it.

Two things I would pass on to anyone letting one agent drive another:

1. Read the worker's source at the pinned tag and record the hashes. Seven facts we had guessed (camelCase by alias, two names per tool, read_file defaulting to "always" and skipping the approval callback, allow paths that never ask, no run export, a read-back without max_turns, swapped session ids after a handoff) would each have broken every real run. The fake server was green the whole time because it encoded the guesses.

2. Cold-review before every merge. After 1,204 green tests, a reviewer with no design context found eleven problems, including a reaper that quit on a failed start and approvals still granted after a stop.

Limits: macOS Apple silicon only, Vibe 2.26.1 exactly (anything else fails closed), one run at a time, not an OS sandbox: Vibe runs as you and what it reads goes to Mistral. The model still sees the write tools; they are refused, not hidden. Answer quality is mixed: six real-project runs on the 1.x engine, three accepted, three not. Cost is not recorded yet. Independent project, not affiliated with Mistral AI or OpenAI. Built largely by orchestrated AI agents under a human owner; the cold reviews and source answers are in the repo.

When your sub-agent executes a tool call, what in your setup proves you approved that exact call?

https://github.com/crew-lab/codex-vibe
```

**LinkedIn** (leads with the method, as the strategy asks):

```
We let one coding agent delegate to another and tried not to take its word for anything.

vibe-supervisor 2.0 lets Codex hand one bounded review or one isolated edit to Mistral Vibe. The supervisor answers every approval itself, denies by default, reads the effective configuration back before the first turn, and binds each approval to one tool effect by fingerprint. A patch comes back; it is never applied.

Two lessons from building it, written up with the evidence:
- Read the worker's source instead of guessing its wire format. Seven guesses, each of which would have broken every real run, survived a green test suite because the fake server encoded the guesses.
- Cold-review before every merge. After 1,204 green tests, a reviewer with no design context found eleven problems.

Limits stated in the same font size: macOS Apple silicon only, one Vibe version, not an OS sandbox, answer quality mixed (six real runs, three accepted), cost not recorded yet. Built largely by orchestrated AI agents (Claude and Codex) under a human owner. Independent of Mistral AI and OpenAI.

Article: [link]   Repo: https://github.com/crew-lab/codex-vibe
```

**X** (two posts, thread):

```
1/ We let Codex delegate one review or one edit to Mistral Vibe and built the supervisor so it never has to take the worker's word for anything. Seven wire-protocol guesses would have broken every run; the tests were green the whole time. [article link]

2/ Then a cold review with no design context found eleven problems after 1,204 green tests. macOS only, one Vibe version, not an OS sandbox, six real runs with three accepted. The limits are the point. MIT: https://github.com/crew-lab/codex-vibe
```

## 8. dev.to format decisions

Checked read-only on 2026-10-14.

- **AI disclosure.** DEV's [AI-assisted article guidelines](https://dev.to/guidelines-for-ai-assisted-articles-on-dev) (last updated 2024-04-08) require disclosure, anywhere in the copy or with the #ABotWroteThis tag, and forbid AI-assisted posts that "Promote any business, program, or course (including your own)". The [disclosure announcement](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk) (posted in August 2026, per `docs/history/article/research.md:9`) adds an editor setting with three tiers: Hand Written (No AI), AI-Assisted (Some AI), Fully Autonomous. No front-matter key sets it; pick AI-Assisted in the editor. The article's disclosure sentence is in the body as well, which the 2024 guidelines accept. The "promote your own program" clause is why the article is framed as lessons with the tool as the example and why the CTA asks questions rather than for stars or installs. The owner should re-read both pages on publish day; `research.md` notes DEV said revised guidelines were coming.
- **Tags.** Four maximum, lowercase, comma-separated. Chosen: `showdev, mcp, ai, security`. All four tag pages exist and had posts dated 2026-10-14. `#showdev` guidelines: "For showing off projects and launching products... community-driven and not overly corporate or salesy." `#mcp` is described as "an open protocol that standardizes how applications provide context to LLMs". `#security` and `#ai` have no restrictive guidelines. `#opensource` was considered and rejected: its guidelines exclude "showcases of your own open source work (use #showdev)". `#abotwrotethis` is the older disclosure tag; it would cost one of the four slots and the editor label now does that job.
- **Front matter.** `title`, `published: false`, `description`, `tags`, `canonical_url` (commented out; set only when cross-posting from a site the owner controls), `cover_image` (commented out; the editor also accepts an upload). The current editor guide lists `title`, `published`, `tags`, `canonical_url`, `cover_image` and `series`; `description` appears in archived versions of the guide and in the Forem API article fields and feeds the social-card description. If the editor rejects a `#` comment line in the front matter, delete those two lines rather than leaving the keys empty. Title length is 65 characters, under the roughly 70-character guideline. `description` is 240 characters; shorten to about 150 to 160 if the social card truncates it.
- **Liquid tags.** `{% card %}...{% endcard %}` (two, Markdown inside) and `{% embed https://github.com/crew-lab/codex-vibe %}` (the universal embed supports GitHub). No `{% details %}`, no `{% cta %}`. Preview in the editor before publishing; inspecting Markdown is not preview evidence.
- **Code blocks.** Three: TOML config, shell commands, the readiness JSON. No credentials, no private paths (`/Users/you/...` is a placeholder; the real config path on the target must not appear). The commands are transcribed from the README and `docs/reference.md`, not executed as a new installation.
- **Headings.** H2 only, no skipped levels; the title is the H1. Reading time at DEV's rate is about 8 to 9 minutes.

## 9. Pre-publish checklist

- [ ] 2.0.0 is tagged, the target gates in `docs/acceptance.json` are recorded, and the strategy's week-1 conditions hold (clean-account install passed). Nothing is published against a candidate.
- [ ] Every item in section 4 is done; search the file for `[UPDATE AT PUBLISH]` and find nothing.
- [ ] Section 3 decisions made: the two unconfirmed 1.0 claims stay out unless the owner confirms them; the closing line is true.
- [ ] The owner has read the whole text in their own voice and changed "we" to "I" where it was their own act.
- [ ] The repository description and topics are set (`gh repo edit`, from `docs/history/outreach-drafts.md` section 2), so the embed card does not say "Codex ASP client for Mistral Vibe".
- [ ] Mistral and OpenAI brand pages read by the owner; the independence sentence kept; product names used descriptively (strategy section 5).
- [ ] Cover image uploaded or linked (1000 x 420), alt text set, no vendor logos.
- [ ] Front matter: `published: false` until the final preview; tags exactly four; `canonical_url` only if cross-posting.
- [ ] DEV editor: AI disclosure set to AI-Assisted; preview rendered and the two cards and the embed checked.
- [ ] Grep the final text for em dashes and for: seamless, robust, leverage, unlock, empower, streamline, cutting-edge, sandboxed, secure, the first, the only, production-ready, saves tokens, saves money. None should appear.
- [ ] Every URL opened once: the repository, the release tag, the two DEV guideline pages.
- [ ] Publish at a time the owner can answer comments for the first hours; the Mistral Discussion goes out the same day (strategy section 2); Show HN a few days later once no corrections are pending.
- [ ] After publishing, record the URL in `marketing/strategy.md` and set `canonical_url` on any cross-post to point at it.
