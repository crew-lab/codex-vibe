# Who might care, and what to ask them

Written 2026-10-14 for the owner. Research and drafts only: nothing has been posted, sent, submitted or applied for, and the owner sends everything personally. Outside the package `files`, so nothing ships. Companion to the [marketing strategy](strategy.md) (positioning, calendar, metrics) and the outreach drafts (commit d360f28, `docs/history/outreach-drafts.md`); this page covers the parties, their official channels and the asks.

Tags: **[V]** read on the party's own page, repository or API on 2026-10-14; **[T]** third party; **[I]** inference; **[U]** not found. Only public professional information from official sources was used; no private contact details, no personal profiles.

## 1. Mistral

### What Mistral gets from this project

- **A documented third-party client of `vibe-app-server`.** Every wire fact was read from the tagged source (`v2.26.1` = `4ae5c59`) with recorded hashes (audit (commit d360f28, `docs/history/app-server-protocol-audit-2026-10-14.md`), source answers (commit d360f28, `docs/history/app-server-source-answers-2026-10-14.md`)). ADR 0009 makes the typed JSON-RPC protocol the boundary for every surface and the 2.26.1 README names Le Chat Desktop as an embedder, so the protocol has first-party clients; ours is one they did not write, exercising the subset a headless supervisor needs [V, [ADR 0009](https://github.com/mistralai/mistral-vibe/blob/v2.26.1/docs/adr/0009-app-server-boundary.md), README "Worktrees"].
- **Bug-grade findings**, each with a file and hash: the `initialize` result carries no protocol version although ADR 0009 says it does; ADR 0009 names `callback/respond` but the code accepts only `callback/result`; a client that omits `approval` from `callbackKinds` crashes the server on its first approval; a pending approval never times out; `maxPrice` and `maxSessionTokens` are ignored by the Unified server; `AgentConfig.tools`, `completion`, `sandbox`, `instructions` and `hooks` have no reader; `config/effective/read` omits `max_turns`; listed `workspaceRoots` load project state even when untrusted [V, audit sections 1, 3, 4].
- **Feedback on the Unified Harness as a programmatic target:** `enabledTools` denies at execution while the model still sees `write_file`, `edit`, the shell tool and `run_typescript`; no read-only search or listing builtin (grep existed on the legacy path); no switch omits reasoning from the store; `self.sleep` and `subagent.*` run without a callback; plugins cannot be disabled [V, audit sections 4, 5, 10].
- **A safe-delegation pattern that spends Mistral credits from inside Codex.** Deny-by-default approvals the client owns, a startup read-back, effect-bound approvals and a fail-closed pin: a worked example other embedders can copy, and a reason for Codex users with a Mistral account to run Vibe [I; the pattern is in [security](../docs/security.md#enforcement-points)].

### Why Mistral might not care, or object

- The audience is small (the repository has 0 stars and 0 forks [V, GitHub API]), and the team says it is "iterating quickly" and "not accepting code contributions at the moment"; it asks for bug reports, feedback and documentation fixes instead [V, [CONTRIBUTING](https://github.com/mistralai/mistral-vibe/blob/main/CONTRIBUTING.md)].
- The repository name `codex-vibe` reads as a vendor product, and the package name carries Mistral's product name (section 4).
- Our public framing audits the security of their harness. Findings presented as "what Vibe cannot do" read as critique; presented as "what a client must supply", they read as integration notes, which is also the true reading: the server gives the client every gate it asked for.
- Mistral has its own surfaces on the same protocol (two TUIs, ACP, programmatic mode, Le Chat Desktop, Vibe Code Web, a VS Code extension) [V, README, [docs](https://docs.mistral.ai/mistral-vibe/introduction)]. A supervisor is not a competitor, but a Codex-first tool is not a priority either.
- Stability is not promised to outsiders: no official page names `vibe-app-server` as a supported third-party boundary [U]; ADR 0014's compatibility policy covers API-backend and harness-runtime skew, not wire clients [V]; the hidden `--agent-socket` "may change or go away without notice" [V, audit section 5].

### Mistral's channels and programs, as of 2026-10-14

| Channel | Verified facts | Fit |
|---|---|---|
| `mistralai/mistral-vibe` | Apache-2.0; 5,119 stars, 738 forks, 404 open issues and PRs, 212 discussions; v2.26.1 on 2026-10-09. CODEOWNERS `@mistralai/eng-vibe-code-cli`. Blank issues disabled; one Bug Report form (Component, Summary, Reproduction steps, Versions / environment, Logs & screenshots); the chooser sends feature requests to Discussions "Ideas" and questions to Discord. Categories include Q&A and Show and tell [V, GitHub API] | Ideas for the questions; Show and tell for the project; the Bug Report form for doc-versus-code mismatches |
| Maintainer engagement | 12 of the 100 most recently updated issues got a contributor's comment, half within 4 days, the rest in 14 to 86 days. On the 60 most recently updated discussions, 3 of 49 comments came from contributors and none from an org member (membership may be hidden, so this undercounts) [V, GraphQL]. Handles that reply in issues: `le-codeur-rapide`, `isidorn`; top committers `mgesbert`, `maiengineering`, `Nemtecl` [V] | Issues get answers; Discussions mostly do not. Expect one reply in ten |
| Discord | The official server, linked from the issue chooser and the docs footer [V] | Informal; a reply there is unquotable |
| Ambassador program | Rolling Google-Form applications; criteria: passion, expertise, prior advocacy, a 6-month commitment; benefits: Studio credits, early access "with direct engagement with product teams", a Discord and Slack channel with Mistral team members; about 28 ambassadors [V, [page](https://docs.mistral.ai/guides/contribute/ambassador)] | The only published route to a standing product-team conversation; needs a prior-advocacy record first |
| Partners | A "Partner with Mistral" form; listed partners are large companies; "can't respond to every submission" [V, [page](https://mistral.ai/partners)] | Poor fit |
| Startup program | No official page found; `mistral.ai/startups` is 404; aggregators describe windowed credit cohorts [T] | [U]; only if the owner's company qualifies |
| Hackathons | Worldwide Hackathon 2026 ran 28 February to 1 March [V, [page](https://worldwide-hackathon.mistral.ai)]; a Prologin "Gradient Contest" and an undated W&B MCP hackathon [T] | None current |
| Community showcase | No "built with Mistral" page found [U]; Show and tell is the official surface [V] | Show and tell |
| Roadmap statements | ADR 0009: surfaces are clients of the typed protocol with "stable values they can reduce, render, page, and recover"; ADR 0011 still describes the legacy adapter; ADR 0016: the Rust CLI is a thin protocol client; the source calls `--legacy-harness` "a temporary escape hatch"; the 2.26.0 notes mention "an embedding application" [V] | The protocol is the strategic boundary; its stability to outsiders is unstated |
| Security | Private reports to `security@mistral.ai`; "do not disclose vulnerability details in public GitHub issues, discussions, or pull requests before coordinating"; a HackerOne program; `security.txt` expires 2027-05-05 [V, [SECURITY.md](https://github.com/mistralai/mistral-vibe/blob/main/SECURITY.md), [security.txt](https://mistral.ai/.well-known/security.txt)] | Section 4 |
| Brand | "Partners and collaborators are welcome to use our brand"; marks "are the property of Mistral"; no rule on third-party product names [V, [page](https://mistral.ai/brand)] | Section 4 |

### The ask ladder

Each rung is asked only after the one below it has an answer or has been tried, and each names what we give.

| Rung | Ask | What we offer |
|---|---|---|
| a | Answers to the five audit questions (rewritten for 2.0): catalogue narrowing, a search or listing builtin, omitting reasoning, budget enforcement on the Unified server, and whether the protocol is supported for third-party clients | The audit and source answers with hashes as a reference for other embedders; the doc-versus-code mismatches filed as bug reports with reproductions |
| b | A protocol stability statement: a version field in the `initialize` result, or a documented policy such as ADR 0014 extended to wire clients, and the stable callback method name | A conformance script (`scripts/v2-conformance-check.mjs`) that checks the handshake and read-back against a release without inference, runnable by them per release |
| c | A mention: a line in the README's integrations or ACP section, or a Show and tell post left pinned | A client-side integration note they can link: what a headless client must declare, deny and read back |
| d | A named contact or a standing channel: the ambassador program's product-team channel, or one maintainer who reads protocol questions | Early reports on each Vibe release (pin drift, read-back changes), and hosted evidence from a real third-party client |
| e | Co-marketing: a Mistral post or newsletter mention of Codex-to-Vibe delegation | The article, the demo and the usefulness log, with the independence line and their brand rules observed |

Expectation [I]: a is the only rung with evidence of maintainers answering (issues, not Discussions); b is unlikely before a published SDK; c is cheap for them; d goes through the ambassador form or nothing; e needs usage we do not have.

## 2. Other interested parties

| Party | Why they might care | Official channel | Asset | Timing | Effort | Success signal |
|---|---|---|---|---|---|---|
| **OpenAI Codex** | An MCP server used from Codex; a plugin scaffold exists | Plugins: the portable layout is a root `plugin.json` with `extensions.com.openai`; `.codex-plugin/plugin.json` is a "compatibility fallback" (our scaffold uses that legacy layout). Public directory submission needs a remote HTTPS MCP endpoint; local servers "follow a separate desktop-only path" [V, [build](https://developers.openai.com/codex/plugins/build)]. Codex open source fund: $1M, grants up to $25,000 in API credits, rolling [V, [docs](https://github.com/openai/codex/blob/main/docs/open-source-fund.md)] | A repo-scoped `.agents/plugins/marketplace.json`; the fund application | Marketplace after 2.0.1; fund once a stranger can install 2.0.0 | Low | One marketplace install; a fund reply |
| **MCP registry and community** | A stdio server with an unusual contract (one bounded run, patch never applied) | Registry v1.8.1, preview; MCPB bundle on a GitHub release with `fileSha256` [V, outreach draft 3]; registry Discussions have Show and tell; the spec repository has "Ideas - Security" and "Q&A - Server implementation"; the contributor Discord discourages "service or product marketing" [V, [communication](https://modelcontextprotocol.io/community/communication)]; `anthropics/mcpb` v2.1.2, last push 2026-05-26 [V] | `server.json` plus the bundle; a Show and tell post; a `punkpeye/awesome-mcp-servers` PR (96k stars; fork, add a line) [V] | After 2.0.1 | High for the bundle, low for the posts | Listing live; one install citing it |
| **Google Antigravity** | A second MCP client for the same server | Google AI Developers Forum, Antigravity category; no MCP Store submission path documented [U]; see the [Antigravity research](../research/antigravity-2026-10-14.md) | The `mcp_config.json` note plus four recorded gates | After the 2.1 gates | Medium | One Antigravity install report |
| **Zed and ACP** | Vibe is one of 42 agents in the ACP registry, which is curated for authenticating agents; we are not an agent, so no listing [V, [registry](https://github.com/agentclientprotocol/registry)]. Discussion 928 (closed) asked for mandatory permission checks; the maintainer position was that enforcement belongs to each agent; discussion 2125 on refusal provenance and bounded `allow_always` is open with no comments [V] | The ACP org Discussions: the two threads, or "General", which carries project announcements | One comment with the client-side evidence (client-owned approvals, effect fingerprints, read-back) as a data point for the provenance proposal | After the article | Low | A maintainer reply; a link from a proposal |
| **Agent-orchestration projects** | Open requests for Vibe support with nothing behind them: Multica #3513 (0 comments since 2026-05-29), Paperclip #161 (3 comments, last 2026-03-29) and #7828 (9 comments, last 2026-06-10) [V] | Those issues | The Multica comment rewritten: the draft still cites the Python launcher and `vibe -p`, both removed in 2.0 | After 2.0.0 | Low | A maintainer reaction; a reference in an adapter |
| **Security-minded communities** | A running example of a separate guardian deciding before an action happens | OWASP GenAI Agent Control Standard: Apache-2.0, 193 stars, 157 open issues, a reference implementation with Claude Code and OpenCode shims, a README asking for a second implementation "with the same kind of table" of limits [V, [repo](https://github.com/GenAI-Security-Project/agent-control-standard)]; OpenSSF SAFE-MCP SIG (list `openssf-sig-safe-mcp`, Slack `#sig-safe-mcp`) [V, [ai-ml-security](https://github.com/ossf/ai-ml-security)]; the MCP Security IG [V] | A limits table in the ACS style; a short note on effect-bound approvals and the detective-only validator | After target evidence | Medium | A citation as example or counterexample |
| **Tech press and newsletters** | MCP digests take practitioner pieces | Glama's MCP Newsletter: weekly, "60,000+ developers", contributions by the email on its page, product mentions allowed when the piece has value [V, [page](https://glama.ai/newsletter)]; PulseMCP: a submit page of uncertain status [V]; heise.de has covered Vibe [T] | The checklist at newsletter length | After the article | Low | One pickup |
| **Workshops** | Agent-to-agent protocol security is a listed topic | AGENT-SEC 2026 at ACM CCS (15 November; deadline passed 23 July) lists "attacks on agent-to-agent communication protocols, e.g., MCP, A2A", human oversight and audit trails [V, [page](https://sites.google.com/view/agent-sec-2026/)]; REALM 2026 and ICML "Agents in the Wild" have passed [T]; the 2027 cycle is unannounced [U] | An experience report once target evidence exists | 2027 cycle | Medium | One acceptance |
| **The owner's company network** | A portfolio piece on judgment and evidence gates | `createglobal.pro` has Cloudflare nameservers and Google mail records but no A record, so no site was found [V, DNS]; everything here is conditional on a site and audience the owner confirms | The strategy's portfolio page and case study | After 2.0.0 | Low | Named referrals |

## 3. Sequenced plan, tied to releases

**Before 2.0.0 is tagged.** Nothing is posted; the readiness work and the drafts happen.
1. Repository description and topics (owner), `CONTRIBUTING.md`, issue templates, the independence line: the strategy's checklist.
2. Rewrite the Mistral Discussion for 2.0: the draft describes the legacy harness and announces a move that has happened. Title: `[Feature Request]: Third-party clients of vibe-app-server: protocol version, catalogue narrowing, search builtin, reasoning, budgets`; Component: CLI. The five questions: (1) is the protocol supported for third-party clients, and will `initialize` carry a version; (2) can a client narrow the model-visible catalogue; (3) will a read-only search or listing builtin exist; (4) can reasoning be omitted from the store, and does `thinking=off` stop it; (5) are `maxPrice` and `maxSessionTokens` meant to be honoured by the Unified server. A problem statement and five questions, each with the file it was read from.
3. Split the doc-versus-code mismatches into Bug Report drafts (section 4 says which go private first): the missing protocol version, `callback/respond` versus `callback/result`, the crash when `callbackKinds` lacks `approval`.
4. The new documents: a **protocol feedback note** (two pages from audit sections 1, 3, 4 and 10, with hashes, written as integration notes); a **one-page project brief** (what it is, the limits, the evidence record, the independence line, the links); a **maintainer-facing issue template** mirroring Mistral's Bug Report fields so each finding is a paste.
5. Rewrite the Multica comment for 2.0 and draft the Paperclip one.

**At 2.0.0 stable** (target gates recorded, a stranger can install).
1. Release notes, the article with the AI-assisted label, Show HN, Reddit and LinkedIn, per the strategy's calendar.
2. The Mistral Discussion with hosted evidence attached; the Bug Reports the same week; a Show and tell post after the article.
3. The Multica and Paperclip comments; a week after the article, the ACP comment and the newsletter pitch.
4. The Codex open source fund application; the Mistral startup program only if the owner's company qualifies and a window is open.

**After 2.0.1.**
1. MCPB bundle, `server.json`, the registry submission and its Show and tell post; the awesome-list PR; the Codex marketplace file.
2. The ambassador application, with the article, the Show and tell post and answered community questions as the advocacy record.
3. The security-community write-ups and the workshop experience report once monthly usefulness-log entries exist; Antigravity only after its 2.1 gates.

**The existing drafts.** 1 (Discussion): rewritten as above. 2 (description and topics): now. 3 (registry entry): after 2.0.1 with the version and asset names updated. 4 (Multica): rewritten for 2.0. 5 (Show HN): refreshed per the article's editor notes.

**The rule.** Every post, comment, form and application is sent by the owner, from the owner's accounts, after reading it in full. Agents draft; nothing is scheduled or automated.

## 4. Guardrails

- **No affiliation claims.** The independence line ("an independent project, not affiliated with Mistral AI or OpenAI") in every post; "for Codex" and "a client of Vibe's app-server" as descriptions, never as endorsements; no vendor logos.
- **Naming.** Rename the repository to `vibe-supervisor` before the first outreach post, not at 2.0.1: every post links to the repository, and `codex-vibe` names two vendors' products; GitHub redirects the old name. Mistral's brand page welcomes partners using the brand "with the same care we do", states the marks are Mistral's property and sets no rule for third-party product names, so the package name stays descriptive and lowercase [V]. OpenAI's brand page returned HTTP 403 again [U].
- **Responsible disclosure.** Mistral asks that anything possibly security-related go privately to `security@mistral.ai` before any public issue or discussion [V]. Three findings are candidates: the crash when a client omits `approval` from `callbackKinds`; untrusted `workspaceRoots` still loading project state; `self.sleep` and `subagent.*` running without a callback. None is a vulnerability in Vibe's threat model as we read it (the client is trusted in all three), so: one short private note listing them with hashes, asking whether any should stay out of the public Discussion, then a reply or two weeks before posting. The missing version field, the method name and the ignored budgets are documentation mismatches and can be public.
- **Tone.** Contribution, not critique: "a headless client must declare, deny and read back", not "Vibe does not enforce". Each finding carries its file and hash and "corrections welcome". No claim about Mistral's intentions beyond what an ADR says.
- **Not shared.** Credentials, session histories, account identifiers, unredacted target evidence (the placeholders in AGENTS.md, "Recording target evidence", apply), cost figures without conditions, any number not in a recorded evidence file.
- **Measuring interest.** Replies by role and days to first reply; reactions on the Discussion and issues; a docs or README mention; referral stars and release downloads in the week after each post; install reports that cite a channel. The strategy's 90-day targets stand; the Mistral signal becomes "one maintainer reply on a Bug Report", since Discussions rarely get one.

## 5. Next actions

| # | Action | Who | Needs 2.0.0 |
|---|---|---|---|
| 1 | Rename the repository to `vibe-supervisor`; set the description and topics | Owner-only | No |
| 2 | Rewrite the Mistral Discussion for 2.0; draft the three Bug Reports in the form's fields; write the private disclosure note | Agent-doable; owner reads | No |
| 3 | Write the protocol feedback note, the one-page brief and the issue template | Agent-doable | No |
| 4 | Rewrite the Multica comment; draft the Paperclip comment | Agent-doable | No |
| 5 | Send the private note to Mistral security; wait for a reply or two weeks | Owner-only | No |
| 6 | Post the Discussion and the Bug Reports, with hosted evidence | Owner-only | Yes |
| 7 | Post the Show and tell, the Multica and Paperclip comments | Owner-only | Yes |
| 8 | Apply to the Codex open source fund | Owner-only | Yes (installable) |
| 9 | ACP comment; newsletter pitch | Owner-only | Yes (article live) |
| 10 | Update the plugin scaffold to the portable `plugin.json` layout; add the marketplace file | Agent-doable; still an unverified scaffold until a target install | 2.0.1 |
| 11 | MCPB bundle, registry submission, awesome-list PR | Agent-doable to build; owner-only to publish | 2.0.1 |
| 12 | Ambassador application | Owner-only | After 2.0.1 and the advocacy record |
| 13 | ACS-style limits table; SAFE-MCP and MCP Security IG write-up; workshop experience report | Agent-doable drafts; owner submits | Target evidence and usefulness entries |

## Sources checked on 2026-10-14, and what could not be verified

Read-only, by GitHub API or page fetch: `mistralai/mistral-vibe` (metadata, CONTRIBUTING, SECURITY, CODEOWNERS, templates, the 60 most recently updated discussions and 100 issues, contributors, ADRs 0009, 0011, 0014 and 0016, README and CHANGELOG at `v2.26.1`); the Mistral ambassador, partners, brand, hackathon and docs pages and `security.txt`; the Codex plugin build page and open-source-fund doc; the MCP communication page, registry and `mcpb` releases; the ACP registry and discussions 928 and 2125; Multica #3513, Paperclip #161 and #7828; the OWASP ACS and OpenSSF AI/ML repositories; Glama's newsletter page; the AGENT-SEC 2026 page; the awesome-mcp-servers CONTRIBUTING; DNS for `createglobal.pro`. Links in the text name each source.

Not verified: an official Mistral startup program page (aggregator claims only); Mistral's stance on third-party app-server clients (unstated anywhere read); whether org members' comments on the Vibe repository hide behind `NONE` associations; OpenAI's brand page (HTTP 403); PulseMCP's current submission status; the 2027 workshop cycle; anything about the owner's company beyond DNS; the Codex plugin directory process beyond the build page's sentences.
