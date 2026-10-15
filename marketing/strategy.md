# Marketing strategy

Written 2026-10-14 for the owner. This directory is outside the package `files`, so nothing here ships. Claims about the tool come from the repository as of this date (README, Handoff, [development strategy](../docs/development-strategy.md), [security](../docs/security.md), [compatibility](../docs/compatibility.md), the usefulness log and the outreach drafts in `docs/history/`); external facts were checked read-only on 2026-10-14 and are listed at the end with what could not be verified. Nothing has been posted, submitted or sent.

The rule for every asset is the one the article evidence file already sets: a number appears only with its conditions, "sandbox" and "the first" are never written, and a rejected run is reported as plainly as an accepted one. The honesty is the marketing.

## 1. Positioning

**Who it is for.** A developer who works inside OpenAI Codex, has a Mistral account, and wants a second opinion from a different model family on one file or one small change without leaving the Codex session and without letting the second agent touch the checkout. Secondary: engineers building any agent-to-agent delegation who want a worked example of making it checkable.

**The problem.** When one coding agent hands work to another, everything that comes back is a claim by the thing being checked: "tests pass", "I read three files", "the edit is done". Nothing bounds what the worker could do, nothing records what it did, and a stop at a limit looks like success or a crash.

**One-sentence pitch.** vibe-supervisor is a local MCP server that lets Codex delegate one bounded code review or one isolated edit to Mistral Vibe and get back something it can verify: a read-only review, or a patch from a detached worktree that is never applied.

**What is genuinely distinctive.**

- *A safety-first supervisor pattern for agent-to-agent delegation.* Deny by default; the supervisor answers every approval; every executed effect must match an approval by fingerprint; an unknown event kind fails the run; an interrupted run fails and is never replayed ([enforcement points](../docs/security.md#enforcement-points)). The pattern transfers; the tool is its reference implementation.
- *A protocol client, not a patch.* 2.0 drives Vibe through its own `vibe-app-server` JSON-RPC boundary, the one Vibe's TUI and ACP surfaces use ([ADR 0004](../docs/adr/0004-app-server-client.md)). Every wire fact was read from the tagged source with recorded hashes.
- *Evidence-driven releases.* A machine-readable acceptance record, gates marked unverified until target-machine evidence is recorded, fail-closed pinning, and a changelog that says when a candidate's evidence does not transfer ([unverified gates](../docs/compatibility.md#unverified-gates)).
- *Honest result semantics.* `completed` means execution ended; the stop reason says whether the answer is usable; a worker's claims are counted against the event log, never believed.

**What it is not.** Not an OS sandbox: the worker runs as the user and what it reads goes to Mistral. Not an orchestrator: one run at a time, five tools, no queue, no replay. Not a quality guarantee: six real-project runs, three accepted and three not, is a pattern to test, not a rate ([usefulness log](../docs/history/usefulness-log.md)). Not cross-platform: macOS Apple silicon, Node 20.19 or later, Vibe 2.26.1 exactly. Not affiliated with Mistral AI or OpenAI. Cost per run is not yet recorded (2.0 rebuilds usage from session statistics; no target evidence exists).

**Landscape, refreshed 2026-10-14.**

| Category | Checked examples | Difference |
|---|---|---|
| Orchestration platforms | Paperclip (about 102k stars, MIT), Multica (about 52.8k, source-available, pre-1.0); see the [landscape note](../docs/history/competitive-landscape-2026-10-13.md) | Both run many agents unsandboxed and say so; neither supports Vibe. We are the contained, checkable single delegation, not a competitor on scope. |
| Vibe-as-subagent wrappers | `DarkPhilosophy/vibe-mcp` (2 stars), `ZolOnTheNet/clive` (0), `verivus-oss/llm-cli-gateway` (16), `integry/propr` (17, lists Vibe among its agents) | They wrap the Vibe CLI and pass text through; none, by its description, enforces approvals, pins the engine or returns an unapplied patch from a detached worktree. The 2026-10-13 note's "no other Codex-to-Vibe path" is now too strong: say "no other one that supervises". |
| Mistral Vibe | Apache-2.0, about 5.1k stars; v2.26.1 (2026-10-09) is still the latest; the README documents programmatic mode, ACP and MCP but does not name `vibe-app-server` as a third-party boundary | The dependency and the main risk (section 5). |
| Codex | Stable `rust-v0.162.1` (2026-10-09); MCP servers in `~/.codex/config.toml`; recent releases add managed worktrees and tool search | The host. Codex worktrees hold Codex's own work; ours isolate the other agent. |
| MCP registry | Preview; latest release v1.8.1 (2026-08-06); accepts npm, PyPI, NuGet, Cargo, OCI and MCPB on GitHub or GitLab releases | Listing needs an MCPB bundle or an npm publish; neither exists today. |
| Google Antigravity | App v2.23.1 (2026-10-13), CLI 1.3.1, IDE 2.5.5, SDK 0.1.21 and an official proprietary ACP server 1.4.0; 2.4 million weekly active users (Alphabet, 2026-07-22); an MCP client on every surface, tools Ask by default and lazy-loaded behind `call_mcp_tool` in the CLI; see the [Antigravity research](../research/antigravity-2026-10-14.md) | A second MCP client to earn, not a competitor on scope and never a worker: no surface gives a supervisor-owned approval boundary, a read-back or a pinnable engine, and its consumer terms forbid third-party software against its sign-in. Claim nothing until its gates are recorded. |
| Review products | Claude Code Review (about $15 to $25 per review, severity tags, thumbs collection), Cursor Bugbot (about $1 to $1.50, a 70%+ resolution claim), Codex `/review`; see the [features research](../research/features-2026-10-14.md) | They review for you; we let your agent delegate a bounded review to another vendor's model and hand you the audit bundle and, from 2.1, the findings file |

## 2. Audiences and channels

| Audience, channel | Message | Asset | Timing | Effort | Success signal |
|---|---|---|---|---|---|
| Codex users with a Mistral account: repo, README, release notes | A second opinion from another model family, inside Codex, that cannot touch your checkout | README hero, quickstart, demo recording, 2.0.0 notes | At the 2.0.0 tag, never before | Medium, mostly agent-doable | Release-asset downloads; issues from strangers |
| MCP ecosystem: official registry, curated lists | One bounded Vibe review or edit for Codex; patch returned, never applied | `server.json` plus an MCPB bundle on a GitHub release ([draft](../docs/history/outreach-drafts.md#3-mcp-registry-entry-post-after-stable-101)); the bundle build is unproven | After 2.0.1 | High: build step, manifest, validation | Listing live; one install that cites it |
| reviewdog and code-scanning users: README section, reviewdog discussions | Pipe a Mistral second opinion into the PR check you already have | `findings.json` and SARIF export (2.1) | After 2.1 ships | S | One external pipeline reported |
| Mistral community: GitHub Discussions, Ideas | A programmatic consumer with recorded evidence asking concrete protocol questions | The drafted Discussion rewritten for 2.0 (it still describes the legacy harness); ask the audit's open questions: catalogue narrowing, a search builtin, omitting reasoning, budget enforcement, protocol stability | The week 2.0.0 ships, same day as Show HN or earlier | Low; owner posts | A maintainer reply; an answer that removes 2.0.1 work |
| Hacker News: Show HN | The checklist for letting one agent delegate to another, the tool as the worked example | Submission plus the drafted first comment, refreshed for 2.0 | After a stranger can install 2.0.0; a weekday morning US time with the owner free to answer | Low to post, high to attend | Comments describing other setups; referrals; no vote solicitation |
| dev.to and the blog series | Failure stories and the checks they produced; no product pitch | The 1.0 article rewritten for 2.0, AI-Assisted label; then the series in section 3 | Article at 2.0.0; series monthly | Medium per piece | Technical comments; one mention by someone else |
| Reddit (r/ChatGPTCoding, r/LocalLLaMA, r/mistralai), X, LinkedIn | One honest paragraph with the limits and a question | Short post linking the article; LinkedIn leads with the method | Day of the article | Low | Replies and saves over likes |
| Talks and meetups | How a small team ships safe agent tooling with AI agents and evidence gates | Two abstracts in section 3 | Submit once 2.0.0 has target evidence | Medium | One acceptance in twelve months |
| Newsletters (MCP, AI engineering) | One line and a link via their forms | The registry description line | After the article | Low | One pickup |
| Antigravity users with a Mistral account: Google AI Developers Forum (Antigravity category), README install note | A second opinion from Mistral inside Antigravity that cannot touch your checkout; your prompt goes to Google, the worker's reads go to Mistral | The `mcp_config.json` install note plus the Antigravity gates in `acceptance.json`; one forum reply to the "Codex plus Antigravity" threads, with the evidence and the version | After the 2.1 gates, never before | Medium: one target sitting, docs | One install report from an Antigravity user |

The sequence is tag, then evidence, then story, then listings. A listing that points at a candidate with every gate open sends readers to a tool that says no platform is certified.

## 3. Representative of the company's engineering work

The repository is a portfolio piece about judgment rather than volume: 174 commits in twelve days, 28 release candidates before 1.0.0, and a 2.0 engine rewrite whose cold review found eleven findings after a green suite. What makes it representative is the method, so the method is the frame.

**Case study: how a small team ships safe agent tooling with AI agents.**

- *Problem.* Let one coding agent hand work to another without being lied to about what happened.
- *Constraints.* No OS sandbox; a worker that runs as the user; a provider that changed its engine mid-project; a two-machine rule (the preparing machine never runs Vibe, the target machine never changes code); a few hosted runs per sitting.
- *Organization.* A human owner setting scope and authorizing every hosted run, push and release; orchestrated agents (Claude on the preparing machine, Codex on the target) on disjoint files; a cold review with no design context before every merge; wire facts read from the tagged source with hashes; fail-closed gates that stay open until evidence exists; two independent 2.0 implementations compared, each catching the other's errors.
- *Outcome.* The product got smaller as it got better (rc.15 and rc.16 removed about 770 net lines); the evidence record states what is unverified; the usefulness log reports rejected runs beside accepted ones.
- *Lessons.* The article's eight-item checklist plus the agent-process rules in the [development strategy](../docs/development-strategy.md#lessons-from-building-20): agents never stage files in Git, checks are chained with `&&`, fakes prove the client not the vendor, grep audits miss behaviour.

**Portfolio page** (company or personal site, not the repository): name, one line, the problem, the three distinctive points, the limits in the same font size, the release tag, the acceptance record, the article and the case study. No star count; the evidence is the credential.

**Talk abstracts.**

1. *Delegating between coding agents safely: a supervisor pattern* (25 minutes). The audience leaves with a checklist, each item tied to a bug that was real: a stop at a limit is neither success nor failure; readiness is checked on the live connection; worker output is an artifact you review; the cleanup check must not share the exporter's blind spot; process claims are counted, not believed; interrupted runs fail and never replay.
2. *Shipping with agents and a human owner: an evidence-gated release* (30 minutes). Two agents on two machines in twelve days; what cold reviews found after green suites; the two-machine and fetch-before-fix rules; the time a staged removal published a half-removed engine. Honest about the costs: orchestration overhead, duplicated work, what a fake server cannot prove.

**Blog series outline.** One failure story, one mechanism, one takeaway per piece; numbers only from the evidence files.

1. *Delegating between coding agents safely.* The checklist with the tool as the worked example (the rewritten 1.0 article).
2. *Reading the source instead of guessing the wire.* Seven guesses that would have broken every real run (camelCase by alias, `file_system.read_file` versus `read_file`, `read_file` defaulting to `always`, no run export, no `max_turns` in read-back, redacted MCP args, `sessionId` after a handoff) and the fake server built from hashed source answers.
3. *What a cold review found after a green test suite.* The 2.0 branch review: a reaper dropped on a failed start, approvals granted after a stop, protocol faults hidden by a later cancel, quadratic stdout copying; why a context-free reviewer catches what a context-rich one cannot. Take the test count from the recorded `verify:release` run on the release commit, not from memory.
4. *Running a release with AI agents and a human owner.* Disjoint file ownership, commits by path, chained checks, two independent implementations, the owner's authorization points.
5. *Six real runs: what narrow tasks do that broad ones do not.* The usefulness log as a story about task shape, extended with 2.0 target evidence.

**Presenting the AI-assisted development.** One factual sentence, up front, every time: "Built largely by orchestrated AI agents (Claude and Codex) under a human owner who set scope, read every cold review and authorized every hosted run and release." Then the artifacts that make it checkable: cold-review files, the acceptance record, the source-hash answers. On dev.to, pick the AI-Assisted label in the editor; a sentence in the text does not set it, and the older guidelines forbid promoting one's own product in AI-assisted posts, so the article stays a lesson with a free tool as the example ([research notes](../docs/history/article/research.md)). Do not hide it, do not lead with it as a gimmick, never claim a human wrote what an agent wrote.

## 4. Popularization plan

**Repository readiness checklist, before any promotion.** Today the repo has 0 stars, no topics, one open issue and the description "Codex ASP client for Mistral Vibe", which is wrong.

- [ ] Description and nine topics from the [outreach draft](../docs/history/outreach-drafts.md#2-github-repository-description-and-topics). Owner-only; now.
- [ ] README hero: pitch, limits paragraph, quickstart. Agent-doable once 2.0.0 wording settles.
- [ ] Demo: asciinema of readiness, one review and one close on the target; a GIF for the README. Owner-only; needs 2.0.0 target evidence.
- [ ] Quickstart a stranger can follow on a clean account; exists only once that gate passes. Owner-only.
- [ ] Badges: license, release, Node floor, "macOS Apple silicon only", "not an OS sandbox"; no CI badge until a workflow runs (the `workflow` token scope was skipped). Agent-doable.
- [ ] `CONTRIBUTING.md` (none exists): `verify:release`, the two-machine rule, Vibe evidence only from the target, how good first contributions are labelled. Agent-doable.
- [ ] Issue templates: bug (with `doctor --json` and diagnostic reasons), evidence report, protocol question. Agent-doable; owner pushes.
- [ ] Social preview image (1280 x 640): name, pitch, limits, no vendor logos. Owner-only upload.
- [ ] 2.0.0 release notes from the changelog, keeping "no 1.0.x evidence transfers". Agent-doable.
- [ ] MCP registry entry via MCPB: bundle build, `manifest.json` with a user-config field for the config path, `mcp-publisher validate`, release asset, `fileSha256`; the `io.github.crew-lab/...` namespace requires an org Owner. Agent-doable to build, owner-only to publish; after 2.0.1.
- [ ] `SECURITY.md` wording rechecked at 2.0.0.

**Launch calendar.** Week 0 is the day 2.0.0 is tagged with its target gates verified. If 2.0.0 slips, everything moves with it.

| Week | Action | Depends on |
|---|---|---|
| -2 to 0 | Checklist items needing no real Vibe; rewrite the article, the Discussion and the Show HN comment for 2.0 | 2.0.0 wording frozen |
| 0 | Tag and publish 2.0.0 with checksums and `acceptance.json`; description and topics live | Owner's publish authorization |
| 1 | Record the demo; publish the article; open the Discussion the same day; Reddit and LinkedIn | Clean-account install passed |
| 2 | Show HN with the article URL, comment posted at once, owner present all day | Article live with no corrections pending |
| 3 to 4 | 2.0.1 work; history leaves the tree; series piece 2 | 2.0.0 published |
| 5 | 2.0.1 tagged; MCPB bundle built and validated | 2.0.1 gates |
| 6 | Registry submission; newsletter forms; curated-list PRs | Bundle validated |
| 7 to 8 | Series piece 3; CFP submissions; first monthly usefulness-log entry | New target runs |

**Community and contribution funnel.** The ask in every post is the same: who runs a different coordinator or worker and would try the same contract? Label good first contributions that each produce a test or an evidence file: the unclaimed Linux and Windows code paths (no support claim until someone records evidence), byte-reproducible archives, task templates for other languages, the MCPB bundle, and after 2.0.1 the read-only search sidecar. Answer issues within two working days; a question only the target can answer gets "unverified, here is the gate", not a guess. Monthly: one usefulness-log entry, published as is.

**Metrics, 90 days after 2.0.0.**

| Metric | Target | Why |
|---|---|---|
| Stars | 50 to 150 | The Codex-plus-Vibe-plus-macOS audience is small; the article brings most of them |
| Release downloads | 100 | GitHub asset stats |
| Registry listing | Live, plus one external install report | The report is the signal |
| External issues and PRs | 5 issues, 1 merged PR | One outside contributor is the milestone |
| Referral traffic | 1,000 article reads; a front-page hour or none | Most Show HN posts never rank; plan for the thread |
| Mistral community | One maintainer reply | Settles protocol questions |
| Usefulness rate | Published monthly from `runs usefulness` once 2.1 exists | Replaces "three of six" with a measured number |
| Talks | One acceptance in twelve months | CFP cycles are slow |

## 5. Risks and guardrails

- **Mistral's protocol.** `vibe-app-server` has no version field, the README does not name it as a supported third-party boundary, and the previous engine went from "temporary escape hatch" to removed within days. Guardrail: promise support only for the pinned version; present the exact pin and fail-closed drift check as the feature; ask the stability question in the Discussion before saying anything about the future.
- **Codex.** Tool search and managed worktrees change how the five tools appear. Guardrail: say "MCP server, used from Codex", let readiness prove the catalogue on the live connection, claim no other MCP client until one is tested.
- **Antigravity.** Weekly releases, config paths moved three times in five months, a terms clause that forbids third-party software against a consumer sign-in, and MCP tools that may reach the model behind a `call_mcp_tool` wrapper. Guardrails: the Antigravity version in every claim; "MCP client, verified on version X", never "supported in Antigravity"; never describe, draft or ship anything that drives Antigravity as a worker; the two-provider data-flow sentence in every Antigravity asset; no Google logo or implied endorsement.
- **Trademark and naming.** Both the repo name `codex-vibe` and the package name contain vendor product names. Mistral's brand page lets partners use its brand with care and states the marks are Mistral's property; a third-party summary of its commercial terms says marketing use of its name needs written approval. OpenAI's brand page returned HTTP 403 and no Codex-specific naming rule was found; its "Language" and "Non-partnerships" sections are the place to read. Guardrails: the independence line ("an independent project, not affiliated with Mistral AI or OpenAI") in the README, release notes, article and every post; product names used descriptively ("for Codex", "a client of Vibe's app-server"), never as a brand; no vendor logos anywhere; consider renaming the repository to `vibe-supervisor` at 2.0.1, since `codex-vibe` reads as a vendor product; the owner reads both brand pages before the article goes out.
- **Security claims.** Every public sentence about safety carries the qualifier: application policy, not an OS sandbox; the worker runs as you; what it reads goes to Mistral; the model-visible catalogue still lists refused tools; the validator is detective for anything already executed; the pin covers only Vibe's own `RECORD`. Never "secure" without saying against what; never "sandboxed".
- **2.0.1 removes the development history, which is the marketing material.** `docs/history/` and `docs/reviews/` leave the tree; Git keeps them. Recommendation: the story lives outside the repository, in the blog series, the portfolio page and the talks, each citing the commit (`c510513` for the earliest cut, the 2.0.0 tag for the rest) so readers can still reach the evidence. Before 2.0.1, copy what the story needs (cold reviews, the usefulness log, the article evidence file, the landscape notes) into this directory or a private writing repo, with the redaction placeholders kept. The shipped repo then describes only the current state, which is what a user needs; narrative goes where narrative belongs.
- **AI-assistance disclosure.** One factual sentence everywhere; the platform's label where one exists; the owner's own reading and voice in the article, as the article README already requires. The risk is overclaiming the human share; the guardrail is describing the owner's actual role: scope, authorization, review, decisions.
- **macOS only.** In the first paragraph of everything. Linux and Windows are unclaimed contribution areas, not roadmap.
- **Answer quality and cost.** The historical six-run sample had three accepted and no recorded cost. Keep that sample dated and version-bound. The later owner-reported rc.2 Crew Bravo patch was independently accepted; rc.5 added no hosted sample. Do not combine these into an invented current acceptance rate or cost claim. The usable advice is the template lesson: narrow scope, enumerated inputs and rejections.
- **Comparisons with attack research.** The "Friendly Fire" result is cited only as "a class of failure our worker cannot reproduce because it has no shell and no network", never as "immune".

## 6. Next actions, in order

Status updated 15 October 2026: the [consolidated plan](../planning/development-plan.md#outreach-and-adjacent-work) is the current dependency list. Main has already performed its source-history cleanup, while the workflow branch still needs integration. Per-run acceptance, reporting, usage observations and a matched preparation kit are implemented on the workflow branch; they should not be marketed as shipped before release/client evidence is complete. The action table below retains the original channel sequence; it does not authorize posting or publication.

| # | Action | Who | Needs 2.0.0 stable |
|---|---|---|---|
| 1 | Set the repository description and topics from the outreach draft | Owner-only | No |
| 2 | Read the Mistral and OpenAI brand pages; settle the independence wording and the repo rename | Owner-only | No |
| 3 | `CONTRIBUTING.md`, issue templates, badge row without CI | Agent-doable; owner pushes | No; after the concurrent 2.0 edits land |
| 4 | Rewrite the article, the Discussion and the Show HN comment for 2.0, numbers only from recorded evidence | Agent-doable draft; owner reads in own voice | Publishing yes |
| 5 | Copy the story material out of the shipped tree before 2.0.1 | Agent-doable | No |
| 6 | README hero and quickstart | Agent-doable | Yes (clean-account gate) |
| 7 | Demo recording and social preview image | Owner-only | Yes |
| 8 | Publish 2.0.0 notes, the article, the Discussion, Reddit and LinkedIn | Owner-only | Yes |
| 9 | Show HN | Owner-only | Yes, plus the article live |
| 10 | MCPB bundle build, manifest, validation, `server.json` | Agent-doable to build; owner-only to publish (org Owner role) | Yes (2.0.1) |
| 11 | Registry submission, curated lists, newsletters | Owner-only | Yes (2.0.1) |
| 12 | Series pieces 2 to 5 monthly; CFP submissions | Agent-doable drafts; owner publishes | Pieces 2 and 4 no; 3 and 5 yes |
| 13 | Antigravity install note, client-neutral skill wording, the four client gates on the target, then the forum reply | Agent-doable docs; owner decides the scope reading, runs the target sitting and posts | Yes (2.1, after 2.0.1) |

## Facts checked on 2026-10-14, and what could not be verified

Checked read-only: `crew-lab/codex-vibe` (public, MIT, created 2026-10-03, 0 stars, 0 forks, no topics, 1 open issue, description "Codex ASP client for Mistral Vibe"; v1.0.0 released 2026-10-13 with checksums, SBOM and acceptance files); org `crew-lab` (created 2026-08-21, 2 public repos, no description or site); `mistralai/mistral-vibe` v2.26.1 on 2026-10-09, Apache-2.0, about 5.1k stars; `openai/codex` stable `rust-v0.162.1` on 2026-10-09; `modelcontextprotocol/registry` v1.8.1 on 2026-08-06, docs marked preview, MCPB from GitHub or GitLab releases with a required `fileSha256`; Paperclip about 102k and Multica about 52.8k stars; the Show HN rules (projects people can try, no blog posts, no vote solicitation); GitHub search for Vibe-related MCP wrappers (descriptions and star counts only; none installed or read).

Not verified: anything about the owner's company. `createglobal.pro` does not resolve (DNS lookup failed) and a web search found nothing under that name, so the portfolio and case-study sections assume a company site the owner must confirm. OpenAI's brand page could not be fetched. Mistral's commercial-terms clause comes from a third-party summary. The "1,204 tests" figure for the cold-review story is the full-suite run count at commit `2006e98` (80 files), observed by the coordinator; a static count of `it`/`test` declarations is lower (961) because some tests are parameterized. For the article, quote the count from the `verify:release` output on the release commit. No 2.0 target evidence exists, so every 2.0 number in the assets is a placeholder until the gates in `acceptance.json` are recorded.
